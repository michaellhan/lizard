// "Drill this leak": the leak's decisions dealt again one by one (leakDrill.ts), on any street whose decision kept its
// mix, your pick graded against that mix and carrying that grade's provenance and confidence, the progress kept as a
// session so leaving and coming back resumes it, and a pick below Correct kept for Review.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { bringIntoView } from "@/components/scroll";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { getSession, putSession, type DecisionRecord, type HandRecord } from "@/data/db";
import { keepMistake } from "@/data/mistakes";
import { addGradeWay, GRADE_WAYS, tallySplit, WAY_WORDS, wayFigures } from "@/features/history/history";
import { addScore, emptyScore, summary, type Grade, type Verdict } from "@/grading/grade";
import { importHand } from "@/hh/replay";
import { seatLabel } from "@/poker/seats";
import type { Street } from "@/poker/table";
import { decisionProvenance, leakMistake } from "@/features/review/fromAnalyze";
import { missedAgain, spotKey } from "@/features/review/mistakes";
import { dueWords } from "@/features/review/schedule";
import { SaveDrill } from "@/features/saved/SaveDrill";
import { studyLinkAt } from "./analyze";
import {
  carriedWords,
  decisionIndex,
  drillItems,
  drillSessionId,
  fromSession,
  gradePick,
  leakDrillAbout,
  leakDrillLink,
  leakParam,
  lineBefore,
  notDealt,
  notDealtWords,
  roughActions,
  toSession,
  withParams,
  type DrillProgress,
  type LeakRef,
} from "./leakDrill";
import { isGraded, spotOf } from "./report";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number) => String(Math.round(x * 100) / 100);
const fresh = (): DrillProgress => ({ startedAt: Date.now(), done: [], score: emptyScore() });
const readHand = (text: string) => {
  try {
    return importHand(text);
  } catch {
    return null;
  }
};

/** What became of a miss: kept for Review (with when it's due), or not. */
type Queued = { id: string; due: string | null };

/** A miss kept for Review; when it's due in words, or null where it wasn't kept. */
async function queueMiss(d: DecisionRecord, hand: HandRecord, g: Grade, sessionId: string): Promise<string | null> {
  const now = Date.now();
  const m = leakMistake(d, hand, readHand(hand.text), g, sessionId, now);
  if (!m || !(await keepMistake(m, missedAgain, spotKey))) return null;
  return dueWords(m, now).toLowerCase();
}

/** `hands`: those the filters show, what's dealt. `kept`: every hand, what the leak is. */
export function LeakDrill({ leak, decisions, hands, kept, onClose }: { leak: LeakRef; decisions: DecisionRecord[]; hands: HandRecord[]; kept: HandRecord[]; onClose: () => void }) {
  const byId = useMemo(() => new Map(hands.map((h) => [h.id, h])), [hands]);
  const items = useMemo(() => drillItems(decisions, leak, byId), [decisions, leak, byId]);
  const whole = useMemo(() => drillItems(decisions, leak, new Map(kept.map((h) => [h.id, h]))), [decisions, leak, kept]);
  const [prog, setProg] = useState<DrillProgress | null>(null);
  const [held, setAnswer] = useState<{ id: string; a: number; g: Grade } | null>(null);
  // (a filter can take the decision just answered out of view: the next one in view is dealt)
  const answer = held && items.some((x) => x.d.id === held.id) ? held : null;
  const left_out = useMemo(() => notDealtWords(notDealt(decisions, leak, byId)), [decisions, leak, byId]);
  const [queued, setQueued] = useState<Queued | null>(null);
  const box = useRef<HTMLElement>(null);
  const [params] = useSearchParams();
  const key = `${leak.kind}:${leak.key}`;
  useEffect(() => {
    // (mounted afresh for each leak: the parent keys it)
    let alive = true;
    void getSession(toSession(leak, fresh(), 0).id)
      .then((s) => alive && setProg(fromSession(s) ?? fresh()))
      .catch(() => alive && setProg(fresh()));
    bringIntoView(box.current);
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (p: DrillProgress) => {
    setProg(p);
    // (the total is the whole leak's as it stands now, as the progress is, whatever the filters show, and History says
    // it's from this drill; with what's done of hands since deleted, so it never says 5 of 2)
    void putSession(toSession(leak, p, new Set([...whole.map((x) => x.d.id), ...p.done]).size)).catch(() => {});
  };
  const done = new Set(prog?.done ?? []);
  const cur = answer ? items.find((x) => x.d.id === answer.id) : items.find((x) => !done.has(x.d.id));
  const left = items.filter((x) => !done.has(x.d.id)).length;

  const pick = (a: number) => {
    if (!prog || !cur || answer) return;
    const g = gradePick(cur.d, a);
    if (!g) return;
    setAnswer({ id: cur.d.id, a, g });
    save({ ...prog, done: [...prog.done, cur.d.id], score: addScore(prog.score, g), ways: addGradeWay(prog.ways, g, cur.d.source) });
    if (g.ok) return;
    const told = (due: string | null) => setQueued({ id: cur.d.id, due });
    queueMiss(cur.d, cur.hand, g, drillSessionId(leak)).then(told, () => told(null));
  };

  return (
    <section ref={box} aria-label="Leak drill" className="scroll-mt-16 space-y-3 panel p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <h2 className="text-lg font-semibold">Drill: {leak.key}</h2>
          <p className="text-muted">
            Misses first. A pick below Correct goes to{" "}
            <Link to="/review" className="underline">
              Review
            </Link>{" "}
            queue.
          </p>
        </div>
        <span className="flex-1" />
        <SaveDrill kind="leak" to={leakDrillLink(leak, params)} about={leakDrillAbout(leak, params)} />
        <button type="button" onClick={onClose} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Close
        </button>
      </div>
      {!prog ? (
        <p className="text-muted">Reading your progress on this leak…</p>
      ) : !items.length ? (
        <>
          <p>{whole.length ? "None of this leak's graded decisions is in these hands." : "None of this leak's decisions is graded with its mix."}</p>
          {left_out && <p className="text-muted">{left_out}</p>}
        </>
      ) : (
        <>
          {left_out && <p className="text-muted">{left_out}</p>}
          <DrillScore
            prog={prog}
            done={items.length - left}
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
              queued={queued?.id === cur.d.id ? queued : null}
              onPick={pick}
              n={items.length - left + (answer ? 0 : 1)}
              total={items.length}
              handLink={withParams(params, { drill: leakParam(leak), hand: cur.hand.id })}
            />
          ) : (
            <p role="status">Every decision of this leak in these hands is drilled. Start over to go again.</p>
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

function DrillScore({ prog, done, total, onRestart }: { prog: DrillProgress; done: number; total: number; onRestart: () => void }) {
  const s = prog.score;
  const m = summary(s);
  // (the score is the whole leak's, a filter or none: over other hands it says so)
  const beyond = prog.done.length !== done;
  // (a drill can hold decisions graded different ways, say a stored turn's and a solve's: more than one, a single rate or EV
  // figure would add unlike things, so each gets its own, as in Practice's score. Picks kept before ways stand apart.)
  const { ways, apart } = tallySplit({ ...s, ways: prog.ways });
  const split = GRADE_WAYS.filter((w) => ways[w]);
  const figures = [...split.map((w) => `${WAY_WORDS[w]}: ${wayFigures(w, ways[w]!, "bb")}`), ...(apart ? [`${apart} kept before grades were told apart by way, in none of these`] : [])];
  return (
    <p role="group" aria-label="Drill score" className="flex flex-wrap items-center gap-2 text-muted">
      <span>
        {done} of {total} drilled
        {beyond ? ` here; ${prog.done.length} of this leak in all` : ""}
        {figures.length > 1 || apart ? `: ${figures.join("; ")}` : <>
          {s.n ? `: ${s.ok} in the mix (${pct(m.acc)})` : ""}
          {m.loss != null ? `, ${fmt(s.loss)}bb lost over ${s.ne} graded by ${ways.solve ? "the preflop solve" : "EV"}` : ""}
        </>}.
      </span>
      {prog.done.length > 0 && (
        <button type="button" onClick={onRestart} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
          {beyond ? "Start this leak over" : "Start over"}
        </button>
      )}
    </p>
  );
}

function Problem({
  d,
  hand,
  answer,
  queued,
  onPick,
  n,
  total,
  handLink,
}: {
  d: DecisionRecord;
  hand: HandRecord;
  answer: { a: number; g: Grade } | null;
  queued: Queued | null;
  onPick: (a: number) => void;
  n: number;
  total: number;
  handLink: string;
}) {
  const r = useMemo(() => readHand(hand.text), [hand.text]);
  const street = d.street as Street;
  const i = decisionIndex(d);
  const line = r ? lineBefore(r, street, i) : null;
  const study = r ? studyLinkAt(r, street, i, hand.setup) : null;
  const mix = d.mix ?? [];
  const byEv = mix.every((x) => x[2] !== null);
  const rough = roughActions(d);
  const roughly = (name: string) => (rough.has(name) ? "≈" : "");
  return (
    <div role="group" aria-label="Decision" className="space-y-2">
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
      {!line && street !== "preflop" && <p className="text-warn">History unreadable: board not shown.</p>}
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
        <div role="group" aria-label="Answer" className="space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <VerdictTag v={answer.g.verdict} />
            <span>
              {answer.g.byEv
                ? answer.g.loss > 0
                  ? `${roughly(mix[answer.a]?.[0] ?? "") || roughly(mix[answer.g.best]?.[0] ?? "")}${fmt(answer.g.loss)}bb lost (${Math.round(answer.g.lossPct * 10) / 10}% of the pot)`
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
                  {byEv && <td className="pr-4 text-right">{ev == null ? "—" : `${roughly(name)}${fmt(ev)}bb`}</td>}
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
          <p role="group" aria-label="What graded it" className="text-xs text-muted">
            Graded against <ProvenanceBadge p={decisionProvenance(d)} quiet />. {carriedWords(d, answer.g).join(" ")}
          </p>
          {!answer.g.ok && queued && (
            <p role="status" className="text-xs">
              {queued.due === null ? (
                "Not kept for Review: this browser isn't saving data."
              ) : (
                <>
                  Kept for{" "}
                  <Link to="/review" className="underline">
                    Review
                  </Link>
                  , {queued.due}.
                </>
              )}
            </p>
          )}
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
