// Study's preflop Solver source (ROADMAP Phase 0; classic study.js's pf "solver": request, pfSolve, pfKeep, pfLoad):
// preflop, the node from the engine's class-level solve of the page's own game (gto/pf_study.py: every class's mix and
// EVs at that model's equilibrium, its flops valued by the flop library's realization) in place of the charts' mix.
// A game the engine holds no solve of answers "pf_unsolved" (the standard 6-max 100bb games are stored and answer at
// once); the page solves it only when asked, in chunks of PF_CHUNK seconds ("preflop_solve": {"run"}) one after
// another, with progress and Stop, asking the node shown again after each chunk so it converges in view. A finished
// solve is exported and kept in IndexedDB (at most PF_KEEP), and handed back to the worker ("load") once it no longer
// holds that game (a reload, another game solved since).
import { openDB, type IDBPDatabase } from "idb";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { SolveResult } from "@/solver/types";
import { studyRequest, type StudyHand } from "./studyState";

/** seconds a chunk runs; the iterations a 6-max solve takes to its target (the bar before the first measure) */
export const PF_CHUNK = 4;
export const PF_ITERS = 1000;
/** a solve with a target stops once it gets no nearer in this many iterations (pf_study.STALL_BACK) */
export const PF_STALL_BACK = 200;
/** finished solves kept in the browser (~0.3 MB each at 6-max), the oldest dropped */
export const PF_KEEP = 6;

/** A solve's status (pf_study.Solve.status). */
export interface PfStatus {
  key: string;
  label: string;
  iterations: number;
  done: boolean;
  stalled?: boolean;
  max_iterations?: number;
  /** mbb/hand a seat; 0 for a small tree, which runs to max_iterations */
  target_mbb?: number;
  /** precomputed and shipped with the site */
  stored?: boolean;
  /** solved earlier in this browser and handed back */
  cached?: boolean;
  /** mbb/hand a seat gains by best-responding, on average (null before the first measure) */
  mbb?: number | null;
  seconds?: number;
}

export const pfStatusOf = (r: AdvisorResponse | undefined): PfStatus | null =>
  r && r.pf_solve && typeof r.pf_solve === "object" ? (r.pf_solve as PfStatus) : null;

/** Finished above its target, getting no nearer (its status's "stalled"; one kept in the browser by its iterations
 * short of the cap). */
export const pfStalled = (p: PfStatus | null): boolean =>
  Boolean(
    p &&
      p.done &&
      !p.stored &&
      (p.stalled || (p.cached && (p.target_mbb ?? 0) > 0 && (p.mbb ?? 0) > (p.target_mbb ?? 0) && p.iterations < (p.max_iterations ?? Infinity))),
  );

/** "about 5 s", "about 3 min" */
export const pfMinutes = (s: number) => (s < 90 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : `${Math.round(s / 60)} min`);

/** The page's game: its request without the line, so every preflop node of one table shares a solve. */
export function pfGame(h: StudyHand): string {
  const st: Record<string, unknown> = { ...studyRequest(h) };
  for (const k of ["preflop", "flop", "turn", "river", "board", "preflop_solve"]) delete st[k];
  return JSON.stringify(st);
}

// ---- the solves kept in the browser: IndexedDB "lizard-pf" (a cache apart from the app's database: droppable, never
// in a backup), keyed by the solver build and the game (pf_study's Spec.key): a pack fits only the tree it was run on
export interface PfKept {
  blob: string;
  it: number;
  mbb: number | null;
  at: number;
}

let dbP: Promise<IDBPDatabase> | null = null;
function pfDb(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  dbP ??= openDB("lizard-pf", 1, { upgrade: (d) => void d.createObjectStore("solves") });
  return dbP;
}

export const pfCacheKey = (version: string, key: string) => `${version || "dev"}/${key}`;

export const pfCache = {
  async get(k: string): Promise<PfKept | null> {
    try {
      return ((await (await pfDb())?.get("solves", k)) as PfKept | undefined) ?? null;
    } catch {
      return null;
    }
  },
  async del(k: string): Promise<void> {
    try {
      await (await pfDb())?.delete("solves", k);
    } catch {
      /* (a cache: nothing lost) */
    }
  },
  async put(k: string, v: PfKept): Promise<void> {
    try {
      const d = await pfDb();
      if (!d) return;
      await d.put("solves", v, k);
      const keys = (await d.getAllKeys("solves")) as string[];
      const vals = (await d.getAll("solves")) as PfKept[];
      const old = keys.map((x, i) => [x, vals[i]?.at ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(PF_KEEP);
      for (const [x] of old) await d.delete("solves", x);
    } catch {
      /* (a cache: nothing lost) */
    }
  },
};

/** The page's solver call for one request (its mode and signal bound). */
export type PfAsk = (state: AdvisorState) => Promise<SolveResult>;

/** A Study node's answer; a game the worker holds no solve of but this browser kept is handed back first. */
export async function askNode(ask: PfAsk, state: AdvisorState, version: string): Promise<SolveResult> {
  const r = await ask(state);
  if (r.data.study !== "pf_unsolved" || typeof r.data.key !== "string") return r;
  const k = pfCacheKey(version, r.data.key);
  const kept = await pfCache.get(k);
  if (!kept?.blob) return r;
  const r2 = await ask({ ...state, preflop_solve: { load: kept.blob, iterations: kept.it } });
  if (r2.data.study === "node") return r2;
  // (another tree's, or not a solve: dropped, and the game offered as unsolved)
  if (r2.data.study === "pf_unsolved") await pfCache.del(k);
  return r;
}

/** A solve run from the page: chunk after chunk until done, stopped or failed. */
export interface PfRun {
  game: string;
  /** the request it runs (a node of the game) */
  base: AdvisorState;
  it: number;
  mbb: number | null;
  target?: number;
  max?: number;
  done: boolean;
  /** seconds since it started */
  secs: number;
  t0: number;
  running: boolean;
  /** Stop asked: it ends once the chunk running answers (the worker keeps the solve, so Continue goes on from it) */
  stop: boolean;
  err: string | null;
}

export const newRun = (h: StudyHand): PfRun => ({
  game: pfGame(h),
  base: studyRequest(h),
  it: 0,
  mbb: null,
  done: false,
  secs: 0,
  t0: Date.now(),
  running: true,
  stop: false,
  err: null,
});

/** How far along the bar is: exploitability falls about as 1/iterations^1.2, so from the last measure the share of the
 * way to the target; before it (or for a small tree, which has no target) the iterations against the usual count. */
export function pfFraction(run: Pick<PfRun, "done" | "mbb" | "target" | "it" | "max">): number {
  if (run.done) return 1;
  if (run.mbb != null && run.target) return Math.min(0.97, Math.pow(Math.min(1, run.target / run.mbb), 1 / 1.2));
  return Math.min(0.97, run.it / (run.target === 0 && run.max ? run.max : PF_ITERS));
}

/** Runs a game's solve: a chunk, its status into the run (onUpdate), the node shown asked again (refresh), until done
 * or stopped; a finished solve is exported and kept. */
export async function runPf(
  run: PfRun,
  ask: PfAsk,
  version: string,
  { onUpdate, refresh }: { onUpdate: (run: PfRun) => void; refresh: () => Promise<void> },
): Promise<PfRun> {
  run.running = true;
  onUpdate(run);
  while (!run.stop) {
    let r: SolveResult;
    try {
      r = await ask({ ...run.base, preflop_solve: { run: PF_CHUNK } });
    } catch (e) {
      run.err = e instanceof Error ? e.message : String(e);
      break;
    }
    const s = r.data.study === "pf_progress" ? pfStatusOf(r.data) : null;
    if (!s) {
      run.err = typeof r.data.error === "string" ? r.data.error : typeof r.data.reason === "string" ? r.data.reason : "the solve gave no progress";
      break;
    }
    Object.assign(run, { it: s.iterations, mbb: s.mbb ?? null, target: s.target_mbb, max: s.max_iterations, done: s.done, secs: (Date.now() - run.t0) / 1000 });
    onUpdate(run);
    if (run.done || run.stop) break;
    await refresh();
  }
  run.running = false;
  onUpdate(run);
  await refresh();
  if (run.done && !run.err) {
    try {
      const r = await ask({ ...run.base, preflop_solve: { export: true } });
      const x = r.data;
      if (x.study === "pf_export" && typeof x.blob === "string" && typeof x.key === "string")
        await pfCache.put(pfCacheKey(version, x.key), { blob: x.blob, it: Number(x.iterations) || 0, mbb: typeof x.mbb === "number" ? x.mbb : null, at: Date.now() });
    } catch {
      /* (not kept: it solves again next time) */
    }
  }
  return run;
}
