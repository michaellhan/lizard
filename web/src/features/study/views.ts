// What Study offers for an answer, as upstream study.js's viewsOf and actionsHtml do: a preflop chart or a read at
// once has no EVs or equities to show (the Advisor sends them as null), so only its strategy.
import { bb, pct } from "@/components/actions";
import type { AdvisorActionStat, AdvisorResponse, ComboRow } from "@/solver/protocol";

/** mix: the strategy; ev: EV heat; eq: equity heat; eqr: equity realization, EV / (equity x pot) */
export type GridView = "mix" | "ev" | "eq" | "eqr";

export const VIEW_LABELS: Record<GridView, string> = { mix: "Strategy", ev: "EV", eq: "Equity", eqr: "EQR" };

export function viewsOf(res: AdvisorResponse): GridView[] {
  if (res.street === "preflop") return res.source === "solver" ? ["mix", "ev"] : ["mix"];
  if (res.approximate) return ["mix"];
  // (EQR needs both the EV and the equity)
  return res.range_eq != null ? ["mix", "ev", "eq", "eqr"] : ["mix", "ev"];
}

/** Equity realization: EV share of the pot relative to raw equity (upstream study.js's eqr). */
export function eqr(evm: number | null | undefined, eq: number | null | undefined, potBb: number | undefined): number | undefined {
  if (evm == null || eq == null || !potBb || eq <= 0) return undefined;
  return evm / (eq * potBb);
}

/** A combo's EV in bb: its own mix over its own EVs. */
export function comboEv(row: ComboRow): number | undefined {
  const evs = row[3];
  if (!evs) return undefined;
  return row[2].reduce((t, f, a) => t + f * (evs[a] ?? 0), 0);
}

/** A combo's EQR, on `eqr`'s definition from that combo's own EV and equity, or why it has none. */
export function comboEqr(row: ComboRow, potBb: number | undefined): { value: number; why?: undefined } | { value?: undefined; why: string } {
  const ev = comboEv(row);
  const eq = row[4];
  const value = eqr(ev, eq, potBb);
  if (value !== undefined) return { value };
  if (ev === undefined && eq == null) return { why: "this answer has no EV or equity by combo" };
  if (ev === undefined) return { why: "this answer has no EV by combo" };
  if (eq == null) return { why: "this answer has no equity by combo" };
  return potBb ? { why: "0% equity: no share of the pot to realize" } : { why: "this answer has no pot" };
}

/** An action button's line: frequency, combos, and its range EV where the answer has one ("≈" when rough). */
export function actionLine(a: AdvisorActionStat, ev: (x: number) => string = bb): string {
  const e = typeof a.ev_bb === "number" ? ` · EV ${a.rough_ev ? "≈" : ""}${ev(a.ev_bb)}` : "";
  return `${pct(a.freq)} · ${a.combos?.toFixed(1) ?? "–"} combos${e}`;
}
