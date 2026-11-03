// Range builder (first cut): paint classes into a range at a chosen weight, or paste solver-format text.
// Grading a painted range against a solution is a planned next step (docs/ROADMAP.md).
import { useMemo, useState } from "react";
import { RangeMatrix } from "@/components/RangeMatrix";
import { formatRange, parseRange, rangeCombos, type ClassWeights } from "./rangeText";

export function RangesPage() {
  const [weights, setWeights] = useState<ClassWeights>(() => parseRange("22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+").weights);
  const [brush, setBrush] = useState(1);
  const [text, setText] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);

  const cells = useMemo(
    () => Object.fromEntries(Object.entries(weights).map(([c, w]) => [c, { w, f: [1] }])),
    [weights],
  );
  const combos = rangeCombos(weights);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Ranges</h1>
        <p className="text-sm text-muted">Click classes to paint them at the brush weight (click again to clear). Text uses the common solver format.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              <b>{combos.toFixed(1)}</b> combos · {((combos / 1326) * 100).toFixed(1)}% of hands
            </span>
            <label className="flex items-center gap-2">
              Brush
              <input type="range" min={0.05} max={1} step={0.05} value={brush} onChange={(e) => setBrush(Number(e.target.value))} aria-label="Brush weight" />
              <span className="w-10 font-mono">{Math.round(brush * 100)}%</span>
            </label>
            <button type="button" className="rounded border border-border px-2 py-0.5" onClick={() => setWeights({})}>
              Clear
            </button>
          </div>
          <RangeMatrix
            cells={cells}
            actions={["in range"]}
            colors={["var(--color-accent)"]}
            view="weight"
            onSelect={(cls) =>
              setWeights((w) => {
                const next = { ...w };
                if (Math.abs((next[cls] ?? 0) - brush) < 1e-6) delete next[cls];
                else next[cls] = brush;
                return next;
              })
            }
            caption="Range being edited"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="range-text">
            Range text
          </label>
          <textarea
            id="range-text"
            className="h-40 w-full rounded border border-border bg-surface-2 p-2 font-mono text-xs"
            value={text || formatRange(weights)}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-accent px-3 py-1 text-sm font-medium text-bg"
              onClick={() => {
                const r = parseRange(text || formatRange(weights));
                setWeights(r.weights);
                setUnknown(r.unknown);
                setText("");
              }}
            >
              Apply text
            </button>
            <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={() => void navigator.clipboard?.writeText(formatRange(weights))}>
              Copy
            </button>
          </div>
          {unknown.length > 0 && <p className="text-xs text-warn">Not understood: {unknown.join(", ")}</p>}
        </div>
      </div>
    </div>
  );
}
