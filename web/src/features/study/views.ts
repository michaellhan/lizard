// What Study offers for an answer, as upstream study.js's viewsOf and actionsHtml do: a preflop chart or a read at
// once has no EVs or equities to show (the Advisor sends them as null), so only its strategy.
import { bb, pct } from "@/components/actions";
import type { AdvisorActionStat, AdvisorResponse } from "@/solver/protocol";

export type GridView = "mix" | "ev" | "eq";

export function viewsOf(res: AdvisorResponse): GridView[] {
  if (res.street === "preflop") return res.source === "solver" ? ["mix", "ev"] : ["mix"];
  if (res.approximate) return ["mix"];
  return res.range_eq != null ? ["mix", "ev", "eq"] : ["mix", "ev"];
}

/** An action button's line: frequency, combos, and its range EV where the answer has one ("≈" when rough). */
export function actionLine(a: AdvisorActionStat): string {
  const ev = typeof a.ev_bb === "number" ? ` · EV ${a.rough_ev ? "≈" : ""}${bb(a.ev_bb)}` : "";
  return `${pct(a.freq)} · ${a.combos?.toFixed(1) ?? "–"} combos${ev}`;
}
