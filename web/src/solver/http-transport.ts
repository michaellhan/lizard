// Optional transport: the upstream local Python server (solver/gto/server.py: `python -m gto.server --port 8765`),
// native numpy + the compiled C core, several times faster than the browser on flops. Also usable for a remote
// Python host the user runs themselves. Endpoints: POST /advise (state JSON -> answer JSON), POST /cancel (stops
// the solve in progress; its /advise answers {"cancelled": true}), POST /play (a practice opponent's move: {state, seat,
// hole, seed}), GET /health.
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { SolverError, type PlayRequest, type RuntimeStatus, type SolverTransport, type StopCost } from "./types";

export interface HttpTransportOptions {
  /** e.g. "http://127.0.0.1:8765" (no trailing slash needed) */
  url: string;
  fetchImpl?: typeof fetch;
}

export class HttpTransport implements SolverTransport {
  readonly kind = "http" as const;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private listeners = new Set<(s: RuntimeStatus) => void>();
  private st: RuntimeStatus;

  constructor(opts: HttpTransportOptions) {
    this.url = opts.url.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.st = { phase: "idle", transport: "http", crossOriginIsolated: false };
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

  /** Always cheap: /cancel stops a solve or a move, and the server stays up with what it holds. */
  stopCost(): StopCost {
    return "cheap";
  }

  /** GET /health: true when the server answers. */
  async probe(): Promise<boolean> {
    try {
      const r = await this.fetchImpl(`${this.url}/health`, { cache: "no-store" });
      this.setStatus(r.ok ? { phase: "ready", message: `Local solver at ${this.url}` } : { phase: "failed", error: `health ${r.status}` });
      return r.ok;
    } catch {
      this.setStatus({ phase: "failed", error: `no solver at ${this.url}` });
      return false;
    }
  }

  async request(
    state: AdvisorState,
    opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void; play?: PlayRequest },
  ): Promise<AdvisorResponse> {
    if (opts.signal?.aborted) throw new SolverError("cancelled", "cancelled");
    const onAbort = () => {
      // ask the server to stop the running solve; its /advise then answers {"cancelled": true}
      void this.fetchImpl(`${this.url}/cancel`, { method: "POST" }).catch(() => {});
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    this.setStatus({ phase: "busy" });
    try {
      let r: Response;
      try {
        r = await this.fetchImpl(`${this.url}/${opts.play ? "play" : "advise"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts.play ? { state, ...opts.play } : state),
        });
      } catch (e) {
        this.setStatus({ phase: "failed", error: String(e) });
        throw new SolverError("unreachable", `could not reach the solver at ${this.url}`);
      }
      const body = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as AdvisorResponse;
      this.setStatus({ phase: "ready", error: undefined });
      if (body.cancelled) throw new SolverError("cancelled", "cancelled");
      // (an advice {error} on a 200 is that spot's answer, as the worker hands it on: a queue keeps going; a move has to be one)
      if (!r.ok || (opts.play && typeof body.error === "string")) {
        throw new SolverError("solver-error", typeof body.error === "string" ? body.error : `HTTP ${r.status}`);
      }
      return body;
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  dispose(): void {
    this.setStatus({ phase: "idle" });
  }
}
