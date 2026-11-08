// Analyze's grading: the queue that grades your kept hands' decisions in this browser (grading.ts gradeHands, through
// the page's solver: the charts and the flop library, or every street by Quick triage or at Fast, the doubtful reads
// then checked at Fast: triage.ts), and the report over what's graded (report.ts): the grades, what they stand on, the
// leaks and what's too few to call one, the breakdowns (BreakdownPanel.tsx), the frequencies against the answer's, the
// decisions that lost the most, and CSV and JSON export. Every number
// says what it stands on: the charts (by frequency, not a solve), the stored preflop solve (by EV, of a class-level model),
// the library, a read or a solve.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { About } from "@/components/About";
import { Link, useSearchParams } from "react-router";
import { VerdictTag } from "@/components/VerdictTag";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { clearDecisions, putDecisions } from "@/data/hands";
import type { Verdict } from "@/grading/grade";
import { VERSION_UNKNOWN } from "@/grading/version";
import type { Street } from "@/poker/table";
import { MODE_BUDGETS, solverThreads } from "@/solver/client";
import { PF_MODEL } from "@/features/practice/pfGrade";
import { useRuntime } from "@/solver/runtime";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { STREETS } from "./analyze";
import { Breakdowns } from "./BreakdownPanel";
import { DecisionList, GroupTable, RangeCell } from "./DecisionTables";
import { answeredIds, gradeHands, SCOPES, type Ask, type GradeScope } from "./grading";
import { leakParam, withParams } from "./leakDrill";
import { isEquilibriumHand } from "./sessions";
import { basisOf, isGraded, isOk, isPfSolve, LEAK_RULE, leakTest, PF_ROW, report, spotOf, toCSV, toJSON, VERDICTS, type Leak } from "./report";
import { deepenPlan, fmtDur, secondsLeft, toAsk, type Timing } from "./triage";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const pair = ([a, b]: readonly [number, number]) => `${pct(a)} to ${pct(b)}`;
const bbs = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100) / 100}bb`);

/** What the grades stand on, said wherever they are shown. */
export const GRADED_ON =
  `In a game the preflop solve is stored for (6-max at 100bb each, with no ante or straddle, and no rake or 5% capped at 3bb), a preflop decision is graded by EV against that solve wherever its tree holds the spot: an ${PF_MODEL}, and its EVs are against its own ranges. Anywhere else it's graded against the preflop charts by how often your hand takes the action: the charts aren't a solve and have no EVs, so no EV lost is counted. Each says which graded it, and the two are never added together. A hand played in Practice is read as its table read it; a site's history says no rake, so it's read as the game with none. After the flop a decision is graded against what answered it, which it names: the precomputed flop library, a stored turn, a read at once, or a Quick or Fast solve; by EV where that answer has EVs, by frequency where it hasn't. A rough or cut-short solve can't condemn a line: its grade stops at Inaccuracy. The betting rules and equity guesses are never graded against. Tournament hands are graded in chips, with no ICM or bounties.`;

/** What each scope asks of the solver. */
const SCOPE_NOTES: Record<GradeScope, string> = {
  preflop: "Nothing is solved: the charts and the stored preflop solve are read as they stand.",
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
    void toAsk(hands, scope, answeredIds(decisions, hands), { signal: ctl.signal }).then((left) => {
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
        // (the stored solve's file is a fetch, not a street's time, and its read goes with the chart's for one decision)
        const pf = !!state.preflop_solve;
        const timed = !pf && useRuntime.getState().status.phase === "ready";
        const t0 = performance.now();
        const ans = await client.solve({ state, mode: "fast", signal: ctl.signal, ...(pf ? { untimed: true } : {}) });
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
  const start = () => void run(scope, hands, answeredIds(decisions, hands), null);
  const deepen = (every: boolean) => {
    const p = deepenPlan(hands, decisions, every);
    void run("all", p.hands, new Set(), p.left, p.reads);
  };
  const plan = planned?.scope === scope && planned.of === hands ? planned.left : null;
  const asks = plan ? STREETS.reduce((t, s) => t + plan[s], 0) : 0;

  return (
    <section aria-label="Grading" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <h2 className="text-lg font-semibold">Grade your decisions</h2>
      <About label="What grades your decisions">
        <p>{GRADED_ON}</p>
      </About>
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

const NO_EXPLOITS: ReadonlySet<string> = new Set();
const nHands = (n: number) => `${n.toLocaleString()} ${n === 1 ? "hand" : "hands"}`;

/** The report over the graded decisions of `hands` (the hands the filters show, of `of` kept). */
export function GradeReport({ decisions, hands, of, exploits = NO_EXPLOITS }: { decisions: DecisionRecord[]; hands: HandRecord[]; of?: number; exploits?: ReadonlySet<string> }) {
  const byId = useMemo(() => new Map(hands.map((h) => [h.id, h])), [hands]);
  // (decisions of hands no longer kept are left out)
  const ds = useMemo(() => decisions.filter((d) => byId.has(d.handId)), [decisions, byId]);
  // (leaks read from the hands an equilibrium can be read from, as the Plan's are: sessions.ts isEquilibriumHand)
  const eq = useMemo(() => ds.filter((d) => isEquilibriumHand(byId.get(d.handId)!, exploits)), [ds, byId, exploits]);
  const rp = useMemo(() => report(ds, 20, eq), [ds, eq]);
  const apart = useMemo(() => ds.length && ds.reduce((n, d) => n + Number(isGraded(d)), 0) - eq.reduce((n, d) => n + Number(isGraded(d)), 0), [ds, eq]);
  const [leak, setLeak] = useState<Leak | null>(null);
  const [freq, setFreq] = useState<string | null>(null);
  const [params] = useSearchParams();
  const streetOf = useCallback((d: DecisionRecord) => d.street, []);
  const pfOf = useCallback((d: DecisionRecord) => (d.street === "preflop" && !isPfSolve(d) ? d.situation : null), []);
  const pfSolveOf = useCallback((d: DecisionRecord) => (d.street === "preflop" && isPfSolve(d) ? d.situation : null), []);
  const basisKey = useCallback((d: DecisionRecord) => (isGraded(d) ? basisOf(d) : null), []);
  const freqTest = useMemo(() => (freq ? leakTest({ kind: "freq", key: freq }) : null), [freq]);
  const freqDs = useMemo(() => (freqTest ? ds.filter(freqTest) : []), [freqTest, ds]);
  const misses = useMemo(
    () => ds.filter((d) => isGraded(d) && !isOk(d)).sort((x, y) => VERDICTS.indexOf(y.verdict as Verdict) - VERDICTS.indexOf(x.verdict as Verdict) || (y.evLossBb ?? 0) - (x.evLossBb ?? 0)),
    [ds],
  );
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
      <div role="group" aria-label="Summary" className="space-y-1">
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
        {rp.spotEv.n > 0 && (
          <p>
            Graded by EV: {nDecisions(rp.spotEv.n)}, {bbs(rp.spotEv.lost)} of solver EV lost in all, {rp.spotEv.avgPct}% of the pot per decision on average (not what you won).
          </p>
        )}
        {rp.pfEv.n > 0 && (
          <p>
            Graded by the preflop solve: {nDecisions(rp.pfEv.n)}, {bbs(rp.pfEv.lost)} lost in all, an {PF_MODEL}, kept apart from the EV after the flop and never added to it.
          </p>
        )}
        {rp.low.n > 0 && (
          <p>
            {nDecisions(rp.low.n)} graded on a low-confidence read{rp.low.lost > 0 ? `, ${bbs(rp.low.lost)} of that EV` : ""}: a guide, not a solve's verdict, until it's checked at Fast.
          </p>
        )}
        {rp.agree.n > 0 && (
          <p role="group" aria-label="Checked at Fast">
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
        <About label="About these grades">
          <p>{GRADED_ON}</p>
          <p>
            Solver EV lost is measured over graded decisions: it isn&rsquo;t what you won, and no win rate is worked out from it. The preflop solve&rsquo;s
            EVs are of your hand&rsquo;s class against its own ranges.
          </p>
          {rp.versions && (
            <p role="group" aria-label="Versions graded on">
              {rp.versions} The preflop charts come with the solver build. A library version is its spot&rsquo;s ranges and bet tree. {rp.versions.includes("unknown") ? VERSION_UNKNOWN : ""}
            </p>
          )}
        </About>
      </div>

      {misses.length > 0 ? (
        <div id="analyze-misses" className="scroll-mt-16">
          <DecisionList title="Your misses" ds={misses} byId={byId} />
        </div>
      ) : (
        a.graded > 0 && <p>Every decision graded here is in the mix.</p>
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
        </div>
      )}
      {rp.leaks.length === 0 && <p className="text-muted">No clear leak yet.</p>}
      <About label="What makes a leak">
        <p role="group" aria-label="What makes a leak">
          {rp.leaks.length === 0 ? "No clear leak yet. " : ""}
          {LEAK_RULE}
          {apart > 0 ? ` ${nDecisions(apart)} in tournament hands ${apart === 1 ? "is" : "are"} left out of the leaks: their chips aren't big blinds and they're graded with no ICM.` : ""}
        </p>
      </About>
      {rp.thin.length > 0 && (
        <details className="space-y-1">
          <summary className="cursor-pointer text-muted">
            {rp.thin.length.toLocaleString()} {rp.thin.length === 1 ? "row looks" : "rows look"} off but {rp.thin.length === 1 ? "is" : "are"} too few to read
          </summary>
          <ul aria-label="Too few to read" className="space-y-1">
            {rp.thin.map((l) => (
              <li key={`${l.kind}|${l.key}`} className="flex flex-wrap items-center gap-2 text-muted">
                <span>{leakText(l)}</span>
                <button type="button" onClick={() => setLeak(leak?.key === l.key && leak.kind === l.kind ? null : l)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                  {leak?.key === l.key && leak.kind === l.kind ? "Hide" : "Show"} its decisions
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {leak && <DecisionList title={leak.key} ds={eq.filter(leakTest(leak))} byId={byId} />}

      <details className="space-y-4">
        <summary className="cursor-pointer font-semibold">Every breakdown: by seat, street, situation, spot and frequency, and the full lists</summary>
      <div className="mt-2 space-y-4">
      {rp.byBasis.length > 0 && <GroupTable title="What the grades stand on" first="Answer" rows={rp.byBasis} ds={ds} keyOf={basisKey} byId={byId} ev noUngraded />}
      <Breakdowns ds={ds} hands={hands} byId={byId} />
      <GroupTable title="By street" first="Street" rows={rp.byStreet} ds={ds} keyOf={streetOf} byId={byId} />
      {rp.byPf.length > 0 && <GroupTable title="Preflop, by situation (against the charts, by frequency)" first="Situation" rows={rp.byPf} ds={ds} keyOf={pfOf} byId={byId} />}
      {rp.byPfSolve.length > 0 && <GroupTable title="Preflop, by situation (against the preflop solve, by EV: a class-level model, not a full solve)" first="Situation" rows={rp.byPfSolve} ds={ds} keyOf={pfSolveOf} byId={byId} ev />}
      {rp.bySpot.length > 0 && <GroupTable title="After the flop, by spot" first="Spot" rows={rp.bySpot} ds={ds} keyOf={spotOf} byId={byId} ev />}
      {rp.freqs.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">Your frequencies against the answer's</h3>
          <div className="relative scroll-x">
            <table aria-label="Frequencies" className="min-w-full text-left">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="pr-3 font-normal">Decision</th>
                  <th scope="col" className="pr-3 text-right font-normal">Decisions</th>
                  <th scope="col" className="pr-3 text-right font-normal">You</th>
                  <th scope="col" className="whitespace-nowrap pr-3 font-normal">95% range</th>
                  <th scope="col" className="pr-3 text-right font-normal">The answer</th>
                  <th scope="col" className="font-normal">
                    <span className="sr-only">Decisions behind it</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rp.freqs.map((f) => (
                  <tr key={f.label} aria-label={f.label} className="border-t border-border">
                    <th scope="row" className="pr-3 font-normal">{f.label}</th>
                    <td className="pr-3 text-right tabular-nums">{f.n.toLocaleString()}</td>
                    <td className="pr-3 text-right tabular-nums">{pct(f.you)}</td>
                    <td className="whitespace-nowrap pr-3 tabular-nums">
                      <RangeCell k={f.k} n={f.n} />
                    </td>
                    <td className="pr-3 text-right tabular-nums">{pct(f.gto)}</td>
                    <td className="text-right">
                      <button type="button" aria-expanded={freq === f.label} aria-label={`Decisions: ${f.label}`} onClick={() => setFreq(freq === f.label ? null : f.label)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                        Decisions
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            The answer's: the same hands at the same decisions, from what graded each (preflop the charts, which aren't a solve, or on a row of its own the preflop solve, a class-level model; after the flop the library, a read or a solve). The range is a 95% interval on your rate. The
            squeeze row leaves out the blinds, whose decisions don't store a caller. VPIP, PFR, check-raise and the river barrel as such are in Your stats, counted from the histories: a decision doesn't store what you did before it.
          </p>
          {freq && freqDs.length > 0 && <DecisionList title={freq} ds={freqDs} byId={byId} />}
        </div>
      )}
      {rp.mistakes.length > 0 && <DecisionList title="The most EV lost" ds={rp.mistakes} byId={byId} />}
      {rp.offChart.length > 0 && <DecisionList title="Off the chart (the charts play it under 3% of the time)" ds={rp.offChart} byId={byId} />}
      {rp.offRead.length > 0 && <DecisionList title="Off the read (played under 3% of the time, no EV to weigh it)" ds={rp.offRead} byId={byId} />}
      </div>
      </details>
    </section>
  );
}

function leakText(l: Leak): string {
  const low = l.low ? `, ${l.low} on a low-confidence read` : "";
  const n = `${l.n.toLocaleString()} decisions`;
  if (l.kind === "freq") return `${l.key}: you ${pct(l.you)} (95% range ${pair(l.range)}), the answer ${pct(l.gto)} (${n}${low})`;
  if (l.kind === "pf") return `${l.key}: ${pct(l.inMix)} in the mix against the ${l.key.endsWith(PF_ROW) ? "preflop solve" : "charts"} (95% range ${pair(l.range)}, ${n})`;
  return `${l.key}: ${bbs(l.avg)} lost per decision (95% range ${bbs(l.range[0])} to ${bbs(l.range[1])}, ${n}${low})`;
}
