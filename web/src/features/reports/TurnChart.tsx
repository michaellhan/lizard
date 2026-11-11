// The turn report's chart: the table's rows as columns of their mix, All turns first, drawn as the flop report's group
// columns are (ReportChart.tsx). The first action sits on the baseline, so how far a kind of turn card moves it reads off
// the columns' heights, and the bar on a column is its margin, so a move inside the margin reads as one. Hover, tab to or
// tap a column for its numbers; the table under it holds every one.
import { useState } from "react";
import { actionFills, pct } from "@/components/actions";
import { sourceLabel } from "@/solver/provenance";
import { ActionLegend, Axis, Grid, Mix, Tip } from "./ReportChart";
import { marginText, MIN_FLOPS_FOR_MARGIN, standsOn, whoText, type SampleState, type TurnRow, type TurnTable, type TurnWho } from "./turnReport";

/** what fits under a column at phone width, where there's a little over 40px each */
const SHORT: Record<TurnRow["cls"], string> = { all: "All", over: "Over", under: "Under", brick: "Brick", pair: "Pair", straight: "Straight", flush: "Flush" };

const flopsText = (n: number) => `${n} ${n === 1 ? "flop" : "flops"}`;
const marginWords = (r: TurnRow) => (r.margin == null ? "too few flops for a margin" : r.margin === 0 ? "no sampling margin" : `margin ${marginText(r)} points`);

/** The margin as a bar around the first action's share. It's the row's widest over the actions, so that share's own is
 * no wider. Nothing to draw with one action, or with every flop read. */
function MarginBar({ r, single }: { r: TurnRow; single: boolean }) {
  if (single || !r.margin) return null;
  const at = r.mix[0] ?? 0;
  const top = Math.min(1, at + r.margin);
  const bottom = Math.max(0, at - r.margin);
  return (
    <span aria-hidden data-margin className="pointer-events-none absolute left-1/2 z-10 flex w-2 -translate-x-1/2 justify-center border-y-2 border-text shadow-[0_0_0_1px_var(--color-surface)]" style={{ top: `${(1 - top) * 100}%`, bottom: `${bottom * 100}%` }}>
      <span className="block w-0.5 bg-text" />
    </span>
  );
}

export function TurnChart({ table, who, seats, sample }: { table: TurnTable; who: TurnWho; seats: readonly string[]; sample: SampleState }) {
  const { cols, rows } = table;
  const [hover, setHover] = useState<TurnRow["cls"] | null>(null);
  const colors = actionFills(cols);
  // (kept by name: a read still going can add a row under the pointer)
  const at = rows.findIndex((r) => r.cls === hover);
  const h = rows[at];
  const few = rows.some((r) => r.margin == null);
  return (
    <figure aria-label="Turn report chart" className="space-y-2 rounded-lg border border-border p-2">
      <figcaption className="text-xs text-muted">
        {whoText(who, seats)}: {sourceLabel("library-turn")}, averaged here. {standsOn(sample)}
      </figcaption>
      <ActionLegend cols={cols} colors={colors} />
      <div className="flex h-36">
        <Axis />
        <div className="relative flex flex-1 items-stretch" onPointerLeave={() => setHover(null)}>
          <Grid />
          {rows.map((r) => (
            <button
              key={r.cls}
              type="button"
              aria-label={`${r.label}: ${cols.map((c, i) => `${c} ${pct(r.mix[i])}`).join(", ")}; ${marginWords(r)}; ${flopsText(r.flops)}; ${pct(r.turns, 0)} of turns`}
              onClick={() => setHover(r.cls)}
              onPointerEnter={() => setHover(r.cls)}
              onFocus={() => setHover(r.cls)}
              onBlur={() => setHover(null)}
              className="relative z-10 flex flex-1 justify-center focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className={`flex h-full w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] ${hover === r.cls ? "opacity-100" : hover != null ? "opacity-60" : ""}`}>
                {r.mix.map((x, i) => (x > 0.001 ? <span key={i} className="block" style={{ flex: `${x} 1 0`, background: colors[i] }} /> : null))}
              </span>
              <MarginBar r={r} single={cols.length < 2} />
            </button>
          ))}
          {h && (
            <Tip at={(at + 0.5) / rows.length}>
              <b>{h.label}</b> <span className="text-muted">· {pct(h.turns, 0)} of turns</span>
              <Mix freqs={h.mix} cols={cols} colors={colors} />
              <p className="mt-1 text-muted">
                {flopsText(h.flops)}, {marginWords(h)}
              </p>
            </Tip>
          )}
        </div>
      </div>
      <div aria-hidden className="text-[11px] leading-tight text-muted tabular-nums">
        <div className="flex">
          <span className="w-8 shrink-0" />
          {rows.map((r) => (
            <span key={r.cls} className={`min-w-0 flex-1 text-center ${r.cls === "all" ? "font-semibold text-text" : ""}`}>
              {SHORT[r.cls]}
            </span>
          ))}
        </div>
        <div className="flex">
          <span className="w-8 shrink-0 pr-1 text-right text-[10px]">flops</span>
          {rows.map((r) => (
            <span key={r.cls} className="min-w-0 flex-1 text-center">
              {r.flops}
              {r.margin == null ? "*" : ""}
            </span>
          ))}
        </div>
      </div>
      {few && <p className="text-xs text-muted">* Under {MIN_FLOPS_FOR_MARGIN} flops: no margin.</p>}
    </figure>
  );
}
