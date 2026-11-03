// In-browser transport: the upstream Pyodide worker (solver/gto/static/worker.js, copied unchanged into
// public/solver/ by scripts/build-solver-assets.mjs). One request runs at a time (the worker is single-threaded);
// SolverClient queues the rest.
//
// Cancellation, as the worker supports it:
//  - cross-origin isolated page: a SharedArrayBuffer handed over once ({stop}); writing the running request's id
//    into slot 1 makes Advisor.should_stop() true, and the solve stops within ~0.1 s keeping the worker's caches;
//  - otherwise: the worker is terminated and rebooted on the next request (runtime from cache, ~1.5 s).
import type { AdvisorResponse, AdvisorState, WorkerInbound, WorkerOutbound } from "./protocol";
import { SolverError, type RuntimeStatus, type SolverTransport } from "./types";

export interface WorkerTransportOptions {
  /** URL of the folder holding worker.js, solver.zip and pf/ (must end with "/") */
  assetBase: string;
  /** cache-busting bundle version (a 10-hex-digit hash enables the worker's Cache API copy) */
  version: string;
  /** base URL of the precomputed library (index.json, <spot>/<flop>.bin); same origin */
  libraryBase: string;
  /** injectable for tests */
  createWorker?: (url: string) => Worker;
  crossOriginIsolated?: boolean;
}

interface InFlight {
  id: number;
  resolve: (r: AdvisorResponse) => void;
  reject: (e: SolverError) => void;
  onPartial?: (r: AdvisorResponse) => void;
  cleanup: () => void;
}

export class WorkerTransport implements SolverTransport {
  readonly kind = "worker" as const;
  private worker: Worker | null = null;
  private stop: Int32Array | null = null;
  private nextId = 1;
  private current: InFlight | null = null;
  private listeners = new Set<(s: RuntimeStatus) => void>();
  private st: RuntimeStatus;
  private readonly opts: WorkerTransportOptions;
  private readonly isolated: boolean;

  constructor(opts: WorkerTransportOptions) {
    this.opts = opts;
    this.isolated = opts.crossOriginIsolated ?? (typeof self !== "undefined" && self.crossOriginIsolated === true);
    this.st = { phase: "idle", transport: "worker", crossOriginIsolated: this.isolated };
  }

  workerUrl(): string {
    const q = new URLSearchParams({ v: this.opts.version, lib: this.opts.libraryBase });
    return `${this.opts.assetBase}worker.js?${q.toString()}`;
  }

  status(): RuntimeStatus {
    return this.st;
  }

  onStatus(cb: (s: RuntimeStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.st);
    return () => this.listeners.delete(cb);
  }

  private setStatus(patch: Partial<RuntimeStatus>) {
    this.st = { ...this.st, ...patch };
    for (const l of this.listeners) l(this.st);
  }

  /** Start the runtime now (it takes several seconds cold); requests also start it. */
  boot(): void {
    this.ensureWorker();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const make = this.opts.createWorker ?? ((url: string) => new Worker(url));
    const w = make(this.workerUrl());
    this.worker = w;
    this.setStatus({ phase: "booting", message: "Starting the solver…", error: undefined });
    w.onmessage = (e: MessageEvent<WorkerOutbound>) => this.onMessage(e.data);
    w.onerror = (e: ErrorEvent) => {
      const msg = e.message || "the solver worker failed to load";
      this.setStatus({ phase: "failed", error: msg });
      this.failCurrent(new SolverError("boot-failed", msg));
    };
    if (this.isolated && typeof SharedArrayBuffer !== "undefined") {
      const sab = new SharedArrayBuffer(8);
      this.stop = new Int32Array(sab);
      this.post({ stop: sab });
    }
    return w;
  }

  private post(m: WorkerInbound) {
    this.worker?.postMessage(m);
  }

  private onMessage(m: WorkerOutbound) {
    if ("status" in m) {
      const ready = m.status.startsWith("Solving");
      this.setStatus({
        phase: ready ? (this.current ? "busy" : "ready") : "booting",
        message: m.status,
        ...(m.setup ? { setup: m.setup } : {}),
      });
      return;
    }
    if ("pong" in m) return;
    const cur = this.current;
    if (!cur || m.id !== cur.id) return; // (a superseded request's late message)
    if ("partial" in m) {
      cur.onPartial?.(m.partial);
      return;
    }
    this.current = null;
    cur.cleanup();
    if (this.st.phase === "busy") this.setStatus({ phase: "ready" });
    if ("error" in m) {
      // before the runtime is up, every request answers the boot failure
      if (this.st.phase === "booting") this.setStatus({ phase: "failed", error: m.error });
      cur.reject(new SolverError("solver-error", m.error));
    } else if (m.result?.cancelled) {
      cur.reject(new SolverError("cancelled", "cancelled"));
    } else {
      cur.resolve(m.result);
    }
  }

  private failCurrent(err: SolverError) {
    const cur = this.current;
    this.current = null;
    if (cur) {
      cur.cleanup();
      cur.reject(err);
    }
  }

  request(
    state: AdvisorState,
    opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void },
  ): Promise<AdvisorResponse> {
    if (this.current) return Promise.reject(new SolverError("bad-request", "a request is already running"));
    if (opts.signal?.aborted) return Promise.reject(new SolverError("cancelled", "cancelled"));
    if (this.st.phase === "failed") {
      // a failed boot is retried with a fresh worker
      this.dispose();
    }
    this.ensureWorker();
    const id = this.nextId++;
    return new Promise<AdvisorResponse>((resolve, reject) => {
      const onAbort = () => this.cancel(id);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      this.current = {
        id,
        resolve,
        reject,
        onPartial: opts.onPartial,
        cleanup: () => opts.signal?.removeEventListener("abort", onAbort),
      };
      if (this.st.phase === "ready") this.setStatus({ phase: "busy" });
      this.post({ id, state, early: opts.progressive });
    });
  }

  private cancel(id: number) {
    if (!this.current || this.current.id !== id) return;
    if (this.stop) {
      // the running solve reads this between chunks of iterations and answers {cancelled: true}
      Atomics.store(this.stop, 1, id);
      this.post({ cancel: id }); // (in case it has not started yet: the worker checks before running)
    } else {
      // no shared memory: the only way to stop a synchronous solve is to end the worker
      this.worker?.terminate();
      this.worker = null;
      this.stop = null;
      this.setStatus({ phase: "idle", message: "Solver stopped; it restarts on the next request." });
      this.failCurrent(new SolverError("cancelled", "cancelled"));
    }
  }

  prefetch(state: AdvisorState): void {
    if (!this.worker) return;
    this.post({ prefetch: state });
  }

  dispose(): void {
    this.failCurrent(new SolverError("cancelled", "solver disposed"));
    this.worker?.terminate();
    this.worker = null;
    this.stop = null;
    this.setStatus({ phase: "idle" });
  }
}
