// Review's course: the lessons of lessons.ts, how many are done and the next one in full, with every lesson by unit a
// press away, each with its report, its drill and how far it's drilled, from the drill sessions kept in this browser.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { allSessions, type SessionRecord } from "@/data/db";
import { course, LESSON_TARGET, LESSONS, lessonDrill, lessonReport, type Lesson, type LessonProgress } from "./lessons";

const START = "rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong";
const QUIET = "rounded border border-border px-2 py-1 hover:bg-surface-2";

export function Lessons({ sessions: given }: { sessions?: readonly SessionRecord[] } = {}) {
  const [sessions, setSessions] = useState<readonly SessionRecord[] | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (given) return;
    let alive = true;
    void allSessions()
      .then((s) => alive && setSessions(s))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [given]);

  const c = sessions ? course(sessions) : null;
  const units = [...new Set(LESSONS.map((l) => l.unit))];
  return (
    <section aria-labelledby="lessons-h" className="space-y-3 panel p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="lessons-h" className="text-sm font-semibold">
          Lessons
        </h2>
        <span className="text-xs text-muted">Read the report, then drill {LESSON_TARGET}</span>
      </div>
      {failed ? (
        <p role="alert" className="text-danger">
          Couldn&rsquo;t read your sessions.
        </p>
      ) : !c ? (
        <p role="status" className="text-muted">
          Reading the drills kept&hellip;
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p role="status" aria-label="Lessons done">
              {c.done} of {LESSONS.length} done.{" "}
              {c.next ? (
                <>
                  <span className="text-muted">Next: </span>
                  <span className="font-medium">
                    {LESSONS.indexOf(c.next) + 1}. {c.next.title}
                  </span>
                </>
              ) : (
                "Every lesson is done."
              )}
            </p>
            <div aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-accent" style={{ width: `${(c.done / LESSONS.length) * 100}%` }} />
            </div>
          </div>
          {c.next && <LessonBody l={c.next} p={c.progress[c.next.id]!} />}
          <details className="group">
            <summary className="cursor-pointer text-muted hover:text-text">All {LESSONS.length} lessons</summary>
            <div className="mt-2 space-y-3">
              {units.map((u) => (
                <div key={u} className="space-y-1">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{u}</h3>
                  <ol className="space-y-1">
                    {LESSONS.filter((l) => l.unit === u).map((l) => (
                      <LessonRow key={l.id} l={l} at={LESSONS.indexOf(l) + 1} p={c.progress[l.id]!} />
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

/** A lesson's idea, what to read and what to check, with its report and its drill. */
function LessonBody({ l, p }: { l: Lesson; p: LessonProgress }) {
  return (
    <div className="space-y-2">
      <p>{l.idea}</p>
      <details>
        <summary className="cursor-pointer text-xs text-muted hover:text-text">What to look for</summary>
        <div className="mt-1 space-y-1.5">
          <p>
            <span className="text-muted">Read: </span>
            {l.look}
          </p>
          <p>
            <span className="text-muted">While you drill: </span>
            {l.check}
          </p>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Link to={lessonReport(l)} className={QUIET}>
          Read the report
        </Link>
        <Link to={lessonDrill(l)} className={p.done ? QUIET : START}>
          {p.done ? "Drill it again" : "Drill it"}
        </Link>
      </div>
    </div>
  );
}

function LessonRow({ l, at, p }: { l: Lesson; at: number; p: LessonProgress }) {
  const share = p.n ? ` · ${Math.round((p.ok / p.n) * 100)}%` : "";
  return (
    <li id={`lesson-${l.id}`} className="rounded border border-border bg-bg">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 px-2.5 py-1.5">
          <span>
            {at}. {l.title}
          </span>
          <span className={`text-xs ${p.done ? "text-accent" : "text-muted"}`}>
            {p.done ? "✓ done" : `${Math.min(p.n, LESSON_TARGET)} of ${LESSON_TARGET}`}
            {share && `${share} Best or Correct`}
          </span>
        </summary>
        <div className="px-2.5 pb-2.5">
          <LessonBody l={l} p={p} />
        </div>
      </details>
    </li>
  );
}
