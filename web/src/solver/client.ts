// SolverClient: the one object views talk to. It maps modes onto the Advisor's request keys, serializes
// requests (the backends run one solve at a time), supports AbortSignal cancellation for queued and running
// requests, and attaches provenance to every answer.
import type { LibraryStamp } from "@/library/version";
import type { AdvisorResponse, AdvisorState, NodeLockAnswer, NodeLockProgress, NodeLockRequest, PlayMove } from "./protocol";
import { provenanceOf } from "./provenance";
import { recordTiming } from "./timings";
import { withTreeCap, type TreeCap } from "./treeDepth";
import {
  SolverError,
  type PlayRequest,
  type Provenance,
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

/** A node lock that wasn't run, in words the page can show. `lockKind`: "invalid", it makes no sense; "refused", this
 * spot can't honour it. `actions`: where it's the actions that differ, the node's in the live tree. */
export class NodeLockError extends SolverError {
  readonly lockKind: "invalid" | "refused";
  readonly actions?: string[];
  constructor(lockKind: "invalid" | "refused", message: string, actions?: string[]) {
    super("bad-request", message);
    this.name = "NodeLockError";
    this.lockKind = lockKind;
    this.actions = actions;
  }
}

/** The reads at once that read the flop library (solver/gto/advisor.py instant_from_near, _unraked, _off_tree). */
const LIBRARY_READS: ReadonlySet<string> = new Set(["near", "unraked", "off_tree"]);

export class SolverClient {
  private queue: Queued[] = [];
  private running = false;
  readonly transport: SolverTransport;
  readonly solverVersion: string;
  /** the stamps of the library this backend answers from, read when a stored answer first needs one; none for a local
   * server, whose library isn't the page's */
  private readonly libraryStamp?: () => Promise<LibraryStamp | null>;
  /** this device's tree cap, read as each request goes (the setting; solver/treeDepth.ts) */
  private readonly treeCap: () => TreeCap;

  constructor(transport: SolverTransport, solverVersion: string, libraryStamp?: () => Promise<LibraryStamp | null>, treeCap: () => TreeCap = () => "standard") {
    this.transport = transport;
    this.solverVersion = solverVersion;
    this.libraryStamp = libraryStamp;
    this.treeCap = treeCap;
  }

  /** A stored answer's version: the entry the engine names, or for a stored turn, which names none, the whole library's
   * (or the nearest spot's, where it read another). A read at once off the library gets the whole library's. None where the library's index can't be read. */
  private async stamped(data: AdvisorResponse, p: Provenance): Promise<Provenance> {
    // (a read at once off the library, Advisor.instant's "near", "unraked" and "off_tree", is the library read by this
    // build: its stamp has both, grading/version.ts. It names no spot, so the library's is the whole one's. A read of
    // a solve stopped part way or of the street before isn't the library's.)
    const kind = (data.approximate as { source?: unknown } | null | undefined)?.source;
    const readsLibrary = p.source === "instant" && typeof kind === "string" && LIBRARY_READS.has(kind);
    if ((p.source !== "library" && p.source !== "library-turn" && !readsLibrary) || !this.libraryStamp) return p;
    const stamp = await this.libraryStamp().catch(() => null);
    const near = (data.approximate as { near_spot?: unknown } | null | undefined)?.near_spot;
    const spot = data.precomputed?.spot ?? (typeof near === "string" ? near : undefined);
    const board = data.precomputed?.board;
    const libraryVersion = stamp?.(spot, typeof board === "string" ? board : undefined);
    return libraryVersion ? { ...p, libraryVersion } : p;
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
      const sent = withTreeCap(applyMode(req.state, mode, this.transport.kind), this.treeCap(), this.transport.kind);
      const data = await this.transport.request(sent, {
        progressive: req.play ? false : (req.progressive ?? false),
        signal: req.signal,
        ...(req.play ? { play: req.play } : {}),
        onPartial: req.onPartial
          ? (p: AdvisorResponse) => req.onPartial?.({ data: p, provenance: provenanceOf(p, { ...ctx, partial: true }) })
          : undefined,
      });
      const provenance = await this.stamped(data, provenanceOf(data, { ...ctx, partial: false }));
      // (the mode's measured times: a live advice or Study answer, not an opponent's move; a triage solve is Quick's)
      if (!req.play && !req.untimed) recordTiming(JSON.stringify(sent), this.transport.kind, provenance.mode, data, provenance);
      item.resolve({ data, provenance });
    } catch (e) {
      item.reject(e instanceof SolverError ? e : new SolverError("solver-error", String(e)));
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  /** A practice opponent's move (Advisor.play): `play.seat` holding `play.hole` draws one from its GTO mix; `state`
   * is the hand from the player practising (hero and hole), as their own advice's. With a read in it (`locks`, Exploit
   * practice) the worker draws it from the read (engine/exploit_play.py). A local server has no engine/, and its
   * Advisor.play would only reshape the ranges by the read, neither the read nor the equilibrium, so it's sent none: its
   * move is the equilibrium's, and comes back without `profile` (exploit.ts `NO_READ_PLAY`). */
  play(
    state: AdvisorState,
    play: PlayRequest,
    opts: { mode?: SolveMode; signal?: AbortSignal } = {},
  ): Promise<SolveResult<PlayMove>> {
    const sent = this.transport.kind === "worker" || !state.locks ? state : withoutLocks(state);
    return this.solve({ state: sent, play, mode: opts.mode, signal: opts.signal }) as Promise<SolveResult<PlayMove>>;
  }

  /** A true node lock: `state` is the Study state of the node on screen, so the lock lands on the node of the tree a
   * Study solve at this mode builds (engine/study_lock.py). Only the worker's Python has it: a local server would
   * answer its plain advice. Queued, cancelled and failing as any solve; a lock that can't run rejects NodeLockError. */
  async nodeLock(
    state: AdvisorState,
    lock: NodeLockRequest,
    opts: { mode?: SolveMode; signal?: AbortSignal; onProgress?: (p: NodeLockProgress) => void } = {},
  ): Promise<SolveResult<NodeLockAnswer>> {
    if (this.transport.kind !== "worker") {
      throw new NodeLockError("refused", "Node locking runs in the browser's solver, not on a local server: switch the backend to the browser to use it.");
    }
    const r = await this.solve({
      state: { ...state, study: true, nodelock: lock },
      mode: opts.mode,
      signal: opts.signal,
      untimed: true, // (a lock's solve isn't one of the mode's measured times)
      onPartial: opts.onProgress ? (p) => opts.onProgress?.(p.data as unknown as NodeLockProgress) : undefined,
    });
    if (r.data.error) throw new NodeLockError(r.data.lock_error ?? "invalid", r.data.error, r.data.live_actions);
    if (!r.data.node_lock) throw new SolverError("solver-error", "The solver answered without the lock.");
    return r as SolveResult<NodeLockAnswer>;
  }

  dispose(): void {
    for (const q of this.queue.splice(0)) q.reject(new SolverError("cancelled", "solver disposed"));
    this.transport.dispose();
  }
}

/** The state with no read in it. */
function withoutLocks(state: AdvisorState): AdvisorState {
  const rest = { ...state };
  delete rest.locks;
  return rest;
}
