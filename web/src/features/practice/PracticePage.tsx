// Practice, in two tabs: full hands (here) and drills (DrillsPanel.tsx, one flop decision from the library).
// Full hands are against GTO opponents. Every opponent's move is drawn from the solver's mix for its actual
// hand (Advisor.play); your options are the solver's actions at your spot, and each decision is graded against its
// answer once you've acted (src/grading/grade.ts: by EV given up where the answer has EVs, by frequency on the
// preflop charts), with the answer's provenance beside it. The session's score is kept in IndexedDB (sessions).
// As the classic trainer, a Fast setting plays Quick's budgets after the flop (index.html budgetsFor). What the hand
// needs next is flow.ts's, the session's totals session.ts's; the page's parts are in PracticeParts.tsx and SetupForm.tsx.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { VerdictTag } from "@/components/VerdictTag";
import { bb, pct } from "@/components/actions";
import { putSession, recentSessions, type SessionRecord } from "@/data/db";
import { addHands } from "@/data/hands";
import { GRADE_RULES, summary } from "@/grading/grade";
import { seatLabel, seatsOf } from "@/poker/seats";
import { SolverError, type SolveResult } from "@/solver/types";
import { useSolver } from "@/solver/useSolver";
import { CLASSIC_URL } from "@/config";
import { useSettings } from "@/state/settings";
import { describeSetup } from "@/features/solve/setup";
import { ModePicker } from "@/features/study/ModePicker";
import { DrillsPanel } from "./DrillsPanel";
import { moveOf, needOf } from "./flow";
import { practiceRecord } from "./history";
import { Carried, DecisionView, FallbackMoves, fmt, HandLog, KeepHand, optionLabel, RangeView, ReviewMistakes, RunText, ScoreStrip, SeatView, signed } from "./PracticeParts";
import { afterDeal, afterDecision, afterHand, freshSession, keyOf, toRecord, type Kept, type PracticeSession } from "./session";
import { SetupForm } from "./SetupForm";
import {
  boardShown,
  dealNext,
  decide,
  decideUngraded,
  DRILL_TRIES,
  finish,
  following,
  newHand,
  offDrill,
  optionsOf,
  phaseOf,
  POT_DRILLS,
  rangeAt,
  redeal,
  runKind,
  seeking,
  simOf,
  withVillain,
  type Decision,
  type HandOptions,
  type PracticeHand,
  type RangeAt,
} from "./practice";

export { optionLabel };

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Advice = { key: string } & ({ st: "loading" } | { st: "done"; result: SolveResult } | { st: "error"; message: string });

type Tab = "hands" | "drills";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "hands", label: "Full hands" },
  { id: "drills", label: "Drills" },
];

/** `pace`: ms an opponent's move and a new card take at least, so the hand can be followed (0 in tests). */
export function PracticePage({ pace = 450 }: { pace?: number } = {}) {
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
          <FullHands pace={pace} active={tab === "hands"} />
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
function FullHands({ pace, active }: { pace: number; active: boolean }) {
  const picked = useSettings((s) => s.mode);
  const mode = picked === "accurate" ? "accurate" : "quick";
  const getSolver = useSolver();
  const [session, setSession] = useState<PracticeSession>(() => afterDeal(freshSession(6, 100)));
  const [hand, setHand] = useState<PracticeHand>(() => newHand(6, 100, 0, randomSeed()));
  const [advice, setAdvice] = useState<Advice>({ key: "", st: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Decision | null>(null);
  // your range at that decision (the answer's grid), and whether it's shown
  const [lastRange, setLastRange] = useState<RangeAt | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [past, setPast] = useState<SessionRecord[]>([]);
  const keepAll = useSettings((s) => s.keepHands);
  const setSettings = useSettings((s) => s.set);
  const [kept, setKept] = useState<Kept | null>(null);
  // (read when a hand ends: commit is the same callback all session)
  const keeping = useRef({ all: keepAll, session });
  useEffect(() => {
    keeping.current = { all: keepAll, session };
  }, [keepAll, session]);

  const sim = useMemo(() => simOf(hand), [hand]);
  const phase = useMemo(() => phaseOf(hand, sim), [hand, sim]);
  const spotKey = `${hand.seed}|${hand.shown}|${JSON.stringify(hand.lines)}|${hand.run ?? ""}|${mode}|${retry}`;

  // a finished hand into Analyze's hands, as a hand history (history.ts)
  const keep = useCallback(async (h: PracticeHand, s: PracticeSession) => {
    const key = keyOf(s, h);
    setKept({ key, st: "saving" });
    try {
      const rec = practiceRecord(h, s, new Date());
      const res = await addHands([rec]);
      setKept(res ? { key, st: "kept", id: rec.id, had: res.existing > 0 } : { key, st: "error", message: "this browser keeps nothing here (a private window?)" });
    } catch (e) {
      setKept({ key, st: "error", message: message(e) });
    }
  }, []);

  // the hand after a move or a card: settled, and counted, where that ended it (and kept, where you keep them all)
  const commit = useCallback(
    (h: PracticeHand) => {
      // a drill's preflop gone another way: dealt again, not counted (up to DRILL_TRIES deals)
      if (offDrill(h)) {
        const opts = keeping.current.session.opts;
        if ((h.tries ?? 0) + 1 < DRILL_TRIES) setHand(redeal(h, randomSeed(), opts));
        else setError(`No ${POT_DRILLS[h.pot!].one.replace(/^an? /, "")} in ${DRILL_TRIES} deals.`);
        return;
      }
      if (h.result || phaseOf(h).kind !== "over") {
        setHand(h);
        return;
      }
      const result = finish(h);
      setHand({ ...h, result });
      setSession((s) => afterHand(s, h, result));
      if (keeping.current.all) void keep({ ...h, result }, keeping.current.session);
    },
    [keep],
  );

  // the hand moves on: cards dealt, an opponent's move asked for, or your spot solved
  useEffect(() => {
    const need = needOf(hand, mode);
    if (need.kind === "over") return;
    if (need.kind === "deal") {
      const t = setTimeout(() => commit(dealNext(hand, need.street)), pace);
      return () => clearTimeout(t);
    }
    const ac = new AbortController();
    let alive = true;
    if (need.kind === "opp") {
      const play = need.play!;
      void (async () => {
        try {
          const client = await getSolver();
          if (!alive) return;
          const [mv] = await Promise.all([
            client.play(need.state, play, { mode, signal: ac.signal }),
            // (a drill's preflop, dealt again until it's the pot, goes by at once)
            wait(seeking(hand) ? 0 : pace),
          ]);
          if (alive) commit(withVillain(hand, moveOf(hand, mv.data).move));
        } catch (e) {
          if (!alive) return;
          setError(`${seatLabel(play.seat, hand.players)}'s move failed: ${message(e)}`);
        }
      })();
    } else {
      // (until its answer, an answer for another spot reads as loading: see `shown`)
      void (async () => {
        try {
          const client = await getSolver();
          if (!alive) return;
          const result = await client.solve({ state: need.state, mode, signal: ac.signal });
          if (alive) setAdvice({ key: spotKey, st: "done", result });
        } catch (e) {
          if (!alive) return;
          const stopped = e instanceof SolverError && e.kind === "cancelled";
          setAdvice({ key: spotKey, st: "error", message: stopped ? "Stopped." : message(e) });
        }
      })();
    }
    return () => {
      alive = false;
      ac.abort();
    };
    // (spotKey covers the hand's action, its cards out, a run-out after your fold, the mode and a retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotKey, getSolver, pace, commit]);

  // (a deal moves `dealt` alone, which no record holds: nothing to write, and `endedAt` stays at your last move)
  useEffect(() => {
    if (session.hands || session.score.n) void putSession(toRecord(session)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.hands, session.score]);

  useEffect(() => {
    let alive = true;
    void recentSessions("practice", 6)
      .then((xs) => alive && setPast(xs))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const startSession = useCallback((players: number, stack: number, opts: Required<HandOptions>) => {
    const s = freshSession(players, stack, opts);
    setSession(afterDeal(s));
    setHand(newHand(players, stack, s.dealt, randomSeed(), opts));
    setLast(null);
    setLastRange(null);
    setError(null);
  }, []);

  // (with chips carried, from where this hand left them; `reset`, every seat back at the starting stack)
  const nextHand = (reset = false) => {
    setHand(following(hand, randomSeed(), session.opts, reset, session.dealt));
    setSession(afterDeal);
    setError(null);
  };

  const shown = advice.key === spotKey ? advice : ({ key: spotKey, st: "loading" } as Advice);

  const choose = (i: number) => {
    if (shown.st !== "done") return;
    const r = decide(hand, shown.result.data, i, shown.result.provenance, sim);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    setLast(r.decision);
    setLastRange(rangeAt(hand, shown.result.data, shown.result.provenance, sim));
    setSession((s) => afterDecision(s, hand, r.decision));
    commit(r.hand);
  };

  // keys: 1–9 take your options, Enter or Space the next hand, K keeps the hand in Analyze (the latest handlers, read
  // through a ref: the listener stays while the tab is shown; set as the page commits, so a key pressed once the new
  // options show never reaches the last spot's handler)
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    onKey.current = (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      // (a held key doesn't repeat into the next spot)
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      if (phase.kind === "hero" && shown.st === "done" && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < optionsOf(shown.result.data).length) choose(i);
      } else if (phase.kind === "over" && hand.result) {
        // (Enter or Space on a focused button or link is that control's own)
        if ((e.key === "Enter" || e.key === " ") && !/^(BUTTON|A)$/.test(tag)) {
          e.preventDefault();
          nextHand();
        } else if (e.key.toLowerCase() === "k" && (kept?.key !== keyOf(session, hand) || kept.st === "error")) void keep(hand, session);
      }
    };
  });
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [active]);
  // once the hand is over, the next one is a key away
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (hand.result && active) nextRef.current?.focus({ preventScroll: true });
  }, [hand.result, active]);

  const ungraded = (a: { action: string; to?: number }) => {
    const h = decideUngraded(hand, a, sim);
    if (typeof h === "string") {
      setError(h);
      return;
    }
    setError(null);
    setLast(h.decisions.at(-1) ?? null);
    setLastRange(null);
    commit(h);
  };

  const sum = summary(session.score);
  const others = past.filter((p) => p.id !== session.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            Hands against GTO opponents: each opponent plays its actual cards from the solver&rsquo;s mix. Your options are the solver&rsquo;s actions at your spot;
            the grade and the answer show once you&rsquo;ve acted. Your seat moves one place each hand, unless you pick one; preflop only, a hand stops as the
            preflop closes; one kind of pot (single-raised, 3-bet, blind vs blind), your preflop is played for you from the charts, the hand dealt again until
            it reaches the flop heads-up as that pot, and you play from the flop. With an ante or a straddle, preflop is answered from the engine&rsquo;s chart
            for that game (the 100bb chart moved by its solves of the game: still the charts, approximate). With chips carried (a ring game), each player&rsquo;s
            chips go on to the next hand, a seat under a quarter of the stack rebuying to it; after your fold, the others&rsquo; go as if they checked it down. Keys: 1&ndash;9 answer, Enter or Space for the next hand, K keeps it in
            Analyze.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModePicker modes={["quick", "accurate"]} />
          <SetupForm
            key={`${session.players}/${session.stack}/${JSON.stringify(session.opts)}`}
            players={session.players}
            stack={session.stack}
            opts={session.opts}
            onStart={startSession}
          />
        </div>
      </div>

      <ScoreStrip session={session} acc={sum.acc} loss={sum.loss} lossPct={sum.lossPct} />

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
        {hand.stacks && <Carried hand={hand} sim={sim} onReset={() => nextHand(true)} />}
      </section>

      <section aria-label="Your move" className="space-y-2 rounded-lg border border-border bg-surface p-3">
        {error && (
          <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger">
            {error}{" "}
            {(phase.kind === "villain" || phase.kind === "auto") && (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setError(null);
                  if (offDrill(hand)) setHand(redeal({ ...hand, tries: 0 }, randomSeed(), session.opts));
                  else setRetry((n) => n + 1);
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {seeking(hand) && !error && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            Dealing {POT_DRILLS[hand.pot!].one}: the preflop is played for you
            {hand.tries ? ` (deal ${hand.tries + 1})` : ""}…
          </p>
        )}
        {phase.kind === "villain" && !error && !seeking(hand) && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            {seatLabel(phase.seat, hand.players)} is thinking…
          </p>
        )}
        {phase.kind === "deal" && <p className="text-sm text-muted">Dealing the {phase.street}…</p>}
        {phase.kind === "hero" && shown.st === "loading" && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            Solving your spot so your move can be graded…
            <span className="text-muted">(the first answer starts the engine)</span>
          </p>
        )}
        {phase.kind === "hero" && shown.st === "done" && (
          <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
            {optionsOf(shown.result.data).map((a, i) => (
              <button
                key={a.action}
                type="button"
                onClick={() => choose(i)}
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
        {phase.kind === "hero" && shown.st === "error" && (
          <div className="space-y-2 text-sm">
            <p role="alert" className="text-danger">
              No answer to grade this spot against: {shown.message}{" "}
              <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
                Ask again
              </button>
            </p>
            <FallbackMoves hand={hand} onMove={ungraded} />
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
                onClick={() => setHand({ ...hand, run: runKind(hand, sim)! })}
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
            <button ref={nextRef} type="button" onClick={() => nextHand()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
              Next hand
            </button>
            <KeepHand
              kept={kept?.key === keyOf(session, hand) ? kept : null}
              all={keepAll}
              onKeep={() => void keep(hand, session)}
              onAll={(all) => {
                setSettings({ keepHands: all });
                if (all && kept?.key !== keyOf(session, hand)) void keep(hand, session);
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

      <p className="text-xs text-muted">
        Not here yet: multi-tabling. It runs in the{" "}
        <a className="underline" href={`${CLASSIC_URL}practice/`}>
          classic trainer
        </a>
        .
      </p>

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
