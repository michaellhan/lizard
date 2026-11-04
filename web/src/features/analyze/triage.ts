// Quick triage's second pass and the queue's clock, ported from the classic analyzer (solver/gto/static/session.js
// flagged, deepen, estimate, eta, fmtDur): which reads to check at Fast, in what order, and how long a run should take.
// A read's confidence is the Advisor's own (Advisor.triage). The agreement between a read and its check is in report.ts.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { importHand } from "@/hh/replay";
import type { Street } from "@/poker/table";
import { STREETS } from "./analyze";
import { decisionId, decisionsIn, type GradeScope } from "./grading";
import { isGraded, isOk } from "./report";

/** EV lost, as a share of the pot, from which a read is worth checking whatever its grade. */
export const DEEP_LOSS = 0.02;

/** The charts and the library's own spot: Fast answers the same, so there's nothing to check. */
const sameAtFast = (d: DecisionRecord) => (d.source === "charts" || d.source === "library") && d.confidence === "high";

/** A read Fast should check: one it could answer otherwise, of low confidence, off the mix, or losing DEEP_LOSS of the
 * pot; one that couldn't be graded, the betting rules' included (Fast solves what Quick leaves to them, a 4-way flop in
 * the browser), or the solver failed on. `every`: all that Fast could answer otherwise. A read already checked isn't
 * flagged, nor one Fast couldn't grade (unless `every`), nor an answer that wasn't a triage read. */
export function flagged(d: DecisionRecord, every = false): boolean {
  if (d.read || !d.confidence || sameAtFast(d)) return false;
  if (every) return true;
  if (d.notChecked !== undefined) return false;
  if (!isGraded(d) || d.confidence === "low" || !isOk(d)) return true;
  return d.evLossBb != null && (d.pot ?? 0) > 0 && d.evLossBb >= DEEP_LOSS * d.pot!;
}

export interface DeepenPlan {
  hands: HandRecord[];
  /** the reads to check, by decision */
  reads: Map<string, DecisionRecord>;
  /** how many, by street */
  left: Record<Street, number>;
}

const zero = (): Record<Street, number> => ({ preflop: 0, flop: 0, turn: 0, river: 0 });

/** The reads to check at Fast: the hands with the biggest flagged pots first, each hand's in the order played (its
 * flop's solve narrows the turn, and a turn's answers its river in a fraction of the time). */
export function deepenPlan(hands: readonly HandRecord[], ds: readonly DecisionRecord[], every = false): DeepenPlan {
  const kept = new Map(hands.map((h, k) => [h.id, k]));
  const reads = new Map<string, DecisionRecord>();
  const top = new Map<string, number>();
  const left = zero();
  for (const d of ds) {
    if (!kept.has(d.handId) || !flagged(d, every)) continue;
    reads.set(d.id, d);
    top.set(d.handId, Math.max(top.get(d.handId) ?? 0, d.pot ?? 0));
    left[d.street as Street]++;
  }
  const order = hands.filter((h) => top.has(h.id)).sort((a, b) => top.get(b.id)! - top.get(a.id)! || kept.get(a.id)! - kept.get(b.id)!);
  return { hands: order, reads, left };
}

/** The decisions a run would ask, by street: a kept hand is read again, so a long list goes a piece at a time. */
export async function toAsk(
  hands: readonly HandRecord[],
  scope: GradeScope,
  done: ReadonlySet<string>,
  opts: { signal?: AbortSignal; pause?: () => Promise<void> } = {},
): Promise<Record<Street, number> | null> {
  const pause = opts.pause ?? (() => new Promise<void>((res) => setTimeout(res, 0)));
  const left = zero();
  for (const [k, h] of hands.entries()) {
    if (k % 100 === 99) await pause();
    if (opts.signal?.aborted) return null;
    try {
      for (const { street, i } of decisionsIn(importHand(h.text), scope, h.playedFor)) if (!done.has(decisionId(h.id, street, i))) left[street]++;
    } catch {
      continue; // (kept hands were read once: gradeHands passes over one that no longer reads)
    }
  }
  return left;
}

// Seconds a decision takes before any is measured (session.js estimate): at Fast a share of the street's budget plus
// each earlier postflop street's narrowing budget; a library-only flop and preflop's chart are instant; Quick triage,
// what a 1,000-hand session averaged, most of it read at once. At 8 solver threads the same session took AT_8 of the
// time at Fast and TRIAGE_8 at triage (a Quick solve keeps its budget), in between geometrically.
const TRIAGE_S: Record<Street, number> = { preflop: 0.02, flop: 0.6, turn: 1.2, river: 0.2 };
const TRIAGE_8: Record<Street, number> = { preflop: 1, flop: 0.38, turn: 0.92, river: 0.33 };
const AT_8: Record<Exclude<Street, "preflop">, number> = { flop: 0.17, turn: 0.28, river: 0.5 };
const FAST_SHARE: Record<Exclude<Street, "preflop">, number> = { flop: 0.3, turn: 0.7, river: 0.15 };
const EARLIER: Record<Exclude<Street, "preflop">, number> = { flop: 0, turn: 1, river: 2 };

export function estimate(s: Street, scope: GradeScope, budgets: readonly [number, number] = [2.5, 2.5], threads = 1): number {
  const [b, p] = budgets;
  const w = Math.min(1, Math.max(0, (threads - 1) / 7));
  if (s === "preflop") return scope === "triage" ? TRIAGE_S.preflop : 0.2;
  if (scope === "triage") return TRIAGE_S[s] * TRIAGE_8[s] ** w;
  if (s === "flop" && scope === "library") return 0.4;
  return (FAST_SHARE[s] * (b + p * EARLIER[s]) + 0.3) * AT_8[s] ** w;
}

/** Each street's answers so far in a run: total seconds and how many. */
export type Timing = Partial<Record<Street, [number, number]>>;

/** Seconds left: each street's measured average once it has two answers, else the estimate. */
export function secondsLeft(left: Record<Street, number>, timing: Timing, scope: GradeScope, budgets: readonly [number, number], threads = 1): number {
  return STREETS.reduce((t, s) => {
    const m = timing[s];
    return t + left[s] * (m && m[1] >= 2 ? m[0] / m[1] : estimate(s, scope, budgets, threads));
  }, 0);
}

export const fmtDur = (s: number) => (s < 1 ? "under a second" : s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
