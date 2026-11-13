// Solve (ROADMAP Phase 6): set up a spot of your own and open it in Study, which answers it node by node: each seat's
// stack, the postflop bet and raise sizes, rake and its cap, an ante or a straddle, and the ranges entering the flop
// (setup.ts maps each to the engine's key and checks it first). Study's "Edit setup" opens this page on its spot: the
// line is kept while the table's size stays. Node locks and automatic sizing aren't set up here: Study asks them a hand at a time.
// Tournaments (ROADMAP Phase 7) is this page for a tournament: the prizes left, the other tables and the bounties
// (features/tournaments/tournament.ts) in place of the rake, answered in prize equity.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { SavedRange } from "@/data/db";
import { listRanges } from "@/data/saved";
import { seatLabel, seatsOf } from "@/poker/seats";
import { MAX_STACK, MIN_STACK, PLAYERS } from "@/features/study/StudyPage";
import { describeLine, freshHand, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import { BubbleTable } from "@/features/tournaments/BubbleTable";
import { bubbleTableOf } from "@/features/tournaments/icm";
import { BOUNTY_FORMATS, BOUNTY_NAME, paidCurve, parsePayouts, pastedPayouts, PAYOUT_PRESETS, anteWords, FORMAT_PRESETS, presetAnte, satellitePayouts, STAGE_PRESETS, type BountyFormat, type StagePreset, type TournamentSetup } from "@/features/tournaments/tournament";
import { useSettings } from "@/state/settings";
import { capWords, TREE_CAPS } from "@/solver/treeDepth";
import { ENGINE_RAISES, LIMITS, numsOf, raisesWords, setupProblems, SIZE_STREETS, tidySetup, type SizeStreet, type SpotSetup } from "./setup";

/** What a bigger menu costs here: this device's tree cap, and that a local server keeps upstream's tree. */
function TreeNote() {
  const cap = useSettings((s) => s.treeCap);
  const transport = useSettings((s) => s.transport);
  if (transport !== "worker")
    return <p className="text-xs text-muted">A local server keeps a raise cap of {ENGINE_RAISES} and 24M-cell trees.</p>;
  return (
    <p className="text-xs text-muted">
      Trees up to {capWords(cap)} here (
      <Link to="/settings" className="underline hover:text-text">
        {TREE_CAPS[cap].label}
      </Link>
      ); a bigger one is cut to fit.
    </p>
  );
}

const SIZE_LABEL: Record<SizeStreet, string> = { flop: "Flop bets", turn: "Turn bets", river: "River bets", raise: "Raises" };
const str = (x: number | undefined) => (x === undefined ? "" : String(x));
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
  const [raises, setRaises] = useState(s0?.raises ?? ENGINE_RAISES);
  const [rake, setRake] = useState(str(s0?.rake));
  // (the Seats fold as the user left it; null until they open or close it)
  const [seatsShown, setSeatsShown] = useState<boolean | null>(null);
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
      raises,
      ...(tour ? { tournament } : { rake: numOf(rake), rakeCap: numOf(cap) }),
      ante: numOf(ante),
      straddle: straddle && players >= 3,
      ranges: Object.fromEntries(seats.filter((p) => ranges[p]?.trim()).map((p) => [p, ranges[p]!])),
    }),
    [seats, stacks, sizes, raises, tour, tournament, rake, cap, ante, straddle, players, ranges],
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
    setRaises(ENGINE_RAISES);
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
    setStage(null);
  };
  // a stage of an MTT, set up at once: the table's stack is the biggest, the seats with fewer chips have their own
  const [stage, setStage] = useState<StagePreset | null>(null);
  const setUpStage = (st: StagePreset) => {
    clear();
    const top = Math.max(...st.stacks);
    const order = seatsOf(st.players);
    setPlayers(st.players);
    setStack(String(top));
    setStacks(Object.fromEntries(order.flatMap((p, i) => (st.stacks[i] !== top ? [[p, String(st.stacks[i])]] : []))));
    setAnte(presetAnte(st) ? String(presetAnte(st)) : "");
    setPayouts(st.payouts.join(" "));
    setFieldN(st.field ? String(st.field.players) : "");
    setFieldAvg(st.field ? String(st.field.avg) : "");
    setFromStart(true);
    setStage(st);
  };
  const seatBounties = tour && (bFormat === "ko" || bFormat === "pko");
  // a field and the line in the list below that's about it
  const flag = (...about: string[]) => {
    const i = problems.findIndex((p) => about.some((a) => p.includes(a)));
    return i < 0 ? {} : { "aria-invalid": true, "aria-describedby": `setup-problem-${i}` };
  };
  const field = "rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm";
  // the seats, folded until wanted: open in a tournament (its stacks are the spot), where a seat's been set, or where one has a problem
  const seatsSet = seats.filter((p) => stacks[p]?.trim() || ranges[p]?.trim() || bSeats[p]?.trim()).length;
  const seatProblem = seats.some((p) => problems.some((q) => q.includes(`${p}'s`)));
  const seatsOpen = seatsShown ?? (tour || seatsSet > 0);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{tour ? "Tournaments" : "Solve"}</h1>
      </div>

      <form
        aria-label="Spot setup"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problems.length) void navigate(`/study?${toSearch(hand)}`);
        }}
      >
        <fieldset className="min-w-0 space-y-2 panel p-4">
          <legend className="font-medium">Table</legend>
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
              <input aria-label="Table stack" type="number" inputMode="decimal" step="any" min={MIN_STACK} max={MAX_STACK} value={stack} onChange={(e) => setStack(e.target.value)} {...flag("the table's stack")} className={`${field} w-20`} />
              <span className={stackOk ? "text-muted" : "text-danger"}>
                bb ({MIN_STACK} to {MAX_STACK})
              </span>
            </label>
            <label className="flex items-center gap-1.5">
              Ante
              <input aria-label="Ante" type="number" inputMode="decimal" step="any" min={0} max={LIMITS.ante} placeholder="0" value={ante} onChange={(e) => setAnte(e.target.value)} {...flag("the ante")} className={`${field} w-20`} />
              <span className="text-muted">bb a seat (0 to {LIMITS.ante})</span>
            </label>
            <label className="flex items-center gap-1.5" title={players < 3 ? "A straddle needs 3 or more players" : "A 2bb straddle from the first seat"}>
              <input type="checkbox" checked={straddle && players >= 3} disabled={players < 3} onChange={(e) => setStraddle(e.target.checked)} />
              Straddle
            </label>
          </div>
        </fieldset>

        {tour && (
          <fieldset className="min-w-0 space-y-3 panel p-4">
            <legend className="font-medium">Tournament</legend>
            <div className="space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Stages">
                <span className="text-muted">Stages:</span>
                {STAGE_PRESETS.map((st) => (
                  <button key={st.name} type="button" title={st.about} aria-pressed={stage === st} onClick={() => setUpStage(st)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 aria-pressed:bg-surface-2">
                    {st.name}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Formats">
                <span className="text-muted">Formats:</span>
                {FORMAT_PRESETS.map((st) => (
                  <button key={st.name} type="button" title={st.about} aria-pressed={stage === st} onClick={() => setUpStage(st)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 aria-pressed:bg-surface-2">
                    {st.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted" aria-live="polite">
                {stage
                  ? `Set up: ${stage.name}. ${stage.about}; ${anteWords(stage)}.`
                  : "A stage or format fills in the form."}
              </p>
            </div>
            <div className="space-y-1.5 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                Payouts
                <input
                  aria-label="Payouts"
                  placeholder="e.g. 50 30 20, or paste a payout table or tournament summary"
                  title="First place first, any unit"
                  value={payouts}
                  onChange={(e) => setPayouts(e.target.value)}
                  onPaste={(e) => {
                    const t = pastedPayouts(e.clipboardData.getData("text"));
                    if (t === null) return;
                    e.preventDefault();
                    setPayouts(t);
                  }}
                  {...flag("the payouts must", "places paid")} className={`${field} min-w-0 flex-1 basis-48`} />
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
                    title="Lizard's own curve"
                    className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
                  >
                    15% paid, {curve.length} places
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Other tables</span>
              <input aria-label="Players at other tables" type="number" inputMode="numeric" step={1} min={0} placeholder="0" value={fieldN} onChange={(e) => setFieldN(e.target.value)} {...flag("players at other tables")} className={`${field} w-20`} />
              <span className="text-muted">players, average</span>
              <input aria-label="Their average stack" type="number" inputMode="decimal" step="any" min={1} value={fieldAvg} onChange={(e) => setFieldAvg(e.target.value)} {...flag("average stack")} className={`${field} w-20`} />
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
                    <input aria-label="Each seat's bounty" type="number" inputMode="decimal" step="any" min={0} value={bEach} onChange={(e) => setBEach(e.target.value)} {...flag("the bounties must")} className={`${field} w-20`} />
                    <span className="text-muted">each; other tables' average</span>
                    <input aria-label="Other tables' bounty" type="number" inputMode="decimal" step="any" min={0} placeholder="the table's" value={bField} onChange={(e) => setBField(e.target.value)} {...flag("the bounties must")} className={`${field} w-24`} />
                  </>
                )}
                {bFormat === "mystery" && (
                  <>
                    <input aria-label="Average envelope" type="number" inputMode="decimal" step="any" min={0} value={envelope} onChange={(e) => setEnvelope(e.target.value)} {...flag("mystery bounties")} className={`${field} w-20`} />
                    <span className="text-muted">average envelope, or the pool</span>
                    <input aria-label="Envelope pool" type="number" inputMode="decimal" step="any" min={0} value={pool} onChange={(e) => setPool(e.target.value)} {...flag("mystery bounties")} className={`${field} w-20`} />
                    <span className="text-muted">and</span>
                    <input aria-label="Envelopes left" type="number" inputMode="numeric" step={1} min={0} value={left} onChange={(e) => setLeft(e.target.value)} {...flag("envelopes left")} className={`${field} w-16`} />
                    <span className="text-muted">left</span>
                  </>
                )}
              </div>
              {bFormat !== "off" && (
                <p className="text-xs text-muted">
                  In the payouts&rsquo; units.{seatBounties ? " Per-seat bounties go in Seats." : ""}
                </p>
              )}
            </div>
          </fieldset>
        )}

        <details
          open={seatsOpen || seatProblem}
          onToggle={(e) => setSeatsShown(e.currentTarget.open)}
          className="min-w-0 space-y-2 panel px-4 py-3"
        >
          <summary className="cursor-pointer font-medium">
            Seats
            <span className="text-sm font-normal text-muted">
              {seatsSet ? `: ${seatsSet} set by you, the rest the table's stack and the charts' range` : ": each the table's stack and the charts' range"}
            </span>
          </summary>
          <p className="text-xs text-muted">Blank: the table&rsquo;s stack and the charts&rsquo; range. Range: 22+, A2s+, QJs:0.5, AhKh.</p>
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-2 font-normal">Seat</th>
                  <th className="py-1 pr-2 font-normal">
                    Stack (bb, {MIN_STACK} to {MAX_STACK})
                  </th>
                  {seatBounties && <th className="py-1 pr-2 font-normal">Bounty</th>}
                  <th className="py-1 font-normal">Range entering the flop</th>
                </tr>
              </thead>
              <tbody>
                {seats.map((p) => (
                  <tr key={p} className="align-top">
                    <td className="py-1 pr-2 font-medium">{seatLabel(p, players)}</td>
                    <td className="py-1 pr-2">
                      <input aria-label={`${p} stack`} type="number" inputMode="decimal" step="any" placeholder={stackOk ? String(n) : ""} value={stacks[p] ?? ""} onChange={(e) => setStacks({ ...stacks, [p]: e.target.value })} {...flag(`${p}'s stack`)} className={`${field} w-16`} />
                    </td>
                    {seatBounties && (
                      <td className="py-1 pr-2">
                        <input aria-label={`${p} bounty`} type="number" inputMode="decimal" step="any" min={0} placeholder={bEach.trim() || "0"} value={bSeats[p] ?? ""} onChange={(e) => setBSeats({ ...bSeats, [p]: e.target.value })} {...flag(`${p}'s bounty`)} className={`${field} w-16`} />
                      </td>
                    )}
                    <td className="py-1">
                      <div className="flex flex-wrap items-start gap-1.5">
                        <input aria-label={`${p} range`} placeholder="the charts'" value={ranges[p] ?? ""} onChange={(e) => setRanges({ ...ranges, [p]: e.target.value })} {...flag(`${p}'s range`)} className={`${field} min-w-0 flex-1 basis-32`} />
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
        </details>

        {pairs && (
          <section aria-label="Bubble factors" className="min-w-0 space-y-2 panel p-4">
            <h2 className="font-medium">Bubble factors, every pair</h2>
            <BubbleTable table={pairs} />
          </section>
        )}

        <div className={`grid gap-4 ${tour ? "" : "md:grid-cols-[3fr_2fr]"}`}>
        <fieldset className="min-w-0 space-y-2 panel p-4">
          <legend className="font-medium">Bet sizes</legend>
          <p className="text-xs text-muted">
            % of the pot, up to {LIMITS.sizes} a street. Blank: the engine&rsquo;s.
          </p>
          <div className={`grid gap-2 sm:grid-cols-2 ${tour ? "" : "md:grid-cols-1 lg:grid-cols-2"}`}>
            {SIZE_STREETS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0">{SIZE_LABEL[k]}</span>
                <input aria-label={SIZE_LABEL[k]} placeholder="e.g. 33, 75" value={sizes[k]} onChange={(e) => setSizes({ ...sizes, [k]: e.target.value })} {...flag(k === "raise" ? "raise sizes" : `${k} bet sizes`)} className={`${field} min-w-0 flex-1`} />
                <span className="text-muted">%</span>
              </label>
            ))}
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-20 shrink-0">Raise cap</span>
            <select aria-label="Raise cap" value={raises} onChange={(e) => setRaises(Number(e.target.value))} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-sm">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} {n === ENGINE_RAISES ? "(the engine’s)" : ""}
                </option>
              ))}
            </select>
            <span className="text-muted" title="Heads-up pots: 3- and 4-way solves keep their own">
              {raisesWords(raises)}, heads-up
            </span>
          </label>
          <TreeNote />
        </fieldset>

        {!tour && (
          <fieldset className="min-w-0 space-y-2 panel p-4">
            <legend className="font-medium">Rake</legend>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input aria-label="Rake" type="number" inputMode="decimal" step="any" min={0} max={LIMITS.rakePct} placeholder="0" value={rake} onChange={(e) => setRake(e.target.value)} {...flag("the rake must")} className={`${field} w-20`} />
                <span className="text-muted">% of the pot (0 to {LIMITS.rakePct})</span>
              </label>
              <label className="flex items-center gap-1.5">
                capped at
                <input aria-label="Rake cap" type="number" inputMode="decimal" step="any" min={0} placeholder="no cap" value={cap} onChange={(e) => setCap(e.target.value)} {...flag("the rake's cap")} className={`${field} w-24`} />
                <span className="text-muted">bb</span>
              </label>
            </div>
            <p className="text-xs text-muted">
              Taken from pots that see a flop.
            </p>
          </fieldset>
        )}
        </div>

        {problems.length > 0 && (
          <ul role="alert" aria-label="Setup problems" className="list-disc space-y-0.5 rounded-lg border border-danger/40 bg-danger/10 py-2 pl-7 pr-3 text-sm text-danger">
            {problems.map((p, i) => (
              <li key={p} id={`setup-problem-${i}`}>
                {p}
              </li>
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

    </div>
  );
}
