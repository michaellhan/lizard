// PLO4 equity: a calculator on the PLO engine layer (engine/plo/), and no more than that. It says how often hands win if
// every card is dealt with no more betting, and what produced each number. Nothing here is a strategy: PLO4 isn't solved
// in Lizard. Loaded with its route, so no PLO code is in the first download; the work is done in a worker.
import { useEffect, useRef, useState } from "react";
import { describeEquity, DEFAULT_RUNS, MAX_PLAYERS, MIN_PLAYERS, type EquityMode, type EquityResult } from "@/engine/plo/equity";
import { EquityClient } from "@/engine/plo/equityClient";

const inputClass = "rounded border border-border bg-surface px-2 py-1 font-mono text-sm";
const buttonClass = "rounded border border-border px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-40";
const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;

interface Done {
  result: EquityResult | null;
  cancelled: boolean;
  /** the seats as they were asked, whatever's been typed since */
  seats: string[];
  board: string;
  dead: string;
}

export function EquityPage() {
  const [seats, setSeats] = useState(["AsAhKsKh", "JdTd9c8c"]);
  const [board, setBoard] = useState("");
  const [dead, setDead] = useState("");
  const [mode, setMode] = useState<EquityMode>("auto");
  const [runs, setRuns] = useState(DEFAULT_RUNS);
  const [seed, setSeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<EquityResult | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<EquityClient | null>(null);

  useEffect(
    () => () => {
      client.current?.dispose();
    },
    [],
  );

  const run = async () => {
    const c = (client.current ??= new EquityClient());
    const asked = { seats, board, dead };
    setRunning(true);
    setError(null);
    setDone(null);
    setProgress(null);
    try {
      const { result, cancelled } = await c.run({ players: seats, board, dead, mode, runs, seed }, setProgress);
      setDone({ ...asked, result, cancelled });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const setSeat = (i: number, v: string) => setSeats((s) => s.map((x, k) => (k === i ? v : x)));

  return (
    <div className="max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">PLO4 equity</h1>
        <p className="text-sm text-muted">
          Each hand&apos;s share of the pot if every card is dealt with no more betting, two cards from the hand and three from the board. This is only a calculator: Lizard doesn&apos;t solve PLO, and equity
          isn&apos;t a strategy.
        </p>
      </header>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {seats.map((s, i) => (
          <label key={i} className="flex items-center gap-2 text-sm">
            <span className="w-20 shrink-0 text-muted">Player {i + 1}</span>
            <input aria-label={`Player ${i + 1}: hand or range`} value={s} onChange={(e) => setSeat(i, e.target.value)} className={`${inputClass} min-w-0 flex-1`} spellCheck={false} />
          </label>
        ))}
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" className={buttonClass} disabled={seats.length >= MAX_PLAYERS} onClick={() => setSeats((s) => [...s, ""])}>
            Add a player
          </button>
          <button type="button" className={buttonClass} disabled={seats.length <= MIN_PLAYERS} onClick={() => setSeats((s) => s.slice(0, -1))}>
            Remove the last
          </button>
        </div>
        <p className="text-xs text-muted">
          A hand (AsKsQhJh) or a range, separated by commas: AAxx any two aces or more; JT98ds with a suit shape (ds double-suited, ss single-suited, r rainbow); random every hand; @25 a weight in percent.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Board</span>
            <input aria-label="Board" value={board} onChange={(e) => setBoard(e.target.value)} placeholder="0, 3, 4 or 5 cards" className={`${inputClass} w-44`} spellCheck={false} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Dead cards</span>
            <input aria-label="Dead cards" value={dead} onChange={(e) => setDead(e.target.value)} className={`${inputClass} w-32`} spellCheck={false} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Method</span>
            <select aria-label="Method" value={mode} onChange={(e) => setMode(e.target.value as EquityMode)} className={inputClass}>
              <option value="auto">Exact if it&apos;s small enough</option>
              <option value="exact">Exact</option>
              <option value="montecarlo">Monte Carlo</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Runouts</span>
            <input aria-label="Monte Carlo runouts" type="number" min={1} value={runs} onChange={(e) => setRuns(Math.max(1, Math.floor(Number(e.target.value)) || 1))} className={`${inputClass} w-32`} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Seed</span>
            <input aria-label="Monte Carlo seed" type="number" min={0} value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value)) || 0))} className={`${inputClass} w-24`} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={running} className={buttonClass}>
            Calculate
          </button>
          {running && (
            <button type="button" className={buttonClass} onClick={() => client.current?.cancel()}>
              Cancel
            </button>
          )}
          {running && (
            <span role="status" className="text-sm text-muted">
              {progress ? `${progress.runouts.toLocaleString("en-US")} of ${progress.planned.toLocaleString("en-US")} boards` : "Working"}
            </span>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {done?.cancelled && !done.result && <p className="text-sm text-muted">Cancelled. An exact count has no result until every board is in.</p>}
      {done?.result && <EquityTable done={done} result={done.result} />}
    </div>
  );
}

function EquityTable({ done, result }: { done: Done; result: EquityResult }) {
  const monteCarlo = result.method === "montecarlo";
  return (
    <section aria-label="Equity" className="space-y-2">
      <p className="text-sm">{describeEquity(result)}</p>
      <div className="scroll-x">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-4 font-normal">Player</th>
              <th className="py-1 pr-4 font-normal">Hand or range</th>
              <th className="py-1 pr-4 font-normal">Equity</th>
              {monteCarlo && <th className="py-1 pr-4 font-normal">± 1 s.e.</th>}
              <th className="py-1 pr-4 font-normal">Wins</th>
              <th className="py-1 font-normal">Ties</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {result.players.map((p, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1 pr-4 font-sans">{i + 1}</td>
                <td className="max-w-48 truncate py-1 pr-4">{done.seats[i]}</td>
                <td className="py-1 pr-4">{pct(p.equity, monteCarlo ? 2 : 3)}</td>
                {monteCarlo && <td className="py-1 pr-4">{pct(p.stderr)}</td>}
                <td className="py-1 pr-4">{pct(p.win)}</td>
                <td className="py-1">{pct(p.tie)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Board {done.board || "none"}
        {done.dead ? `, dead ${done.dead}` : ""}. Equity is a share of the pot, a tie counted as a split; it says nothing of how a hand should be played.
      </p>
    </section>
  );
}
