// Action naming and colors. The Advisor names actions "fold", "check", "call", "bet …", "raise …", "all-in";
// bets and raises carry amount_bb. Bet/raise sizes are shaded by their rank within the node (small -> large).

export type ActionKind = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export function kindOf(name: string): ActionKind {
  if (name === "all-in") return "all-in";
  const m = /^(check|call|fold|bet|raise)/.exec(name);
  return (m?.[1] as ActionKind | undefined) ?? "bet";
}

const AGG = ["var(--color-act-bet1)", "var(--color-act-bet2)", "var(--color-act-bet3)", "var(--color-act-bet4)"];

/** One color per action of a node, aligned with `names`. */
export function actionColors(names: readonly string[]): string[] {
  const aggressive = names.filter((n) => {
    const k = kindOf(n);
    return k === "bet" || k === "raise";
  });
  return names.map((n) => {
    const k = kindOf(n);
    if (k === "fold") return "var(--color-act-fold)";
    if (k === "check" || k === "call") return "var(--color-act-check)";
    if (k === "all-in") return "var(--color-act-allin)";
    const i = aggressive.indexOf(n);
    const step = aggressive.length <= 1 ? 1 : Math.round((i * (AGG.length - 1)) / (aggressive.length - 1));
    return AGG[Math.min(step, AGG.length - 1)]!;
  });
}

export function pct(x: number | undefined, digits = 1): string {
  return x === undefined || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(digits)}%`;
}

export function bb(x: number | undefined, digits = 2): string {
  return x === undefined || Number.isNaN(x) ? "–" : `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(digits)}`;
}
