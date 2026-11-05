// The page's side of a river solve: one at a time in a worker, the worker's chunk loaded with the first run. Where a
// browser can't start one the same slices run on the page. A cancel asks the worker, which hands back the strategies as
// they stood; a worker that doesn't answer within CANCEL_GRACE_MS (an iteration of a big spot on a slow phone) is ended,
// and there's nothing to show.
import { failureText, runJob, startJob, type RiverInbound, type RiverOutbound, type RiverProgress, type RiverRequest, type RiverResult } from "./run";

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
    const a = this.active;
    if (!a || m.id !== a.id) return;
    if (m.type === "progress") a.onProgress?.(m.progress);
    else if (m.type === "done") this.finish(a, () => a.resolve({ cancelled: m.cancelled, result: m.result }));
    else this.finish(a, () => a.reject(new Error(m.message)));
  }

  private async runInline(request: RiverRequest, onProgress?: (p: RiverProgress) => void): Promise<RiverOutcome> {
    let stop = false;
    const halt = () => {
      stop = true;
    };
    this.inlineStop = halt;
    try {
      return await runJob(startJob(request), { stopped: () => stop, onProgress, sliceMs: 12 });
    } catch (e) {
      throw new Error(failureText(e), { cause: e });
    } finally {
      if (this.inlineStop === halt) this.inlineStop = null;
    }
  }
}
