// SolverClient: the one object views talk to. It maps modes onto the Advisor's request keys, serializes
// requests (the backends run one solve at a time), supports AbortSignal cancellation for queued and running
// requests, and attaches provenance to every answer.
import type { AdvisorResponse, AdvisorState, PlayMove } from "./protocol";
import { provenanceOf } from "./provenance";
import { recordTiming } from "./timings";
import {
  SolverError,
  type PlayRequest,
  type RuntimeStatus,
  type SolveMode,
  type SolveRequest,
  type SolveResult,
  type SolverTransport,
  type StopCost,
  type TransportKind,
} from "./types";

interface Queued {
  req: SolveRequest;
  resolve: (r: SolveResult) => void;
  reject: (e: unknown) => void;
}

/** Seconds per solve at each mode, [this street, each earlier street solved to narrow the ranges], by backend: the
 * classic app's BUDGETS (solver/gto/static/index.html). Without them the Advisor runs every mode at 4 s + 2 s. */
export const MODE_BUDGETS: Record<TransportKind, Record<SolveMode, [number, number]>> = {
  worker: { quick: [1.5, 0.3], fast: [8, 3], accurate: [60, 12] },
  http: { quick: [1.5, 0.3], fast: [2.5, 2.5], accurate: [30, 12] },
};
/** The browser's solver threads, as the worker's setup picks them (the classic pageHost.threads). */
export const solverThreads = () => (globalThis.crossOriginIsolated ? Math.max(1, Math.min(8, globalThis.navigator?.hardwareConcurrency ?? 1)) : 1);

/** Quick's postflop budgets by street, either backend, sent with "quick" (no second budget for an unsettled street). */
const QUICK_BUDGETS: Record<string, [number, number]> = { flop: [1.5, 0.3], turn: [1.5, 0.3], river: [0.8, 0.3] };
const STREET_BY_CARDS: Record<number, string> = { 3: "flop", 4: "turn", 5: "river" };

/** The mode a request runs at: a Study request runs Quick at Fast. */
export function effectiveMode(state: Pick<AdvisorState, "study">, mode: SolveMode): SolveMode {
  return state.study && mode === "quick" ? "fast" : mode;
}

/** The request keys for a mode on a backend: speed, budget and prior_budget, and quick (postflop Quick only). Study
 * requests never carry quick (classic Study offers Fast and Accurate only; a quick Study 4-way flop errors in the
 * browser), so Quick runs a Study request at Fast. */
export function applyMode(state: AdvisorState, mode: SolveMode, transport: TransportKind = "worker"): AdvisorState {
  const s: AdvisorState = { ...state };
  delete s.quick;
  const eff = effectiveMode(state, mode);
  // (cards counted, not characters: a board may carry separators, "Ks 7d 2c")
  const street = STREET_BY_CARDS[String(state.board ?? "").replace(/[\s,]+/g, "").length / 2];
  const quick = eff === "quick" && street !== undefined;
  const [budget, prior_budget] = quick ? QUICK_BUDGETS[street]! : MODE_BUDGETS[transport][eff];
  s.speed = eff === "quick" ? "fast" : eff;
  s.budget = budget;
  s.prior_budget = prior_budget;
  if (quick) s.quick = true;
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

  /** What stopping a running request costs on this backend. */
  stopCost(): StopCost {
    return this.transport.stopCost();
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
    // (provenance records the mode the request runs at, as sent)
    const ctx = { mode: effectiveMode(req.state, mode), transport: this.transport.kind, solverVersion: this.solverVersion };
    try {
      const sent = applyMode(req.state, mode, this.transport.kind);
      const data = await this.transport.request(sent, {
        progressive: req.play ? false : (req.progressive ?? false),
        signal: req.signal,
        ...(req.play ? { play: req.play } : {}),
        onPartial: req.onPartial
          ? (p: AdvisorResponse) => req.onPartial?.({ data: p, provenance: provenanceOf(p, { ...ctx, partial: true }) })
          : undefined,
      });
      const provenance = provenanceOf(data, { ...ctx, partial: false });
      // (the mode's measured times: a live advice or Study answer, not an opponent's move; a triage solve is Quick's)
      if (!req.play) recordTiming(JSON.stringify(sent), this.transport.kind, provenance.mode, data, provenance);
      item.resolve({ data, provenance });
    } catch (e) {
      item.reject(e instanceof SolverError ? e : new SolverError("solver-error", String(e)));
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  /** A practice opponent's move (Advisor.play): `play.seat` holding `play.hole` draws one from its GTO mix; `state`
   * is the hand from the player practising (hero and hole), as their own advice's. */
  play(
    state: AdvisorState,
    play: PlayRequest,
    opts: { mode?: SolveMode; signal?: AbortSignal } = {},
  ): Promise<SolveResult<PlayMove>> {
    return this.solve({ state, play, mode: opts.mode, signal: opts.signal }) as Promise<SolveResult<PlayMove>>;
  }

  dispose(): void {
    for (const q of this.queue.splice(0)) q.reject(new SolverError("cancelled", "solver disposed"));
    this.transport.dispose();
  }
}
