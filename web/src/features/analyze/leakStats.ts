// The tests a leak is read by (report.ts readLeaks), with no poker threshold in them: your play against the answer's for
// the same hands at the same decisions, beyond chance at a bar set by how many rows the report tests (Bonferroni: someone
// who plays the answer's own mix exactly sees a false leak in about one report in twenty, however big it is), and an EV
// loss by its spread across a row's decisions. GTO Wizard's reports compare frequencies node by node and rank by EV; the
// classic analyzer used fixed lines (15 points, 15%, 0.1bb), which Lizard kept, widened, until 2026-11-22.
import { FREQ_TIE, MIX } from "@/grading/grade";

/** The share of reports with a false leak, for someone playing the answer's mix: the bar's family-wise error. */
export const ALPHA = 0.05;
/** A single row's bar, as a row's colour in a table is read alone: two-sided 95%. */
export const Z_ONE = 1.96;

/** The standard normal's quantile (Acklam's rational approximation, relative error under 1.2e-9). */
export function normInv(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** The |z| a row's test must reach when `m` tests are made: two-sided, ALPHA shared among them. */
export const zBar = (m: number): number => normInv(1 - ALPHA / (2 * Math.max(1, m)));

export interface Test {
  n: number;
  /** the mean difference (yours less the answer's), or the mean EV lost */
  mean: number;
  /** its standard error */
  se: number;
  /** mean / se: ±Infinity for a difference with no spread at all */
  z: number;
}

const zOf = (mean: number, se: number) => (se > 0 ? mean / se : mean === 0 ? 0 : mean > 0 ? Infinity : -Infinity);

/** Your action (1 taken, 0 not) against each hand's own answer (its share of the same): the mean difference and how far
 * it stands from none. The spread is the larger of the differences' own and what the answer's mix alone would give
 * (each decision's m(1 - m)): a run of the same hands can't make a narrow interval out of a few decisions. */
export function pairTest(ys: readonly number[], ms: readonly number[]): Test {
  const n = ys.length;
  if (!n) return { n: 0, mean: 0, se: 0, z: 0 };
  let [sum, sq, v0] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = ys[i]! - ms[i]!;
    sum += x;
    sq += x * x;
    v0 += ms[i]! * (1 - ms[i]!);
  }
  const mean = sum / n;
  const s2 = n > 1 ? Math.max(0, (sq - n * mean * mean) / (n - 1)) : 0;
  const se = Math.sqrt(Math.max(s2, v0 / n) / n);
  return { n, mean, se, z: zOf(mean, se) };
}

/** A mean (EV lost per decision) and how far it stands from nothing, by its values' own spread. */
export function meanTest(xs: readonly number[]): Test {
  const n = xs.length;
  if (!n) return { n: 0, mean: 0, se: 0, z: 0 };
  let [sum, sq] = [0, 0];
  for (const x of xs) {
    sum += x;
    sq += x * x;
  }
  const mean = sum / n;
  const s2 = n > 1 ? Math.max(0, (sq - n * mean * mean) / (n - 1)) : 0;
  const se = Math.sqrt(s2 / n);
  return { n, mean, se, z: zOf(mean, se) };
}

/** How often an action drawn from the answer's own mix is graded in the mix by frequency (grade.ts grade: the most played,
 * any tied with it to FREQ_TIE, or played MIX of the time or more): what playing the answer exactly would score here. */
export function okChance(freqs: readonly number[]): number {
  const fs = freqs.map((f) => (Number.isFinite(f) && f > 0 ? f : 0));
  if (!fs.length) return 1;
  const top = Math.max(...fs);
  let p = 0;
  for (const f of fs) if (top - f <= FREQ_TIE || Math.round(f * 1000) / 1000 >= MIX) p += f;
  const all = fs.reduce((s, f) => s + f, 0);
  return all > 0 ? Math.min(1, p / all) : 1;
}
