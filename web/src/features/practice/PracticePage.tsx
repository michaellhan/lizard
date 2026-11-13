// Practice, in two tabs: full hands (here) and drills (DrillsPanel.tsx, one flop decision from the library).
// In full hands each opponent plays its actual hand: from the charts preflop, then from the solver's mix (Advisor.play), or
// by betting rules on a flop or turn with five or more still in. Your options are the solver's actions at your spot, and
// each decision is graded against its answer once you've acted (src/grading/grade.ts: by EV given up where the answer has
// EVs, by frequency on the preflop charts), with the answer's provenance beside it. The session's score is kept in
// IndexedDB (sessions).
// A Room runs the hands (room.ts: the requests, the pace, the session) and FullHands draws its snapshot: one table here
// (OneTable), two to four in MultiTables.tsx, whichever the Room has, as a session above one table comes back on a reload.
// What a hand needs next is flow.ts's, the session's totals session.ts's; the page's parts are in PracticeParts.tsx and
// SetupForm.tsx.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router";
import { bringIntoView } from "@/components/scroll";
import { rowKeys } from "@/components/rowKeys";
import { PlayingCard } from "@/components/PlayingCard";
import { getScenario, scenarioWords, type ScenarioSetup } from "@/data/scenarios";
import { summary } from "@/grading/grade";
import { seatLabel, seatsOf } from "@/poker/seats";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { describeSetup } from "@/features/solve/setup";
import { DrillsPanel } from "./DrillsPanel";
import { MultiTables, TablesBar } from "./MultiTables";
import { handHint, HINT_SOURCE } from "./hint";
import { HintReveal, Kbd, REVEAL_NOTE, RevealedMix } from "./HintReveal";
import { AheadLine, AskAhead, Carried, DecisionView, FallbackMoves, fmt, HandLine, KeepHand, optionLabel, PlayedOut, RangeView, ReviewMistakes, RunText, ScoreStrip, SeatView, useHandKeys } from "./PracticeParts";
import { gradedOn, optionsAt } from "./pfGrade";
import { isNextKey, optionFromKey, shownOrder } from "./keys";
import { KeysHelp } from "./KeysHelp";
import { boardShown, gameLabel, mixOf, modelled, phaseOf, playsOn, potLabel, runKind, seeking, simOf } from "./practice";
import { keptNote, PACE, Room, type RoomSnapshot } from "./room";
import { FIRST_OPTS, keyOf } from "./session";
import { readSetupLink, SETUP_PARAMS, setupLinkKey } from "./setupLink";
import { SetupForm } from "./SetupForm";
import { assumedWords, readWords } from "./exploit";
import { answering } from "./TableTile";

export { optionLabel };

/** What the other seats play by: never a solve preflop (but a stored tournament preset's, practice.ts `pfOptions`), nor on a
 * multiway flop or turn. */
const OPPONENTS = "Opponents: charts preflop, then the solver\u2019s mix (rules with 5+ in).";
const OPPONENTS_STORED = "Opponents: the stored preflop solve\u2019s mix preflop (the charts off its tree), then the solver\u2019s mix (rules with 5+ in).";
const opponentsOf = (o: { pfSolve?: boolean; tournament?: { model: string } }) => (o.pfSolve && o.tournament?.model === "icm" ? OPPONENTS_STORED : OPPONENTS);

type Tab = "hands" | "drills";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "hands", label: "Full hands" },
  { id: "drills", label: "Drills" },
];

/** `pace`: ms an opponent's move and a new card take at least, so the hand can be followed (0 in tests). `pause`, `guard`:
 * the Room's, above one table (unset: its own). */
export function PracticePage({ pace = PACE, pause, guard }: { pace?: number; pause?: number; guard?: number } = {}) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "drills" ? "drills" : "hands";
  // a hand under way is kept while you drill (its table is mounted once opened, and hidden)
  const [handsOpened, setHandsOpened] = useState(tab === "hands");
  const open = (t: Tab) => {
    if (t === "hands") setHandsOpened(true);
    setParams(t === "hands" ? {} : { tab: "drills" });
  };
  const [help, setHelp] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  // the page's keys (keys.ts): D the other tab, ? the key list; Esc leaves a field, so the table's keys work again, or
  // closes the list
  useHandKeys(true, (e) => {
    if (e.key === "?") setHelp((h) => !h);
    else if (e.key.toLowerCase() === "d") {
      const t: Tab = tab === "hands" ? "drills" : "hands";
      open(t);
      tabRefs.current[t]?.focus({ preventScroll: true });
    } else if (e.key === "Escape" && help) setHelp(false);
  });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "Escape" && el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.blur();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Practice</h1>
        <div role="tablist" aria-label="Practice" onKeyDown={rowKeys("tab", (i) => open(TABS[i]!.id))} className="flex gap-1 rounded-md border border-border p-0.5 text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`practice-tab-${t.id}`}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              aria-controls={`practice-panel-${t.id}`}
              onClick={() => open(t.id)}
              className={`rounded px-2.5 py-1 ${tab === t.id ? "bg-surface-3 font-medium" : "text-muted hover:bg-surface-2"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" aria-expanded={help} onClick={() => setHelp(!help)} className="ml-auto hidden rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-2 sm:inline-block">
          Keyboard<Kbd>?</Kbd>
        </button>
      </div>
      {help && <KeysHelp onClose={() => setHelp(false)} />}
      {(handsOpened || tab === "hands") && (
        <div role="tabpanel" id="practice-panel-hands" aria-labelledby="practice-tab-hands" hidden={tab !== "hands"}>
          <FullHands pace={pace} pause={pause} guard={guard} active={tab === "hands"} />
        </div>
      )}
      {tab === "drills" && (
        <div role="tabpanel" id="practice-panel-drills" aria-labelledby="practice-tab-drills">
          <DrillsPanel />
        </div>
      )}
    </div>
  );
}

/** `active`: its tab is the one shown (its keys work only then). */
function FullHands({ pace, pause, guard, active }: { pace: number; pause?: number; guard?: number; active: boolean }) {
  const getSolver = useSolver();
  const [room] = useState(() => new Room({ pace, pause, guard, first: FIRST_OPTS }));
  const [params, setParams] = useSearchParams();
  const scenario = params.get("scenario");
  const linked = setupLinkKey(params);
  const [opened, setOpened] = useState<{ ok: boolean; text: string } | null>(null);
  // a link's setup that came with a hand under way, and what it's called, until you've said what to do with it
  const [asking, setAsking] = useState<{ setup: ScenarioSetup; name: string } | null>(null);
  // (as the page commits, before the Room starts: settings load after the first render, and each launch reads the latest)
  useLayoutEffect(() => {
    room.setSolver(getSolver);
    room.setActive(active);
  }, [room, getSolver, active]);
  useEffect(() => {
    room.start();
    return () => room.stop();
  }, [room]);
  const snap = useSyncExternalStore(room.subscribe, room.snapshot);
  const { session, tables } = snap;
  const many = tables.length > 1;

  // A saved scenario's link, or a setup's (setupLink.ts, the Plan page's): the setup starts at one table, as above one Spots
  // and Seat deal in its place, and the link goes from the address, so a reload doesn't start it again. A link can come from
  // anywhere and a session you're in the middle of is yours, so either waits for the kept session to be read, and with a
  // hand under way it asks first.
  const waiting = (linked !== null || !!scenario) && snap.holding;
  useEffect(() => {
    if ((!scenario && linked === null) || waiting) return;
    let alive = true;
    const opening = async () => {
      const kept = scenario ? await getScenario(scenario).catch(() => undefined) : undefined;
      if (!alive) return;
      const s = scenario ? kept : readSetupLink(new URLSearchParams(linked!));
      if (s && room.snapshot().underWay) {
        setAsking({ setup: s, name: kept?.name ?? scenarioWords(s) });
      } else {
        if (s) {
          room.setTables(1);
          room.startSession(s.players, s.stack, s.opts);
        }
        setOpened(s ? { ok: true, text: `Started ${kept?.name ?? scenarioWords(s)}.` } : { ok: false, text: scenario ? "Saved scenario not found." : "That link's setup can't be played." });
      }
      setParams(
        (p) => {
          const q = new URLSearchParams(p);
          for (const k of ["scenario", ...SETUP_PARAMS]) q.delete(k);
          return q;
        },
        { replace: true },
      );
    };
    void opening();
    return () => {
      alive = false;
    };
  }, [scenario, linked, waiting, room, setParams]);

  const keepRef = useRef<HTMLButtonElement>(null);
  const saidRef = useRef<HTMLParagraphElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const wasAsking = useRef(false);
  // The question takes the focus, on the answer that loses nothing, and gives it back: to where it was, or where that has gone
  // with the tables, to the line saying what happened. (A hand that ended meanwhile has already put it on Next hand.)
  useEffect(() => {
    if (asking) {
      if (!wasAsking.current) cameFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasAsking.current = true;
      keepRef.current?.focus();
    } else if (wasAsking.current) {
      wasAsking.current = false;
      if (document.activeElement && document.activeElement !== document.body) return;
      const back = cameFrom.current;
      (back?.isConnected && back !== document.body ? back : saidRef.current)?.focus({ preventScroll: true });
    }
  }, [asking]);
  const answerLink = (replace: boolean) => {
    if (!asking) return;
    const { setup: s, name } = asking;
    if (replace) {
      room.setTables(1);
      room.startSession(s.players, s.stack, s.opts);
    }
    setOpened({ ok: true, text: replace ? `Started ${name}.` : `Kept this session. ${name} wasn't started.` });
    setAsking(null);
  };

  // a press of New session or Tables that brings tables up, for MultiTables to take you to them
  const pressRef = useRef(false);
  // The setup is one form in either of its places, moved as the tables go above one, so what you've typed in it goes with it.
  const [home] = useState(() => {
    const d = document.createElement("div");
    d.className = "contents";
    return d;
  });
  const place = useCallback((at: HTMLElement | null) => void at?.append(home), [home]);
  const tableRef = useRef<HTMLDivElement>(null);
  // E opens the game's setup and takes you to its first field (Esc leaves it, and the table's keys are back)
  const gameRef = useRef<HTMLDetailsElement>(null);
  useHandKeys(active && !asking, (e) => {
    if (e.key.toLowerCase() !== "e" || !gameRef.current) return;
    e.preventDefault();
    gameRef.current.open = true;
    gameRef.current.querySelector<HTMLElement>("input, select, textarea, button:not([disabled])")?.focus();
  });

  const sum = summary(session.score);
  const setup = (
    <SetupForm
      key={`${session.players}/${session.stack}/${JSON.stringify(session.opts)}`}
      players={session.players}
      stack={session.stack}
      opts={session.opts}
      tables={tables.length}
      onEdit={() => room.editing()}
      onStart={(p, n, o) => {
        pressRef.current = many;
        room.startSession(p, n, o);
        // (at one table: with the form open on a tablet or laptop, the hand starts below the fold, and the field Enter
        // started it from would keep the table's keys. MultiTables has its own.)
        if (!many) {
          if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
          bringIntoView(tableRef.current);
        }
      }}
    />
  );

  const score = (
    <ScoreStrip session={session} acc={sum.acc} loss={sum.loss} lossPct={sum.lossPct}>
      <AheadLine on={snap.ahead.on && snap.stopCost !== "kills"} meter={snap.ahead.meter} />
    </ScoreStrip>
  );

  return (
    <div className="flex flex-col gap-4">
      {opened && (
        <p ref={saidRef} tabIndex={-1} role={opened.ok ? "status" : "alert"} className={`text-sm ${opened.ok ? "text-muted" : "text-danger"}`}>
          {opened.text}
        </p>
      )}
      {asking && (
        <div
          role="alertdialog"
          aria-labelledby="link-ask-title"
          aria-describedby="link-ask-words"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            answerLink(false);
          }}
          className="space-y-2 rounded-lg border border-warn/50 bg-surface p-3 text-sm"
        >
          <h2 id="link-ask-title" className="font-medium">
            A session is under way
          </h2>
          <p id="link-ask-words" className="text-muted">
            Start {asking.name}? The hand in progress is lost.
          </p>
          <div className="flex flex-wrap gap-2">
            <button ref={keepRef} type="button" onClick={() => answerLink(false)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong">
              Keep this session
            </button>
            <button type="button" onClick={() => answerLink(true)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
              Start the new one
            </button>
          </div>
        </div>
      )}
      {/* (one row of controls, the game a line under it, the score a line: the table, your options and your last decision
          on the first screen, and what explains them below it) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AskAhead stopCost={snap.stopCost} restarts={snap.restarts} />
        <TablesBar room={room} session={session} count={tables.length} stopCost={snap.stopCost} flops={snap.flops} pressRef={pressRef} />
      {!many && (
        <details ref={gameRef} className="min-w-0 flex-1 basis-72 panel px-3 py-1.5 text-sm open:basis-full">
          <summary className="cursor-pointer">
            Game · {session.players}-max · {session.stack}bb
            {session.opts.pushFold ? " · push/fold" : ""}
            {session.opts.tournament ? ` · ${gameLabel(session.opts.tournament)}` : ""}
            {session.opts.exploit ? ` · exploiting ${assumedWords(session.opts.exploit)}` : ""}
            {session.opts.pfSolve ? ` · preflop graded by the preflop solve${session.opts.pfSizes ? ", at its raise sizes" : ""}` : ""}
          </summary>
          <div ref={place} className="mt-2 flex flex-wrap items-center gap-2" />
          <p className="mt-2 text-xs text-muted">{opponentsOf(session.opts)}</p>
        </details>
      )}

      {many && (
        <details ref={gameRef} className="min-w-0 flex-1 basis-72 panel px-3 py-1.5 text-sm open:basis-full">
          <summary className="cursor-pointer">Game</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted">{opponentsOf(session.opts)} Some fields apply at one table only.</p>
            <div ref={place} />
          </div>
        </details>
      )}
      </div>
      {createPortal(setup, home)}

      {snap.keptRead && (
        <p role="status" className="text-sm text-warn">
          {keptNote(snap.keptRead)}
        </p>
      )}

      {/* (while a link is being asked about, a key answers that, not the table) */}
      <div ref={tableRef} className="scroll-mt-14">
        {many ? <MultiTables room={room} snap={snap} active={active && !asking} pressRef={pressRef} side={score} /> : <OneTable room={room} snap={snap} active={active && !asking} side={score} />}
      </div>

      {/* (past sessions are History's: one link there, not a second list) */}
      <p className="px-1 text-xs">
        <Link to="/history" className="text-muted underline hover:text-text">
          All sessions →
        </Link>
      </p>
    </div>
  );
}

/** Today's page, one table: the seats and board, your move, your last decision, the hand's log and your decisions. */
function OneTable({ room, snap, active, side }: { room: Room; snap: RoomSnapshot; active: boolean; side: ReactNode }) {
  const { session, tables, kept } = snap;
  const { hand, answer, failed, error, last, lastRange } = tables[0]!;
  const shown = answer && gradedOn(hand, answer);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retry = useMemo(() => ({ getClient: room.retryClient, onOpen: setRetrying }), [room]);
  const keepAll = useSettings((s) => s.keepHands);
  const setSettings = useSettings((s) => s.set);

  const sim = useMemo(() => simOf(hand), [hand]);
  const phase = useMemo(() => phaseOf(hand, sim), [hand, sim]);
  // an opponent's move under way, or your preflop played for you in a drill; what stopped it, said by seat
  const moving = phase.kind === "villain" || phase.kind === "auto" ? phase : null;
  const alert = error ?? (failed && moving ? `${seatLabel(moving.seat, hand.players)}'s move failed: ${failed}` : null);
  // (one spot of one hand: a hint or a Reveal's table goes as the hand moves on)
  const spotKey = `${hand.seed}|${hand.n}|${hand.shown}|${hand.decisions.length}`;

  // keys (keys.ts): 1–9, F, C/X, R/B, A your options; Enter, Space or N the next hand, O runs it out, K keeps the hand in
  // Analyze; G the last decision's range; H and Shift+H are HintReveal's. None under an open retry, whose options look
  // the same and whose press must not play a move here
  const keyable = active && !retrying;
  useHandKeys(keyable, (e, tag) => {
    const k = e.key.toLowerCase();
    if (k === "g" && lastRange) return setRangeOpen((o) => !o);
    if (phase.kind === "hero" && answer) {
      const opts = optionsAt(hand, answer, sim);
      const order = shownOrder(opts);
      const i = optionFromKey(e.key, order.map((k) => opts[k]!.action));
      if (i >= 0) room.choose(order[i]!);
    } else if (hand.result && (phase.kind === "over" || hand.run)) {
      // (Enter or Space on a focused button or link is that control's own)
      if (isNextKey(e.key)) {
        if (k !== "n" && /^(BUTTON|A|SUMMARY)$/.test(tag)) return;
        e.preventDefault();
        room.nextHand();
      } else if (k === "o" && runKind(hand, sim)) room.runOut();
      else if (k === "k" && (kept?.key !== keyOf(session, hand) || kept.st === "error")) room.keep();
    }
  });
  // once the hand is over, the next one is a key away
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (hand.result && active) nextRef.current?.focus({ preventScroll: true });
  }, [hand.result, active]);

  // (wide: the table and your move on the left, what you've done on the right; narrow: one under the other)
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-4 lg:space-y-0">
      <div className="min-w-0 space-y-3">
        <section aria-label="Table" className="space-y-3 panel p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Board" className="flex gap-1">
              {hand.board.map((c, i) =>
                i < boardShown(hand) ? (
                  <PlayingCard key={i} card={c} />
                ) : (
                  <span key={i} aria-hidden className="inline-block h-11 w-8 rounded border border-dashed border-border" />
                ),
              )}
            </div>
            <div className="text-sm">
              <span className="text-muted">Pot </span>
              <span className="font-mono">{fmt(sim.pot)}bb</span>
            </div>
            <span className="flex-1" />
            <span className="text-xs text-muted">
              Hand {hand.n + 1} · {hand.players === 2 ? "heads-up" : `${hand.players}-max`} · {hand.stack}bb
              {hand.ante ? ` · ante ${hand.ante}` : ""}
              {hand.straddle ? " · straddle" : ""}
              {hand.pushFold ? " · push/fold" : ""}
              {hand.tournament ? ` · ${gameLabel(hand.tournament)}` : ""}
              {hand.exploit ? ` · exploiting ${assumedWords(hand.exploit)}` : ""}
              {hand.rake ? ` · rake ${hand.rake.pct}%${hand.rake.cap ? ` (cap ${hand.rake.cap}bb)` : ""}` : ""}
              {hand.sizes ? ` · your sizes: ${describeSetup({ sizes: hand.sizes }).join(", ")}` : ""}
            </span>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
            {seatsOf(hand.players).map((p) => (
              <SeatView key={p} hand={hand} sim={sim} p={p} />
            ))}
          </ul>
          <HandLine hand={hand} />
          {hand.stacks && !hand.tournament && <Carried hand={hand} sim={sim} onReset={() => room.nextHand(true)} />}
          {hand.tournament && playsOn(session.opts) && <PlayedOut hand={hand} sim={sim} onRestart={() => room.nextHand(true)} />}
        </section>

        <section aria-label="Your move" className="space-y-2 panel p-3">
          {alert && (
            <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger">
              {alert}{" "}
              {moving && (
                <button type="button" className="underline" onClick={() => room.retry()}>
                  Try again
                </button>
              )}
              {moving && failed && (
                // (their move, not yours: it goes in the hand's line and never in your decisions)
                <button type="button" className="ml-3 underline" onClick={() => room.playOn()}>
                  Play on: {seatLabel(moving.seat, hand.players)} checks or calls (not a solve)
                </button>
              )}
            </div>
          )}
          {seeking(hand) && !alert && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              Dealing {potLabel(hand.pot!)}: the preflop is played for you
              {hand.tries ? ` (deal ${hand.tries + 1})` : ""}…
            </p>
          )}
          {phase.kind === "villain" && !alert && !seeking(hand) && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              {seatLabel(phase.seat, hand.players)} is thinking…
            </p>
          )}
          {phase.kind === "deal" && <p className="text-sm text-muted">Dealing the {phase.street}…</p>}
          {phase.kind === "hero" && !answer && !failed && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              {answering(sim, hand)}…
            </p>
          )}
          {phase.kind === "hero" && answer && (
            <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
              {((opts) => shownOrder(opts).map((k, i) => [opts[k]!, k, i] as const))(optionsAt(hand, answer, sim)).map(([a, k, i]) => (
                <button
                  key={a.action}
                  type="button"
                  onClick={() => room.choose(k)}
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface-3"
                >
                  {i < 9 && (
                    <span aria-hidden className="mr-1.5 text-xs text-faint">
                      {i + 1}
                    </span>
                  )}
                  {optionLabel(a.action, a.amount_bb)}
                </button>
              ))}
            </div>
          )}
          {phase.kind === "hero" && (
            <HintReveal
              key={spotKey}
              keys={keyable}
              hint={() => handHint(hand, sim)}
              source={HINT_SOURCE}
              onReveal={answer ? () => room.reveal() : null}
              revealed={
                hand.revealed && answer ? (
                  <RevealedMix mix={mixOf(shown!.data)} provenance={modelled(hand, shown!.provenance) ?? shown!.provenance} labelOf={(a) => optionLabel(a.action, a.amount)} note={`${shown!.pfWhy ? `Chart's answer, not the solve's: ${shown!.pfWhy} ` : ""}${REVEAL_NOTE}`} />
                ) : null
              }
            />
          )}
          {phase.kind === "hero" && failed && (
            <div className="space-y-2 text-sm">
              <p role="alert" className="text-danger">
                No answer to grade this spot against: {failed}{" "}
                <button type="button" className="underline" onClick={() => room.retry()}>
                  Ask again
                </button>
              </p>
              <FallbackMoves hand={hand} onMove={(a) => room.ungraded(a)} />
            </div>
          )}
          {hand.result && (phase.kind === "over" || hand.run) && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm">
                {hand.result.folded
                  ? "You folded"
                  : hand.result.cut
                    ? hand.pushFold
                      ? "You see the flop: a push/fold hand stops here"
                      : "You see the flop: preflop only, the hand stops here"
                    : hand.result.net > 0
                      ? "You won"
                      : hand.result.net < 0
                        ? "You lost"
                        : "You broke even"}
                {hand.result.net !== 0 && (
                  <span className="font-mono">
                    {hand.result.folded ? " · −" : " "}
                    {fmt(Math.abs(hand.result.net))}bb
                  </span>
                )}
                {hand.result.says && <span className="text-muted"> · {hand.result.says}</span>}
                <RunText hand={hand} sim={sim} />
              </p>
              {readWords(hand) && <p className="basis-full text-xs text-muted">{readWords(hand)}</p>}
              {runKind(hand, sim) && (
                <button
                  type="button"
                  onClick={() => room.runOut()}
                  title={
                    runKind(hand, sim) === "played"
                      ? "Others play on; your result stays"
                      : "Show all cards"
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
                >
                  {runKind(hand, sim) === "played" ? "Run it out" : "Show hands"}
                  <Kbd>O</Kbd>
                </button>
              )}
              <button ref={nextRef} type="button" onClick={() => room.nextHand()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
                Next hand
                <Kbd>N</Kbd>
              </button>
              <KeepHand
                kept={kept?.key === keyOf(session, hand) ? kept : null}
                all={keepAll}
                onKeep={() => room.keep()}
                onAll={(all) => {
                  setSettings({ keepHands: all });
                  if (all && kept?.key !== keyOf(session, hand)) room.keep();
                }}
              />
            </div>
          )}
        </section>

        {/* (your recent decisions under the table, in the room the move leaves, so the right column's last decision
            isn't followed by a scroll) */}
        {session.review.length > 0 && <ReviewMistakes review={session.review} retry={retry} />}
      </div>

      <aside aria-label="Your results" className="min-w-0 space-y-3">
        {side}
        {last && (
          <DecisionView d={last} players={hand.players} spot={session.review.find((e) => e.d === last)}>
            {lastRange && <RangeView key={`${last.study}|${lastRange.cls}`} r={lastRange} open={rangeOpen} onToggle={setRangeOpen} />}
          </DecisionView>
        )}
      </aside>
    </div>
  );
}
