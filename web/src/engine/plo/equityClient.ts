// The page's side of an equity job: one at a time in a worker, the worker's chunk loaded with the first run. Where a
// browser can't start one the same slices run on the page, a turn of the event loop between each. A cancel asks the worker
// (Monte Carlo's runs so far are still a result); a worker that doesn't answer within CANCEL_GRACE_MS is ended.
import { EquityError, EquityJob, type EquityResult } from "./equity";
import { runJob, specOf, type EquityInbound, type EquityOutbound, type EquityRequest } from "./equityRun";

export const CANCEL_GRACE_MS = 1000;

export interface EquityOutcome {
  cancelled: boolean;
  /** null for a cancelled exact count, which has no result */
  result: EquityResult | null;
}

export interface WorkerLike {
  postMessage(m: EquityInbound): void;
  terminate(): void;
  onmessage: ((e: { data: EquityOutbound }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export type WorkerFactory = () => WorkerLike | null;

const startWorker: WorkerFactory = () =>
  typeof Worker === "undefined" ? null : (new Worker(new URL("./equity.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike);

interface Active {
  id: number;
  resolve: (o: EquityOutcome) => void;
  reject: (e: Error) => void;
  onProgress?: (r: EquityResult) => void;
  last: EquityResult | null;
  guard?: ReturnType<typeof setTimeout>;
}

/** What a stopped job has to show: an exact count's numbers mean nothing until every board is in. */
const soFar = (a: Active) => (a.last?.method === "montecarlo" ? a.last : null);

export class EquityClient {
  private worker: WorkerLike | null = null;
  private active: Active | null = null;
  private nextId = 1;
  private inlineStop: (() => void) | null = null;

  constructor(private readonly factory: WorkerFactory = startWorker) {}

  /** Starts a job (a job already running is dropped, its promise resolved as cancelled). */
  run(request: EquityRequest, onProgress?: (r: EquityResult) => void): Promise<EquityOutcome> {
    this.inlineStop?.();
    const prior = this.active;
    if (prior) {
      this.worker?.postMessage({ type: "cancel", id: prior.id });
      this.finish(prior, () => prior.resolve({ cancelled: true, result: soFar(prior) }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker();
      if (!worker) {
        this.runInline(request, onProgress).then(resolve, reject);
        return;
      }
      this.active = { id, resolve, reject, onProgress, last: null };
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
      this.finish(a, () => a.resolve({ cancelled: true, result: soFar(a) }));
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
      if (a) this.finish(a, () => a.reject(new Error("The equity worker stopped.")));
    };
    return (this.worker = w);
  }

  private receive(m: EquityOutbound) {
    const a = this.active;
    if (!a || m.id !== a.id) return;
    if (m.type === "progress") {
      a.last = m.result;
      a.onProgress?.(m.result);
    } else if (m.type === "done") this.finish(a, () => a.resolve({ cancelled: m.cancelled, result: m.result }));
    else this.finish(a, () => a.reject(new EquityError(m.message)));
  }

  private async runInline(request: EquityRequest, onProgress?: (r: EquityResult) => void): Promise<EquityOutcome> {
    const spec = specOf(request);
    if (typeof spec === "string") throw new EquityError(spec);
    let stop = false;
    const halt = () => {
      stop = true;
    };
    this.inlineStop = halt;
    try {
      return await runJob(new EquityJob(spec), { stopped: () => stop, onProgress, sliceMs: 12 });
    } finally {
      if (this.inlineStop === halt) this.inlineStop = null;
    }
  }
}
