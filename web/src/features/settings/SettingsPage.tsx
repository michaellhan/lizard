import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";
import { LIBRARY_SOURCES, type LibraryChoice } from "@/config";
import { useRuntime } from "@/solver/runtime";
import { capWords, TREE_CAPS, type TreeCap } from "@/solver/treeDepth";
import type { SolveMode } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { readClassicSpeed } from "@/features/analyze/classic";
import { ModePicker, ModeTimes } from "@/features/study/ModePicker";

// (off until the service is deployed, by LIZARD_SYNC in the deploy: docs/DEPLOYMENT.md)
const SyncPanel = import.meta.env.VITE_SYNC === "on" ? lazy(() => import("./SyncPanel")) : null;

const SPEED_LABEL: Record<SolveMode, string> = { quick: "Quick", fast: "Fast", accurate: "Accurate" };

/** The classic app's speed, read on request (read only) and used here. */
function ClassicSpeed() {
  const set = useSettings((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const use = async () => {
    setBusy(true);
    try {
      const m = await readClassicSpeed();
      if (m) set({ mode: m });
      setSaid(m ? `Set to ${SPEED_LABEL[m]}, the older site's speed.` : "No speed saved by the older site.");
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className="text-xs text-muted">
      Used the older gto-solver site in this browser?{" "}
      <button type="button" disabled={busy} onClick={() => void use()} className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2 disabled:opacity-40">
        Use its speed
      </button>{" "}
      {said && <span role="status">{said}</span>}
    </p>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const active = useRuntime((r) => r.librarySource);
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-muted">Saved in this browser only.</p>

      <fieldset className="space-y-2 panel p-4">
        <legend className="font-medium">Solve accuracy</legend>
        <ModePicker />
        <p className="text-xs text-muted">Study runs Quick at Fast. Library flops are instant.</p>
        <ModeTimes />
        <ClassicSpeed />
        <label className="flex items-center gap-2 text-sm">
          Tree size
          <select aria-label="Tree size" className="rounded border border-border bg-surface-2 px-2 py-1" value={s.treeCap} onChange={(e) => s.set({ treeCap: e.target.value as TreeCap })}>
            {(Object.keys(TREE_CAPS) as TreeCap[]).map((c) => (
              <option key={c} value={c}>
                {TREE_CAPS[c].label}: {capWords(c)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">The biggest tree a solve in this browser builds; a bigger one is cut to fit. Phone for little memory; Large for a desktop with memory to spare.</p>
      </fieldset>

      <fieldset className="space-y-2 panel p-4">
        <legend className="font-medium">Solver backend</legend>
        <p className="text-xs text-muted">
          <Link to="/engine" className="underline">
            Engine status
          </Link>
          : runtime and diagnostics.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="transport" checked={s.transport === "worker"} onChange={() => s.set({ transport: "worker" })} />
          In this browser (default)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="transport" checked={s.transport === "http"} onChange={() => s.set({ transport: "http" })} />
          Local Python solver (faster on flops)
        </label>
        {s.transport === "http" && (
          <div className="space-y-1 pl-6">
            <input
              aria-label="Local solver URL"
              className="w-64 rounded border border-border bg-surface-2 px-2 py-1 font-mono text-sm"
              value={s.localSolverUrl}
              onChange={(e) => s.set({ localSolverUrl: e.target.value })}
            />
            <p className="text-xs text-muted">
              Run it from a Lizard checkout: <code className="font-mono">cd solver && PYTHONPATH=. ../.venv/bin/python -m gto.server --port 8765</code>
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2 panel p-4">
        <legend className="font-medium">Precomputed library</legend>
        <select
          aria-label="Library source"
          className="rounded border border-border bg-surface-2 px-2 py-1 text-sm"
          value={s.librarySource}
          onChange={(e) => s.set({ librarySource: e.target.value as LibraryChoice })}
        >
          <option value="auto">Automatic (Lizard's when published)</option>
          {LIBRARY_SOURCES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">
          {active ? `In use: ${LIBRARY_SOURCES.find((l) => l.id === active)?.label}. ` : ""}
          Spots and flops not in the library are solved live.
        </p>
      </fieldset>

      <fieldset className="space-y-2 panel p-4">
        <legend className="font-medium">Display</legend>
        <label className="flex items-center gap-2 text-sm">
          EV in
          <select className="rounded border border-border bg-surface-2 px-2 py-1" value={s.evUnit} onChange={(e) => s.set({ evUnit: e.target.value as "bb" | "pot" })}>
            <option value="bb">big blinds</option>
            <option value="pot">% of pot</option>
          </select>
        </label>
        <p className="text-xs text-muted">In Study; the EV grid stays in bb.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.actionPatterns} onChange={(e) => s.set({ actionPatterns: e.target.checked })} />
          Patterns on action colours
        </label>
        <p className="text-xs text-muted">Dots and stripes that tell close colours apart without colour.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.studyKeys} onChange={(e) => s.set({ studyKeys: e.target.checked })} />
          Keyboard shortcuts in Study
        </label>
        <p className="text-xs text-muted">Numbers: actions or brushes; b: builder; Backspace and arrows: walk the line. Not while a field has focus.</p>
      </fieldset>

      {SyncPanel && (
        <Suspense fallback={null}>
          <SyncPanel />
        </Suspense>
      )}

      <button type="button" onClick={s.reset} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
        Reset to defaults
      </button>
    </div>
  );
}
