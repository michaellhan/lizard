// "Drill this leak": the leak's decisions dealt again one by one (leakDrill.ts), your pick graded against the mix kept
// with the decision, the progress kept as a session so leaving and coming back resumes it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { VerdictTag } from "@/components/VerdictTag";
import { getSession, putSession, type DecisionRecord, type HandRecord } from "@/data/db";
import { addScore, emptyScore, summary, type Grade, type Verdict } from "@/grading/grade";
import { importHand } from "@/hh/replay";
import { seatLabel } from "@/poker/seats";
import type { Street } from "@/poker/table";
import { SaveDrill } from "@/features/saved/SaveDrill";
import { studyLinkAt } from "./analyze";
import {
  drillItems,
  fromSession,
  gradePick,
  leakDrillAbout,
  leakDrillLink,
  leakParam,
  lineBefore,
  toSession,
  withParams,
  type DrillProgress,
  type LeakRef,
} from "./leakDrill";
import { isGraded, spotOf } from "./report";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number) => String(Math.round(x * 100) / 100);
const fresh = (): DrillProgress => ({ startedAt: Date.now(), done: [], score: emptyScore() });

export function LeakDrill({ leak, decisions, hands, onClose }: { leak: LeakRef; decisions: DecisionRecord[]; hands: HandRecord[]; onClose: () => void }) {
  const byId = useMemo(() => new Map(hands.map((h) => [h.id, h])), [hands]);
  const items = useMemo(() => drillItems(decisions, leak, byId), [decisions, leak, byId]);
  const [prog, setProg] = useState<DrillProgress | null>(null);
  const [answer, setAnswer] = useState<{ id: string; a: number; g: Grade } | null>(null);
  const box = useRef<HTMLElement>(null);
  const [params] = useSearchParams();
  const key = `${leak.kind}:${leak.key}`;
  useEffect(() => {
    // (mounted afresh for each leak: the parent keys it)
    let alive = true;
    void getSession(toSession(leak, fresh(), 0).id)
      .then((s) => alive && setProg(fromSession(s) ?? fresh()))
      .catch(() => alive && setProg(fresh()));
    box.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (p: DrillProgress) => {
    setProg(p);
    void putSession(toSession(leak, p, items.length)).catch(() => {});
  };
  const done = new Set(prog?.done ?? []);
  const cur = answer ? items.find((x) => x.d.id === answer.id) : items.find((x) => !done.has(x.d.id));
  const left = items.filter((x) => !done.has(x.d.id)).length;

  const pick = (a: number) => {
    if (!prog || !cur || answer) return;
    const g = gradePick(cur.d, a);
    setAnswer({ id: cur.d.id, a, g });
    save({ ...prog, done: [...prog.done, cur.d.id], score: addScore(prog.score, g) });
  };

  return (
    <section ref={box} aria-label="Leak drill" className="scroll-mt-16 space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <h2 className="text-lg font-semibold">Drill: {leak.key}</h2>
          <p className="text-muted">
            Your decisions behind this leak, dealt again, your misses first. Each is graded against the answer kept with its grade, which it names: the
            preflop charts by frequency (not a solve), or what answered it after the flop, by EV where that has EVs. Nothing is solved.
          </p>
        </div>
        <span className="flex-1" />
        <SaveDrill kind="leak" to={leakDrillLink(leak, params)} about={leakDrillAbout(leak, params)} />
        <button type="button" onClick={onClose} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Close
        </button>
      </div>
      {!prog ? (
        <p className="text-muted">…</p>
      ) : !items.length ? (
        <p>None of this leak's decisions is graded with its mix in this browser.</p>
      ) : (
        <>
          <DrillScore
            prog={prog}
            total={items.length}
            onRestart={() => {
              setAnswer(null);
              save(fresh());
            }}
          />
          {cur ? (
            <Problem
              key={cur.d.id}
              d={cur.d}
              hand={cur.hand}
              answer={answer}
              onPick={pick}
              n={items.length - left + (answer ? 0 : 1)}
              total={items.length}
              handLink={withParams(params, { drill: leakParam(leak), hand: cur.hand.id })}
            />
          ) : (
            <p role="status">Every decision of this leak is drilled. Start over to go again.</p>
          )}
          {answer && (
            <button type="button" onClick={() => setAnswer(null)} className="rounded bg-accent px-3 py-1 font-medium text-bg">
              {left ? "Next decision" : "Finish"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function DrillScore({ prog, total, onRestart }: { prog: DrillProgress; total: number; onRestart: () => void }) {
  const s = prog.score;
  const m = summary(s);
  return (
    <p aria-label="Drill score" className="flex flex-wrap items-center gap-2 text-muted">
      <span>
        {prog.done.length} of {total} drilled
        {s.n ? `: ${s.ok} in the mix (${pct(m.acc)})` : ""}
        {m.loss != null ? `, ${fmt(s.loss)}bb lost over ${s.ne} graded by EV` : ""}.
      </span>
      {prog.done.length > 0 && (
        <button type="button" onClick={onRestart} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
          Start over
        </button>
      )}
    </p>
  );
}

function Problem({
  d,
  hand,
  answer,
  onPick,
  n,
  total,
  handLink,
}: {
  d: DecisionRecord;
  hand: HandRecord;
  answer: { a: number; g: Grade } | null;
  onPick: (a: number) => void;
  n: number;
  total: number;
  handLink: string;
}) {
  const r = useMemo(() => {
    try {
      return importHand(hand.text);
    } catch {
      return null;
    }
  }, [hand.text]);
  const street = d.street as Street;
  const i = d.i ?? 0;
  const line = r ? lineBefore(r, street, i) : null;
  const study = r ? studyLinkAt(r, street, i) : null;
  const mix = d.mix ?? [];
  const byEv = mix.every((x) => x[2] !== null);
  return (
    <div aria-label="Decision" className="space-y-2">
      <p className="text-xs text-muted">
        Decision {n} of {total} · {spotOf(d) ?? d.situation} · {hand.site} hand {hand.number ? `#${hand.number}` : ""}, {hand.played}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          You are <b>{seatLabel(d.pos, hand.players)}</b> with
        </span>
        <span className="flex gap-0.5">
          {(hand.hole.match(/../g) ?? []).map((c) => (
            <PlayingCard key={c} card={c} size="sm" />
          ))}
        </span>
        {line && line.board.length > 0 && (
          <>
            <span className="text-muted">on</span>
            <span className="flex gap-0.5">
              {line.board.map((c) => (
                <PlayingCard key={c} card={c} size="sm" />
              ))}
            </span>
          </>
        )}
      </div>
      {line && (
        <ul aria-label="The action before" className="space-y-0.5">
          {line.streets
            .filter((s) => s.says.length)
            .map((s) => (
              <li key={s.street}>
                <span className="mr-2 text-xs uppercase text-muted">{s.street}</span>
                {s.says.join(", ")}
              </li>
            ))}
        </ul>
      )}
      <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
        {mix.map(([name], k) => (
          <button
            key={name}
            type="button"
            disabled={!!answer}
            onClick={() => onPick(k)}
            className={`rounded border px-3 py-1 ${answer?.a === k ? "border-accent bg-accent/15" : "border-border hover:bg-surface-2"} disabled:cursor-default`}
          >
            {name}
          </button>
        ))}
      </div>
      {answer && (
        <div aria-label="Answer" className="space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <VerdictTag v={answer.g.verdict} />
            <span>
              {answer.g.byEv
                ? answer.g.loss > 0
                  ? `${fmt(answer.g.loss)}bb lost (${Math.round(answer.g.lossPct * 10) / 10}% of the pot)`
                  : "no EV lost"
                : `your hand takes it ${pct(mix[answer.a]?.[1] ?? 0)} of the time`}
            </span>
          </p>
          <table aria-label="The answer for your hand" className="text-left">
            <thead className="text-xs text-muted">
              <tr>
                <th className="pr-4 font-normal">Action</th>
                <th className="pr-4 text-right font-normal">Frequency</th>
                {byEv && <th className="pr-4 text-right font-normal">EV</th>}
              </tr>
            </thead>
            <tbody>
              {mix.map(([name, f, ev]) => (
                <tr key={name} className="border-t border-border">
                  <td className="pr-4">{name}</td>
                  <td className="pr-4 text-right">{pct(f)}</td>
                  {byEv && <td className="pr-4 text-right">{ev == null ? "—" : `${fmt(ev)}bb`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted">
            In the hand you played {d.action}
            {isGraded(d) ? (
              <>
                {" "}
                (<span className="inline-block align-middle">
                  <VerdictTag v={d.verdict as Verdict} />
                </span>
                ){d.note ? `; ${d.note}` : ""}
              </>
            ) : null}
            . {d.source === "charts" ? "From the preflop charts, by frequency (not a solve)." : `From ${d.label}.`}
          </p>
          <p className="flex gap-3 text-xs">
            {study && (
              <Link to={study} className="underline">
                Open in Study
              </Link>
            )}
            <Link to={handLink} className="underline">
              Open the hand
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
