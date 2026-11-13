// Your spot's flop report on Reports (customReport.ts): a heads-up flop spot from Study or the Solve page, solved over a
// representative set of flops in the solver worker, drawn with the library report's controls, table and chart.
//
// Two views. Setting one up (`?mine=` the spot's Study link): the spot is checked first (its preflop line must reach a
// heads-up flop, and where it doesn't a pot can be picked), then the set's size, each flop's weight beside it, and the
// tier. Then a report (`?custom=` its id): its run, with progress, Pause and Resume, kept in this browser after every flop
// (data/flopReports.ts) and listed on the Saved page; nothing is solved until asked.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { DeleteButton } from "@/components/DeleteButton";
import type { FlopReportRecord } from "@/data/db";
import { deleteFlopReport, getFlopReport, putFlopReport } from "@/data/flopReports";
import { newId } from "@/data/saved";
import { TEXTURE_GROUPS, texture } from "@/features/practice/texture";
import { describeSetup } from "@/features/solve/setup";
import { describeLine, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import { useSolver } from "@/solver/useSolver";
import type { SolveMode } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { nodeOf, viewsOf, ALL_FLOPS } from "./reports";
import { callersAfter, checkSpot, customProvenance, customReport, customStudyLink, flopsToGo, newFlopReport, openers, potLine, POT_WORDS, reportSpot, seatsIn, type Ask, type PotKind, type SpotCheck } from "./customReport";
import { adopt, forget, pauseRun, startRun, useReportRun, useRunningReport, runOf } from "./customRun";
import { flopSet, FLOP_SET_SIZES, textureShares } from "./flopSets";
import { ReportBody, ReportControls, useReportParams, useReportRows } from "./ReportsPage";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** the tiers a report solves at: Quick's flop answers are reads and cut solves, not the tier's solve */
const TIERS: readonly { mode: SolveMode; label: string; about: string }[] = [
  { mode: "fast", label: "Fast", about: "a few seconds a flop" },
  { mode: "accurate", label: "Accurate", about: "longer a flop, a finer game below the flop" },
];
const TIER_LABEL: Record<SolveMode, string> = { quick: "Quick", fast: "Fast", accurate: "Accurate" };
const BTN = "rounded-md border border-border px-3 py-1 hover:bg-surface-2 disabled:opacity-40";
const MAIN = "rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong disabled:opacity-40";

const spotWords = (h: StudyHand) => {
  const line = describeLine(h);
  return [`${h.players === 2 ? "HU" : `${h.players}-max`} ${h.stack}bb`, ...describeSetup(h.setup), ...line].join(" · ");
};

export function CustomReportPanel({
  mine,
  custom,
  from,
  params,
  set,
  rowLimit,
}: {
  mine: string | null;
  custom: string | null;
  from: "study" | "solve";
  params: URLSearchParams;
  set: (kv: Record<string, string | null>) => void;
  rowLimit: number;
}) {
  if (custom) return <ReportRun key={custom} id={custom} params={params} set={set} rowLimit={rowLimit} />;
  return <ReportSetup key={mine ?? ""} mine={mine ?? ""} from={from} set={set} />;
}

// ---------------------------------------------------------------------------------------------------------------- setup

type Check = { st: "checking" } | ({ st: "done" } & SpotCheck) | { st: "failed"; why: string };

function ReportSetup({ mine, from, set }: { mine: string; from: "study" | "solve"; set: (kv: Record<string, string | null>) => void }) {
  const base: StudyHand | null = useMemo(() => fromSearch(mine), [mine]);
  const getClient = useSolver();
  const settingsMode = useSettings((s) => s.mode);
  const running = useRunningReport();
  const [check, setCheck] = useState<Check>({ st: "checking" });
  const [size, setSize] = useState<number>(25);
  const [mode, setMode] = useState<SolveMode>(settingsMode === "accurate" ? "accurate" : "fast");
  const [name, setName] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!base) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const client = await getClient();
        const ask: Ask = (state) => client.solve({ state, mode: "fast", signal: ac.signal });
        const c = await checkSpot(ask, base);
        if (!ac.signal.aborted) setCheck({ st: "done", ...c });
      } catch (e) {
        if (!ac.signal.aborted) setCheck({ st: "failed", why: message(e) });
      }
    })();
    return () => ac.abort();
  }, [base, getClient]);

  if (!base) return <p role="alert" className="text-sm text-danger">This link doesn&rsquo;t name a spot.</p>;
  const words = spotWords(base);
  const ok = check.st === "done" && check.ok;

  const start = async () => {
    setFailed(null);
    const rec = newFlopReport(base, { id: newId(), name: name.trim() || `${seatsIn(base).join(" vs ")} · ${size} flops · ${TIER_LABEL[mode]}`, from, mode, size, now: Date.now() });
    let kept = false;
    try {
      kept = await putFlopReport(rec, true);
    } catch (e) {
      console.error("A flop report couldn't be stored:", e);
    }
    if (!kept) {
      setFailed("This browser can't keep it (its database can't be used here), so the report wasn't started.");
      return;
    }
    adopt(rec);
    const client = await getClient();
    void startRun(rec, client);
    set({ mine: null, from: null, custom: rec.id });
  };

  return (
    <div className="space-y-3">
      <section aria-label="Your spot" className="space-y-2 panel p-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-medium">Report over flops</h2>
          <span className="text-muted">{words}</span>
          <span className="flex-1" />
          <Link to={from === "solve" ? `/solve?${toSearch(base)}` : `/study?${toSearch(base)}`} className="text-muted underline hover:text-text">
            {from === "solve" ? "Back to Solve" : "Back to Study"}
          </Link>
          <button type="button" onClick={() => set({ mine: null, from: null })} className="text-muted underline hover:text-text">
            Library reports
          </button>
        </div>
        {check.st === "checking" && <p role="status" className="text-muted">Checking the spot…</p>}
        {check.st === "failed" && (
          <p role="alert" className="text-danger">
            The solver couldn&rsquo;t check this spot: {check.why}
          </p>
        )}
        {check.st === "done" && !check.ok && (
          <p role="alert" className="text-warn">
            This spot can&rsquo;t be reported as it is: {check.why}.{check.unfinished ? " Pick the pot below." : ""}
          </p>
        )}
        {check.st === "done" && ok && <p className="text-muted">Heads-up on the flop: {seatsIn(base).join(" and ")}.</p>}
      </section>

      {check.st === "done" && !check.ok && check.unfinished && <PotPicker base={base} onPicked={(h) => set({ mine: toSearch(h) })} />}

      {ok && (
        <form
          aria-label="Report setup"
          className="space-y-3 panel p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running) void start();
          }}
        >
          <fieldset className="space-y-1">
            <legend className="font-medium">Flops</legend>
            <div role="radiogroup" aria-label="Flops to solve" className="flex flex-wrap gap-1.5">
              {FLOP_SET_SIZES.map((n) => (
                <label key={n} className={`cursor-pointer rounded border px-2 py-0.5 ${size === n ? "border-accent bg-accent/15" : "border-border hover:bg-surface-2"}`}>
                  <input type="radio" name="flops" value={n} checked={size === n} onChange={() => setSize(n)} className="sr-only" />
                  {n}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">
              The solver&rsquo;s representative set of {size}: flops picked by how often each is dealt, so each stands for 1/{size} of all {ALL_FLOPS.toLocaleString()} in the averages ({(ALL_FLOPS / size).toFixed(0)} flops). The library&rsquo;s spots store the same sets.
            </p>
            <FlopWeights size={size} />
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="font-medium">Tier</legend>
            <div className="flex flex-wrap gap-3">
              {TIERS.map((t) => (
                <label key={t.mode} className="flex items-center gap-1.5">
                  <input type="radio" name="tier" value={t.mode} checked={mode === t.mode} onChange={() => setMode(t.mode)} />
                  {t.label} <span className="text-muted">({t.about})</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">Each flop is one solve in this browser&rsquo;s solver; a flop the library stores for this exact spot is read from it, as Study does.</p>
          </fieldset>
          <label className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${seatsIn(base).join(" vs ")} · ${size} flops · ${TIER_LABEL[mode]}`} className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!!running} className={MAIN}>
              Solve {size} flops
            </button>
            {running && (
              <span className="text-muted">
                Another report is solving.{" "}
                <button type="button" onClick={() => set({ mine: null, from: null, custom: running })} className="underline hover:text-text">
                  Open it
                </button>{" "}
                to pause it first.
              </span>
            )}
          </div>
          {failed && (
            <p role="alert" className="text-danger">
              {failed}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/** The set's flops and each one's weight, and how close the set's textures come to all flops'. */
function FlopWeights({ size }: { size: number }) {
  const fl = useMemo(() => flopSet(size), [size]);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-text">The {size} flops and their weights</summary>
      <div className="mt-2 space-y-2">
        <table className="text-left">
          <caption className="sr-only">Each texture&rsquo;s share of the set and of all flops</caption>
          <thead className="text-muted">
            <tr>
              <th className="pr-3 font-normal">Texture</th>
              <th className="pr-3 font-normal">In the set</th>
              <th className="font-normal">Of all flops</th>
            </tr>
          </thead>
          <tbody>
            {(["suits", "pair"] as const).flatMap((k) =>
              textureShares(fl, k).map((r) => (
                <tr key={`${k}${r.value}`}>
                  <td className="pr-3">{TEXTURE_GROUPS.find((g) => g.key === k)!.values[r.value] ?? r.value}</td>
                  <td className="pr-3 tabular-nums">{(r.set * 100).toFixed(1)}%</td>
                  <td className="tabular-nums">{(r.all * 100).toFixed(1)}%</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <div className="max-h-60 overflow-auto">
          <table className="text-left">
            <caption className="sr-only">The flops of the set</caption>
            <thead className="sticky top-0 bg-surface-1 text-muted">
              <tr>
                <th className="pr-3 font-normal">Flop</th>
                <th className="pr-3 font-normal">Texture</th>
                <th className="pr-3 font-normal">Dealt</th>
                <th className="font-normal">Weight</th>
              </tr>
            </thead>
            <tbody>
              {fl.map((x) => {
                const t = texture(x.f);
                return (
                  <tr key={x.f}>
                    <td className="pr-3 font-mono">{x.f}</td>
                    <td className="pr-3">{[TEXTURE_GROUPS[1]!.values[t.suits], TEXTURE_GROUPS[2]!.values[t.pair]].join(", ")}</td>
                    <td className="pr-3 tabular-nums" title={`${x.count} of the ${ALL_FLOPS.toLocaleString()} flops are this flop up to suits`}>
                      {((x.count / ALL_FLOPS) * 100).toFixed(2)}%
                    </td>
                    <td className="tabular-nums">{((x.w / ALL_FLOPS) * 100).toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted">Dealt: how often the flop comes, up to suits. Weight: its share of the report&rsquo;s averages.</p>
      </div>
    </details>
  );
}

/** A pot for a spot whose line doesn't reach a heads-up flop: who opens, who calls or 3-bets, walked through the spot's
 * own preflop answers. */
function PotPicker({ base, onPicked }: { base: StudyHand; onPicked: (h: StudyHand) => void }) {
  const getClient = useSolver();
  const ops = openers(base.players);
  const [opener, setOpener] = useState(ops.includes("BTN") ? "BTN" : ops.at(-1)!);
  const callers = callersAfter(base.players, opener);
  const [caller, setCaller] = useState(callers.at(-1)!);
  const [kind, setKind] = useState<PotKind>("srp");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const who = callers.includes(caller) ? caller : callers.at(-1)!;
  const walk = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const client = await getClient();
      const ask: Ask = (state) => client.solve({ state, mode: "fast" });
      onPicked(await potLine(ask, base, opener, who, kind));
    } catch (e) {
      setFailed(message(e));
    } finally {
      setBusy(false);
    }
  };
  const field = "rounded-md border border-border bg-surface-2 px-2 py-1";
  return (
    <form
      aria-label="Pick the pot"
      className="flex flex-wrap items-center gap-2 panel p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void walk();
      }}
    >
      <span className="font-medium">Pot</span>
      <select aria-label="Opener" value={opener} onChange={(e) => setOpener(e.target.value)} className={field}>
        {ops.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <span>opens,</span>
      <select aria-label="Caller" value={who} onChange={(e) => setCaller(e.target.value)} className={field}>
        {callers.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <select aria-label="Pot type" value={kind} onChange={(e) => setKind(e.target.value as PotKind)} className={field}>
        {(Object.keys(POT_WORDS) as PotKind[]).map((k) => (
          <option key={k} value={k}>
            {k === "srp" ? "calls (single-raised pot)" : "3-bets, and the opener calls"}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? "Setting it…" : "Set this pot"}
      </button>
      <span className="basis-full text-xs text-muted">The others fold. Each action is the one this spot&rsquo;s preflop answer plays most.</span>
      {failed && (
        <p role="alert" className="basis-full text-danger">
          That pot can&rsquo;t be set: {failed}
        </p>
      )}
    </form>
  );
}

// ------------------------------------------------------------------------------------------------------------------ run

function ReportRun({ id, params, set, rowLimit }: { id: string; params: URLSearchParams; set: (kv: Record<string, string | null>) => void; rowLimit: number }) {
  const run = useReportRun(id);
  const running = useRunningReport();
  const getClient = useSolver();
  const transport = useSettings((s) => s.transport);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (runOf(id)?.running) return;
    let alive = true;
    void getFlopReport(id)
      .then((r) => {
        if (!alive) return;
        if (r) adopt(r);
        else if (!runOf(id)) setMissing(true);
      })
      .catch(() => alive && !runOf(id) && setMissing(true));
    return () => {
      alive = false;
    };
  }, [id]);

  const rec: FlopReportRecord | null = run?.rec ?? null;
  const base = useMemo(() => (rec ? reportSpot(rec) : null), [rec]);
  const seats = rec?.seats ?? ["OOP", "IP"];
  const p = useReportParams(params, seats);
  const rep = useMemo(() => (rec && base && rec.seats && rec.done.length ? customReport(base, rec.seats, rec.pot, rec.done) : null), [rec, base]);
  const shownRows = useReportRows(rep, p);
  const provenance = useMemo(() => (rec && rep ? customProvenance(rec, transport) : null), [rec, rep, transport]);
  const views = useMemo(() => (rep ? viewsOf(rep) : null), [rep]);
  const byFlop = useMemo(() => new Map((rec?.done ?? []).map((x) => [x.f, x])), [rec]);

  if (missing) return <p role="alert" className="text-sm text-danger">No flop report of that name is kept in this browser.</p>;
  if (!rec) return <p className="text-sm text-muted">Reading the report…</p>;
  if (!base) return <p role="alert" className="text-sm text-danger">This report&rsquo;s spot can&rsquo;t be read.</p>;

  const togo = flopsToGo(rec).length;
  const tried = rec.done.length + rec.left.length;
  const resume = async () => {
    const client = await getClient();
    void startRun(rec, client);
  };
  const linkOf = (f: string) => {
    const fl = byFlop.get(f);
    if (!fl || !rep || !rec.seats) return null;
    const nd = nodeOf(rep, rep.flops.find((x) => x.f === f)!, p.view);
    return nd ? customStudyLink(base, rec.seats, fl, nd.key) : null;
  };
  // (the time a flop takes: solves only, as a flop the library stores is read at once)
  const secs = rec.done.flatMap((x) => (x.source === "live" && typeof x.seconds === "number" ? [x.seconds] : []));
  const each = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : null;
  const studyLink = `/study?${toSearch(base)}`;

  return (
    <div className="space-y-3">
      <section aria-label="Your spot" className="space-y-2 panel p-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-medium">{rec.name}</h2>
          <span className="text-muted">{spotWords(base)}</span>
          <span className="flex-1" />
          <Link to={studyLink} className="text-muted underline hover:text-text">
            Study this spot
          </Link>
          <Link to="/saved" className="text-muted underline hover:text-text">
            Saved
          </Link>
          <button type="button" onClick={() => set({ custom: null })} className="text-muted underline hover:text-text">
            Library reports
          </button>
        </div>
        <p className="text-muted">
          {`${rec.done.length.toLocaleString()} of the ${rec.flops.length} flops solved at ${TIER_LABEL[rec.mode]}`}
          {each !== null ? `, about ${each < 10 ? each.toFixed(1) : Math.round(each)}s a flop` : ""}
          {rec.left.length ? `; ${rec.left.length} left out, not solved (${rec.left[0]!.why})` : ""}
          {run?.running ? "" : togo ? `; paused, ${togo} to go` : "; finished"}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-1.5 w-40 overflow-hidden rounded bg-surface-3" role="progressbar" aria-label="Flops tried" aria-valuemin={0} aria-valuemax={rec.flops.length} aria-valuenow={tried}>
            <span className="block h-full bg-accent" style={{ width: `${(tried / rec.flops.length) * 100}%` }} />
          </span>
          {run?.running ? (
            <>
              <span role="status">
                Solving flop {Math.min(tried + 1, rec.flops.length)} of {rec.flops.length}
                {run.current ? ` (${run.current})` : ""}…
              </span>
              <button type="button" onClick={() => pauseRun(id)} className={BTN}>
                Pause
              </button>
            </>
          ) : (
            togo > 0 && (
              <>
                <button type="button" onClick={() => void resume()} disabled={!!running} className={MAIN}>
                  {tried ? `Resume (${togo} to go)` : `Solve ${togo} flops`}
                </button>
                {running && running !== id && (
                  <span className="text-muted">
                    Another report is solving.{" "}
                    <button type="button" onClick={() => set({ custom: running })} className="underline hover:text-text">
                      Open it
                    </button>
                  </span>
                )}
              </>
            )
          )}
          <span className="flex-1" />
          <DeleteButton
            what="report"
            name={rec.name}
            onDelete={() => {
              forget(id);
              void deleteFlopReport(id).finally(() => set({ custom: null }));
            }}
          />
        </div>
        {run?.error && (
          <p role="alert" className="text-danger">
            The solver stopped: {run.error}
          </p>
        )}
        {run?.unsaved && (
          <p role="alert" className="text-warn">
            The latest flops couldn&rsquo;t be kept in this browser; they show here until the page is closed.
          </p>
        )}
      </section>

      {rep && provenance && (
        <>
          <ReportControls seats={seats} views={views} p={p} set={set} />
          <ReportBody rep={rep} provenance={provenance} p={p} rows={shownRows} set={set} rowLimit={rowLimit} linkOf={linkOf} csvName={`lizard-report-${rec.id}-${p.view}.csv`} allLabel={`All ${rec.done.length} flops solved`} />
        </>
      )}
    </div>
  );
}
