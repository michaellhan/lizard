// Review, the one page of what to work on: your mistakes kept across sessions, what's due to retry on a spaced schedule
// (schedule.ts), the retry itself, the list of them, and the plan past them (features/plan: the leaks, a Practice drill,
// the 12 lessons). A retry asks the spot again, shows the options without the mix, and grades your pick as the
// decision was graded, against the answer there is now and under that answer's own provenance. Where that isn't the kind
// of answer the first grade stood on, the page says so and doesn't set the two side by side (mistakes.ts answerChange).
// A decision from Analyze is retried against the answer kept with it, with no solve. All of it is kept in this browser,
// and goes in the backup; an entry can be deleted, after a second press, as on the Saved page.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { DeleteButton } from "@/components/DeleteButton";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceDetail } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import type { MistakeRecord } from "@/data/db";
import { changeMistake, deleteMistake, listMistakes } from "@/data/mistakes";
import { STREET_ORDER } from "@/features/history/progress";
import { Lessons } from "@/features/plan/LessonsPanel";
import { PlanSteps, StartHere, usePlan } from "@/features/plan/PlanPage";
import { profileName } from "@/features/practice/exploit";
import { HandStory } from "@/features/practice/HandStory";
import { Kbd } from "@/features/practice/HintReveal";
import { isNextKey } from "@/features/practice/keys";
import { DecisionView, optionLabel, useHandKeys } from "@/features/practice/PracticeParts";
import { CAPPED_WORDS } from "@/grading/grade";
import { seatLabel } from "@/poker/seats";
import { evUnit, sourceLabel } from "@/solver/provenance";
import type { LibraryFiles } from "@/library/files";
import type { Provenance } from "@/solver/types";
import { useSolver } from "@/solver/useSolver";
import { SolverError } from "@/solver/types";
import { Compare } from "./Compare";
import { costWords, KEPT_RETRY_WORDS, ORIGIN_WORDS, retried, spotWords, withTry, type RetryAnswer, type Retried } from "./mistakes";
import { askAgain } from "./retry";
import { retryStory } from "./retryStory";
import { dueQueue, dueWords, isDue } from "./schedule";

/** the mistakes listed at a time */
export const LIST_PAGE = 30;

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const bbOf = (x: number) => String(Math.round(x * 100) / 100);
const many = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isStreet = (x: string | null): x is (typeof STREET_ORDER)[number] => STREET_ORDER.includes(x as (typeof STREET_ORDER)[number]);

type Loaded = { list: MistakeRecord[]; damaged: number; now: number };

export function ReviewPage({ files }: { files?: LibraryFiles } = {}) {
  const { plan, failed: planFailed } = usePlan(files);
  const [data, setData] = useState<Loaded | null>(null);
  const [n, setN] = useState(0);
  const [params, setParams] = useSearchParams();
  const street = isStreet(params.get("street")) ? params.get("street") : null;
  // the mistake being retried (as it stood when opened, so its result stays up as the lists move), and those retried or
  // passed over this visit, so Next moves on
  const [current, setCurrent] = useState<MistakeRecord | null>(null);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [shown, setShown] = useState(LIST_PAGE);
  const [shownT, setShownT] = useState(LIST_PAGE);
  const [shownX, setShownX] = useState(LIST_PAGE);

  // the link to the next due (?retry=next, as the plan's step had it): the first due opens as it's read, as Retry the next one would, and the link goes from the address
  const opener = useRef<HTMLElement | null>(null);
  const retryNext = useRef(params.get("retry") === "next");
  const openAsked = (list: readonly MistakeRecord[], now: number) => {
    if (!retryNext.current) return;
    retryNext.current = false;
    const first = dueQueue(list, now)[0];
    if (first) {
      opener.current = document.body;
      setCurrent(first);
    }
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        q.delete("retry");
        return q;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    let alive = true;
    void listMistakes()
      .then((d) => {
        if (!alive) return;
        const at = Date.now();
        setData({ ...d, now: at });
        openAsked(d.list, at);
      })
      .catch(() => alive && setData({ list: [], damaged: 0, now: Date.now() }));
    return () => {
      alive = false;
    };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setN((x) => x + 1), []);
  const list = useMemo(() => data?.list ?? [], [data]);
  const now = data?.now ?? 0;
  const queue = useMemo(() => dueQueue(list, now), [list, now]);
  const next = queue.find((m) => m.id !== current?.id && !passed.has(m.id)) ?? null;
  // (opener: what opened the retry. Close gives the keyboard back to it, or, gone from the list, to the page's heading)
  const open = (m: MistakeRecord | null) => {
    if (current) setPassed((s) => new Set(s).add(current.id));
    if (m && !current && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
    setCurrent(m);
  };
  useEffect(() => {
    if (current || !opener.current) return;
    const was = opener.current;
    opener.current = null;
    const heading = was.isConnected && was !== document.body ? null : document.querySelector<HTMLElement>("main h1");
    heading?.setAttribute("tabindex", "-1");
    (heading ?? was).focus();
  }, [current]);

  // (an entry deleted: said at once, and the keyboard goes to the row that takes its place once it's gone, as on Saved)
  const [said, setSaid] = useState("");
  const place = useRef<{ row: Element; list: Element; at: number } | null>(null);
  const remove = (m: MistakeRecord, from: HTMLElement) => {
    const row = from.closest("li");
    if (row?.parentElement) place.current = { row, list: row.parentElement, at: [...row.parentElement.children].indexOf(row) };
    if (current?.id === m.id) setCurrent(null);
    deleteMistake(m.id).then(
      (ok) => {
        if (!ok) place.current = null;
        setSaid(ok ? "Entry deleted." : "Not deleted: this browser keeps nothing here.");
        reload();
      },
      () => {
        place.current = null;
        setSaid("Not deleted: this browser wouldn't change what's kept.");
      },
    );
  };
  useEffect(() => {
    if (!place.current || place.current.row.isConnected) return;
    const { list, at } = place.current;
    place.current = null;
    const to = (list.isConnected ? (list.children[at] ?? list.lastElementChild) : null) ?? document.querySelector("main h1");
    to?.setAttribute("tabindex", "-1");
    (to as HTMLElement | null)?.focus();
  });

  const setStreet = (v: string) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (isStreet(v)) q.set("street", v);
        else q.delete("street");
        return q;
      },
      { replace: true },
    );

  // (a tournament's EVs aren't bb won, so its mistakes have a list and a tally of their own; the queue is dates, and takes both)
  // (and an exploit session's are against a best response to an assumed profile, which is never an equilibrium's EV)
  const cash = useMemo(() => list.filter((m) => !m.tournament && !m.exploit), [list]);
  const tourney = useMemo(() => list.filter((m) => m.tournament), [list]);
  const exploited = useMemo(() => list.filter((m) => m.exploit), [list]);
  const onStreet = (ms: MistakeRecord[]) => (street ? ms.filter((m) => m.street === street) : ms);

  const listSection = (label: string, ms: MistakeRecord[], count: number, more: () => void, note?: string, filter?: ReactNode) =>
    ms.length > 0 && (
      <section aria-label={label} className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">{label}</h2>
          {filter}
        </div>
        {!onStreet(ms).length && <p className="text-sm text-muted">None on the {street}.</p>}
        <Rows ms={onStreet(ms).slice(0, count)} now={now} current={current} onOpen={open} onDelete={remove} note={note} />
        {onStreet(ms).length > count && (
          <button type="button" onClick={more} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
            Show {Math.min(LIST_PAGE, onStreet(ms).length - count)} more of {onStreet(ms).length - count}
          </button>
        )}
      </section>
    );

  // (wide: the retry and your mistakes on the left, what to work on past them, the plan and the lessons, in a column on
  // the right; narrow, the retry, then that column, as it's short and says what to do, then the lists)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <h1 className="text-2xl font-semibold">Review</h1>
        {data && list.length > 0 && <Queue list={list} queue={queue} now={now} current={current} next={next} onOpen={open} />}
      </div>
      <p role="status" className="sr-only">
        {said}
      </p>

      {data == null ? (
        <p className="text-sm text-muted">Reading what&rsquo;s kept here…</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
          {current && (
            <div className="min-w-0 xl:col-start-1 xl:row-start-1">
              <RetryPanel key={current.id} m={current} next={next} onChanged={reload} onOpen={open} />
            </div>
          )}
          <aside aria-label="What to work on" className={`space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0 xl:block xl:space-y-4 xl:col-start-2 xl:row-start-1 ${current ? "xl:row-span-2" : ""}`}>
            {/* (with nothing kept, the plan's first step says where to start; the line says it once the plan has nothing to add) */}
            {list.length === 0 &&
              (plan?.first ? (
                <StartHere first={plan.first} />
              ) : (
                (plan || planFailed) && (
                  <p className="text-sm text-muted">
                    No mistakes yet. Misses from <Link to="/practice" className="underline">Practice</Link> and <Link to="/analyze" className="underline">Analyze</Link> land here.
                  </p>
                )
              ))}
            {plan && <PlanSteps plan={plan} />}
            {planFailed && (
              <p role="alert" className="text-sm text-danger">
                Couldn&rsquo;t read the hands kept here, so there&rsquo;s no drill or leak to suggest.
              </p>
            )}
            <Lessons />
          </aside>
          <div className={`min-w-0 space-y-6 xl:col-start-1 ${current ? "xl:row-start-2" : "xl:row-start-1"}`}>
            {data.damaged > 0 && (
              <p role="status" className="text-sm text-warn">
                {many(data.damaged, "record")} kept here couldn&rsquo;t be read, and {data.damaged === 1 ? "is" : "are"} left out.
              </p>
            )}
            {listSection(
              "Past mistakes",
              cash,
              shown,
              () => setShown((x) => x + LIST_PAGE),
              undefined,
              <label className="text-sm">
                <span className="sr-only">Show</span>
                <select aria-label="Street" value={street ?? ""} onChange={(e) => setStreet(e.target.value)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
                  <option value="">Every street ({cash.length})</option>
                  {STREET_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {s} ({cash.filter((m) => m.street === s).length})
                    </option>
                  ))}
                </select>
              </label>,
            )}
            {listSection("Exploit mistakes", exploited, shownX, () => setShownX((x) => x + LIST_PAGE), "An assumed profile, not equilibrium")}
            {listSection("Tournament mistakes", tourney, shownT, () => setShownT((x) => x + LIST_PAGE), "EV in prize-equity chips, not bb")}
          </div>
        </div>
      )}
    </div>
  );
}

/** What's due, and what comes next, on the heading's line. */
function Queue({ list, queue, now, current, next, onOpen }: { list: MistakeRecord[]; queue: MistakeRecord[]; now: number; current: MistakeRecord | null; next: MistakeRecord | null; onOpen: (m: MistakeRecord) => void }) {
  const soon = list.filter((m) => m.due !== null && !isDue(m, now)).sort((a, b) => a.due! - b.due!)[0];
  return (
    <section aria-label="Review queue" className="flex flex-wrap items-center gap-3 text-sm">
      {queue.length > 0 ? (
        <>
          <h2 className="font-medium">
            Due now <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 tabular-nums">{queue.length}</span>
          </h2>
          {next && !current && (
            <button type="button" onClick={() => onOpen(next)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong">
              Retry the next one
            </button>
          )}
        </>
      ) : (
        <p className="text-muted">Nothing is due today.{soon ? ` The next: ${dueWords(soon, now).toLowerCase()}.` : ""}</p>
      )}
    </section>
  );
}

/** The mistake lists' columns, wide: the spot, your move with its grade and cost, when it's next due, and what you can
 * do; set once on a list, every row takes them (a subgrid), so they line up down the list as History's sessions do.
 * Narrow, a row is the spot on a line and the rest under it. */
const COLS = "lg:grid lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:gap-x-5";
const ROW = "lg:col-span-full lg:grid lg:grid-cols-subgrid";

/** A list of kept mistakes under one caption saying what graded them and in what game: what most of them share, said
 * once, and a row that differs saying its own. `note`: what the whole list is graded in, after it. */
function Rows({ ms, now, current, onOpen, onDelete, note }: { ms: MistakeRecord[]; now: number; current: MistakeRecord | null; onOpen: (m: MistakeRecord) => void; onDelete: (m: MistakeRecord, from: HTMLElement) => void; note?: string }) {
  const common = commonSource(ms);
  const others = ms.some((m) => gradedSource(m) !== common);
  const game = commonOf(ms.map((m) => m.game));
  return (
    <>
      {common !== null && (
        <p className="text-xs text-muted">
          {game && ms.length > 1 && <span>{ms.every((m) => m.game === game) ? `${game} · ` : `Mostly ${game} · `}</span>}
          <span>
            Graded against {common}
            {others ? ", unless a row says otherwise" : ""}
            .{note ? ` ${note}.` : ""}
          </span>
        </p>
      )}
      {ms.length > 0 && (
        <div className={`panel px-3 ${COLS}`}>
          <div aria-hidden className={`hidden border-b border-border py-1.5 text-xs text-muted ${ROW}`}>
            <span>Spot</span>
            <span>You took</span>
            <span>Next</span>
            <span />
          </div>
          <ul className={`divide-y divide-border/60 ${ROW}`}>
            {ms.map((m) => (
              <MistakeRow key={m.id} m={m} now={now} common={common} game={ms.length > 1 ? game : null} active={current?.id === m.id} onRetry={() => onOpen(m)} onDelete={(from) => onDelete(m, from)} />
            ))}
          </ul>
        </div>
      )}
      <ProvenanceDetail ps={ms.flatMap((m) => m.provenance ?? [])} label="How these answers were produced" />
    </>
  );
}

/** The value most of a list shares (the first where tied); null with none. */
function commonOf(xs: readonly string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, c] of n) if (best === null || c > n.get(best)!) best = k;
  return best;
}

function Spot({ m }: { m: Pick<MistakeRecord, "hole" | "board" | "players" | "seat"> }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="w-8 text-xs font-medium">{seatLabel(m.seat, m.players)}</span>
      <span className="flex gap-0.5">
        {m.hole.map((c) => (
          <PlayingCard key={c} card={c} size="sm" />
        ))}
      </span>
      {m.board.length > 0 ? (
        <>
          <span className="text-muted">on</span>
          <span className="flex gap-0.5">
            {m.board.map((c) => (
              <PlayingCard key={c} card={c} size="sm" />
            ))}
          </span>
        </>
      ) : (
        <span className="text-xs text-muted">preflop</span>
      )}
    </span>
  );
}

/** What graded a mistake, in short: the source's name (≈ where approximate; the charts and rules say they aren't a solve).
 * The list's "How these answers were produced" holds each answer's whole label. */
export function gradedSource(m: Pick<MistakeRecord, "provenance">): string {
  const p: Provenance | undefined = m.provenance ?? undefined;
  const name = !p ? "an answer not kept" : p.source === "charts" ? "Preflop charts (not a solve)" : p.source === "live" && p.mode === "quick" ? `${sourceLabel("live")} (Quick)` : sourceLabel(p.source);
  return `${p?.approximate ? "\u2248 " : ""}${name}`;
}

/** The source most of a list's mistakes were graded against (the first listed where tied); null with none. */
export function commonSource(ms: readonly Pick<MistakeRecord, "provenance">[]): string | null {
  return commonOf(ms.map(gradedSource));
}

function MistakeRow({ m, now, common, game, active, onRetry, onDelete }: { m: MistakeRecord; now: number; common: string | null; game: string | null; active: boolean; onRetry: () => void; onDelete: (from: HTMLElement) => void }) {
  const last = m.tries.at(-1);
  const source = gradedSource(m);
  const due = isDue(m, now);
  // (under the spot: the action before you, and only what isn't the list's own: its game, what graded it, where it came from)
  const about = [
    m.line,
    m.exploit ? `Exploiting ${profileName(m.exploit)} (assumed)` : "",
    ORIGIN_WORDS[m.from] ?? "",
    m.game !== game ? m.game : "",
    source !== common ? `graded against ${source}` : "",
    m.times > 1 ? `missed ${m.times} times` : "",
  ].filter(Boolean);
  return (
    <li tabIndex={-1} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm outline-none ${ROW} ${active ? "-mx-3 border-l-2 border-accent bg-surface-2 px-3" : ""}`}>
      <span className="min-w-0 basis-full space-y-0.5 lg:basis-auto">
        <Spot m={m} />
        <span className="block text-xs text-muted">{about.join(" · ")}</span>
        {last && (
          <span className="block text-xs text-muted">
            Last retry {day(last.at)}: {last.verdict}
            {last.like ? "" : `, against ${last.label}`}
          </span>
        )}
        {m.grade.capped && <span className="block text-xs text-muted">{CAPPED_WORDS}</span>}
      </span>
      <span className="space-y-0.5">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="font-mono">{m.chose}</span>
          <VerdictTag v={m.grade.verdict} />
        </span>
        <span className="block whitespace-nowrap text-xs tabular-nums text-muted">{costWords(m.grade, m.mix, m.provenance?.source, evUnit(m.provenance))}</span>
      </span>
      {/* (a row that's due says no date: its Retry button is the one lit) */}
      <span className="whitespace-nowrap text-xs text-muted">{due ? "" : dueWords(m, now)}</span>
      <span className="flex basis-full flex-wrap items-center gap-2 text-xs lg:basis-auto lg:flex-nowrap lg:justify-end">
        <button type="button" onClick={onRetry} aria-label={`${due ? "Retry" : "Retry early"}: ${m.hole.join(" ")}, ${m.street}`} className={`rounded-md px-2.5 py-1 font-medium ${due ? "bg-accent text-bg hover:bg-accent-strong" : "border border-border hover:bg-surface-2"}`}>
          {due ? "Retry" : "Retry early"}
        </button>
        {m.study ? (
          <Link to={`/study?${m.study}`} aria-label="Open in Study" className="whitespace-nowrap rounded px-1.5 py-1 text-accent hover:bg-surface-2">
            Study
          </Link>
        ) : (
          <span className="text-muted">Study can&rsquo;t set up this game</span>
        )}
        {m.ask.via === "kept" && (
          <Link to={`/analyze?${new URLSearchParams({ hand: m.ask.hand })}`} aria-label="Open the hand" className="whitespace-nowrap rounded px-1.5 py-1 text-accent hover:bg-surface-2">
            Hand
          </Link>
        )}
        <DeleteButton what="this entry" name={`Delete: ${m.hole.join(" ")}, ${m.street}`} onDelete={onDelete} />
      </span>
    </li>
  );
}

type Asked = { st: "asking" } | { st: "ready"; answer: RetryAnswer } | { st: "failed"; message: string };

/** One spot asked again: your options, then the grade. `next`: what's up after it. `onChanged`: a retry has been kept. */
function RetryPanel({ m, next, onChanged, onOpen }: { m: MistakeRecord; next: MistakeRecord | null; onChanged: () => void; onOpen: (m: MistakeRecord | null) => void }) {
  const getSolver = useSolver();
  const [asked, setAsked] = useState<Asked>({ st: "asking" });
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<Retried | null>(null);
  // undefined: being kept; null: this browser keeps nothing
  const [kept, setKept] = useState<MistakeRecord | null | undefined>(undefined);
  const box = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    let alive = true;
    const stop = new AbortController();
    askAgain(m, getSolver, stop.signal).then(
      (answer) => alive && setAsked({ st: "ready", answer }),
      (e: unknown) => {
        if (alive && !(e instanceof SolverError && e.kind === "cancelled")) setAsked({ st: "failed", message: message(e) });
      },
    );
    return () => {
      alive = false;
      stop.abort();
    };
  }, [m, attempt, getSolver]);

  const pick = (i: number) => {
    if (asked.st !== "ready" || done) return;
    const r = retried(m, asked.answer, i, Date.now());
    setDone(r);
    changeMistake(m.id, (x) => withTry(x, r.tried)).then(
      (x) => {
        setKept(x ?? null);
        onChanged();
      },
      () => setKept(null),
    );
  };

  const options = asked.st === "ready" ? asked.answer.mix : [];
  const finished = Boolean(done) || asked.st === "failed";
  useHandKeys((asked.st === "ready" && !done) || finished, (e, tag) => {
    if (!done && /^[1-9]$/.test(e.key) && Number(e.key) <= options.length) pick(Number(e.key) - 1);
    // (Enter or Space on a focused button or link is that control's own)
    else if (finished && isNextKey(e.key) && (e.key.toLowerCase() === "n" || !/^(BUTTON|A)$/.test(tag))) {
      e.preventDefault();
      onOpen(next);
    }
  });
  useEffect(() => {
    if (done) nextRef.current?.focus({ preventScroll: true });
  }, [done]);
  const story = useMemo(() => retryStory(m), [m]);

  const nextButton = (
    <div className="flex flex-wrap items-center gap-3">
      <button ref={nextRef} type="button" onClick={() => onOpen(next)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
        {next ? "Next one due" : "Done"}
        <Kbd>N</Kbd>
      </button>
      {!done && m.study && (
        <Link to={`/study?${m.study}`} className="text-accent hover:underline">
          Open in Study →
        </Link>
      )}
    </div>
  );

  // (wide: the hand on the left, the grade on the right once you've picked, as Practice's drills have it)
  return (
    <section ref={box} tabIndex={-1} aria-label="Retry" className="space-y-4 outline-none lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <div className="space-y-3 panel p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Retry</h2>
          <span className="text-muted">
            {m.street} · missed {day(m.lastAt)} · {m.tournament ? "Tournament · " : ""}
            {m.exploit ? `Exploiting ${profileName(m.exploit)} (assumed) · ` : ""}
            {m.game}
          </span>
          <span className="flex-1" />
          <button type="button" onClick={() => onOpen(null)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
            Close
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {m.board.length > 0 && (
            <div role="group" aria-label="Board" className="flex items-center gap-1">
              {m.board.map((c) => (
                <PlayingCard key={c} card={c} />
              ))}
            </div>
          )}
          {story && (
            <span className="text-xs text-muted">
              pot <span className="text-sm font-medium tabular-nums text-text">{bbOf(story.now.pot)}bb</span>
            </span>
          )}
          <div role="group" aria-label="Your cards" className="flex items-center gap-1">
            <span className="text-xs text-muted">{seatLabel(m.seat, m.players)} · you</span>
            {m.hole.map((c) => (
              <PlayingCard key={c} card={c} />
            ))}
          </div>
        </div>
        {story ? (
          <HandStory story={story} bare />
        ) : (
          <p>
            <span className="text-muted">{spotWords(m)}</span>
            {m.pot > 0 ? ` · pot ${m.pot.toFixed(2).replace(/\.?0+$/, "")}bb` : ""}
          </p>
        )}
        {m.ask.via === "kept" && <p className="text-xs text-muted">{KEPT_RETRY_WORDS}</p>}

        {asked.st === "asking" && (
          <p role="status" className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            {m.ask.via === "kept" ? "Reading the answer kept with it…" : m.ask.via === "library" ? "Reading the library…" : "Asking the solver…"}
            {m.ask.via !== "kept" && <span className="text-muted">(can take a while)</span>}
          </p>
        )}
        {asked.st === "failed" && (
          <div role="alert" className="space-y-1 text-danger">
            <p>
              No answer to grade this spot against: {asked.message}. Nothing has changed on its schedule.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setAsked({ st: "asking" });
                  setAttempt((x) => x + 1);
                }}
              >
                Ask again
              </button>
            </p>
          </div>
        )}
        {asked.st === "ready" && (
          <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
            {options.map((a, i) => (
              <button
                key={a.action}
                type="button"
                disabled={Boolean(done)}
                aria-pressed={done ? done.tried.chose === a.action : undefined}
                onClick={() => pick(i)}
                className={`rounded-md border px-3 py-1.5 hover:bg-surface-3 disabled:cursor-default ${done?.tried.chose === a.action ? "border-accent bg-surface-3" : "border-border bg-surface-2"}`}
              >
                {i < 9 && (
                  <span aria-hidden className="mr-1.5 text-xs text-faint">
                    {i + 1}
                  </span>
                )}
                {optionLabel(a.action, a.amount)}
                {/* (the price of a call, said on Call, not in the line above) */}
                {a.action === "call" && story && story.now.toCall > 0 && <>{" "}<span className="text-muted">{bbOf(story.now.toCall)}bb</span></>}
              </button>
            ))}
          </div>
        )}
        {asked.st === "failed" && nextButton}
      </div>

      {done && (
        <DecisionView d={done.decision} players={m.players} title="This retry">
          <Compare m={m} r={done} />
          {done.grade.capped && <p className="text-muted">{CAPPED_WORDS}</p>}
          <Moved kept={kept} now={done.tried.at} />
          {nextButton}
        </DecisionView>
      )}
    </section>
  );
}

/** What the retry did to the schedule. */
function Moved({ kept, now }: { kept: MistakeRecord | null | undefined; now: number }) {
  if (kept === undefined) return <p className="text-muted">Keeping the result…</p>;
  if (kept === null)
    return (
      <p role="alert" className="text-danger">
        This retry wasn&rsquo;t kept: this browser isn&rsquo;t keeping anything here (a private window?), or the record has gone.
      </p>
    );
  const t = kept.tries.at(-1);
  const when = dueWords(kept, now).toLowerCase();
  return (
    <p role="status" className="text-muted">
      {!t?.moved ? `Before its day, so its date doesn't move: ${when}.` : kept.due === null ? "That was its last step: it's finished." : t.ok ? `One step on: ${when}.` : `One step back: ${when}.`}
    </p>
  );
}
