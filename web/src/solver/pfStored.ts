// The preflop games the worker answers from a stored solve, as the page needs to know them before it asks: the grid of
// Lizard's preflop solver (engine/pf_solve.py stored_games, built by scripts/pf/build_stored.py --engine into
// engine/pf/lz4_*.bin), which answers every preflop solve request (Study's Solver source, Practice's and Analyze's grade).
// Every one is the same calibrated class-level model and solve; pfStored.test.ts holds this list to engine/pf_solve.py
// and to the files.

export const PF_PLAYERS = [2, 3, 4, 5, 6] as const;
export const PF_DEPTHS = [20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 200] as const;
/** The one rake stored beside no rake. */
export const PF_STORED_RAKE = { pct: 5, cap: 3 };
/** engine/pf_solve.py MODEL_TAG: the model's prefix on every key, so no file, cache entry or stamp mixes two models' solves */
export const PF_MODEL_TAG = "lz4";

/** The stored file's key (engine/pf_solve.Spec.key), with a 5%-capped-at-3bb rake or none. */
export const pfKey = (players: number, stack: number, raked: boolean) =>
  `${PF_MODEL_TAG}_${players}max_${stack}bb${raked ? `_r${PF_STORED_RAKE.pct}c${PF_STORED_RAKE.cap}` : ""}`;

/** The charts' raise sizes (engine/pf_solve.py chart_sized, pf_engine.build sizing="chart"): every raise as the charts
 * size it (a blind's 3bet to 4x the open where the tree's is 4.8x, a cold 4bet adding the opener's chips, each size to the
 * half big blind, all-in where it would commit the stack). The same games at the charts' sizes are stored for these table
 * sizes (STORED_CHART_PLAYERS), and Practice's and Analyze's grade asks them (`pfGradeSizes`), so a chart's raise stays on
 * the tree; Study's Solver source keeps the tree's own sizes. Until 2026-11-17 only the 4x blind 3bet, at 6 players. */
export const PF_CHART_TREE = { sizing: "chart" } as const;
export const PF_CHART_PLAYERS = [2, 3, 4, 5, 6] as const;

/** A stored game at the charts' raise sizes' key (Spec.key: "_ch" last). */
export const pfChartKey = (players: number, stack: number, raked: boolean) => `${pfKey(players, stack, raked)}_ch`;

/** Every stored game's key. */
export const PF_KEYS: readonly string[] = [
  ...PF_PLAYERS.flatMap((n) => PF_DEPTHS.flatMap((d) => [pfKey(n, d, false), pfKey(n, d, true)])),
  ...PF_CHART_PLAYERS.flatMap((n) => PF_DEPTHS.flatMap((d) => [pfChartKey(n, d, false), pfChartKey(n, d, true)])),
];

/** What a grade's request adds to ask the stored game at the charts' raise sizes, where one is stored for the table size
 * (nothing for a tournament's request, whose stored presets are of the tree's own sizes). */
export const pfGradeSizes = (state: { players?: number; payouts?: unknown; bounties?: unknown }): { pf_tree?: typeof PF_CHART_TREE } =>
  (PF_CHART_PLAYERS as readonly number[]).includes(state.players ?? 0) && !state.payouts && !state.bounties ? { pf_tree: PF_CHART_TREE } : {};

/** The stored depths in words: "20, 25, 30, … or 200bb". */
export const PF_DEPTHS_WORDS = `${PF_DEPTHS.slice(0, -1).join(", ")} or ${PF_DEPTHS.at(-1)}bb`;

/** The stored game nearest a stack, for a refusal to name. */
export const nearestDepth = (stack: number) => PF_DEPTHS.reduce((a, b) => (Math.abs(b - stack) < Math.abs(a - stack) ? b : a));
