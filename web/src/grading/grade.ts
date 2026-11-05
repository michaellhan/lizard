// One grading scale for every trainer (Practice, drills, hand review): a decision is graded by the EV it gives up
// against the best action, ported from the classic trainer (solver/gto/static/drills.js grade, MIX/TOL/RARE).
// Without EVs (preflop charts) it is graded by frequency only, and says so: no EV lost is counted.

/** A hand's strategy at one decision: per action its frequency and, where the answer has them, its EV in bb. */
export interface DecisionSpot {
  /** action frequencies for this hand, aligned with the node's actions */
  freqs: readonly number[];
  /** per-action EV in bb; null where the answer has none (preflop charts, a read at once) */
  evs: readonly number[] | null;
  /** the pot in bb at the decision (EV lost is also reported in % of it) */
  pot: number;
}

export type Verdict = "Best" | "Correct" | "Inaccuracy" | "Mistake" | "Blunder";

export interface Grade {
  /** the action graded */
  a: number;
  /** the best action: highest EV, or the most frequent without EVs */
  best: number;
  verdict: Verdict;
  /** Best or Correct */
  ok: boolean;
  /** the hand mixes: two or more actions at MIX or more */
  mixed: boolean;
  /** EV given up against the best action, bb (0 within TOL; 0 when graded by frequency) */
  loss: number;
  /** the same in % of the pot */
  lossPct: number;
  /** graded by EV (true) or by frequency only (false) */
  byEv: boolean;
}

/** An action played at least this often is a real part of the hand's mix: Correct whatever its EV gap. */
export const MIX = 0.1;
/** EV gaps up to this many bb count as equal (the library stores EVs in steps of about 0.01bb). */
export const TOL = 0.011;
/** Without EVs: an action played less often than this is a Mistake. */
export const RARE = 0.03;
/** EV lost in % of the pot: under INACCURACY_PCT an Inaccuracy, under MISTAKE_PCT a Mistake, else a Blunder. */
export const INACCURACY_PCT = 2;
export const MISTAKE_PCT = 8;

export function grade(spot: DecisionSpot, a: number): Grade {
  const { freqs } = spot;
  const mixed = freqs.filter((f) => f >= MIX).length > 1;
  const f = freqs[a] ?? 0;
  if (!spot.evs) {
    const top = freqs.indexOf(Math.max(...freqs));
    const verdict: Verdict = a === top ? "Best" : f >= MIX ? "Correct" : f >= RARE ? "Inaccuracy" : "Mistake";
    return { a, best: top, verdict, ok: verdict === "Best" || verdict === "Correct", mixed, loss: 0, lossPct: 0, byEv: false };
  }
  const evs = spot.evs;
  const bestEv = Math.max(...evs);
  const raw = Math.max(0, bestEv - (evs[a] ?? bestEv));
  const rawPct = spot.pot > 0 ? (raw / spot.pot) * 100 : 0;
  const verdict: Verdict =
    raw <= TOL ? "Best" : f >= MIX ? "Correct" : rawPct < INACCURACY_PCT ? "Inaccuracy" : rawPct < MISTAKE_PCT ? "Mistake" : "Blunder";
  return {
    a,
    best: evs.indexOf(bestEv),
    verdict,
    ok: verdict === "Best" || verdict === "Correct",
    mixed,
    loss: raw <= TOL ? 0 : raw,
    lossPct: raw <= TOL ? 0 : rawPct,
    byEv: true,
  };
}

/** The thresholds in words, for the page that shows grades. */
export const GRADE_RULES: readonly { verdict: Verdict; rule: string }[] = [
  { verdict: "Best", rule: `the highest-EV action (within ${TOL}bb); without EVs, the hand's most frequent action` },
  { verdict: "Correct", rule: `an action the hand plays ${MIX * 100}% of the time or more` },
  { verdict: "Inaccuracy", rule: `gives up under ${INACCURACY_PCT}% of the pot; without EVs, played ${RARE * 100}–${MIX * 100}% of the time` },
  { verdict: "Mistake", rule: `gives up ${INACCURACY_PCT}–${MISTAKE_PCT}% of the pot; without EVs, played under ${RARE * 100}% of the time` },
  { verdict: "Blunder", rule: `gives up ${MISTAKE_PCT}% of the pot or more (graded by EV only)` },
];

/** Whose numbers a grade is against, by the answer's source (provenance.ts): the solver, or what answered in its place
 * (the charts aren't a solve). */
export function whoOf(source: string | undefined): string {
  return source === "charts" ? "The chart" : source === "preflop-solve" ? "The preflop solve" : source === "push-fold" ? "The push/fold model" : source === "rules" ? "The rule-based model" : source === "equity" ? "The equity fallback" : "The solver";
}

/** The rule-based "why" (the classic trainer's why, practice.js:431-444): how often the answer plays your action and
 * which is best, in the answer's own name (`who`, whoOf). `names` and `freqs` are aligned with the grade's indices. */
export function whyText(g: Grade, names: readonly string[], freqs: readonly number[], who = "The solver"): string {
  const p = (x: number) => `${Math.round(x * 100)}%`;
  const f = freqs[g.a] ?? 0;
  const best = `its best${g.byEv ? " by EV" : ""} is ${names[g.best] ?? "?"} (${p(freqs[g.best] ?? 0)} of the time)`;
  if (g.verdict === "Best") {
    if (f >= 0.995) return `${who} always plays this here.`;
    if (f >= Math.max(...freqs)) return `${who} picks this most often here: ${p(f)} of the time.`;
    // (best by EV, not by frequency: a mix's actions are worth about the same)
    return f < 0.005 ? `${who} never plays this, though its EV is as high as any action's here.` : `${who} plays this ${p(f)} of the time, and its EV is as high as any action's here.`;
  }
  if (g.verdict === "Correct") return `${who} mixes this in ${p(f)} of the time; ${best}.`;
  return `${who} ${f < 0.005 ? "never plays this" : `plays this only ${p(f)} of the time`}; ${best}.`;
}

// ---- running scores (drills.js emptyScore / addScore / summary)

export interface Score {
  /** decisions graded */
  n: number;
  /** of them Best or Correct */
  ok: number;
  /** EV lost, summed over the decisions graded by EV (bb, and % of the pot) */
  loss: number;
  lossPct: number;
  /** decisions graded by EV: the losses' averages are over these */
  ne: number;
  streak: number;
  best: number;
  /** the last RECENT decisions, 1 ok / 0 not */
  recent: number[];
}

export const RECENT = 100;

export function emptyScore(): Score {
  return { n: 0, ok: 0, loss: 0, lossPct: 0, ne: 0, streak: 0, best: 0, recent: [] };
}

export function addScore(s: Score | undefined, g: Pick<Grade, "ok" | "loss" | "lossPct" | "byEv">): Score {
  const b = s ?? emptyScore();
  const streak = g.ok ? b.streak + 1 : 0;
  return {
    n: b.n + 1,
    ok: b.ok + (g.ok ? 1 : 0),
    loss: b.loss + (g.byEv ? g.loss : 0),
    lossPct: b.lossPct + (g.byEv ? g.lossPct : 0),
    ne: b.ne + (g.byEv ? 1 : 0),
    streak,
    best: Math.max(b.best, streak),
    recent: [...b.recent, g.ok ? 1 : 0].slice(-RECENT),
  };
}

export function summary(s: Score): { acc: number; loss: number | null; lossPct: number | null } {
  return {
    acc: s.n ? s.ok / s.n : 0,
    loss: s.ne ? s.loss / s.ne : null,
    lossPct: s.ne ? s.lossPct / s.ne : null,
  };
}
