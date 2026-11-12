import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { capWords, TREE_CAPS, type TreeCap } from "@/solver/treeDepth";
import { useSettings } from "@/state/settings";
import { ModePicker } from "@/features/study/ModePicker";

// (off until the service is deployed, by LIZARD_SYNC in the deploy: docs/DEPLOYMENT.md)
const SyncPanel = import.meta.env.VITE_SYNC === "on" ? lazy(() => import("./SyncPanel")) : null;

export function SettingsPage() {
  const s = useSettings();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-muted">Saved in this browser only.</p>

      <fieldset className="space-y-2 panel p-4">
        <legend className="font-medium">Solve accuracy</legend>
        <ModePicker />
        <p className="text-xs text-muted">Study runs Quick at Fast. Library flops are instant.</p>
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
        <p className="text-xs text-muted">A bigger tree is cut to fit.</p>
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
      </fieldset>

      {SyncPanel && (
        <Suspense fallback={null}>
          <SyncPanel />
        </Suspense>
      )}

      <p className="text-xs text-muted">
        <Link to="/engine" className="underline hover:text-text">
          Engine status
        </Link>
        {" · "}
        <Link to="/library" className="underline hover:text-text">
          What&rsquo;s precomputed
        </Link>
      </p>

      <button type="button" onClick={s.reset} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
        Reset to defaults
      </button>
    </div>
  );
}
