// A Practice session: what was set up, the hands dealt, and the score across them, as History keeps it. Pure: each
// deal, graded decision and finished hand gives the next session, whichever table it came from, so one session scores
// them all. Decisions count as they're graded and a hand as it ends, so `score.n` runs ahead of the tallies mid-hand.
import type { SessionRecord } from "@/data/db";
import { addHandToPot, addSource, handPot, type PotTally } from "@/features/history/history";
import { addScore, emptyScore, type Score } from "@/grading/grade";
import type { ResultSource } from "@/solver/types";
import { carries, simOf, type Decision, type HandOptions, type HandResult, type PracticeHand } from "./practice";
import { reviewed, withReviewed, type Reviewed } from "./review";

export interface PracticeSession {
  id: string;
  startedAt: number;
  players: number;
  stack: number;
  /** your seat each hand ("moves", "random" or a seat) and whether hands stop as the preflop closes */
  opts: Required<HandOptions>;
  /** hands dealt so far, the next hand's `n`: one count across tables, so a number is one hand */
  dealt: number;
  hands: number;
  /** chips won less chips put in, over the session's hands, bb (not counted preflop only: no hand is played out) */
  net: number;
  score: Score;
  /** finished hands by pot type, and the decisions graded by what answered them (the History page) */
  byPot: Record<string, PotTally>;
  sources: Partial<Record<ResultSource, number>>;
  /** your last graded decisions, with their spots (Review mistakes, review.ts) */
  review: Reviewed[];
}

const DEFAULT_OPTS: Required<HandOptions> = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };

export const freshSession = (players: number, stack: number, opts: Required<HandOptions> = DEFAULT_OPTS): PracticeSession => ({
  id: `practice-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
  startedAt: Date.now(),
  players,
  stack,
  opts,
  dealt: 0,
  hands: 0,
  net: 0,
  score: emptyScore(),
  byPot: {},
  sources: {},
  review: [],
});

/** The session once a hand is dealt (a drill's hand dealt again keeps its number, and isn't counted). */
export const afterDeal = (s: PracticeSession): PracticeSession => ({ ...s, dealt: s.dealt + 1 });

/** The session after your decision `d` at the hand `h` as it stood when you decided; `table`, above one table (from 1).
 * One not graded isn't counted. */
export function afterDecision(s: PracticeSession, h: PracticeHand, d: Decision, table?: number): PracticeSession {
  if (!d.grade) return s;
  return {
    ...s,
    score: addScore(s.score, d.grade),
    sources: addSource(s.sources, d.provenance?.source),
    review: withReviewed(s.review, reviewed(h, d, h.n + 1, table)),
  };
}

/** The session after the hand `h` ended with `result`. */
export function afterHand(s: PracticeSession, h: PracticeHand, result: HandResult): PracticeSession {
  const pot = handPot(h.lines.preflop, simOf(h));
  return {
    ...s,
    hands: s.hands + 1,
    net: s.opts.preflopOnly ? s.net : Math.round((s.net + result.net) * 100) / 100,
    byPot: { ...s.byPot, [pot]: addHandToPot(s.byPot[pot], h.decisions.map((d) => d.grade), s.opts.preflopOnly ? null : result.net) },
  };
}

/** The session as History keeps it. `tables`, above one, is said; each table then deals its own seat and spot with no
 * chips carried, so the session's seat, pot and carry aren't what was played and are left out. */
export const toRecord = (s: PracticeSession, tables = 1): SessionRecord => ({
  id: s.id,
  kind: "practice",
  startedAt: s.startedAt,
  endedAt: Date.now(),
  decisions: s.score.n,
  evLossBb: s.score.loss,
  meta: {
    hands: s.hands,
    net: s.net,
    ok: s.score.ok,
    graded: s.score.ne,
    lossPct: s.score.lossPct,
    players: s.players,
    stack: s.stack,
    ...(tables > 1 ? { tables } : { seat: s.opts.seat }),
    ...(s.opts.preflopOnly ? { preflopOnly: true } : {}),
    ...(s.opts.pot && tables <= 1 ? { pot: s.opts.pot } : {}),
    ...(s.opts.ante ? { ante: s.opts.ante } : {}),
    ...(s.opts.straddle && s.players >= 3 ? { straddle: true } : {}),
    ...(carries(s.opts) && tables <= 1 ? { carry: true } : {}),
    ...(s.opts.sizes ? { sizes: s.opts.sizes } : {}),
    ...(s.opts.rake ? { rake: s.opts.rake, ...(s.opts.rakeCap ? { rakeCap: s.opts.rakeCap } : {}) } : {}),
    byPot: s.byPot,
    sources: s.sources,
  },
});

/** A finished hand kept in Analyze, or being kept: `key` is the session's and the hand's place in it. */
export type Kept = { key: string } & ({ st: "saving" } | { st: "kept"; id: string; had: boolean } | { st: "error"; message: string });
export const keyOf = (s: Pick<PracticeSession, "id">, h: Pick<PracticeHand, "n">) => `${s.id}|${h.n}`;
