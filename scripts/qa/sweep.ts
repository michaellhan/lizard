// The Practice QA sweep (docs/QA.md): plays seeded Practice hands through the real web code (practice.ts newHand and
// decide, flow.ts needOf and moveOf, pfGrade.ts gradedOn, client.ts SolverClient with its modes and provenance) against
// advserver.py, the browser worker's Advisor run natively, and holds every decision, opponent's move and finished hand to
// the invariants in web/src/qa/checks.ts. Writes decisions.jsonl, summary.json and summary.md under qa-out/, and
// returns the summary; run.mjs exits non-zero where a hard invariant failed.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as P from "@/features/practice/practice";
import { moveOf, needOf } from "@/features/practice/flow";
import { gradedOn, type HeldAnswer, type PfAsked } from "@/features/practice/pfGrade";
import { readDraft, stageDraft } from "@/features/practice/TournamentFields";
import { FINAL_TABLE_SET, FORMAT_PRESETS, STAGE_PRESETS } from "@/features/tournaments/tournament";
import type { Grade } from "@/grading/grade";
import { seeded, STREETS, type Move, type Sim, type Street } from "@/poker/table";
import { SolverClient } from "@/solver/client";
import { evUnit } from "@/solver/provenance";
import type { AdvisorState, PlayMove } from "@/solver/protocol";
import type { SolveResult } from "@/solver/types";
import * as K from "@/qa/checks";
import { markdown, spotOf, summarize, type HeroRecord, type QaRecord, type RefRecord, type Summary, type TableTag } from "@/qa/summary";
import type { QaConfig } from "./matrix";
import { PyAdvisor } from "./py";

export interface SweepOptions {
  configs: QaConfig[];
  refs: { fast: number; accurate: number; share: number };
  seed: number;
  /** the share of your decisions taken uniformly among the options, not by the answer's mix, so off-mix moves are graded */
  explore: number;
  /** play only these hand numbers of each config (each hand deals and draws from its own seed, so one hand replays alone) */
  onlyHands?: number[];
  out: string;
  label: string;
  log: (s: string) => void;
}

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const now = () => performance.now() / 1000;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** A request's time from now on, less what the slot wrapper spent holding a new process (a restart at the RSS cap, or the
 * config's first request): the time the advisor took, not the queue for a CPU slot. */
const clock = (adv: PyAdvisor) => {
  const at = now();
  const w = adv.waited;
  return () => r3(Math.max(0, now() - at - (adv.waited - w)));
};

/** The project's memory rule for any one process (about 1 GB), MB. */
const RSS_RULE_MB = 1024;
/** Whether the request just answered took its process's peak RSS past RSS_RULE_MB: a process's peak only grows, so it's the
 * first request past it since the process started (`mark` follows one advisor; reset it where a fresh process starts). */
const crossed = (adv: PyAdvisor, mark: { restarts: number; rss: number }) => {
  if (adv.restarts !== mark.restarts) {
    mark.restarts = adv.restarts;
    mark.rss = 0;
  }
  const was = mark.rss;
  mark.rss = adv.last.rss;
  return adv.last.rss > RSS_RULE_MB && was <= RSS_RULE_MB;
};
const rssViolation = (adv: PyAdvisor) => K.violation("perf.rss", `this request took the advisor's peak RSS to ${adv.last.rss} MB, over the ~1 GB a process may use`, "soft");

/** The hand in a line: your seat and cards, the board out, and each street's moves. */
export function lineOf(h: P.PracticeHand): string {
  const parts = STREETS.filter((s) => h.lines[s].length).map((s) => `${s[0]!.toUpperCase()}: ${h.lines[s].map((m) => `${m.pos} ${m.action}${m.to !== undefined ? ` ${m.to}` : ""}`).join(", ")}`);
  const board = h.board.slice(0, h.shown).join("");
  return `${h.hero} ${h.hands[h.hero]!.join("")}${board ? ` on ${board}` : ""}${parts.length ? ` | ${parts.join(" | ")}` : ""}`;
}

/** A draw from a mix's frequencies (uniform where they sum to nothing). */
function draw(freqs: readonly number[], u: number): number {
  const fs = freqs.map((f) => (Number.isFinite(f) && f > 0 ? f : 0));
  const tot = fs.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return Math.min(fs.length - 1, Math.floor(u * fs.length));
  let x = u * tot;
  for (let i = 0; i < fs.length; i++) {
    x -= fs[i]!;
    if (x <= 0) return i;
  }
  return fs.length - 1;
}

/** The session's deal options as the page would start it: Practice's defaults, the preflop solve on where the game is
 * stored (pfByDefault) unless set off, and a stored tournament preset's table and prizes (TournamentFields). */
export function sessionOf(cfg: QaConfig): { players: number; stack: number; opts: P.DealOptions } {
  let players = cfg.players;
  let stack = cfg.stack;
  const opts: P.DealOptions = { seat: "moves", pot: cfg.pot ?? null, ...(cfg.opponents ? { opponents: cfg.opponents } : {}) };
  if (cfg.ante) opts.ante = cfg.ante;
  if (cfg.straddle) opts.straddle = true;
  if (cfg.rake) {
    opts.rake = cfg.rake;
    if (cfg.rakeCap) opts.rakeCap = cfg.rakeCap;
  }
  if (cfg.tournament) {
    const st = [...STAGE_PRESETS, ...FORMAT_PRESETS, ...FINAL_TABLE_SET].find((p) => p.name === cfg.tournament);
    if (!st) throw new Error(`no tournament preset "${cfg.tournament}"`);
    const s = stageDraft(st);
    const { value, problems } = readDraft(s.draft, s.players, s.stack, 250);
    if (!value) throw new Error(`the preset "${cfg.tournament}" doesn't read: ${problems.join("; ")}`);
    players = s.players;
    stack = s.stack;
    opts.ante = s.ante;
    opts.tournament = value;
  }
  if (cfg.pfSolve === false) opts.pfSolve = false;
  else if (!P.pfBlocked(players, stack, opts)) opts.pfSolve = true;
  return { players, stack, opts };
}

interface RefJob {
  base: Omit<RefRecord, "t" | "mode" | "secs" | "source" | "cmp" | "all" | "violations">;
  mode: "fast" | "accurate";
  state: AdvisorState;
  sim: Sim;
  chose: string;
  quick: { mix: P.Decision["mix"]; grade: Grade; grades: Grade[] };
}

export async function sweep(o: SweepOptions): Promise<Summary> {
  mkdirSync(o.out, { recursive: true });
  const file = resolve(o.out, "decisions.jsonl");
  writeFileSync(file, "");
  const records: QaRecord[] = [];
  const put = (r: QaRecord) => {
    records.push(r);
    appendFileSync(file, JSON.stringify(r) + "\n");
  };
  const t0 = now();
  // (each request's limit: Quick and Fast answer in seconds, Accurate in a minute or two a street; past these the process
  // is stopped and started again, and the request fails as a hard violation)
  const limit = (st: AdvisorState) => (st.speed === "accurate" ? 420 : st.quick ? 150 : 240);
  const main = new PyAdvisor("advisor", limit, {}, o.log);
  // (the references are asked once every config has played, on a process of their own started then: one process at a
  // time, so the sweep holds one CPU slot, and the reference's cache is cold, not Quick's)
  const refAdv = new PyAdvisor("reference", limit, {}, o.log);
  const refClient = new SolverClient(refAdv, "qa");
  const left = { fast: o.refs.fast, accurate: o.refs.accurate };
  const accEvery = Math.max(1, Math.floor(o.refs.fast / Math.max(1, o.refs.accurate)));
  const jobs: RefJob[] = [];
  let fastAsked = 0;

  const refMark = { restarts: -1, rss: 0 };
  const runRef = async (j: RefJob) => {
    const took = clock(refAdv);
    const violations: K.Violation[] = [];
    let source = "error";
    let cmp: RefRecord["cmp"] = null;
    let all: RefRecord["all"];
    try {
      const r = await refClient.solve({ state: j.state, mode: j.mode });
      if (r.data.error) violations.push(K.violation("ref.error", `the ${j.mode} reference answered with an error: ${r.data.error}`, "soft"));
      else {
        source = r.provenance.source;
        const mix = P.gradable(P.mixOf(r.data), r.provenance);
        const pot = typeof r.data.pot_bb === "number" ? r.data.pot_bb : j.sim.pot;
        const basis = P.practiceBasis(r.data, r.provenance, j.sim);
        cmp = K.compareRef(j.chose, j.quick, { mix, pot, basis });
        all = K.compareAll(j.quick, { mix, pot, basis });
        if (!cmp) violations.push(K.violation("ref.missing", `the ${j.mode} reference has no ${j.chose}`, "soft"));
        else if (cmp.condemns) violations.push(K.violation("ref.condemns", `Quick says ${cmp.quick} for ${cmp.action} (${cmp.quickFreq}, EV ${cmp.quickEv}), ${j.mode} says ${cmp.ref} (${cmp.refFreq}, EV ${cmp.refEv})`, "soft"));
        else if (cmp.passes) violations.push(K.violation("ref.passes", `Quick says ${cmp.quick} for ${cmp.action} (${cmp.quickFreq}, EV ${cmp.quickEv}), ${j.mode} says ${cmp.ref} (${cmp.refFreq}, EV ${cmp.refEv})`, "soft"));
      }
    } catch (e) {
      violations.push(K.violation("ref.error", `the ${j.mode} reference failed: ${message(e).slice(0, 300)}`, "soft"));
    }
    if (crossed(refAdv, refMark)) violations.push(rssViolation(refAdv));
    put({ t: "ref", ...j.base, mode: j.mode, secs: took(), rss: refAdv.last.rss, source, cmp, ...(all ? { all } : {}), violations });
  };

  for (const cfg of o.configs) {
    const ct = now();
    main.fresh();
    const client = new SolverClient(main, "qa");
    const { players, stack, opts } = sessionOf(cfg);
    const base = fnv(`${o.seed}|${cfg.name}`);
    let heroDecisions = 0;
    let oppMoves = 0;
    const cfgViolations: K.Violation[] = [];
    const mark = { restarts: -1, rss: 0 };
    o.log(`\n[${o.label}] ${cfg.name}: ${players} players, ${stack}bb, ${cfg.hands} hands, ${cfg.mode}${opts.pfSolve ? ", preflop solve" : ""}\n`);
    const last = o.onlyHands?.length ? Math.max(...o.onlyHands) + 1 : cfg.hands;
    for (let n = 0; n < last; n++) {
      if (o.onlyHands?.length && !o.onlyHands.includes(n)) continue;
      const seed = (base + n * 7919) % 2147483647;
      // (each hand draws your moves and the opponents' from a stream of its own, so `--hand N` replays hand N alone, as the
      // whole config played it; one stream for the config made hand N depend on every hand before it)
      const rnd = seeded(fnv(`${o.seed}|${cfg.name}|${n}`) ^ 0x5bd1e995);
      let h = P.newHand(players, stack, n, seed, opts);
      const table: TableTag = { players, stack, opponents: h.opponents ?? "gto", pot: cfg.pot ?? "any", plain: !(cfg.rake || cfg.ante || cfg.straddle) };
      const tag = <X extends { street?: Street; seat?: string }>(x: X) => ({ config: cfg.name, seed: h.seed, hand: n, table, ...x });
      let tries = 0;
      let abandoned: string | null = null;
      let spent = false;
      for (let step = 0; step < 500 && !abandoned; step++) {
        const sim = P.simOf(h);
        if (P.offDrill(h, sim)) {
          if (P.dealsLeft(h)) {
            tries += 1;
            h = P.redeal(h, (seed + tries * 104729) % 2147483647, opts);
            continue;
          }
          spent = true;
          break;
        }
        const need = needOf(h, cfg.mode, sim);
        if (need.kind === "over") break;
        if (need.kind === "deal") {
          h = P.dealNext(h, need.street);
          continue;
        }
        if (need.kind !== "opp" && need.kind !== "you") {
          abandoned = `needOf asked for ${need.kind}, which one table never does`;
          cfgViolations.push(K.violation("flow.need", abandoned));
          break;
        }
        const street = need.street;
        const line = lineOf(h);
        if (need.kind === "opp") {
          // ---- an opponent's move (your own preflop in a drill too, played for you)
          const seat = need.play!.seat;
          const took = clock(main);
          const violations: K.Violation[] = [];
          let move: Move;
          let action: string;
          try {
            const r: SolveResult<PlayMove> = await client.play(need.state, { ...need.play!, seed: Math.floor(rnd() * 2147483647) }, { mode: cfg.mode });
            if (r.data.error) throw new Error(r.data.error);
            const m = moveOf(h, r.data, sim);
            move = m.move;
            action = r.data.name ?? r.data.action;
            if (m.fallback) violations.push(K.violation("opp.refused", `the table refused ${seat}'s ${JSON.stringify({ action: r.data.action, to: r.data.to })}: ${m.fallback}`));
          } catch (e) {
            violations.push(K.violation("answer.error", `${seat}'s move: ${message(e).slice(0, 400)}`));
            move = P.checkOrCall(h, sim);
            action = `(${move.action}: the answer failed)`;
          }
          if (crossed(main, mark)) violations.push(rssViolation(main));
          const flags = K.oppFlags(h, sim, seat, move);
          if (flags.freeFold) violations.push(K.violation("opp.freeFold", `${seat} folds where checking is free`));
          if (flags.riverNutFold) violations.push(K.violation("opp.nutFold", `${seat} folds the nuts on the river`, "soft"));
          if (flags.strongFold) violations.push(K.violation("opp.strongFold", `${seat} folds ${h.hands[seat]!.join("")}, two pair or better with its own cards, to at most 75% of the pot on the ${street}`, "soft"));
          oppMoves += 1;
          put({ t: "opp", ...tag({ street, seat }), line, secs: took(), rss: main.last.rss, action, flags, violations });
          h = P.withVillain(h, move, sim);
          continue;
        }
        // ---- your decision: the answer asked as the room asks it (and the preflop solve's node beside the chart's)
        const took = clock(main);
        const violations: K.Violation[] = [];
        let held: HeldAnswer | null = null;
        let pfSecs: number | undefined;
        try {
          const r = await client.solve({ state: need.state, mode: cfg.mode });
          if (need.pf && !r.data.error) {
            let pf: PfAsked;
            const pfTook = clock(main);
            try {
              pf = await client.solve({ state: need.pf, mode: cfg.mode, untimed: true });
            } catch (e) {
              pf = { failed: message(e) };
            }
            pfSecs = pfTook();
            held = { ...r, pf };
          } else held = r;
        } catch (e) {
          violations.push(K.violation("answer.error", `your ${street} answer failed: ${message(e).slice(0, 400)}`));
        }
        const secs = took();
        if (crossed(main, mark)) violations.push(rssViolation(main));
        const hero: Omit<HeroRecord, "source" | "graded" | "approximate" | "chose" | "verdict" | "violations"> = { t: "hero", ...tag({ street, seat: h.hero }), line, spot: spotOf(h, sim), mode: cfg.mode, secs, rss: main.last.rss, ...(pfSecs !== undefined ? { pfSecs } : {}) };
        if (held?.data.error) violations.push(K.violation("answer.error", `your ${street} answer is an error: ${String(held.data.error).slice(0, 300)}`));
        const actions = held && !held.data.error ? P.optionsOf(held.data) : [];
        if (held && !held.data.error && !actions.length) violations.push(K.violation("answer.empty", `your ${street} answer has no actions`));
        if (!held || held.data.error || !actions.length) {
          put({ ...hero, source: held?.provenance.source ?? "error", graded: "none", approximate: false, chose: "", verdict: null, violations });
          abandoned = "your answer failed";
          break;
        }
        const on = gradedOn(h, held, sim);
        const asked = on.data === held.data ? "advice" : "pf";
        const mix = P.gradable(P.mixOf(on.data), on.provenance);
        const pot = typeof on.data.pot_bb === "number" ? on.data.pot_bb : sim.pot;
        const basis = P.practiceBasis(on.data, on.provenance, sim);
        const t = P.setupOf(h);
        const gr = K.checkGrades(mix, pot, basis, evUnit(on.provenance));
        violations.push(...gr.violations);
        violations.push(...K.checkProvenance(on.data, on.provenance, basis, { asked, street }));
        if (asked === "pf" || on.pfWhy) violations.push(...K.checkProvenance(held.data, held.provenance, null, { asked: "advice", street }).map((x) => ({ ...x, detail: `the chart's answer: ${x.detail}` })));
        const pfNode = held.pf && "data" in held.pf && !held.pf.data.error ? held.pf : null;
        if (pfNode) violations.push(...K.checkProvenance(pfNode.data, pfNode.provenance, null, { asked: "pf", street }).map((x) => ({ ...x, detail: `the preflop solve's node: ${x.detail}` })));
        violations.push(...K.checkPot(on.data, t, sim, h.hero));
        if (street === "preflop") violations.push(...K.checkPreflop({ chart: held.data, graded: { mix, pot, basis, source: on.provenance.source }, pf: pfNode?.data ?? null, ownOptions: !!h.pfOptions }));
        if (cfg.mode === "quick" && secs > 15) violations.push(K.violation("perf.slow", `Quick took ${secs} s`, "soft"));
        // your move: mostly the graded answer's mix (in a preflop-solve session half the time the chart's, as its buttons
        // are), and now and then any option, so moves off the mix are graded too
        const u = rnd();
        const opts2 = P.optionsOf(on.data);
        const i =
          u < o.explore
            ? Math.min(opts2.length - 1, Math.floor(rnd() * opts2.length))
            : street === "preflop" && asked === "pf" && !h.pfOptions && u < o.explore + (1 - o.explore) / 2 && P.optionsOf(held.data).length === opts2.length
              ? draw(P.optionsOf(held.data).map((a) => a.freq ?? 0), rnd())
              : draw(opts2.map((a) => a.freq ?? 0), rnd());
        const d = P.decide(h, on.data, i, on.provenance, sim, on.pfWhy);
        if ("error" in d) {
          violations.push(K.violation("decide.error", `${opts2[i]?.action}: ${d.error}`));
          put({ ...hero, source: held.provenance.source, graded: on.provenance.source, approximate: on.provenance.approximate, chose: opts2[i]?.action ?? "", verdict: null, violations });
          abandoned = "decide failed";
          break;
        }
        violations.push(...K.checkDecided(d.decision, gr.grades[i]));
        const g = d.decision.grade;
        heroDecisions += 1;
        put({
          ...hero,
          source: held.provenance.source,
          graded: on.provenance.source,
          ...(on.provenance.band ? { band: on.provenance.band } : {}),
          ...(on.provenance.exploitabilityPct !== undefined ? { exploitabilityPct: on.provenance.exploitabilityPct } : {}),
          approximate: on.provenance.approximate,
          ...(on.provenance.approximateLabel ? { label: on.provenance.approximateLabel.slice(0, 240) } : {}),
          chose: d.decision.chose,
          verdict: g?.verdict ?? null,
          ...(g ? { loss: r3(g.loss), lossPct: r3(g.lossPct), byEv: g.byEv, ...(g.capped ? { capped: true } : {}) } : {}),
          ...(on.pfWhy ? { pfWhy: on.pfWhy } : {}),
          all: mix.map((x, k) => ({ action: x.action, freq: r3(x.freq), ev: x.ev === null ? null : r3(x.ev), verdict: gr.grades[k]!.verdict })),
          violations,
        });
        // a seeded share of your postflop Quick decisions asked again at Fast (and a few at Accurate) on the reference advisor
        if (street !== "preflop" && cfg.mode === "quick" && g && (left.fast > 0 || left.accurate > 0) && fnv(`${o.seed}|${cfg.name}|${n}|${step}`) / 2 ** 32 < o.refs.share) {
          const job = { base: { ...tag({ street }), line, spot: spotOf(h, sim), quickSource: on.provenance.source }, state: need.state, sim, chose: d.decision.chose, quick: { mix, grade: g, grades: gr.grades } };
          if (left.fast > 0) {
            left.fast -= 1;
            fastAsked += 1;
            jobs.push({ ...job, mode: "fast" });
          }
          if (left.accurate > 0 && (fastAsked % accEvery === 1 || accEvery === 1 || left.fast === 0)) {
            left.accurate -= 1;
            jobs.push({ ...job, mode: "accurate" });
          }
        }
        h = d.hand;
      }
      // ---- the hand's end, as the room's commit settles it
      const violations: K.Violation[] = [];
      if (spent) violations.push(K.violation("drill.spent", `no deal reached the ${cfg.pot} pot in ${tries + 1} deals`, "soft"));
      if (!abandoned && !spent && !h.result && P.phaseOf(h).kind === "over") h = { ...h, result: P.finish(h) };
      if (!spent) violations.push(...K.checkHand(h));
      put({ t: "hand", ...tag({}), net: h.result ? h.result.net : null, folded: !!h.result?.folded, shown: h.shown, decisions: h.decisions.length, tries, violations });
      const hard = violations.filter((x) => x.severity === "hard").length;
      o.log(`  hand ${n + 1}/${last} (seed ${h.seed}${tries ? `, ${tries} redeals` : ""}): ${h.decisions.length} decisions${h.result ? `, ${h.result.net}bb` : ""}${abandoned ? `, abandoned: ${abandoned}` : ""}${hard ? `, ${hard} hard` : ""} [${Math.round(now() - t0)} s, RSS ${main.peak} MB]\n`);
    }
    put({ t: "config", config: cfg.name, hands: o.onlyHands?.length || cfg.hands, heroDecisions, oppMoves, secs: r3(now() - ct), rssPeak: main.peak, restarts: main.restarts, waited: r3(main.waited), violations: cfgViolations });
  }
  main.close();
  const rt = now();
  o.log(`\n[${o.label}] ${jobs.length} reference answers (${jobs.filter((j) => j.mode === "fast").length} Fast, ${jobs.filter((j) => j.mode === "accurate").length} Accurate)\n`);
  for (const [k, j] of jobs.entries()) {
    await runRef(j);
    const r = records[records.length - 1] as RefRecord;
    o.log(`  ${k + 1}/${jobs.length} ${j.mode} ${j.base.street}: ${r.source}, ${r.cmp ? `${r.cmp.quick} / ${r.cmp.ref}` : "not compared"} (${r.secs} s) [${Math.round(now() - t0)} s, RSS ${refAdv.peak} MB]\n`);
  }
  put({ t: "config", config: "(reference advisor)", hands: 0, heroDecisions: 0, oppMoves: 0, secs: r3(now() - rt), rssPeak: refAdv.peak, restarts: refAdv.restarts, waited: r3(refAdv.waited), violations: [] });
  refAdv.close();
  const s = summarize(records, now() - t0, o.seed);
  writeFileSync(resolve(o.out, "summary.json"), JSON.stringify(s, null, 2) + "\n");
  writeFileSync(resolve(o.out, "summary.md"), markdown(s, `Practice QA sweep (${o.label}, seed ${o.seed})`));
  return s;
}
