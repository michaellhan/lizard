// SolverClient: the one object views talk to. It maps modes onto the Advisor's request keys, serializes
// requests (the backends run one solve at a time), supports AbortSignal cancellation for queued and running
// requests, and attaches provenance to every answer.
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { provenanceOf } from "./provenance";
import {
  SolverError,
  type RuntimeStatus,
  type SolveMode,
  type SolveRequest,
  type SolveResult,
  type SolverTransport,
} from "./types";

interface Queued {
  req: SolveRequest;
  resolve: (r: SolveResult) => void;
  reject: (e: unknown) => void;
}

export function applyMode(state: AdvisorState, mode: SolveMode): AdvisorState {
  const s: AdvisorState = { ...state };
  delete s.quick;
  if (mode === "quick") {
    s.quick = true;
    s.speed = "fast";
  } else {
    s.speed = mode;
  }
  return s;
}

export class SolverClient {
  private queue: Queued[] = [];
  private running = false;
  readonly transport: SolverTransport;
  readonly solverVersion: string;

  constructor(transport: SolverTransport, solverVersion: string) {
    this.transport = transport;
    this.solverVersion = solverVersion;
  }

  status(): RuntimeStatus {
    return this.transport.status();
  }

  onStatus(cb: (s: RuntimeStatus) => void): () => void {
    return this.transport.onStatus(cb);
  }

  prefetch(state: AdvisorState): void {
    this.transport.prefetch?.(state);
  }

  solve(req: SolveRequest): Promise<SolveResult> {
    if (req.signal?.aborted) return Promise.reject(new SolverError("cancelled", "cancelled"));
    return new Promise<SolveResult>((resolve, reject) => {
      const item: Queued = { req, resolve, reject };
      this.queue.push(item);
      req.signal?.addEventListener(
        "abort",
        () => {
          const i = this.queue.indexOf(item);
          if (i >= 0) {
            // not started: drop it here; a running one is stopped by the transport
            this.queue.splice(i, 1);
            reject(new SolverError("cancelled", "cancelled"));
          }
        },
        { once: true },
      );
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const item = this.queue.shift();
    if (!item) return;
    this.running = true;
    const { req } = item;
    const mode = req.mode ?? "fast";
    const ctx = { mode, transport: this.transport.kind, solverVersion: this.solverVersion };
    try {
      const data = await this.transport.request(applyMode(req.state, mode), {
        progressive: req.progressive ?? false,
        signal: req.signal,
        onPartial: req.onPartial
          ? (p: AdvisorResponse) => req.onPartial?.({ data: p, provenance: provenanceOf(p, { ...ctx, partial: true }) })
          : undefined,
      });
      item.resolve({ data, provenance: provenanceOf(data, { ...ctx, partial: false }) });
    } catch (e) {
      item.reject(e instanceof SolverError ? e : new SolverError("solver-error", String(e)));
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  dispose(): void {
    for (const q of this.queue.splice(0)) q.reject(new SolverError("cancelled", "solver disposed"));
    this.transport.dispose();
  }
}
