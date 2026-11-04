// The New session form: the table's size and stack, your seat, what's played (full hands, preflop only or one kind of
// pot), the ante, rake and straddle, chips carried and your own bet sizes. It holds what's typed until it's submitted.
import { useState } from "react";
import { describeSetup, LIMITS, numsOf, setupProblems, SIZE_STREETS, type SizeStreet } from "@/features/solve/setup";
import { MAX_PLAYERS, MIN_PLAYERS, seatLabel, seatsOf } from "@/poker/seats";
import { carries, isPotDrill, POT_DRILLS, REBUY, type HandOptions, type Sizes } from "./practice";

export const MIN_STACK = 10;
export const MAX_STACK = 250;

const SIZE_LABEL: Record<SizeStreet, string> = { flop: "Flop bets", turn: "Turn bets", river: "River bets", raise: "Raises" };

export function SetupForm({
  players,
  stack,
  opts,
  onStart,
}: {
  players: number;
  stack: number;
  opts: Required<HandOptions>;
  onStart: (players: number, stack: number, opts: Required<HandOptions>) => void;
}) {
  const [p, setP] = useState(players);
  const [s, setS] = useState(String(stack));
  const [seat, setSeat] = useState(opts.seat);
  const [play, setPlay] = useState<string>(opts.pot ?? (opts.preflopOnly ? "preflop" : "full"));
  const [ante, setAnte] = useState(opts.ante ? String(opts.ante) : "");
  const [straddle, setStraddle] = useState(opts.straddle);
  const [carry, setCarry] = useState(opts.carry);
  const [rake, setRake] = useState(opts.rake ? String(opts.rake) : "");
  const [cap, setCap] = useState(opts.rakeCap ? String(opts.rakeCap) : "");
  const [sizeText, setSizeText] = useState<Record<SizeStreet, string>>(() => Object.fromEntries(SIZE_STREETS.map((k) => [k, (opts.sizes?.[k] ?? []).join(", ")])) as Record<SizeStreet, string>);
  // (blank: the engine's own; preflop only has no use for them)
  const parsed = SIZE_STREETS.flatMap((k) => (numsOf(sizeText[k]).length ? [[k, numsOf(sizeText[k])] as const] : []));
  const sizes: Sizes | null = parsed.length && play !== "preflop" ? Object.fromEntries(parsed) : null;
  const sizeProblems = sizes ? setupProblems(p, { sizes }) : [];
  // (a seat the table size doesn't have moves)
  const seatOk = seat === "moves" || seat === "random" || seatsOf(p).includes(seat);
  const canCarry = carries({ carry: true, seat: seatOk ? seat : "moves", preflopOnly: play === "preflop", pot: isPotDrill(play) ? play : null });
  const n = Number(s);
  const a = ante.trim() === "" ? 0 : Number(ante);
  const anteOk = Number.isFinite(a) && a >= 0 && a <= LIMITS.ante;
  const rk = rake.trim() === "" ? 0 : Number(rake);
  const rc = cap.trim() === "" ? 0 : Number(cap);
  const rakeOk = Number.isFinite(rk) && rk >= 0 && rk <= LIMITS.rakePct && Number.isFinite(rc) && rc >= 0;
  const ok = Number.isFinite(n) && n >= MIN_STACK && n <= MAX_STACK && anteOk && rakeOk && !sizeProblems.length;
  return (
    <form
      aria-label="New session"
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onStart(p, n, { seat: seatOk ? seat : "moves", preflopOnly: play === "preflop", pot: isPotDrill(play) ? play : null, ante: a, straddle: straddle && p >= 3, carry: carry && canCarry, sizes, rake: rk, rakeCap: rk ? rc : 0 });
      }}
    >
      <label className="flex items-center gap-1">
        <span className="text-muted">Players</span>
        <select aria-label="Players" value={p} onChange={(e) => setP(Number(e.target.value))} className="rounded border border-border bg-surface-2 px-1.5 py-1">
          {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((x) => (
            <option key={x} value={x}>
              {x === 2 ? "Heads-up" : `${x}-max`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Stack</span>
        <input
          aria-label="Stack in big blinds"
          type="number"
          min={MIN_STACK}
          max={MAX_STACK}
          step={0.5}
          value={s}
          onChange={(e) => setS(e.target.value)}
          className="w-20 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">bb</span>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Your seat</span>
        <select aria-label="Your seat" value={seatOk ? seat : "moves"} onChange={(e) => setSeat(e.target.value)} className="rounded border border-border bg-surface-2 px-1.5 py-1">
          <option value="moves">Moves each hand</option>
          <option value="random">Random</option>
          {seatsOf(p).map((x) => (
            <option key={x} value={x}>
              {seatLabel(x, p)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Play</span>
        <select
          aria-label="Play"
          value={play}
          onChange={(e) => setPlay(e.target.value)}
          title={isPotDrill(play) ? POT_DRILLS[play].tip : undefined}
          className="rounded border border-border bg-surface-2 px-1.5 py-1"
        >
          <option value="full">Full hands</option>
          <option value="preflop">Preflop only</option>
          {Object.entries(POT_DRILLS).map(([k, d]) => (
            <option key={k} value={k} title={d.tip}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1" title={`Each seat's ante, 0–${LIMITS.ante}bb`}>
        <span className="text-muted">Ante</span>
        <input
          aria-label="Ante"
          type="number"
          inputMode="decimal"
          min={0}
          max={LIMITS.ante}
          step="any"
          placeholder="0"
          value={ante}
          onChange={(e) => setAnte(e.target.value)}
          aria-invalid={!anteOk}
          className="w-16 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">bb</span>
      </label>
      <label className="flex items-center gap-1" title={`Taken from pots that see a flop, 0–${LIMITS.rakePct}% of the pot, capped in bb (blank: no cap)`}>
        <span className="text-muted">Rake</span>
        <input
          aria-label="Rake"
          type="number"
          inputMode="decimal"
          min={0}
          max={LIMITS.rakePct}
          step="any"
          placeholder="0"
          value={rake}
          onChange={(e) => setRake(e.target.value)}
          aria-invalid={!rakeOk}
          className="w-14 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">% cap</span>
        <input
          aria-label="Rake cap"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          placeholder="none"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          aria-invalid={!rakeOk}
          className="w-14 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">bb</span>
      </label>
      <label className="flex items-center gap-1.5" title={p < 3 ? "A straddle needs 3 or more players" : "A 2bb straddle from the first seat, acting last preflop"}>
        <input type="checkbox" aria-label="Straddle" checked={straddle && p >= 3} disabled={p < 3} onChange={(e) => setStraddle(e.target.checked)} />
        <span className="text-muted">Straddle</span>
      </label>
      <label
        className="flex items-center gap-1.5"
        title={
          canCarry
            ? `A ring game: each player's chips carry to the next hand, a seat under ${REBUY * 100}% of the stack rebuying to it`
            : "Chips carry in full hands with your seat moving each hand"
        }
      >
        <input type="checkbox" aria-label="Carry chips" checked={carry && canCarry} disabled={!canCarry} onChange={(e) => setCarry(e.target.checked)} />
        <span className="text-muted">Carry chips</span>
      </label>
      <button type="submit" disabled={!ok} className="rounded border border-border px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40">
        New session
      </button>
      <details className="basis-full" open={!!opts.sizes}>
        <summary className="cursor-pointer text-muted">Your own bet sizes{sizes ? `: ${describeSetup({ sizes }).join(", ")}` : ""}</summary>
        <p className="mt-1 text-xs text-muted">
          Postflop, in % of the pot, up to {LIMITS.sizes} a street, as on the Solve page: the solver&rsquo;s tree, your options and the opponents&rsquo; bets use
          them from the flop on. The flop library answers only where its tree has the same sizes; otherwise the flop is solved live. Blank: the engine&rsquo;s own.
        </p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {SIZE_STREETS.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-muted">{SIZE_LABEL[k]}</span>
              <input
                aria-label={SIZE_LABEL[k]}
                placeholder="e.g. 33, 75"
                value={sizeText[k]}
                disabled={play === "preflop"}
                onChange={(e) => setSizeText({ ...sizeText, [k]: e.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 py-1"
              />
              <span className="text-muted">%</span>
            </label>
          ))}
        </div>
        {sizeProblems.length > 0 && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {sizeProblems.join("; ")}
          </p>
        )}
      </details>
    </form>
  );
}
