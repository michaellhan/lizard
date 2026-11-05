// In-browser transport: the upstream Pyodide worker (solver/gto/static/worker.js, copied unchanged into
// public/solver/ by scripts/build-solver-assets.mjs). One request runs at a time (the worker is single-threaded);
// SolverClient queues the rest.
//
// Cancellation, as the worker supports it:
//  - cross-origin isolated page: a SharedArrayBuffer handed over once ({stop}); writing the running request's id
//    into slot 1 makes Advisor.should_stop() true, and the solve stops within ~0.1 s keeping the worker's caches.
//    It can be stuck where it can't read that (in the compiled core, say), with every request waiting behind it: so the
//    worker is pinged after a stop, and one that hasn't answered in STUCK_MS is ended, its request rejected as "stuck"
//    (index.html:1173-1189);
//  - otherwise: the worker is terminated and rebooted on the next request (runtime from cache, ~1.5 s).
//
// A boot can stall too: one reload in about 30 under Playwright stayed on "Engine starting" with its downloads done and
// nothing more said, and nothing else would ever end it. So a booting worker that goes quiet is ended and started again
// once, the waiting request sent again, and a second stall is a failed boot, which the next request retries.
import type { AdvisorResponse, AdvisorState, WorkerInbound, WorkerOutbound } from "./protocol";
import { SolverError, type PlayRequest, type RuntimeStatus, type SolverTransport, type StopCost } from "./types";

/** ms a stopped request's worker has to answer a ping (a stop takes ~0.1 s, the longest stretch that doesn't read it a
 * few seconds; the classic STUCK_S) */
export const STUCK_MS = 15_000;

/** ms a booting worker may say nothing: its first step is 25 MB of downloads with no word of progress, on a slow link */
export const BOOT_STALL_MS = 120_000;
/** the same where this browser has booted this version before, so nothing has to come down (a boot takes ~1.5-5 s) */
export const BOOT_STALL_KNOWN_MS = 30_000;

const BOOTED_KEY = "lizard.solver.booted";

function bootedBefore(version: string): boolean {
  try {
    return localStorage.getItem(BOOTED_KEY) === version;
  } catch {
    return false; // (no storage: the longer wait)
  }
}

function noteBooted(version: string): void {
  try {
    localStorage.setItem(BOOTED_KEY, version);
  } catch {
    // (a convenience: the next boot waits longer before giving up)
  }
}

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
  /** what was posted, for a boot started again */
  message: WorkerInbound;
  /** stopped while the worker was still loading: not to be sent to the next one */
  stopped?: boolean;
}

/** Whether the page can share a stop flag with the worker: with one a stop costs nothing, without it a stop ends the
 * worker. Asked without a client, for a page that has yet to want a solver. */
export const sharesStop = (isolated: boolean = typeof self !== "undefined" && self.crossOriginIsolated === true): boolean =>
  isolated && typeof SharedArrayBuffer !== "undefined";

export class WorkerTransport implements SolverTransport {
  readonly kind = "worker" as const;
  private worker: Worker | null = null;
  private stop: Int32Array | null = null;
  private nextId = 1;
  private current: InFlight | null = null;
  private pings = 0;
  /** the flop last told, for each worker to come: what one has fetched ahead goes with it (the classic startWorker
   * forgets what it told the last, and the page tells again) */
  private flop: AdvisorState | null = null;
  /** runs out if the stopped request's worker stays silent; only ever set with that request still current */
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  /** runs out if a booting worker stays silent; re-armed by each thing it says, and gone once it isn't booting */
  private bootTimer: ReturnType<typeof setTimeout> | undefined;
  /** this boot has already been started again once */
  private restarted = false;
  private listeners = new Set<(s: RuntimeStatus) => void>();
  private st: RuntimeStatus;
  private readonly opts: WorkerTransportOptions;
  private readonly isolated: boolean;

  constructor(opts: WorkerTransportOptions) {
    this.opts = opts;
    this.isolated = opts.crossOriginIsolated ?? (typeof self !== "undefined" && self.crossOriginIsolated === true);
    this.st = { phase: "idle", transport: "worker", crossOriginIsolated: this.isolated };
  }

  private get sharesStop(): boolean {
    return sharesStop(this.isolated);
  }

  stopCost(): StopCost {
    return this.sharesStop ? "cheap" : "kills";
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
    if (this.st.phase !== "booting") clearTimeout(this.bootTimer);
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
    this.armBoot();
    w.onmessage = (e: MessageEvent<WorkerOutbound>) => this.onMessage(e.data);
    w.onerror = (e: ErrorEvent) => {
      const msg = e.message || "the solver worker failed to load";
      this.setStatus({ phase: "failed", error: msg });
      this.failCurrent(new SolverError("boot-failed", msg));
    };
    if (this.sharesStop) {
      const sab = new SharedArrayBuffer(8);
      this.stop = new Int32Array(sab);
      this.post({ stop: sab });
    }
    // (ahead of any request, as classic posts it after startWorker: the worker waits for its runtime first)
    if (this.flop) this.post({ prefetch: this.flop });
    return w;
  }

  private post(m: WorkerInbound) {
    this.worker?.postMessage(m);
  }

  private armBoot() {
    clearTimeout(this.bootTimer);
    const limit = !this.restarted && bootedBefore(this.opts.version) ? BOOT_STALL_KNOWN_MS : BOOT_STALL_MS;
    this.bootTimer = setTimeout(() => this.bootStalled(), limit);
  }

  private bootStalled() {
    const cur = this.current;
    this.worker?.terminate();
    this.worker = null;
    this.stop = null;
    if (this.restarted) {
      const why = "The solver didn't start. Try again, or reload the page.";
      this.setStatus({ phase: "failed", error: why });
      this.failCurrent(new SolverError("boot-failed", why));
      return;
    }
    this.restarted = true;
    this.ensureWorker();
    this.setStatus({ message: "The solver stalled while starting, so it's starting again…" });
    if (cur?.stopped) this.failCurrent(new SolverError("cancelled", "cancelled"));
    else if (cur) this.post(cur.message);
  }

  private onMessage(m: WorkerOutbound) {
    if ("status" in m) {
      const ready = m.status.startsWith("Solving");
      this.setStatus({
        phase: ready ? (this.current ? "busy" : "ready") : "booting",
        message: m.status,
        ...(m.setup ? { setup: m.setup } : {}),
      });
      if (ready) {
        this.restarted = false;
        noteBooted(this.opts.version);
      } else {
        this.armBoot();
      }
      return;
    }
    if ("pong" in m) {
      // (the thread isn't stuck; an older ping's answer says nothing of this stop)
      if (m.pong === this.pings) clearTimeout(this.stuckTimer);
      return;
    }
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
    opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void; play?: PlayRequest },
  ): Promise<AdvisorResponse> {
    if (this.current) return Promise.reject(new SolverError("bad-request", "a request is already running"));
    if (opts.signal?.aborted) return Promise.reject(new SolverError("cancelled", "cancelled"));
    if (this.st.phase === "failed") {
      // a failed boot is retried with a fresh worker
      this.dispose();
    }
    this.ensureWorker();
    const id = this.nextId++;
    // (a move is never posted early: worker.js answers it in one go)
    const message: WorkerInbound = opts.play ? { id, state, play: opts.play } : { id, state, early: opts.progressive };
    return new Promise<AdvisorResponse>((resolve, reject) => {
      const onAbort = () => this.cancel(id);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      this.current = {
        id,
        resolve,
        reject,
        onPartial: opts.onPartial,
        message,
        cleanup: () => {
          opts.signal?.removeEventListener("abort", onAbort);
          // (settled: this stop is over, and the next request's long solve is no sign of anything)
          clearTimeout(this.stuckTimer);
        },
      };
      if (this.st.phase === "ready") this.setStatus({ phase: "busy" });
      this.post(message);
    });
  }

  private cancel(id: number) {
    if (!this.current || this.current.id !== id) return;
    this.current.stopped = true;
    if (this.stop) {
      // the running solve reads this between chunks of iterations and answers {cancelled: true}
      Atomics.store(this.stop, 1, id);
      this.post({ cancel: id }); // (in case it has not started yet: the worker checks before running)
      this.watchStop();
    } else {
      // no shared memory: the only way to stop a synchronous solve is to end the worker
      this.endWorker("Solver stopped; it restarts on the next request.", new SolverError("cancelled", "cancelled"));
    }
  }

  /** The ping waits behind a running solve, so its answer means the solve has let go of the thread. */
  private watchStop() {
    if (this.st.phase === "booting") return; // (still loading: its stretches aren't requests)
    this.post({ ping: ++this.pings });
    this.stuckTimer = setTimeout(() => {
      const why = "The solver stopped answering; it restarts on the next request.";
      this.endWorker(why, new SolverError("stuck", why));
    }, STUCK_MS);
  }

  private endWorker(message: string, err: SolverError) {
    this.worker?.terminate();
    this.worker = null;
    this.stop = null;
    this.setStatus({ phase: "idle", message });
    this.failCurrent(err);
  }

  /** With no worker running it waits for the next (a stop has ended the last, say). */
  prefetch(state: AdvisorState): void {
    this.flop = state;
    this.post({ prefetch: state });
  }

  dispose(): void {
    this.failCurrent(new SolverError("cancelled", "solver disposed"));
    this.worker?.terminate();
    this.worker = null;
    this.stop = null;
    this.restarted = false;
    this.setStatus({ phase: "idle" });
  }
}
