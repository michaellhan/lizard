// Your imported decisions graded against the Advisor's answer for your hand, as the classic analyzer does it
// (solver/gto/static/session.js classify / processItem, index.html payload / gradeWith / gradedMove / jamOffTree), at
// the two scopes that solve nothing: preflop against the charts, graded by frequency only (the charts have no EVs),
// and flops from the precomputed library ("library_only": a flop the library doesn't hold is skipped, never solved).
// Turns and rivers need a live solve and aren't graded here. The grade is Lizard's one scale (grading/grade.ts).
import type { DecisionRecord, HandRecord } from "@/data/db";
import { grade, type Grade, type Verdict } from "@/grading/grade";
import { importHand, type ReplayedHand } from "@/hh/replay";
import { simulate, type Lines, type Move, type Street } from "@/poker/table";
import type { AdvisorActionStat, AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { describe as describeProvenance } from "@/solver/provenance";
import type { Provenance, ResultSource } from "@/solver/types";
import { heroDecisions, potType, preflopRaises, preflopSituation, STREETS } from "./analyze";

const NEED: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const EPS = 1e-9;
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => String(r2(x));

export type GradeScope = "preflop" | "library";
export const SCOPES: Record<GradeScope, string> = {
  preflop: "Preflop, against the charts",
  library: "Preflop and the flops the library holds",
};
/** The streets each scope grades. */
const SCOPE_STREETS: Record<GradeScope, readonly Street[]> = { preflop: ["preflop"], library: ["preflop", "flop"] };
/** The answers a grade may stand on: the charts preflop, a precomputed library entry on the flop. */
const GRADED_SOURCES: readonly ResultSource[] = ["charts", "library"];

export type DecisionVerdict = Verdict | "Not graded";

/** The decisions of yours in a hand a scope grades: the street and the action's index there. */
export const decisionsIn = (r: Pick<ReplayedHand, "lines" | "hand">, scope: GradeScope) =>
  heroDecisions(r).filter((d) => SCOPE_STREETS[scope].includes(d.street));

export const decisionId = (handId: string, street: Street, i: number) => `${handId}|${street}|${i}`;

/** The lines up to one of your decisions: the streets before it, its own actions before it. */
function linesBefore(r: ReplayedHand, street: Street, i: number): Lines {
  const k = STREETS.indexOf(street);
  const at = (s: Street) => (STREETS.indexOf(s) < k ? r.lines[s] : s === street ? r.lines[s].slice(0, i) : []);
  return { preflop: at("preflop"), flop: at("flop"), turn: at("turn"), river: at("river") };
}

/** The Advisor's request at one of your decisions, as the classic page sends it (payload()): your seat, cards and
 * stack, every seat's own stack where they differ, the ante and the straddle, the actions before it; a flop asks
 * the library only. */
export function adviceStateAt(r: ReplayedHand, street: Street, i: number): AdvisorState {
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
    preflop: conv(lines.preflop),
    flop: conv(lines.flop),
    turn: conv(lines.turn),
    river: conv(lines.river),
    ...(street === "flop" ? { library_only: true } : {}),
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

/** The grade of your move against an answer, with the mix it is graded against; null where the move isn't in it. */
export function gradeAgainst(res: AdvisorResponse, m: Move): { grade: Grade; mix: [string, number, number | null][]; matched: string; note?: string; pot: number } | null {
  const hit = matchMove(res, m);
  if (!hit) return null;
  const freqs = hit.actions.map((a) => a.freq ?? 0);
  const evList = hit.actions.map((a) => (typeof a.ev_bb === "number" ? a.ev_bb : null));
  const evs = evList.every((x) => x !== null) ? (evList as number[]) : null;
  const pot = typeof res.pot_bb === "number" ? res.pot_bb : 0;
  const g = grade({ freqs, evs, pot }, hit.index);
  return {
    grade: g,
    mix: hit.actions.map((a, k) => [a.action, freqs[k]!, evList[k]!]),
    matched: hit.actions[hit.index]!.action,
    ...(hit.note ? { note: hit.note } : {}),
    pot,
  };
}

/** Asks the solver for one state (the page's SolverClient.solve, with its provenance). */
export type Ask = (state: AdvisorState) => Promise<{ data: AdvisorResponse; provenance: Provenance }>;

/** One of your decisions graded, as kept: the grade and what it stands on, or why it isn't graded. */
export async function gradeDecision(hand: Pick<HandRecord, "id">, r: ReplayedHand, street: Street, i: number, ask: Ask, now = Date.now()): Promise<DecisionRecord> {
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
    gradedAt: now,
  };
  const ungraded = (why: string, source = "", label = ""): DecisionRecord => ({
    ...base,
    verdict: "Not graded",
    evLossBb: null,
    lossPct: null,
    source,
    label,
    why,
  });
  const state = adviceStateAt(r, street, i);
  let ans = await ask(state);
  if (ans.data.cancelled) throw new Error("cancelled");
  if (ans.data.skipped) return ungraded(typeof ans.data.skipped === "string" ? ans.data.skipped : "skipped");
  if (ans.data.error) return ungraded(`the solver couldn't answer (${String(ans.data.error).slice(0, 200)})`);
  if (jamOffTree(ans.data, m)) {
    const again = await ask({ ...state, jam: true });
    if (again.data.cancelled) throw new Error("cancelled");
    if (!again.data.error && !again.data.skipped && Array.isArray(again.data.actions)) ans = again;
  }
  const source = ans.provenance.source;
  const label = describeProvenance(ans.provenance);
  // (only the charts and the library: a fallback's rules or an equity guess is never graded against)
  if (!GRADED_SOURCES.includes(source)) return ungraded(`answered by ${label}, not the charts or the library`, source, label);
  const g = gradeAgainst(ans.data, m);
  if (!g) return ungraded(`your ${moveLabel(m)} isn't among the answer's actions`, source, label);
  // (the answer's most frequent action, as the classic analyzer reports it; the grade's best is by EV)
  const best = g.mix.reduce((b, x) => (x[1] > b[1] ? x : b));
  return {
    ...base,
    verdict: g.grade.verdict,
    evLossBb: g.grade.byEv ? r2(g.grade.loss) : null,
    lossPct: g.grade.byEv ? Math.round(g.grade.lossPct * 10) / 10 : null,
    byEv: g.grade.byEv,
    freq: g.mix[g.grade.a]![1],
    matched: g.matched,
    best: best[0],
    bestFreq: best[1],
    pot: r2(g.pot),
    mix: g.mix,
    ...(g.note ? { note: g.note } : {}),
    source,
    label,
  };
}

export interface GradeRun {
  /** decisions graded (or kept as not graded) in this run */
  graded: number;
  /** hands gone through */
  hands: number;
  stopped: boolean;
}

/** Your decisions in these hands graded in turn, the hands in the order given, each decision already kept (`done`)
 * skipped; `onHand` gets each hand's new decisions to keep. Stops at `signal`; a solver failure other than a stop
 * is thrown (what was graded before it is kept). */
export async function gradeHands(
  hands: readonly HandRecord[],
  scope: GradeScope,
  done: ReadonlySet<string>,
  ask: Ask,
  opts: { signal?: AbortSignal; onHand?: (k: number, n: number, ds: DecisionRecord[]) => void | Promise<void>; now?: () => number; pause?: () => Promise<void> } = {},
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
    for (const { street, i } of decisionsIn(r, scope)) {
      if (done.has(decisionId(h.id, street, i))) continue;
      try {
        ds.push(await gradeDecision(h, r, street, i, ask, opts.now?.()));
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
