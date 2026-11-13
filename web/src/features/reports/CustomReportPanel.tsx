// Your spot's flop report on Reports (customReport.ts): Study's heads-up flop spot, solved here on a sample of flops a few
// at a time, drawn with the library report's controls, table and chart. It solves nothing until asked, says how many flops
// it stands on and how they were picked, can be stopped, and can solve more; what it solved is kept for the page, so
// leaving and coming back solves nothing again.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { describeLine, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import { useSolver } from "@/solver/useSolver";
import { SolverError } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { nodeOf, viewsOf } from "./reports";
import { CUSTOM_SAMPLE, customProvenance, customReport, customStudyLink, flopClassList, sampleOrder, solveFlop, type Ask, type CustomFlop } from "./customReport";
import { ReportBody, ReportControls, useReportParams, useReportRows } from "./ReportsPage";

interface Kept {
  flops: CustomFlop[];
  /** flops whose root wasn't a solve, with why */
  left: { f: string; why: string }[];
  seats: [string, string] | null;
  pot: number;
}

/** what each spot has solved, for as long as the page is open */
const KEPT = new Map<string, Kept>();
const SEED = 1;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CustomReportPanel({ mine, params, set, rowLimit, sample = CUSTOM_SAMPLE }: { mine: string; params: URLSearchParams; set: (kv: Record<string, string | null>) => void; rowLimit: number; sample?: number }) {
  const base: StudyHand | null = useMemo(() => fromSearch(mine), [mine]);
  const getClient = useSolver();
  const mode = useSettings((s) => s.mode);
  const [kept, setKept] = useState<Kept>(() => KEPT.get(mine) ?? { flops: [], left: [], seats: null, pot: 0 });
  const [run, setRun] = useState<{ done: number; of: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const order = useMemo(() => sampleOrder(SEED), []);
  const seats = kept.seats ?? ["OOP", "IP"];
  const p = useReportParams(params, seats);
  const rep = useMemo(() => (base && kept.seats && kept.flops.length ? customReport(base, kept.seats, kept.pot, kept.flops) : null), [base, kept]);
  const shownRows = useReportRows(rep, p);
  const provenance = useMemo(() => (rep ? customProvenance(kept.flops, mode, kept.left.length) : null), [rep, kept, mode]);
  const views = useMemo(() => (rep ? viewsOf(rep) : null), [rep]);
  const byFlop = useMemo(() => new Map(kept.flops.map((x) => [x.f, x])), [kept.flops]);

  if (!base) return <p role="alert" className="text-sm text-danger">This link doesn&rsquo;t name a spot.</p>;

  const tried = kept.flops.length + kept.left.length;
  const save = (k: Kept) => {
    KEPT.set(mine, k);
    setKept(k);
  };

  const solve = async () => {
    const ac = new AbortController();
    stop.current = ac;
    setFailed(null);
    const next = order.slice(tried, tried + sample);
    setRun({ done: 0, of: next.length });
    let k = kept;
    const client = await getClient();
    const ask: Ask = async (state) => {
      const r = await client.solve({ state, mode, signal: ac.signal });
      // (the seats and the pot come from the first root answered: out of position acts first on the flop)
      if (!k.seats && r.data.street === "flop" && !state.flop?.length && r.data.actor && r.data.opponent) k = { ...k, seats: [String(r.data.actor), String(r.data.opponent)], pot: r.data.pot_bb ?? 0 };
      return r as Awaited<ReturnType<Ask>>;
    };
    try {
      for (const [i, fl] of next.entries()) {
        if (ac.signal.aborted) break;
        try {
          const t0 = performance.now();
          const got = await solveFlop(ask, base, fl);
          // (the flop's wall time here, its root and the nodes read after it)
          k = { ...k, flops: [...k.flops, { ...got, seconds: (performance.now() - t0) / 1000 }] };
        } catch (e) {
          if (e instanceof SolverError && e.kind === "cancelled") break;
          if (e instanceof SolverError) throw e;
          k = { ...k, left: [...k.left, { f: fl.f, why: message(e) }] };
        }
        save(k);
        setRun({ done: i + 1, of: next.length });
      }
    } catch (e) {
      setFailed(message(e));
    } finally {
      save(k);
      setRun(null);
      stop.current = null;
    }
  };

  const linkOf = (f: string) => {
    const fl = byFlop.get(f);
    if (!fl || !rep || !kept.seats) return null;
    const nd = nodeOf(rep, rep.flops.find((x) => x.f === f)!, p.view);
    return nd ? customStudyLink(base, kept.seats, fl, nd.key) : null;
  };
  const line = describeLine(base);
  // (the time a flop takes: solves only, as a flop the library stores is read at once)
  const secs = kept.flops.flatMap((x) => (x.source === "live" && typeof x.seconds === "number" ? [x.seconds] : []));
  const each = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : null;
  const allTried = tried >= flopClassList().length;

  return (
    <div className="space-y-3">
      <section aria-label="Your spot" className="space-y-2 panel p-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-medium">Your spot</h2>
          <span className="text-muted">{line.length ? line.join(" · ") : `${base.players}-handed, ${base.stack}bb`}</span>
          <span className="flex-1" />
          <Link to={`/study?${toSearch(base)}`} className="text-muted underline hover:text-text">
            Back to Study
          </Link>
          <button type="button" onClick={() => set({ mine: null })} className="text-muted underline hover:text-text">
            Library reports
          </button>
        </div>
        <p className="text-muted">
          {tried
            ? `${kept.flops.length.toLocaleString()} of ${flopClassList().length.toLocaleString()} flops solved, picked evenly across textures`
            : `Solves this spot on a sample of the ${flopClassList().length.toLocaleString()} flops, picked evenly across textures, one at a time here`}
          {each !== null ? `, about ${each < 10 ? each.toFixed(1) : Math.round(each)}s a flop` : ""}
          {kept.left.length ? `; ${kept.left.length} left out, not solved (${kept.left[0]!.why})` : ""}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {run ? (
            <>
              <span role="status">
                Solving flop {Math.min(run.done + 1, run.of)} of {run.of}…
              </span>
              <span className="h-1.5 w-40 overflow-hidden rounded bg-surface-3" role="progressbar" aria-label="Flops solved" aria-valuemin={0} aria-valuemax={run.of} aria-valuenow={run.done}>
                <span className="block h-full bg-accent" style={{ width: `${(run.done / run.of) * 100}%` }} />
              </span>
              <button type="button" onClick={() => stop.current?.abort()} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
                Stop
              </button>
            </>
          ) : (
            !allTried && (
              <button type="button" onClick={() => void solve()} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong">
                {tried ? `Solve ${sample} more flops` : `Solve ${sample} flops`}
              </button>
            )
          )}
        </div>
        {failed && (
          <p role="alert" className="text-danger">
            The solver stopped: {failed}
          </p>
        )}
      </section>

      {rep && provenance && (
        <>
          <ReportControls seats={seats} views={views} p={p} set={set} />
          <ReportBody rep={rep} provenance={provenance} p={p} rows={shownRows} set={set} rowLimit={rowLimit} linkOf={linkOf} csvName={`lizard-report-your-spot-${p.view}.csv`} allLabel={`All ${kept.flops.length} flops solved`} />
        </>
      )}
    </div>
  );
}
