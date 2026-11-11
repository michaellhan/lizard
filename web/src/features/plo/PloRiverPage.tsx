// One heads-up PLO4 river, or a turn and every river after it, solved exactly on the sizes listed, from ranges a person
// types (engine/plo/river/, engine/plo/turn/). That's all it is: no street before the one typed is solved, the ranges aren't anyone's solution, there's no rake, and pot-limit poker's other
// sizes aren't in the tree. The page says so, and every number under it sits under the solve's provenance. Loaded with its
// route, so no PLO code is in the first download; the work is done in a worker.
import { useEffect, useMemo, useRef, useState } from "react";
import { PhoneColumns } from "@/components/PhoneColumns";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { cardName, parseIds } from "@/engine/plo/cards";
import { handAt } from "@/engine/plo/combos";
import { RiverClient } from "@/engine/plo/river/client";
import { DEFAULT_SECONDS, DEFAULT_TARGET_PCT, MAX_SECONDS, MIN_TARGET_PCT, SEAT_NAMES, type ResultNode, type RiverProgress, type RiverRequest, type RiverResult, type RiverView, type StopReason, type ViewPath } from "@/engine/plo/river/run";
import { MAX_BET_SIZES, MAX_RAISE_CAP, MAX_RAISE_SIZES } from "@/engine/plo/river/tree";
import { ploRiverProvenance } from "@/solver/provenance";
import { byClass } from "./classes";
import { spotsFromHistory, type HistoryRead, type HistorySpot } from "./fromHistory";
import { deal, EMPTY_TALLY, gradeAt, mixAt, potAt, tallied, toCall, type DrillSpot, type DrillTally } from "./drill";
import type { Grade } from "@/grading/grade";

const inputClass = "w-full min-w-0 rounded border border-border bg-surface px-2 py-1 font-mono text-sm";
const buttonClass = "rounded border border-border px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-40";
const PAGE_ROWS = 50;

const pct = (x: number | null, digits = 1) => (x === null ? "–" : `${(x * 100).toFixed(digits)}%`);
const chips = (x: number | null) => (x === null || Number.isNaN(x) ? "–" : x.toFixed(2));
const handText = (i: number) => handAt(i).map(cardName).join("");

/** "50, 100" as numbers, or null if it isn't. An empty list is fine: that seat of the tree has no such size. */
function readSizes(text: string): number[] | null {
  const items = text
    .split(",")
    .map((s) => s.trim().replace(/%$/, ""))
    .filter(Boolean);
  const out = items.map(Number);
  return out.every(Number.isFinite) ? out : null;
}

function stopWords(r: RiverResult): string {
  const said: Record<StopReason, string> = {
    target: `Reached the target of ${r.targetPct}% of the pot.`,
    time: `The time budget ran out short of the ${r.targetPct}% target: these numbers are approximate.`,
    iterations: `The iteration limit came before the ${r.targetPct}% target: these numbers are approximate.`,
    cancelled: `Cancelled: the strategies as they stood${r.exploitability.pct <= r.targetPct ? "" : `, short of the ${r.targetPct}% target, so approximate`}.`,
  };
  return said[r.stop];
}

function progressWords(p: RiverProgress | null) {
  if (!p) return "Reading the ranges";
  const far = p.exploitabilityPct === null ? "not measured yet" : `${p.exploitabilityPct.toFixed(3)}% of the pot from equilibrium`;
  return `${p.iterations.toLocaleString("en-US")} iterations, ${far}, ${p.seconds.toFixed(1)} s`;
}

export function PloRiverPage() {
  const [oop, setOop] = useState("AAxx,KKxx,QQxx");
  const [ip, setIp] = useState("JT98,JT97,T987");
  const [board, setBoard] = useState("Js9s4d2h7c");
  const [pot, setPot] = useState("20");
  const [stackOop, setStackOop] = useState("100");
  const [stackIp, setStackIp] = useState("100");
  const [bets, setBets] = useState("50, 100");
  const [raises, setRaises] = useState("100");
  const [raiseCap, setRaiseCap] = useState(2);
  const [allIn, setAllIn] = useState(true);
  // (a turn solves every river too, a flop every turn and river: one size a street to start, as two sizes and a raise
  // are mostly over the limit)
  const [turnBets, setTurnBets] = useState("75");
  const [turnRaises, setTurnRaises] = useState("");
  const [turnCap, setTurnCap] = useState(0);
  const [turnAllIn, setTurnAllIn] = useState(true);
  const [riverBets, setRiverBets] = useState("75");
  const [riverRaises, setRiverRaises] = useState("");
  const [riverCap, setRiverCap] = useState(0);
  const [riverAllIn, setRiverAllIn] = useState(true);
  const cardCount = parseIds(board)?.length;
  const isTurn = cardCount === 4;
  const isFlop = cardCount === 3;
  const street = isFlop ? "Flop" : isTurn ? "Turn" : "";
  const [fromHand, setFromHand] = useState<string | null>(null);
  const [target, setTarget] = useState(String(DEFAULT_TARGET_PCT));
  const [seconds, setSeconds] = useState(String(DEFAULT_SECONDS));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RiverProgress | null>(null);
  const [result, setResult] = useState<RiverResult | null>(null);
  const [cancelledEmpty, setCancelledEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<RiverClient | null>(null);

  useEffect(
    () => () => {
      client.current?.dispose();
    },
    [],
  );

  const run = async () => {
    setError(null);
    setResult(null);
    setCancelledEmpty(false);
    setProgress(null);
    const betSizes = readSizes(bets);
    const raiseSizes = readSizes(raises);
    const turnBetSizes = readSizes(turnBets);
    const turnRaiseSizes = readSizes(turnRaises);
    const riverBetSizes = readSizes(riverBets);
    const riverRaiseSizes = readSizes(riverRaises);
    if (!betSizes || !raiseSizes || ((isTurn || isFlop) && (!riverBetSizes || !riverRaiseSizes)) || (isFlop && (!turnBetSizes || !turnRaiseSizes))) {
      setError("Sizes are percents, separated by commas: 50, 100.");
      return;
    }
    const request: RiverRequest = {
      oop,
      ip,
      board,
      pot: Number(pot),
      stacks: [Number(stackOop), Number(stackIp)],
      sizes: { bets: betSizes, raises: raiseSizes, raiseCap, allIn },
      ...(isFlop ? { turnSizes: { bets: turnBetSizes!, raises: turnRaiseSizes!, raiseCap: turnCap, allIn: turnAllIn } } : {}),
      ...(isTurn || isFlop ? { riverSizes: { bets: riverBetSizes!, raises: riverRaiseSizes!, raiseCap: riverCap, allIn: riverAllIn } } : {}),
      targetPct: Number(target),
      seconds: Number(seconds),
    };
    const c = (client.current ??= new RiverClient());
    setRunning(true);
    try {
      const outcome = await c.run(request, setProgress);
      setResult(outcome.result);
      setCancelledEmpty(outcome.cancelled && !outcome.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Heads-up PLO4 flop, turn and river solve</h1>
        <p className="text-sm text-muted">No rake; earlier streets aren&apos;t solved.</p>
      </header>

      <FromHistory
        onUse={(spot, read) => {
          setBoard(spot.board);
          setPot(String(spot.pot));
          setStackOop(String(spot.stacks[0]));
          setStackIp(String(spot.stacks[1]));
          setFromHand(
            `From your hand: the ${spot.street}, ${spot.seats[0]} (OOP) against ${spot.seats[1]} (IP)${spot.hero === null ? `, after you'd folded (you were ${read.heroPos} with ${read.hole})` : `, you ${spot.seats[spot.hero]} with ${read.hole}`}. Board, pot and stacks filled; type the ranges.`,
          );
        }}
      />
      {fromHand && (
        <p aria-label="From your hand" aria-live="polite" className="text-sm">
          {fromHand}
        </p>
      )}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-muted">OOP range, acts first</span>
          <input aria-label="OOP range" value={oop} onChange={(e) => setOop(e.target.value)} className={inputClass} spellCheck={false} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">IP range, acts last</span>
          <input aria-label="IP range" value={ip} onChange={(e) => setIp(e.target.value)} className={inputClass} spellCheck={false} />
        </label>
        </div>
        <p className="text-xs text-muted">e.g. AAxx, JT98ds, KQJTss@25, AsKsQhJh, random</p>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Board, five cards for a river, four for a turn, three for a flop</span>
          <input aria-label="Board" value={board} onChange={(e) => setBoard(e.target.value)} className={inputClass} spellCheck={false} />
        </label>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label className="min-w-0 space-y-1">
            <span className="text-muted">Pot, bb</span>
            <input aria-label="Pot" inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value)} className={inputClass} />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-muted">OOP stack</span>
            <input aria-label="OOP stack" inputMode="decimal" value={stackOop} onChange={(e) => setStackOop(e.target.value)} className={inputClass} />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-muted">IP stack</span>
            <input aria-label="IP stack" inputMode="decimal" value={stackIp} onChange={(e) => setStackIp(e.target.value)} className={inputClass} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <label className="min-w-0 space-y-1">
            <span className="text-muted">{street ? `${street} bets` : "Bets"}, % of pot</span>
            <input aria-label="Bet sizes" value={bets} onChange={(e) => setBets(e.target.value)} className={inputClass} />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-muted">{street ? `${street} raises` : "Raises"}, % of pot</span>
            <input aria-label="Raise sizes" value={raises} onChange={(e) => setRaises(e.target.value)} className={inputClass} />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-muted">{street ? `${street} raise cap` : "Raise cap"}</span>
            <select aria-label="Raise cap" value={raiseCap} onChange={(e) => setRaiseCap(Number(e.target.value))} className={inputClass}>
              {Array.from({ length: MAX_RAISE_CAP + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allIn} onChange={(e) => setAllIn(e.target.checked)} />
          <span>All-in where pot limit allows the whole stack{street ? `, on the ${street.toLowerCase()}` : ""}</span>
        </label>
        {isFlop && (
          <StreetSizes
            street="Turn"
            legend="Every turn after it"
            bets={[turnBets, setTurnBets]}
            raises={[turnRaises, setTurnRaises]}
            cap={[turnCap, setTurnCap]}
            allIn={[turnAllIn, setTurnAllIn]}
            note="Each turn card is solved at these sizes."
          />
        )}
        {(isTurn || isFlop) && (
          <StreetSizes
            street="River"
            legend="Every river after it"
            bets={[riverBets, setRiverBets]}
            raises={[riverRaises, setRiverRaises]}
            cap={[riverCap, setRiverCap]}
            allIn={[riverAllIn, setRiverAllIn]}
            note={"Each river card is solved at these sizes."}
          />
        )}
        <p className="text-xs text-muted">
          Up to {MAX_BET_SIZES} bets and {MAX_RAISE_SIZES} raises; a raise&apos;s % is of the pot after the call.
        </p>
        {/* (the solver's stopping rules on the Solve button's row) */}
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="w-36 space-y-1" title={`At least ${MIN_TARGET_PCT}%`}>
            <span className="text-muted">Target, % of pot</span>
            <input aria-label="Target exploitability" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass} />
          </label>
          <label className="w-36 space-y-1" title={`Up to ${MAX_SECONDS} s`}>
            <span className="text-muted">Time budget, s</span>
            <input aria-label="Time budget" inputMode="decimal" value={seconds} onChange={(e) => setSeconds(e.target.value)} className={inputClass} />
          </label>
          <button type="submit" disabled={running} className={buttonClass}>
            {isFlop ? "Solve this flop" : isTurn ? "Solve this turn" : "Solve this river"}
          </button>
          {running && (
            <button type="button" className={buttonClass} onClick={() => client.current?.cancel()}>
              Cancel
            </button>
          )}
          {running && (
            <span role="status" className="text-sm text-muted">
              {progressWords(progress)}
            </span>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {cancelledEmpty && <p className="text-sm text-muted">Cancelled before there was anything to show.</p>}
      {result && <Results key={result.iterations} result={result} onView={(path) => client.current?.river(path) ?? Promise.resolve(null)} />}
    </div>
  );
}

type Pair<T> = readonly [T, (v: T) => void];

/** The sizes of a street after the first: its bets, raises, raise cap and all-in. */
function StreetSizes({ street, legend, bets, raises, cap, allIn, note }: { street: "Turn" | "River"; legend: string; bets: Pair<string>; raises: Pair<string>; cap: Pair<number>; allIn: Pair<boolean>; note: string }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm text-muted">{legend}</legend>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <label className="min-w-0 space-y-1">
          <span className="text-muted">{street} bets, % of pot</span>
          <input aria-label={`${street} bet sizes`} value={bets[0]} onChange={(e) => bets[1](e.target.value)} className={inputClass} />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="text-muted">{street} raises, % of pot</span>
          <input aria-label={`${street} raise sizes`} value={raises[0]} onChange={(e) => raises[1](e.target.value)} className={inputClass} />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="text-muted">{street} raise cap</span>
          <select aria-label={`${street} raise cap`} value={cap[0]} onChange={(e) => cap[1](Number(e.target.value))} className={inputClass}>
            {Array.from({ length: MAX_RAISE_CAP + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allIn[0]} onChange={(e) => allIn[1](e.target.checked)} />
        <span>All-in where pot limit allows the whole stack, on the {street.toLowerCase()}</span>
      </label>
      <p className="text-xs text-muted">{note}</p>
    </fieldset>
  );
}

type AskView = (path: ViewPath) => Promise<RiverView | null>;

function Results({ result, onView }: { result: RiverResult; onView: AskView }) {
  const [nodeId, setNodeId] = useState(0);
  const node = result.nodes.find((n) => n.id === nodeId) ?? result.nodes[0]!;
  const provenance = useMemo(
    () =>
      ploRiverProvenance({
        stop: result.stop,
        iterations: result.iterations,
        seconds: result.seconds,
        exploitabilityPct: result.exploitability.pct,
        targetPct: result.targetPct,
        sizes: result.sizes,
        ...(result.street === "turn" ? { turn: { riverSizes: result.riverSizes!, rivers: result.rivers! } } : {}),
        ...(result.street === "flop" ? { flop: { turnSizes: result.turnSizes!, riverSizes: result.riverSizes!, turns: result.turns! } } : {}),
      }),
    [result],
  );
  const turn = result.street === "turn";
  const flop = result.street === "flop";
  const later = turn || flop;
  const dropped = result.unmatched.flatMap((x, seat) => (x ? [`${x.toLocaleString("en-US")} ${SEAT_NAMES[seat]} combos left out (blocked).`] : []));
  return (
    <section aria-label={flop ? "Flop solution" : turn ? "Turn solution" : "River solution"} className="min-w-0 space-y-3">
      <ProvenanceBadge p={provenance} />
      <p className="text-sm">
        {stopWords(result)} Exploitability {result.exploitability.pct.toFixed(3)}% of the pot ({result.exploitability.chips.toFixed(3)}bb a matchup).
      </p>
      <p className="text-xs text-muted">
        Board {result.board}
        {turn ? ` and ${result.rivers} river cards` : ""}
        {flop ? ` and ${result.turns} turn cards` : ""}, pot {result.pot}, {result.stack} behind in play, {result.hands[0].length.toLocaleString("en-US")} OOP and {result.hands[1].length.toLocaleString("en-US")} IP combos, {result.iterations.toLocaleString("en-US")} iterations in{" "}
        {result.seconds.toFixed(1)} s, up to {Math.ceil(result.memoryBytes / 1e6)} MB. {dropped.join(" ")}
      </p>

      <label className="block space-y-1 text-sm">
        <span className="text-muted">Decision</span>
        <select aria-label="Decision" value={node.id} onChange={(e) => setNodeId(Number(e.target.value))} className={inputClass}>
          {result.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {decisionWords(n)}
            </option>
          ))}
        </select>
      </label>

      <RangeTable node={node} />
      <ActionTable node={node} />
      <EveryDecision nodes={result.nodes} />
      <ClassTable hands={result.hands[node.player]!} board={result.board} node={node} />
      <ComboTable key={node.id} hands={result.hands[node.player]!} start={result.weights[node.player]!} byEv={later} node={node} />
      <Drill result={result} band={provenance.band} />
      {later && (
        <After
          next={flop ? "turn" : "river"}
          board={result.board}
          lines={result.closings ?? []}
          cards={flop ? (result.turnCards ?? []) : (result.riverCards ?? [])}
          ask={(closing, card) => onView({ closing, card })}
          onView={onView}
        />
      )}
      <p className="text-xs text-muted">EV in bb of the pot of {result.pot}. No rake.</p>
    </section>
  );
}

const decisionWords = (n: ResultNode) => `${SEAT_NAMES[n.player]} ${n.line ? `after ${n.line}` : "to start"}`;

function RangeTable({ node }: { node: ResultNode }) {
  return (
    <table aria-label="Ranges on this line" className="w-full text-sm">
      <thead className="text-left text-muted">
        <tr>
          <th className="py-1 pr-4 font-normal">Range</th>
          <th className="py-1 font-normal">EV, bb</th>
        </tr>
      </thead>
      <tbody>
        {SEAT_NAMES.map((name, seat) => (
          <tr key={name} className="border-t border-border">
            <td className="py-1 pr-4">{name}</td>
            <td className="py-1">{chips(node.rangeEv[seat]!)}</td>
          </tr>
        ))}
      </tbody>
      <caption className="caption-bottom pt-1 text-left text-xs text-muted">{node.reach > 0 ? `This line comes up in ${pct(node.reach)} of the matchups.` : "The solution never reaches this line."}</caption>
    </table>
  );
}

function ActionTable({ node }: { node: ResultNode }) {
  return (
    <div className="scroll-x">
      <table aria-label="Actions at this decision" className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="py-1 pr-4 font-normal">{SEAT_NAMES[node.player]} action</th>
            <th className="py-1 pr-4 font-normal">Frequency</th>
            <th className="py-1 font-normal">EV, bb</th>
          </tr>
        </thead>
        <tbody>
          {node.actions.map((a, k) => (
            <tr key={a.token} className="border-t border-border">
              <td className="py-1 pr-4">{a.label}</td>
              <td className="py-1 pr-4">{pct(node.frequency[k]!)}</td>
              <td className="py-1">{chips(node.actionRangeEv[k]!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EveryDecision({ nodes }: { nodes: readonly ResultNode[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Every decision, both ranges</summary>
      <ul aria-label="Every decision" className="mt-1 space-y-1">
        {nodes.map((n) => (
          <li key={n.id} className="border-t border-border py-1">
            <span className="block">{decisionWords(n)}</span>
            <span className="block text-xs text-muted">{n.reach > 0 ? `${pct(n.reach)} of matchups: ${n.actions.map((a, k) => `${a.label} ${pct(n.frequency[k]!)}`).join(", ")}` : "never reached"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A PLO hand you played (fromHistory.ts): pasted, read, and one of its heads-up streets put in the form. */
function FromHistory({ onUse }: { onUse: (spot: HistorySpot, read: HistoryRead) => void }) {
  const [text, setText] = useState("");
  const [read, setRead] = useState<HistoryRead | string | null>(null);
  const [pick, setPick] = useState(0);
  const got = read && typeof read !== "string" ? read : null;
  return (
    <details className="rounded border border-border p-3 text-sm">
      <summary className="cursor-pointer">Start from a hand you played</summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted">Paste a PLO4 hand history. Nothing is kept.</p>
        <textarea aria-label="PLO hand history" value={text} onChange={(e) => setText(e.target.value)} rows={5} className={`${inputClass} font-mono text-xs`} spellCheck={false} />
        <button
          type="button"
          className={buttonClass}
          disabled={!text.trim()}
          onClick={() => {
            setRead(spotsFromHistory(text));
            setPick(0);
          }}
        >
          Read the hand
        </button>
        {typeof read === "string" && <p role="alert">{read}</p>}
        {got && (
          <div className="space-y-2">
            <p>
              You were {got.heroPos} with <span className="font-mono">{got.hole}</span>. {got.skipped.join(" ")} {got.warnings.join(" ")}
            </p>
            {got.spots.length === 0 ? (
              <p>No street had two players with chips behind.</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0 space-y-1">
                  <span className="text-muted">Street</span>
                  <select aria-label="Street from the hand" value={pick} onChange={(e) => setPick(Number(e.target.value))} className={inputClass}>
                    {got.spots.map((x, k) => (
                      <option key={x.street} value={k}>
                        {`${x.street[0]!.toUpperCase()}${x.street.slice(1)} ${x.board}: pot ${x.pot}, ${x.seats[0]} ${x.stacks[0]} and ${x.seats[1]} ${x.stacks[1]} behind`}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={buttonClass} onClick={() => onUse(got.spots[pick]!, got)}>
                  Use this street
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

/** Practice on the solve (drill.ts): a hand dealt as play brings it, at a decision of the street solved first, your action
 * graded against this combo's mix and EVs in the solve, with a running tally. Every number is the solve's, under its badge. */
function Drill({ result, band }: { result: RiverResult; band: string | undefined }) {
  const [spot, setSpot] = useState<DrillSpot | null>(null);
  const [answer, setAnswer] = useState<Grade | null>(null);
  const [tally, setTally] = useState<DrillTally>(EMPTY_TALLY);
  const [dealt, setDealt] = useState(false);
  // (a new solve starts the practice afresh)
  const [owner, setOwner] = useState(result);
  if (owner !== result) {
    setOwner(result);
    setSpot(null);
    setAnswer(null);
    setTally(EMPTY_TALLY);
    setDealt(false);
  }
  const node = spot ? result.nodes.find((n) => n.id === spot.node) : undefined;
  const first = result.street === "flop" ? "flop" : result.street === "turn" ? "turn" : "river";
  const next = () => {
    setSpot(deal(result.nodes));
    setAnswer(null);
    setDealt(true);
  };
  const choose = (a: number) => {
    if (!node || !spot || answer) return;
    const g = gradeAt(node, spot.combo, a, result.pot, band);
    setAnswer(g);
    setTally((t) => tallied(t, g));
  };
  const pot = node ? potAt(node, result.pot) : 0;
  const call = node ? toCall(node) : 0;
  const mix = node && spot ? mixAt(node, spot.combo) : [];
  return (
    <section aria-label="Practice this solve" className="space-y-2 rounded border border-border p-3 text-sm">
      <h2 className="font-semibold">Practice this solve</h2>
      <p className="text-xs text-muted">
        Graded against this solve&apos;s mix and EVs{band === "rough" || band === "approximate" ? "; not converged, so no verdict past Inaccuracy" : ""}.
      </p>
      <button type="button" className={buttonClass} onClick={next}>
        {spot ? "Next hand" : "Deal a hand"}
      </button>
      {dealt && spot === null && <p>No decision in this solve is reached by a hand that can be graded.</p>}
      {node && spot && (
        <div className="space-y-2">
          <p aria-label="Your spot">
            You&apos;re {SEAT_NAMES[node.player]} with <span className="font-mono">{handText(result.hands[node.player]![spot.combo]!)}</span> on <span className="font-mono">{result.board}</span>. {node.line ? `${node.line}.` : `First to act on the ${first}.`} Pot {chips(pot)}
            {call > 0 ? `, ${chips(call)} to call` : ""}, {chips(result.stack - node.bets[node.player])} behind.
          </p>
          <div role="group" aria-label="Your action" className="flex flex-wrap gap-2">
            {node.actions.map((a, k) => (
              <button key={a.token} type="button" className={buttonClass} disabled={answer !== null} aria-pressed={answer?.a === k} onClick={() => choose(k)}>
                {a.label}
              </button>
            ))}
          </div>
          {answer && (
            <div role="status" className="space-y-1">
              <p>
                <span className="font-semibold">{answer.verdict}</span>
                {answer.loss > 0 ? `: ${chips(answer.loss)}bb given up, ${answer.lossPct.toFixed(1)}% of the pot` : ""}
                {answer.capped ? " (capped: the solve is short of converged)" : ""}. The solve&apos;s best here is {node.actions[answer.best]!.label}
                {answer.mixed ? ", and this hand mixes" : ""}.
              </p>
              <table aria-label="This hand in the solve" className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1 pr-4 font-normal">Action</th>
                    <th className="py-1 pr-4 font-normal">Frequency</th>
                    <th className="py-1 font-normal">EV, best play after, bb</th>
                  </tr>
                </thead>
                <tbody>
                  {node.actions.map((a, k) => (
                    <tr key={a.token} className="border-t border-border">
                      <td className="py-1 pr-4">{a.label}</td>
                      <td className="py-1 pr-4">{pct(mix[k]!.freq)}</td>
                      <td className="py-1">{chips(mix[k]!.ev)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tally.hands > 0 && (
        <p aria-label="Your tally" className="text-xs text-muted">
          {tally.hands} hand{tally.hands === 1 ? "" : "s"}: {tally.ok} Best or Correct, {chips(tally.loss)}bb given up. Not saved.
        </p>
      )}
    </section>
  );
}

/** The street after one of the solve's closing lines, on one card: the solve's own strategies there, entered with the
 * line's reach, asked of the job that solved it (still in the worker). A flop's turn has a river after it, the same way. */
function After({ next, board, lines, cards, ask, onView }: { next: "turn" | "river"; board: string; lines: readonly { id: number; line: string }[]; cards: readonly string[]; ask: (closing: number, card: string) => Promise<RiverView | null>; onView: AskView }) {
  const [closing, setClosing] = useState(lines[0]?.id ?? -1);
  const [card, setCard] = useState(cards[0] ?? "");
  const [view, setView] = useState<RiverView | null>(null);
  const [missing, setMissing] = useState(false);
  const [nodeId, setNodeId] = useState(0);
  const street = next === "turn" ? "turn" : "river";
  const before = next === "turn" ? "flop" : "turn";
  if (!lines.length || !cards.length) return <p className="text-xs text-muted">{`Every ${before} line ends all-in or folded: no ${street} decision.`}</p>;
  const show = async () => {
    const v = await ask(closing, card);
    setView(v);
    setMissing(!v);
    setNodeId(0);
  };
  const node = view ? (view.nodes.find((n) => n.id === nodeId) ?? view.nodes[0]!) : null;
  const title = `The ${street} after the ${before}`;
  const Street = street === "turn" ? "Turn" : "River";
  return (
    <section aria-label={title} className="min-w-0 space-y-3 border-t border-border pt-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <label className="min-w-0 space-y-1">
          <span className="text-muted">After</span>
          <select aria-label={`${before === "flop" ? "Flop" : "Turn"} line`} value={closing} onChange={(e) => setClosing(Number(e.target.value))} className={inputClass}>
            {lines.map((c) => (
              <option key={c.id} value={c.id}>
                {c.line}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1">
          <span className="text-muted">{Street} card</span>
          <select aria-label={`${Street} card`} value={card} onChange={(e) => setCard(e.target.value)} className={inputClass}>
            {cards.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonClass} onClick={() => void show()}>
          Show this {street}
        </button>
      </div>
      {missing && <p className="text-sm text-muted">That {street} is gone from the worker. Solve again.</p>}
      {view && node && (
        <>
          <p className="text-xs text-muted">
            Board {board} {view.card}: pot {view.pot}, {view.stack} behind.
          </p>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">{Street} decision</span>
            <select aria-label={`${Street} decision`} value={node.id} onChange={(e) => setNodeId(Number(e.target.value))} className={inputClass}>
              {view.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {decisionWords(n)}
                </option>
              ))}
            </select>
          </label>
          <RangeTable node={node} />
          <ActionTable node={node} />
          <ClassTable hands={view.hands[node.player]!} board={`${board}${view.card}`} node={node} />
          <ComboTable key={`${view.closing}:${view.card}:${node.id}`} hands={view.hands[node.player]!} start={view.weights[node.player]!} byEv={street === "turn"} node={node} />
          <p className="text-xs text-muted">
            EV in bb of the {street}&apos;s pot of {view.pot}.
          </p>
          {view.street === "turn" && (
            <After
              key={`${view.closing}:${view.card}`}
              next="river"
              board={`${board} ${view.card}`}
              lines={view.closings ?? []}
              cards={view.riverCards ?? []}
              ask={(turnClosing, river) => onView({ closing: view.closing, card: view.card, turnClosing, river })}
              onView={onView}
            />
          )}
        </>
      )}
    </section>
  );
}

/** The decision's range condensed: its combos by what they hold on the board, strongest first. */
function ClassTable({ hands, board, node }: { hands: Int32Array; board: string; node: ResultNode }) {
  const cards = parseIds(board);
  const rows = cards ? byClass(hands, cards, node) : [];
  if (!rows.length) return null;
  return (
    <div className="scroll-x">
      <table aria-label="Hand classes at this decision" className="w-full text-xs">
        <thead className="text-left align-bottom text-muted">
          <tr>
            <th className="py-1 pr-2 font-normal">{SEAT_NAMES[node.player]} holds</th>
            <th className="py-1 pr-2 font-normal">Share</th>
            {node.actions.map((a) => (
              <th key={a.token} className="py-1 pr-2 font-normal">
                {a.label}
              </th>
            ))}
            <th className="py-1 font-normal">EV, bb</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border">
              <td className="whitespace-nowrap py-1 pr-2">
                {r.name} <span className="text-muted">({r.combos.toLocaleString("en-US")})</span>
              </td>
              <td className="py-1 pr-2">{pct(r.share)}</td>
              {r.frequency.map((f, k) => (
                <td key={node.actions[k]!.token} className="py-1 pr-2">
                  {pct(f, 0)}
                </td>
              ))}
              <td className="py-1">{chips(r.ev)}</td>
            </tr>
          ))}
        </tbody>
        <caption className="caption-bottom pt-1 text-left text-xs text-muted">
          Each combo by its best hand on this board, two cards from the hand and three from the board{cards!.length === 4 ? ", and a flush draw where two of its suit are on the board" : ""}. Share and mix are by combo weight here, not by matchups, so they can differ a little from the actions above.
        </caption>
      </table>
    </div>
  );
}

function ComboTable({ hands, start, byEv, node }: { hands: Int32Array; start: Float32Array; byEv: boolean; node: ResultNode }) {
  const [find, setFind] = useState("");
  const [shown, setShown] = useState(PAGE_ROWS);
  const n = hands.length;
  const reaching = useMemo(() => {
    const out: number[] = [];
    // a river's game holds the weakest first: strongest first here. A turn has no order of strength: highest EV first
    for (let i = n - 1; i >= 0; i--) if (node.weight[i]! > 0) out.push(i);
    if (byEv) out.sort((a, b) => (Number.isNaN(node.ev[b]!) ? -Infinity : node.ev[b]!) - (Number.isNaN(node.ev[a]!) ? -Infinity : node.ev[a]!));
    return out;
  }, [node, n, byEv]);
  const wanted = find.trim().toLowerCase();
  const rows = useMemo(() => (wanted ? reaching.filter((i) => handText(hands[i]!).toLowerCase().includes(wanted)) : reaching), [reaching, wanted, hands]);
  const visible = rows.slice(0, shown);
  return (
    <div className="min-w-0 space-y-2">
      <label className="block space-y-1 text-sm">
        <span className="text-muted">Find a hand</span>
        <input aria-label="Find a hand" value={find} onChange={(e) => setFind(e.target.value)} className={inputClass} spellCheck={false} />
      </label>
      <p className="text-xs text-muted">
        {SEAT_NAMES[node.player]}: {rows.length.toLocaleString("en-US")} of {n.toLocaleString("en-US")} combos reach this decision{wanted ? " and match" : ""}, {byEv ? "highest EV first" : "strongest first"}. Showing {visible.length.toLocaleString("en-US")}.
      </p>
      <PhoneColumns hidden={["Reach"]}>
        <div className="scroll-x">
          <table aria-label="Combos at this decision" className="w-full text-xs">
            <thead className="text-left align-bottom text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">Hand</th>
                <th className="phone-col py-1 pr-2 font-normal">Reach</th>
                {node.actions.map((a) => (
                  <th key={a.token} className="py-1 pr-2 font-normal">
                    {a.label}
                  </th>
                ))}
                <th className="py-1 font-normal">EV, bb</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i} className="border-t border-border">
                  <td className="whitespace-nowrap py-1 pr-2">{handText(hands[i]!)}</td>
                  <td className="phone-col py-1 pr-2">{pct(node.weight[i]! / start[i]!, 0)}</td>
                  {node.actions.map((a, k) => (
                    <td key={a.token} className="py-1 pr-2">
                      {pct(node.strategy[k * n + i]!, 0)}
                    </td>
                  ))}
                  <td className="py-1">{chips(node.ev[i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PhoneColumns>
      {rows.length > shown && (
        <button type="button" className={buttonClass} onClick={() => setShown((s) => s + PAGE_ROWS)}>
          Show {Math.min(PAGE_ROWS, rows.length - shown)} more
        </button>
      )}
    </div>
  );
}
