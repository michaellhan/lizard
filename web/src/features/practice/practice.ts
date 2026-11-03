// Practice: hands against GTO opponents, each of your decisions graded against the solver's answer for your hand.
// Pure helpers over one hand (the deal, the action so far, your graded decisions); PracticePage drives them with the
// solver. Semantics follow the classic trainer (solver/gto/static/practice.js): every seat's cards and the board are
// dealt up front from one deck; an opponent's move is drawn from the GTO mix for its actual hand (Advisor.play);
// your options are the solver's actions at your spot, graded once you've acted; your fold ends the hand for you.
// Unlike the classic Table mode, every hand starts from the setup's stack (no chips carried over). Your seat moves one
// place each hand (BTN, CO, HJ ... UTG, BB, SB), or is drawn at random, or is one seat; a preflop-only hand stops as
// the preflop closes.
import { kindOf } from "@/components/actions";
import { toSearch, type StudyHand } from "@/features/study/studyState";
import { grade, type Grade } from "@/grading/grade";
import { cmp, handName } from "@/poker/evaluate";
import { seatLabel, seatsOf } from "@/poker/seats";
import {
  deal,
  noLines,
  recordOf,
  seeded,
  settle,
  simulate,
  withMove,
  NEED,
  type Lines,
  type Move,
  type Settlement,
  type Sim,
  type Street,
  type TableSetup,
} from "@/poker/table";
import type { AdvisorActionStat, AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";

export interface Decision {
  street: Street;
  /** the solver's action you took (its name, e.g. "bet 33%"), or the move's kind where ungraded */
  chose: string;
  move: Move;
  /** null where the spot had no answer to grade against */
  grade: Grade | null;
  /** the answer's actions at your spot: what the grade is against */
  mix: { action: string; freq: number; ev: number | null; amount?: number }[];
  pot: number;
  provenance: Provenance | null;
  /** the Study line at the decision: the action before it, the board out (Study shows your whole range there) */
  study: string;
}

export interface HandResult {
  /** your chips won less your chips in, bb */
  net: number;
  folded: boolean;
  winners: string[];
  /** the showdown in a line, "BB's pair of queens beats your A-high" */
  says: string;
  pays: Record<string, number>;
  /** the hand stopped as the preflop closed (preflop only): nothing settled, `net` 0 */
  cut?: true;
}

export interface PracticeHand {
  seed: number;
  /** hands dealt this session before this one (your seat moves one place each) */
  n: number;
  players: number;
  stack: number;
  hero: string;
  hands: Record<string, [string, string]>;
  board: string[];
  /** board cards out */
  shown: number;
  lines: Lines;
  decisions: Decision[];
  result: HandResult | null;
  /** the hand ends as the preflop closes, with you still in it */
  preflopOnly?: true;
}

/** Your seat each hand: moving one place a hand ("moves"), drawn at random from the hand's seed ("random"), or one
 * seat (its name). */
export type SeatChoice = string;
export interface HandOptions {
  seat?: SeatChoice;
  preflopOnly?: boolean;
}

/** Your seat in the session's n-th hand: the button first, then one seat to the right each hand. */
export function heroSeat(n: number, players: number): string {
  const s = seatsOf(players);
  const start = s.indexOf(players === 2 ? "SB" : "BTN");
  return s[(((start - n) % players) + players) % players]!;
}

/** Your seat in the n-th hand under a seat choice (a seat the table doesn't have moves). */
export function seatFor(choice: SeatChoice | undefined, n: number, players: number, seed: number): string {
  const s = seatsOf(players);
  if (choice === "random") return s[seed % players]!;
  return choice && s.includes(choice) ? choice : heroSeat(n, players);
}

export function newHand(players: number, stack: number, n: number, seed: number, opts: HandOptions = {}): PracticeHand {
  const d = deal(players, seeded(seed));
  return {
    seed,
    n,
    players,
    stack,
    hero: seatFor(opts.seat, n, players, seed),
    ...d,
    shown: 0,
    lines: noLines(),
    decisions: [],
    result: null,
    ...(opts.preflopOnly ? { preflopOnly: true as const } : {}),
  };
}

/** Preflop only, the preflop closed with you and someone else in: the hand stops there. */
const cutAt = (h: PracticeHand, sim: Sim) => !!h.preflopOnly && !!sim.streets.preflop?.closed && !sim.handOver && sim.active.has(h.hero);

export const setupOf = (h: Pick<PracticeHand, "players" | "stack">): TableSetup => ({
  players: h.players,
  stacks: Object.fromEntries(seatsOf(h.players).map((p) => [p, h.stack])),
});

export const simOf = (h: PracticeHand): Sim => simulate(setupOf(h), h.lines, h.shown);

const boardOf = (h: PracticeHand) => h.board.slice(0, h.shown);

/** The Study line where the hand stands: every seat at the setup's stack (Practice has no ante or straddle). */
export function studyOf(h: PracticeHand): string {
  const conv = (ms: Move[]) => ms.map((m) => ({ pos: m.pos, action: m.action, ...(m.to !== undefined ? { to: m.to } : {}) }));
  const s: StudyHand = {
    players: h.players,
    stack: h.stack,
    board: boardOf(h).join(""),
    preflop: conv(h.lines.preflop),
    flop: conv(h.lines.flop),
    turn: conv(h.lines.turn),
    river: conv(h.lines.river),
  };
  return toSearch(s);
}

/** The hand from your seat, as the Advisor reads it: your advice's request, and the state an opponent's move is
 * drawn from (Advisor.play reads its seat's view off it). */
export function stateFor(h: PracticeHand): AdvisorState {
  const conv = (ms: Move[]) => ms.map((m) => ({ pos: m.pos, action: m.action, ...(m.to !== undefined ? { to: m.to } : {}) }));
  return {
    players: h.players,
    hero: h.hero,
    hole: h.hands[h.hero]!.join(""),
    board: boardOf(h).join(""),
    stack: h.stack,
    preflop: conv(h.lines.preflop),
    flop: conv(h.lines.flop),
    turn: conv(h.lines.turn),
    river: conv(h.lines.river),
  };
}

export type Phase =
  | { kind: "deal"; street: Street }
  | { kind: "hero"; street: Street }
  | { kind: "villain"; street: Street; seat: string }
  | { kind: "over" };

/** What happens next: cards to deal, a decision (yours or an opponent's), or the end of the hand (also your fold). */
export function phaseOf(h: PracticeHand, sim: Sim = simOf(h)): Phase {
  if (h.result || sim.handOver || !sim.active.has(h.hero) || cutAt(h, sim)) return { kind: "over" };
  if (sim.waiting) return { kind: "deal", street: sim.waiting };
  if (!sim.toAct || !sim.current) return { kind: "over" };
  return sim.toAct === h.hero ? { kind: "hero", street: sim.current } : { kind: "villain", street: sim.current, seat: sim.toAct };
}

/** The next street's cards out. */
export function dealNext(h: PracticeHand, street: Street): PracticeHand {
  return { ...h, shown: Math.max(h.shown, NEED[street]) };
}

/** An opponent's move from Advisor.play, as recorded: a size under the minimum lifted to it, a raise that isn't
 * allowed played as a call (`clamp`); a move the table can't take at all (it should not happen) as a check or call. */
export function villainMove(h: PracticeHand, mv: Pick<PlayMove, "action" | "to">, sim: Sim = simOf(h)): Move {
  const t = setupOf(h);
  const m = recordOf(t, sim, { action: mv.action, to: mv.to, clamp: true });
  if (typeof m !== "string") return m;
  const p = sim.toAct!;
  const facing = (sim.cur?.curBet ?? 0) - (sim.cur?.bets[p] ?? 0) > 1e-9;
  return { pos: p, action: facing ? "call" : "check" };
}

/** Your options: the answer's actions at your spot. */
export function optionsOf(res: AdvisorResponse | null | undefined): AdvisorActionStat[] {
  return res && !res.error && Array.isArray(res.actions) ? res.actions : [];
}

/** The move one of the answer's actions records (sizes to the half big blind, as the table takes them). */
export function moveOfOption(h: PracticeHand, a: AdvisorActionStat, sim: Sim = simOf(h)): Move | string {
  const kind = kindOf(a.action);
  return recordOf(setupOf(h), sim, { action: kind, to: typeof a.amount_bb === "number" ? a.amount_bb : undefined, clamp: true });
}

/** The answer's mix at your spot, per action: frequency, and EV where the answer has EVs for every action. */
export function mixOf(res: AdvisorResponse): Decision["mix"] {
  return optionsOf(res).map((a) => ({
    action: a.action,
    freq: a.freq ?? 0,
    ev: typeof a.ev_bb === "number" ? a.ev_bb : null,
    ...(typeof a.amount_bb === "number" ? { amount: a.amount_bb } : {}),
  }));
}

/** Your decision: the answer's i-th action taken, graded against the answer (by EV where it has EVs for every
 * action, else by frequency: the preflop charts). */
export function decide(
  h: PracticeHand,
  res: AdvisorResponse,
  i: number,
  provenance: Provenance | null,
  sim: Sim = simOf(h),
): { hand: PracticeHand; decision: Decision } | { error: string } {
  const a = optionsOf(res)[i];
  if (!a) return { error: "That action isn't in the answer." };
  const m = moveOfOption(h, a, sim);
  if (typeof m === "string") return { error: m };
  const mix = mixOf(res);
  const pot = typeof res.pot_bb === "number" ? res.pot_bb : sim.pot;
  const evs = mix.every((x) => x.ev !== null) ? mix.map((x) => x.ev!) : null;
  const g = grade({ freqs: mix.map((x) => x.freq), evs, pot }, i);
  const decision: Decision = { street: sim.current!, chose: a.action, move: m, grade: g, mix, pot, provenance, study: studyOf(h) };
  return { hand: { ...withMoveOf(h, sim, m), decisions: [...h.decisions, decision] }, decision };
}

/** A move with no answer to grade against (the solve failed): recorded, not graded. */
export function decideUngraded(h: PracticeHand, a: { action: string; to?: number }, sim: Sim = simOf(h)): PracticeHand | string {
  const m = recordOf(setupOf(h), sim, a);
  if (typeof m === "string") return m;
  const decision: Decision = { street: sim.current!, chose: m.action, move: m, grade: null, mix: [], pot: sim.pot, provenance: null, study: studyOf(h) };
  return { ...withMoveOf(h, sim, m), decisions: [...h.decisions, decision] };
}

function withMoveOf(h: PracticeHand, sim: Sim, m: Move): PracticeHand {
  return { ...h, lines: withMove(h.lines, sim.current!, m) };
}

export function withVillain(h: PracticeHand, m: Move, sim: Sim = simOf(h)): PracticeHand {
  return withMoveOf(h, sim, m);
}

/** The hand's end for you: your fold (what you put in is lost; the others' cards stay hidden), everyone else's
 * fold, or the showdown (the board run out where nobody is left to bet). */
export function finish(h: PracticeHand, sim: Sim = simOf(h)): HandResult {
  const inv = (p: string) => (sim.invested[p] ?? 0) + (sim.cur?.bets[p] ?? 0);
  if (!sim.active.has(h.hero)) return { net: -inv(h.hero), folded: true, winners: [], says: "", pays: {} };
  if (cutAt(h, sim)) return { net: 0, folded: false, winners: [], says: "", pays: {}, cut: true };
  const live = [...sim.active];
  const st = settle(setupOf(h), sim.invested, live, sim.allin, boardOf(h), (p) => h.hands[p]!);
  return {
    net: Math.round(((st.pays[h.hero] ?? 0) - inv(h.hero)) * 100) / 100,
    folded: false,
    winners: st.winners,
    says: says(st, h.hero, h.players),
    pays: st.pays,
  };
}

/** The showdown in a line: "CO's Q-high flush beats your two pair, kings and sevens"; "" without one. */
export function says(st: Settlement, hero: string, players: number): string {
  const who = (p: string) => (p === hero ? "your" : `${seatLabel(p, players)}'s`);
  const w = st.winners;
  const v = st.val;
  if (!w.length || !v[w[0]!]) return "";
  if (w.length > 1) {
    const names = w.map((p) => (p === hero ? "you" : seatLabel(p, players)));
    const list = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");
    return `Split pot: ${list} tie with ${handName(v[w[0]!]!)}`;
  }
  const rest = Object.keys(v).filter((p) => !w.includes(p));
  // (against the best of the losing hands)
  const lo = rest.reduce<string | null>((b, p) => (b && cmp(v[b]!, v[p]!) >= 0 ? b : p), null);
  if (!lo) return "";
  const top = handName(v[w[0]!]!, v[lo]);
  const line = `${who(w[0]!)} ${top} ${/^(three|four) /.test(top) ? "beat" : "beats"} ${who(lo)} ${handName(v[lo]!, v[w[0]!])}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Your seat's cards shown; an opponent's only at a showdown it reached (not after your fold or its own). */
export function shownCards(h: PracticeHand, p: string, sim: Sim = simOf(h)): [string, string] | null {
  if (p === h.hero) return h.hands[p]!;
  if (!h.result || h.result.folded || h.result.cut) return null;
  return sim.active.has(p) && sim.active.size > 1 ? h.hands[p]! : null;
}
