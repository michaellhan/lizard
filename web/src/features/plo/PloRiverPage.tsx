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
import { DEFAULT_SECONDS, DEFAULT_TARGET_PCT, MAX_MEMORY_BYTES, MAX_SECONDS, MAX_TURN_WORK, MAX_WORK, MIN_TARGET_PCT, SEAT_NAMES, type ResultNode, type RiverProgress, type RiverRequest, type RiverResult, type StopReason } from "@/engine/plo/river/run";
import { MAX_BET_SIZES, MAX_RAISE_CAP, MAX_RAISE_SIZES } from "@/engine/plo/river/tree";
import { ploRiverProvenance } from "@/solver/provenance";

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
  // (a turn solves every river too: one size a street to start, as two sizes and a raise are mostly over the limit)
  const [riverBets, setRiverBets] = useState("75");
  const [riverRaises, setRiverRaises] = useState("");
  const [riverCap, setRiverCap] = useState(0);
  const [riverAllIn, setRiverAllIn] = useState(true);
  const isTurn = parseIds(board)?.length === 4;
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
    const riverBetSizes = readSizes(riverBets);
    const riverRaiseSizes = readSizes(riverRaises);
    if (!betSizes || !raiseSizes || (isTurn && (!riverBetSizes || !riverRaiseSizes))) {
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
      ...(isTurn ? { riverSizes: { bets: riverBetSizes!, raises: riverRaiseSizes!, raiseCap: riverCap, allIn: riverAllIn } } : {}),
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
        <h1 className="text-2xl font-semibold">Heads-up PLO4 river and turn solve</h1>
        <p className="text-sm text-muted">
          One river, or a turn and every river card after it, solved exactly at the sizes you list, every combo of both ranges and every card they block. It covers the street you type and after: the ranges are the ones you type, no earlier street
          is solved, it&apos;s heads-up, pot limit&apos;s other sizes aren&apos;t in the tree, and there&apos;s no rake.
        </p>
      </header>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span className="text-muted">OOP range, acts first</span>
          <input aria-label="OOP range" value={oop} onChange={(e) => setOop(e.target.value)} className={inputClass} spellCheck={false} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">IP range, acts last</span>
          <input aria-label="IP range" value={ip} onChange={(e) => setIp(e.target.value)} className={inputClass} spellCheck={false} />
        </label>
        <p className="text-xs text-muted">
          A hand (AsKsQhJh) or a range, separated by commas: AAxx any two aces or more; JT98ds with a suit shape (ds double-suited, ss single-suited, r rainbow); random every hand; @25 a weight in percent.
        </p>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Board, five cards for a river, four for a turn</span>
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
            <span className="text-muted">{isTurn ? "Turn bets" : "Bets"}, % of pot</span>
            <input aria-label="Bet sizes" value={bets} onChange={(e) => setBets(e.target.value)} className={inputClass} />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-muted">{isTurn ? "Turn raises" : "Raises"}, % of pot</span>
            <input aria-label="Raise sizes" value={raises} onChange={(e) => setRaises(e.target.value)} className={inputClass} />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-muted">{isTurn ? "Turn raise cap" : "Raise cap"}</span>
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
          <span>All-in where pot limit allows the whole stack{isTurn ? ", on the turn" : ""}</span>
        </label>
        {isTurn && (
          <fieldset className="space-y-3">
            <legend className="text-sm text-muted">Every river after it</legend>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <label className="min-w-0 space-y-1">
                <span className="text-muted">River bets, % of pot</span>
                <input aria-label="River bet sizes" value={riverBets} onChange={(e) => setRiverBets(e.target.value)} className={inputClass} />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="text-muted">River raises, % of pot</span>
                <input aria-label="River raise sizes" value={riverRaises} onChange={(e) => setRiverRaises(e.target.value)} className={inputClass} />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="text-muted">River raise cap</span>
                <select aria-label="River raise cap" value={riverCap} onChange={(e) => setRiverCap(Number(e.target.value))} className={inputClass}>
                  {Array.from({ length: MAX_RAISE_CAP + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={riverAllIn} onChange={(e) => setRiverAllIn(e.target.checked)} />
              <span>All-in where pot limit allows the whole stack, on the river</span>
            </label>
            <p className="text-xs text-muted">
              Where the turn&apos;s betting closes with chips behind, each of the river cards that can come is solved as its own river at these sizes, in one solve with the turn. All-in on the turn, every river card is a showdown.
            </p>
          </fieldset>
        )}
        <p className="text-xs text-muted">
          Up to {MAX_BET_SIZES} bets and {MAX_RAISE_SIZES} raises. A size is cut to the largest pot-limit bet, lifted to the smallest, and a raise&apos;s percent is of the pot after the call, so 100 is the pot-limit raise. The raise cap counts raises
          after the first bet. Chips one stack has over the other aren&apos;t in play.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="min-w-0 space-y-1">
            <span className="text-muted">Target, % of pot</span>
            <input aria-label="Target exploitability" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass} />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="text-muted">Time budget, s</span>
            <input aria-label="Time budget" inputMode="decimal" value={seconds} onChange={(e) => setSeconds(e.target.value)} className={inputClass} />
          </label>
        </div>
        <p className="text-xs text-muted">
          The target is at least {MIN_TARGET_PCT}%, the budget up to {MAX_SECONDS} s. A solve stops at whichever comes first and says which. A spot is refused, never sampled or grouped, over{" "}
          {(MAX_WORK / 1e6).toFixed(0)} million combos times ways a hand can end (a turn {(MAX_TURN_WORK / 1e6).toFixed(0)} million, counting every river&apos;s), or about {(MAX_MEMORY_BYTES / 1e6).toFixed(0)} MB.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={running} className={buttonClass}>
            {isTurn ? "Solve this turn" : "Solve this river"}
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
      {result && <Results key={result.iterations} result={result} />}
    </div>
  );
}

function Results({ result }: { result: RiverResult }) {
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
      }),
    [result],
  );
  const turn = result.street === "turn";
  const dropped = result.unmatched.flatMap((x, seat) => (x ? [`${x.toLocaleString("en-US")} ${SEAT_NAMES[seat]} combos left out: each shares a card with every hand on the other side.`] : []));
  return (
    <section aria-label={turn ? "Turn solution" : "River solution"} className="min-w-0 space-y-3">
      <ProvenanceBadge p={provenance} />
      <p className="text-sm">
        {stopWords(result)} Exploitability {result.exploitability.pct.toFixed(3)}% of the pot ({result.exploitability.chips.toFixed(3)}bb a matchup), the average of what each seat gains by an exact best response in this tree{turn ? `, through the turn and all ${result.rivers} rivers` : ""}.
      </p>
      <p className="text-xs text-muted">
        Board {result.board}
        {turn ? ` and ${result.rivers} river cards` : ""}, pot {result.pot}, {result.stack} behind in play, {result.hands[0].length.toLocaleString("en-US")} OOP and {result.hands[1].length.toLocaleString("en-US")} IP combos, {result.iterations.toLocaleString("en-US")} iterations in{" "}
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
      <ComboTable key={node.id} result={result} node={node} />
      {turn && <p className="text-xs text-muted">The turn&apos;s decisions are shown. Every river after them was solved with them, and isn&apos;t shown card by card.</p>}
      <p className="text-xs text-muted">
        EV is in bb: chips won from the pot of {result.pot}, less chips bet {turn ? "on the turn and river" : "on the river"}, so the two ranges&apos; EVs add to the pot on every line. A frequency counts the matchups that can be dealt, so a card a hand blocks is in it. No rake.
      </p>
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
            <td className="py-1 font-mono">{chips(node.rangeEv[seat]!)}</td>
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
              <td className="py-1 pr-4 font-mono">{pct(node.frequency[k]!)}</td>
              <td className="py-1 font-mono">{chips(node.actionRangeEv[k]!)}</td>
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

function ComboTable({ result, node }: { result: RiverResult; node: ResultNode }) {
  const [find, setFind] = useState("");
  const [shown, setShown] = useState(PAGE_ROWS);
  const hands = result.hands[node.player]!;
  const start = result.weights[node.player]!;
  const n = hands.length;
  const reaching = useMemo(() => {
    const out: number[] = [];
    // a river's game holds the weakest first: strongest first here. A turn has no order of strength: highest EV first
    for (let i = n - 1; i >= 0; i--) if (node.weight[i]! > 0) out.push(i);
    if (result.street === "turn") out.sort((a, b) => (Number.isNaN(node.ev[b]!) ? -Infinity : node.ev[b]!) - (Number.isNaN(node.ev[a]!) ? -Infinity : node.ev[a]!));
    return out;
  }, [node, n, result.street]);
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
        {SEAT_NAMES[node.player]}: {rows.length.toLocaleString("en-US")} of {n.toLocaleString("en-US")} combos reach this decision{wanted ? " and match" : ""}, {result.street === "turn" ? "highest EV first" : "strongest first"}. Showing {visible.length.toLocaleString("en-US")}.
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
            <tbody className="font-mono">
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
