// The 13x13 classes coloured by a change: blue up, red down, the stronger the bigger; darker grey where the class is in
// one range only. Every cell is a labelled button, as in RangeMatrix. DiffMatrix: one action's frequency from A to B;
// EvGapPanel: one action's EV minus another's.
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

/** One cell: the change (null: none to show), its words, and whether the class is in one range only or in neither. */
export interface DeltaCell {
  d: number | null;
  label: string;
  one?: boolean;
  present: boolean;
}

// blue up, red down; full strength at `full`, nothing under `min`
function fill(d: number | null, full: number, min: number): string | undefined {
  if (d === null || Math.abs(d) < min || !(full > 0)) return undefined;
  const a = 0.15 + 0.85 * Math.min(1, Math.abs(d) / full);
  return d > 0 ? `hsl(205 85% 55% / ${a})` : `hsl(0 80% 60% / ${a})`;
}

/** The 13x13 classes coloured by a change. */
export function DeltaMatrix({
  name,
  cellOf,
  full,
  min,
  selected,
  onSelect,
}: {
  name: string;
  cellOf: (cls: string) => DeltaCell;
  full: number;
  min: number;
  selected?: string | null;
  onSelect?: (cls: string) => void;
}) {
  return (
    <div role="grid" aria-label={name} className="grid w-full gap-[2px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
      {RANKS.map((_, i) => (
        <div role="row" key={i} className="contents">
          {RANKS.map((__, j) => {
            const cls = classLabel(i, j);
            const c = cellOf(cls);
            return (
              <button
                key={cls}
                type="button"
                role="gridcell"
                aria-label={c.label}
                aria-selected={selected === cls}
                onClick={() => onSelect?.(cls)}
                className={`relative aspect-square min-w-0 overflow-hidden rounded-[3px] text-left ${c.one ? "bg-surface-3" : "bg-surface-2"} ${
                  selected === cls ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""
                }`}
                style={{ background: fill(c.d, full, min) }}
              >
                <span
                  className={`pointer-events-none absolute left-0.5 top-0 font-mono text-[clamp(7px,1.4vw,12px)] font-medium leading-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] ${
                    c.present ? "text-text" : "text-muted"
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

/** Per class, the change in one action's frequency from A to B (full strength at 50 points). */
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
  const cellOf = (cls: string): DeltaCell => {
    const d = by.get(cls);
    const present = Boolean(d && (d.fa !== null || d.fb !== null));
    return { d: d?.dFreq ?? null, label: diffLabel(d, cls, action), one: present && d!.dFreq === null, present };
  };
  return <DeltaMatrix name={`Change in ${action}`} cellOf={cellOf} full={0.5} min={0.005} selected={selected} onSelect={onSelect} />;
}
