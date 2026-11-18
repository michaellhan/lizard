// The 13x13 hand-class matrix. Each cell shows its class's action mix as bars side by side, filling the cell, as a bar filled
// only to the class's weight read as a mix that didn't add up. A class barely in the range here (under half its combos:
// folded earlier, or blocked by the board) is faded, down to a quarter at none; above half it's drawn in full, as most of a
// postflop range is short a few combos to the board alone. The weight view alone draws a class's weight as its height. `colors` are the
// actions' fills (actionFills), whose patterns and the gap between shares keep a mix readable without its colours.
// Rendered as a DOM grid (169 cells) — cheap enough, and accessible: every cell is a labelled button, one tab stop in all.
import { memo } from "react";
import { classCombos, classLabel, RANKS } from "@/engine/nlhe/cards";
import type { GridCell } from "@/solver/protocol";
import { pct } from "./actions";
import { useRovingGrid } from "./rovingGrid";

export interface RangeMatrixProps {
  /** class -> cell; classes absent are out of the range */
  cells: Record<string, Pick<GridCell, "w" | "f"> & Partial<GridCell>>;
  actions: readonly string[];
  colors: readonly string[];
  selected?: string | null;
  onSelect?: (cls: string) => void;
  /** "mix": stacked action bars; "weight": range weight only; "ev"/"eq"/"eqr": heat by value */
  view?: "mix" | "weight" | "ev" | "eq" | "eqr";
  /** for views "ev" and "eqr": the value range mapped onto the color scale */
  evRange?: [number, number];
  /** view "ev": shade by this action's EV instead of the mix's */
  evAction?: number | null;
  /** the pot in bb (view "eqr": EV / (equity x pot)) */
  potBb?: number;
  /** hidden actions (filters): their share is drawn empty */
  hidden?: ReadonlySet<number>;
  caption?: string;
}

/** A cell's value in a heat view (null where it has none: the Advisor's nulls, or no equity for EQR). */
export function cellValue(
  cell: Partial<GridCell> | undefined,
  view: "ev" | "eq" | "eqr",
  evAction?: number | null,
  potBb?: number,
): number | null {
  if (!cell) return null;
  if (view === "eq") return cell.eq ?? null;
  const ev = evAction != null ? (cell.ev?.[evAction] ?? null) : (cell.evm ?? null);
  if (view === "ev") return ev;
  const eq = cell.eq;
  return ev != null && eq != null && eq > 0 && potBb ? ev / (eq * potBb) : null;
}

/** The whole range's share taking each action: every class's mix weighted by its combos in the range (null with no combos). */
export function rangeMix(cells: RangeMatrixProps["cells"], n: number): number[] | null {
  const out = new Array<number>(n).fill(0);
  let total = 0;
  for (const [cls, c] of Object.entries(cells)) {
    const w = Math.max(0, Math.min(1, c.w)) * classCombos(cls);
    if (!(w > 0)) continue;
    total += w;
    for (let i = 0; i < n; i++) out[i]! += w * (c.f[i] ?? 0);
  }
  return total > 0 ? out.map((x) => x / total) : null;
}

/** The actions' swatches, each with its share of the whole range (rangeMix) where the grid has one. */
export function ActionLegend({ cells, actions, colors }: { cells: RangeMatrixProps["cells"]; actions: readonly string[]; colors: readonly string[] }) {
  const mix = rangeMix(cells, actions.length);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {actions.map((a, i) => (
        <span key={a} className="inline-flex items-center gap-1">
          <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
          {a}
          {mix && <span className="font-mono text-muted">{pct(mix[i])}</span>}
        </span>
      ))}
    </div>
  );
}

/** A cell in words, as a reader meets it in the grid and as a page says the hand class just picked. */
export function cellLabel(cls: string, cell: RangeMatrixProps["cells"][string] | undefined, actions: readonly string[]): string {
  if (!cell) return `${cls}: not in range`;
  const w = Math.max(0, Math.min(1, cell.w));
  return `${cls}: ${pct(w, 0)} in range${actions.map((a, i) => `, ${a} ${pct(cell.f[i], 0)}`).join("")}${cell.ev && cell.evm != null ? `, EV ${cell.evm.toFixed(2)}bb` : ""}${
    cell.eq != null ? `, equity ${pct(cell.eq, 0)}` : ""
  }`;
}

function heat(t: number): string {
  // 0 -> slate, 1 -> accent green, through teal
  const c = Math.max(0, Math.min(1, t));
  const hue = 210 - 110 * c;
  return `hsl(${hue} 55% ${28 + 22 * c}%)`;
}

const Cell = memo(function Cell({
  cls,
  cell,
  actions,
  colors,
  active,
  tabbable,
  onSelect,
  view,
  evRange,
  evAction,
  potBb,
  hidden,
}: {
  cls: string;
  cell: RangeMatrixProps["cells"][string] | undefined;
  actions: readonly string[];
  colors: readonly string[];
  active: boolean;
  tabbable: boolean;
  onSelect?: (cls: string) => void;
  view: NonNullable<RangeMatrixProps["view"]>;
  evRange?: [number, number];
  evAction?: number | null;
  potBb?: number;
  hidden?: ReadonlySet<number>;
}) {
  const w = cell ? Math.max(0, Math.min(1, cell.w)) : 0;
  const label = cellLabel(cls, cell, actions);

  let fill: React.ReactNode = null;
  if (cell && w > 0) {
    if (view === "mix") {
      fill = (
        <div className="absolute inset-0 flex gap-px" style={w < 0.5 ? { opacity: 0.25 + 1.5 * w } : undefined}>
          {cell.f.map((f, i) =>
            f > 0 ? (
              <div
                key={i}
                style={{ width: `${f * 100}%`, background: hidden?.has(i) ? "transparent" : colors[i] }}
                className={hidden?.has(i) ? "border-y border-border" : ""}
              />
            ) : null,
          )}
        </div>
      );
    } else if (view === "weight") {
      fill = <div className="keep-colour absolute inset-x-0 bottom-0 bg-accent/70" style={{ height: `${w * 100}%` }} />;
    } else {
      const v = cellValue(cell, view, evAction, potBb);
      const [lo, hi] = view === "eq" ? [0, 1] : (evRange ?? [0, 1]);
      // (no value: the class's weight in a neutral fill, not the colour of the scale's bottom)
      fill =
        v == null ? (
          <div className="keep-colour absolute inset-0 bg-surface-3" />
        ) : (
          <div className="keep-colour absolute inset-0" style={{ background: heat((v - lo) / (hi - lo || 1)) }} />
        );
    }
  }

  return (
    <button
      type="button"
      role="gridcell"
      aria-label={label}
      aria-selected={active}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSelect?.(cls)}
      className={`relative aspect-square min-w-0 overflow-hidden rounded-[3px] bg-surface-2 text-left ${
        active ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""
      }`}
    >
      {fill}
      {/* (on a plate: the mix's colours and patterns run under it, and the lightest would take the label with them) */}
      <span className="cell-label pointer-events-none absolute left-0 top-0 z-10 rounded-br-[3px] bg-bg/60 px-[3px] py-px text-[clamp(7px,1.15vw,11px)] font-semibold leading-none tracking-tight text-text">
        {cls}
      </span>
    </button>
  );
});

export function RangeMatrix({
  cells,
  actions,
  colors,
  selected,
  onSelect,
  view = "mix",
  evRange,
  evAction,
  potBb,
  hidden,
  caption,
}: RangeMatrixProps) {
  const { stop, gridProps } = useRovingGrid(selected);
  return (
    <div role="grid" aria-label={caption ?? "Range matrix"} className="grid w-full grid-cols-13 gap-[2px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }} {...gridProps}>
      {RANKS.map((_, i) => (
        <div role="row" key={i} className="contents">
          {RANKS.map((__, j) => {
            const cls = classLabel(i, j);
            return (
              <Cell
                key={cls}
                cls={cls}
                cell={cells[cls]}
                actions={actions}
                colors={colors}
                active={selected === cls}
                tabbable={stop === cls}
                onSelect={onSelect}
                view={view}
                evRange={evRange}
                evAction={evAction}
                potBb={potBb}
                hidden={hidden}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
