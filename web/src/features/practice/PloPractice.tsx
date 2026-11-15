// Practice for Pot-Limit Omaha (registry: PLO4): hands played on a heads-up flop, turn or river solve from ranges you
// give (a preset, or a Study spot in the link), the other seat played by the solve, every decision of yours graded by
// EV lost against it (features/plo/playHand.ts). Loaded in its own chunk only when the link names PLO. The tally stays on
// the page: PLO hands aren't saved to History, and the page says so.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { GamePicker, NotForGame } from "@/components/GamePicker";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { PLO4 } from "@/engine/registry";
import { cardName, parseIds } from "@/engine/plo/cards";
import { handAt } from "@/engine/plo/combos";
import { RiverClient } from "@/engine/plo/river/client";
import { SEAT_NAMES, type RiverProgress, type RiverResult } from "@/engine/plo/river/run";
import { progressWords, resultProvenance, stopWords } from "@/features/plo/PloRiverPage";
import { act, EMPTY_PLAY_TALLY, startPlay, tallyPlay, type Play, type PlayContext, type PlayTally } from "@/features/plo/playHand";
import { PLO_PRESETS } from "@/features/plo/presets";
import { DEFAULT_SPOT, requestOf, spotFromParams, spotToParams, type PloSpot } from "@/features/plo/spot";

const inputClass = "w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-sm";
const buttonClass = "rounded border border-border px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-40";
const chips = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const FROM_LINK = "link";
// Practice plays many hands on one solve: a little looser than Study's target, the time budget the same
const PRACTICE_TARGET = 0.3;
const PRACTICE_SECONDS = 30;

const Cards = ({ text, label }: { text: string; label: string }) => (
  <span role="group" aria-label={label} className="inline-flex gap-0.5 align-middle">
    {(parseIds(text) ?? []).map((c) => (
      <PlayingCard key={c} card={cardName(c)} size="sm" />
    ))}
  </span>
);

export function PloPractice() {
  const [params] = useSearchParams();
  const linked = spotFromParams(params);
  const [choice, setChoice] = useState(linked ? FROM_LINK : PLO_PRESETS[0]!.id);
  const spot: PloSpot = choice === FROM_LINK && linked ? linked : (PLO_PRESETS.find((p) => p.id === choice)?.spot ?? DEFAULT_SPOT);
  const [seat, setSeat] = useState<"random" | "0" | "1">("random");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RiverProgress | null>(null);
  const [result, setResult] = useState<RiverResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<RiverClient | null>(null);
  useEffect(() => () => client.current?.dispose(), []);

  const solve = async () => {
    setError(null);
    setResult(null);
    const request = requestOf(spot, { targetPct: PRACTICE_TARGET, seconds: PRACTICE_SECONDS });
    if (typeof request === "string") return setError(request);
    const c = (client.current ??= new RiverClient());
    setRunning(true);
    try {
      const out = await c.run(request, setProgress);
      if (out.result) setResult(out.result);
      else setError("Cancelled before there was anything to play.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const studyLink = `/study?${(() => {
    const q = spotToParams(spot);
    q.set("game", "plo4");
    return q.toString();
  })()}`;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Practice</h1>
        <GamePicker page="practice" current="plo4" />
      </div>
      <p className="text-sm text-muted">
        {PLO4.name}: hands played on a solve, {PLO4.solverScope}. The other seat plays the solve; each decision of yours is graded by the EV it gives up against the solve.
      </p>
      <NotForGame page="practice" name="PLO" missing={PLO4.pages.practice ?? []} />

      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="block min-w-0 space-y-1 text-sm">
          <span className="text-muted">Spot</span>
          <select
            aria-label="PLO spot"
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setResult(null);
            }}
            className={inputClass}
            disabled={running}
          >
            {linked && <option value={FROM_LINK}>From the link: {linked.board}</option>}
            {PLO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 space-y-1 text-sm">
          <span className="text-muted">You play</span>
          <select aria-label="Your seat" value={seat} onChange={(e) => setSeat(e.target.value as typeof seat)} className={inputClass}>
            <option value="random">Either seat</option>
            <option value="0">OOP</option>
            <option value="1">IP</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">
        OOP <span className="font-mono">{spot.oop}</span> against IP <span className="font-mono">{spot.ip}</span> on <span className="font-mono">{spot.board}</span>, pot {spot.pot}, {spot.stacks.join(" and ")} behind. Ranges given, not solved.{" "}
        <Link to={studyLink} className="underline">
          Open it in Study
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass} disabled={running} onClick={() => void solve()}>
          {result ? "Solve again" : "Solve this spot"}
        </button>
        {running && (
          <>
            <button type="button" className={buttonClass} onClick={() => client.current?.cancel()}>
              Cancel
            </button>
            <span role="status" className="text-sm text-muted">
              {progressWords(progress)}
            </span>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {result && <Table key={result.iterations} result={result} seat={seat} ask={(path) => client.current?.river(path) ?? Promise.resolve(null)} />}
    </div>
  );
}

function Table({ result, seat, ask }: { result: RiverResult; seat: "random" | "0" | "1"; ask: PlayContext["ask"] }) {
  const provenance = useMemo(() => resultProvenance(result), [result]);
  const ctx: PlayContext = { result, band: provenance.band, ask };
  const [play, setPlay] = useState<Play | null>(null);
  const [none, setNone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tally, setTally] = useState<PlayTally>(EMPTY_PLAY_TALLY);
  const deal = async () => {
    setBusy(true);
    const p = await startPlay(ctx, seat === "random" ? undefined : seat === "0" ? 0 : 1);
    setNone(!p);
    setPlay(p);
    if (p?.end) setTally((t) => tallyPlay(t, p));
    setBusy(false);
  };
  const choose = async (k: number) => {
    if (!play) return;
    setBusy(true);
    const p = await act(play, k, ctx);
    setPlay(p);
    if (p.end && !play.end) setTally((t) => tallyPlay(t, p));
    setBusy(false);
  };
  const node = play?.node && !play.end && play.node.player === play.hero ? play.node : null;
  const hero = play ? SEAT_NAMES[play.hero] : "";
  const street = play?.street;
  const pot = street && node ? street.pot + node.bets[0] + node.bets[1] : 0;
  const call = node ? Math.max(0, node.bets[1 - node.player]! - node.bets[node.player]!) : 0;
  return (
    <section aria-label="PLO hand" className="space-y-3">
      <ProvenanceBadge p={provenance} />
      <p className="text-xs text-muted">
        {stopWords(result)} Exploitability {result.exploitability.pct.toFixed(3)}% of the pot.
      </p>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void deal()}>
        {play ? "Next hand" : "Deal a hand"}
      </button>
      {none && <p>No hand can be dealt from these ranges.</p>}
      {play && street && (
        <div className="space-y-2 rounded border border-border p-3 text-sm">
          <p aria-label="Your spot" className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>You&apos;re {hero} with</span>
            <Cards text={handAt(play.cards[play.hero]).map(cardName).join("")} label="Your hand" />
            <span>on</span>
            <Cards text={play.end ? play.end.board : street.board} label="Board" />
          </p>
          {play.log.length > 0 && (
            <ol aria-label="This hand" className="space-y-0.5">
              {play.log.map((l, i) => (
                <li key={i} className={l.seat === play.hero ? "" : "text-muted"}>
                  {l.street[0]!.toUpperCase() + l.street.slice(1)}, {l.seat === play.hero ? "you" : SEAT_NAMES[l.seat]}: {l.label}
                  {l.seat === play.hero &&
                    (l.grade ? (
                      <>
                        {" "}
                        <VerdictTag v={l.grade.verdict} />
                        {l.grade.loss > 0 ? ` ${chips(l.grade.loss)}bb given up, ${l.grade.lossPct.toFixed(1)}% of the pot` : ""}
                        {l.grade.capped ? " (capped: the solve is short of converged)" : ""}
                      </>
                    ) : (
                      <span className="text-muted"> (ungraded: {l.why})</span>
                    ))}
                </li>
              ))}
            </ol>
          )}
          {node && (
            <>
              <p>
                {street.name[0]!.toUpperCase() + street.name.slice(1)}: pot {chips(pot)}
                {call > 0 ? `, ${chips(call)} to call` : ""}, {chips(street.stack - node.bets[node.player])} behind. Your move.
              </p>
              <div role="group" aria-label="Your action" className="flex flex-wrap gap-2">
                {node.actions.map((a, k) => (
                  <button key={a.token} type="button" className={buttonClass} disabled={busy} onClick={() => void choose(k)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {play.broken && <p role="alert">{play.broken}</p>}
          {play.end && (
            <p role="status" aria-label="How the hand ended">
              {play.end.how === "fold" ? `${play.end.winner === play.hero ? "They fold" : "You fold"}.` : `Showdown: you ${play.end.shown![play.hero]}, they ${play.end.shown![1 - play.hero]}.`}{" "}
              {play.end.winner === null ? "The pot is split" : play.end.winner === play.hero ? "You win the pot" : "They win the pot"} of {chips(play.end.pot)}bb; you {play.end.net >= 0 ? "+" : "−"}
              {chips(Math.abs(play.end.net))}bb from the start of the {result.street}.
            </p>
          )}
        </div>
      )}
      {tally.hands > 0 && (
        <p aria-label="Your tally" className="text-xs text-muted">
          {tally.hands} hand{tally.hands === 1 ? "" : "s"}, {tally.decisions} decision{tally.decisions === 1 ? "" : "s"} graded: {tally.ok} Best or Correct, {chips(tally.loss)}bb given up
          {tally.decisions ? ` (${(tally.lossPct / tally.decisions).toFixed(1)}% of the pot a decision)` : ""}, {tally.net >= 0 ? "+" : "−"}
          {chips(Math.abs(tally.net))}bb won. Not saved to History.
        </p>
      )}
    </section>
  );
}
