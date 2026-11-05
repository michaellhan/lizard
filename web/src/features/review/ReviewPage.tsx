// Review: your mistakes kept across sessions, what's due to retry on a spaced schedule (schedule.ts), the retry itself,
// and the list of them. A retry asks the spot again, shows the options without the mix, and grades your pick as the
// decision was graded, against the answer there is now and under that answer's own provenance. Where that isn't the kind
// of answer the first grade stood on, the page says so and doesn't set the two side by side (mistakes.ts answerChange).
// All of it is kept in this browser, and goes in the backup.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import type { MistakeRecord } from "@/data/db";
import { changeMistake, listMistakes } from "@/data/mistakes";
import { STREET_ORDER, shareText } from "@/features/history/progress";
import { DecisionView, optionLabel, useHandKeys } from "@/features/practice/PracticeParts";
import { ModePicker } from "@/features/study/ModePicker";
import { versionOf, versionWords } from "@/grading/version";
import { seatLabel } from "@/poker/seats";
import { useSolver } from "@/solver/useSolver";
import { SolverError } from "@/solver/types";
import { Compare } from "./Compare";
import { costWords, retried, spotWords, withTry, type RetryAnswer, type Retried } from "./mistakes";
import { askAgain } from "./retry";
import { dueQueue, dueWords, isDue, SCHEDULE_WORDS } from "./schedule";

/** the mistakes listed at a time */
export const LIST_PAGE = 30;

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const many = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isStreet = (x: string | null): x is (typeof STREET_ORDER)[number] => STREET_ORDER.includes(x as (typeof STREET_ORDER)[number]);

type Loaded = { list: MistakeRecord[]; damaged: number; now: number };

export function ReviewPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [n, setN] = useState(0);
  const [params, setParams] = useSearchParams();
  const street = isStreet(params.get("street")) ? params.get("street") : null;
  // the mistake being retried (as it stood when opened, so its result stays up as the lists move), and those retried or
  // passed over this visit, so Next moves on
  const [current, setCurrent] = useState<MistakeRecord | null>(null);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [shown, setShown] = useState(LIST_PAGE);

  useEffect(() => {
    let alive = true;
    void listMistakes()
      .then((d) => alive && setData({ ...d, now: Date.now() }))
      .catch(() => alive && setData({ list: [], damaged: 0, now: Date.now() }));
    return () => {
      alive = false;
    };
  }, [n]);

  const reload = useCallback(() => setN((x) => x + 1), []);
  const list = useMemo(() => data?.list ?? [], [data]);
  const now = data?.now ?? 0;
  const queue = useMemo(() => dueQueue(list, now), [list, now]);
  const next = queue.find((m) => m.id !== current?.id && !passed.has(m.id)) ?? null;
  const open = (m: MistakeRecord | null) => {
    if (current) setPassed((s) => new Set(s).add(current.id));
    setCurrent(m);
  };
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

  const listed = street ? list.filter((m) => m.street === street) : list;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-sm text-muted">
          The decisions you got wrong in <Link to="/practice" className="underline">Practice</Link>, its full hands and its drills: every Inaccuracy, Mistake and Blunder, one entry a spot, across
          sessions. They&rsquo;re kept in this browser with no account, and they go in your <Link to="/saved" className="underline">backup</Link>. Your numbers by street and over time are in{" "}
          <Link to="/history" className="underline">History</Link>.
        </p>
      </div>

      <section aria-label="How the queue works" className="rounded-lg border border-border bg-surface p-3 text-sm">
        <h2 className="font-medium">How the queue works</h2>
        <p className="text-muted">{SCHEDULE_WORDS}</p>
      </section>

      {current && <RetryPanel key={current.id} m={current} next={next} onChanged={reload} onOpen={open} />}

      {data == null ? (
        <p className="text-sm text-muted">Reading what&rsquo;s kept here…</p>
      ) : (
        <>
          {data.damaged > 0 && (
            <p role="status" className="text-sm text-warn">
              {many(data.damaged, "record")} kept here couldn&rsquo;t be read, and {data.damaged === 1 ? "is" : "are"} left out.
            </p>
          )}
          {!list.length ? (
            <p className="text-sm text-muted">
              No mistake kept yet. Play hands or drills in <Link to="/practice" className="underline">Practice</Link>: anything graded below Correct comes here, and is due the next day.
            </p>
          ) : (
            <>
              <Queue list={list} queue={queue} now={now} current={current} next={next} onOpen={open} />
              <section aria-label="Past mistakes" className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">Past mistakes</h2>
                  <label className="text-sm">
                    <span className="text-muted">Show</span>{" "}
                    <select aria-label="Street" value={street ?? ""} onChange={(e) => setStreet(e.target.value)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
                      <option value="">Every street ({list.length})</option>
                      {STREET_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {s} ({list.filter((m) => m.street === s).length})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Tally list={listed} />
                {!listed.length && <p className="text-sm text-muted">None on the {street}.</p>}
                <ul className="space-y-2">
                  {listed.slice(0, shown).map((m) => (
                    <MistakeRow key={m.id} m={m} now={now} active={current?.id === m.id} onRetry={() => open(m)} />
                  ))}
                </ul>
                {listed.length > shown && (
                  <button type="button" onClick={() => setShown((x) => x + LIST_PAGE)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
                    Show {Math.min(LIST_PAGE, listed.length - shown)} more of {listed.length - shown}
                  </button>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** What's due, and what comes next. */
function Queue({ list, queue, now, current, next, onOpen }: { list: MistakeRecord[]; queue: MistakeRecord[]; now: number; current: MistakeRecord | null; next: MistakeRecord | null; onOpen: (m: MistakeRecord) => void }) {
  const soon = list.filter((m) => m.due !== null && !isDue(m, now)).sort((a, b) => a.due! - b.due!)[0];
  return (
    <section aria-label="Review queue" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Due now</h2>
        <span className="font-mono">{queue.length}</span>
        {next && !current && (
          <button type="button" onClick={() => onOpen(next)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong">
            Retry the next one
          </button>
        )}
        {list.some((m) => m.ask.via === "solver") && <ModePicker modes={["quick", "accurate"]} />}
      </div>
      {!queue.length && <p className="text-muted">Nothing is due today.{soon ? ` The next: ${dueWords(soon, now).toLowerCase()}.` : ""}</p>}
      <p className="text-xs text-muted">The longest overdue come first, then the worst grades. {list.some((m) => m.ask.via === "solver") ? "A full hand\u2019s spot is asked of the solver at the mode above; a drill\u2019s is read from the library." : "A drill\u2019s spot is read from the library, with no solve."}</p>
    </section>
  );
}

/** The kept mistakes in numbers, each count with what it is. */
function Tally({ list }: { list: MistakeRecord[] }) {
  const byEv = list.filter((m) => m.grade.byEv).length;
  const tries = list.flatMap((m) => m.tries);
  const ok = tries.filter((t) => t.ok).length;
  const unlike = tries.filter((t) => !t.like).length;
  const done = list.filter((m) => m.due === null).length;
  return (
    <p className="text-xs text-muted">
      {many(list.length, "spot")}: {byEv} graded by EV, {list.length - byEv} by frequency with no EV (the preflop charts and stored turns keep none). {done} finished.{" "}
      {tries.length ? `Over the last retries kept, ${shareText(ok, tries.length)} Best or Correct${unlike ? `, ${unlike} of them against another kind of answer than the first` : ""}.` : "No retries yet."}
    </p>
  );
}

function Spot({ m }: { m: Pick<MistakeRecord, "hole" | "board" | "players" | "seat"> }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span>{seatLabel(m.seat, m.players)}</span>
      <span className="flex gap-0.5">
        {m.hole.map((c) => (
          <PlayingCard key={c} card={c} size="sm" />
        ))}
      </span>
      {m.board.length > 0 && (
        <>
          <span className="text-muted">on</span>
          <span className="flex gap-0.5">
            {m.board.map((c) => (
              <PlayingCard key={c} card={c} size="sm" />
            ))}
          </span>
        </>
      )}
    </span>
  );
}

function MistakeRow({ m, now, active, onRetry }: { m: MistakeRecord; now: number; active: boolean; onRetry: () => void }) {
  const last = m.tries.at(-1);
  return (
    <li className={`space-y-1 rounded-lg border bg-surface p-2 text-sm ${active ? "border-accent" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-muted">
          {day(m.lastAt)} · {m.street}
        </span>
        <Spot m={m} />
        <span>
          you took <span className="font-mono">{m.chose}</span>
        </span>
        <VerdictTag v={m.grade.verdict} />
        <span className="font-mono text-xs">{costWords(m.grade, m.mix, m.provenance?.source)}</span>
      </div>
      <p className="text-xs text-muted">
        {m.game} · {m.line}
        {m.times > 1 ? ` · missed ${m.times} times in play` : ""}
      </p>
      <p className="text-xs text-muted">
        Graded against {m.provenance ? <ProvenanceBadge p={m.provenance} /> : "an answer not kept"}
        {` · version ${versionWords(versionOf(m.provenance))}`}
        {last ? ` · last retry ${day(last.at)}: ${last.verdict}, against ${last.label}, version ${versionWords(last.version)}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span>{dueWords(m, now)}</span>
        <button type="button" onClick={onRetry} aria-label={`${isDue(m, now) ? "Retry" : "Retry early"}: ${m.hole.join(" ")}, ${m.street}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          {isDue(m, now) ? "Retry" : "Retry early"}
        </button>
        {m.study ? (
          <Link to={`/study?${m.study}`} className="text-accent hover:underline">
            Open in Study →
          </Link>
        ) : (
          <span className="text-muted">Study can&rsquo;t set up this game</span>
        )}
      </div>
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
  useHandKeys(asked.st === "ready" && !done, (e) => {
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= options.length) pick(Number(e.key) - 1);
  });
  useEffect(() => {
    if (done) nextRef.current?.focus({ preventScroll: true });
  }, [done]);

  return (
    <section ref={box} tabIndex={-1} aria-label="Retry" className="space-y-3 rounded-lg border border-accent bg-surface p-3 text-sm outline-none">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Retry</h2>
        <span className="text-muted">
          {m.street} · missed {day(m.lastAt)}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => onOpen(null)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Close
        </button>
      </div>
      <Spot m={m} />
      <p>
        {m.game} · pot {m.pot.toFixed(2).replace(/\.?0+$/, "")}bb
      </p>
      <p className="text-muted">{spotWords(m)}</p>

      {asked.st === "asking" && (
        <p role="status" className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          {m.ask.via === "library" ? "Reading the library…" : "Asking the solver…"}
          <span className="text-muted">(a live solve can take a while; the first answer starts the engine)</span>
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
      {asked.st === "ready" && !done && (
        <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
          {options.map((a, i) => (
            <button key={a.action} type="button" onClick={() => pick(i)} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 hover:bg-surface-3">
              {i < 9 && (
                <span aria-hidden className="mr-1.5 text-xs text-faint">
                  {i + 1}
                </span>
              )}
              {optionLabel(a.action, a.amount)}
            </button>
          ))}
        </div>
      )}

      {done && (
        <div className="space-y-2">
          <Compare m={m} r={done} />
          <Moved kept={kept} now={done.tried.at} />
          <DecisionView d={done.decision} players={m.players} title="This retry" />
        </div>
      )}
      {(done || asked.st === "failed") && (
        <div className="flex flex-wrap items-center gap-3">
          <button ref={nextRef} type="button" onClick={() => onOpen(next)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong">
            {next ? "Next one due" : "Done"}
          </button>
          {!done && m.study && (
            <Link to={`/study?${m.study}`} className="text-accent hover:underline">
              Open in Study →
            </Link>
          )}
        </div>
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
