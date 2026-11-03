// Wire protocol of the solver worker (solver/gto/static/worker.js, reused unchanged from gto-solver) and of the
// optional local Python server (solver/gto/server.py). These types describe the messages exactly as the
// upstream code sends and reads them; the typed, user-facing API is in ./types.ts.

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
  ranges?: Record<string, string>;
  /** "fast" (default) or "accurate"; Quick is `quick: true`. */
  speed?: "fast" | "accurate";
  quick?: boolean;
  /** seconds for this street's solve, and for each earlier street solved to narrow the ranges (Advisor.advise) */
  budget?: number;
  prior_budget?: number;
  /** Study mode: answer for whoever acts next with their whole range (Advisor.study). */
  study?: boolean;
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
export interface AdvisorResponse {
  cancelled?: boolean;
  error?: string;
  skipped?: string | boolean;
  street?: "preflop" | "flop" | "turn" | "river";
  /** Study: "node" | "deal" | "over" | "runouts" | "pf_unsolved" | "pf_none" | "pf_progress" | "pf_export" */
  study?: string;
  actor?: string;
  opponent?: string;
  position?: "IP" | "OOP" | string;
  pot_bb?: number;
  actions?: AdvisorActionStat[];
  grid?: RangeGridData;
  opponent_grid?: RangeGridData;
  combos?: Record<string, ComboRow[]>;
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
  /** what answered when the solve failed: "rules" | "chart" | "equity" */
  fallback?: string;
  fallback_reason?: string;
  notes?: string[];
  seconds?: number;
  [key: string]: unknown;
}

/** A practice opponent's move (Advisor.play): drawn from the seat's mix for its hand. `to` is a bet's or raise's
 * total this street; `name` the Advisor's action name ("bet 33%"); `freq` how often the hand takes it. */
export type PlayMove = AdvisorResponse & {
  pos: string;
  action: "fold" | "check" | "call" | "bet" | "raise" | "all-in";
  name: string;
  freq: number;
  to?: number;
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
