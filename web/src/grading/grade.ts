// One grading scale for every trainer (Practice, drills, hand review): a decision is graded by the EV it gives up
// against the best action, ported from the classic trainer (solver/gto/static/drills.js grade, MIX/TOL/RARE).
// Without EVs (preflop charts) it is graded by frequency only, and says so: no EV lost is counted.
//
// Every surface grades through `gradeAnswer` with what it knows of the answer (`AnswerBasis`: its provenance, the flop
// library's EV step, the actions with rough EVs and the solve's iterations, whether its ranges lean on the betting rules).
// Three rules come of it:
//  - an answer's EVs are only so fine (`answerNoise`, and for a move with a rough EV its measured error on top:
//    `roughErrPct`): an action within that of the best is Correct, and past it only the excess is graded against the 2%
//    and 8% thresholds;
//  - where the error can't be measured (`capReason`: a fallback, a cut-short solve, ranges from the betting rules, a rough or
//    approximate band, a read of another solution), the verdict stops at Inaccuracy and says why;
//  - except a clear blunder: past the noise, CLEAR_PCT of the pot or more is a Blunder whatever answered.
// The words (`whyText`, `lossWords`) use the page's own precision: one decimal of a percent, two of a big blind, and name
// the top-EV action wherever they say what a loss is measured against.

/** A hand's strategy at one decision: per action its frequency and, where the answer has them, its EV in bb. */
export interface DecisionSpot {
  /** action frequencies for this hand, aligned with the node's actions */
  freqs: readonly number[];
  /** per-action EV in bb; null where the answer has none (preflop charts, a read at once) */
  evs: readonly number[] | null;
  /** the pot in bb at the decision (EV lost is also reported in % of it) */
  pot: number;
  /** the answer's source (provenance.ts): the preflop solve's EVs can't tell small gaps apart (noiseOf) */
  source?: string;
  /** the answer's EV noise here, bb (answerNoise); unset: noiseOf(source, pot) */
  noise?: number;
  /** how far the graded action's own EV may be off past the noise, bb (a rough EV's: roughErrPct); unset: 0 */
  extra?: number;
}

export type Verdict = "Best" | "Correct" | "Inaccuracy" | "Mistake" | "Blunder";

export interface Grade {
  /** the action graded */
  a: number;
  /** the best action: among the actions within the answer's noise (or TOL) of the top EV, yours if it's Best, else
   * the one played most (never a 0% action while a played one is that close); the most frequent without EVs */
  best: number;
  /** the top-EV action, that `loss` is measured against (yours where it's within TOL of the top EV, else the most played
   * at the top EV: topIndex); the best without EVs. Unset on a grade made before it was kept */
  top?: number;
  verdict: Verdict;
  /** Best or Correct */
  ok: boolean;
  /** the hand mixes: two or more actions at MIX or more */
  mixed: boolean;
  /** EV given up against the top EV, bb, as measured (0 within TOL; 0 when graded by frequency) */
  loss: number;
  /** the same in % of the pot */
  lossPct: number;
  /** graded by EV (true) or by frequency only (false) */
  byEv: boolean;
  /** the verdict stopped at an Inaccuracy, as the answer's error can't be measured (capReason); `capWhy` says why */
  capped?: boolean;
  /** why it was capped, in words */
  capWhy?: string;
  /** Correct though rarely played: its EV is within the answer's noise of the best; `loss` is as measured */
  close?: boolean;
  /** the EV noise the verdict allowed this action, bb, where there is one: the answer's (answerNoise), and for a move with
   * a rough EV its error on top (`rough`). The verdict is on the EV lost past it */
  noise?: number;
  /** the action's EV is rough (advisor.py rough_ev), and `noise` includes its measured error (roughErrPct) */
  rough?: boolean;
  /** an answer that can't condemn a line (capReason) still graded this a Blunder: past the noise it gave up CLEAR_PCT of
   * the pot or more. In words, with why it would otherwise have stopped */
  clearWhy?: string;
  /** the EV lost past the noise, bb, and in % of the pot, below Correct (0 for Best and Correct): what the verdict is
   * on, and all a running score counts */
  past?: number;
  pastPct?: number;
}

/** An action played at least this often is a real part of the hand's mix: Correct whatever its EV gap. */
export const MIX = 0.1;
/** EV gaps up to this many bb count as equal (the engine reports EVs to the cent). */
export const TOL = 0.011;
/** Without EVs: an action played less often than this is a Mistake. */
export const RARE = 0.03;
/** Without EVs: frequencies this close to the top are tied, and every one of them is Best (a 50/50 chart hand). */
export const FREQ_TIE = 0.005;
/** EV lost in % of the pot: under INACCURACY_PCT an Inaccuracy, under MISTAKE_PCT a Mistake, else a Blunder. */
export const INACCURACY_PCT = 2;
export const MISTAKE_PCT = 8;
/** Past the noise, a loss of this much of the pot (% of it) is a clear blunder: graded a Blunder even by an answer whose
 * error can't be measured (capReason), where anything less stops at Inaccuracy. Two and a half times the Blunder line:
 * folding trips to a 3-way flop bet (44% of the pot) or calling off half the pot with a hand that never wins is a blunder
 * on any ranges a rule could give. The recorded Practice decisions of the 2026-11-18 audit: docs/ACCURACY.md section 27. */
export const CLEAR_PCT = 20;
/** The least EV noise of any solved answer, % of the pot: the engine's own tie (advisor.py BR_TIE_MIN). */
export const NOISE_FLOOR_PCT = 0.5;
/** A measured answer's noise is this many times its distance from equilibrium (% of the pot). Fast live solves of three
 * heads-up turns (170-305 iterations, 0.09-0.28% from equilibrium) put per-combo EV gaps 0.11-0.18% of the pot off a
 * 1,000-iteration solve at the median and 0.3-1.1% at the 90th percentile (docs/ACCURACY.md section 27). */
export const NOISE_K = 2;
/** The flop library stores each action's EV as a drop from the best in steps of this share of the entry's pot
 * (solver/gto/flop_library.py EV_STEP: 0.055bb in a 5.5bb pot, 0.2bb in a 3-bet pot). */
export const LIBRARY_EV_STEP = 0.01;
/** A flop library answer's noise is this many of its EV steps: the library's own rarely played actions (0.5-10% of the
 * time) sit within one step of the best 98-99% of the time first to act, within two 99.5%; facing a bet a call or raise
 * sits within one 65-86% and within two 80-93%, a fold 42-64% and 65-77% (docs/ACCURACY.md section 27). */
export const LIBRARY_NOISE_STEPS = 2;
/** A rough EV's error by the solve's iterations (advisor.py RARE_BRANCH: heads-up actions the range takes 0.01-1% against
 * postflop-solver on single-raised turns, the mean of the gap, % of the pot): 6.0 at 100 iterations, 2.4 at 300, 1.6 at
 * 400, 0.6 at 1,000. Ours were lower than exact (-4.5, -1.5, -0.8, -0.3), so a rough move's loss reads too big. */
const ROUGH_ERR: readonly (readonly [number, number])[] = [
  [100, 6.0],
  [300, 2.4],
  [400, 1.6],
  [1000, 0.6],
];

/** What a rough EV (advisor.py rough_ev, a move the range almost never takes) may be off by at a solve of this many
 * iterations, % of the pot: ROUGH_ERR, between its points by the log of the iterations. Under 100 or unknown, 100's (fewer
 * are unmeasured); past 1,000, 1,000's. */
export function roughErrPct(iterations?: number): number {
  const [first, last] = [ROUGH_ERR[0]!, ROUGH_ERR[ROUGH_ERR.length - 1]!];
  if (!(typeof iterations === "number" && Number.isFinite(iterations)) || iterations <= first[0]) return first[1];
  if (iterations >= last[0]) return last[1];
  const k = ROUGH_ERR.findIndex(([x]) => x >= iterations);
  const [[x0, y0], [x1, y1]] = [ROUGH_ERR[k - 1]!, ROUGH_ERR[k]!];
  return y0 + ((y1 - y0) * Math.log(iterations / x0)) / Math.log(x1 / x0);
}

/** The preflop solve's EV noise at a decision, in % of the pot (bb) there. It is a calibrated class-level model, not a full
 * solve, and its EVs are coarser than they look: where the published 6-max 100bb solves play a hand both ways (the charts'
 * weights of 15% to 85%, so the two actions are worth the same), its stored game still puts the chart's play behind its
 * best by up to 5.1% of the pot first in, 7.9% facing an open, 11% facing a 3-bet and 13% facing a 4-bet (the 90th
 * percentile, at pots of 1.5, 4, 13 and 34bb; 30,000 hands of chart play, scripts/pf_practice_coverage.py, 2026-11-18).
 * 4 + 2.75 ln(pot) gives 5.1, 7.8, 11.1 and 13.7. Other depths and table sizes are unmeasured and use the same curve. */
export const pfNoisePct = (pot: number): number => 4 + 2.75 * Math.log(Math.max(pot, 1));

/** The preflop solve's noise in bb at a pot (pfNoisePct), else 0: what `grade` uses where no noise is given. */
export const noiseOf = (source: string | undefined, pot: number): number => (source === "preflop-solve" && pot > 0 ? (pot * pfNoisePct(pot)) / 100 : 0);

// ---- the page's precision: a frequency to 0.1%, a share of the pot to 0.1%, a big blind to the cent
const freq1 = (x: number) => Math.round(x * 1000) / 1000;
const pct1 = (x: number) => Math.round(x * 10) / 10;
const bb2 = (x: number) => Math.round(x * 100) / 100;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** The top-EV action, that a loss is measured against: `a` where it holds the top EV to TOL (it then gives up nothing),
 * else of the actions at the top EV itself the most played, so the loss said against it is its EV less yours, to the cent.
 * -1 where there are no EVs, or they aren't numbers. */
export function topIndex(freqs: readonly number[], evs: readonly (number | null)[] | null, a: number): number {
  if (!evs || !evs.length || !evs.every(finite)) return -1;
  const e = evs as readonly number[];
  const topEv = Math.max(...e);
  if (Number.isInteger(a) && a >= 0 && a < e.length && topEv - e[a]! <= TOL) return a;
  const fq = (i: number) => (finite(freqs[i]) && freqs[i]! > 0 ? freqs[i]! : 0);
  return e.reduce((x, v, i) => (topEv - v > 1e-9 ? x : x < 0 || fq(i) > fq(x) ? i : x), -1);
}

export function grade(spot: DecisionSpot, a: number): Grade {
  const n = spot.freqs.length;
  // (a frequency that isn't a number counts as never played; an EV that isn't one leaves the answer without EVs)
  const freqs = spot.freqs.map((x) => (finite(x) && x > 0 ? x : 0));
  const inRange = Number.isInteger(a) && a >= 0 && a < n;
  const f = inRange ? freqs[a]! : 0;
  const mixed = freqs.filter((x) => freq1(x) >= MIX).length > 1;
  const pot = finite(spot.pot) && spot.pot > 0 ? spot.pot : 0;
  const evs = spot.evs && n > 0 && spot.evs.length === n && spot.evs.every(finite) ? spot.evs : null;
  const ok = (v: Verdict) => v === "Best" || v === "Correct";
  if (!evs || !inRange) {
    // by frequency: the most played is Best, and so is every action tied with it (the charts write many hands 0.5)
    const top = n ? Math.max(...freqs) : 0;
    const best = !inRange ? (n ? freqs.indexOf(top) : a) : top - f <= FREQ_TIE ? a : freqs.indexOf(top);
    const verdict: Verdict = n === 0 ? "Best" : !inRange ? "Mistake" : best === a ? "Best" : freq1(f) >= MIX ? "Correct" : freq1(f) >= RARE ? "Inaccuracy" : "Mistake";
    return { a, best, top: best, verdict, ok: ok(verdict), mixed, loss: 0, lossPct: 0, byEv: false };
  }
  const topEv = Math.max(...evs);
  const raw = Math.max(0, topEv - evs[a]!);
  const noise = Math.max(0, finite(spot.noise) ? spot.noise : noiseOf(spot.source, pot));
  const extra = Math.max(0, finite(spot.extra) ? spot.extra : 0);
  const most = (pool: number[]) => pool.reduce((x, y) => (freqs[y]! > freqs[x]! || (freqs[y] === freqs[x] && evs[y]! > evs[x]!) ? y : x));
  const near = (tie: number) => evs.map((e, i) => (topEv - e <= tie ? i : -1)).filter((i) => i >= 0);
  // the top EV, that the loss is measured against: yours where you hold it (to TOL), else of those at it the most played
  const top = topIndex(freqs, evs, a);
  // the best: yours where it holds the top EV (to TOL); else, of the actions within the answer's noise of the top (worth
  // the same as far as the answer can tell), the one played most, so a hand's main play isn't told its best is a move it
  // never makes for a hair of EV; where none of those is played, the top EV's. (On the answer's noise alone: one answer has
  // one best, whichever action is graded.)
  const played = near(Math.max(TOL, noise)).filter((i) => freq1(freqs[i]!) > 0);
  const best = raw <= TOL ? a : played.length ? most(played) : top;
  // (the graded action's own allowance: a rough EV's error on top of the answer's noise)
  const allow = noise + extra;
  const over = Math.max(0, raw - allow);
  const overPct = pot > 0 ? (over / pot) * 100 : 0;
  // (an excess too small to show, 0.00bb or 0.0% of the pot, can't be graded beside the numbers that show it)
  const shows = bb2(over) > 0 && (pot === 0 || pct1(overPct) > 0);
  const verdict: Verdict =
    best === a ? "Best" : freq1(f) >= MIX || !shows ? "Correct" : pct1(overPct) < INACCURACY_PCT ? "Inaccuracy" : pct1(overPct) < MISTAKE_PCT ? "Mistake" : "Blunder";
  const close = verdict === "Correct" && freq1(f) < MIX;
  // (what the score counts: nothing for Best or Correct, so an action the hand plays costs nothing there)
  const past = ok(verdict) ? 0 : over;
  const loss = raw <= TOL ? 0 : raw;
  return {
    a,
    best,
    top,
    verdict,
    ok: ok(verdict),
    mixed,
    loss,
    lossPct: pot > 0 ? (loss / pot) * 100 : 0,
    byEv: true,
    past,
    pastPct: pot > 0 ? (past / pot) * 100 : 0,
    ...(close ? { close: true } : {}),
    ...(allow > 0 ? { noise: allow } : {}),
    ...(extra > 0 ? { rough: true } : {}),
  };
}

// ---- what an answer can tell apart, and when it can't condemn a line

/** What a surface knows of the answer it grades against. */
export interface AnswerBasis {
  /** the answer's provenance source (provenance.ts) */
  source?: string;
  /** its convergence band, where its distance from equilibrium is measured */
  band?: string;
  /** that distance, % of the pot */
  exploitabilityPct?: number;
  /** a partial answer: the solve was cut short */
  partial?: boolean;
  /** the answer is labelled approximate */
  approximate?: boolean;
  /** a flop library answer: the flop's starting pot, bb (the entry's pot: one stored EV step is 1% of it) */
  flopPot?: number;
  /** per action, aligned with the spot's: the engine marks its EV rough (advisor.py rough_ev, a move the range almost
   * never takes), and its measured error (roughErrPct) is added to that action's noise */
  rough?: readonly boolean[];
  /** the solve's iterations, which size a rough EV's error (roughErrPct); unknown: the most measured */
  iterations?: number;
  /** the answer's ranges lean on the betting rules (provenance.ts leansOnRules: a street they narrowed, an opponent's rare
   * line they read with nothing solved after it, a range they widened, a narrowing solve followed under half) */
  leans?: boolean;
  /** the answer's noise, bb, as a grade kept it: used as it is (a kept decision's) */
  noise?: number;
}

/** Sources whose numbers come from no solve. */
const UNSOLVED = new Set(["rules", "equity", "unknown"]);

/** The EV gap, bb, an answer can't tell from none at a decision with this pot: the preflop solve's measured noise
 * (pfNoisePct); for any other answer with EVs, at least NOISE_FLOOR_PCT of the pot, NOISE_K times its measured distance
 * from equilibrium, and for a flop library answer two stored EV steps (LIBRARY_NOISE_STEPS of 1% of the flop's pot; of
 * the decision's where the flop's isn't known, which is never less). */
export function answerNoise(b: AnswerBasis, pot: number): number {
  if (finite(b.noise) && b.noise >= 0) return b.noise;
  if (!(finite(pot) && pot > 0)) return 0;
  if (b.source === "preflop-solve") return (pot * pfNoisePct(pot)) / 100;
  const floor = (NOISE_FLOOR_PCT / 100) * pot;
  const measured = finite(b.exploitabilityPct) && b.exploitabilityPct > 0 ? ((NOISE_K * b.exploitabilityPct) / 100) * pot : 0;
  const step = b.source === "library" ? LIBRARY_NOISE_STEPS * LIBRARY_EV_STEP * (finite(b.flopPot) && b.flopPot > 0 ? Math.min(b.flopPot, pot) : pot) : 0;
  return Math.max(floor, measured, step);
}

/** Why an answer can't condemn action `a`, short (the verdict then stops at Inaccuracy, short of a clear blunder); null
 * where it can. Only what's measured condemns: a fallback's numbers, a solve cut short before it measured itself, ranges
 * from the betting rules, a rough or approximate band and a read of another solution are not. (A rough EV isn't here: its
 * error is measured, and added to its noise: roughErrPct.) */
function capGist(b: AnswerBasis, byEv: boolean): string | null {
  const src = b.source;
  if (src && UNSOLVED.has(src)) return `${whoOf(src)} is no solve`;
  if (b.partial && !finite(b.exploitabilityPct)) return "The solve was cut short before it measured how close it got";
  if (b.leans) return "This answer's ranges lean on the betting rules";
  if (b.band === "rough" || b.band === "approximate")
    return `The solve stopped ${finite(b.exploitabilityPct) ? `${b.exploitabilityPct.toFixed(2)}% of the pot from equilibrium, ` : ""}${b.band === "rough" ? "too far to trust" : "short of its target"}`;
  if (!byEv) return null;
  if (b.approximate && src !== "preflop-solve" && !finite(b.exploitabilityPct)) return "This answer is read from another solution, its error unmeasured";
  return null;
}

/** Why an answer can't condemn action `a` (the verdict then stops at Inaccuracy), in words; null where it can (capGist).
 * A loss of CLEAR_PCT of the pot or more past the noise still goes to Blunder (gradeAnswer). */
export function capReason(b: AnswerBasis, _a: number, byEv: boolean): string | null {
  const gist = capGist(b, byEv);
  return gist ? `${gist}, so it can't condemn a line: this grade stops at Inaccuracy, short of a clear blunder (${CLEAR_PCT}% of the pot past the noise).` : null;
}

/** The EV noise a verdict allows action `a`, bb: the answer's (answerNoise), and where the engine marks the action's EV
 * rough, its measured error at the solve's iterations on top (roughErrPct), so a rough move is graded on what's past both. */
export function actionNoise(b: AnswerBasis, pot: number, a: number): { noise: number; extra: number } {
  const noise = answerNoise(b, pot);
  const extra = b.rough?.[a] && finite(pot) && pot > 0 ? (roughErrPct(b.iterations) / 100) * pot : 0;
  return { noise, extra };
}

/** Action `a` graded against an answer: the one entry point every surface grades through. The noise is the answer's,
 * with a rough EV's error on top (actionNoise); where its error can't be measured (capReason) the verdict stops at
 * Inaccuracy, its EV as measured, unless the loss past the noise is a clear blunder (CLEAR_PCT of the pot or more). */
export function gradeAnswer(spot: Pick<DecisionSpot, "freqs" | "evs" | "pot">, a: number, b: AnswerBasis = {}): Grade {
  const { noise, extra } = actionNoise(b, spot.pot, a);
  const g = grade({ freqs: spot.freqs, evs: spot.evs, pot: spot.pot, source: b.source, noise, extra }, a);
  if (g.verdict !== "Mistake" && g.verdict !== "Blunder") return g;
  const gist = capGist(b, g.byEv);
  if (!gist) return g;
  const pastPct = pct1(g.pastPct ?? 0);
  if (g.verdict === "Blunder" && pastPct >= CLEAR_PCT)
    return { ...g, clearWhy: `${gist}, but this gives up ${pastPct.toFixed(1)}% of the pot past its noise, ${CLEAR_PCT}% or more: a clear blunder, graded as measured.` };
  return { ...g, verdict: "Inaccuracy", capped: true, capWhy: capReason(b, a, g.byEv)! };
}

/** A rough or cut-short solve can't condemn a line (the classic gradeClass): under such a band the verdict stops at an
 * Inaccuracy, and the EV it measured stays as measured. (gradeAnswer does this and more; kept for a grade made before.) */
export function capGrade(g: Grade, band: string | undefined): Grade {
  const unsure = band === "rough" || band === "approximate";
  return unsure && (g.verdict === "Mistake" || g.verdict === "Blunder") ? { ...g, verdict: "Inaccuracy", capped: true } : g;
}

/** Why a verdict stopped there, wherever a capped grade is shown without its own reason (one kept before reasons were). */
export const CAPPED_WORDS = "A rough or cut-short solve, a fallback, or ranges from the betting rules can't condemn a line, so this grade stops at Inaccuracy.";

/** The thresholds in words, for the page that shows grades. */
export const GRADE_RULES: readonly { verdict: Verdict; rule: string }[] = [
  { verdict: "Best", rule: `the highest-EV action (within ${TOL}bb), or the most played of the actions within the answer's noise of it; without EVs, the hand's most frequent action (ties all Best)` },
  {
    verdict: "Correct",
    rule: `an action the hand plays ${MIX * 100}% of the time or more, or one within the answer's noise of the best: ${NOISE_FLOOR_PCT}% of the pot at least, ${NOISE_K} times a solve's distance from equilibrium, two stored EV steps (2% of the flop's pot) for the flop library, and for the preflop solve about 5% of the pot first in, 8% facing an open, 11% facing a 3-bet; a move the range almost never takes, whose EV is rough, has that EV's measured error on top (6% of the pot at 100 iterations, 2.4% at 300, 0.6% at 1,000); past the noise only the excess is graded`,
  },
  { verdict: "Inaccuracy", rule: `gives up under ${INACCURACY_PCT}% of the pot past the noise; without EVs, played ${RARE * 100}–${MIX * 100}% of the time; the most an answer whose error can't be measured gives, short of a clear blunder` },
  { verdict: "Mistake", rule: `gives up ${INACCURACY_PCT}–${MISTAKE_PCT}% of the pot past the noise; without EVs, played under ${RARE * 100}% of the time` },
  { verdict: "Blunder", rule: `gives up ${MISTAKE_PCT}% of the pot or more past the noise (graded by EV only); ${CLEAR_PCT}% or more is a clear blunder, a Blunder even where the answer's error can't be measured` },
];

/** Whose numbers a grade is against, by the answer's source (provenance.ts): the solver, or what answered in its place
 * (the charts aren't a solve). */
export function whoOf(source: string | undefined): string {
  return source === "charts" ? "The chart" : source === "preflop-solve" ? "The preflop solve" : source === "push-fold" ? "The push/fold model" : source === "best-response" ? "The best response to the assumed profile" : source === "profile-solve" ? "The re-solve against the assumed profile" : source === "rules" ? "The rule-based model" : source === "equity" ? "The equity fallback" : source === "instant" ? "The read at once" : "The solver";
}

/** A frequency as the tables show it: one decimal. */
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
const bbs = (x: number) => `${x.toFixed(2)}bb`;

/** Whether a loss Correct as within the noise reads larger than the noise beside it: the excess too small to grade
 * (0.00bb, or 0.0% of the pot), yet the two numbers, each shown to the cent, differ. Then the words say "just past", not
 * "within". */
export const justPast = (loss: number, noise: number | undefined): boolean => finite(noise) && noise > 0 && Number(loss.toFixed(2)) > Number(noise.toFixed(2));

/** How far past the noise an excess too small to grade is, in words: by under 0.1% of the pot, or under 0.01bb. */
function tooSmall(g: Pick<Grade, "loss" | "lossPct" | "noise">): string {
  const over = g.loss - (g.noise ?? 0);
  const overPct = g.loss > 0 ? (g.lossPct * over) / g.loss : 0;
  return bb2(over) > 0 && pct1(overPct) === 0 ? "by under 0.1% of the pot" : "by under 0.01bb";
}

/** The rule-based "why" (the classic trainer's why, practice.js:431-444): how often the answer plays your action and
 * which is best, in the answer's own name (`who`, whoOf). `names` and `freqs` are aligned with the grade's indices.
 * Its numbers are the table's (one decimal), "never" and "always" are 0.0% and 100.0%, none contradicts the verdict, and
 * a loss is always said against the action it's measured against: the top EV. */
export function whyText(g: Grade, names: readonly string[], freqs: readonly number[], who = "The solver"): string {
  const fs = freqs.map((x) => (finite(x) && x > 0 ? x : 0));
  if (!fs.length) return `${who} gives no actions here, so there is nothing to compare this with.`;
  const f = fs[g.a] ?? 0;
  const top = Math.max(...fs);
  const name = (i: number) => names[i] ?? "another action";
  const topI = g.top ?? g.best;
  const never = f < 0.0005;
  const plays = never ? "never plays this" : `plays this only ${pc(f)} of the time`;
  // (by EV, the best can be the most played of the actions within the answer's noise of the top EV, not the top EV itself)
  const best =
    g.byEv && topI !== g.best
      ? `its best is ${name(g.best)} (${pc(fs[g.best] ?? 0)} of the time), the most played within the answer's noise of the top EV, ${name(topI)} (${pc(fs[topI] ?? 0)} of the time)`
      : `its best${g.byEv ? " by EV" : ""} is ${name(g.best)} (${pc(fs[g.best] ?? 0)} of the time)`;
  const noise = g.noise ? ` (${bbs(g.noise)})` : "";
  const tell = `what the answer's EVs can tell apart ${g.rough ? "for a move its range almost never takes" : "here"}`;
  if (g.verdict === "Best") {
    if (top < 0.0005) return `${who} gives no frequency for any action here, so this stands with the rest.`;
    if (f >= 0.9995) return `${who} always plays this here.`;
    if (top - f <= FREQ_TIE) return `${who} picks this most often here: ${pc(f)} of the time.`;
    // (best by EV, not by frequency: a mix's actions are worth about the same)
    if (g.byEv && g.loss > 0) return `${who} plays this ${pc(f)} of the time, more than any other action within ${tell}${noise}.`;
    return never ? `${who} never plays this, though its EV is as high as any action's here.` : `${who} plays this ${pc(f)} of the time, and its EV is as high as any action's here.`;
  }
  if (g.close) {
    const within = !g.noise ? "too little to show in % of the pot" : justPast(g.loss, g.noise) ? `just past ${tell}${noise}, ${tooSmall(g)}: too little to grade` : `within ${tell}${noise}`;
    return `${who} ${plays}, but it gives up only ${bbs(g.loss)} against the top EV, ${name(topI)} (${pc(fs[topI] ?? 0)} of the time): ${within}.`;
  }
  if (g.verdict === "Correct") return f >= 0.9995 ? `${who} always plays this, though ${best}.` : `${who} mixes this in ${pc(f)} of the time; ${best}.`;
  const past = g.noise && g.past !== undefined ? ` Graded on the ${bbs(g.past)} past ${tell}${noise}.` : "";
  const clear = g.clearWhy ? ` ${g.clearWhy}` : "";
  return `${who} ${plays}; ${best}.${past}${clear}`;
}

/** What a grade gave up, in words, beside the verdict: the EV as measured and in % of the pot, and that it's within the
 * answer's noise or part of the mix where it isn't counted. (What a miss gave up past the noise, all the verdict and the
 * score count, is said in its whyText, shown beside this.) `unit`: what the EVs are in (provenance.ts evUnit); `approx`:
 * "≈" where an EV in it is rough. Null for a grade by frequency, which gives up no EV. */
export function lossWords(g: Grade, pot: number, unit = "bb", approx = ""): string | null {
  if (!g.byEv) return null;
  if (!(g.loss > 0)) return "No EV given up.";
  const potWords = pot > 0 ? `, ${g.lossPct.toFixed(1)}% of the ${bb2(pot)}bb pot` : "";
  const head = `EV given up: ${approx}${g.loss.toFixed(2)}${unit}${potWords}`;
  const noise = g.noise ? `the answer's noise ${g.rough ? "for a move its range almost never takes" : "here"} (${g.noise.toFixed(2)}${unit})` : "";
  if (g.verdict === "Best") return `${head}: within ${noise || "what the answer can tell apart"}, so not counted.`;
  if (g.close) return noise && justPast(g.loss, g.noise) ? `${head}: just past ${noise}, ${tooSmall(g)}, so not counted.` : `${head}: within ${noise || "what shows in % of the pot"}, so not counted.`;
  if (g.verdict === "Correct") return `${head}: part of the hand's mix, so not counted.`;
  return `${head}.`;
}

type Brief = Pick<Grade, "byEv" | "loss" | "lossPct" | "verdict"> & Partial<Pick<Grade, "close" | "noise" | "past">>;

/** What of a measured loss counts, said after it: " (within the answer's noise, not counted)" for a Best or a close
 * Correct (" (just past the answer's noise, too little to grade, not counted)" where the loss reads larger than the noise:
 * justPast), " (part of the hand's mix, not counted)" for another Correct, ", 0.18bb past the answer's noise" below that
 * (what the verdict and the score count); empty for a grade kept without a noise. */
export function noiseTail(g: Brief, unit = "bb"): string {
  if (g.verdict === "Best" || g.close) return justPast(g.loss, g.noise) ? " (just past the answer's noise, too little to grade, not counted)" : " (within the answer's noise, not counted)";
  if (g.verdict === "Correct") return " (part of the hand's mix, not counted)";
  return g.noise && g.past !== undefined ? `, ${g.past.toFixed(2)}${unit} past the answer's noise` : "";
}

/** The same, short, for a line beside a verdict: "0.30bb given up, 1.2% of the pot, 0.18bb past the answer's noise"
 * (noiseTail). Empty where nothing was given up or the grade is by frequency. */
export function lossBrief(g: Brief, unit = "bb"): string {
  if (!g.byEv || !(g.loss > 0)) return "";
  return `${g.loss.toFixed(2)}${unit} given up, ${g.lossPct.toFixed(1)}% of the pot${noiseTail(g, unit)}`;
}

// ---- running scores (drills.js emptyScore / addScore / summary)

export interface Score {
  /** decisions graded */
  n: number;
  /** of them Best or Correct */
  ok: number;
  /** EV lost, summed over the decisions graded by EV (bb, and % of the pot): only what each below Correct gave up past
   * its answer's noise (scored), so a gap the answer can't tell from none, or an action the hand plays, costs nothing */
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

/** The words that say what a score's EV lost counts, wherever it's shown. */
export const SCORE_LOSS_WORDS = "EV lost counts only the decisions graded below Correct, and of each only what it gave up past its answer's noise (the EV gap the answer can't tell from none); each decision still shows the EV it gave up as measured.";

export function emptyScore(): Score {
  return { n: 0, ok: 0, loss: 0, lossPct: 0, ne: 0, streak: 0, best: 0, recent: [] };
}

/** What a grade adds to a total of EV lost, bb and % of the pot: the loss past its answer's noise (`past`); the whole
 * loss for a grade made before noise was kept; nothing by frequency. */
export function scored(g: Pick<Grade, "loss" | "lossPct" | "byEv"> & Partial<Pick<Grade, "past" | "pastPct">>): { loss: number; lossPct: number } {
  if (!g.byEv) return { loss: 0, lossPct: 0 };
  return { loss: finite(g.past) ? g.past : g.loss, lossPct: finite(g.pastPct) ? g.pastPct : g.lossPct };
}

export function addScore(s: Score | undefined, g: Pick<Grade, "ok" | "loss" | "lossPct" | "byEv"> & Partial<Pick<Grade, "past" | "pastPct">>): Score {
  const b = s ?? emptyScore();
  const streak = g.ok ? b.streak + 1 : 0;
  const lost = scored(g);
  return {
    n: b.n + 1,
    ok: b.ok + (g.ok ? 1 : 0),
    loss: b.loss + lost.loss,
    lossPct: b.lossPct + lost.lossPct,
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
