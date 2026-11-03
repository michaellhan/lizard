// Range editor: paint classes into a range at a chosen weight, or paste solver-format text; save it under a name
// (kept in this browser, listed on the Saved page; `?range=<id>` opens a saved one). Grading a painted strategy
// against a solution is Study's range builder (✎ Build).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { RangeMatrix } from "@/components/RangeMatrix";
import type { SavedRange } from "@/data/db";
import { getRange, listRanges, newId, putRange } from "@/data/saved";
import { formatRange, parseRange, rangeCombos, type ClassWeights } from "./rangeText";

export function RangesPage() {
  const [params, setParams] = useSearchParams();
  const [weights, setWeights] = useState<ClassWeights>(() => parseRange("22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+").weights);
  const [brush, setBrush] = useState(1);
  const [text, setText] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedRange[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const openId = params.get("range");

  useEffect(() => {
    let alive = true;
    void listRanges().then((r) => alive && setSaved(r));
    return () => {
      alive = false;
    };
  }, [n]);

  // a saved range opened by link (the Saved page's "Open in Ranges")
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    void getRange(openId).then((r) => {
      if (!alive) return;
      if (!r) return setMsg("That saved range isn't in this browser.");
      setWeights(parseRange(r.text).weights);
      setName(r.name);
      setText("");
      setMsg(`Opened “${r.name}”.`);
    });
    return () => {
      alive = false;
    };
  }, [openId]);

  const save = async () => {
    const nm = name.trim();
    if (!nm) return;
    const t = Date.now();
    // (looked up in the store, not the list shown: that may not have caught up with a save just made)
    const same = (await listRanges()).find((r) => r.name === nm);
    const r: SavedRange = { id: same?.id ?? newId(), name: nm, text: formatRange(weights), combos: rangeCombos(weights), note: same?.note ?? "", createdAt: same?.createdAt ?? t, updatedAt: t };
    await putRange(r);
    setMsg(same ? `Updated “${nm}”.` : `Saved “${nm}” in this browser.`);
    setN((x) => x + 1);
  };

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
          <form
            aria-label="Save range"
            className="space-y-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="block text-sm font-medium" htmlFor="range-name">
              Save this range
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="range-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name, e.g. UTG open 100bb"
                className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-sm"
              />
              <button type="submit" disabled={!name.trim()} className="rounded bg-accent px-3 py-1 text-sm font-medium text-bg disabled:opacity-40">
                Save
              </button>
            </div>
            {saved.length > 0 && (
              <select
                aria-label="Open a saved range"
                className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-sm"
                value=""
                onChange={(e) => e.target.value && setParams({ range: e.target.value })}
              >
                <option value="">Open a saved range…</option>
                {saved.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.combos.toFixed(1)} combos
                  </option>
                ))}
              </select>
            )}
            {msg && (
              <p role="status" className="text-xs">
                {msg}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
