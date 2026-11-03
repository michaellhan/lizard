import { useSettings } from "@/state/settings";
import type { SolveMode } from "@/solver/types";

const MODES: { id: SolveMode; label: string; hint: string }[] = [
  { id: "quick", label: "Quick", hint: "About 1.5 s a postflop street on a smaller game: rivers near exact, turns rough (about 6-7% of the pot)" },
  { id: "fast", label: "Fast", hint: "Up to 8 s a street in the browser (2.5 s on the local solver); heads-up settles near 0.2-0.3% of the pot" },
  { id: "accurate", label: "Accurate", hint: "Up to 60 s a street in the browser (30 s on the local solver); aims at about 0.1% of the pot" },
];

export function ModePicker() {
  const mode = useSettings((s) => s.mode);
  const set = useSettings((s) => s.set);
  return (
    <div role="radiogroup" aria-label="Solve accuracy" className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-sm">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={mode === m.id}
          title={m.hint}
          onClick={() => set({ mode: m.id })}
          className={`rounded px-2.5 py-1 ${mode === m.id ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
