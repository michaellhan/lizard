// Solve (ROADMAP Phase 6): set up a spot of your own and open it in Study, which answers it node by node: each seat's
// stack, the postflop bet and raise sizes, rake and its cap, an ante or a straddle, and the ranges entering the flop
// (setup.ts maps each to the engine's key and checks it first). Study's "Edit setup" opens this page on its spot: the
// line is kept while the table's size stays. Node locks and automatic sizing aren't here yet (the classic app has them).
// Tournaments (ROADMAP Phase 7) is this page for a tournament: the prizes left, the other tables and the bounties
// (features/tournaments/tournament.ts) in place of the rake, answered in prize equity.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CLASSIC_URL } from "@/config";
import type { SavedRange } from "@/data/db";
import { listRanges } from "@/data/saved";
import { seatLabel, seatsOf } from "@/poker/seats";
import { MAX_STACK, MIN_STACK, PLAYERS } from "@/features/study/StudyPage";
import { describeLine, freshHand, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import { BubbleTable } from "@/features/tournaments/BubbleTable";
import { bubbleTableOf } from "@/features/tournaments/icm";
import { BOUNTY_FORMATS, BOUNTY_NAME, paidCurve, parsePayouts, PAYOUT_PRESETS, satellitePayouts, type BountyFormat, type TournamentSetup } from "@/features/tournaments/tournament";
import { LIMITS, setupProblems, SIZE_STREETS, tidySetup, type SizeStreet, type SpotSetup } from "./setup";

const SIZE_LABEL: Record<SizeStreet, string> = { flop: "Flop bets", turn: "Turn bets", river: "River bets", raise: "Raises" };
const str = (x: number | undefined) => (x === undefined ? "" : String(x));
/** "33, 75" -> [33, 75] (a word that isn't a number stays, as NaN, for the check to name) */
const numsOf = (t: string) => t.split(/[\s,;]+/).filter(Boolean).map((x) => Number(x.replace(/%$/, "")));
const numOf = (t: string) => (t.trim() ? Number(t) : undefined);

export function SolvePage({ kind = "cash" }: { kind?: "cash" | "tournament" }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // (where it was opened from: read once)
  const [start] = useState<StudyHand>(() => fromSearch(params.toString()) ?? freshHand(6, 100));
  const s0 = start.setup;
  // a tournament's spot (opened from Tournaments, or a spot that has one)
  const tour = kind === "tournament" || !!s0?.tournament;
  const t0 = s0?.tournament;
  const [players, setPlayers] = useState(start.players);
  const [stack, setStack] = useState(String(start.stack));
  const [stacks, setStacks] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(s0?.stacks ?? {}).map(([p, v]) => [p, String(v)])));
  const [sizes, setSizes] = useState<Record<SizeStreet, string>>(() => Object.fromEntries(SIZE_STREETS.map((k) => [k, (s0?.sizes?.[k] ?? []).join(", ")])) as Record<SizeStreet, string>);
  const [rake, setRake] = useState(str(s0?.rake));
  const [cap, setCap] = useState(str(s0?.rakeCap));
  const [ante, setAnte] = useState(str(s0?.ante));
  const [straddle, setStraddle] = useState(!!s0?.straddle);
  const [ranges, setRanges] = useState<Record<string, string>>(() => ({ ...(s0?.ranges ?? {}) }));
  const [payouts, setPayouts] = useState(t0?.payouts?.join(" ") ?? "");
  const [fieldN, setFieldN] = useState(str(t0?.field?.players));
  const [fieldAvg, setFieldAvg] = useState(str(t0?.field?.avg));
  const [bFormat, setBFormat] = useState<BountyFormat | "off">(t0?.bounty?.format ?? "off");
  const [bEach, setBEach] = useState(str(t0?.bounty?.each));
  const [bField, setBField] = useState(str(t0?.bounty?.field));
  const [bSeats, setBSeats] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(t0?.bounty?.seats ?? {}).map(([p, v]) => [p, String(v)])));
  const [envelope, setEnvelope] = useState(str(t0?.bounty?.envelope));
  const [pool, setPool] = useState(str(t0?.bounty?.pool));
  const [left, setLeft] = useState(str(t0?.bounty?.left));
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
  const tournament: TournamentSetup | undefined = useMemo(() => {
    if (!tour) return undefined;
    const ps = parsePayouts(payouts);
    const bounty =
      bFormat === "off"
        ? undefined
        : bFormat === "mystery"
          ? { format: bFormat, envelope: numOf(envelope), pool: numOf(pool), left: numOf(left) }
          : {
              format: bFormat,
              each: numOf(bEach),
              field: numOf(bField),
              seats: Object.fromEntries(seats.filter((p) => bSeats[p]?.trim()).map((p) => [p, Number(bSeats[p])])),
            };
    return {
      ...(ps.length ? { payouts: ps } : {}),
      ...(fieldN.trim() ? { field: { players: Number(fieldN), avg: Number(fieldAvg) } } : {}),
      ...(bounty ? { bounty: Object.fromEntries(Object.entries(bounty).filter(([, v]) => v !== undefined)) as TournamentSetup["bounty"] } : {}),
    };
  }, [tour, payouts, fieldN, fieldAvg, bFormat, envelope, pool, left, bEach, bField, bSeats, seats]);
  const typed: SpotSetup = useMemo(
    () => ({
      stacks: Object.fromEntries(seats.filter((p) => stacks[p]?.trim()).map((p) => [p, Number(stacks[p])])),
      sizes: Object.fromEntries(SIZE_STREETS.map((k) => [k, numsOf(sizes[k])])),
      ...(tour ? { tournament } : { rake: numOf(rake), rakeCap: numOf(cap) }),
      ante: numOf(ante),
      straddle: straddle && players >= 3,
      ranges: Object.fromEntries(seats.filter((p) => ranges[p]?.trim()).map((p) => [p, ranges[p]!])),
    }),
    [seats, stacks, sizes, tour, tournament, rake, cap, ante, straddle, players, ranges],
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
  // the players left (this table's and the other tables'), for the 15%-paid shape
  const fN = Number(fieldN);
  const curve = tour ? paidCurve(players + (Number.isInteger(fN) && fN > 0 ? fN : 0)) : null;
  // every pair's bubble factor, from a setup with nothing wrong (worked out again only when what it reads changes)
  const pairsKey = tour && !problems.length ? JSON.stringify([players, hand.stack, setup?.stacks ?? {}, setup?.tournament ?? {}]) : "";
  const pairs = useMemo(() => {
    if (!pairsKey) return null;
    const [p, st, stacks, t] = JSON.parse(pairsKey) as [number, number, SpotSetup["stacks"], TournamentSetup];
    return bubbleTableOf(p, st, { stacks, tournament: t });
  }, [pairsKey]);

  const clear = () => {
    setStacks({});
    setSizes({ flop: "", turn: "", river: "", raise: "" });
    setRake("");
    setCap("");
    setAnte("");
    setStraddle(false);
    setRanges({});
    setPayouts("");
    setFieldN("");
    setFieldAvg("");
    setBFormat("off");
    setBEach("");
    setBField("");
    setBSeats({});
    setEnvelope("");
    setPool("");
    setLeft("");
  };
  const seatBounties = tour && (bFormat === "ko" || bFormat === "pko");
  const field = "rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm";

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{tour ? "Tournaments" : "Solve"}</h1>
        <p className="text-sm text-muted">
          {tour ? (
            <>
              Set up a tournament spot (the prizes left, each seat's stack, the players at other tables, bounties) and open it in Study, which answers it in prize equity (ICM):
              chips you might lose count for more than chips you might win. Postflop is solved in your browser in prize equity; preflop is the charts with a risk premium, or the
              push/fold equilibrium in prize equity where a raise commits the stack. The badge on each answer says which.
            </>
          ) : (
            <>
              Set up a spot of your own and open it in Study, which answers it node by node. The library and the preflop charts answer only where they hold the same game;
              anything else is solved in your browser (or the local solver in Settings), and the badge on each answer says what produced it.
            </>
          )}
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
        <fieldset className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-4">
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

        {tour && (
          <fieldset className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4">
            <legend className="px-1 font-medium">Tournament</legend>
            <div className="space-y-1.5 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                Payouts
                <input aria-label="Payouts" placeholder="e.g. 50 30 20" value={payouts} onChange={(e) => setPayouts(e.target.value)} className={`${field} min-w-0 flex-1 basis-48`} />
              </label>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted">Shapes:</span>
                {PAYOUT_PRESETS.map((pr) => (
                  <button key={pr.name} type="button" onClick={() => setPayouts(pr.payouts.join(" "))} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
                    {pr.name}
                  </button>
                ))}
                {satellitePayouts(players) && (
                  <button type="button" onClick={() => setPayouts(satellitePayouts(players)!.join(" "))} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
                    Satellite, {players - 1} seats
                  </button>
                )}
                {curve && (
                  <button
                    type="button"
                    onClick={() => setPayouts(curve.join(" "))}
                    title="The places a field of the players left (this table's and the other tables') would pay at 15%, on a curve of Lizard's own"
                    className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
                  >
                    15% paid, {curve.length} places
                  </button>
                )}
              </div>
              <p className="text-xs text-muted">
                The prizes still to be paid, first place first, in any unit. Two or more: prize equity (ICM). One: winner takes all, where chips are prizes and Study answers in
                chips. None, with bounties: chip EV, the prizes taken as the bounties in play. A satellite pays equal prizes (seats); preflop its answers are still the chip charts
                with a risk premium, far from a satellite's real folding ranges, so read them as the badge says: approximate. 15% paid: the places a field of the players left
                would pay, first place about a quarter (a curve of Lizard's own, with 10 or more players left).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Other tables</span>
              <input aria-label="Players at other tables" type="number" inputMode="numeric" step={1} min={0} placeholder="0" value={fieldN} onChange={(e) => setFieldN(e.target.value)} className={`${field} w-20`} />
              <span className="text-muted">players, average</span>
              <input aria-label="Their average stack" type="number" inputMode="decimal" step="any" min={1} value={fieldAvg} onChange={(e) => setFieldAvg(e.target.value)} className={`${field} w-20`} />
              <span className="text-muted">bb</span>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  Bounties
                  <select aria-label="Bounties" className={field} value={bFormat} onChange={(e) => setBFormat(e.target.value as BountyFormat | "off")}>
                    <option value="off">off</option>
                    {BOUNTY_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {BOUNTY_NAME[f]}
                      </option>
                    ))}
                  </select>
                </label>
                {seatBounties && (
                  <>
                    <input aria-label="Each seat's bounty" type="number" inputMode="decimal" step="any" min={0} value={bEach} onChange={(e) => setBEach(e.target.value)} className={`${field} w-20`} />
                    <span className="text-muted">each; other tables' average</span>
                    <input aria-label="Other tables' bounty" type="number" inputMode="decimal" step="any" min={0} placeholder="the table's" value={bField} onChange={(e) => setBField(e.target.value)} className={`${field} w-24`} />
                  </>
                )}
                {bFormat === "mystery" && (
                  <>
                    <input aria-label="Average envelope" type="number" inputMode="decimal" step="any" min={0} value={envelope} onChange={(e) => setEnvelope(e.target.value)} className={`${field} w-20`} />
                    <span className="text-muted">average envelope, or the pool</span>
                    <input aria-label="Envelope pool" type="number" inputMode="decimal" step="any" min={0} value={pool} onChange={(e) => setPool(e.target.value)} className={`${field} w-20`} />
                    <span className="text-muted">and</span>
                    <input aria-label="Envelopes left" type="number" inputMode="numeric" step={1} min={0} value={left} onChange={(e) => setLeft(e.target.value)} className={`${field} w-16`} />
                    <span className="text-muted">left</span>
                  </>
                )}
              </div>
              {bFormat !== "off" && (
                <p className="text-xs text-muted">
                  In the payouts' units. KO pays a player's whole bounty to whoever busts them, PKO half at once (the rest goes on the winner's head), a mystery bounty an envelope
                  from the pool; only a player who covers another can bust them.{seatBounties ? " A seat's own bounty goes in the seats below." : ""} Valued by the proportional model:
                  each player owns their chip share of the bounties in play.
                </p>
              )}
            </div>
          </fieldset>
        )}

        <fieldset className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-4">
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
                  {seatBounties && <th className="py-1 pr-2 font-normal">Bounty</th>}
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
                    {seatBounties && (
                      <td className="py-1 pr-2">
                        <input aria-label={`${p} bounty`} type="number" inputMode="decimal" step="any" min={0} placeholder={bEach.trim() || "0"} value={bSeats[p] ?? ""} onChange={(e) => setBSeats({ ...bSeats, [p]: e.target.value })} className={`${field} w-16`} />
                      </td>
                    )}
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

        {pairs && (
          <section aria-label="Bubble factors" className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-medium">Bubble factors, every pair</h2>
            <BubbleTable table={pairs} />
          </section>
        )}

        <fieldset className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-4">
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

        {!tour && (
          <fieldset className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-4">
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
        )}

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

      {tour && (
        <p className="text-sm text-muted">
          Not here yet: a satellite-aware preflop (its answers stay the chip charts with a risk premium). ICM and chip EV side by side: Study's "Compare with chip EV" under a
          tournament answer. A cash game:{" "}
          <Link to="/solve" className="underline hover:text-text">
            Solve
          </Link>
          .
        </p>
      )}
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
