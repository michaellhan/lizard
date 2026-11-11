// Wire protocol of the solver worker (solver/gto/static/worker.js, reused unchanged from gto-solver) and of the
// optional local Python server (solver/gto/server.py). These types describe the messages exactly as the
// upstream code sends and reads them; the typed, user-facing API is in ./types.ts.
import type { Confidence } from "./types";

/** A game state as gto/advisor.py reads it (money in big blinds unless `bb` is given). Open-ended on purpose:
 * the Advisor accepts many optional keys (ranges, locks, rake, payouts, bounties, study flags...). */
export interface AdvisorState {
  players: number;
  hero?: string;
  hole?: string;
  board?: string;
  stack?: number;
  stacks?: Record<string, number>;
  preflop?: AdvisorAction[];
  flop?: AdvisorAction[];
  turn?: AdvisorAction[];
  river?: AdvisorAction[];
  sizes?: Record<string, number[]>;
  /** the most sized bets and raises a street in its heads-up solves, 1-4 (engine/tree_depth.py; the worker's alone) */
  raises?: number;
  /** this device's tree cap in cells (engine/tree_depth.py, solver/treeDepth.ts; the worker's alone) */
  max_cells?: number;
  ranges?: Record<string, string>;
  /** "fast" (default) or "accurate"; Quick is `quick: true`. */
  speed?: "fast" | "accurate";
  quick?: boolean;
  /** seconds for this street's solve, and for each earlier street solved to narrow the ranges (Advisor.advise) */
  budget?: number;
  prior_budget?: number;
  /** Study mode: answer for whoever acts next with their whole range (Advisor.study). */
  study?: boolean;
  /** ask for the category and equity breakdown of the node (breakdown.py); the answer's `breakdown` */
  breakdown?: boolean;
  /** The analyzer's Quick triage: read from what's in hand, else a Quick solve at its own budgets (Advisor.triage). */
  triage?: boolean;
  [key: string]: unknown;
}

export interface AdvisorAction {
  pos: string;
  action: "fold" | "check" | "call" | "bet" | "raise" | "all-in" | string;
  /** bet size in bb (bet) */
  amount?: number;
  /** raise-to in bb (raise) */
  to?: number;
}

/** page -> worker */
export type WorkerInbound =
  | { ping: number }
  | { cancel: number }
  | { stop: SharedArrayBuffer }
  | { prefetch: AdvisorState }
  | {
      id: number;
      state: AdvisorState;
      /** a practice opponent's move (Advisor.play) */
      play?: { seat: string; hole: string; seed?: number } | null;
      /** post an approximate answer first, then the solve's answer so far at each look */
      early?: boolean;
      /** presolve for this seat (Advisor.presolve) */
      presolve?: string;
    };

/** worker -> page */
export type WorkerOutbound =
  | { status: string; setup?: WorkerSetup }
  | { pong: number }
  | { id: number; partial: AdvisorResponse }
  | { id: number; result: AdvisorResponse }
  | { id: number; error: string };

/** Boot timings and capabilities the worker reports with its "Solving…" status. */
export interface WorkerSetup {
  runtime?: number;
  numpy?: number;
  imports?: number;
  advisors?: number;
  total?: number;
  bundle_cached?: boolean;
  pyc_cached?: boolean;
  /** compiled CFR core loaded (wasm) */
  core?: boolean;
  /** threads in the CFR core (1 + helpers); >= 4 switches Fast to Accurate's turn tree */
  threads?: number;
  mwcore?: boolean;
  mwthreads?: number;
}

/** The Advisor's answer. Shapes vary by request (advice, study node, deal/over, runouts, preflop solve, ...);
 * the fields Lizard reads are typed, the rest stays available. */
/** A range behind an answer that isn't the solve's (advisor.py "off_solution"): why, and on which line. */
export interface OffSolution {
  pos?: string;
  action?: string;
  street?: string;
  why?: "rare" | "filled" | "rules" | string;
  share?: number;
  combos?: number;
  resolved?: boolean;
  trust?: number;
}

export interface AdvisorResponse {
  cancelled?: boolean;
  error?: string;
  skipped?: string | boolean;
  /** an answer to "triage": what read it, in the Advisor's words, and how far to trust the read (Advisor.triage) */
  triage?: { source?: "chart" | "library" | "approx" | "quick" | "rules" | string; confidence?: Confidence; label?: string };
  off_solution?: OffSolution[];
  street?: "preflop" | "flop" | "turn" | "river";
  /** Study: "node" | "deal" | "over" | "runouts" | "pf_unsolved" | "pf_none" | "pf_progress" | "pf_export"; a node lock:
   * "nodelock", and "nodelock_progress" on its way */
  study?: string;
  actor?: string;
  opponent?: string;
  position?: "IP" | "OOP" | string;
  pot_bb?: number;
  /** what a call costs the player to act, in bb (the pot above already holds the bet faced) */
  to_call_bb?: number;
  actions?: AdvisorActionStat[];
  grid?: RangeGridData;
  opponent_grid?: RangeGridData;
  combos?: Record<string, ComboRow[]>;
  /** the node's breakdown, where asked (`breakdown`); null where the betting rules answered, with no solve to break down */
  breakdown?: Breakdown | null;
  /** breakdown.py MADE / DRAWS as [id, label]; combo rows index into them (draws empty on the river) */
  categories?: { made?: [string, string][]; draws?: [string, string][] };
  /** 3-way answers: each opponent's seat, range grid, combos and equity (advisor.py _study_range) */
  opponents?: OpponentRange[];
  range_combos?: number;
  range_ev_bb?: number | null;
  opponent_combos?: number;
  /** null where the answer has no equities (looks, reads at once, 4-way answers) */
  range_eq?: number | null;
  opponent_eq?: number | null;
  /** present when a precomputed library entry answered */
  precomputed?: { spot?: string; [key: string]: unknown };
  /** solve diagnostics */
  solver?: SolverDiagnostics;
  multiway?: boolean;
  /** a node lock's answer (engine/study_lock.py) */
  node_lock?: NodeLockBlock;
  /** a node lock's request that wasn't run: "invalid", it makes no sense; "refused", this spot can't honour it */
  lock_error?: "invalid" | "refused";
  /** with lock_error, where the node's actions in the live tree aren't the ones given (a stored flop's sizes) */
  live_actions?: string[];
  /** what answered when the solve failed: "rules" | "chart" | "equity" */
  fallback?: string;
  fallback_reason?: string;
  notes?: string[];
  seconds?: number;
  /** what the request's heads-up trees were asked under (engine/tree_depth.py): its raise cap and this device's cap */
  tree?: { raises?: number; max_cells?: number };
  [key: string]: unknown;
}

/** What a node lock holds, sent as `state.nodelock` on the Study state of the node on screen (engine/study_lock.py):
 * the state says which node, so there's no line to send. `mix`: a frequency per action, 0..1, summing to 1, played by
 * every hand in `hands`. `expect`: what the page showed, so a tree that disagrees is refused rather than locked. */
export interface NodeLockRequest {
  mix: Record<string, number>;
  hands: "all" | { classes?: string[]; combos?: string[] };
  expect?: { actor?: string; actions?: string[] };
  /** locks kept from other nodes of the same solve, as their answers gave them (engine/study_lock.py `also`) */
  also?: KeptLock[];
}

/** A lock held at another node of a solve: `root` the solve's digest, `line` from its root, `player` 0 OOP, 1 IP. */
export interface KeptLock {
  root: string;
  line: string[];
  player: 0 | 1;
  mix: Record<string, number>;
  hands: NodeLockRequest["hands"];
}

/** One solve's numbers, bb per dealt pair of hands from the solve's root, indexed [OOP, IP]. `value`: what each player
 * nets, half the pot at the root counting as theirs already. */
export interface NodeLockSide {
  iterations: number;
  root_pot: number;
  value: [number, number];
  exploitability_pct: number;
}

/** A decision in both solves. `at`: on the line before the locked node, the locked node, or straight after it.
 * `unlocked`, `locked`: its mix over the range that gets there, per action; null where nothing gets there. `reach`: the
 * share of the two ranges that gets there together. */
export interface NodeLockChange {
  at: "before" | "locked" | "after";
  line: string[];
  seat: string;
  player: 0 | 1;
  actions: string[];
  unlocked: number[] | null;
  locked: number[] | null;
  reach: { unlocked: number; locked: number };
}

export interface NodeLockBlock {
  /** the action names from the solve's root to the node: this street's, never a card */
  line: string[];
  seat: string;
  player: 0 | 1;
  /** the seats at [OOP, IP] */
  seats: [string, string];
  actions: string[];
  /** the mix held, per action */
  mix: number[];
  hands: NodeLockRequest["hands"];
  cells: number;
  ignored: number;
  ignored_hands: string[];
  /** the lock in words */
  words: string;
  /** the share of the player's range at the node that the lock holds */
  share_held: number;
  /** the lock leaves an action unplayed, so the opponent's answers to it aren't trained */
  untrained: boolean;
  root_pot: number;
  locked: NodeLockSide & {
    best_response_held: [number, number];
    gain_held: [number, number];
    best_response_free: [number, number];
    /** what dropping the lock wins that player against this opponent: engine/nodelock.py's measure */
    lock_cost: [number, number];
    seconds: number;
  };
  unlocked: NodeLockSide & { best_response: [number, number]; gain: [number, number] };
  changes: NodeLockChange[];
  /** what the tree abstracts, in words */
  abstraction: string;
  /** what the restricted game covers, in words */
  scope: string;
  /** the solve's digest (engine/study_lock.py `root_key`): a kept lock is held only on this very solve. Absent from a
   * worker built before locks could be kept */
  root?: string;
  /** the kept locks held with this one */
  also?: { line: string[]; player: 0 | 1; seat: string; actions: string[]; mix: number[]; hands: NodeLockRequest["hands"]; cells: number; ignored: number; words: string }[];
}

export type NodeLockAnswer = AdvisorResponse & { study: "nodelock"; node_lock: NodeLockBlock };

/** How a node lock is going, at each of its solve's checks. */
export interface NodeLockProgress {
  study: "nodelock_progress";
  iterations: number;
  of: number;
  exploitability_pct: number | null;
  seconds: number;
}

/** A practice opponent's move (Advisor.play): drawn from the seat's mix for its hand. `to` is a bet's or raise's
 * total this street; `name` the Advisor's action name ("bet 33%"); `freq` how often the hand takes it. */
export type PlayMove = AdvisorResponse & {
  pos: string;
  action: "fold" | "check" | "call" | "bet" | "raise" | "all-in";
  name: string;
  freq: number;
  to?: number;
  /** with a read in the request (Exploit practice, engine/exploit_play.py): true where the move was drawn from the read's
   * strategy, false where it was the equilibrium's, `profile_why` saying why; absent from Advisor.play itself */
  profile?: boolean;
  profile_why?: string;
};

export interface OpponentRange {
  seat: string;
  combos?: number;
  eq?: number | null;
  grid: RangeGridData;
}

export interface AdvisorActionStat {
  action: string;
  /** share of the range taking it, 0..1 */
  freq?: number;
  combos?: number;
  /** range EV of the action in bb; null where the answer has no EVs (advisor.py _study_range, _no_values) */
  ev_bb?: number | null;
  /** marked where the EV is a rough estimate */
  rough_ev?: boolean;
  amount?: number;
  to?: number;
  /** a bet's or raise's total this street, in bb (what Study plays it as) */
  amount_bb?: number;
  [key: string]: unknown;
}

/** One category of a range (breakdown.py _groups): c its combos; eq, f (the mix, along Breakdown.actions) and ev where known. */
export interface BreakdownRow {
  id: string;
  label: string;
  c: number;
  eq?: number | null;
  f?: number[];
  ev?: number | null;
}

/** One player's side of a breakdown (breakdown.py side). curve: their equities high to low, at even steps of the range. */
export interface BreakdownSide {
  who: string;
  combos: number;
  made: BreakdownRow[];
  draws: BreakdownRow[];
  eq?: number | null;
  /** the range's share with `nut_eq` equity or more */
  nuts?: number;
  curve?: number[];
  ev?: number | null;
}

export interface Breakdown {
  actions: string[];
  pot: number;
  hero: BreakdownSide;
  villains: BreakdownSide[];
  nut_eq: number;
  /** the runouts the equities are over: [dealt, of all] */
  runouts?: [number, number];
}

/** 13x13 hand-class grid: per class its weight in the range and its mix (same order as `actions`). */
export interface RangeGridData {
  actions: string[];
  cells: Record<string, GridCell>;
}

export interface GridCell {
  /** weight of the class in the range, 0..1 (share of its combos present) */
  w: number;
  /** action frequencies, aligned with RangeGridData.actions */
  f: number[];
  // (each null where the answer has none: a look, a read at once, a 4-way answer; advisor.py _no_values)
  /** per-action EV in bb, where solved */
  ev?: number[] | null;
  /** EV of the class's mix */
  evm?: number | null;
  /** equity vs the opponent's range, 0..1 */
  eq?: number | null;
  eqr?: number | null;
  [key: string]: unknown;
}

/** A Study combo row: [cards, reach (0..1 of it in the range), mix (per action), EVs per action in bb (null when
 * the answer came at once without EVs), equity, made-hand category index, draw category index] — the last two
 * index into AdvisorResponse.categories. */
export type ComboRow = [string, number, number[], number[] | null, number | null, number, number];

export interface SolverDiagnostics {
  /** null where the numbers are in an approximate answer's label, or there are none (advisor.py _study_look, _study_near) */
  iterations?: number | null;
  exploitability_pct?: number | null;
  approximate?: boolean;
  target_pct?: number;
  seconds?: number;
  solve_seconds?: number;
  nodes?: number;
  [key: string]: unknown;
}
