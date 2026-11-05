import { useState } from "react";
import { Link } from "react-router";
import { LIBRARY_SOURCES, type LibraryChoice } from "@/config";
import { useRuntime } from "@/solver/runtime";
import type { SolveMode } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { readClassicSpeed } from "@/features/analyze/classic";
import { ModePicker, ModeTimes } from "@/features/study/ModePicker";

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
      setSaid(m ? `Set to ${SPEED_LABEL[m]}, the speed saved on the older gto-solver site.` : "The older gto-solver site has no speed saved in this browser.");
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
      (read only: its settings are left as they are; its other settings have no counterpart here).{" "}
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
      <p className="text-sm text-muted">Saved in this browser (IndexedDB). Nothing leaves your device.</p>

      <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 font-medium">Solve accuracy</legend>
        <ModePicker />
        <p className="text-xs text-muted">
          In the browser, Fast stops once a heads-up street settles; the local Python solver runs its whole budget.
          Accurate aims at about 0.1% of the pot heads-up; Quick solves a smaller game and is rough on turns. Study offers
          Fast and Accurate only and runs Quick at Fast. Library flops answer instantly at every speed (on the local
          solver, the flops of its own library).
        </p>
        <ModeTimes />
        <ClassicSpeed />
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 font-medium">Solver backend</legend>
        <p className="text-xs text-muted">
          <Link to="/engine" className="underline">
            Engine status
          </Link>{" "}
          shows the solver runtime, its threads, versions and diagnostics.
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

      <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 font-medium">Precomputed library</legend>
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

      <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 font-medium">Display</legend>
        <label className="flex items-center gap-2 text-sm">
          EV in
          <select className="rounded border border-border bg-surface-2 px-2 py-1" value={s.evUnit} onChange={(e) => s.set({ evUnit: e.target.value as "bb" | "pot" })}>
            <option value="bb">big blinds</option>
            <option value="pot">% of pot</option>
          </select>
        </label>
        <p className="text-xs text-muted">Applies to Study's action buttons and the hand-class panel; the EV grid shades in bb either way.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.studyKeys} onChange={(e) => s.set({ studyKeys: e.target.checked })} />
          Keyboard shortcuts in Study
        </label>
        <p className="text-xs text-muted">
          The number keys play an action or pick a brush, b opens the range builder, and Backspace and the arrow keys walk the line. The number keys, b and Backspace only work
          with focus away from buttons, links and fields. Turn this off if the keys get in the way of speech input or another tool.
        </p>
      </fieldset>

      <button type="button" onClick={s.reset} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
        Reset to defaults
      </button>
    </div>
  );
}
