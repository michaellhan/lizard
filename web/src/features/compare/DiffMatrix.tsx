// The 13x13 classes coloured by the change in one action's frequency from A to B: blue where B takes it more often,
// red where less, the stronger the bigger; grey where the class is in one range only (or neither). Every cell is a
// labelled button, as in RangeMatrix.
import { classLabel, RANKS } from "@/engine/nlhe/cards";
import { pct } from "@/components/actions";
import type { ClassDiff } from "./compare";

/** a change in frequency, in percentage points; in EV, in bb */
export const points = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)}`;
export const bbDelta = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}bb`;

/** A cell's change in words. */
export function diffLabel(d: ClassDiff | undefined, cls: string, action: string): string {
  if (!d || (d.fa === null && d.fb === null)) return `${cls}: in neither range`;
  if (d.fa === null) return `${cls}: only in B's range (${action} ${pct(d.fb, 0)})`;
  if (d.fb === null) return `${cls}: only in A's range (${action} ${pct(d.fa, 0)})`;
  return `${cls}: ${action} ${pct(d.fa)} → ${pct(d.fb)} (${points(d.dFreq!)} points)${d.dEv !== null ? `, EV ${bbDelta(d.dEv)}` : ""}`;
}

function fill(d: ClassDiff | undefined): string | undefined {
  if (!d || d.dFreq === null || Math.abs(d.dFreq) < 0.005) return undefined;
  const a = 0.15 + 0.85 * Math.min(1, Math.abs(d.dFreq) / 0.5);
  return d.dFreq > 0 ? `hsl(205 85% 55% / ${a})` : `hsl(0 80% 60% / ${a})`;
}

export function DiffMatrix({
  diffs,
  action,
  selected,
  onSelect,
}: {
  diffs: ClassDiff[];
  action: string;
  selected?: string | null;
  onSelect?: (cls: string) => void;
}) {
  const by = new Map(diffs.map((d) => [d.cls, d]));
  return (
    <div role="grid" aria-label={`Change in ${action}`} className="grid w-full gap-[2px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
      {RANKS.map((_, i) => (
        <div role="row" key={i} className="contents">
          {RANKS.map((__, j) => {
            const cls = classLabel(i, j);
            const d = by.get(cls);
            const one = d && d.dFreq === null && (d.fa !== null || d.fb !== null);
            return (
              <button
                key={cls}
                type="button"
                role="gridcell"
                aria-label={diffLabel(d, cls, action)}
                aria-selected={selected === cls}
                onClick={() => onSelect?.(cls)}
                className={`relative aspect-square min-w-0 overflow-hidden rounded-[3px] text-left ${one ? "bg-surface-3" : "bg-surface-2"} ${
                  selected === cls ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""
                }`}
                style={{ background: fill(d) }}
              >
                <span
                  className={`pointer-events-none absolute left-0.5 top-0 font-mono text-[clamp(7px,1.4vw,12px)] font-medium leading-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] ${
                    d && (d.fa !== null || d.fb !== null) ? "text-text" : "text-muted"
                  }`}
                >
                  {cls}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
