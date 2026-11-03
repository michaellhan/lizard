import { useSettings } from "@/state/settings";
import type { SolveMode } from "@/solver/types";

const MODES: { id: SolveMode; label: string; hint: string }[] = [
  { id: "quick", label: "Quick", hint: "~2 s budget, smaller game: rough" },
  { id: "fast", label: "Fast", hint: "~8 s budget; settles at 0.2-0.3% of the pot heads-up" },
  { id: "accurate", label: "Accurate", hint: "~60 s budget; aims at 0.1% of the pot" },
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
