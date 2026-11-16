// PLO4 equity: a calculator on the PLO engine layer (engine/plo/), and no more than that. It says how often hands win if
// every card is dealt with no more betting, and what produced each number. Nothing here is a strategy: the one PLO4 solve
// in Lizard is of a single heads-up river, at /plo. Loaded with its route, so no PLO code is in the first download; the work is done in a worker.
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
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

/** The calculator's inputs, as typed. */
export interface EquityInputs {
  seats: string[];
  board: string;
  dead: string;
  mode: EquityMode;
  runs: number;
  seed: number;
}

export const DEFAULT_INPUTS: EquityInputs = { seats: ["AsAhKsKh", "JdTd9c8c"], board: "", dead: "", mode: "auto", runs: DEFAULT_RUNS, seed: 1 };

/** The last inputs in this browser, as the address's query, for a bare /equity (the address wins). */
export const EQUITY_KEY = "lizard.ploEquity.v1";

const MODES: readonly EquityMode[] = ["auto", "exact", "montecarlo"];

/** The inputs as a query: a `p` per seat (a range can hold commas), and the rest only where it isn't the default. */
export function inputsToParams(x: EquityInputs): URLSearchParams {
  const q = new URLSearchParams();
  for (const s of x.seats) q.append("p", s);
  if (x.board) q.set("board", x.board);
  if (x.dead) q.set("dead", x.dead);
  if (x.mode !== DEFAULT_INPUTS.mode) q.set("mode", x.mode);
  if (x.runs !== DEFAULT_INPUTS.runs) q.set("runs", String(x.runs));
  if (x.seed !== DEFAULT_INPUTS.seed) q.set("seed", String(x.seed));
  return q;
}

const whole = (v: string | null, min: number, fallback: number) => {
  const n = v === null || v.trim() === "" ? NaN : Number(v);
  return Number.isSafeInteger(n) && n >= min ? n : fallback;
};

/** The inputs read from a query, or null when it holds none (2 to 9 seats). A bad method, runs or seed is the default's;
 * the hands and cards are the calculator's to check, as typed. */
export function inputsFromParams(q: URLSearchParams): EquityInputs | null {
  const seats = q.getAll("p");
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) return null;
  const mode = q.get("mode") as EquityMode | null;
  return {
    seats,
    board: q.get("board") ?? "",
    dead: q.get("dead") ?? "",
    mode: mode !== null && MODES.includes(mode) ? mode : DEFAULT_INPUTS.mode,
    runs: whole(q.get("runs"), 1, DEFAULT_INPUTS.runs),
    seed: whole(q.get("seed"), 0, DEFAULT_INPUTS.seed),
  };
}

function storedInputs(): EquityInputs | null {
  try {
    const s = localStorage.getItem(EQUITY_KEY);
    return typeof s === "string" ? inputsFromParams(new URLSearchParams(s)) : null;
  } catch {
    return null;
  }
}

function storeInputs(search: string) {
  try {
    localStorage.setItem(EQUITY_KEY, search);
  } catch {
    // (a browser that won't store it opens a bare /equity at the defaults)
  }
}

export function EquityPage() {
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  // the address's inputs, else this browser's last, else the defaults
  const [opening] = useState<EquityInputs>(() => inputsFromParams(params) ?? storedInputs() ?? DEFAULT_INPUTS);
  const [inputs, setInputs] = useState(opening);
  const { seats, board, dead, mode, runs, seed } = inputs;
  // what the page wrote to the address, latest last (a navigation can land after the next edit's)
  const [written, setWritten] = useState(() => [inputsToParams(opening).toString()]);
  const last = written.at(-1)!;

  // every edit goes to the address, replacing it so Back leaves the page
  const edit = (patch: Partial<EquityInputs>) => {
    const next = { ...inputs, ...patch };
    const q = inputsToParams(next).toString();
    setInputs(next);
    setWritten((w) => (w.at(-1) === q ? w : [...w.filter((x) => x !== q), q].slice(-20)));
    if (q !== search) setParams(q, { replace: true });
  };

  // inputs in an address the page didn't write (a link to /equity while on it) are taken
  const [seen, setSeen] = useState(search);
  if (search !== seen) {
    setSeen(search);
    const x = written.includes(search) ? null : inputsFromParams(params);
    if (x) {
      setInputs(x);
      setWritten((w) => [...w, search].slice(-20));
    }
  }
  // the opening inputs, and a bare address, get the page's inputs written back; this browser keeps the latest
  useEffect(() => {
    if (!written.includes(search) && !inputsFromParams(new URLSearchParams(search))) setParams(last, { replace: true });
  }, [search, last, written, setParams]);
  useEffect(() => storeInputs(last), [last]);
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

  const setSeat = (i: number, v: string) => edit({ seats: seats.map((x, k) => (k === i ? v : x)) });

  return (
    <div className="max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">PLO4 equity</h1>
        <p className="text-sm text-muted">
          Pot share with no more betting. A calculator, not a strategy: the only PLO solve is{" "}
          <Link to="/plo" className="underline">
            one heads-up river
          </Link>
          .
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
          <button type="button" className={buttonClass} disabled={seats.length >= MAX_PLAYERS} onClick={() => edit({ seats: [...seats, ""] })}>
            Add a player
          </button>
          <button type="button" className={buttonClass} disabled={seats.length <= MIN_PLAYERS} onClick={() => edit({ seats: seats.slice(0, -1) })}>
            Remove the last
          </button>
        </div>
        <p className="text-xs text-muted">
          A hand (AsKsQhJh) or a range: AAxx, JT98ds (ds/ss/r), random, @25 weight; commas between.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Board</span>
            <input aria-label="Board" value={board} onChange={(e) => edit({ board: e.target.value })} placeholder="0, 3, 4 or 5 cards" className={`${inputClass} w-44`} spellCheck={false} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Dead cards</span>
            <input aria-label="Dead cards" value={dead} onChange={(e) => edit({ dead: e.target.value })} className={`${inputClass} w-32`} spellCheck={false} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Method</span>
            <select aria-label="Method" value={mode} onChange={(e) => edit({ mode: e.target.value as EquityMode })} className={inputClass}>
              <option value="auto">Exact if it&apos;s small enough</option>
              <option value="exact">Exact</option>
              <option value="montecarlo">Monte Carlo</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Runouts</span>
            <input aria-label="Monte Carlo runouts" type="number" min={1} value={runs} onChange={(e) => edit({ runs: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} className={`${inputClass} w-32`} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Seed</span>
            <input aria-label="Monte Carlo seed" type="number" min={0} value={seed} onChange={(e) => edit({ seed: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} className={`${inputClass} w-24`} />
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
      {done?.cancelled && !done.result && <p className="text-sm text-muted">Cancelled: an exact count needs every board.</p>}
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
          <tbody>
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
        {done.dead ? `, dead ${done.dead}` : ""}. Ties count as splits.
      </p>
    </section>
  );
}
