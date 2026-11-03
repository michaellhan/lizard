// Compare EV (ROADMAP Phase 8): at one node, per hand class, the EV of one action minus another's, from the per-class
// EVs Study's answer already has (grid cells' `ev`, one per action, in bb). At equilibrium a class mixes only actions
// worth the same, so a class that takes both should show a gap near zero (within the answer's distance from
// equilibrium): said as a check. An action the range almost never takes has a rough EV (advisor.py `rough_ev`: its
// branch is barely trained, usually too low), which the gap inherits.
import type { AdvisorResponse } from "@/solver/protocol";

export interface EvGap {
  cls: string;
  /** the class's weight in the range */
  w: number;
  /** the class's EV of each action, bb; null where the answer has none */
  ex: number | null;
  ey: number | null;
  /** ex − ey */
  d: number | null;
  /** how often the class takes each */
  fx: number;
  fy: number;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Whether the answer has every action's EV per class (a chart, a read at once or a 4-way answer has none). */
export function hasActionEvs(res: AdvisorResponse): boolean {
  const g = res.grid;
  if (!g || g.actions.length < 2) return false;
  return Object.values(g.cells).some((c) => c.w > 0 && Array.isArray(c.ev) && g.actions.every((_, i) => num(c.ev![i]) !== null));
}

/** Per class in the range, the EV of `x` minus the EV of `y`. */
export function evGaps(res: AdvisorResponse, x: string, y: string): EvGap[] {
  const g = res.grid;
  if (!g) return [];
  const i = g.actions.indexOf(x), j = g.actions.indexOf(y);
  if (i < 0 || j < 0) return [];
  return Object.entries(g.cells)
    .filter(([, c]) => c.w > 0)
    .map(([cls, c]) => {
      const ex = num(c.ev?.[i]), ey = num(c.ev?.[j]);
      return { cls, w: c.w, ex, ey, d: ex !== null && ey !== null ? ex - ey : null, fx: c.f[i] ?? 0, fy: c.f[j] ?? 0 };
    });
}

/** The classes where `x` is worth most more than `y` (sign 1) or `y` more than `x` (sign −1), biggest first. */
export function widest(gaps: EvGap[], sign: 1 | -1, n = 5): EvGap[] {
  return gaps
    .filter((g) => g.d !== null && g.d * sign > 0)
    .sort((a, b) => (b.d! - a.d!) * sign || b.w - a.w)
    .slice(0, n);
}

/** The classes that take both (each at least `min` of the time), and their gaps' mean size, bb. */
export function mixing(gaps: EvGap[], min = 0.05): { n: number; meanAbs: number | null } {
  const both = gaps.filter((g) => g.d !== null && g.fx >= min && g.fy >= min);
  return { n: both.length, meanAbs: both.length ? both.reduce((s, g) => s + Math.abs(g.d!), 0) / both.length : null };
}
