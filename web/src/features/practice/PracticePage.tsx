// Practice, in two tabs: full hands (here) and drills (DrillsPanel.tsx, one flop decision from the library).
// Full hands are against GTO opponents. Every opponent's move is drawn from the solver's mix for its actual
// hand (Advisor.play); your options are the solver's actions at your spot, and each decision is graded against its
// answer once you've acted (src/grading/grade.ts: by EV given up where the answer has EVs, by frequency on the
// preflop charts), with the answer's provenance beside it. The session's score is kept in IndexedDB (sessions).
// As the classic trainer, a Fast setting plays Quick's budgets after the flop (index.html budgetsFor).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { bb, kindOf, pct } from "@/components/actions";
import { putSession, recentSessions, type SessionRecord } from "@/data/db";
import { addHands } from "@/data/hands";
import { addScore, emptyScore, GRADE_RULES, summary, type Score } from "@/grading/grade";
import { MAX_PLAYERS, MIN_PLAYERS, seatLabel, seatsOf } from "@/poker/seats";
import { behind, legal, STREETS, type Move, type Sim } from "@/poker/table";
import { SolverError, type SolveResult } from "@/solver/types";
import { useSolver } from "@/solver/useSolver";
import { CLASSIC_URL } from "@/config";
import { useSettings } from "@/state/settings";
import { ModePicker } from "@/features/study/ModePicker";
import { DrillsPanel } from "./DrillsPanel";
import { practiceRecord } from "./history";
import {
  dealNext,
  decide,
  decideUngraded,
  finish,
  newHand,
  optionsOf,
  phaseOf,
  setupOf,
  shownCards,
  simOf,
  stateFor,
  villainMove,
  withVillain,
  type Decision,
  type HandOptions,
  type PracticeHand,
} from "./practice";

export const MIN_STACK = 10;
export const MAX_STACK = 250;

interface PracticeSession {
  id: string;
  startedAt: number;
  players: number;
  stack: number;
  /** your seat each hand ("moves", "random" or a seat) and whether hands stop as the preflop closes */
  opts: Required<HandOptions>;
  hands: number;
  /** chips won less chips put in, over the session's hands, bb (not counted preflop only: no hand is played out) */
  net: number;
  score: Score;
}

const DEFAULT_OPTS: Required<HandOptions> = { seat: "moves", preflopOnly: false };

const freshSession = (players: number, stack: number, opts: Required<HandOptions> = DEFAULT_OPTS): PracticeSession => ({
  id: `practice-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
  startedAt: Date.now(),
  players,
  stack,
  opts,
  hands: 0,
  net: 0,
  score: emptyScore(),
});

const toRecord = (s: PracticeSession): SessionRecord => ({
  id: s.id,
  kind: "practice",
  startedAt: s.startedAt,
  endedAt: Date.now(),
  decisions: s.score.n,
  evLossBb: s.score.loss,
  meta: {
    hands: s.hands,
    net: s.net,
    ok: s.score.ok,
    graded: s.score.ne,
    lossPct: s.score.lossPct,
    players: s.players,
    stack: s.stack,
    seat: s.opts.seat,
    ...(s.opts.preflopOnly ? { preflopOnly: true } : {}),
  },
});

/** A finished hand kept in Analyze, or being kept: `key` is the session's and the hand's place in it. */
type Kept = { key: string } & ({ st: "saving" } | { st: "kept"; id: string; had: boolean } | { st: "error"; message: string });
const keyOf = (s: Pick<PracticeSession, "id">, h: Pick<PracticeHand, "n">) => `${s.id}|${h.n}`;

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (x: number) => String(Math.round(x * 100) / 100);
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmt(Math.abs(x))}`;
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
  const [session, setSession] = useState<PracticeSession>(() => freshSession(6, 100));
  const [hand, setHand] = useState<PracticeHand>(() => newHand(6, 100, 0, randomSeed()));
  const [advice, setAdvice] = useState<Advice>({ key: "", st: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Decision | null>(null);
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
  const spotKey = `${hand.seed}|${hand.shown}|${JSON.stringify(hand.lines)}|${mode}|${retry}`;

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
      if (h.result || phaseOf(h).kind !== "over") {
        setHand(h);
        return;
      }
      const result = finish(h);
      setHand({ ...h, result });
      setSession((s) => ({ ...s, hands: s.hands + 1, net: s.opts.preflopOnly ? s.net : Math.round((s.net + result.net) * 100) / 100 }));
      if (keeping.current.all) void keep({ ...h, result }, keeping.current.session);
    },
    [keep],
  );

  // the hand moves on: cards dealt, an opponent's move asked for, or your spot solved
  useEffect(() => {
    const ph = phaseOf(hand);
    if (ph.kind === "over") return;
    if (ph.kind === "deal") {
      const t = setTimeout(() => commit(dealNext(hand, ph.street)), pace);
      return () => clearTimeout(t);
    }
    const ac = new AbortController();
    let alive = true;
    if (ph.kind === "villain") {
      void (async () => {
        try {
          const client = await getSolver();
          if (!alive) return;
          const [mv] = await Promise.all([
            client.play(stateFor(hand), { seat: ph.seat, hole: hand.hands[ph.seat]!.join("") }, { mode, signal: ac.signal }),
            wait(pace),
          ]);
          if (alive) commit(withVillain(hand, villainMove(hand, mv.data)));
        } catch (e) {
          if (!alive) return;
          setError(`${seatLabel(ph.seat, hand.players)}'s move failed: ${message(e)}`);
        }
      })();
    } else {
      // (until its answer, an answer for another spot reads as loading: see `shown`)
      void (async () => {
        try {
          const client = await getSolver();
          if (!alive) return;
          const result = await client.solve({ state: stateFor(hand), mode, signal: ac.signal });
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
    // (spotKey covers the hand's action, its cards out, the mode and a retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotKey, getSolver, pace, commit]);

  useEffect(() => {
    if (session.hands || session.score.n) void putSession(toRecord(session)).catch(() => {});
  }, [session]);

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
    setSession(freshSession(players, stack, opts));
    setHand(newHand(players, stack, 0, randomSeed(), opts));
    setLast(null);
    setError(null);
  }, []);

  const nextHand = () => {
    setHand(newHand(session.players, session.stack, hand.n + 1, randomSeed(), session.opts));
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
    const g = r.decision.grade;
    if (g) setSession((s) => ({ ...s, score: addScore(s.score, g) }));
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
            preflop closes. Keys: 1&ndash;9 answer, Enter or Space for the next hand, K keeps it in Analyze.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModePicker modes={["quick", "accurate"]} />
          <SetupForm
            key={`${session.players}/${session.stack}/${session.opts.seat}/${session.opts.preflopOnly}`}
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
              i < hand.shown ? (
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
          </span>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {seatsOf(hand.players).map((p) => (
            <SeatView key={p} hand={hand} sim={sim} p={p} />
          ))}
        </ul>
      </section>

      <section aria-label="Your move" className="space-y-2 rounded-lg border border-border bg-surface p-3">
        {error && (
          <div role="alert" className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger">
            {error}{" "}
            {phase.kind === "villain" && (
              <button type="button" className="underline" onClick={() => (setError(null), setRetry((n) => n + 1))}>
                Try again
              </button>
            )}
          </div>
        )}
        {phase.kind === "villain" && !error && (
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
        {phase.kind === "over" && hand.result && (
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
            </p>
            <button ref={nextRef} type="button" onClick={nextHand} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
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

      {last && <DecisionView d={last} players={hand.players} />}

      <HandLog hand={hand} />

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
        Not here yet: the drill modes (single-raised, 3-bet and blind-vs-blind pots dealt again and again), the ring game&rsquo;s carried-over chips, sizes of
        your own, and multi-tabling. They run in the{" "}
        <a className="underline" href={`${CLASSIC_URL}practice/`}>
          classic trainer
        </a>
        .
      </p>

      {others.length > 0 && (
        <section aria-label="Past sessions" className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="font-medium">Past sessions</h2>
          <ul className="space-y-0.5">
            {others.map((s) => (
              <li key={s.id} className="text-muted">
                {new Date(s.startedAt).toLocaleString()} · {String(s.meta.hands ?? 0)} hands · {s.decisions} decisions
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

/** The finished hand kept in Analyze (graded there as an imported hand), or a button to keep it; and keeping
 * every hand. */
function KeepHand({ kept, all, onKeep, onAll }: { kept: Kept | null; all: boolean; onKeep: () => void; onAll: (all: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {kept?.st === "kept" ? (
        <p aria-live="polite">
          {kept.had ? "Already kept" : "Kept"} in Analyze ·{" "}
          <Link to={`/analyze?hand=${encodeURIComponent(kept.id)}`} className="underline">
            Open it there
          </Link>
        </p>
      ) : (
        <button
          type="button"
          disabled={kept?.st === "saving"}
          onClick={onKeep}
          className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50"
        >
          {kept?.st === "saving" ? "Keeping…" : "Keep in Analyze"}
        </button>
      )}
      {kept?.st === "error" && (
        <p role="alert" className="text-danger">
          Not kept: {kept.message}
        </p>
      )}
      <label className="flex items-center gap-1.5 text-muted">
        <input type="checkbox" checked={all} onChange={(e) => onAll(e.target.checked)} />
        Keep every hand
      </label>
    </div>
  );
}

/** "bet 33%" (to 1.8bb), "raise 2.5": the solver's name, with the size it plays where the name doesn't say it. */
export function optionLabel(name: string, amount: number | undefined): string {
  const k = kindOf(name);
  if ((k === "bet" || k === "raise") && typeof amount === "number" && !name.includes(fmt(amount))) return `${name} (${fmt(amount)}bb)`;
  return name;
}

function ScoreStrip({ session, acc, loss, lossPct }: { session: PracticeSession; acc: number; loss: number | null; lossPct: number | null }) {
  const s = session.score;
  const item = (label: string, value: string) => (
    <div className="rounded bg-surface-2 px-2 py-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
  return (
    <section aria-label="Score" className="flex flex-wrap gap-2 text-sm">
      {item("Hands", String(session.hands))}
      {item("Decisions graded", String(s.n))}
      {item("Best or correct", s.n ? pct(acc, 0) : "–")}
      {item("EV lost a decision", loss == null ? "–" : `${bb(loss)}bb · ${lossPct!.toFixed(1)}% pot`)}
      {item("Streak", `${s.streak} (best ${s.best})`)}
      {!session.opts.preflopOnly && item("Net", `${signed(session.net)}bb`)}
    </section>
  );
}

function SeatView({ hand, sim, p }: { hand: PracticeHand; sim: Sim; p: string }) {
  const t = setupOf(hand);
  const you = p === hand.hero;
  const folded = !sim.active.has(p);
  const cards = shownCards(hand, p, sim);
  const bet = sim.cur?.bets[p] ?? 0;
  const won = hand.result?.pays[p];
  const toAct = !hand.result && sim.toAct === p;
  return (
    <li
      aria-label={`${seatLabel(p, hand.players)}${you ? " (you)" : ""}`}
      aria-current={toAct ? "true" : undefined}
      className={`space-y-1 rounded-md border p-2 text-xs ${toAct ? "border-accent" : "border-border"} ${you ? "bg-surface-2" : ""} ${folded ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium">
          {seatLabel(p, hand.players)}
          {you && <span className="text-accent"> · you</span>}
        </span>
        <span className="font-mono text-muted">{fmt(behind(t, sim, p))}</span>
      </div>
      <div className="flex gap-0.5">
        {folded && !you ? (
          <span className="text-muted">folded</span>
        ) : (
          (cards ?? [null, null]).map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
        )}
      </div>
      <div className="h-4 font-mono">
        {won ? <span className="text-accent">won {fmt(won)}</span> : bet > 0 ? <span>bet {fmt(bet)}</span> : sim.allin.has(p) && !folded ? "all-in" : ""}
      </div>
    </li>
  );
}

/** Your moves where the spot has no answer: fold, check or call, the smallest bet or raise, all-in (not graded). */
function FallbackMoves({ hand, onMove }: { hand: PracticeHand; onMove: (a: { action: string; to?: number }) => void }) {
  const sim = simOf(hand);
  const lg = legal(setupOf(hand), sim);
  if (!lg) return null;
  const btn = (label: string, a: { action: string; to?: number }) => (
    <button key={label} type="button" onClick={() => onMove(a)} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 hover:bg-surface-3">
      {label}
    </button>
  );
  const facing = lg.toCall > 1e-9;
  return (
    <div role="group" aria-label="Moves without a grade" className="flex flex-wrap items-center gap-2">
      <span className="text-muted">Play on without a grade:</span>
      {facing && btn("fold", { action: "fold" })}
      {btn(facing ? `call ${fmt(lg.toCall)}` : "check", { action: facing ? "call" : "check" })}
      {lg.canRaise && lg.minTo < lg.allInTo && btn(`${facing || (sim.cur?.curBet ?? 0) > 0 ? "raise to" : "bet"} ${fmt(lg.minTo)}`, { action: "raise", to: lg.minTo })}
      {lg.canRaise && btn(`all-in ${fmt(lg.allInTo)}`, { action: "all-in" })}
    </div>
  );
}

function DecisionView({ d, players }: { d: Decision; players: number }) {
  const g = d.grade;
  return (
    <section aria-label="Last decision" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Your last decision</h2>
        {g ? <VerdictTag v={g.verdict} /> : <span className="text-xs text-muted">Not graded</span>}
        <span>
          {d.street}: you took <span className="font-mono">{d.chose}</span>
          {g && g.a !== g.best && d.mix[g.best] && (
            <>
              ; the solver&rsquo;s best was <span className="font-mono">{d.mix[g.best]!.action}</span>
            </>
          )}
        </span>
        {d.provenance && <ProvenanceBadge p={d.provenance} />}
      </div>
      {g && (
        <p className="text-muted">
          {g.byEv
            ? g.loss > 0
              ? `EV given up: ${bb(g.loss)}bb, ${g.lossPct.toFixed(1)}% of the ${fmt(d.pot)}bb pot.`
              : "No EV given up."
            : "Graded by how often the chart plays it: the preflop charts have no EVs."}
          {g.mixed && " This hand mixes actions here."}
        </p>
      )}
      {d.mix.length > 0 && (
        <table className="w-full max-w-md text-left font-mono text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-0.5 font-normal">Action</th>
              <th className="py-0.5 text-right font-normal">Played</th>
              <th className="py-0.5 text-right font-normal">EV bb</th>
            </tr>
          </thead>
          <tbody>
            {d.mix.map((a) => (
              <tr key={a.action} className={a.action === d.chose ? "text-accent" : ""}>
                <td className="py-0.5">
                  {optionLabel(a.action, a.amount)}
                  {a.action === d.chose && " ← you"}
                </td>
                <td className="py-0.5 text-right">{pct(a.freq)}</td>
                <td className="py-0.5 text-right">{bb(a.ev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">Your hand&rsquo;s frequencies and EVs at {players === 2 ? "this heads-up" : "this"} spot, from the answer named in the badge.</p>
      <Link to={`/study?${d.study}`} className="inline-block text-accent hover:underline">
        Open this spot in Study →
      </Link>
    </section>
  );
}

// each move said of another seat, and of you
const SAY: Record<string, [string, string]> = {
  fold: ["folds", "fold"],
  check: ["checks", "check"],
  call: ["calls", "call"],
  bet: ["bets", "bet"],
  raise: ["raises to", "raise to"],
  "all-in": ["goes all-in", "go all-in"],
};

function HandLog({ hand }: { hand: PracticeHand }) {
  const say = (m: Move) => {
    const you = m.pos === hand.hero;
    const verb = SAY[m.action]?.[you ? 1 : 0] ?? m.action;
    return `${you ? "You" : seatLabel(m.pos, hand.players)} ${verb}${m.to !== undefined ? ` ${fmt(m.to)}` : ""}`;
  };
  const out = [0, 3, 4, 5];
  const pre = hand.lines.preflop;
  const opened = pre.findIndex((m) => m.action !== "fold");
  // (preflop, the folds before anyone came in are left out; yours, and the one that ends the hand, are not)
  const keep = (m: Move, k: number) => m.action !== "fold" || m.pos === hand.hero || k === pre.length - 1 || (opened >= 0 && k > opened);
  const rows = STREETS.filter((_, i) => hand.shown >= out[i]!).map((st, i) => ({
    st,
    // (the street's own cards: the flop's three, then one each)
    cards: hand.board.slice(i <= 1 ? 0 : out[i - 1], out[i]).join(" "),
    moves: hand.lines[st].filter((m, k) => st !== "preflop" || keep(m, k)).map(say),
  }));
  return (
    <section aria-label="Hand history" className="rounded-lg border border-border bg-surface p-3 text-sm">
      <h2 className="mb-1 font-medium">This hand</h2>
      <ol className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.st}>
            <span className="text-muted">{r.st}</span>
            {r.cards && <span className="font-mono"> [{r.cards}]</span>}
            {r.moves.length ? `: ${r.moves.join(", ")}` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SetupForm({
  players,
  stack,
  opts,
  onStart,
}: {
  players: number;
  stack: number;
  opts: Required<HandOptions>;
  onStart: (players: number, stack: number, opts: Required<HandOptions>) => void;
}) {
  const [p, setP] = useState(players);
  const [s, setS] = useState(String(stack));
  const [seat, setSeat] = useState(opts.seat);
  const [pre, setPre] = useState(opts.preflopOnly);
  // (a seat the table size doesn't have moves)
  const seatOk = seat === "moves" || seat === "random" || seatsOf(p).includes(seat);
  const n = Number(s);
  const ok = Number.isFinite(n) && n >= MIN_STACK && n <= MAX_STACK;
  return (
    <form
      aria-label="New session"
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onStart(p, n, { seat: seatOk ? seat : "moves", preflopOnly: pre });
      }}
    >
      <label className="flex items-center gap-1">
        <span className="text-muted">Players</span>
        <select aria-label="Players" value={p} onChange={(e) => setP(Number(e.target.value))} className="rounded border border-border bg-surface-2 px-1.5 py-1">
          {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((x) => (
            <option key={x} value={x}>
              {x === 2 ? "Heads-up" : `${x}-max`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Stack</span>
        <input
          aria-label="Stack in big blinds"
          type="number"
          min={MIN_STACK}
          max={MAX_STACK}
          step={0.5}
          value={s}
          onChange={(e) => setS(e.target.value)}
          className="w-20 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">bb</span>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Your seat</span>
        <select aria-label="Your seat" value={seatOk ? seat : "moves"} onChange={(e) => setSeat(e.target.value)} className="rounded border border-border bg-surface-2 px-1.5 py-1">
          <option value="moves">Moves each hand</option>
          <option value="random">Random</option>
          {seatsOf(p).map((x) => (
            <option key={x} value={x}>
              {seatLabel(x, p)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Play</span>
        <select aria-label="Play" value={pre ? "preflop" : "full"} onChange={(e) => setPre(e.target.value === "preflop")} className="rounded border border-border bg-surface-2 px-1.5 py-1">
          <option value="full">Full hands</option>
          <option value="preflop">Preflop only</option>
        </select>
      </label>
      <button type="submit" disabled={!ok} className="rounded border border-border px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40">
        New session
      </button>
    </form>
  );
}
