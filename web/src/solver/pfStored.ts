// The preflop games the worker answers from a stored solve, as the page needs to know them before it asks: the grid of
// Lizard's preflop solver (engine/pf_solve.py stored_games, built by scripts/pf/build_stored.py --engine into
// engine/pf/lz1_*.bin), which answers every preflop solve request (Study's Solver source, Practice's and Analyze's grade).
// Every one is the same calibrated class-level model and solve; pfStored.test.ts holds this list to engine/pf_solve.py
// and to the files.

export const PF_PLAYERS = [2, 3, 4, 5, 6] as const;
export const PF_DEPTHS = [20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 200] as const;
/** The one rake stored beside no rake. */
export const PF_STORED_RAKE = { pct: 5, cap: 3 };
/** engine/pf_solve.py MODEL_TAG: the model's prefix on every key, so no file, cache entry or stamp mixes two models' solves */
export const PF_MODEL_TAG = "lz1";

/** The stored file's key (engine/pf_solve.Spec.key), with a 5%-capped-at-3bb rake or none. */
export const pfKey = (players: number, stack: number, raked: boolean) =>
  `${PF_MODEL_TAG}_${players}max_${stack}bb${raked ? `_r${PF_STORED_RAKE.pct}c${PF_STORED_RAKE.cap}` : ""}`;

/** The charts' raise sizes (engine/pf_solve.py CHART_SIZES): the charts' blinds 3bet to 4x the open, the tree's default
 * to 4.8x. The same games at the charts' size are stored for these table sizes (STORED_CHART_PLAYERS), and Practice's and
 * Analyze's grade asks them (`pfGradeSizes`), so a blind's chart 3bet stays on the tree; Study's Solver source keeps the
 * tree's own sizes. */
export const PF_CHART_SIZES = { blind_3bet: 4 } as const;
export const PF_CHART_PLAYERS = [6] as const;

/** A stored game at the charts' raise sizes' key (Spec.key: the sizes after the rake). */
export const pfChartKey = (players: number, stack: number, raked: boolean) => `${pfKey(players, stack, raked)}_blind_3bet${PF_CHART_SIZES.blind_3bet}`;

/** Every stored game's key. */
export const PF_KEYS: readonly string[] = [
  ...PF_PLAYERS.flatMap((n) => PF_DEPTHS.flatMap((d) => [pfKey(n, d, false), pfKey(n, d, true)])),
  ...PF_CHART_PLAYERS.flatMap((n) => PF_DEPTHS.flatMap((d) => [pfChartKey(n, d, false), pfChartKey(n, d, true)])),
];

/** What a grade's request adds to ask the stored game at the charts' raise sizes, where one is stored for the table size
 * (nothing for a tournament's request, whose stored presets are of the tree's own sizes). */
export const pfGradeSizes = (state: { players?: number; payouts?: unknown; bounties?: unknown }): { pf_sizes?: typeof PF_CHART_SIZES } =>
  (PF_CHART_PLAYERS as readonly number[]).includes(state.players ?? 0) && !state.payouts && !state.bounties ? { pf_sizes: PF_CHART_SIZES } : {};

/** The stored depths in words: "20, 25, 30, … or 200bb". */
export const PF_DEPTHS_WORDS = `${PF_DEPTHS.slice(0, -1).join(", ")} or ${PF_DEPTHS.at(-1)}bb`;

/** The stored game nearest a stack, for a refusal to name. */
export const nearestDepth = (stack: number) => PF_DEPTHS.reduce((a, b) => (Math.abs(b - stack) < Math.abs(a - stack) ? b : a));
