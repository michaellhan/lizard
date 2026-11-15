// Running a custom flop report: its flops solved one after another in the solver worker (the page's thread only sends
// requests and stores small answers), the report written to this browser after every flop, so a pause, a closed tab or
// a crash loses at most the flop in hand. One report solves at a time: the worker is one thread, and two reports would
// only take turns in it. The run lives in this module, not in a page, so moving between pages doesn't stop it; a page
// shows it through useReportRun.
import { useSyncExternalStore } from "react";
import type { FlopReportRecord } from "@/data/db";
import { putFlopReport } from "@/data/flopReports";
import { SolverError, type SolveResult } from "@/solver/types";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { flopsToGo, reportSpot, solveFlop, type Ask } from "./customReport";

/** What a run needs of the solver: useSolver's client. */
export interface RunClient {
  solve(req: { state: AdvisorState; mode: FlopReportRecord["mode"]; signal: AbortSignal }): Promise<SolveResult<AdvisorResponse>>;
}

export interface RunState {
  /** the report as it stands, kept or not */
  rec: FlopReportRecord;
  running: boolean;
  /** the flop being solved */
  current: string | null;
  /** why the last run stopped short, where it wasn't a pause */
  error: string | null;
  /** the record couldn't be written here (no database): what's solved holds for this page only */
  unsaved: boolean;
}

/** what a report's requests let the worker keep of its solves, MB (its own budget is 700; worker-edits.mjs): a report
 * reuses none of its flops, so they needn't push out a Study session's */
export const REPORT_CACHE_MB = 256;

const runs = new Map<string, RunState>();
const listeners = new Set<() => void>();
let active: { id: string; ac: AbortController } | null = null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function publish(id: string, s: RunState) {
  runs.set(id, s);
  for (const l of listeners) l();
}

/** The report solving now, if any. */
export const runningReport = (): string | null => active?.id ?? null;

/** A report's run as this page knows it (null: none started or seen in this page). */
export function runOf(id: string): RunState | null {
  return runs.get(id) ?? null;
}

/** Make a record known to the runs (read from the database, or new), unless a run of it is already known here. */
export function adopt(rec: FlopReportRecord): RunState {
  const have = runs.get(rec.id);
  if (have && (have.running || have.rec.updatedAt >= rec.updatedAt)) return have;
  const s: RunState = { rec, running: false, current: null, error: null, unsaved: false };
  publish(rec.id, s);
  return s;
}

/** Forget a report (it was deleted). Its run, if solving, is stopped first. */
export function forget(id: string) {
  if (active?.id === id) active.ac.abort();
  runs.delete(id);
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The run of a report, kept current. */
export function useReportRun(id: string | null): RunState | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? (runs.get(id) ?? null) : null),
    () => null,
  );
}

/** Which report is solving now, kept current. */
export function useRunningReport(): string | null {
  return useSyncExternalStore(subscribe, runningReport, () => null);
}

/** Stop a report's run: the flop in hand is dropped (its solve cancelled in the worker), the rest kept. */
export function pauseRun(id: string) {
  if (active?.id === id) active.ac.abort();
}

/** Solve a report's flops not yet tried, in order, until all are or it's paused. Resolves once it stops. Refused (false)
 * while another report solves. `now`: the clock (tests). */
export async function startRun(rec: FlopReportRecord, client: RunClient, now: () => number = Date.now): Promise<boolean> {
  if (active) return false;
  const base = reportSpot(rec);
  if (!base) {
    publish(rec.id, { rec, running: false, current: null, error: "This report's spot can't be read.", unsaved: false });
    return true;
  }
  const ac = new AbortController();
  active = { id: rec.id, ac };
  let r = rec;
  let unsaved = runs.get(rec.id)?.unsaved ?? false;
  let error: string | null = null;
  const show = (current: string | null, running = true) => publish(r.id, { rec: r, running, current, error, unsaved });
  const keep = async (nudge: boolean) => {
    try {
      unsaved = !(await putFlopReport(r, nudge));
    } catch (e) {
      // (a full disk or a closed database: the run goes on in this page, and says what's not kept)
      console.error("A flop report couldn't be stored:", e);
      unsaved = true;
    }
  };
  const ask: Ask = async (state) => {
    const res = await client.solve({ state: { ...state, cache_mb: REPORT_CACHE_MB }, mode: r.mode, signal: ac.signal });
    // (the seats and the pot come from the first root answered: out of position acts first on the flop)
    if (!r.seats && res.data.street === "flop" && !state.flop?.length && res.data.actor && res.data.opponent)
      r = { ...r, seats: [String(res.data.actor), String(res.data.opponent)], pot: res.data.pot_bb ?? 0 };
    return res;
  };
  try {
    for (const fl of flopsToGo(r)) {
      if (ac.signal.aborted) break;
      show(fl.f);
      const t0 = performance.now();
      try {
        const got = await solveFlop(ask, base, fl);
        r = { ...r, done: [...r.done, { ...got, seconds: Math.round((performance.now() - t0) / 10) / 100 }] };
      } catch (e) {
        if (e instanceof SolverError && e.kind === "cancelled") break;
        if (ac.signal.aborted) break;
        // (the solver itself failing ends the run; a flop it answered without a solve is left out and counted)
        if (e instanceof SolverError) throw e;
        r = { ...r, left: [...r.left, { f: fl.f, why: message(e) }] };
      }
      const finished = flopsToGo(r).length === 0;
      r = { ...r, status: finished ? "done" : "paused", updatedAt: now() };
      await keep(finished);
    }
  } catch (e) {
    error = message(e);
  } finally {
    const status = flopsToGo(r).length ? "paused" : "done";
    if (status !== r.status) {
      r = { ...r, status, updatedAt: now() };
      await keep(false);
    }
    active = null;
    show(null, false);
  }
  return true;
}
