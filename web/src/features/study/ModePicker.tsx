import { useSettings } from "@/state/settings";
import type { SolveMode } from "@/solver/types";

const MODES: { id: SolveMode; label: string; hint: string }[] = [
  {
    id: "quick",
    label: "Quick",
    hint: "A 1.5 s budget a postflop street (rivers 0.8 s) on a smaller game: rivers near exact, turns rough (about 6-7% of the pot)",
  },
  {
    id: "fast",
    label: "Fast",
    hint: "A budget of 8 s a street in the browser (2.5 s on the local solver), plus 3 s (2.5 s) for each earlier street solved. It can run longer: an unsettled street gets a second budget, a 3-way flop at least 15 s, and a heads-up street also gets the unspent budget of each earlier street that cost nothing (a stored flop, or one already solved this hand). In the browser a heads-up street stops once within 0.2-0.3% of the pot; the local solver runs its whole budget",
  },
  {
    id: "accurate",
    label: "Accurate",
    hint: "A budget of 60 s a street in the browser (30 s on the local solver), plus 12 s for each earlier street solved; aims at about 0.1% of the pot",
  },
];

/** The solve mode setting. `modes` limits the choices shown (Study offers Fast and Accurate). */
export function ModePicker({ modes }: { modes?: SolveMode[] } = {}) {
  const picked = useSettings((s) => s.mode);
  const set = useSettings((s) => s.set);
  const shown = modes ? MODES.filter((m) => modes.includes(m.id)) : MODES;
  // a setting outside the choices shown runs as the first one shown (Study: Quick runs at Fast)
  const mode = shown.some((m) => m.id === picked) ? picked : shown[0]?.id;
  return (
    <div role="radiogroup" aria-label="Solve accuracy" className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-sm">
      {shown.map((m) => (
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
