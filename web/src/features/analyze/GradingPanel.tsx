// Analyze's grading: the queue that grades your kept hands' decisions in this browser (grading.ts gradeHands, through
// the page's solver: the charts and the flop library, or every street by Quick triage or at Fast, the doubtful reads
// then checked at Fast: triage.ts), and the report over what's graded (report.ts): the grades, what they stand on, the
// leaks, the frequencies against the answer's, the decisions that lost the most, and CSV and JSON export. Every number
// says what it stands on: the charts (by frequency, not a solve), the library, a read or a solve.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { VerdictTag } from "@/components/VerdictTag";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { clearDecisions, putDecisions } from "@/data/hands";
import type { Verdict } from "@/grading/grade";
import { VERSION_UNKNOWN } from "@/grading/version";
import type { Street } from "@/poker/table";
import { MODE_BUDGETS, solverThreads } from "@/solver/client";
import { useRuntime } from "@/solver/runtime";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { STREETS } from "./analyze";
import { answeredIds, gradeHands, SCOPES, type Ask, type GradeScope } from "./grading";
import { leakParam, withParams } from "./leakDrill";
import { isGraded, leakTest, report, toCSV, toJSON, VERDICTS, type Group, type Leak } from "./report";
import { deepenPlan, flagged, fmtDur, secondsLeft, toAsk, type Timing } from "./triage";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const bbs = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100) / 100}bb`);

/** What the grades stand on, said wherever they are shown. */
export const GRADED_ON =
  "Preflop decisions are graded against the preflop charts by how often your hand takes the action: the charts aren't a solve and have no EVs, so no EV lost is counted. After the flop a decision is graded against what answered it, which it names: the precomputed flop library, a stored turn, a read at once, or a Quick or Fast solve; by EV where that answer has EVs, by frequency where it hasn't. A rough or cut-short solve can't condemn a line: its grade stops at Inaccuracy. The betting rules and equity guesses are never graded against. Tournament hands are graded in chips, with no ICM or bounties.";

/** What each scope asks of the solver. */
const SCOPE_NOTES: Record<GradeScope, string> = {
  preflop: "Nothing is solved.",
  library: "Nothing is solved; a flop the library doesn't hold isn't graded.",
  triage:
    "What's in hand first (the charts, the library, its stored turns, nearby solutions), else a Quick solve. Each read says how far to trust it, and the doubtful ones can then be checked at Fast.",
  all: "The charts and the library where they answer, else a solve at Fast: closer to equilibrium, and much slower. Triage reads already kept aren't asked again: check them at Fast below.",
};

const nDecisions = (n: number) => `${n.toLocaleString()} ${n === 1 ? "decision" : "decisions"}`;

export function GradePanel({ hands, decisions, onGraded }: { hands: HandRecord[]; decisions: DecisionRecord[]; onGraded: (ds: DecisionRecord[] | null) => void }) {
  const getSolver = useSolver();
  const status = useRuntime((s) => s.status);
  // (the setting, not the status: nothing has started the solver until a run does)
  const transport = useSettings((s) => s.transport);
  const [scope, setScope] = useState<GradeScope>("library");
  const [prog, setProg] = useState<{ k: number; n: number; graded: number; eta: number | null; checking: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arm, setArm] = useState(false);
  const [planned, setPlanned] = useState<{ of: HandRecord[]; scope: GradeScope; left: Record<Street, number> } | null>(null);
  const ac = useRef<AbortController | null>(null);
  // (leaving the page stops the queue: what's graded is kept, and the rest is graded when asked again)
  useEffect(() => () => ac.current?.abort(), []);
  const running = prog !== null;
  const budgets = MODE_BUDGETS[transport].fast;
  const threads = transport === "worker" ? solverThreads() : 1;
  const secs = (left: Record<Street, number>, sc: GradeScope, timing: Timing = {}) => secondsLeft(left, timing, sc, budgets, threads);

  useEffect(() => {
    if (running) return;
    const ctl = new AbortController();
    void toAsk(hands, scope, answeredIds(decisions), { signal: ctl.signal }).then((left) => {
      if (left) setPlanned({ of: hands, scope, left });
    });
    return () => ctl.abort();
  }, [hands, decisions, scope, running]);
  // (not while a run adds to the decisions hand by hand)
  const toCheck = useMemo(() => (running ? null : { flagged: deepenPlan(hands, decisions), every: deepenPlan(hands, decisions, true) }), [hands, decisions, running]);

  /** A run: `done` skipped, or only `deepen`'s reads; `left` what it will ask, by street, for its clock. */
  const run = async (sc: GradeScope, list: HandRecord[], done: ReadonlySet<string>, left: Record<Street, number> | null, deepen?: Map<string, DecisionRecord>) => {
    const ctl = new AbortController();
    ac.current = ctl;
    setError(null);
    setMsg(null);
    const checking = !!deepen;
    setProg({ k: 0, n: list.length, graded: 0, eta: null, checking });
    let graded = 0;
    let unanswered = 0;
    let unchecked = 0;
    let unkept = 0;
    const timing: Timing = {};
    const togo = left ?? (await toAsk(list, sc, done, { signal: ctl.signal }));
    try {
      const client = await getSolver();
      const ask: Ask = async (state) => {
        // (the solver's boot isn't the street's time, and it starts inside the first ask: only a ready solver is timed)
        const timed = useRuntime.getState().status.phase === "ready";
        const t0 = performance.now();
        const ans = await client.solve({ state, mode: "fast", signal: ctl.signal });
        const s = STREETS[[0, 6, 8, 10].indexOf(state.board?.length ?? 0)];
        if (timed && s) {
          const m = (timing[s] ??= [0, 0]);
          m[0] += (performance.now() - t0) / 1000;
          m[1]++;
        }
        return ans;
      };
      const r = await gradeHands(list, sc, done, ask, {
        signal: ctl.signal,
        ...(deepen ? { deepen } : {}),
        onHand: async (k, n, ds) => {
          graded += ds.length;
          for (const d of ds) {
            if (togo) togo[d.street as Street]--;
            if (d.notChecked !== undefined) unchecked++;
            if (!isGraded(d)) unanswered++;
          }
          if (ds.length) {
            if (!(await putDecisions(ds))) unkept += ds.length;
            onGraded(ds);
          }
          setProg({ k, n, graded, eta: togo ? secs(togo, sc, timing) : null, checking });
        },
      });
      const said = deepen
        ? `${(graded - unchecked).toLocaleString()} checked at Fast${unchecked ? `; ${unchecked.toLocaleString()} it couldn't grade, whose reads stand` : ""}`
        : `${nDecisions(graded - unanswered)} graded in this run${unanswered ? `, ${unanswered.toLocaleString()} without a grade` : ""}`;
      setMsg(`${r.stopped ? "Stopped" : "Done"}: ${said}${r.stopped ? "; the rest are graded when you ask again" : ""}.${unkept ? " These grades aren't saved: this browser isn't keeping Lizard's data right now." : ""}`);
    } catch (e) {
      setError(`Grading stopped: ${e instanceof Error ? e.message : String(e)}. What was graded is kept.`);
    } finally {
      setProg(null);
      ac.current = null;
    }
  };
  const start = () => void run(scope, hands, answeredIds(decisions), null);
  const deepen = (every: boolean) => {
    const p = deepenPlan(hands, decisions, every);
    void run("all", p.hands, new Set(), p.left, p.reads);
  };
  const plan = planned?.scope === scope && planned.of === hands ? planned.left : null;
  const asks = plan ? STREETS.reduce((t, s) => t + plan[s], 0) : 0;

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
          <button type="button" onClick={start} disabled={!hands.length} className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-50">
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
      <p className="text-muted">
        {SCOPE_NOTES[scope]}
        {plan && !running && (asks ? ` ${nDecisions(asks)} to ask: about ${fmtDur(secs(plan, scope))} ${transport === "worker" ? "in this browser" : "on your solver"} (an estimate; the clock follows the real pace once it runs).` : " Every decision here has its answer.")}
      </p>
      {running && (
        <p role="status" aria-label="Grading progress">
          {status.phase === "booting" ? `Starting the solver in this browser${status.message ? `: ${status.message}` : ""}. ` : ""}
          Hand {prog.k.toLocaleString()} of {prog.n.toLocaleString()}: {nDecisions(prog.graded)} {prog.checking ? "checked" : "graded"}{prog.eta != null && prog.eta > 0 ? `, about ${fmtDur(prog.eta)} left` : ""}.{prog.checking ? "" : " A decision already graded isn't asked again."}
        </p>
      )}
      {toCheck && toCheck.every.reads.size > 0 && (
        <div role="group" aria-label="Check at Fast" className="flex flex-wrap items-center gap-2">
          <span>
            {toCheck.flagged.reads.size
              ? `${nDecisions(toCheck.flagged.reads.size)} flagged: a low-confidence read, one off the mix or losing 2% of the pot or more, or one that couldn't be graded.`
              : "No read is flagged."}
          </span>
          {toCheck.flagged.reads.size > 0 && (
            <button type="button" onClick={() => deepen(false)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Check {toCheck.flagged.reads.size.toLocaleString()} at Fast (about {fmtDur(secs(toCheck.flagged.left, "all"))})
            </button>
          )}
          {toCheck.every.reads.size > toCheck.flagged.reads.size && (
            <button type="button" onClick={() => deepen(true)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Check every read, {toCheck.every.reads.size.toLocaleString()} (about {fmtDur(secs(toCheck.every.left, "all"))})
            </button>
          )}
        </div>
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

const nHands = (n: number) => `${n.toLocaleString()} ${n === 1 ? "hand" : "hands"}`;

/** The report over the graded decisions of `hands` (the hands the filters show, of `of` kept). */
export function GradeReport({ decisions, hands, of }: { decisions: DecisionRecord[]; hands: HandRecord[]; of?: number }) {
  const byId = useMemo(() => new Map(hands.map((h) => [h.id, h])), [hands]);
  // (decisions of hands no longer kept are left out)
  const ds = useMemo(() => decisions.filter((d) => byId.has(d.handId)), [decisions, byId]);
  const rp = useMemo(() => report(ds), [ds]);
  const [leak, setLeak] = useState<Leak | null>(null);
  const [params] = useSearchParams();
  if (!ds.length)
    return of !== undefined && hands.length < of && decisions.length > 0 ? (
      <section aria-label="Report" className="space-y-1 text-sm">
        <h2 className="text-lg font-semibold">Report</h2>
        <p className="text-muted">None of your graded decisions is in the {nHands(hands.length)} the filters show.</p>
      </section>
    ) : null;
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
        {of !== undefined && hands.length < of && (
          <p className="text-muted">
            Over the {nHands(hands.length)} the filters show, of {of.toLocaleString()} kept.
          </p>
        )}
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
            Graded by EV: {nDecisions(a.ev)}, {bbs(a.lost)} lost in all, {a.avgPct}% of the pot a decision on average.
          </p>
        )}
        {rp.low.n > 0 && (
          <p>
            {nDecisions(rp.low.n)} graded on a low-confidence read{rp.low.lost > 0 ? `, ${bbs(rp.low.lost)} of that EV` : ""}: a guide, not a solve's verdict, until it's checked at Fast.
          </p>
        )}
        {rp.agree.n > 0 && (
          <p aria-label="Checked at Fast">
            {rp.agree.n.toLocaleString()} {rp.agree.n === 1 ? "read" : "reads"} checked at Fast: {rp.agree.same} graded alike, {rp.agree.worse} worse at Fast, {rp.agree.better} better.
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

      {rp.byBasis.length > 0 && <GroupTable title="What the grades stand on" first="Answer" rows={rp.byBasis} ev noUngraded />}
      {rp.versions && (
        <p aria-label="Versions graded on" className="text-xs text-muted">
          {rp.versions} The preflop charts come with the solver build. A library version is its spot&rsquo;s ranges and bet tree. {rp.versions.includes("unknown") ? VERSION_UNKNOWN : ""}
        </p>
      )}

      {rp.leaks.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">Leaks</h3>
          <ul aria-label="Leaks" className="space-y-1">
            {rp.leaks.map((l) => (
              <li key={`${l.kind}|${l.key}`} className="flex flex-wrap items-center gap-2">
                <span>
                  {leakText(l)}
                  {l.versions && <span className="text-xs text-muted"> {l.versions}</span>}
                </span>
                <button type="button" onClick={() => setLeak(leak?.key === l.key && leak.kind === l.kind ? null : l)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                  {leak?.key === l.key && leak.kind === l.kind ? "Hide" : "Show"} its decisions
                </button>
                <Link to={withParams(params, { drill: leakParam(l) })} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                  Drill this leak
                </Link>
              </li>
            ))}
          </ul>
          {leak && <DecisionList title={leak.key} ds={ds.filter(leakTest(leak))} byId={byId} />}
        </div>
      )}
      {rp.leaks.length === 0 && (
        <p className="text-muted">
          No clear leak yet: a leak is a frequency 10 points off the answer's over 15 decisions, a preflop situation under 80% in the mix over 15, or a spot after the flop losing 0.5bb a decision over 10.
        </p>
      )}

      <GroupTable title="By street" first="Street" rows={rp.byStreet} />
      {rp.byPf.length > 0 && <GroupTable title="Preflop, by situation (against the charts, by frequency)" first="Situation" rows={rp.byPf} />}
      {rp.bySpot.length > 0 && <GroupTable title="After the flop, by spot" first="Spot" rows={rp.bySpot} ev />}
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
          <p className="text-xs text-muted">The answer's: the same hands at the same decisions, from what graded each (the charts preflop; after the flop the library, a read or a solve).</p>
        </div>
      )}
      {rp.mistakes.length > 0 && <DecisionList title="The most EV lost" ds={rp.mistakes} byId={byId} />}
      {rp.offChart.length > 0 && <DecisionList title="Off the chart (the charts play it under 3% of the time)" ds={rp.offChart} byId={byId} />}
      {rp.offRead.length > 0 && <DecisionList title="Off the read (played under 3% of the time, no EV to weigh it)" ds={rp.offRead} byId={byId} />}
    </section>
  );
}

function leakText(l: Leak): string {
  const low = l.low ? `, ${l.low} on a low-confidence read` : "";
  if (l.kind === "freq") return `${l.key}: you ${pct(l.you)}, the answer ${pct(l.gto)} (${l.n} decisions${low})`;
  if (l.kind === "pf") return `${l.key}: ${pct(l.inMix)} in the mix against the charts (${l.n} decisions)`;
  return `${l.key}: ${bbs(l.avg)} lost a decision (${l.n} decisions${low})`;
}

function GroupTable({ title, first, rows, ev, noUngraded }: { title: string; first: string; rows: Group[]; ev?: boolean; noUngraded?: boolean }) {
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
              {!noUngraded && <th className="pr-3 text-right font-normal">Not graded</th>}
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
                {!noUngraded && <td className="pr-3 text-right">{r.n - r.graded}</td>}
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
  const [params] = useSearchParams();
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
              <Link to={withParams(params, { hand: d.handId })} className="text-xs underline">
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
  if (d.evLossBb != null) parts.push(d.evLossBb > 0 ? `${d.roughEv ? "≈" : ""}${bbs(d.evLossBb)} lost (${d.lossPct}% of the pot)` : "no EV lost");
  if (d.roughEv) parts.push("a move the range almost never takes, so its EV is rough");
  if (d.capped) parts.push("a rough solve can't condemn a line, so this stops at Inaccuracy");
  if (d.note) parts.push(d.note);
  if (d.off) parts.push(d.off);
  parts.push(d.source === "charts" ? "preflop charts, by frequency (not a solve)" : d.label);
  if (d.read) parts.push(`checked at Fast: the read said ${d.read.verdict}${d.read.label ? `, from ${d.read.label}` : ""}`);
  if (d.notChecked !== undefined) parts.push(`Fast couldn't grade it (${d.notChecked})`);
  if (flagged(d)) parts.push("flagged: worth checking at Fast");
  return parts.join(" · ");
}
