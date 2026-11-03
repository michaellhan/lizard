import { useSettings } from "@/state/settings";
import { clearTimings, KEEP, modeTimesText, secondsText, STREETS, timingOf, useTimings } from "@/solver/timings";
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
  const transport = useSettings((s) => s.transport);
  const times = useTimings();
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
  t ? `Measured in this browser: ${t} (the median of the last live solves, how many in brackets)` : "Not measured in this browser yet";

/** The modes' solve times measured in this browser (solver/timings.ts) on the backend in use: the median of the last
 * live answers per street, heads-up and multiway, with how many; "–" where none has come in. */
export function ModeTimes() {
  const transport = useSettings((s) => s.transport);
  const times = useTimings();
  const rows = MODES.flatMap((m) =>
    [false, true].map((mw) => ({ m, mw, cells: STREETS.map((st) => timingOf(times, transport, m.id, st, mw)) })),
  ).filter((r) => !r.mw || r.cells.some(Boolean));
  const any = rows.some((r) => r.cells.some(Boolean));
  return (
    <div className="space-y-1">
      <table className="text-left text-xs" aria-label="Solve times measured in this browser">
        <thead className="text-muted">
          <tr>
            <th className="py-0.5 pr-4 font-normal">Measured here</th>
            {STREETS.map((st) => (
              <th key={st} className="py-0.5 pr-4 font-normal">
                {st}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map(({ m, mw, cells }) => (
            <tr key={`${m.id}${mw}`} className="border-t border-border">
              <td className="py-0.5 pr-4 font-sans">
                {m.label}
                {mw ? ", multiway" : ""}
              </td>
              {cells.map((t, i) => (
                <td key={STREETS[i]} className="py-0.5 pr-4">
                  {t ? `${secondsText(t.median)} (${t.n})` : "–"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">
        The median time of the last {KEEP} live solves at each mode and street ({transport === "http" ? "on the local solver" : "in this browser's solver"}), how many in brackets, as the
        engine measured them: the whole answer, the narrowing of earlier streets included. Library flops, answers at once and repeats of a spot already solved on the page aren't
        counted. Kept in this browser only.{" "}
        {any && (
          <button type="button" onClick={clearTimings} className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2">
            Clear
          </button>
        )}
      </p>
    </div>
  );
}
