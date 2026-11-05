// The typed interface between Lizard's UI and any solver backend. Views depend on this file only; transports
// (in-browser Pyodide worker, local/remote Python HTTP) implement SolverTransport.
import type { AdvisorResponse, AdvisorState, WorkerSetup } from "./protocol";

/** Speed/accuracy presets the upstream Advisor implements (see docs/ACCURACY.md). */
export type SolveMode = "quick" | "fast" | "accurate";

export type TransportKind = "worker" | "http";

/** Where an answer came from. Every number Lizard shows carries one of these. */
export type ResultSource =
  | "library" // precomputed solution (a flop library entry)
  | "library-turn" // a turn read from the flop library's stored turn strategies (approximate: 0.5-0.8% of the pot)
  | "instant" // an answer at once before the solve's own: a stored or nearby solution, an earlier street, a smaller solve
  | "live" // solved now (CFR), in the browser or on a local server
  | "charts" // preflop mixed-frequency charts
  | "preflop-solve" // the preflop game's equilibrium solve (pf_study)
  | "best-response" // exploit practice: a solve with a lock on the opponent, each hand's best response to an assumed profile (features/practice/exploit.ts). Never an equilibrium, and never called solved
  | "push-fold" // the engine's push/fold model at 12bb or less: an all-in range from a jam-or-fold equilibrium by hand class, or a call priced against one (advisor.py _push, _vs_jam); no EVs, and no solve of the full game
  | "rules" // heuristic betting rules (multiway 5+ / fallback)
  | "equity" // equity-based fallback
  | "unknown";

/** The classic app's convergence bands (index.html convergence()): under 3% of the pot converged, under 10% fair,
 * else rough; "approximate" when the solver flags the answer as short of its target. */
export type ConvergenceBand = "converged" | "fair" | "rough" | "approximate";

/** How far a Quick triage read can be trusted, in the Advisor's words (Advisor.triage): high where Fast answers the
 * same (the charts, the library's own spot), medium for a stored turn, a borrowed spot or a Quick solve that settled
 * (88% the same grade as Fast on 1,000 hands), low for the other reads (62%). */
export type Confidence = "high" | "medium" | "low";

export interface Provenance {
  source: ResultSource;
  /** the answer is labelled approximate by the solver (ran short of its accuracy target, or a heuristic) */
  approximate: boolean;
  /** distance from equilibrium in % of the pot, where measured */
  exploitabilityPct?: number;
  /** the accuracy target the mode aims for, % of the pot */
  targetPct?: number;
  /** how settled the measured figure is (the classic app's bands); only where exploitabilityPct is measured */
  band?: ConvergenceBand;
  iterations?: number;
  /** wall-clock seconds the backend spent */
  seconds?: number;
  /** precomputed library spot id, e.g. "srp_btn_bb" */
  librarySpot?: string;
  /** the stored answer's version (library/version.ts), where the library's index is read; never a local server's */
  libraryVersion?: string;
  /** why a fallback answered */
  fallbackReason?: string;
  /** the solver's own words for what an approximate answer was read from */
  approximateLabel?: string;
  /** a 3+-way answer: its exploitability figure is the players' mean best-response gain */
  multiway?: boolean;
  /** a tournament answer: the model its numbers are in (provenance.ts tournamentModelOf) */
  tournament?: string;
  /** what a tournament answer's EVs are in: "prize", chips worth as much prize equity, so never bb won; "chips", a
   * fallback's own chips, which don't go beside those. Unset: bb, as everywhere else. */
  evIn?: "prize" | "chips";
  /** a view built from several solves (the one-size view): what they were (provenance.ts oneSizeProvenance); the
   * preflop solve's own state (precomputed, solved earlier in this browser); which part of the push/fold model a chip
   * answer came from */
  view?: string;
  /** a node lock's answer (features/study/locks.ts): the best response to the read, never an equilibrium; in words */
  lock?: string;
  /** the range a lock's answer plays against, as the read left it, in words: it can be a handful of combos */
  lockRange?: string;
  /** exploit practice (features/practice/exploit.ts): the assumed profile the answer is the best response to */
  exploit?: string;
  /** automatic sizing's answer (features/study/autoSize.ts): its bet sizes chosen by a first solve; in words */
  sizing?: string;
  /** the preflop solve's distance from equilibrium: mbb/hand a seat gains by best-responding, on average */
  mbbPerHand?: number;
  /** a Quick triage read: how far it can be trusted */
  confidence?: Confidence;
  mode: SolveMode;
  /** the solver backend that answered, or "file": a library entry decoded in the page with no solver (drills) */
  transport: TransportKind | "file";
  /** solver build: upstream gto-solver commit and Lizard bundle version */
  solverVersion: string;
  /** a partial (in-progress) answer, superseded by a later one */
  partial: boolean;
  /** a partial answer that's all there will be: stopped, or its solve failed */
  stopped?: boolean;
  receivedAt: number;
}

/** A practice opponent's move: `seat` holding `hole` draws one from its GTO mix (Advisor.play). */
export interface PlayRequest {
  seat: string;
  hole: string;
  /** makes the draw repeatable */
  seed?: number;
}

export interface SolveRequest {
  state: AdvisorState;
  /** ask for this seat's move instead of the state's advice (the state is the hand from the player practising) */
  play?: PlayRequest;
  mode?: SolveMode;
  /** stream approximate answers first (instant estimate, then the live solve's progress looks) */
  progressive?: boolean;
  signal?: AbortSignal;
  onPartial?: (r: SolveResult) => void;
  /** not one of this browser's measured solve times (timings.ts): the engine check's aren't the player's */
  untimed?: boolean;
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

/** What stopping a running request costs: "cheap", it ends there and the solver keeps what it holds; "kills", the solver
 * itself has to be ended, and it reboots on the next request holding nothing. */
export type StopCost = "cheap" | "kills";

/** A backend that can answer Advisor requests. */
export interface SolverTransport {
  readonly kind: TransportKind;
  /** Resolve with the final answer; call onPartial for intermediate ones. Reject with SolverError. */
  request(
    state: AdvisorState,
    opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void; play?: PlayRequest },
  ): Promise<AdvisorResponse>;
  /** Hint: fetch the library entries this state will need. */
  prefetch?(state: AdvisorState): void;
  /** What stopping a running request costs here; known before anything has started. */
  stopCost(): StopCost;
  /** Subscribe to runtime status; returns an unsubscribe function. */
  onStatus(cb: (s: RuntimeStatus) => void): () => void;
  status(): RuntimeStatus;
  dispose(): void;
}
