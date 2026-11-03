// The 13x13 hand-class matrix. Each cell shows its class's action mix as stacked bars, filled to the class's
// weight in the range (a class half in the range is half full), as the upstream Study panel draws it.
// Rendered as a DOM grid (169 cells) — cheap enough, and accessible: every cell is a labelled button.
import { memo } from "react";
import { classLabel, RANKS } from "@/engine/nlhe/cards";
import type { GridCell } from "@/solver/protocol";
import { pct } from "./actions";

export interface RangeMatrixProps {
  /** class -> cell; classes absent are out of the range */
  cells: Record<string, Pick<GridCell, "w" | "f"> & Partial<GridCell>>;
  actions: readonly string[];
  colors: readonly string[];
  selected?: string | null;
  onSelect?: (cls: string) => void;
  /** "mix": stacked action bars; "weight": range weight only; "ev"/"eq": heat by value */
  view?: "mix" | "weight" | "ev" | "eq";
  /** for view "ev": the value range mapped onto the color scale */
  evRange?: [number, number];
  /** hidden actions (filters): their share is drawn empty */
  hidden?: ReadonlySet<number>;
  caption?: string;
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
  onSelect,
  view,
  evRange,
  hidden,
}: {
  cls: string;
  cell: RangeMatrixProps["cells"][string] | undefined;
  actions: readonly string[];
  colors: readonly string[];
  active: boolean;
  onSelect?: (cls: string) => void;
  view: NonNullable<RangeMatrixProps["view"]>;
  evRange?: [number, number];
  hidden?: ReadonlySet<number>;
}) {
  const w = cell ? Math.max(0, Math.min(1, cell.w)) : 0;
  const label = cell
    ? `${cls}: ${pct(w, 0)} in range${actions.map((a, i) => `, ${a} ${pct(cell.f[i], 0)}`).join("")}${
        cell.ev && cell.evm !== undefined ? `, EV ${cell.evm.toFixed(2)}bb` : ""
      }${cell.eq !== undefined ? `, equity ${pct(cell.eq, 0)}` : ""}`
    : `${cls}: not in range`;

  let fill: React.ReactNode = null;
  if (cell && w > 0) {
    if (view === "mix") {
      fill = (
        <div className="absolute inset-x-0 bottom-0 flex" style={{ height: `${w * 100}%` }}>
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
      fill = <div className="absolute inset-x-0 bottom-0 bg-accent/70" style={{ height: `${w * 100}%` }} />;
    } else {
      const v = view === "eq" ? cell.eq : cell.evm;
      const [lo, hi] = view === "eq" ? [0, 1] : (evRange ?? [0, 1]);
      const t = v === undefined ? 0 : (v - lo) / (hi - lo || 1);
      fill = <div className="absolute inset-x-0 bottom-0" style={{ height: `${w * 100}%`, background: heat(t) }} />;
    }
  }

  return (
    <button
      type="button"
      role="gridcell"
      aria-label={label}
      aria-selected={active}
      onClick={() => onSelect?.(cls)}
      className={`relative aspect-square min-w-0 overflow-hidden rounded-[3px] bg-surface-2 text-left ${
        active ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""
      }`}
    >
      {fill}
      <span className="pointer-events-none absolute left-0.5 top-0 z-10 font-mono text-[clamp(7px,1.4vw,12px)] font-medium leading-tight text-text drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
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
  hidden,
  caption,
}: RangeMatrixProps) {
  return (
    <div role="grid" aria-label={caption ?? "Range matrix"} className="grid w-full grid-cols-13 gap-[2px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
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
                onSelect={onSelect}
                view={view}
                evRange={evRange}
                hidden={hidden}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
