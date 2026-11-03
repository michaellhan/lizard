// A leak drilled: the decisions behind it dealt again one by one, each as it stood in your hand (your cards, the
// board, the actions before it), answered from the mix kept with its grade, so nothing is asked of the solver (the
// classic analyzer's drillSet: "the spot as it stood, the answer's mix and EVs, misses first"). A pick is graded on
// the one scale (grading/grade.ts), against the charts by frequency or the library by EV, as the decision was.
import type { DecisionRecord, HandRecord, SessionRecord } from "@/data/db";
import { grade, type Grade, type Score } from "@/grading/grade";
import type { ReplayedHand } from "@/hh/replay";
import { seatLabel } from "@/poker/seats";
import type { Street } from "@/poker/table";
import { STREETS } from "./analyze";
import { isGraded, isOk, leakTest, type Leak } from "./report";

const NEED: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const fmt = (x: number) => String(Math.round(x * 100) / 100);

export type LeakRef = Pick<Leak, "kind" | "key">;
export const leakParam = (l: LeakRef) => `${l.kind}:${l.key}`;
export function parseLeakParam(s: string | null): LeakRef | null {
  const m = s ? /^(freq|pf|spot):(.+)$/.exec(s) : null;
  return m ? { kind: m[1] as Leak["kind"], key: m[2]! } : null;
}
export const drillSessionId = (l: LeakRef) => `leak-drill|${leakParam(l)}`;

/** The page's URL search with some params set (the filters and the rest kept), for a link. */
export function withParams(params: URLSearchParams, o: Record<string, string>): string {
  const q = new URLSearchParams(params);
  for (const [k, v] of Object.entries(o)) q.set(k, v);
  return `?${q}`;
}

export interface DrillItem {
  d: DecisionRecord;
  hand: HandRecord;
}

/** The leak's decisions to drill: graded ones whose mix is kept, in hands still kept; your misses first (the most
 * EV lost, then the rarest in the answer), then the rest in the order played. */
export function drillItems(ds: readonly DecisionRecord[], leak: LeakRef, hands: ReadonlyMap<string, HandRecord>): DrillItem[] {
  const test = leakTest(leak);
  const out = ds.filter((d) => isGraded(d) && d.mix?.length && hands.has(d.handId) && test(d)).map((d) => ({ d, hand: hands.get(d.handId)! }));
  const miss = (x: DrillItem) => (isOk(x.d) ? 1 : 0);
  return out.sort(
    (a, b) =>
      miss(a) - miss(b) ||
      (b.d.evLossBb ?? 0) - (a.d.evLossBb ?? 0) ||
      (a.d.freq ?? 0) - (b.d.freq ?? 0) ||
      b.hand.playedAt - a.hand.playedAt ||
      a.d.id.localeCompare(b.d.id),
  );
}

/** The actions before a decision, street by street, as the hand view says them ("UTG folds", "You raise to 2.5"),
 * with the board up to its street. */
export function lineBefore(r: ReplayedHand, street: Street, i: number): { board: string[]; streets: { street: Street; says: string[] }[] } {
  const h = r.hand;
  const k = STREETS.indexOf(street);
  const SAY: Record<string, [string, string]> = {
    fold: ["folds", "fold"],
    check: ["checks", "check"],
    call: ["calls", "call"],
    bet: ["bets", "bet"],
    raise: ["raises to", "raise to"],
    "all-in": ["goes all-in", "go all-in"],
  };
  const streets: { street: Street; says: string[] }[] = [];
  for (const s of STREETS.slice(0, k + 1)) {
    const moves = s === street ? r.lines[s].slice(0, i) : r.lines[s];
    streets.push({
      street: s,
      says: moves.map((m) => {
        const you = m.pos === h.hero;
        return `${you ? "You" : seatLabel(m.pos, h.players)} ${SAY[m.action]?.[you ? 1 : 0] ?? m.action}${m.to !== undefined ? ` ${fmt(m.to)}` : ""}`;
      }),
    });
  }
  return { board: h.board.slice(0, NEED[street]), streets };
}

/** A pick among the kept mix's actions, graded as the decision was: by EV where the mix has EVs for every action,
 * else by frequency (the charts). */
export function gradePick(d: DecisionRecord, a: number): Grade {
  const mix = d.mix ?? [];
  const evs = mix.every((x) => x[2] !== null) ? mix.map((x) => x[2]!) : null;
  return grade({ freqs: mix.map((x) => x[1]), evs, pot: d.pot ?? 0 }, a);
}

/** The drill's progress, kept as an "analysis" session so it resumes: the decisions answered and the score. */
export interface DrillProgress {
  startedAt: number;
  done: string[];
  score: Score;
}

export function toSession(l: LeakRef, p: DrillProgress, total: number, now = Date.now()): SessionRecord {
  return {
    id: drillSessionId(l),
    kind: "analysis",
    startedAt: p.startedAt,
    endedAt: now,
    decisions: p.score.n,
    evLossBb: p.score.loss,
    meta: { drill: "leak", leak: leakParam(l), label: l.key, total, done: p.done, score: p.score },
  };
}

export function fromSession(s: SessionRecord | undefined): DrillProgress | null {
  const m = s?.meta as { drill?: string; done?: unknown; score?: Score } | undefined;
  if (!s || m?.drill !== "leak" || !Array.isArray(m.done) || !m.score) return null;
  return { startedAt: s.startedAt, done: m.done.filter((x): x is string => typeof x === "string"), score: m.score };
}
