// A decision from this session asked again: your options, then a grade, as the Review page's retry is (features/review/
// retry.ts, mistakes.ts), against the answer there is now and under its own provenance. It changes nothing: not the
// score, not History, not Review's schedule, and not the hand you played, as there's no undo of a move.
import { useEffect, useRef, useState } from "react";
import { Compare } from "@/features/review/Compare";
import { retried, type RetryAnswer, type Retried, type RetrySpot } from "@/features/review/mistakes";
import { askAgain, type GetClient } from "@/features/review/retry";
import { SolverError } from "@/solver/types";
import { DecisionView, optionLabel } from "./PracticeParts";
import type { Reviewed } from "./review";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Asked = { st: "asking" } | { st: "ready"; answer: RetryAnswer } | { st: "failed"; message: string };

/** What's read of an earlier decision to retry it; null where its spot wasn't kept, or it has no grade to set one beside. */
export function retrySpot(e: Reviewed): (RetrySpot & { pot: number; grade: NonNullable<Reviewed["d"]["grade"]> }) | null {
  const { d, state } = e;
  if (!state || !d.grade) return null;
  return { ask: { via: "solver", state }, provenance: d.provenance, mix: d.mix, street: d.street, study: d.study, chose: d.chose, pot: d.pot, grade: d.grade };
}

/** `e`, an earlier decision of this session, asked again. `getClient`: the Room's, which uses an answer still held. */
export function SessionRetry({ e, getClient, onClose }: { e: Reviewed; getClient: GetClient; onClose: () => void }) {
  const spot = retrySpot(e);
  const [asked, setAsked] = useState<Asked>({ st: "asking" });
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<Retried | null>(null);
  const ask = spot?.ask;
  const pot = spot?.pot;
  const mix = spot?.mix;
  // (each step takes away the button the keyboard was on: it goes into the retry, and to Close with the grade)
  const box = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    if (done) close.current?.focus({ preventScroll: true });
  }, [done]);

  useEffect(() => {
    if (!ask || pot === undefined) return;
    let alive = true;
    const stop = new AbortController();
    askAgain({ ask, pot, mix }, getClient, stop.signal).then(
      (answer) => alive && setAsked({ st: "ready", answer }),
      (x: unknown) => {
        if (alive && !(x instanceof SolverError && x.kind === "cancelled")) setAsked({ st: "failed", message: message(x) });
      },
    );
    return () => {
      alive = false;
      stop.abort();
    };
  }, [ask, pot, mix, attempt, getClient]);

  if (!spot) return null;
  return (
    <section ref={box} tabIndex={-1} aria-label="Retry this decision" className="space-y-2 rounded-lg border border-accent bg-surface p-3 outline-none">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Retry</h3>
        <span className="flex-1" />
        <button ref={close} type="button" onClick={onClose} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Close
        </button>
      </div>
      <p className="text-muted">A retry is graded and shown here. It doesn&rsquo;t change your score, your streak, History or Review, and the hand stays as you played it. The table&rsquo;s keys are off while this is open.</p>
      {asked.st === "asking" && (
        <p role="status" className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          Asking the solver…<span className="text-muted">(a live solve can take a while, and waits for what the table has asked)</span>
        </p>
      )}
      {asked.st === "failed" && (
        <p role="alert" className="text-danger">
          No answer to grade this spot against: {asked.message}.{" "}
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
      )}
      {asked.st === "ready" && !done && (
        <div role="group" aria-label="Retry options" className="flex flex-wrap gap-2">
          {asked.answer.mix.map((a, i) => (
            <button key={a.action} type="button" onClick={() => setDone(retried(spot, asked.answer, i, Date.now()))} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 hover:bg-surface-3">
              {optionLabel(a.action, a.amount)}
            </button>
          ))}
        </div>
      )}
      {/* (there from the start, so the grade is announced as it arrives) */}
      <div role="status">{done && <Compare m={spot} r={done} />}</div>
      {done && <DecisionView d={done.decision} players={e.players} title="This retry" />}
    </section>
  );
}
