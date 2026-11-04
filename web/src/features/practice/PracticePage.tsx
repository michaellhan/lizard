// Practice, in two tabs: full hands (here) and drills (DrillsPanel.tsx, one flop decision from the library).
// Full hands are against GTO opponents. Every opponent's move is drawn from the solver's mix for its actual
// hand (Advisor.play); your options are the solver's actions at your spot, and each decision is graded against its
// answer once you've acted (src/grading/grade.ts: by EV given up where the answer has EVs, by frequency on the
// preflop charts), with the answer's provenance beside it. The session's score is kept in IndexedDB (sessions).
// A Room runs the hands (room.ts: the requests, the pace, the session) and FullHands draws its snapshot: one table here
// (OneTable), two to four in MultiTables.tsx, whichever the Room has, as a session above one table comes back on a reload.
// What a hand needs next is flow.ts's, the session's totals session.ts's; the page's parts are in PracticeParts.tsx and
// SetupForm.tsx.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { VerdictTag } from "@/components/VerdictTag";
import { bb, pct } from "@/components/actions";
import { recentSessions, type SessionRecord } from "@/data/db";
import { GRADE_RULES, summary } from "@/grading/grade";
import { seatLabel, seatsOf } from "@/poker/seats";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { describeSetup } from "@/features/solve/setup";
import { ModePicker } from "@/features/study/ModePicker";
import { DrillsPanel } from "./DrillsPanel";
import { MultiTables, TablesBar } from "./MultiTables";
import { Carried, DecisionView, FallbackMoves, fmt, HandLog, KeepHand, optionLabel, RangeView, ReviewMistakes, RunText, ScoreStrip, SeatView, signed, useHandKeys } from "./PracticeParts";
import { boardShown, optionsOf, phaseOf, potLabel, runKind, seeking, simOf } from "./practice";
import { Room, type RoomSnapshot } from "./room";
import { keyOf } from "./session";
import { SetupForm } from "./SetupForm";

export { optionLabel };

type Tab = "hands" | "drills";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "hands", label: "Full hands" },
  { id: "drills", label: "Drills" },
];

/** `pace`: ms an opponent's move and a new card take at least, so the hand can be followed (0 in tests). `pause`, `guard`:
 * the Room's, above one table (unset: its own). */
export function PracticePage({ pace = 450, pause, guard }: { pace?: number; pause?: number; guard?: number } = {}) {
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
        <div role="tablist" aria-label="Practice" className="flex gap-1 rounded-md border border-border p-0.5 text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`practice-tab-${t.id}`}
              aria-selected={tab === t.id}
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

  const sum = summary(session.score);
  const others = past.filter((p) => p.id !== session.id);
  const setup = (
    <SetupForm
      key={`${session.players}/${session.stack}/${JSON.stringify(session.opts)}`}
      players={session.players}
      stack={session.stack}
      opts={session.opts}
      onStart={(p, n, o) => room.startSession(p, n, o)}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {many ? (
            <p className="text-sm text-muted">
              Several tables against GTO opponents, one score across them all. The table that needs you comes to the front and the solver answers one table at a time. Your options are the
              solver&rsquo;s actions at your spot; the grade and what answered show on the table and beside it once you&rsquo;ve acted. Keys: 1&ndash;9 your options, F, C or X fold, check or
              call, S the next waiting table, Enter or Space deal finished tables now (each deals by itself otherwise), K keeps the last finished hand in Analyze.
            </p>
          ) : (
            <p className="text-sm text-muted">
              Hands against GTO opponents: each opponent plays its actual cards from the solver&rsquo;s mix. Your options are the solver&rsquo;s actions at your spot;
              the grade and the answer show once you&rsquo;ve acted. Your seat moves one place each hand, unless you pick one; preflop only, a hand stops as the
              preflop closes; one kind of pot (single-raised, 3-bet, blind vs blind), your preflop is played for you from the charts, the hand dealt again until
              it reaches the flop heads-up as that pot, and you play from the flop. With an ante or a straddle, preflop is answered from the engine&rsquo;s chart
              for that game (the 100bb chart moved by its solves of the game: still the charts, approximate). With chips carried (a ring game), each player&rsquo;s
              chips go on to the next hand, a seat under a quarter of the stack rebuying to it; after your fold, the others&rsquo; go as if they checked it down. Up to
              four tables at once: pick how many under Tables. Keys: 1&ndash;9 answer, Enter or Space for the next hand, K keeps it in Analyze.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModePicker modes={["quick", "accurate"]} />
          {!many && setup}
        </div>
      </div>

      {many && (
        <details className="rounded-lg border border-border bg-surface p-3 text-sm">
          <summary className="cursor-pointer">Game</summary>
          <div className="mt-2">{setup}</div>
        </details>
      )}

      <TablesBar room={room} session={session} count={tables.length} stopCost={snap.stopCost} flops={snap.flops} />

      <ScoreStrip session={session} acc={sum.acc} loss={sum.loss} lossPct={sum.lossPct} />

      {many ? <MultiTables room={room} snap={snap} active={active} /> : <OneTable room={room} snap={snap} active={active} />}

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
                {s.decisions ? ` · ${pct((Number(s.meta.ok) || 0) / s.decisions, 0)} correct` : ""}
                {Number(s.meta.graded) ? ` · ${bb(s.evLossBb / Number(s.meta.graded))}bb lost a decision` : ""}
                {s.meta.preflopOnly ? " · preflop only" : ` · net ${signed(Number(s.meta.net) || 0)}bb`}
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
  const [rangeOpen, setRangeOpen] = useState(false);
  const keepAll = useSettings((s) => s.keepHands);
  const setSettings = useSettings((s) => s.set);

  const sim = useMemo(() => simOf(hand), [hand]);
  const phase = useMemo(() => phaseOf(hand, sim), [hand, sim]);
  // an opponent's move under way, or your preflop played for you in a drill; what stopped it, said by seat
  const moving = phase.kind === "villain" || phase.kind === "auto" ? phase : null;
  const alert = error ?? (failed && moving ? `${seatLabel(moving.seat, hand.players)}'s move failed: ${failed}` : null);

  // keys: 1–9 take your options, Enter or Space the next hand, K keeps the hand in Analyze
  useHandKeys(active, (e, tag) => {
    if (phase.kind === "hero" && answer && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < optionsOf(answer.data).length) room.choose(i);
    } else if (phase.kind === "over" && hand.result) {
      // (Enter or Space on a focused button or link is that control's own)
      if ((e.key === "Enter" || e.key === " ") && !/^(BUTTON|A)$/.test(tag)) {
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
            {hand.rake ? ` · rake ${hand.rake.pct}%${hand.rake.cap ? ` (cap ${hand.rake.cap}bb)` : ""}` : ""}
            {hand.sizes ? ` · your sizes: ${describeSetup({ sizes: hand.sizes }).join(", ")}` : ""}
          </span>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {seatsOf(hand.players).map((p) => (
            <SeatView key={p} hand={hand} sim={sim} p={p} />
          ))}
        </ul>
        {hand.stacks && <Carried hand={hand} sim={sim} onReset={() => room.nextHand(true)} />}
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
            Solving your spot so your move can be graded…
            <span className="text-muted">(the first answer starts the engine)</span>
          </p>
        )}
        {phase.kind === "hero" && answer && (
          <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
            {optionsOf(answer.data).map((a, i) => (
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
                  ? "You see the flop: preflop only, the hand stops here"
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
        <DecisionView d={last} players={hand.players}>
          {lastRange && <RangeView key={`${last.study}|${lastRange.cls}`} r={lastRange} open={rangeOpen} onToggle={setRangeOpen} />}
        </DecisionView>
      )}

      <HandLog hand={hand} />

      {session.review.length > 0 && <ReviewMistakes review={session.review} />}
    </>
  );
}
