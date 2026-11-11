// The Plan page's course: the lessons of lessons.ts by unit, each with its report, its drill and how far it's drilled,
// from the drill sessions kept in this browser.
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
    <section aria-labelledby="lessons-h" className="space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
      <div>
        <h2 id="lessons-h" className="font-medium">
          Lessons
        </h2>
        <p className="text-muted">
          Read the report, then drill it ({LESSON_TARGET} to finish).
        </p>
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
          <p role="status" aria-label="Lessons done">
            {c.done} of {LESSONS.length} done.{" "}
            {c.next ? (
              <>
                <span className="text-muted">Next: </span>
                <a href={`#lesson-${c.next.id}`} className="font-medium underline">
                  {LESSONS.indexOf(c.next) + 1}. {c.next.title}
                </a>
              </>
            ) : (
              "Every lesson is done."
            )}
          </p>
          {units.map((u) => (
            <div key={u} className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{u}</h3>
              <ol className="grid items-start gap-2 md:grid-cols-2">
                {LESSONS.filter((l) => l.unit === u).map((l) => (
                  <LessonRow key={l.id} l={l} at={LESSONS.indexOf(l) + 1} p={c.progress[l.id]!} next={c.next === l} />
                ))}
              </ol>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function LessonRow({ l, at, p, next }: { l: Lesson; at: number; p: LessonProgress; next: boolean }) {
  const share = p.n ? ` · ${Math.round((p.ok / p.n) * 100)}% Best or Correct` : "";
  return (
    <li id={`lesson-${l.id}`} className="rounded border border-border bg-bg">
      <details open={next}>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2">
          <span className="font-medium">
            {at}. {l.title}
          </span>
          <span className={p.done ? "text-accent" : "text-muted"}>
            {p.done ? "✓ done" : `${Math.min(p.n, LESSON_TARGET)} of ${LESSON_TARGET}`}
            {share}
          </span>
        </summary>
        <div className="space-y-2 px-3 pb-3">
          <p>{l.idea}</p>
          <p>
            <span className="text-muted">Read: </span>
            {l.look}
          </p>
          <p>
            <span className="text-muted">While you drill: </span>
            {l.check}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to={lessonReport(l)} className={QUIET}>
              Read the report
            </Link>
            <Link to={lessonDrill(l)} className={p.done ? QUIET : START}>
              {p.done ? "Drill it again" : "Drill it"}
            </Link>
          </div>
        </div>
      </details>
    </li>
  );
}
