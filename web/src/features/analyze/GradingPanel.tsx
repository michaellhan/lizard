// Analyze's grading: the queue that grades your kept hands' decisions in this browser (grading.ts gradeHands, through
// the page's solver: the charts and the flop library, nothing solved), and the report over what's graded
// (report.ts): the grades, the leaks, the frequencies against the answer's, the decisions that lost the most, and
// CSV and JSON export. Every number says what it stands on: the charts (by frequency, not a solve) or the library.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { VerdictTag } from "@/components/VerdictTag";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { clearDecisions, putDecisions } from "@/data/hands";
import type { Verdict } from "@/grading/grade";
import { useRuntime } from "@/solver/runtime";
import { useSolver } from "@/solver/useSolver";
import { SCOPES, gradeHands, type GradeScope } from "./grading";
import { isGraded, leakTest, report, toCSV, toJSON, VERDICTS, type Group, type Leak } from "./report";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const bbs = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100) / 100}bb`);

/** What the grades stand on, said wherever they are shown. */
export const GRADED_ON =
  "Preflop decisions are graded against the preflop charts by how often your hand takes the action: the charts aren't a solve and have no EVs, so no EV lost is counted. Flop decisions are graded by EV against the precomputed flop library; a flop it doesn't hold isn't graded. Nothing is solved, and turns and rivers aren't graded yet (they need a live solve).";

export function GradePanel({ hands, decisions, onGraded }: { hands: HandRecord[]; decisions: DecisionRecord[]; onGraded: (ds: DecisionRecord[] | null) => void }) {
  const getSolver = useSolver();
  const status = useRuntime((s) => s.status);
  const [scope, setScope] = useState<GradeScope>("library");
  const [prog, setProg] = useState<{ k: number; n: number; graded: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arm, setArm] = useState(false);
  const ac = useRef<AbortController | null>(null);
  // (leaving the page stops the queue: what's graded is kept, and the rest is graded when asked again)
  useEffect(() => () => ac.current?.abort(), []);
  const running = prog !== null;

  const start = async () => {
    const ctl = new AbortController();
    ac.current = ctl;
    setError(null);
    setMsg(null);
    setProg({ k: 0, n: hands.length, graded: 0 });
    let graded = 0;
    try {
      const client = await getSolver();
      const run = await gradeHands(hands, scope, new Set(decisions.map((d) => d.id)), (state) => client.solve({ state, mode: "fast", signal: ctl.signal }), {
        signal: ctl.signal,
        onHand: async (k, n, ds) => {
          graded += ds.length;
          if (ds.length) {
            await putDecisions(ds);
            onGraded(ds);
          }
          setProg({ k, n, graded });
        },
      });
      setMsg(`${run.stopped ? "Stopped" : "Done"}: ${graded.toLocaleString()} ${graded === 1 ? "decision" : "decisions"} graded in this run${run.stopped ? "; the rest are graded when you ask again" : ""}.`);
    } catch (e) {
      setError(`Grading stopped: ${e instanceof Error ? e.message : String(e)}. What was graded is kept.`);
    } finally {
      setProg(null);
      ac.current = null;
    }
  };

  return (
    <section aria-label="Grading" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <h2 className="text-lg font-semibold">Grade your decisions</h2>
      <p className="text-muted">{GRADED_ON}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>Grade</span>
          <select value={scope} disabled={running} onChange={(e) => setScope(e.target.value as GradeScope)} className="rounded border border-border bg-bg px-1 py-0.5">
            {(Object.keys(SCOPES) as GradeScope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPES[s]}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" onClick={() => ac.current?.abort()} className="rounded border border-border px-3 py-1 hover:bg-surface-2">
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => void start()} disabled={!hands.length} className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-50">
            Grade {hands.length.toLocaleString()} {hands.length === 1 ? "hand" : "hands"}
          </button>
        )}
        <span className="flex-1" />
        {decisions.length > 0 &&
          !running &&
          (arm ? (
            <>
              <button
                type="button"
                onClick={() =>
                  void clearDecisions().then(() => {
                    setArm(false);
                    setMsg(null);
                    onGraded(null);
                  })
                }
                className="rounded border border-danger/60 px-2 py-0.5 text-danger hover:bg-danger/10"
              >
                Forget {decisions.length.toLocaleString()} grades
              </button>
              <button type="button" onClick={() => setArm(false)} className="rounded border border-border px-2 py-0.5">
                Keep
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setArm(true)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Forget the grades
            </button>
          ))}
      </div>
      {running && (
        <p role="status" aria-label="Grading progress">
          {status.phase === "booting" ? `Starting the solver in this browser${status.message ? `: ${status.message}` : ""}. ` : ""}
          Hand {prog.k.toLocaleString()} of {prog.n.toLocaleString()}: {prog.graded.toLocaleString()} {prog.graded === 1 ? "decision" : "decisions"} graded. A decision already graded isn't asked again.
        </p>
      )}
      {msg && <p role="status">{msg}</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

export function GradeReport({ decisions, hands }: { decisions: DecisionRecord[]; hands: HandRecord[] }) {
  const byId = useMemo(() => new Map(hands.map((h) => [h.id, h])), [hands]);
  // (decisions of hands no longer kept are left out)
  const ds = useMemo(() => decisions.filter((d) => byId.has(d.handId)), [decisions, byId]);
  const rp = useMemo(() => report(ds), [ds]);
  const [leak, setLeak] = useState<Leak | null>(null);
  if (!ds.length) return null;
  const a = rp.all;
  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const el = document.createElement("a");
    el.href = url;
    el.download = name;
    document.body.append(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <section aria-label="Report" className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Report</h2>
        <span className="flex-1" />
        <button type="button" onClick={() => download(`lizard-decisions-${stamp}.csv`, toCSV(ds, byId), "text/csv")} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Export CSV
        </button>
        <button type="button" onClick={() => download(`lizard-decisions-${stamp}.json`, toJSON(ds, byId), "application/json")} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Export JSON
        </button>
      </div>
      <div aria-label="Summary" className="space-y-1">
        <p>
          {a.graded.toLocaleString()} of your decisions graded in {rp.hands.toLocaleString()} hands: {pct(a.graded ? a.ok / a.graded : null)} in the mix (Best or Correct).
        </p>
        <p className="flex flex-wrap gap-2">
          {VERDICTS.map((v) => (
            <span key={v} className="flex items-center gap-1">
              <VerdictTag v={v} /> {a.by[v]}
            </span>
          ))}
        </p>
        {a.ev > 0 && (
          <p>
            Graded by EV against the flop library: {a.ev.toLocaleString()} {a.ev === 1 ? "decision" : "decisions"}, {bbs(a.lost)} lost in all, {a.avgPct}% of the pot a decision on average.
          </p>
        )}
        {rp.notGraded.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted">
              {(a.n - a.graded).toLocaleString()} not graded
            </summary>
            <ul className="list-disc pl-5 text-muted">
              {rp.notGraded.map((w) => (
                <li key={w.why}>
                  {w.why}: {w.n}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-muted">{GRADED_ON}</p>
      </div>

      {rp.leaks.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">Leaks</h3>
          <ul aria-label="Leaks" className="space-y-1">
            {rp.leaks.map((l) => (
              <li key={`${l.kind}|${l.key}`} className="flex flex-wrap items-center gap-2">
                <span>{leakText(l)}</span>
                <button type="button" onClick={() => setLeak(leak?.key === l.key && leak.kind === l.kind ? null : l)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                  {leak?.key === l.key && leak.kind === l.kind ? "Hide" : "Show"} its decisions
                </button>
              </li>
            ))}
          </ul>
          {leak && <DecisionList title={leak.key} ds={ds.filter(leakTest(leak))} byId={byId} />}
        </div>
      )}
      {rp.leaks.length === 0 && (
        <p className="text-muted">
          No clear leak yet: a leak is a frequency 10 points off the answer's over 15 decisions, a preflop situation under 80% in the mix over 15, or a flop spot losing 0.5bb a decision over 10.
        </p>
      )}

      <GroupTable title="By street" first="Street" rows={rp.byStreet} />
      {rp.byPf.length > 0 && <GroupTable title="Preflop, by situation (against the charts, by frequency)" first="Situation" rows={rp.byPf} />}
      {rp.bySpot.length > 0 && <GroupTable title="Flop, by spot (against the library, by EV)" first="Spot" rows={rp.bySpot} ev />}
      {rp.freqs.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">Your frequencies against the answer's</h3>
          <div className="relative overflow-x-auto">
            <table aria-label="Frequencies" className="min-w-full text-left">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="pr-3 font-normal">Decision</th>
                  <th className="pr-3 text-right font-normal">Decisions</th>
                  <th className="pr-3 text-right font-normal">You</th>
                  <th className="pr-3 text-right font-normal">The answer</th>
                </tr>
              </thead>
              <tbody>
                {rp.freqs.map((f) => (
                  <tr key={f.label} aria-label={f.label} className="border-t border-border">
                    <td className="pr-3">{f.label}</td>
                    <td className="pr-3 text-right">{f.n}</td>
                    <td className="pr-3 text-right">{pct(f.you)}</td>
                    <td className="pr-3 text-right">{pct(f.gto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">The answer's: the same hands at the same decisions, the charts' preflop and the library's on the flop.</p>
        </div>
      )}
      {rp.mistakes.length > 0 && <DecisionList title="The most EV lost (flop library)" ds={rp.mistakes} byId={byId} />}
      {rp.offChart.length > 0 && <DecisionList title="Off the chart (the charts play it under 3% of the time)" ds={rp.offChart} byId={byId} />}
    </section>
  );
}

function leakText(l: Leak): string {
  if (l.kind === "freq") return `${l.key}: you ${pct(l.you)}, the answer ${pct(l.gto)} (${l.n} decisions)`;
  if (l.kind === "pf") return `${l.key}: ${pct(l.inMix)} in the mix against the charts (${l.n} decisions)`;
  return `${l.key}: ${bbs(l.avg)} lost a decision against the library (${l.n} decisions)`;
}

function GroupTable({ title, first, rows, ev }: { title: string; first: string; rows: Group[]; ev?: boolean }) {
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{title}</h3>
      <div className="relative overflow-x-auto">
        <table aria-label={title} className="min-w-full text-left">
          <thead className="text-xs text-muted">
            <tr>
              <th className="pr-3 font-normal">{first}</th>
              <th className="pr-3 text-right font-normal">Graded</th>
              <th className="pr-3 text-right font-normal">In the mix</th>
              <th className="pr-3 text-right font-normal">Mistakes</th>
              {ev && <th className="pr-3 text-right font-normal">EV lost a decision</th>}
              <th className="pr-3 text-right font-normal">Not graded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} aria-label={r.key} className="border-t border-border">
                <td className="pr-3">{r.key}</td>
                <td className="pr-3 text-right">{r.graded}</td>
                <td className="pr-3 text-right">{pct(r.graded ? r.ok / r.graded : null)}</td>
                <td className="pr-3 text-right">{r.by.Mistake + r.by.Blunder}</td>
                {ev && <td className="pr-3 text-right">{r.ev ? `${bbs(r.avg)} (${r.avgPct}%)` : "—"}</td>}
                <td className="pr-3 text-right">{r.n - r.graded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LIST_MAX = 50;

function DecisionList({ title, ds, byId }: { title: string; ds: DecisionRecord[]; byId: ReadonlyMap<string, HandRecord> }) {
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{title}</h3>
      <ul aria-label={title} className="space-y-1">
        {ds.slice(0, LIST_MAX).map((d) => {
          const h = byId.get(d.handId);
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2">
              {isGraded(d) && <VerdictTag v={d.verdict as Verdict} />}
              <span>
                {d.pos} {h?.hole ?? ""} {d.street}: {d.action}
                {d.situation ? ` (${d.situation})` : ""}
              </span>
              <span className="text-muted" title={d.label}>
                {decisionNote(d)}
              </span>
              <Link to={`?hand=${encodeURIComponent(d.handId)}`} className="text-xs underline">
                Hand {h?.number || ""}
              </Link>
            </li>
          );
        })}
      </ul>
      {ds.length > LIST_MAX && <p className="text-xs text-muted">The first {LIST_MAX} of {ds.length}.</p>}
    </div>
  );
}

/** A graded decision in brief: what the answer does with your hand, and what it stands on. */
export function decisionNote(d: DecisionRecord): string {
  if (!isGraded(d)) return `not graded: ${d.why ?? ""}`;
  const parts = [`the answer ${d.matched ?? d.action} ${pct(d.freq)}${d.best && d.best !== d.matched ? `, most often ${d.best} ${pct(d.bestFreq)}` : ""}`];
  if (d.evLossBb != null) parts.push(d.evLossBb > 0 ? `${bbs(d.evLossBb)} lost (${d.lossPct}% of the pot)` : "no EV lost");
  if (d.note) parts.push(d.note);
  parts.push(d.source === "charts" ? "preflop charts, by frequency (not a solve)" : d.label);
  return parts.join(" · ");
}
