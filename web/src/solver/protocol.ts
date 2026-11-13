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
  /** Practice in a stored tournament preset (practice.ts `pfOptions`): an opponent's preflop move is drawn from the stored
   * prize-equity solve where its node is the spot (engine/pf_icm_study.play), else the chart's */
  pf_play?: boolean;
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
  /** a tournament's preflop solve (engine/pf_icm_study.py): the chips of a jam no one still in can call, which its tree
   * leaves out of `pot_bb` and a table counts */
  uncalled_bb?: number;
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
  /** a profile re-solve's answer (engine/profile_solve.py): Study's whole block, or Exploit practice's advice's summary */
  profile_solve?: ProfileSolveBlock | ProfileAdviceBlock;
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
  /** "back": hold the lock in the solve of the street before (a turn node in the flop's tree, a river node in the
   * turn's), which re-solves around it so that street's play reacts; whole range only, no kept locks. Absent: this
   * street's own solve */
  reach?: "here" | "back";
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
  /** with reach "back": the street the lock was held from; `line` then runs from that street's root, cards included */
  reach?: "flop" | "turn";
  /** with reach "back": that street's decisions on the hand's line, and the others whose mix moved most (each reached
   * by at least 2% of its player's range in both solves) */
  earlier?: { street: "flop" | "turn"; on_line: NodeLockEarlier[]; moved: NodeLockEarlier[] };
}

/** A decision of the street before in both solves (engine/nodelock.py `street_moves`): its mix over the range that gets
 * there, `moved` the largest change of any action in points, `share` of the player's range that gets there [unlocked,
 * locked]. */
export interface NodeLockEarlier {
  line: string[];
  seat: string;
  player: 0 | 1;
  actions: string[];
  unlocked: number[] | null;
  locked: number[] | null;
  moved: number | null;
  share: [number, number];
}

export type NodeLockAnswer = AdvisorResponse & { study: "nodelock"; node_lock: NodeLockBlock };

/** A player profile held at every decision of theirs and the rest re-solved (engine/profile_solve.py), sent as
 * `state.nodelock = {profile}` on the Study state of the node on screen. `adj`: the profile's numbers
 * (features/study/locks.ts LOCK_KEYS) or a preset's name. `streets`: "street" holds it in this street's solve alone,
 * the ranges entering it the equilibrium's; "hand" in every solve of the hand after the flop (a turn or river). */
export interface ProfileSolveRequest {
  seat: string;
  adj: Record<string, number> | string;
  streets?: "street" | "hand";
}

/** One answer at the node, over the actor's range there: its mix and each action's EV (bb relative to folding now). */
export interface ProfileSide {
  mix: number[];
  ev: number[];
  range_ev: number;
  combos: number;
}

/** How far a profile re-solve got: `gain_pct` what the exploiting player's best response still gains against the
 * profile, % of the root pot (0 once it is that best response); bb per dealt pair, [OOP, IP]. */
export interface ProfileConvergence {
  iterations: number;
  root_pot: number;
  gain_pct: number;
  exploitability_pct: number;
  value: [number, number];
  /** the exploiting player's best response to the held strategy, computed apart (bb per dealt pair) */
  best_response: number;
  seconds: number;
}

export interface ProfileSolveBlock {
  seat: string;
  /** the profiled player, 0 OOP, 1 IP */
  player: 0 | 1;
  exploiter: string;
  seats: [string, string];
  adj: Record<string, number>;
  words: string;
  streets_held: "street" | "hand";
  line: string[];
  actions: string[];
  /** the player acting on screen is the profiled one */
  actor_profiled: boolean;
  eq: ProfileSide;
  exploit: ProfileSide;
  /** per hand class of the actor's range: weight in each answer, both mixes and EVs */
  classes: Record<string, { w: number; w_ex: number; eq: number[] | null; ex: number[] | null; ev_eq: number | null; ev_ex: number | null }>;
  /** the street's values for the exploiting player (`player`), bb per dealt pair at the solve's root, one tree and one
   * pair of ranges: at equilibrium, their equilibrium strategy against the profile, the re-solved exploit */
  values: {
    player: 0 | 1;
    eq: number;
    eq_vs_profile: number;
    exploit: number;
    /** a best response to the profile computed apart from the re-solve: the exploit's value once it has converged */
    best_response: number;
    profiled: { eq: number; exploited: number };
    root_pot: number;
    unlocked_exploitability_pct: number;
  };
  convergence: ProfileConvergence;
  pinned: { nodes: number; cells: number };
  streets: { street: "flop" | "turn" | "river"; nodes: number; cells: number; iterations: number; gain_pct: number }[];
  scope: string;
  rule: string;
}

/** Exploit practice's advice against a profile (engine/profile_solve.py advise_answer). */
export interface ProfileAdviceBlock {
  seat: string;
  player: 0 | 1;
  adj: Record<string, number>;
  words: string;
  gain_pct: number;
  iterations: number;
  streets: string[];
  label: string;
}

export type ProfileSolveAnswer = AdvisorResponse & { study: "profile"; profile_solve: ProfileSolveBlock; label: string };

/** How a profile re-solve is going (each street's re-solve reports as it runs). */
export interface ProfileSolveProgress {
  study: "profile_progress";
  street: "flop" | "turn" | "river";
  iterations: number;
  of: number;
  exploitability_pct: number | null;
  seconds: number;
}

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
  /** with `profile`: drawn from the profile re-solve the player's advice used (engine/profile_solve.py), not a one-node
   * best response's read */
  resolved?: boolean;
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
