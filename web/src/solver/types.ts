// The typed interface between Lizard's UI and any solver backend. Views depend on this file only; transports
// (in-browser Pyodide worker, local/remote Python HTTP) implement SolverTransport.
import type { AdvisorResponse, AdvisorState, WorkerSetup } from "./protocol";

/** Speed/accuracy presets the upstream Advisor implements (see docs/ACCURACY.md). */
export type SolveMode = "quick" | "fast" | "accurate";

export type TransportKind = "worker" | "http";

/** Where an answer came from. Every number Lizard shows carries one of these. */
export type ResultSource =
  | "library" // precomputed solution (flop library entry / stored turn)
  | "live" // solved now (CFR), in the browser or on a local server
  | "charts" // preflop mixed-frequency charts
  | "preflop-solve" // the preflop game's equilibrium solve (pf_study)
  | "rules" // heuristic betting rules (multiway 5+ / fallback)
  | "equity" // equity-based fallback
  | "unknown";

export interface Provenance {
  source: ResultSource;
  /** the answer is labelled approximate by the solver (ran short of its accuracy target, or a heuristic) */
  approximate: boolean;
  /** distance from equilibrium in % of the pot, where measured */
  exploitabilityPct?: number;
  /** the accuracy target the mode aims for, % of the pot */
  targetPct?: number;
  iterations?: number;
  /** wall-clock seconds the backend spent */
  seconds?: number;
  /** precomputed library spot id, e.g. "srp_btn_bb" */
  librarySpot?: string;
  /** why a fallback answered */
  fallbackReason?: string;
  mode: SolveMode;
  transport: TransportKind;
  /** solver build: upstream gto-solver commit and Lizard bundle version */
  solverVersion: string;
  /** a partial (in-progress) answer, superseded by a later one */
  partial: boolean;
  receivedAt: number;
}

export interface SolveRequest {
  state: AdvisorState;
  mode?: SolveMode;
  /** stream approximate answers first (instant estimate, then the live solve's progress looks) */
  progressive?: boolean;
  signal?: AbortSignal;
  onPartial?: (r: SolveResult) => void;
}

export interface SolveResult<T = AdvisorResponse> {
  data: T;
  provenance: Provenance;
}

export type SolverErrorKind =
  | "cancelled"
  | "boot-failed" // runtime/bundle could not load
  | "unreachable" // HTTP transport could not connect
  | "solver-error" // the Advisor raised / answered {error}
  | "stuck" // the worker stopped answering pings
  | "bad-request";

export class SolverError extends Error {
  readonly kind: SolverErrorKind;
  constructor(kind: SolverErrorKind, message: string) {
    super(message);
    this.name = "SolverError";
    this.kind = kind;
  }
}

export type RuntimePhase = "idle" | "booting" | "ready" | "busy" | "failed";

export interface RuntimeStatus {
  phase: RuntimePhase;
  transport: TransportKind;
  /** the worker's human-readable boot stage */
  message?: string;
  setup?: WorkerSetup;
  crossOriginIsolated: boolean;
  error?: string;
}

/** A backend that can answer Advisor requests. */
export interface SolverTransport {
  readonly kind: TransportKind;
  /** Resolve with the final answer; call onPartial for intermediate ones. Reject with SolverError. */
  request(
    state: AdvisorState,
    opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void },
  ): Promise<AdvisorResponse>;
  /** Hint: fetch the library entries this state will need. */
  prefetch?(state: AdvisorState): void;
  /** Subscribe to runtime status; returns an unsubscribe function. */
  onStatus(cb: (s: RuntimeStatus) => void): () => void;
  status(): RuntimeStatus;
  dispose(): void;
}
