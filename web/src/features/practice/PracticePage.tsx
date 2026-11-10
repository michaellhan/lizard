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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router";
import { bringIntoView } from "@/components/scroll";
import { rowKeys } from "@/components/rowKeys";
import { PlayingCard } from "@/components/PlayingCard";
import { VerdictTag } from "@/components/VerdictTag";
import { bb, pct } from "@/components/actions";
import { recentSessions, type SessionRecord } from "@/data/db";
import { getScenario, scenarioWords, type ScenarioSetup } from "@/data/scenarios";
import { GRADE_RULES, summary } from "@/grading/grade";
import { seatLabel, seatsOf } from "@/poker/seats";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { rowOf } from "@/features/history/history";
import { describeSetup } from "@/features/solve/setup";
import { ModePicker } from "@/features/study/ModePicker";
import { DrillsPanel } from "./DrillsPanel";
import { MultiTables, TablesBar } from "./MultiTables";
import { handHint, HINT_SOURCE } from "./hint";
import { HintReveal, REVEAL_CHIPS, REVEAL_NOTE, RevealedMix } from "./HintReveal";
import { AheadLine, AskAhead, Carried, DecisionView, FallbackMoves, fmt, HandLog, KeepHand, optionLabel, RangeView, ReviewMistakes, RunText, ScoreStrip, SeatView, signed, useHandKeys } from "./PracticeParts";
import { gradedOn, optionsAt, PF_MODEL } from "./pfGrade";
import { boardShown, gameLabel, mixOf, modelled, phaseOf, potLabel, runKind, seeking, simOf } from "./practice";
import { keptNote, PACE, Room, type RoomSnapshot } from "./room";
import { keyOf } from "./session";
import { readSetupLink, SETUP_PARAMS, setupLinkKey } from "./setupLink";
import { SetupForm } from "./SetupForm";
import { ASSUMED, assumedWords, EXPLOIT_SCOPE, readWords } from "./exploit";
import { answering } from "./TableTile";

export { optionLabel };

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
      </div>
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
  const [room] = useState(() => new Room({ pace, pause, guard }));
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
  const [past, setPast] = useState<SessionRecord[]>([]);

  useEffect(() => {
    let alive = true;
    void recentSessions("practice", 6)
      .then((xs) => alive && setPast(xs))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
        setOpened(s ? { ok: true, text: `Started ${kept?.name ?? scenarioWords(s)}.` } : { ok: false, text: scenario ? "That saved scenario is gone or can't be read, so nothing was started." : "That link's setup can't be played, so nothing was started." });
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
  // On a phone the table comes first: the setup and everything else above it would fill the first screen and more.
  const [wide] = useState(() => typeof matchMedia !== "function" || matchMedia("(min-width: 768px)").matches);
  const tableRef = useRef<HTMLDivElement>(null);

  const sum = summary(session.score);
  const others = past.filter((p) => p.id !== session.id);
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
        // (at one table: with the form open on a tablet or laptop, the hand starts below the fold. MultiTables has its own.)
        if (!many) bringIntoView(tableRef.current);
      }}
    />
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
            This link starts {asking.name}, in place of what you&rsquo;re playing. Finished hands stay in History, and the hand in progress goes.
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
      <div className="flex flex-wrap items-center gap-2">
        <ModePicker modes={["quick", "accurate"]} />
        <AskAhead stopCost={snap.stopCost} restarts={snap.restarts} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">How this table works</summary>
        <div className="mt-1">
          {many ? (
            <p className="text-sm text-muted">
              Several tables, one score across them all. Opponents play the charts preflop, then the solver, or betting rules on a flop or turn with five or more still in. The table that needs
              you comes to the front and the solver answers one table at a time. Your options are the solver&rsquo;s actions at your spot; the grade and what answered show on the table and beside it once you&rsquo;ve acted. Keys: 1&ndash;9 your options, F, C or X fold, check or
              call, S the next waiting table, Enter or Space deal finished tables now (each deals by itself otherwise), K keeps the last finished hand in Analyze. Hint, Reveal, Previous and
              retrying a decision are at one table only, as each belongs to one spot and this page shows several.
            </p>
          ) : (
            <p className="text-sm text-muted">
              Each opponent plays its actual cards: from the charts preflop, then the solver&rsquo;s mix, or betting rules on a flop or turn with five or more still in. Your options are the
              solver&rsquo;s actions at your spot;
              the grade and the answer show once you&rsquo;ve acted. Your seat moves one place each hand, unless you pick one; preflop only, a hand stops as the
              preflop closes; one kind of pot (single-raised, 3-bet, blind vs blind), your preflop is played for you from the charts, the hand dealt again until
              it reaches the flop heads-up as that pot, and you play from the flop. Push/fold deals 10 to 12bb, where you jam or fold, or call or fold a jam, against the push/fold model, and an all-in runs out.
              Tournament sets the prizes and each seat&rsquo;s stack, every hand starts from them, and the answers are in chip EV or prize equity, kept apart in History and Review. In one kind of pot, Exploit grades you against the best response to an assumed profile, kept apart too. With an ante or a straddle, preflop is answered from the engine&rsquo;s chart
              for that game (the 100bb chart moved by its solves of the game: still the charts, approximate). With chips carried (a ring game), each player&rsquo;s
              chips go on to the next hand, a seat under a quarter of the stack rebuying to it; after your fold, the others&rsquo; go as if they checked it down. Up to
              four tables at once: pick how many under Tables. Keys: 1&ndash;9 answer, Enter or Space for the next hand, K keeps it in Analyze. Hint says what the spot is and what a call
              costs. Reveal shows the answer for your hand, and what you do after it isn&rsquo;t graded. Under Recent decisions, Previous steps back through this session&rsquo;s graded
              decisions, and a retry is graded and shown but changes nothing.
            </p>
          )}
        </div>
      </details>
      {!many && (
        <details open={wide} className="rounded-lg border border-border bg-surface p-3 text-sm">
          <summary className="cursor-pointer">
            Game · {session.players}-max · {session.stack}bb
            {session.opts.pushFold ? " · push/fold" : ""}
            {session.opts.tournament ? ` · ${gameLabel(session.opts.tournament)}` : ""}
            {session.opts.exploit ? ` · exploiting ${assumedWords(session.opts.exploit)}` : ""}
            {session.opts.pfSolve ? ` · preflop graded by the preflop solve${session.opts.pfSizes ? ", at its raise sizes" : ""}` : ""}
          </summary>
          <div ref={place} className="mt-2 flex flex-wrap items-center gap-2" />
        </details>
      )}

      {many && (
        <details className="rounded-lg border border-border bg-surface p-3 text-sm">
          <summary className="cursor-pointer">Game</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted">
              {session.opts.exploit
                ? "Above one table Seat decides where you sit, and the board filter here waits until you're back at one table. An exploit session keeps its pot and its profile at every table."
                : "Above one table Spots and Seat decide what's dealt, so Your seat, Play's kinds of pot and Carry chips here wait until you're back at one table. Preflop only still counts."}
            </p>
            <div ref={place} />
          </div>
        </details>
      )}
      {createPortal(setup, home)}

      <TablesBar room={room} session={session} count={tables.length} stopCost={snap.stopCost} flops={snap.flops} pressRef={pressRef} />

      <div className="order-last space-y-4 md:order-none">
        <ScoreStrip session={session} acc={sum.acc} loss={sum.loss} lossPct={sum.lossPct} reserve={many} />
        <AheadLine on={snap.ahead.on && snap.stopCost !== "kills"} meter={snap.ahead.meter} />
      </div>
      {snap.keptRead && (
        <p role="status" className="text-sm text-warn">
          {keptNote(snap.keptRead)}
        </p>
      )}

      {/* (while a link is being asked about, a key answers that, not the table) */}
      <div ref={tableRef} className="scroll-mt-14">
        {many ? <MultiTables room={room} snap={snap} active={active && !asking} pressRef={pressRef} /> : <OneTable room={room} snap={snap} active={active && !asking} />}
      </div>

      <details className="rounded-lg border border-border bg-surface p-3 text-sm">
        <summary className="cursor-pointer">How decisions are graded</summary>
        <ul className="mt-2 space-y-1">
          {GRADE_RULES.map((r) => (
            <li key={r.verdict}>
              <VerdictTag v={r.verdict} /> {r.rule}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted">
          Preflop the answer is the preflop charts (frequencies, no EVs): a preflop move is graded by how often the chart plays it, and no EV is counted as lost.
          {session.opts.pfSolve &&
            ` In this session a preflop decision is graded by EV against the stored preflop solve where its tree holds this very spot: an ${PF_MODEL}. ${session.opts.pfSizes ? "The opponents stay the charts', and your raise is offered at the solve's size where it can grade the spot, so that raise isn't the chart's and the hand leaves the flop library for live solves. Where the chips or the options aren't the solve's" : "Your options and the opponents stay the charts', so where the chips, the sizes or the options aren't the solve's"}, or it has folded your hand's class by then, the decision keeps the chart's frequency grade under the chart's label, and says why. The two are never added together.`}
        </p>
        <p className="mt-2 text-muted">
          At 12bb or less the answer is the push/fold model: first in, an equilibrium of a game with only all-in or fold, worked out by hand class; facing a jam, a call priced by equity against that range. It has no EVs and isn&rsquo;t a
          solve, so it&rsquo;s graded by frequency too. In a tournament the badge says what each answer is in: a prize-equity EV is chips worth as much prize equity, and a fallback&rsquo;s chips are graded by frequency there.
        </p>
        <p className="mt-2 text-muted">
          With an exploit profile the answer is the best response to it, by EV, on a live solve with the profile&rsquo;s numbers locked on your opponent. It&rsquo;s a best response to an assumption, never an equilibrium: a hand&rsquo;s EV holds only if the
          opponent plays those numbers. The badge says so. {ASSUMED} {EXPLOIT_SCOPE} An answer that comes back without the profile isn&rsquo;t graded.
        </p>
      </details>

      {others.length > 0 && (
        <section aria-label="Past sessions" className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-medium">Past sessions</h2>
            <Link to="/history?kind=practice" className="text-xs underline">
              All sessions, and totals by pot type
            </Link>
          </div>
          <ul className="space-y-0.5">
            {others.map((s) => (
              <li key={s.id} className="text-muted">
                {new Date(s.startedAt).toLocaleString()} · {Number(s.meta.hands) || 0} hand{Number(s.meta.hands) === 1 ? "" : "s"} · {s.decisions} decision{s.decisions === 1 ? "" : "s"}
                {s.decisions ? ` · ${pct((Number(s.meta.ok) || 0) / s.decisions, 0)} best or correct` : ""}
                {Number(s.meta.graded) ? ` · ${bb(s.evLossBb / Number(s.meta.graded))}bb lost per decision` : ""}
                {s.meta.pushFold ? " · push/fold" : ""}
                {s.meta.preflopOnly ? " · preflop only" : ` · net ${signed(Number(s.meta.net) || 0)}bb`}
                {s.decisions ? ` · Graded against: ${rowOf(s).graded}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Today's page, one table: the seats and board, your move, your last decision, the hand's log and your decisions. */
function OneTable({ room, snap, active }: { room: Room; snap: RoomSnapshot; active: boolean }) {
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

  // keys: 1–9 take your options, Enter or Space the next hand, K keeps the hand in Analyze; none under an open retry,
  // whose options look the same and whose press must not play a move here
  useHandKeys(active && !retrying, (e, tag) => {
    if (phase.kind === "hero" && answer && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < optionsAt(hand, answer, sim).length) room.choose(i);
    } else if (phase.kind === "over" && hand.result) {
      // (Enter or Space on a focused button or link is that control's own)
      if ((e.key === "Enter" || e.key === " ") && !/^(BUTTON|A|SUMMARY)$/.test(tag)) {
        e.preventDefault();
        room.nextHand();
      } else if (e.key.toLowerCase() === "k" && (kept?.key !== keyOf(session, hand) || kept.st === "error")) room.keep();
    }
  });
  // once the hand is over, the next one is a key away
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (hand.result && active) nextRef.current?.focus({ preventScroll: true });
  }, [hand.result, active]);

  return (
    <>
      <section aria-label="Table" className="space-y-3 rounded-lg border border-border bg-surface p-3">
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
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {seatsOf(hand.players).map((p) => (
            <SeatView key={p} hand={hand} sim={sim} p={p} />
          ))}
        </ul>
        {hand.stacks && !hand.tournament && <Carried hand={hand} sim={sim} onReset={() => room.nextHand(true)} />}
      </section>

      <section aria-label="Your move" className="space-y-2 rounded-lg border border-border bg-surface p-3">
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
            {answering(sim, hand)} so your move can be graded…
            <span className="text-muted">(the first answer starts the engine)</span>
          </p>
        )}
        {phase.kind === "hero" && answer && (
          <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
            {optionsAt(hand, answer, sim).map((a, i) => (
              <button
                key={a.action}
                type="button"
                onClick={() => room.choose(i)}
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
            hint={() => handHint(hand, sim)}
            source={HINT_SOURCE}
            onReveal={answer ? () => room.reveal() : null}
            revealed={
              hand.revealed && answer ? (
                <RevealedMix mix={mixOf(shown!.data)} provenance={modelled(hand, shown!.provenance) ?? shown!.provenance} labelOf={(a) => optionLabel(a.action, a.amount)} note={`${shown!.pfWhy ? `Not by the preflop solve here: ${shown!.pfWhy} ` : ""}${REVEAL_NOTE} ${REVEAL_CHIPS}`} />
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
                    ? "The others play the hand on by their strategies to its end; your result stays as at your fold"
                    : "Everyone's cards and the rest of the board"
                }
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
              >
                {runKind(hand, sim) === "played" ? "Run it out" : "Show hands"}
              </button>
            )}
            <button ref={nextRef} type="button" onClick={() => room.nextHand()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
              Next hand
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

      {last && (
        <DecisionView d={last} players={hand.players} spot={session.review.find((e) => e.d === last)}>
          {lastRange && <RangeView key={`${last.study}|${lastRange.cls}`} r={lastRange} open={rangeOpen} onToggle={setRangeOpen} />}
        </DecisionView>
      )}

      <HandLog hand={hand} />

      {session.review.length > 0 && <ReviewMistakes review={session.review} retry={retry} />}
    </>
  );
}
