// The one-size view (ROADMAP Phase 8; a port of the classic solver/gto/static/simple.js's run and verdict): at a
// heads-up decision after the flop where the player to act can bet, the street solved from there with one bet size at
// that decision, for each candidate (25% to 150% of the pot, the river 200% too, all-in where the tree offers it),
// and with every candidate to mix freely (the full menu); facing a bet, the same with one raise size (2.5x to 5x the
// bet, all-in where offered). The best single size keeps the most EV for the player betting (or raising); each size's
// EV given up is the full menu's EV less its own, in % of the pot (advisor.py Advisor._one_size_view).
// One request a solve (the Study state plus "one_size": "full", then each size), asked at Fast, so the page shows
// progress, can stop between or during solves, and keeps what it has: the runs here, one per spot, for the page's life.
import type { AdvisorActionStat, AdvisorState, RangeGridData } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";

export interface OneSizeRow {
  /** "33%", "all-in", "2.5x", or "full" (every size mixed) */
  size: string;
  actions: string[];
  freq: number[];
  /** the range's EV from here, bb */
  ev_bb: number;
  iterations?: number;
  exploitability_pct?: number;
  seconds?: number;
  grid: RangeGridData;
  /** stopped once clearly behind the best: its EV given up as precise as it was then */
  cut?: boolean;
}

/** The engine's `one_size` block (Advisor._one_size_view). */
export interface OneSizeAnswer {
  street?: string;
  kind?: "bet" | "raise";
  actor?: string;
  pot_bb?: number;
  stack_bb?: number;
  candidates?: string[];
  /** the order to solve the sizes in: those the full menu bets most first */
  order?: string[];
  /** facing a bet: each multiple's raise, its total and its size after calling (% of the pot) */
  raises?: Record<string, { to: number; pct: number }>;
  target_pct?: number;
  /** a tournament's notes (every solve pays prize equity) */
  tournament?: string[];
  full?: OneSizeRow | null;
  rows?: (OneSizeRow & { loss_pct?: number })[];
  [key: string]: unknown;
}

export type RunStatus = "idle" | "running" | "stopped" | "done" | "error";

export interface Run {
  key: string;
  street: string | null;
  kind: "bet" | "raise";
  status: RunStatus;
  /** the latest answer's one_size less its rows */
  meta: OneSizeAnswer | null;
  candidates: string[] | null;
  full: OneSizeRow | null;
  rows: Record<string, OneSizeRow>;
  /** the solve running */
  cur: string | null;
  error: string | null;
  /** seconds each answer took */
  secs: number[];
  /** stopped by its Stop button (else by leaving: showing it again carries on) */
  userStopped: boolean;
  /** the latest answer's provenance (its transport and solver build) */
  prov: Provenance | null;
  gen: number;
  abort: AbortController | null;
  onUpdate?: (run: Run) => void;
}

// seconds a solve takes before any has answered here (upstream's measures with threads: scripts/bench_browser.mjs and
// bench_one_size.py), and the candidates before the answer names them (advisor.ONE_SIZES, ONE_SIZES_RIVER, ONE_RAISES)
export const EST: Record<"wasm" | "server", Record<string, number>> = { wasm: { flop: 0.3, turn: 1.5, river: 0.05 }, server: { flop: 0.2, turn: 1, river: 0.05 } };
const N_SIZES: Record<string, number> = { flop: 7, turn: 7, river: 8 };
const N_RAISES = 4;
// the request fields that pick the speed and its budgets: a spot's run is the same at either speed
const SPEED_KEYS = ["speed", "budget", "prior_budget", "quick", "early"];

const PASSIVE = new Set(["check", "call", "fold"]);

/** Whether Study offers the view: heads-up after the flop, solved (not an answer at once), where the player can bet
 * (a check is offered) or raise (facing a bet with a raise or an all-in to choose). */
export function offersOneSize(res: { street?: string; approximate?: unknown; multiway?: boolean; actions?: AdvisorActionStat[] }): boolean {
  const acts = res.actions ?? [];
  const canSize = acts.some((a) => a.action === "check") || (acts.some((a) => a.action === "fold") && acts.some((a) => /^(raise|all-in)/.test(a.action)));
  return Boolean(res.street) && res.street !== "preflop" && !res.approximate && !res.multiway && canSize;
}

/** "raise" facing a bet (fold and call to choose from), else "bet". */
export const kindOf = (actions: AdvisorActionStat[] | undefined): "bet" | "raise" =>
  actions && !actions.some((a) => a.action === "check") && actions.some((a) => a.action === "fold") ? "raise" : "bet";

/** A spot's key: its request less the speed and the one-size label. */
export function baseKey(state: AdvisorState | Record<string, unknown>): string {
  const st: Record<string, unknown> = { ...state };
  for (const k of SPEED_KEYS) delete st[k];
  delete st.one_size;
  return JSON.stringify(st);
}

export const runs = new Map<string, Run>();

export function runOf(state: AdvisorState | Record<string, unknown>, street?: string | null, kind?: "bet" | "raise"): Run {
  const key = baseKey(state);
  let run = runs.get(key);
  if (!run) {
    run = { key, street: street ?? null, kind: kind ?? "bet", status: "idle", meta: null, candidates: null, full: null, rows: {}, cur: null, error: null, secs: [], userStopped: false, prov: null, gen: 0, abort: null };
    runs.set(key, run);
  }
  return run;
}

/** The next solve: the full menu first (its answer names the candidates and their order), then each size. */
export const nextOf = (run: Run): string | null => (!run.full ? "full" : ((run.meta?.order ?? run.candidates ?? []).find((c) => !run.rows[c]) ?? null));
export const doneOf = (run: Run) => (run.full ? 1 : 0) + (run.candidates ?? []).filter((c) => run.rows[c]).length;
export const totalOf = (run: Run) => (run.candidates ? run.candidates.length : run.kind === "raise" ? N_RAISES : (N_SIZES[run.street ?? "turn"] ?? 7)) + 1;

/** An answer's one_size into the run: its spot, the candidates, the full menu's row and every size's row it has. */
export function merge(run: Run, o: OneSizeAnswer): Run {
  const { rows, full } = o;
  const meta: OneSizeAnswer = { ...o };
  for (const k of ["rows", "full", "best", "tied"]) delete meta[k];
  run.meta = meta;
  run.street = meta.street ?? run.street;
  run.kind = meta.kind ?? run.kind;
  run.candidates = meta.candidates ?? run.candidates;
  if (full) run.full = full;
  for (const r of rows ?? []) {
    const row: OneSizeRow & { loss_pct?: number } = { ...r };
    delete row.loss_pct;
    run.rows[row.size] = row;
  }
  return run;
}

export interface Verdict {
  /** each size in hand, with its EV given up against the full menu (% of the pot; null before the full menu's row) */
  rows: (OneSizeRow & { loss_pct: number | null })[];
  best: string | null;
  /** the sizes as good as the best within the two solves' precision (the larger of their exploitabilities) */
  tied: string[];
}

/** The verdict over the rows in hand (as advisor.py one_size_summary). */
export function summarize(run: Run): Verdict {
  const pot = run.meta?.pot_bb ?? 1, full = run.full;
  const cands = run.candidates ?? [];
  const order = [...cands, ...Object.keys(run.rows).filter((s) => !cands.includes(s))];
  const rows = order
    .filter((s) => run.rows[s])
    .map((s) => {
      const r = run.rows[s]!;
      return { ...r, loss_pct: full ? Math.round(((full.ev_bb - r.ev_bb) / Math.max(pot, 1e-9)) * 1e5) / 1e3 : null };
    });
  if (!rows.length) return { rows, best: null, tied: [] };
  const top = rows.reduce((a, r) => (r.ev_bb > a.ev_bb ? r : a));
  const tol = (r: OneSizeRow) => (Math.max(r.exploitability_pct ?? 0, top.exploitability_pct ?? 0) / 100) * pot;
  return { rows, best: top.size, tied: rows.filter((r) => r !== top && top.ev_bb - r.ev_bb <= tol(r)).map((r) => r.size) };
}

/** Seconds left: the solves still to do at the pace the answers came (the first one aside: it carries the narrowing of
 * the streets before), else the estimate. */
export function etaOf(run: Run, mode: "wasm" | "server" = "wasm"): number {
  const left = totalOf(run) - doneOf(run);
  const per = run.secs.length > 1 ? run.secs.slice(1).reduce((a, b) => a + b, 0) / (run.secs.length - 1) : (EST[mode][run.street ?? "turn"] ?? 1);
  return Math.max(0, left * per);
}

/** The page's solver call: the answer's data and provenance; throws once stopped (the signal aborted). */
export type Ask = (state: AdvisorState, signal: AbortSignal) => Promise<{ data: { one_size?: OneSizeAnswer; error?: unknown }; provenance: Provenance }>;

const now = () => (typeof performance === "object" ? performance.now() : Date.now()) / 1000;

/** Runs a spot's solves one request at a time until every size is in, it's stopped or one fails. */
export async function start(run: Run, state: AdvisorState, ask: Ask, onUpdate?: (run: Run) => void): Promise<Run> {
  if (onUpdate) run.onUpdate = onUpdate;
  if (run.status === "running") return run;
  run.status = "running";
  run.error = null;
  run.userStopped = false;
  const gen = ++run.gen;
  const upd = () => run.onUpdate?.(run);
  for (let label; (label = nextOf(run)); ) {
    run.cur = label;
    const ac = (run.abort = new AbortController());
    upd();
    const t0 = now();
    let r: Awaited<ReturnType<Ask>> | null = null, failed: string | null = null;
    try {
      r = await ask({ ...state, one_size: label }, ac.signal);
    } catch (e) {
      failed = ac.signal.aborted ? null : `Request failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    // started again meanwhile: the new loop carries on
    if (run.gen !== gen) return run;
    run.abort = null;
    run.cur = null;
    if (run.status !== "running") return run;
    if (ac.signal.aborted) {
      run.status = "stopped";
      upd();
      return run;
    }
    const o = r?.data.one_size;
    if (failed || !o) {
      run.status = "error";
      run.error = failed ?? (typeof r?.data.error === "string" ? r.data.error : "No answer.");
      upd();
      return run;
    }
    run.secs.push(now() - t0);
    run.prov = r!.provenance;
    merge(run, o);
  }
  run.status = "done";
  upd();
  return run;
}

/** Shows a run's updates through `fn` until the returned function is called. */
export function watch(run: Run, fn: (run: Run) => void): () => void {
  run.onUpdate = fn;
  return () => {
    if (run.onUpdate === fn) run.onUpdate = undefined;
  };
}

/** Stops a run in flight (its request too); what's in hand stays. `user`: its Stop button (Continue carries on);
 * else leaving it (showing it again carries on by itself). */
export function stop(run: Run, user = false): void {
  if (run.status !== "running") return;
  run.status = "stopped";
  run.userStopped = user;
  run.abort?.abort();
  run.onUpdate?.(run);
}

/** The share of the range that bets (or raises: neither checks, folds nor calls). */
export const betShare = (r: Pick<OneSizeRow, "actions" | "freq">) => r.actions.reduce((t, n, i) => t + (PASSIVE.has(n) ? 0 : (r.freq[i] ?? 0)), 0);

export const sizeName = (s: string) => (s === "full" ? "Every size" : s === "all-in" ? "All-in" : s);
