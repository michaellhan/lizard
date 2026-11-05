// Review mistakes and Recent decisions, the classic trainer's (solver/gto/static/practice.js:847-873): the session's
// last REVIEW_KEEP graded decisions, each with its spot (the hand's number, your seat and cards, the board, the
// street's action before you); of them, the REVIEW_SHOW that gave up the most EV (then the rarest in the answer's mix:
// the preflop charts have no EVs; then the newest), or the last RECENT, each opening its verdict.
import type { AdvisorState } from "@/solver/protocol";
import { sayMove, stateFor, type Decision, type PracticeHand } from "./practice";

/** how many of your last decisions are kept, and how many of them shown as mistakes (the classic's) */
export const REVIEW_KEEP = 60;
export const REVIEW_SHOW = 6;

export interface Reviewed {
  /** the hand's number in the session */
  n: number;
  /** the table it was played at, from 1, above one table */
  table?: number;
  seat: string;
  players: number;
  hole: [string, string];
  board: string[];
  /** the street's action before you: "UTG raises to 2.5, CO calls"; "folded to you"; "first to act" */
  line: string;
  d: Decision;
  /** the request your spot was answered by, to ask it again (a doc written before it was kept has none) */
  state?: AdvisorState;
}

/** Your decision `d` at the hand `h` (as it stood when you decided), the session's `n`th hand; `table`, above one table. */
export function reviewed(h: PracticeHand, d: Decision, n: number, table?: number): Reviewed {
  const before = h.lines[d.street].filter((m) => m.action !== "fold");
  return {
    n,
    ...(table !== undefined ? { table } : {}),
    seat: h.hero,
    players: h.players,
    hole: h.hands[h.hero]!,
    board: h.board.slice(0, h.shown),
    line: before.length ? before.map((m) => sayMove(m, h.hero, h.players)).join(", ") : d.street === "preflop" ? "folded to you" : "first to act",
    d,
    state: stateFor(h),
  };
}

/** how many of your last decisions are listed while the mistakes aren't (the classic's RECENT) */
export const RECENT = 8;

/** Your last RECENT decisions, newest first; `i`: its place in the list. */
export const recent = (list: readonly Reviewed[]): { e: Reviewed; i: number }[] =>
  list
    .map((e, i) => ({ e, i }))
    .slice(-RECENT)
    .reverse();

/** The list with a graded decision added, the oldest dropped past REVIEW_KEEP (an ungraded one isn't kept). */
export const withReviewed = (list: readonly Reviewed[], e: Reviewed): Reviewed[] => (e.d.grade ? [...list, e].slice(-REVIEW_KEEP) : [...list]);

const lostOf = (e: Reviewed) => e.d.grade?.loss ?? 0;
const freqOf = (e: Reviewed) => (e.d.grade ? (e.d.mix[e.d.grade.a]?.freq ?? 0) : 0);

/** Your biggest mistakes: the decisions that weren't the best and either gave up EV or were graded below Correct,
 * the most EV given up first, then the rarest in the mix, then the newest; at most REVIEW_SHOW. `i`: its place in
 * the list. */
export function mistakes(list: readonly Reviewed[]): { e: Reviewed; i: number }[] {
  return list
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !!e.d.grade && e.d.grade.a !== e.d.grade.best && (lostOf(e) > 0.005 || !e.d.grade.ok))
    .sort((a, b) => lostOf(b.e) - lostOf(a.e) || freqOf(a.e) - freqOf(b.e) || b.i - a.i)
    .slice(0, REVIEW_SHOW);
}

