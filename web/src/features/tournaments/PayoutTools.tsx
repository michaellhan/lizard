// The Tournaments page's ways to fill the payouts beyond typing them: a room-style structure of Lizard's own (an MTT's by
// its entrants, trimmed to the players left), a payout table imported from a CSV or text file (checked, and said what it
// read), or the payouts of a saved spot (a spot saved from Study keeps its tournament: that's how a table is kept).
import { useEffect, useState } from "react";
import type { SavedSpot } from "@/data/db";
import { listSpots } from "@/data/saved";
import { PAYOUT_STRUCTURES, prizesLeft, readPayoutTable } from "./tournament";

/** A saved spot's payouts, where it has a tournament's (its Advisor state's `payouts`). */
export const spotPayouts = (s: Pick<SavedSpot, "state">): number[] | null => {
  const p = (s.state as { payouts?: unknown }).payouts;
  return Array.isArray(p) && p.length >= 2 && p.every((x) => typeof x === "number" && Number.isFinite(x) && x > 0) ? (p as number[]) : null;
};

const BTN = "rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2";
const SEL = "rounded-md border border-border bg-surface-2 px-2 py-1 text-xs";

export function PayoutTools({ playersLeft, onPayouts }: { playersLeft: number; onPayouts: (text: string) => void }) {
  const [which, setWhich] = useState("");
  const [entrants, setEntrants] = useState("1000");
  const [said, setSaid] = useState<{ note: string; problems: string[] } | null>(null);
  const [spots, setSpots] = useState<SavedSpot[]>([]);
  useEffect(() => {
    void listSpots()
      .then((xs) => setSpots(xs.filter((s) => spotPayouts(s))))
      .catch(() => setSpots([]));
  }, []);
  const st = PAYOUT_STRUCTURES.find((x) => x.name === which);
  const e = Number(entrants);
  const entrantsOk = Number.isInteger(e) && e >= Math.max(2, playersLeft) && e <= 100000;

  const apply = () => {
    if (!st || (st.byEntrants && !entrantsOk)) return;
    const all = st.of(e);
    const left = prizesLeft(all, playersLeft);
    onPayouts(left.join(" "));
    setSaid({
      note: `${st.name}: ${all.length} places paid${st.byEntrants ? ` of ${e.toLocaleString()} entrants` : ""}; ${left.length < all.length ? `the first ${left.length}, for the ${playersLeft} players left` : "all of them still to pay"}`,
      problems: [],
    });
  };

  const imported = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200_000) {
      setSaid({ note: `${f.name}: not read`, problems: ["a payout table is a few KB: this file is too big to be one"] });
      return;
    }
    const r = readPayoutTable(await f.text());
    if (r.payouts.length) onPayouts(r.text);
    setSaid({ note: `${f.name}: ${r.note}`, problems: r.problems });
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">Structures:</span>
        <select aria-label="Payout structure" className={`${SEL} min-w-0 max-w-full`} value={which} onChange={(ev) => setWhich(ev.target.value)}>
          <option value="">A room-style structure…</option>
          {PAYOUT_STRUCTURES.map((x) => (
            <option key={x.name} value={x.name} title={x.about}>
              {x.name} ({x.about})
            </option>
          ))}
        </select>
        {st?.byEntrants && (
          <label className="flex items-center gap-1">
            <span className="text-muted">Entrants</span>
            <input aria-label="Entrants" type="number" inputMode="numeric" min={Math.max(2, playersLeft)} step={1} value={entrants} onChange={(ev) => setEntrants(ev.target.value)} aria-invalid={!entrantsOk} className={`${SEL} w-20`} />
          </label>
        )}
        <button type="button" disabled={!st || (st.byEntrants && !entrantsOk)} onClick={apply} className={`${BTN} disabled:opacity-40`}>
          Use
        </button>
        <label className={`${BTN} cursor-pointer`} title="A CSV or text file: a place and a prize a line">
          Import a file
          <input
            type="file"
            aria-label="Import a payout table"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            className="sr-only"
            onChange={(ev) => {
              void imported(ev.target.files?.[0]);
              ev.target.value = "";
            }}
          />
        </label>
        {spots.length > 0 && (
          <select
            aria-label="Payouts of a saved spot"
            className={`${SEL} min-w-0 max-w-full`}
            value=""
            onChange={(ev) => {
              const s = spots.find((x) => x.id === ev.target.value);
              const p = s && spotPayouts(s);
              if (!p) return;
              onPayouts(p.join(" "));
              setSaid({ note: `${s.title}: ${p.length} places, as saved`, problems: [] });
            }}
          >
            <option value="">From a saved spot…</option>
            {spots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({spotPayouts(s)!.length} places)
              </option>
            ))}
          </select>
        )}
      </div>
      {st?.byEntrants && !entrantsOk && <p className="text-xs text-danger">The entrants must be a whole number from {Math.max(2, playersLeft)} (the players left) to 100,000.</p>}
      {said && (
        <p className="text-xs text-muted" aria-live="polite">
          {said.note}
          {said.problems.length > 0 && <span className="text-danger"> — {said.problems.join("; ")}</span>}
        </p>
      )}
    </div>
  );
}
