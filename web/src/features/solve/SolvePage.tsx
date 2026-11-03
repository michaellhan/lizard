// Solve (ROADMAP Phase 6): set up a spot of your own and open it in Study, which answers it node by node: each seat's
// stack, the postflop bet and raise sizes, rake and its cap, an ante or a straddle, and the ranges entering the flop
// (setup.ts maps each to the engine's key and checks it first). Study's "Edit setup" opens this page on its spot: the
// line is kept while the table's size stays. Node locks and automatic sizing aren't here yet (the classic app has them).
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CLASSIC_URL } from "@/config";
import type { SavedRange } from "@/data/db";
import { listRanges } from "@/data/saved";
import { seatLabel, seatsOf } from "@/poker/seats";
import { MAX_STACK, MIN_STACK, PLAYERS } from "@/features/study/StudyPage";
import { describeLine, freshHand, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import { LIMITS, setupProblems, SIZE_STREETS, tidySetup, type SizeStreet, type SpotSetup } from "./setup";

const SIZE_LABEL: Record<SizeStreet, string> = { flop: "Flop bets", turn: "Turn bets", river: "River bets", raise: "Raises" };
const str = (x: number | undefined) => (x === undefined ? "" : String(x));
/** "33, 75" -> [33, 75] (a word that isn't a number stays, as NaN, for the check to name) */
const numsOf = (t: string) => t.split(/[\s,;]+/).filter(Boolean).map((x) => Number(x.replace(/%$/, "")));
const numOf = (t: string) => (t.trim() ? Number(t) : undefined);

export function SolvePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // (where it was opened from: read once)
  const [start] = useState<StudyHand>(() => fromSearch(params.toString()) ?? freshHand(6, 100));
  const s0 = start.setup;
  const [players, setPlayers] = useState(start.players);
  const [stack, setStack] = useState(String(start.stack));
  const [stacks, setStacks] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(s0?.stacks ?? {}).map(([p, v]) => [p, String(v)])));
  const [sizes, setSizes] = useState<Record<SizeStreet, string>>(() => Object.fromEntries(SIZE_STREETS.map((k) => [k, (s0?.sizes?.[k] ?? []).join(", ")])) as Record<SizeStreet, string>);
  const [rake, setRake] = useState(str(s0?.rake));
  const [cap, setCap] = useState(str(s0?.rakeCap));
  const [ante, setAnte] = useState(str(s0?.ante));
  const [straddle, setStraddle] = useState(!!s0?.straddle);
  const [ranges, setRanges] = useState<Record<string, string>>(() => ({ ...(s0?.ranges ?? {}) }));
  const [fromStart, setFromStart] = useState(false);
  const [saved, setSaved] = useState<SavedRange[]>([]);
  useEffect(() => {
    void listRanges()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  const seats = seatsOf(players);
  const n = Number(stack);
  const stackOk = Number.isFinite(n) && n >= MIN_STACK && n <= MAX_STACK;
  // as typed (a number that isn't one stays NaN, for the check to name), then without what's unset
  const typed: SpotSetup = useMemo(
    () => ({
      stacks: Object.fromEntries(seats.filter((p) => stacks[p]?.trim()).map((p) => [p, Number(stacks[p])])),
      sizes: Object.fromEntries(SIZE_STREETS.map((k) => [k, numsOf(sizes[k])])),
      rake: numOf(rake),
      rakeCap: numOf(cap),
      ante: numOf(ante),
      straddle: straddle && players >= 3,
      ranges: Object.fromEntries(seats.filter((p) => ranges[p]?.trim()).map((p) => [p, ranges[p]!])),
    }),
    [seats, stacks, sizes, rake, cap, ante, straddle, players, ranges],
  );
  const setup = tidySetup(typed);
  const problems = [...(stackOk ? [] : [`the table's stack must be ${MIN_STACK}–${MAX_STACK}bb`]), ...setupProblems(players, typed)];
  // the line it came from, while the table is the same size
  const keepLine = players === start.players && !fromStart;
  const hand: StudyHand = {
    ...(keepLine ? start : freshHand(players, n)),
    players,
    stack: stackOk ? Math.round(n * 10) / 10 : start.stack,
    setup,
  };
  const line = keepLine ? describeLine(start) : [];

  const clear = () => {
    setStacks({});
    setSizes({ flop: "", turn: "", river: "", raise: "" });
    setRake("");
    setCap("");
    setAnte("");
    setStraddle(false);
    setRanges({});
  };
  const field = "rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm";

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Solve</h1>
        <p className="text-sm text-muted">
          Set up a spot of your own and open it in Study, which answers it node by node. The library and the preflop charts answer only where they hold the same game; anything
          else is solved in your browser (or the local solver in Settings), and the badge on each answer says what produced it.
        </p>
      </div>

      <form
        aria-label="Spot setup"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problems.length) void navigate(`/study?${toSearch(hand)}`);
        }}
      >
        <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 font-medium">Table</legend>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              Players
              <select aria-label="Players" className={field} value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
                {PLAYERS.map((k) => (
                  <option key={k} value={k}>
                    {k === 2 ? "Heads-up" : `${k}-max`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              Stack
              <input aria-label="Table stack" type="number" inputMode="decimal" step="any" min={MIN_STACK} max={MAX_STACK} value={stack} onChange={(e) => setStack(e.target.value)} aria-invalid={!stackOk} className={`${field} w-20`} />
              <span className="text-muted">bb</span>
            </label>
            <label className="flex items-center gap-1.5">
              Ante
              <input aria-label="Ante" type="number" inputMode="decimal" step="any" min={0} max={LIMITS.ante} placeholder="0" value={ante} onChange={(e) => setAnte(e.target.value)} className={`${field} w-20`} />
              <span className="text-muted">bb a seat</span>
            </label>
            <label className="flex items-center gap-1.5" title={players < 3 ? "A straddle needs 3 or more players" : "A 2bb straddle from the first seat"}>
              <input type="checkbox" checked={straddle && players >= 3} disabled={players < 3} onChange={(e) => setStraddle(e.target.checked)} />
              Straddle
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 font-medium">Seats</legend>
          <p className="text-xs text-muted">
            A stack left blank is the table's. A range is the one the seat takes to the flop (PIO style: 22+, A2s+, KTo+, QJs:0.5, AhKh); blank, the preflop charts' range for the
            line played. Preflop is still answered by the charts.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-2 font-normal">Seat</th>
                  <th className="py-1 pr-2 font-normal">Stack (bb)</th>
                  <th className="py-1 font-normal">Range entering the flop</th>
                </tr>
              </thead>
              <tbody>
                {seats.map((p) => (
                  <tr key={p} className="align-top">
                    <td className="py-1 pr-2 font-medium">{seatLabel(p, players)}</td>
                    <td className="py-1 pr-2">
                      <input aria-label={`${p} stack`} type="number" inputMode="decimal" step="any" placeholder={stackOk ? String(n) : ""} value={stacks[p] ?? ""} onChange={(e) => setStacks({ ...stacks, [p]: e.target.value })} className={`${field} w-16`} />
                    </td>
                    <td className="py-1">
                      <div className="flex flex-wrap items-start gap-1.5">
                        <input aria-label={`${p} range`} placeholder="the charts'" value={ranges[p] ?? ""} onChange={(e) => setRanges({ ...ranges, [p]: e.target.value })} className={`${field} min-w-0 flex-1 basis-32`} />
                        {saved.length > 0 && (
                          <select
                            aria-label={`${p} saved range`}
                            className={`${field} max-w-40 font-sans`}
                            value=""
                            onChange={(e) => {
                              const r = saved.find((x) => x.id === e.target.value);
                              if (r) setRanges({ ...ranges, [p]: r.text });
                            }}
                          >
                            <option value="">Saved range…</option>
                            {saved.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 font-medium">Bet sizes</legend>
          <p className="text-xs text-muted">
            Postflop, in % of the pot, up to {LIMITS.sizes} a street ({LIMITS.sizePct[0]}–{LIMITS.sizePct[1]}%; each size multiplies the game tree your browser solves). Blank: the
            engine's own.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SIZE_STREETS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0">{SIZE_LABEL[k]}</span>
                <input aria-label={SIZE_LABEL[k]} placeholder="e.g. 33, 75" value={sizes[k]} onChange={(e) => setSizes({ ...sizes, [k]: e.target.value })} className={`${field} min-w-0 flex-1`} />
                <span className="text-muted">%</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 font-medium">Rake</legend>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input aria-label="Rake" type="number" inputMode="decimal" step="any" min={0} max={LIMITS.rakePct} placeholder="0" value={rake} onChange={(e) => setRake(e.target.value)} className={`${field} w-20`} />
              <span className="text-muted">% of the pot</span>
            </label>
            <label className="flex items-center gap-1.5">
              capped at
              <input aria-label="Rake cap" type="number" inputMode="decimal" step="any" min={0} placeholder="no cap" value={cap} onChange={(e) => setCap(e.target.value)} className={`${field} w-24`} />
              <span className="text-muted">bb</span>
            </label>
          </div>
          <p className="text-xs text-muted">
            Taken from pots that see a flop. A library flop answered for a raked table is read off its unraked solve until the raked one has run, and labelled approximate.
          </p>
        </fieldset>

        {problems.length > 0 && (
          <ul role="alert" aria-label="Setup problems" className="list-disc space-y-0.5 rounded-lg border border-danger/40 bg-danger/10 py-2 pl-7 pr-3 text-sm text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="submit" disabled={problems.length > 0} className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 font-medium hover:bg-accent/25 disabled:opacity-40">
            Open in Study
          </button>
          <button type="button" onClick={clear} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
            Clear the setup
          </button>
          {line.length > 0 ? (
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={fromStart} onChange={(e) => setFromStart(e.target.checked)} />
              From the first decision (else at {line.join(" ")})
            </label>
          ) : (
            <span className="text-muted">Opens at the first decision.</span>
          )}
        </div>
      </form>

      <p className="text-sm text-muted">
        Not here yet: node locks (a best response to a locked tendency) and automatic sizing. The classic app has both:{" "}
        <a href={CLASSIC_URL} className="underline hover:text-text">
          open the classic GTO Solver ↗
        </a>
        . Saved ranges come from <Link to="/ranges" className="underline hover:text-text">Ranges</Link>.
      </p>
    </div>
  );
}
