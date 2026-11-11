import { rowKeys } from "@/components/rowKeys";
import { useSettings } from "@/state/settings";
import { modeTimesText, useTimings } from "@/solver/timings";
import type { SolveMode } from "@/solver/types";

const MODES: { id: SolveMode; label: string; hint: string }[] = [
  {
    id: "quick",
    label: "Quick",
    hint: "1.5 s a street on a smaller game; turns rough",
  },
  {
    id: "fast",
    label: "Fast",
    hint: "About 8 s a street (2.5 s on the local solver)",
  },
  {
    id: "accurate",
    label: "Accurate",
    hint: "About 60 s a street (30 s local); aims at 0.1% of the pot",
  },
];

/** The solve mode setting. `modes` limits the choices shown (Study offers Fast and Accurate). */
export function ModePicker({ modes }: { modes?: SolveMode[] } = {}) {
  const picked = useSettings((s) => s.mode);
  const set = useSettings((s) => s.set);
  const transport = useSettings((s) => s.transport);
  const times = useTimings();
  const shown = modes ? MODES.filter((m) => modes.includes(m.id)) : MODES;
  // a setting outside the choices shown runs as the first one shown (Study: Quick runs at Fast)
  const mode = shown.some((m) => m.id === picked) ? picked : shown[0]?.id;
  return (
    <div role="radiogroup" aria-label="Solve accuracy" onKeyDown={rowKeys("radio", (i) => set({ mode: shown[i]!.id }))} className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-sm">
      {shown.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={mode === m.id}
          tabIndex={mode === m.id ? 0 : -1}
          title={`${m.hint}. ${measuredHint(modeTimesText(times, transport, m.id))}`}
          onClick={() => set({ mode: m.id })}
          className={`rounded px-2.5 py-1 ${mode === m.id ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

const measuredHint = (t: string | null) =>
  t ? `Measured in this browser: ${t}` : "Not measured in this browser yet";
