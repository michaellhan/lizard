// Study: the solution browser. Walk a hand node by node with no cards of your own; at each decision the engine
// answers for every hand of the player to act (Advisor.study): the 13x13 mix, EVs, equity, the range's totals.
// Preflop the charts answer at once; library flops answer at once; other flops (heads-up / 3-way), turns and
// rivers are solved live in the browser (or the local Python server), with progress and cancel.
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { cellLabel, cellValue, RangeMatrix } from "@/components/RangeMatrix";
import { ProvenanceBadge, ProvenanceDetail } from "@/components/ProvenanceBadge";
import { useFocusHold } from "@/components/useFocusHold";
import { actionFills, evIn, evUnitLabel, kindOf, pct, type EvUnit } from "@/components/actions";
import { useSolver } from "@/solver/useSolver";
import { describe } from "@/solver/provenance";
import { SolverError, type Provenance, type SolveResult } from "@/solver/types";
import type { AdvisorResponse, OpponentRange } from "@/solver/protocol";
import { useSettings } from "@/state/settings";
import { describeSetup, setupProblems } from "@/features/solve/setup";
import {
  back,
  cardsNeeded,
  deal,
  describeLine,
  forward,
  freshHand,
  fromSearch,
  lineOf,
  lineSteps,
  onLine,
  play,
  potOdds,
  randomCards,
  readCards,
  STREETS,
  streetOf,
  studyKey,
  studyKeyFrom,
  studyRequest,
  toSearch,
  samePf,
  withPf,
  withPfSizes,
  type StudyHand,
} from "./studyState";
import { encodePfSizes } from "./pfSizes";
import { BreakdownPanel } from "./BreakdownPanel";
import { BuildMode, type BuildSaved } from "./BuildMode";
import { StudySplit, useSplitWide } from "./StudySplit";
import { FoldTo } from "./FoldTo";
import { askNode, newRun, pfGame, runPf, type PfRun } from "./pfSolve";
import { PfNote, PfPanel, PfProgress, PfSizesForm, PreflopSource } from "./PreflopSolve";
import { EvGapPanel } from "@/features/compare/EvGapPanel";
import { OneSizePanel } from "@/features/compare/OneSizePanel";
import { offersOneSize } from "@/features/compare/oneSize";
import { ChipCompare } from "./ChipCompare";
import { offersAutoSize } from "./autoSize";
import { AutoSizePanel } from "./AutoSizePanel";
import { betMenuOf, CompareLinks } from "./CompareLinks";
import { offersLock } from "./locks";
import { LockPanel } from "./LockPanel";
import { ChangeCards } from "./ChangeCards";
import { NodeLockPanel } from "./NodeLockPanel";
import { ComboPanel } from "./ComboPanel";
import { studyText } from "@/features/practice/copyForAi";
import { CopyForAi } from "@/features/practice/HintReveal";
import { offersReport } from "./runouts";
import { RunoutPanel } from "./RunoutPanel";
import { SaveSpot } from "./SaveSpot";
import { SavedAnswerNote } from "@/features/saved/SavedAnswerNote";
import { useSavedAnswer } from "@/features/saved/useSavedAnswer";
import { bubbleTableOf } from "@/features/tournaments/icm";
import { TournamentPanel, type TournamentInfo } from "./TournamentPanel";
import { ModePicker } from "./ModePicker";
import { catsOf, equityBuckets, filterRes, filterWords, type FilteredResponse } from "./filters";
import { actionLine, VIEW_LABELS, viewsOf, type GridView } from "./views";
import { keepVs, pickOpp, VS } from "./sideBySideLink";
import { OpponentSide, oppTotals, RangeHeading } from "./SideBySide";

type Phase =
  | { kind: "loading"; partial?: SolveResult }
  | { kind: "done"; result: SolveResult }
  // (what a partial answer had shown when it was stopped or failed stays on screen, under its own partial label)
  | { kind: "error"; message: string; partial?: SolveResult; stopped?: boolean };

/** Study's table sizes and stack depths (the Advisor's preflop model covers 2-9 players, 10-250bb). */
export const PLAYERS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export const MIN_STACK = 10;
export const MAX_STACK = 250;

/** An answer in a sentence for a reader, told once as it arrives: who acts, where, the pot, and what produced it. */
export function answerWords(r: AdvisorResponse, p: Provenance): string {
  if (typeof r.error === "string") return r.error;
  if (r.study === "deal") return `The ${r.street} is next, to be dealt.`;
  if (r.study === "over") return "End of the hand.";
  if (r.study !== "node") return "No answer to show for this node.";
  const where = `${r.actor} to act on the ${r.street}${r.pot_bb !== undefined ? `, pot ${r.pot_bb}bb` : ""}.`;
  return `${where} ${p.partial ? "Partial answer, still refining." : `${describe(p)}.`}`;
}

/** The opponents' ranges: heads-up the one (opponent_grid), 3-way each of the two (opponents), as study.js oppsOf. */
export function oppsOf(res: AdvisorResponse | undefined): OpponentRange[] {
  if (!res) return [];
  if (res.opponents?.length) return res.opponents;
  return res.opponent && res.opponent_grid
    ? [{ seat: res.opponent, grid: res.opponent_grid, combos: res.opponent_combos, eq: res.opponent_eq }]
    : [];
}

export function StudyPage() {
  const [params, setParams] = useSearchParams();
  const hand = useMemo<StudyHand>(() => fromSearch(params.toString()) ?? freshHand(6, 100), [params]);
  // (a new node keeps the ranges side by side, where they were: `vs` is the view's, not the hand's)
  const setHand = useCallback((h: StudyHand) => setParams((q) => keepVs(toSearch(h), q.get(VS))), [setParams]);
  // both players' ranges side by side (sideBySideLink.ts): a view, so turned on, off or to another opponent in place
  const setVs = useCallback(
    (vs: string | null) =>
      setParams(
        (q) => {
          const next = new URLSearchParams(q);
          if (vs) next.set(VS, vs);
          else next.delete(VS);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  // the furthest node of the line being walked: Back keeps it, for Forward and the breadcrumb; off it, a new line
  const [trail, setTrail] = useState(hand);
  const tip = useMemo(() => (onLine(hand, trail) ? trail : hand), [hand, trail]);
  if (tip !== trail) setTrail(tip);
  // classic Study offers Fast and Accurate only (study.js); the Quick setting (for Practice) runs Study at Fast
  const picked = useSettings((s) => s.mode);
  const mode = picked === "quick" ? "fast" : picked;
  const getSolver = useSolver();
  // the answer is tagged with the request it answers; a new request shows "loading" until its own answer arrives
  const [answer, setAnswer] = useState<{ key: string; phase: Phase }>({ key: "", phase: { kind: "loading" } });
  // Try again: the same request, asked afresh
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  // (what the grid shows and the breakdown's state are Settings, so they last from visit to visit, as StudySplit's split does)
  const chosenView = useSettings((s) => s.studyView);
  const breakdownOpen = useSettings((s) => s.breakdownOpen);
  const saveSettings = useSettings((s) => s.set);
  // whose range the grid shows: 0 the player to act, i the i-th opponent
  const [who, setWho] = useState(0);
  // side by side, which grid the class picked is in: the player to act's, or the opponent's beside it
  const [pickedIn, setPickedIn] = useState<"actor" | "opponent">("actor");
  // a hand category ("m:<id>" / "d:<id>"), kept from node to node while the node has it
  const [filterKey, setFilterKey] = useState<string | null>(null);
  // one action picked in the legend: the others are drawn empty, and the EV view shades by its EV
  const [focus, setFocus] = useState<string | null>(null);
  // the range builder (kept on from node to node), and what's painted at each node visited
  const [building, setBuilding] = useState(false);
  const [paints] = useState(() => new Map<string, BuildSaved>());
  const evUnit = useSettings((s) => s.evUnit);
  const keys = useSettings((s) => s.studyKeys);
  const wide = useSplitWide();
  // the keyboard stays with the answer as one node's buttons go and the next one's arrive
  const answerBox = useFocusHold<HTMLDivElement>();
  const newHandBox = useFocusHold<HTMLDivElement>();
  const abortRef = useRef<AbortController | null>(null);
  // the preflop solve run from the page (pfSolve.ts): only on its Solve button, going on while the page shows a
  // preflop node of the same game under the Solver source, stopped (after its chunk) once it doesn't or on leaving
  const runRef = useRef<PfRun | null>(null);
  const [pfRun, setPfRun] = useState<PfRun | null>(null);
  const latest = useRef({ hand, key: "", mode });
  const game = pfGame(hand);
  const onPf = hand.pf === "solver" && streetOf(hand) === "preflop";

  const requestKey = `${toSearch(hand)}|${mode}`;
  const askKey = `${requestKey}|${attempt}`;
  // a saved spot opened with its answer (?saved=): that answer stands until Re-solve, another node or another mode
  const kept = useSavedAnswer(params.get("saved"), toSearch(hand), requestKey);
  useEffect(() => {
    latest.current = { hand, key: askKey, mode };
  });
  useEffect(() => {
    const r = runRef.current;
    if (r?.running && (!onPf || r.game !== game)) r.stop = true;
  }, [game, onPf]);
  useEffect(() => {
    const ref = runRef;
    return () => {
      if (ref.current) ref.current.stop = true;
    };
  }, []);
  // the node shown asked again from the solve as it is now (after each chunk)
  const refreshPf = useCallback(async () => {
    const { hand: h, key: k, mode: m } = latest.current;
    if (h.pf !== "solver" || streetOf(h) !== "preflop") return;
    try {
      const client = await getSolver();
      const result = await askNode((st) => client.solve({ state: st, mode: m }), studyRequest(h), client.solverVersion);
      if (latest.current.key === k) setAnswer({ key: k, phase: { kind: "done", result } });
    } catch {
      // (the node's own request says what failed)
    }
  }, [getSolver]);
  const startPf = () => {
    if (runRef.current?.running) return;
    if (kept.result) setHand(hand);
    const run = newRun(hand);
    runRef.current = run;
    setPfRun({ ...run });
    void (async () => {
      try {
        const client = await getSolver();
        await runPf(run, (st) => client.solve({ state: st, mode }), client.solverVersion, { onUpdate: (r) => setPfRun({ ...r }), refresh: refreshPf });
      } catch (e) {
        run.err = e instanceof Error ? e.message : String(e);
        run.running = false;
        setPfRun({ ...run });
      }
    })();
  };
  const stopPf = () => {
    const r = runRef.current;
    if (!r?.running) return;
    r.stop = true;
    setPfRun({ ...r });
  };
  const shownRun = onPf && pfRun?.game === game ? pfRun : null;
  const pfRunning = Boolean(shownRun?.running);
  // a setup the engine can't be asked (a link typed or edited by hand): said, and nothing asked
  const problems = useMemo(() => setupProblems(hand.players, hand.setup), [hand]);
  const phase: Phase = problems.length
    ? { kind: "error", message: `This setup can't be solved: ${problems.join("; ")}.` }
    : kept.result
      ? { kind: "done", result: kept.result }
      : answer.key === askKey && !kept.reading
        ? answer.phase
        : { kind: "loading" };
  useEffect(() => {
    if (problems.length || kept.result || kept.reading) return;
    const ac = new AbortController();
    abortRef.current = ac;
    let alive = true;
    const setPhase = (p: Phase) => setAnswer({ key: askKey, phase: p });
    let partial: SolveResult | undefined;
    void (async () => {
      try {
        const client = await getSolver();
        // (a preflop game this browser solved before, the worker no longer holding it: handed back first)
        const result = await askNode(
          (state) =>
            client.solve({
              state,
              mode,
              progressive: true,
              signal: ac.signal,
              onPartial: (p) => {
                partial = p;
                if (alive) setPhase({ kind: "loading", partial: p });
              },
            }),
          studyRequest(hand),
          client.solverVersion,
        );
        if (alive) setPhase({ kind: "done", result });
      } catch (e) {
        if (!alive) return;
        const stopped = e instanceof SolverError && e.kind === "cancelled";
        const message = stopped ? "Stopped." : e instanceof Error ? e.message : String(e);
        setPhase({ kind: "error", message, stopped, partial: partial && { ...partial, provenance: { ...partial.provenance, stopped: true } } });
      }
    })();
    return () => {
      alive = false;
      ac.abort();
    };
    // the request key covers hand and mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey, getSolver, kept.result, kept.reading]);

  const shown: SolveResult | undefined = phase.kind === "done" ? phase.result : phase.partial;
  // said once, in the one region that's always there
  const phaseWords = phase.kind === "error" ? `${phase.message}${phase.partial ? " What it had reached stays below, labelled partial." : ""}` : "";
  const said = problems.length ? "" : phase.kind === "error" ? phaseWords : shown ? answerWords(shown.data, shown.provenance) : "Finding the answer.";
  const raw: AdvisorResponse | undefined = shown?.data;
  const cats = useMemo(() => catsOf(raw), [raw]);
  const buckets = useMemo(() => equityBuckets(raw), [raw]);
  const res = useMemo(() => (raw ? filterRes(raw, filterKey) : undefined), [raw, filterKey]);
  const names = useMemo(() => res?.grid?.actions ?? [], [res]);
  const colors = useMemo(() => actionFills(names), [names]);
  const opps = useMemo(() => oppsOf(raw), [raw]);
  const vsAsked = params.get(VS);
  const vsAt = building && raw?.study === "node" && (raw.grid?.actions.length ?? 0) > 1 ? null : pickOpp(opps, vsAsked);
  // the opponent beside the actor's range, when side by side: then the grid on the left is always the actor's
  const vsOpp = vsAt === null ? null : opps[vsAt]!;
  const opp = !vsOpp && who > 0 ? (opps[who - 1] ?? null) : null;
  // whose class the combo panel shows: side by side, the grid it was picked in
  const panelOpp = vsOpp ? (pickedIn === "opponent" ? vsOpp : null) : opp;
  const panelGrid = panelOpp ? panelOpp.grid : res?.grid;
  // (the panels that work on the actor's hands get none picked in the opponent's grid)
  const myCls = vsOpp && pickedIn === "opponent" ? null : selected;
  const grid = opp ? opp.grid : res?.grid;
  const views = res ? viewsOf(res) : (["mix"] as GridView[]);
  const view = views.includes(chosenView) ? chosenView : "mix";
  const focusIdx = focus !== null && names.includes(focus) ? names.indexOf(focus) : null;
  const hidden = useMemo(
    () => (focusIdx === null ? undefined : new Set(names.map((_, i) => i).filter((i) => i !== focusIdx))),
    [focusIdx, names],
  );
  const evRange = useMemo<[number, number]>(() => {
    const v = view === "eqr" ? "eqr" : "ev";
    const vals = Object.values(res?.grid?.cells ?? {})
      .map((c) => cellValue(c, v, focusIdx, res?.pot_bb))
      .filter((x): x is number => typeof x === "number");
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }, [res, view, focusIdx]);
  const filtered = res?.filter;
  // the actor's range in words: its combos (over a category, of how many) and its equity
  const myTotals = `${filtered ? `${filtered.label}: ` : ""}${res?.range_combos?.toFixed(1)}${filtered?.of != null ? ` of ${filtered.of.toFixed(1)}` : ""} combos${
    res?.range_eq != null ? ` · equity ${pct(res.range_eq)}` : ""
  }`;
  const pickMine = useCallback((c: string) => {
    setSelected(c);
    setPickedIn("actor");
  }, []);
  // the builder paints the whole range (no filter) of a complete answer: a partial one would show its mix early
  const buildable = raw?.study === "node" && (raw.grid?.actions.length ?? 0) > 1;
  const buildRes = phase.kind === "done" && buildable ? (raw as AdvisorResponse & { grid: NonNullable<AdvisorResponse["grid"]> }) : null;
  const toggleBuild = () => {
    setBuilding((b) => !b);
    setWho(0);
    setSelected(null);
  };
  const buildButton = buildable && (
    <button
      type="button"
      aria-pressed={building}
      onClick={toggleBuild}
      title="Paint the strategy yourself, then score it against this answer"
      className={`rounded border px-2 py-0.5 ${building ? "border-accent bg-surface-3" : "border-border text-muted hover:bg-surface-2"}`}
    >
      {building ? "✎ Building" : "✎ Build"}
    </button>
  );

  const prevNode = back(hand);
  const nextNode = forward(hand, tip);
  const steps = lineSteps(hand, tip);
  // (a button that disables holds the keyboard where no key works, so the end of the line hands it to the other one)
  const backButton = useRef<HTMLButtonElement>(null);
  const forwardButton = useRef<HTMLButtonElement>(null);
  const canBack = Boolean(prevNode);
  const canForward = Boolean(nextNode);
  useEffect(() => {
    const at = document.activeElement;
    if (!canBack && at === backButton.current) forwardButton.current?.focus();
    else if (!canForward && at === forwardButton.current) backButton.current?.focus();
  }, [canBack, canForward]);

  // keys: left and right walk the line, 1-9 play that action (while building, 1-9 pick its brushes); not while typing, and
  // none of them with the keys turned off in Settings
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!keys || e.defaultPrevented) return;
    const k = studyKey(e);
    if (!k || !studyKeyFrom(e.target as Element | null, e.key)) return;
    if (k.kind === "build") {
      if (buildable) toggleBuild();
      return;
    }
    const to = k.kind === "back" ? prevNode : k.kind === "forward" ? nextNode : null;
    const act = k.kind === "play" && !building && res?.study === "node" ? res.actions?.[k.index] : undefined;
    if (act && res) setHand(play(hand, res, act));
    else if (to) setHand(to);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const split = !(building && buildable) && res?.study === "node" && grid;
  const nodeView = res && <NodeView hand={hand} res={res} shown={shown!} setHand={setHand} evUnit={evUnit} building={building} whole={phase.kind === "done" ? raw : undefined} cls={myCls} keys={keys} />;
  // the plan's Study layout in two panes: the grid left, and to its right the actions, then the combos and the breakdown.
  // Stacked, the actions stay above the grid; and in Build, whose split is its own, above that
  const actionsInPane = wide && Boolean(split);
  const breakdown = !(building && buildable) && !opp && res?.study === "node" && phase.kind === "done" && res.street !== "preflop" && (
    <BreakdownPanel key={`breakdown|${requestKey}`} hand={hand} mode={mode} open={breakdownOpen} onOpen={(o) => saveSettings({ breakdownOpen: o })} evUnit={evUnit} getSolver={getSolver} onFilter={setFilterKey} />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Study</h1>
          <p className="text-sm text-muted">Click an action to play it. The badge on each answer says where it came from: a solve, the library or the preflop charts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {streetOf(hand) === "preflop" && <PreflopSource value={hand.pf ?? "charts"} onChange={(v) => setHand(withPf(hand, v))} />}
          {streetOf(hand) === "preflop" && hand.pf === "solver" && (
            <PfSizesForm key={encodePfSizes(hand.pfSizes ?? {})} value={hand.pfSizes} onApply={(s) => setHand(withPfSizes(hand, s))} />
          )}
          <ModePicker modes={["fast", "accurate"]} />
          <div {...newHandBox}>
            <NewHandForm key={`${hand.players}/${hand.stack}`} players={hand.players} stack={hand.stack} onStart={(p, st) => setHand(samePf(hand, freshHand(p, st)))} />
          </div>
        </div>
      </div>

      <nav aria-label="Line" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface p-2 text-sm">
        <button
          type="button"
          aria-current={prevNode ? undefined : "step"}
          title="The start of the hand"
          onClick={() => setHand(lineOf(tip)[0] ?? hand)}
          className={`rounded bg-surface-3 px-2 py-0.5 hover:text-text ${prevNode ? "text-muted" : "ring-1 ring-accent"}`}
        >
          {hand.players === 2 ? "HU" : `${hand.players}-max`} {hand.stack}bb
        </button>
        {steps.map((s, i) => (
          <button
            key={i}
            type="button"
            aria-current={s.at === "here" ? "step" : undefined}
            title={s.detail}
            onClick={() => setHand(s.hand)}
            className={`rounded px-2 py-0.5 font-mono ${
              s.at === "ahead" ? "border border-dashed border-border text-muted hover:text-text" : `bg-surface-2 hover:bg-surface-3 ${s.at === "here" ? "ring-1 ring-accent" : ""}`
            }`}
          >
            {s.label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          ref={backButton}
          type="button"
          aria-keyshortcuts={keys ? "ArrowLeft" : undefined}
          onClick={() => prevNode && setHand(prevNode)}
          disabled={!prevNode}
          className="rounded px-2 py-0.5 text-muted hover:bg-surface-2 disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          ref={forwardButton}
          type="button"
          aria-keyshortcuts={keys ? "ArrowRight" : undefined}
          onClick={() => nextNode && setHand(nextNode)}
          disabled={!nextNode}
          className="rounded px-2 py-0.5 text-muted hover:bg-surface-2 disabled:opacity-40"
        >
          Forward →
        </button>
        <button type="button" onClick={() => setHand(samePf(hand, { ...freshHand(hand.players, hand.stack), setup: hand.setup }))} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
          Reset
        </button>
        <ChangeCards key={`cards|${requestKey}`} hand={hand} onChange={setHand} />
        <SaveSpot key={requestKey} hand={hand} provenance={phase.kind === "done" && !kept.result ? phase.result.provenance : undefined} answer={phase.kind === "done" && !kept.result ? phase.result : undefined} />
      </nav>
      <SavedAnswerNote
        hold={kept}
        onResolve={() => {
          // (the note and its button go: the keyboard stays on the page)
          document.getElementById("main")?.focus({ preventScroll: true });
          setHand(hand);
        }}
      />
      <p role="group" aria-label="Setup" className="-mt-2 text-xs text-muted">
        {hand.setup ? (
          <>
            Your setup: {describeSetup(hand.setup).join(" · ") || "none"}.{" "}
            <Link to={`/${hand.setup.tournament ? "tournaments" : "solve"}?${toSearch(hand)}`} className="underline hover:text-text">
              Edit setup
            </Link>
          </>
        ) : (
          <>
            Standard setup (a cash game at the engine's sizes, no rake or ante, the charts' ranges).{" "}
            <Link to={`/solve?${toSearch(hand)}`} className="underline hover:text-text">
              Set up your own
            </Link>{" "}
            or{" "}
            <Link to={`/tournaments?${toSearch(hand)}`} className="underline hover:text-text">
              a tournament
            </Link>
          </>
        )}
      </p>
      {/* (always here, so a reader is told each answer as it lands, and that it stopped or failed; a setup that can't be asked is an alert) */}
      <p role="status" className="sr-only">
        {said}
      </p>

      {/* (to the end of the page: the actions it hands the keyboard to can be in the panel) */}
      <div {...answerBox} role="group" aria-label="Answer" className="space-y-4">
        {!problems.length && <FoldTo hand={hand} res={raw} setHand={setHand} />}
        {phase.kind === "loading" && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span>{phase.partial ? "Refining…" : "Finding the answer…"}</span>
            <span className="text-muted">The first answer starts the engine (Python in your browser, cached after the first visit).</span>
            <span className="flex-1" />
            <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-surface-2" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          </div>
        )}
        {phase.kind === "error" && (
          <div role={problems.length ? "alert" : undefined} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ${phase.stopped ? "border-border bg-surface" : "border-danger/40 bg-danger/10 text-danger"}`}>
            <span>{phaseWords}</span>
            <span className="flex-1" />
            {!problems.length && (
              <button type="button" data-focus-first className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            )}
          </div>
        )}

        {shownRun && (shownRun.running || shownRun.err) && <PfProgress run={shownRun} onStop={stopPf} />}
        {res && (res.study === "pf_unsolved" || res.study === "pf_none") ? (
          <PfPanel res={res} running={pfRunning} onSolve={startPf} onCharts={() => setHand(withPf(hand, "charts"))} />
        ) : (
          !actionsInPane && nodeView
        )}
        {res?.study === "node" && res.street === "preflop" && <PfNote res={res} running={pfRunning} onContinue={startPf} />}
        {hand.setup?.tournament && phase.kind === "done" && raw?.tournament ? (
          <ChipCompare key={`chips|${requestKey}`} hand={hand} mode={mode} getSolver={getSolver} prize={phase.result} evUnit={evUnit} />
        ) : null}
        {phase.kind === "done" && raw?.study === "node" && <CompareLinks key={`compare|${requestKey}`} hand={hand} min={MIN_STACK} max={MAX_STACK} bets={betMenuOf(hand, raw)} />}

        {building && buildable && (
          <div className="flex items-center gap-2 text-sm">
            {buildButton}
            <span className="text-muted">Range builder: paint {raw?.actor}'s strategy, then check it against this answer.</span>
          </div>
        )}
        {building && buildable && !buildRes && <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">The builder opens once the answer is complete.</p>}
        {building && buildRes && (
          <BuildMode
            key={`build|${requestKey}`}
            res={buildRes}
            provenance={shown!.provenance}
            colors={actionFills(buildRes.grid.actions)}
            lineKey={toSearch(hand)}
            lineLabel={describeLine(hand).join(" ")}
            stored={paints.get(requestKey)}
            onStore={(v) => void paints.set(requestKey, v)}
            onExit={() => setBuilding(false)}
          />
        )}
        {split && (
          <StudySplit>
            <section aria-label="Range" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {vsOpp ? null : opps.length > 0 ? (
                  <div role="group" aria-label="Whose range" className="flex flex-wrap gap-1">
                    {[res.actor, ...opps.map((o) => o.seat)].map((seat, i) => (
                      <button
                        key={`${seat}-${i}`}
                        type="button"
                        aria-pressed={who === i}
                        onClick={() => setWho(i)}
                        className={`rounded border border-border px-2 py-0.5 ${who === i ? "bg-surface-3 font-semibold" : "text-muted hover:bg-surface-2"}`}
                      >
                        {seat}
                      </button>
                    ))}
                  </div>
                ) : (
                  <strong>{res.actor}</strong>
                )}
                {!vsOpp && <span className="text-muted">{opp ? oppTotals(opp) : myTotals}</span>}
                <span className="flex-1" />
                {!opp && cats.length + buckets.length > 0 && (
                  <select
                    aria-label="Show only the hands of one category"
                    title="Show only the hands of one category: the grid, the range's frequencies and the combos over them"
                    className="rounded border border-border bg-surface-2 px-2 py-0.5"
                    value={filtered?.key ?? ""}
                    onChange={(e) => setFilterKey(e.target.value || null)}
                  >
                    <option value="">All hands</option>
                    {(["m", "d"] as const).map((part) => {
                      const cs = cats.filter((c) => c.part === part);
                      return cs.length ? (
                        <optgroup key={part} label={part === "m" ? "Made hands" : "Draws"}>
                          {cs.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label} · {pct(c.combos / (raw?.range_combos || 1))}
                            </option>
                          ))}
                        </optgroup>
                      ) : null;
                    })}
                    {buckets.length > 0 && (
                      <optgroup label="Equity against their whole range">
                        {buckets.map((b) => (
                          <option key={b.key} value={b.key}>
                            {b.label} · {pct(b.combos / (raw?.range_combos || 1))}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
                {!opp &&
                  views.length > 1 &&
                  views.map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => saveSettings({ studyView: v })}
                      title={v === "eqr" ? "Equity realization: EV / (equity × pot)" : undefined}
                      className={`rounded px-2 py-0.5 ${view === v ? "bg-surface-3" : "text-muted hover:bg-surface-2"}`}
                    >
                      {VIEW_LABELS[v]}
                    </button>
                  ))}
                {opps.length > 0 && (
                  <button
                    type="button"
                    aria-pressed={Boolean(vsOpp)}
                    onClick={() => {
                      setVs(vsOpp ? null : "1");
                      setPickedIn("actor");
                    }}
                    title={vsOpp ? "Back to one range at a time" : `${res.actor}'s range and an opponent's, side by side`}
                    className={`rounded border px-2 py-0.5 ${vsOpp ? "border-accent bg-surface-3" : "border-border text-muted hover:bg-surface-2"}`}
                  >
                    Side by side
                    <span className="sr-only">
                      : {res.actor}'s range and {opps.length === 1 ? `${opps[0]!.seat}'s` : "an opponent's"}
                    </span>
                  </button>
                )}
                {buildButton}
              </div>
              {vsAsked && !opps.length && (
                <p className="text-xs text-muted">
                  Side by side: this answer has no opponent's range to put beside it (Study's preflop answers hold the player to act's range alone).{" "}
                  <button type="button" onClick={() => setVs(null)} className="underline hover:text-text">
                    Turn off
                  </button>
                </p>
              )}
              {!opp && (view === "mix" || view === "ev") && names.length > 1 && (
                <div role="group" aria-label="Show one action" className="flex flex-wrap items-center gap-1 text-xs">
                  {names.map((nm, i) => (
                    <button
                      key={nm}
                      type="button"
                      aria-pressed={focusIdx === i}
                      onClick={() => setFocus(focusIdx === i ? null : nm)}
                      title={focusIdx === i ? "Show every action" : `Show only ${nm}${view === "ev" ? " and shade by its EV" : ""}`}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
                        focusIdx === i ? "border-accent" : focusIdx === null ? "border-border" : "border-border opacity-50"
                      }`}
                    >
                      <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
                      {nm}
                    </button>
                  ))}
                  {focusIdx !== null && (
                    <button type="button" onClick={() => setFocus(null)} className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2">
                      All actions
                    </button>
                  )}
                </div>
              )}
              {vsOpp && <RangeHeading seat={res.actor ?? ""} role="to act" totals={myTotals} provenance={shown!.provenance} />}
              <RangeMatrix
                cells={grid.cells}
                actions={opp ? [] : names}
                colors={colors}
                selected={vsOpp && pickedIn === "opponent" ? null : selected}
                onSelect={pickMine}
                view={opp ? "weight" : view}
                evRange={evRange}
                evAction={view === "ev" ? focusIdx : null}
                potBb={res.pot_bb}
                hidden={view === "mix" ? hidden : undefined}
                caption={`${opp ? opp.seat : res.actor} range${!opp && filtered ? ` (${filtered.label})` : ""}`}
              />
            </section>
            <div className="space-y-4">
              {/* (side by side, the opponent's range is at the top of the panel, level with the actor's beside it; stacked, under it) */}
              {vsOpp && (
                <OpponentSide
                  actor={res.actor ?? ""}
                  opps={opps}
                  index={vsAt!}
                  onPick={(seat) => setVs(seat)}
                  provenance={shown!.provenance}
                  selected={pickedIn === "opponent" ? selected : null}
                  onSelect={(c) => {
                    setSelected(c);
                    setPickedIn("opponent");
                  }}
                />
              )}
              {actionsInPane && nodeView}
              <aside className="space-y-3">
                {/* (what the panel now shows; not while a partial answer's numbers are still moving) */}
                <p role="status" className="sr-only">
                  {selected && panelGrid?.cells[selected] && phase.kind !== "loading"
                    ? `${vsOpp ? `${panelOpp ? panelOpp.seat : res.actor}'s range: ` : ""}${cellLabel(selected, panelGrid.cells[selected], panelOpp ? [] : names)}. ${describe(shown!.provenance)}.`
                    : ""}
                </p>
                {vsOpp && selected && panelGrid?.cells[selected] && <p className="text-xs font-medium text-muted">{panelOpp ? panelOpp.seat : res.actor}'s range</p>}
                {selected && panelGrid?.cells[selected] ? (
                  <ComboPanel cls={selected} res={res} colors={colors} opponent={panelOpp ?? false} evUnit={evUnit} />
                ) : (
                  <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
                    Select a hand class to see its combos, mix, EV and equity.
                  </p>
                )}
              </aside>
              {breakdown}
            </div>
          </StudySplit>
        )}
        {!split && breakdown}
        {!(building && buildable) && !opp && res?.study === "node" && phase.kind === "done" && (
          <div className="flex flex-wrap items-start gap-2">
            <EvGapPanel res={res} provenance={phase.result.provenance} evUnit={evUnit} />
            {raw && offersOneSize(raw) && <OneSizePanel key={`one-size|${requestKey}`} hand={hand} res={raw} getSolver={getSolver} />}
            {raw && offersLock(raw) && <LockPanel key={`lock|${requestKey}`} hand={hand} res={raw} cls={myCls} mode={mode} getSolver={getSolver} />}
            {raw && <NodeLockPanel key={`node-lock|${requestKey}`} hand={hand} res={raw} cls={myCls} mode={mode} getSolver={getSolver} />}
            {raw && offersAutoSize(raw) && <AutoSizePanel key={`auto-size|${requestKey}`} hand={hand} res={raw} cls={myCls} mode={mode} getSolver={getSolver} />}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeView({
  hand,
  res,
  shown,
  setHand,
  evUnit,
  building = false,
  whole,
  cls = null,
  keys,
}: {
  hand: StudyHand;
  res: FilteredResponse;
  shown: SolveResult;
  setHand: (h: StudyHand) => void;
  evUnit: EvUnit;
  /** the range builder is open: the actions without their frequencies and EVs (they'd give the answer away) */
  building?: boolean;
  /** the complete answer, unfiltered, for Copy for AI: none while it's still coming in */
  whole?: AdvisorResponse;
  /** the hand class picked in the grid */
  cls?: string | null;
  /** the page's keys are on (Settings) */
  keys: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const errId = useId();
  const names = res.grid?.actions ?? [];
  const colors = actionFills(names);
  // (every pair's bubble factor: the table's model from the setup, which the line doesn't change)
  const tour = res.tournament && typeof res.tournament === "object";
  const pairs = useMemo(() => (tour ? bubbleTableOf(hand.players, hand.stack, hand.setup) : null), [tour, hand.players, hand.stack, hand.setup]);

  if (res.study === "deal") {
    const n = cardsNeeded(res.street);
    const submit = (cards: string) => {
      setErr(null);
      setTyped("");
      setHand(deal(hand, cards));
    };
    const form = (
      <form
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const r = readCards(hand, typed, n);
          if ("error" in r) setErr(r.error);
          else submit(r.cards);
        }}
      >
        <label className="text-sm">
          Deal the {res.street} ({n} card{n > 1 ? "s" : ""}):{" "}
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={n === 1 ? "5s" : "Kd7c2h"}
            className="ml-1 w-28 rounded border border-border bg-surface-2 px-2 py-1 font-mono"
            aria-invalid={Boolean(err)}
            aria-describedby={err ? errId : undefined}
            data-focus-first
          />
        </label>
        <button type="submit" className="rounded bg-accent px-3 py-1 text-sm font-medium text-bg">
          Deal
        </button>
        <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={() => submit(randomCards(hand, n))}>
          Random
        </button>
        {err && (
          <span id={errId} role="alert" className="text-sm text-danger">
            {err}
          </span>
        )}
      </form>
    );
    // (the turn or river report: once the flop's or turn's betting closed with chips still to bet, heads-up or 3-way)
    const report = (res.street === "turn" || res.street === "river") && !res.allin && offersReport(hand);
    return report ? (
      <div className="space-y-3">
        {form}
        <RunoutPanel key={toSearch(hand)} hand={hand} street={res.street as "turn" | "river"} setHand={setHand} />
      </div>
    ) : (
      form
    );
  }
  if (res.study === "over") {
    return <p className="rounded-lg border border-border bg-surface p-3 text-sm">The hand is over. Step back to study another branch.</p>;
  }
  if (res.study !== "node") {
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
        {typeof res.error === "string" ? res.error : "There's no study answer for this node. Step back to study another branch."}
      </div>
    );
  }
  const odds = potOdds(hand, res);
  return (
    <section aria-label="Actions" className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {/* (where the keyboard lands on a new node: the first Tab from here is the first action, and a stray Enter plays nothing) */}
        <h2 tabIndex={-1} data-focus-first className="flex flex-wrap items-center gap-2">
          <strong className="text-base">{res.actor}</strong>
          <span className="text-muted">
            to act on the {res.street}
            {res.position ? ` (${res.position})` : ""}
            {res.pot_bb !== undefined ? ` · pot ${res.pot_bb}bb` : ""}
            {res.to_call_bb ? ` · to call ${res.to_call_bb}bb` : ""}
            {odds !== null && (
              <span title="What a call costs as a share of the pot it makes. Plain arithmetic in chips, before rake, not a solve."> · pot odds {pctOdds(odds)}</span>
            )}
          </span>
        </h2>
        <span className="flex-1" />
        {/* (quiet, as a Tab from the heading above is the first action; its detail is below the actions) */}
        <ProvenanceBadge p={shown.provenance} quiet />
      </div>
      {res.filter && !building && <p className="text-xs text-muted">{filterWords(res.filter)}</p>}
      <div className="flex flex-wrap gap-2">
        {(res.actions ?? []).map((a, i) => (
          <button
            key={a.action}
            type="button"
            aria-keyshortcuts={keys && i < 9 ? String(i + 1) : undefined}
            onClick={() => setHand(play(hand, res, a))}
            className="group min-w-28 rounded-md border border-border bg-surface-2 px-3 py-2 text-left hover:border-accent"
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: colors[names.indexOf(a.action)] ?? colors[i] }} />
              <span className="font-medium">{a.action}</span>
              {keys && !building && i < 9 && (
                <kbd aria-hidden className="ml-auto hidden font-mono text-[10px] text-muted md:inline">
                  {i + 1}
                </kbd>
              )}
            </div>
            {!building && (
              <div className="mt-1 font-mono text-xs text-muted">
                {actionLine(a, (x) => `${evIn(x, evUnit, res.pot_bb)}${evUnit === "pot" ? evUnitLabel(evUnit, res.pot_bb) : ""}`)}
              </div>
            )}
          </button>
        ))}
      </div>
      {/* (under the actions, so the first button here is an action; not in a tournament, whose EVs aren't in bb) */}
      {whole && !building && !whole.tournament && !!whole.actions?.length && <CopyForAi key={`${shown.provenance.source}|${cls}`} text={() => studyText(hand, whole, shown.provenance, cls)} />}
      {res.tournament && typeof res.tournament === "object" ? (
        <TournamentPanel
          t={res.tournament as TournamentInfo}
          actor={res.actor}
          out={STREETS.flatMap((st) => hand[st]).filter((a) => kindOf(a.action) === "fold").map((a) => a.pos)}
          pairs={pairs}
        />
      ) : null}
      {(res.notes ?? []).length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted">
          {res.notes!.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <ProvenanceDetail ps={[shown.provenance]} />
    </section>
  );
}


const pctOdds = (x: number) => `${(100 * x).toFixed(1)}%`;

function NewHandForm({ players, stack, onStart }: { players: number; stack: number; onStart: (players: number, stack: number) => void }) {
  const [p, setP] = useState(players);
  const [st, setSt] = useState(String(stack));
  const n = Number(st);
  const ok = Number.isFinite(n) && n >= MIN_STACK && n <= MAX_STACK;
  const limit = useId();
  return (
    <form
      aria-label="New hand"
      className="flex items-center gap-1.5 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onStart(p, Math.round(n * 10) / 10);
      }}
    >
      <select aria-label="Players" className="rounded-md border border-border bg-surface-2 px-2 py-1.5" value={p} onChange={(e) => setP(Number(e.target.value))}>
        {PLAYERS.map((k) => (
          <option key={k} value={k}>
            {k === 2 ? "Heads-up" : `${k}-max`}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1">
        <input
          aria-label="Stack in big blinds"
          type="number"
          inputMode="decimal"
          min={MIN_STACK}
          max={MAX_STACK}
          step="any"
          value={st}
          onChange={(e) => setSt(e.target.value)}
          aria-invalid={!ok}
          aria-describedby={limit}
          title={`Effective stack, ${MIN_STACK}–${MAX_STACK}bb`}
          className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono"
        />
        <span id={limit} className={ok ? "text-muted" : "text-danger"}>
          bb ({MIN_STACK} to {MAX_STACK})
        </span>
      </label>
      <button type="submit" data-focus-first disabled={!ok} className="rounded-md border border-border px-2 py-1.5 hover:bg-surface-2 disabled:opacity-40">
        New hand
      </button>
    </form>
  );
}
