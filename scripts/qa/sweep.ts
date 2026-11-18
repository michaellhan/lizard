// The Practice QA sweep (docs/QA.md): plays seeded Practice hands through the real web code (practice.ts newHand and
// decide, flow.ts needOf and moveOf, pfGrade.ts gradedOn, client.ts SolverClient with its modes and provenance) against
// advserver.py, the browser worker's Advisor run natively, and holds every decision, opponent's move and finished hand to
// the invariants in web/src/qa/checks.ts. Writes decisions.jsonl, summary.json and summary.md under qa-out/, and
// returns the summary; run.mjs exits non-zero where a hard invariant failed.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { kindOf as kindOfName } from "@/components/actions";
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

/** The project's memory rule for any one process (about 1 GB of RSS), MB. Each record keeps the process's physical
 * footprint beside its RSS: the RSS also counts pages it freed that the system hasn't taken back (advserver.py memory()). */
const RSS_RULE_MB = 1024;
/** The processes whose peak RSS passed RSS_RULE_MB since the last call, once each (`seen` follows one advisor: clear it
 * where `fresh` starts it over), by the record checked next: the request just answered, or one asked before it on the
 * same process (the hand's earlier requests asked again), or one a process answered before a restart took it away. The
 * worst of them, or null. */
const crossed = (adv: PyAdvisor, seen: Set<number>): { rss: number; mem: number } | null => {
  let worst: { rss: number; mem: number } | null = null;
  adv.procs.forEach((p, i) => {
    if (p.rss <= RSS_RULE_MB || seen.has(i)) return;
    seen.add(i);
    if (!worst || p.rss > worst.rss) worst = p;
  });
  return worst;
};
const rssViolation = (p: { rss: number; mem: number }) =>
  K.violation("perf.rss", `this request, or one asked before it for the hand's earlier streets, took the advisor's peak RSS to ${p.rss} MB (its physical footprint at most ${p.mem} MB), over the ~1 GB a process may use`, "soft");

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
  base: Omit<RefRecord, "t" | "mode" | "secs" | "source" | "cmp" | "all" | "violations" | "warmed" | "band" | "approximate" | "label" | "cold" | "evicted" | "outOfContext">;
  mode: "fast" | "accurate";
  state: AdvisorState;
  sim: Sim;
  chose: string;
  quick: { mix: P.Decision["mix"]; grade: Grade; grades: Grade[] };
  /** the streets Quick's answer narrowed by the betting rules (checks.ts rulesStreets) */
  quickRules: string[];
  /** the hand (config|hand) and this decision's place among the hand's postflop requests (HandRequest) */
  hand: string;
  at: number;
}

/** A postflop request the main process made in a hand, in order: an opponent's move or your decision. The reference asks a
 * hand's earlier ones again at its own speed before a decision of it (runRef), so it answers with the hand's earlier
 * streets solved as a player at that speed would have them: an answer stands on the solves its process holds from the
 * hand (a 3-way turn narrows the flop through your flop decision's solve, else by the rules), and a decision asked cold
 * is another question. */
type HandRequest = { kind: "solve"; state: AdvisorState } | { kind: "play"; state: AdvisorState; play: Parameters<SolverClient["play"]>[1] };

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
  // time, so the sweep holds one CPU slot, and the reference's cache is cold, not Quick's. The Fast ones go first, back to
  // back, and the Accurate ones after them in a fresh process: asked between Fast ones, an Accurate hand's solves pushed
  // the Fast hands' earlier streets out of the shared solve cache)
  const refAdv = new PyAdvisor("reference", limit, {}, o.log);
  const refClient = new SolverClient(refAdv, "qa");
  const left = { fast: o.refs.fast, accurate: o.refs.accurate };
  const accEvery = Math.max(1, Math.floor(o.refs.fast / Math.max(1, o.refs.accurate)));
  const jobs: RefJob[] = [];
  let fastAsked = 0;

  const refSeen = new Set<number>();
  const handReqs = new Map<string, HandRequest[]>();
  /** each hand's boards asked, for the hands a drop names (checks.ts handsOn) */
  const boardsOf = (only?: string) => new Map([...handReqs.entries()].filter(([k]) => only === undefined || k === only).map(([k, rs]) => [k, rs.map((q) => q.state.board ?? "")] as const));
  // (how far the reference process has been asked each hand at each speed: the requests before it; gone with a restart,
  // and a hand's gone where the process's solve cache evicted a 3-way solve of one of its streets (advserver.py `dropped`):
  // a later street is narrowed through that solve, else by the rules)
  const warm = { restarts: -1, done: new Map<string, number>() };
  const doneOf = (j: RefJob) => {
    if (warm.restarts !== refAdv.restarts) warm.done.clear(), (warm.restarts = refAdv.restarts);
    return warm.done.get(`${j.hand}|${j.mode}`) ?? 0;
  };
  /** Forget the hands the last request's evictions name; whether `hand` is one of them. */
  const forget = (hand: string): boolean => {
    const gone = K.handsOn(refAdv.last.dropped, boardsOf());
    for (const k of gone) for (const m of ["fast", "accurate"]) warm.done.delete(`${k}|${m}`);
    return gone.includes(hand);
  };
  const warmUp = async (j: RefJob): Promise<number> => {
    const reqs = handReqs.get(j.hand) ?? [];
    let asked = 0;
    for (let tries = 0; tries < 2 && doneOf(j) < j.at; tries++) {
      for (let i = doneOf(j); i < j.at; i++) {
        const q = reqs[i]!;
        try {
          if (q.kind === "play") await refClient.play(q.state, q.play, { mode: j.mode });
          else await refClient.solve({ state: q.state, mode: j.mode });
        } catch {
          // (an earlier request that fails leaves its street unsolved, as it would in the page)
        }
        asked += 1;
        // (a restart during the request: the process holds none of the hand, so start it again; an eviction of one of
        // the hand's streets: the same, from its start)
        if (warm.restarts !== refAdv.restarts) break;
        if (forget(j.hand)) break;
        warm.done.set(`${j.hand}|${j.mode}`, i + 1);
      }
    }
    return asked;
  };
  const runRef = async (j: RefJob) => {
    let warmed = 0;
    let secs = 0;
    let cold = false;
    let evicted = false;
    let lostOwn = false;
    let outside: string[] = [];
    const violations: K.Violation[] = [];
    let prov: Pick<RefRecord, "band" | "approximate" | "label"> = {};
    let source = "error";
    let cmp: RefRecord["cmp"] = null;
    let all: RefRecord["all"];
    try {
      let r!: SolveResult;
      // (a process that restarts for the answer itself holds none of the hand: warm it again and ask again, once; so where
      // the warm-up didn't hold, two restarts or evictions of the hand's streets on the way. An eviction by the answer
      // itself comes after the hand's earlier streets were read (a solve is kept once it's made), so only the hand's later
      // answers are asked again for it)
      for (let tries = 0; tries < 2; tries++) {
        warmed += await warmUp(j);
        const held = doneOf(j) >= j.at;
        const before = refAdv.restarts;
        const took = clock(refAdv);
        try {
          r = await refClient.solve({ state: j.state, mode: j.mode });
        } finally {
          secs = took();
        }
        lostOwn = forget(j.hand);
        cold = j.at > 0 && refAdv.restarts !== before;
        evicted = j.at > 0 && !cold && !held;
        if (!cold && !evicted) break;
      }
      if (r.data.error) violations.push(K.violation("ref.error", `the ${j.mode} reference answered with an error: ${r.data.error}`, "soft"));
      else {
        source = r.provenance.source;
        prov = { ...(r.provenance.band ? { band: r.provenance.band } : {}), approximate: r.provenance.approximate, ...(r.provenance.approximateLabel ? { label: r.provenance.approximateLabel.slice(0, 240) } : {}) };
        const mix = P.gradable(P.mixOf(r.data), r.provenance);
        const pot = typeof r.data.pot_bb === "number" ? r.data.pot_bb : j.sim.pot;
        const basis = P.practiceBasis(r.data, r.provenance, j.sim);
        cmp = K.compareRef(j.chose, j.quick, { mix, pot, basis });
        all = K.compareAll(j.quick, { mix, pot, basis });
        outside = K.outOfContext(j.quickRules, K.rulesStreets(r.data));
        // (a reference that stood on less of the hand than Quick did answers another question: noted, not compared)
        const context = cold ? "asked cold (its process restarted)" : evicted ? "its process lost the hand's earlier streets (evicted)" : outside.length ? `it narrowed the ${outside.join(", ")} by the rules where Quick had a solve` : "";
        if (context) violations.push(K.violation("ref.context", `the ${j.mode} reference is out of the hand's context: ${context}; its verdicts aren't counted`, "soft"));
        else if (!cmp) violations.push(K.violation("ref.missing", `the ${j.mode} reference has no ${j.chose}`, "soft"));
        else if (cmp.condemns) violations.push(K.violation("ref.condemns", `Quick says ${cmp.quick} for ${cmp.action} (${cmp.quickFreq}, EV ${cmp.quickEv}), ${j.mode} says ${cmp.ref} (${cmp.refFreq}, EV ${cmp.refEv})`, "soft"));
        else if (cmp.passes) violations.push(K.violation("ref.passes", `Quick says ${cmp.quick} for ${cmp.action} (${cmp.quickFreq}, EV ${cmp.quickEv}), ${j.mode} says ${cmp.ref} (${cmp.refFreq}, EV ${cmp.refEv})`, "soft"));
      }
    } catch (e) {
      violations.push(K.violation("ref.error", `the ${j.mode} reference failed: ${message(e).slice(0, 300)}`, "soft"));
    }
    const over = crossed(refAdv, refSeen);
    if (over) violations.push(rssViolation(over));
    // (the reference's own request is the one asked last: its done is past it)
    if (warm.restarts === refAdv.restarts && !evicted && !lostOwn) warm.done.set(`${j.hand}|${j.mode}`, Math.max(doneOf(j), j.at + 1));
    put({ t: "ref", ...j.base, mode: j.mode, secs, rss: refAdv.last.rss, mem: refAdv.last.mem, source, ...prov, warmed, ...(cold ? { cold } : {}), ...(evicted ? { evicted } : {}), ...(outside.length ? { outOfContext: outside } : {}), cmp, ...(all ? { all } : {}), violations });
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
    const seen = new Set<number>();
    const reqsOf = (n: number): HandRequest[] => {
      const k = `${cfg.name}|${n}`;
      if (!handReqs.has(k)) handReqs.set(k, []);
      return handReqs.get(k)!;
    };
    // (the main process said goodbye mid-hand (its RSS cap), or its solve cache evicted a 3-way solve of one of the hand's
    // streets (advserver.py `dropped`): ask the hand's earlier postflop requests again first, so the next answer stands on
    // the hand's earlier streets as the page's own process would have them. The page's worker keeps 700 MB of solves, not
    // 150, and restarts only where it fails or is stopped (worker-transport.ts endWorker))
    const lost = (n: number) => K.handsOn(main.last.dropped, boardsOf(`${cfg.name}|${n}`)).length > 0;
    let lostHand = -1;
    /** The hand's earlier requests asked again where they're gone: how many, and whether the process holds them after
     * (false: twice a restart or an eviction on the way, so the next answer stands on less of the hand, `evicted`). */
    const keep = async (n: number): Promise<{ kept: number; held: boolean }> => {
      const reqs = reqsOf(n);
      let asked = 0;
      for (let tries = 0; tries < 2 && reqs.length && (!main.alive || lostHand === n); tries++) {
        lostHand = -1;
        for (const q of reqs) {
          try {
            if (q.kind === "play") await client.play(q.state, q.play, { mode: cfg.mode });
            else await client.solve({ state: q.state, mode: cfg.mode });
          } catch {
            // (as the page's: a request that fails leaves its street unsolved)
          }
          asked += 1;
          if (!main.alive) break;
          if (lost(n)) {
            lostHand = n;
            break;
          }
        }
      }
      const held = !reqs.length || (main.alive && lostHand !== n);
      lostHand = -1;
      return { kept: asked, held };
    };
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
          const violations: K.Violation[] = [];
          let move: Move;
          let action: string;
          const play = { ...need.play!, seed: Math.floor(rnd() * 2147483647) };
          const { kept, held: inHand } = street !== "preflop" ? await keep(n) : { kept: 0, held: true };
          if (street !== "preflop") reqsOf(n).push({ kind: "play", state: need.state, play });
          const took = clock(main);
          try {
            const r: SolveResult<PlayMove> = await client.play(need.state, play, { mode: cfg.mode });
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
          const over = crossed(main, seen);
          if (over) violations.push(rssViolation(over));
          if (street !== "preflop" && lost(n)) lostHand = n;
          const flags = K.oppFlags(h, sim, seat, move);
          if (flags.freeFold) violations.push(K.violation("opp.freeFold", `${seat} folds where checking is free`));
          if (flags.riverNutFold) violations.push(K.violation("opp.nutFold", `${seat} folds the nuts on the river`, "soft"));
          if (flags.strongFold) violations.push(K.violation("opp.strongFold", `${seat} folds ${h.hands[seat]!.join("")}, two pair or better with its own cards, to at most 75% of the pot on the ${street}`, "soft"));
          oppMoves += 1;
          // (the move made, which a live or loose opponent picks over the answer's draw: live.ts liveMove; the draw kept
          // beside it where they differ)
          const made = `${move.action}${typeof move.to === "number" && move.action !== "call" ? ` ${move.to}` : ""}`;
          const drawn = action.startsWith("(") || kindOfName(action) === move.action ? {} : { drawn: action };
          put({ t: "opp", ...tag({ street, seat }), ...(kept ? { kept } : {}), ...(!inHand ? { evicted: true } : {}), line, secs: took(), rss: main.last.rss, mem: main.last.mem, action: action.startsWith("(") ? action : made, ...drawn, flags, violations });
          h = P.withVillain(h, move, sim);
          continue;
        }
        // ---- your decision: the answer asked as the room asks it (and the preflop solve's node beside the chart's)
        const { kept, held: inHand } = street !== "preflop" ? await keep(n) : { kept: 0, held: true };
        const at = reqsOf(n).length;
        if (street !== "preflop") reqsOf(n).push({ kind: "solve", state: need.state });
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
        const over = crossed(main, seen);
        if (over) violations.push(rssViolation(over));
        if (street !== "preflop" && lost(n)) lostHand = n;
        const hero: Omit<HeroRecord, "source" | "graded" | "approximate" | "chose" | "verdict" | "violations"> = { t: "hero", ...tag({ street, seat: h.hero }), ...(kept ? { kept } : {}), ...(!inHand ? { evicted: true } : {}), line, spot: spotOf(h, sim), mode: cfg.mode, secs, rss: main.last.rss, mem: main.last.mem, ...(pfSecs !== undefined ? { pfSecs } : {}) };
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
          const job = { base: { ...tag({ street }), line, spot: spotOf(h, sim), quickSource: on.provenance.source }, state: need.state, sim, chose: d.decision.chose, quick: { mix, grade: g, grades: gr.grades }, quickRules: K.rulesStreets(on.data), hand: `${cfg.name}|${n}`, at };
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
      o.log(`  hand ${n + 1}/${last} (seed ${h.seed}${tries ? `, ${tries} redeals` : ""}): ${h.decisions.length} decisions${h.result ? `, ${h.result.net}bb` : ""}${abandoned ? `, abandoned: ${abandoned}` : ""}${hard ? `, ${hard} hard` : ""} [${Math.round(now() - t0)} s, RSS ${main.peak} MB, held ${main.memPeak} MB]\n`);
    }
    put({ t: "config", config: cfg.name, hands: o.onlyHands?.length || cfg.hands, heroDecisions, oppMoves, secs: r3(now() - ct), rssPeak: main.peak, memPeak: main.memPeak, restarts: main.restarts, waited: r3(main.waited), violations: cfgViolations });
  }
  main.close();
  o.log(`\n[${o.label}] ${jobs.length} reference answers (${jobs.filter((j) => j.mode === "fast").length} Fast, ${jobs.filter((j) => j.mode === "accurate").length} Accurate)\n`);
  let k = 0;
  for (const mode of ["fast", "accurate"] as const) {
    const these = jobs.filter((j) => j.mode === mode);
    if (!these.length) continue;
    // (each speed in a process of its own, its cache and its peak its own)
    refAdv.fresh();
    warm.done.clear();
    warm.restarts = -1;
    refSeen.clear();
    const rt = now();
    for (const j of these) {
      await runRef(j);
      const r = records[records.length - 1] as RefRecord;
      o.log(`  ${++k}/${jobs.length} ${j.mode} ${j.base.street}: ${r.source}, ${r.cmp ? `${r.cmp.quick} / ${r.cmp.ref}` : "not compared"}${r.cold ? " (cold)" : r.evicted ? " (evicted)" : r.outOfContext ? ` (out of context: ${r.outOfContext.join(", ")})` : ""} (${r.secs} s) [${Math.round(now() - t0)} s, RSS ${refAdv.peak} MB, held ${refAdv.memPeak} MB]\n`);
    }
    put({ t: "config", config: `(reference advisor, ${mode === "fast" ? "Fast" : "Accurate"})`, hands: 0, heroDecisions: 0, oppMoves: 0, secs: r3(now() - rt), rssPeak: refAdv.peak, memPeak: refAdv.memPeak, restarts: refAdv.restarts, waited: r3(refAdv.waited), violations: [] });
  }
  refAdv.close();
  const s = summarize(records, now() - t0, o.seed);
  writeFileSync(resolve(o.out, "summary.json"), JSON.stringify(s, null, 2) + "\n");
  writeFileSync(resolve(o.out, "summary.md"), markdown(s, `Practice QA sweep (${o.label}, seed ${o.seed})`));
  return s;
}
