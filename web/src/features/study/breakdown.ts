// What the Breakdown panel says about the engine's breakdown (gto/breakdown.py, classic breakdown.js): who the sides
// are, what the equities are over, and who holds the range and the nut advantage. Pure; BreakdownPanel draws it.
import { pct } from "@/components/actions";
import type { Breakdown, BreakdownSide } from "@/solver/protocol";

/** A point of nut share or less is no advantage (classic's reading). */
const NUT_LEAD = 0.01;

export const sidesOf = (bd: Breakdown): BreakdownSide[] => [bd.hero, ...bd.villains];

/** The sides an equity curve can be drawn for. */
export const curvesOf = (bd: Breakdown): BreakdownSide[] => sidesOf(bd).filter((s) => s.curve?.length);

/** What the equities are over. */
export function runoutText(bd: Breakdown): string {
  const [n, all] = bd.runouts ?? [];
  if (!n || !all) return "over the runouts";
  if (all === 1) return "on the river, no cards to come";
  if (n >= all) return all === 48 ? "with every river card dealt out" : "with every runout dealt out";
  return `over an even sample of ${n} of the ${all} turn and river runouts`;
}

const ranked = (ss: readonly BreakdownSide[], of: (s: BreakdownSide) => number | null | undefined) =>
  ss.flatMap((s) => {
    const v = of(s);
    return v == null ? [] : [{ who: s.who, v }];
  }).sort((a, b) => b.v - a.v);

/** Who has the higher equity: none with fewer than two equities to set side by side. */
export function rangeAdvantage(ss: readonly BreakdownSide[]): string | null {
  const [a, b] = ranked(ss, (s) => s.eq);
  return a && b ? `${a.who} has the range advantage (${pct(a.v)} equity).` : null;
}

/** Who has more of their range at the nut threshold, and by how much. */
export function nutAdvantage(ss: readonly BreakdownSide[], nutEq: number): string | null {
  const [a, b] = ranked(ss, (s) => s.nuts);
  if (!a || !b) return null;
  const lead = a.v - b.v;
  return lead < NUT_LEAD
    ? "Neither range has a nut advantage."
    : `${a.who} has the nut advantage: ${(lead * 100).toFixed(1)} points more of the range at ${pct(nutEq, 0)} equity or better.`;
}

/** The equity at the top `f` of a side's range. */
export function curveAt(s: BreakdownSide, f: number): number | undefined {
  const c = s.curve ?? [];
  return c[Math.round(Math.min(1, Math.max(0, f)) * (c.length - 1))];
}
