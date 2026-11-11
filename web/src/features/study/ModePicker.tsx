import { rowKeys } from "@/components/rowKeys";
import { useSettings } from "@/state/settings";
import { clearTimings, KEEP, modeTimesText, secondsText, STREETS, timingOf, useTimings } from "@/solver/timings";
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
        Median of the last {KEEP} live solves ({transport === "http" ? "local solver" : "this browser"}), count in brackets.{" "}
        {any && (
          <button type="button" onClick={clearTimings} className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2">
            Clear
          </button>
        )}
      </p>
    </div>
  );
}
