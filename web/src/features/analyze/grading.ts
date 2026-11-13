// Your imported decisions graded against the Advisor's answer for your hand, as the classic analyzer does it
// (solver/gto/static/session.js classify / processItem, index.html payload / gradeWith / gradedMove / jamOffTree), at
// five scopes. Two solve nothing: preflop, and flops from the precomputed library ("library_only": a flop the library
// doesn't hold is skipped, never solved). Two reach every street: Quick triage ("triage": what's in hand first, else a
// Quick solve; each read says how far to trust it, and triage.ts checks the doubtful ones at Fast), Fast and Accurate. The betting
// rules and equity guesses are never graded against, at any scope. The grade is Lizard's one scale (grading/grade.ts): by
// EV where the answer has EVs for every action, by frequency where it hasn't (the charts; a read at once).
// Preflop at every scope: in a game the preflop solve is stored for, by EV against that solve wherever it holds the spot
// (the file Practice reads, read and never run), under its own label; anywhere else against the charts, by frequency, with
// `pfWhy` saying why. A hand played in Practice is read by the table's own rule (pfGrade.ts pfReadAt), so one decision
// has one grade. Any other game is asked what it always was.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { PRACTICE_SITE } from "@/data/hands";
import { pfPlayed, pfReadAt, type PfAsked, type PfSpot } from "@/features/practice/pfGrade";
import { pfBlocked } from "@/features/practice/practice";
import { capGrade, grade, type Grade, type Verdict } from "@/grading/grade";
import { versionOf } from "@/grading/version";
import { importHand, type ReplayedHand } from "@/hh/replay";
import { simulate, type Lines, type Move, type Street } from "@/poker/table";
import type { AdvisorActionStat, AdvisorResponse, AdvisorState, OffSolution } from "@/solver/protocol";
import { describe as describeProvenance } from "@/solver/provenance";
import { SolverError, type Provenance, type ResultSource } from "@/solver/types";
import { heroDecisions, potType, preflopRaises, preflopSituation, STREETS } from "./analyze";

const NEED: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const EPS = 1e-9;
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => String(r2(x));
const AGGRESSIVE: ReadonlySet<string> = new Set(["bet", "raise", "all-in"]);

export type GradeScope = "preflop" | "library" | "triage" | "all" | "accurate";
export const SCOPES: Record<GradeScope, string> = {
  preflop: "Preflop only",
  library: "Preflop and stored flops (instant)",
  triage: "Every street, Quick reads, doubtful ones checked at Fast (recommended)",
  all: "Every street, Fast solves (slower)",
  accurate: "Every street, Accurate solves (slowest)",
};
/** The streets each scope grades. */
const SCOPE_STREETS: Record<GradeScope, readonly Street[]> = { preflop: ["preflop"], library: ["preflop", "flop"], triage: STREETS, all: STREETS, accurate: STREETS };
/** The answers a grade may stand on: without a solve the charts and the library, with one a stored turn, a read at
 * once or the solve too. Never the betting rules or an equity guess. */
const NOTHING_SOLVED: readonly ResultSource[] = ["charts", "push-fold", "library", "preflop-solve"];
const SOLVING: readonly ResultSource[] = [...NOTHING_SOLVED, "library-turn", "instant", "live"];
const GRADED_SOURCES: Record<GradeScope, readonly ResultSource[]> = { preflop: NOTHING_SOLVED, library: NOTHING_SOLVED, triage: SOLVING, all: SOLVING, accurate: SOLVING };

export type DecisionVerdict = Verdict | "Not graded";

/** The decisions of yours in a hand a scope grades: the street and the action's index there. `playedFor`, `revealed`: the
 * record's, as a move Practice played for you is no decision of yours to grade, nor is one you made having seen the answer. */
export const decisionsIn = (r: Pick<ReplayedHand, "lines" | "hand">, scope: GradeScope, playedFor?: HandRecord["playedFor"], revealed?: HandRecord["revealed"]) =>
  heroDecisions(r).filter((d) => SCOPE_STREETS[scope].includes(d.street) && d.street !== playedFor && !revealed?.includes(`${d.street}|${d.i}`));

export const decisionId = (handId: string, street: Street, i: number) => `${handId}|${street}|${i}`;

/** The lines up to one of your decisions: the streets before it, its own actions before it. */
function linesBefore(r: ReplayedHand, street: Street, i: number): Lines {
  const k = STREETS.indexOf(street);
  const at = (s: Street) => (STREETS.indexOf(s) < k ? r.lines[s] : s === street ? r.lines[s].slice(0, i) : []);
  return { preflop: at("preflop"), flop: at("flop"), turn: at("turn"), river: at("river") };
}

/** The pot at one of your decisions, bb, from the hand alone: what's said where the answer gave none. */
export const potBefore = (r: ReplayedHand, street: Street, i: number) => r2(simulate(r.setup, linesBefore(r, street, i), NEED[street]).pot);

/** The Advisor's request at one of your decisions, as the classic page sends it (payload()): your seat, cards and
 * stack, every seat's own stack where they differ, the ante and the straddle, the actions before it; what the scope
 * adds (session.js processItem): a flop that asks the library only, or "triage". `kept`: what a Practice hand's record
 * holds beyond its history. Its rake goes with the question: a history shows an amount, not the percentage and cap, so
 * only a hand played here can say. */
export function adviceStateAt(r: ReplayedHand, street: Street, i: number, scope: GradeScope = "library", kept?: HandRecord["setup"]): AdvisorState {
  const h = r.hand;
  const lines = linesBefore(r, street, i);
  const conv = (ms: readonly Move[]) =>
    ms.map((m) =>
      m.action === "bet" ? { pos: m.pos, action: "bet", amount: m.to } : m.action === "raise" ? { pos: m.pos, action: "raise", to: m.to } : { pos: m.pos, action: m.action },
    );
  const stacks = r.setup.stacks;
  const own = stacks[h.hero] ?? h.stack;
  const unequal = Object.values(stacks).some((v) => Math.abs(v - own) > EPS);
  return {
    players: h.players,
    hero: h.hero,
    hole: h.hole.join(""),
    board: h.board.slice(0, NEED[street]).join(""),
    stack: own,
    ...(unequal ? { stacks: { ...stacks } } : {}),
    ...(h.ante > 0 ? { ante: h.ante } : {}),
    ...(h.straddle ? { straddle: true } : {}),
    ...(kept?.rake ? { rake: Math.round(kept.rake * 10) / 1000, ...(kept.rakeCap ? { rake_cap: kept.rakeCap } : {}) } : {}),
    preflop: conv(lines.preflop),
    flop: conv(lines.flop),
    turn: conv(lines.turn),
    river: conv(lines.river),
    ...(scope === "triage" ? { triage: true } : scope !== "all" && scope !== "accurate" && street === "flop" ? { library_only: true } : {}),
  };
}

/** The move your action is graded as: an all-in that puts in no more than anyone left can match (a stack that
 * doesn't cover the call, or nobody else with chips behind the bet) is a call, or a check, as the answers list it. */
export function gradedMove(r: ReplayedHand, street: Street, i: number): Move {
  const m = r.lines[street][i]!;
  if (m.action !== "all-in") return m;
  const sim = simulate(r.setup, linesBefore(r, street, i), NEED[street]);
  const info = sim.cur;
  if (!info) return m;
  const left = (q: string) => (r.setup.stacks[q] ?? 0) - (sim.invested[q] ?? 0);
  const cover = Math.max(0, ...[...sim.active].filter((q) => q !== m.pos).map(left));
  if (Math.min(left(m.pos), cover) > info.curBet + EPS) return m;
  return { pos: m.pos, action: info.curBet - (info.bets[m.pos] ?? 0) > EPS ? "call" : "check" };
}

/** What you did, in words ("raise to 2.5", "bet 1.8"). */
export const moveLabel = (m: Move) => (m.action === "bet" ? `bet ${fmt(m.to ?? 0)}` : m.action === "raise" ? `raise to ${fmt(m.to ?? 0)}` : m.action);

/** The decision's situation: preflop, as the classic analyzer names it ("RFI", "vs 3bet"); after the flop, the pot,
 * your position and what you face ("SRP · IP · checked to"). */
export function situationAt(
  r: ReplayedHand,
  street: Street,
  i: number,
): { situation: string; potType: string; facing: boolean; ip?: boolean; multi?: boolean } {
  const hero = r.hand.hero;
  const before = linesBefore(r, street, i);
  const sim = simulate(r.setup, before, NEED[street]);
  const info = sim.cur;
  const facing = !!info && info.curBet - (info.bets[hero] ?? 0) > EPS;
  const pre = simulate(r.setup, { ...r.lines, flop: [], turn: [], river: [] }, 0);
  const pt = potType(pre.streets.preflop?.nRaises ?? 0);
  if (street === "preflop") return { situation: preflopSituation(before.preflop, hero), potType: pt, facing };
  const live = (info?.order ?? []).filter((p) => sim.active.has(p));
  const ip = live.at(-1) === hero;
  const multi = live.length > 2;
  return { situation: `${multi ? "Multiway" : pt} · ${ip ? "IP" : "OOP"} · ${facing ? "facing bet" : ip ? "checked to" : "first to act"}`, potType: pt, facing, ip, multi };
}

/** Why the ranges behind an answer aren't all the solve's (index.html offText); null where they are. */
export function offText(res: AdvisorResponse): string | null {
  const off = Array.isArray(res.off_solution) ? res.off_solution : [];
  const one = (o: OffSolution) =>
    o.why === "rare"
      ? `${o.pos}'s ${o.action} on the ${o.street} is ${(o.share ?? 0) < 0.5 ? "never" : `only ${o.share}%`} in the solve, so their range from there is the betting rules'${o.resolved ? " and the play after it is solved again from there" : ""}`
      : o.why === "filled"
        ? o.street === "preflop"
          ? `${o.pos}'s preflop line isn't in the charts, so their range is the hands that take its last action`
          : `${o.pos}'s ${o.street} line left ${o.combos} combos, so their range is filled out with the rest of their ${o.street} range`
        : o.why === "rules"
          ? `the ${o.street} is narrowed by the betting rules, not solved`
          : `the ${o.street} solve hadn't settled, so ranges follow it ${o.trust}% and the betting rules the rest`;
  return off.length ? [...new Set(off.map(one))].join("; ") : null;
}

/** Your role after the flop: the last preflop raiser, a caller of it, or a limped pot. */
export function roleOf(r: ReplayedHand): "PFR" | "caller" | "limped" {
  const { raises } = preflopRaises(r.lines.preflop);
  const pfr = raises.at(-1);
  return pfr === r.hand.hero ? "PFR" : pfr ? "caller" : "limped";
}

const isRaise = (a: AdvisorActionStat) => /^(bet|raise)/.test(a.action) && typeof a.amount_bb === "number";

/** Your move among the answer's actions (index.html gradeWith): the same action; a bet or raise as the nearest of
 * the answer's sizes (after the flop the all-in counts as one); preflop, a move the chart leaves out (an open-limp,
 * the small blind completing) as played 0%, a jam it doesn't list as its raise. `actions` is the answer's, with such
 * a 0% move added at the end; `note` says when your move was graded as another. null where it isn't in the answer. */
export function matchMove(res: AdvisorResponse, m: Move): { actions: AdvisorActionStat[]; index: number; note?: string } | null {
  const acts = Array.isArray(res.actions) ? res.actions : [];
  const pre = res.street === "preflop";
  const at = (a: AdvisorActionStat | undefined, note?: string) => (a ? { actions: acts, index: acts.indexOf(a), ...(note ? { note } : {}) } : null);
  const zero = (action: string) => ({ actions: [...acts, { action, freq: 0 }], index: acts.length });
  if (m.action === "fold" || m.action === "check" || m.action === "call" || m.action === "all-in") {
    const same = acts.find((a) => a.action === m.action);
    if (same) return at(same);
    if (!pre) return null;
    const raises = acts.filter(isRaise);
    if (m.action === "all-in" && raises.length) return at(raises.reduce((b, a) => (a.amount_bb! > b.amount_bb! ? a : b)), "your all-in, graded as the chart's raise");
    return zero(m.action);
  }
  const to = m.to ?? 0;
  const agg = acts.filter((a) => isRaise(a) || (!pre && a.action === "all-in" && typeof a.amount_bb === "number"));
  if (agg.length) {
    const near = agg.reduce((b, a) => (Math.abs(a.amount_bb! - to) < Math.abs(b.amount_bb! - to) ? a : b));
    // (said where the sizes are far apart: a history's sizes seldom match the answer's to the cent)
    const far = Math.abs(near.amount_bb! - to) > Math.max(0.5, 0.25 * near.amount_bb!);
    const note = near.action === "all-in" ? `your ${moveLabel(m)}, graded as the all-in` : far ? `your ${moveLabel(m)}, graded as ${near.action} (${fmt(near.amount_bb!)})` : undefined;
    return at(near, note);
  }
  if (!pre) return null;
  const jam = acts.find((a) => a.action === "all-in");
  return jam ? at(jam, `your ${moveLabel(m)}, graded as the chart's all-in`) : zero(moveLabel(m));
}

/** A postflop all-in the answer has no all-in for: asked again with "jam": true (index.html jamOffTree). */
export const jamOffTree = (res: AdvisorResponse, m: Move) =>
  m.action === "all-in" && res.street !== "preflop" && Array.isArray(res.actions) && !res.actions.some((a) => a.action === "all-in");

/** The grade of your move against an answer, with the mix it is graded against; null where the move isn't in it, or
 * where an answer with EVs gives no pot: EV lost is graded as a share of the pot, and against none every loss would
 * read as an Inaccuracy, however large. */
export function gradeAgainst(res: AdvisorResponse, m: Move): { grade: Grade; mix: [string, number, number | null][]; matched: string; note?: string; pot: number; roughEv?: boolean; roughEvs?: string[] } | null {
  const hit = matchMove(res, m);
  if (!hit) return null;
  const freqs = hit.actions.map((a) => a.freq ?? 0);
  const evList = hit.actions.map((a) => (typeof a.ev_bb === "number" ? a.ev_bb : null));
  const evs = evList.every((x) => x !== null) ? (evList as number[]) : null;
  const pot = typeof res.pot_bb === "number" ? res.pot_bb : 0;
  if (evs && !(pot > 0)) return null;
  const g = grade({ freqs, evs, pot }, hit.index);
  const rough = hit.actions.filter((a) => a.rough_ev).map((a) => a.action);
  return {
    grade: g,
    mix: hit.actions.map((a, k) => [a.action, freqs[k]!, evList[k]!]),
    matched: hit.actions[hit.index]!.action,
    ...(hit.note ? { note: hit.note } : {}),
    pot,
    ...(g.byEv && hit.actions[hit.index]!.rough_ev ? { roughEv: true } : {}),
    ...(g.byEv && rough.length ? { roughEvs: rough } : {}),
  };
}

/** Asks the solver for one state (the page's SolverClient.solve, with its provenance). */
export type Ask = (state: AdvisorState) => Promise<{ data: AdvisorResponse; provenance: Provenance }>;

/** Why a hand's game isn't one the preflop solve is stored for, in words; null where it is. A site's history says no rake
 * or cap (`adviceStateAt`), so it's asked as the game with none, and a decision says so (`PF_NO_RAKE`). */
export function pfOut(hand: Pick<HandRecord, "tournament" | "setup">, r: Pick<ReplayedHand, "hand" | "setup">): string | null {
  const h = r.hand;
  if (hand.tournament !== undefined) return "A tournament's stacks and prizes aren't the game the preflop solve is stored for.";
  if (r.setup.limit === "pot" || h.hole.length !== 2) return "The preflop solve is of no-limit hold'em.";
  if (Object.values(r.setup.stacks).some((v) => Math.abs(v - h.stack) > EPS)) return "The preflop solve is stored for equal stacks only.";
  const { sizes, rake = 0, rakeCap = 0 } = hand.setup ?? {};
  return pfBlocked(h.players, h.stack, { ante: h.ante, straddle: !!h.straddle, sizes, rake, rakeCap });
}

/** What a site's hand graded by the solve says with it. */
export const PF_NO_RAKE = "this history doesn't say its rake or cap, so it's read against the stored game with no rake";

/** The stored solve's node at a decision: read and never run, as the request has no `run` (Advisor._study_pf). Anything but
 * a stop leaves the chart's grade, with why. */
async function askPf({ triage: _t, library_only: _l, ...state }: AdvisorState, ask: Ask): Promise<PfAsked> {
  try {
    const a = await ask({ ...state, study: true, preflop_solve: true });
    if (a.data.cancelled) throw new SolverError("cancelled", "cancelled");
    return a;
  } catch (e) {
    if (e instanceof SolverError && e.kind === "cancelled") throw e;
    return { failed: e instanceof Error ? e.message : String(e) };
  }
}

type Earlier = Pick<DecisionRecord, "ownBet" | "flopAggr" | "turnAggr" | "firstIn" | "callers" | "ownCheck">;

/** What you'd done earlier in the hand, kept with a decision for the rows that need it (report.ts FREQS): a decision is
 * graded alone. On the flop, whether you'd bet or raised it already (a bet faced is then a raise of yours) and whether
 * your first move on it was a check (the check-raise); on the turn and river, whether you bet or raised the flop, and on
 * the river the turn (the barrels); preflop, whether this was your first decision (VPIP and PFR against the answer) and
 * how many called the one raise before you (a squeeze, the blinds' too: their situation says "BB defence" either way). */
export function earlierAt(r: ReplayedHand, street: Street, i: number): Earlier {
  const pos = r.lines[street][i]?.pos;
  if (!pos) return {};
  const aggr = (s: Street, upTo?: number) => r.lines[s].slice(0, upTo).some((a) => a.pos === pos && AGGRESSIVE.has(a.action));
  if (street === "preflop") {
    const before = r.lines.preflop.slice(0, i);
    const { raises, callers } = preflopRaises(before);
    return { firstIn: !before.some((a) => a.pos === pos), callers: raises.length === 1 ? callers : 0 };
  }
  if (street === "flop") return { ...(aggr("flop", i) ? { ownBet: true } : {}), ownCheck: r.lines.flop.slice(0, i).find((a) => a.pos === pos)?.action === "check" };
  if (street === "turn") return { flopAggr: aggr("flop") };
  return { flopAggr: aggr("flop"), turnAggr: aggr("turn") };
}

/** A grade kept before earlierAt's facts were (2026-11-09): it lacks its street's. */
export const lacksEarlier = (d: Pick<DecisionRecord, "street" | "firstIn" | "callers" | "ownCheck" | "turnAggr">) =>
  d.street === "preflop" ? d.firstIn === undefined || d.callers === undefined : d.street === "flop" ? d.ownCheck === undefined : d.street === "river" ? d.turnAggr === undefined : false;

/** Grades kept before earlierAt's facts were, given them from their hands' histories (nothing is asked of the solver), a
 * chunk of hands at a time so a large database doesn't hold the page. Returns the grades it changed; a hand that no
 * longer reads, or a move not in it, is left as it was. */
export async function fillEarlier(
  ds: readonly DecisionRecord[],
  hands: ReadonlyMap<string, Pick<HandRecord, "text">>,
  opts: { signal?: AbortSignal; chunk?: number } = {},
): Promise<DecisionRecord[]> {
  const byHand = new Map<string, DecisionRecord[]>();
  for (const d of ds) if (lacksEarlier(d) && hands.has(d.handId)) byHand.set(d.handId, [...(byHand.get(d.handId) ?? []), d]);
  const out: DecisionRecord[] = [];
  let k = 0;
  for (const [id, its] of byHand) {
    if (opts.signal?.aborted) break;
    let r: ReplayedHand | null;
    try {
      r = importHand(hands.get(id)!.text);
    } catch {
      r = null;
    }
    for (const d of r ? its : []) {
      // (the move's index on its street: its own, or, kept before that was, its id's last part)
      const i = d.i ?? Number(d.id.slice(d.id.lastIndexOf("|") + 1));
      const m = Number.isInteger(i) ? r!.lines[d.street as Street]?.[i] : undefined;
      if (!m || m.pos !== d.pos) continue;
      out.push({ ...d, ...earlierAt(r!, d.street as Street, i) });
    }
    if (++k % (opts.chunk ?? 200) === 0) await new Promise((res) => setTimeout(res, 0));
  }
  return out;
}

/** One of your decisions graded, as kept: the grade and what it stands on, or why it isn't graded. */
export async function gradeDecision(
  hand: Pick<HandRecord, "id" | "setup"> & Partial<Pick<HandRecord, "site" | "tournament">>,
  r: ReplayedHand,
  street: Street,
  i: number,
  ask: Ask,
  now = Date.now(),
  scope: GradeScope = "library",
): Promise<DecisionRecord> {
  const played = r.lines[street][i]!;
  const m = gradedMove(r, street, i);
  const sit = situationAt(r, street, i);
  const base = {
    id: decisionId(hand.id, street, i),
    handId: hand.id,
    street,
    i,
    pos: played.pos,
    action: moveLabel(played),
    situation: sit.situation,
    potType: sit.potType,
    facing: sit.facing,
    ...(street === "preflop" ? {} : { ip: sit.ip, multi: sit.multi, role: roleOf(r) }),
    ...earlierAt(r, street, i),
    pot: potBefore(r, street, i),
    gradedAt: now,
  };
  // (a triage answer without a mark, an error's, reads as low, as the classic analyzer takes it)
  const read = (res: AdvisorResponse) =>
    scope === "triage" ? { confidence: res.triage?.confidence ?? ("low" as const), ...(res.triage?.source ? { triageSource: res.triage.source } : {}) } : {};
  const ungraded = (why: string, source = "", label = "", tri = {}): DecisionRecord => ({
    ...base,
    ...tri,
    verdict: "Not graded",
    evLossBb: null,
    lossPct: null,
    source,
    label,
    why,
  });
  const state = adviceStateAt(r, street, i, scope, hand.setup);
  let ans = await ask(state);
  if (ans.data.cancelled) throw new Error("cancelled");
  if (ans.data.skipped) return ungraded(typeof ans.data.skipped === "string" ? ans.data.skipped : "skipped");
  if (ans.data.error) return ungraded(`the solver couldn't answer (${String(ans.data.error).slice(0, 200)})`, "", "", read(ans.data));
  if (jamOffTree(ans.data, m)) {
    const again = await ask({ ...state, jam: true });
    if (again.data.cancelled) throw new Error("cancelled");
    if (!again.data.error && !again.data.skipped && Array.isArray(again.data.actions)) ans = again;
  }
  const tri = read(ans.data);
  let pf: { pfWhy?: string; noRake?: boolean } = {};
  if (street === "preflop" && !pfOut(hand, r)) {
    const practice = hand.site === PRACTICE_SITE;
    const spot: PfSpot = { hero: r.hand.hero, hole: r.hand.hole.join(""), sim: simulate(r.setup, linesBefore(r, street, i), 0), table: r.setup, ownSizes: !!hand.setup?.pfSizes, ownOptions: !!hand.setup?.pfOptions };
    const asked = await askPf(state, ask);
    const by = practice ? pfReadAt(spot, ans.data, asked) : pfPlayed(spot, m, asked);
    if ("why" in by) pf = { pfWhy: by.why };
    else {
      ans = by;
      pf = { noRake: !practice };
    }
  }
  const source = ans.provenance.source;
  const label = describeProvenance(ans.provenance);
  // (a fallback's rules or an equity guess is never graded against)
  if (!GRADED_SOURCES[scope].includes(source))
    return ungraded(`answered by ${label}, ${GRADED_SOURCES[scope] === SOLVING ? "which isn't graded against" : "not the charts or the library"}`, source, label, tri);
  const g = gradeAgainst(ans.data, m);
  // (the site's words beside any the grade has)
  const note = [g?.note, pf.noRake ? PF_NO_RAKE : ""].filter(Boolean).join("; ");
  if (!g) return ungraded(matchMove(ans.data, m) ? "the answer gave no pot to measure the EV lost against" : `your ${moveLabel(m)} isn't among the answer's actions`, source, label, tri);
  // (the answer's most frequent action, as the classic analyzer reports it; the grade's best is by EV)
  const best = g.mix.reduce((b, x) => (x[1] > b[1] ? x : b));
  const off = offText(ans.data);
  // (a rough or cut-short solve can't condemn a line, as the classic gradeClass has it: its EV is kept, as measured)
  const { verdict, capped } = capGrade(g.grade, ans.provenance.band);
  const version = versionOf(ans.provenance);
  return {
    ...base,
    verdict,
    ...(capped ? { capped: true } : {}),
    evLossBb: g.grade.byEv ? r2(g.grade.loss) : null,
    lossPct: g.grade.byEv ? Math.round(g.grade.lossPct * 10) / 10 : null,
    byEv: g.grade.byEv,
    freq: g.mix[g.grade.a]![1],
    matched: g.matched,
    best: best[0],
    bestFreq: best[1],
    pot: r2(g.pot),
    mix: g.mix,
    ...(note ? { note } : {}),
    ...(pf.pfWhy ? { pfWhy: pf.pfWhy } : {}),
    ...(g.roughEv ? { roughEv: true } : {}),
    ...(g.roughEvs ? { roughEvs: g.roughEvs } : {}),
    ...(off ? { off } : {}),
    source,
    label,
    ...(version ? { version } : {}),
    ...(ans.provenance.approximate ? { approximate: true } : {}),
    ...(ans.provenance.band ? { band: ans.provenance.band } : {}),
    ...tri,
  };
}

/** A chart's preflop grade kept from before Analyze asked the preflop solve: in a stored game the solve may read it. */
const pfUnasked = (d: DecisionRecord) => d.street === "preflop" && d.source === "charts" && d.pfWhy === undefined;

const games = new WeakMap<HandRecord, boolean>();
/** Whether a hand's game is one the preflop solve is stored for, once for each hand, as a hand that reads no more isn't. */
function pfStored(h: HandRecord): boolean {
  let yes = games.get(h);
  if (yes === undefined) {
    try {
      yes = !pfOut(h, importHand(h.text));
    } catch {
      yes = false;
    }
    games.set(h, yes);
  }
  return yes;
}

/** What a new run doesn't ask again: each decision an answer was kept for. One nothing answered, a flop the library
 * didn't hold or the solver's failure, is asked again: by a wider scope, or by the library once it holds that flop. So is
 * a chart's preflop grade from before Analyze asked the preflop solve, in `hands` of a stored game: it's graded again, and
 * either the solve takes it or it says why not, so it isn't asked a third time. */
export function answeredIds(ds: readonly DecisionRecord[], hands: readonly HandRecord[] = []): Set<string> {
  const stored = new Map(hands.map((h) => [h.id, h]));
  return new Set(
    ds
      .filter((d) => {
        if (d.verdict === "Not graded" && !d.source) return false;
        if (!pfUnasked(d)) return true;
        const h = stored.get(d.handId);
        return !h || !pfStored(h);
      })
      .map((d) => d.id),
  );
}

/** A read checked at Fast: the answer at Fast in its place, keeping the read to compare (session.js triageOf); one
 * that can't grade your move leaves the read as it stands, saying why. */
export function deepened(read: DecisionRecord, d: DecisionRecord): DecisionRecord {
  if (d.verdict === "Not graded") return { ...read, notChecked: d.why ?? "", gradedAt: d.gradedAt };
  const { verdict, source, label, version, confidence, triageSource, evLossBb, freq, mix } = read;
  return { ...d, read: { verdict, source, label, ...(version ? { version } : {}), confidence, triageSource, evLossBb, freq, mix } };
}

export interface GradeRun {
  /** decisions graded (or kept as not graded) in this run */
  graded: number;
  /** hands gone through */
  hands: number;
  stopped: boolean;
}

/** Your decisions in these hands graded in turn, the hands in the order given, each decision already kept (`done`)
 * skipped, or with `deepen` only those reads, each checked at the scope (deepened); `onHand` gets each hand's new
 * decisions to keep. Stops at `signal`; a solver failure other than a stop is thrown (what was graded before it is
 * kept). */
export async function gradeHands(
  hands: readonly HandRecord[],
  scope: GradeScope,
  done: ReadonlySet<string>,
  ask: Ask,
  opts: {
    signal?: AbortSignal;
    onHand?: (k: number, n: number, ds: DecisionRecord[]) => void | Promise<void>;
    now?: () => number;
    pause?: () => Promise<void>;
    deepen?: ReadonlyMap<string, DecisionRecord>;
  } = {},
): Promise<GradeRun> {
  const pause = opts.pause ?? (() => new Promise<void>((res) => setTimeout(res, 0)));
  const run: GradeRun = { graded: 0, hands: 0, stopped: false };
  for (const [k, h] of hands.entries()) {
    if (opts.signal?.aborted) return { ...run, stopped: true };
    let r: ReplayedHand;
    try {
      r = importHand(h.text);
    } catch {
      continue; // (kept hands were read once: one that no longer reads is passed over)
    }
    const ds: DecisionRecord[] = [];
    for (const { street, i } of decisionsIn(r, scope, h.playedFor, h.revealed)) {
      const id = decisionId(h.id, street, i);
      const prev = opts.deepen?.get(id);
      if (opts.deepen ? !prev : done.has(id)) continue;
      try {
        const d = await gradeDecision(h, r, street, i, ask, opts.now?.(), scope);
        ds.push(prev ? deepened(prev, d) : d);
      } catch (e) {
        if (opts.signal?.aborted) {
          if (ds.length) await opts.onHand?.(k + 1, hands.length, ds);
          return { graded: run.graded + ds.length, hands: run.hands, stopped: true };
        }
        if (ds.length) await opts.onHand?.(k + 1, hands.length, ds);
        throw e;
      }
    }
    run.graded += ds.length;
    run.hands = k + 1;
    await opts.onHand?.(k + 1, hands.length, ds);
    await pause();
  }
  return run;
}
