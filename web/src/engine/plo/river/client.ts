// The page's side of a river solve: one at a time in a worker, the worker's chunk loaded with the first run. Where a
// browser can't start one the same slices run on the page. A cancel asks the worker, which hands back the strategies as
// they stood; a worker that doesn't answer within CANCEL_GRACE_MS (an iteration of a big spot on a slow phone) is ended,
// and there's nothing to show.
import { failureText, runJob, startJob, type RiverInbound, type RiverJob, type RiverOutbound, type RiverProgress, type RiverRequest, type RiverResult, type RiverView } from "./run";

export const CANCEL_GRACE_MS = 10_000;

export interface RiverOutcome {
  cancelled: boolean;
  /** null if it stopped before an iteration finished, or the worker had to be ended */
  result: RiverResult | null;
}

export interface WorkerLike {
  postMessage(m: RiverInbound): void;
  terminate(): void;
  onmessage: ((e: { data: RiverOutbound }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export type WorkerFactory = () => WorkerLike | null;

const startWorker: WorkerFactory = () =>
  typeof Worker === "undefined" ? null : (new Worker(new URL("./river.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike);

interface Active {
  id: number;
  resolve: (o: RiverOutcome) => void;
  reject: (e: Error) => void;
  onProgress?: (p: RiverProgress) => void;
  guard?: ReturnType<typeof setTimeout>;
}

export class RiverClient {
  private worker: WorkerLike | null = null;
  private active: Active | null = null;
  private nextId = 1;
  private inlineStop: (() => void) | null = null;
  /** the last finished turn: its id on the worker, or its job where it ran on the page */
  private lastTurn: { id: number } | { job: RiverJob } | null = null;
  private asks = new Map<number, (v: RiverView | null) => void>();
  private nextAsk = 1;

  constructor(private readonly factory: WorkerFactory = startWorker) {}

  /** Starts a solve (one already running is dropped, its promise resolved as cancelled with no result). */
  run(request: RiverRequest, onProgress?: (p: RiverProgress) => void): Promise<RiverOutcome> {
    this.inlineStop?.();
    const prior = this.active;
    if (prior) {
      this.worker?.postMessage({ type: "cancel", id: prior.id });
      this.finish(prior, () => prior.resolve({ cancelled: true, result: null }));
    }
    const id = this.nextId++;
    this.lastTurn = null;
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker();
      if (!worker) {
        this.runInline(request, onProgress).then(resolve, reject);
        return;
      }
      this.active = { id, resolve, reject, onProgress };
      worker.postMessage({ type: "run", id, request });
    });
  }

  /** The last finished turn's river after closing `closing` on `card` (as "Ah"), or null if there's none to look at. */
  river(closing: number, card: string): Promise<RiverView | null> {
    const t = this.lastTurn;
    if (!t) return Promise.resolve(null);
    if ("job" in t) return Promise.resolve(t.job.riverView(closing, card));
    if (!this.worker) return Promise.resolve(null);
    const ask = this.nextAsk++;
    return new Promise((resolve) => {
      this.asks.set(ask, resolve);
      this.worker!.postMessage({ type: "river", id: t.id, ask, closing, card });
    });
  }

  cancel(): void {
    this.inlineStop?.();
    const a = this.active;
    if (!a || a.guard !== undefined || !this.worker) return;
    this.worker.postMessage({ type: "cancel", id: a.id });
    a.guard = setTimeout(() => {
      if (this.active !== a) return;
      this.discardWorker();
      this.finish(a, () => a.resolve({ cancelled: true, result: null }));
    }, CANCEL_GRACE_MS);
  }

  dispose(): void {
    const a = this.active;
    this.discardWorker();
    if (a) this.finish(a, () => a.resolve({ cancelled: true, result: null }));
    this.inlineStop?.();
  }

  private finish(a: Active, settle: () => void) {
    if (a.guard !== undefined) clearTimeout(a.guard);
    if (this.active === a) this.active = null;
    settle();
  }

  private discardWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.lastTurn = null;
    for (const resolve of this.asks.values()) resolve(null);
    this.asks.clear();
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker) return this.worker;
    let w: WorkerLike | null;
    try {
      w = this.factory();
    } catch {
      w = null;
    }
    if (!w) return null;
    w.onmessage = ({ data }) => this.receive(data);
    w.onerror = () => {
      const a = this.active;
      this.discardWorker();
      if (a) this.finish(a, () => a.reject(new Error("The river solve's worker stopped, most likely out of memory.")));
    };
    return (this.worker = w);
  }

  private receive(m: RiverOutbound) {
    if (m.type === "river") {
      this.asks.get(m.ask)?.(m.view);
      this.asks.delete(m.ask);
      return;
    }
    const a = this.active;
    if (!a || m.id !== a.id) return;
    if (m.type === "progress") a.onProgress?.(m.progress);
    else if (m.type === "done") {
      if (m.result?.street === "turn") this.lastTurn = { id: m.id };
      this.finish(a, () => a.resolve({ cancelled: m.cancelled, result: m.result }));
    }
    else this.finish(a, () => a.reject(new Error(m.message)));
  }

  private async runInline(request: RiverRequest, onProgress?: (p: RiverProgress) => void): Promise<RiverOutcome> {
    let stop = false;
    const halt = () => {
      stop = true;
    };
    this.inlineStop = halt;
    try {
      const job = startJob(request);
      const out = await runJob(job, { stopped: () => stop, onProgress, sliceMs: 12 });
      if (out.result?.street === "turn") this.lastTurn = { job };
      return out;
    } catch (e) {
      throw new Error(failureText(e), { cause: e });
    } finally {
      if (this.inlineStop === halt) this.inlineStop = null;
    }
  }
}
