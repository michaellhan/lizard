// The preflop games the worker answers from a stored solve, as the page needs to know them before it asks: the grid of
// Lizard's preflop solver (engine/pf_solve.py stored_games, built by scripts/pf/build_stored.py --engine into
// engine/pf/lz4_*.bin), which answers every preflop solve request (Study's Solver source, Practice's and Analyze's grade).
// Every one is the same calibrated class-level model and solve; pfStored.test.ts holds this list to engine/pf_solve.py
// and to the files.
import { PF_FORCED_BUILT } from "./pfForcedBuilt";

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

// The stored games with an ante or a straddle (engine/pf_solve.py forced_games, 2026-11-24), the same model and solve:
// a 2bb straddle from the first seat (the one this site's table, the charts and a site's history play) at 3 to 9 players,
// 50 to 200bb, no rake or 5% capped at 3bb; a 1bb big-blind ante as each seat's share to the cent (`pfStoredAnte`, the
// tournament stages' own, tournament.ts stageAnte) at 2 to 9 players, 20 to 100bb, no rake. Each at the tree's sizes
// (Study) and the charts' (the grade, at every table size). Only those built are offered: PF_FORCED_BUILT, written with
// the files, so a game whose file isn't there yet is never asked as stored.
export const PF_STRADDLE_PLAYERS = [3, 4, 5, 6, 7, 8, 9] as const;
export const PF_STRADDLE_DEPTHS = [50, 100, 150, 200] as const;
export const PF_ANTE_PLAYERS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export const PF_ANTE_DEPTHS = [20, 25, 30, 40, 50, 60, 80, 100] as const;
/** engine/pf_solve.py FORCED_WORDS: what a stored answer with an ante or a straddle is called */
/** The full-ring games with neither an ante nor a straddle (engine/pf_solve.py RING_*, 2026-11-26): 7 to 9 players at the
 * grid's depths, no rake or 5% capped at 3bb, at the tree's sizes and the charts', built by the same set as the forced
 * games and listed in PF_FORCED_BUILT as they're built. Their answers carry no forced words (their flop values are the
 * grid's), only the 7-9 handed tree's limits. */
export const PF_RING_PLAYERS = [7, 8, 9] as const;
const isRing = (players: number) => (PF_RING_PLAYERS as readonly number[]).includes(players);
export const PF_FORCED_WORDS = "stored preflop solve (class-level model) with ante/straddle";

/** The ante stored at a table size: a 1bb big-blind ante as each seat's share, to the cent (engine/pf_solve.py stored_ante). */
export const pfStoredAnte = (players: number) => Math.round(100 / players) / 100;

/** How far a site's averaged ante may be from the stored one, bb a seat: the stored ante is a big-blind ante's share rounded
 * to the cent, so a 1bb big-blind ante at any table size (0.125 at 8 players against 0.13) is within it. */
export const PF_ANTE_TOL = 0.005;

/** A stored game's forced bets: none, the table size's stored ante, or the straddle; null for any other (another ante, an
 * ante with a straddle), which no stored game has. */
export type PfForced = "none" | "ante" | "straddle";
export function pfForcedOf(players: number, ante: number | undefined, straddle: boolean | undefined, tol = 1e-9): PfForced | null {
  const st = !!straddle && players >= 3;
  if (!ante && !st) return "none";
  if (ante && st) return null;
  if (st) return (PF_STRADDLE_PLAYERS as readonly number[]).includes(players) ? "straddle" : null;
  return (PF_ANTE_PLAYERS as readonly number[]).includes(players) && Math.abs(ante! - pfStoredAnte(players)) <= tol + 1e-9 ? "ante" : null;
}

/** Any stored game's key (engine/pf_solve.Spec.key): its ante, straddle, rake and the charts' sizes. */
export const pfGameKey = (players: number, stack: number, o: { forced?: PfForced; raked?: boolean; chart?: boolean }) =>
  `${PF_MODEL_TAG}_${players}max_${stack}bb${o.forced === "ante" ? `_a${pfStoredAnte(players)}` : ""}${o.forced === "straddle" ? "_s" : ""}` +
  `${o.raked ? `_r${PF_STORED_RAKE.pct}c${PF_STORED_RAKE.cap}` : ""}${o.chart ? "_ch" : ""}`;

const FORCED_BUILT = new Set(PF_FORCED_BUILT);

/** Every stored game's key. */
export const PF_KEYS: readonly string[] = [
  ...PF_PLAYERS.flatMap((n) => PF_DEPTHS.flatMap((d) => [pfKey(n, d, false), pfKey(n, d, true)])),
  ...PF_CHART_PLAYERS.flatMap((n) => PF_DEPTHS.flatMap((d) => [pfChartKey(n, d, false), pfChartKey(n, d, true)])),
  ...PF_FORCED_BUILT,
];

/** Whether the grade asks a game at the charts' raise sizes: every game with an ante or a straddle, else 2 to 6 players
 * and the full-ring games (7 to 9). */
const chartFor = (players: number, forced: PfForced | null) =>
  (forced !== null && forced !== "none") || (PF_CHART_PLAYERS as readonly number[]).includes(players) || (forced === "none" && isRing(players));

/** The depths a grade can ask at a table size with these forced bets and rake: the grid's for none at 2 to 6 players,
 * else those built of the forced set or the full-ring games (each at the sizes the grade asks); none for a game no
 * stored set has. */
export function pfGradeDepths(players: number, forced: PfForced | null, raked: boolean): readonly number[] {
  if (forced === null) return [];
  if (forced === "none" && (PF_PLAYERS as readonly number[]).includes(players)) return PF_DEPTHS;
  if (forced === "none") return isRing(players) ? PF_DEPTHS.filter((d) => FORCED_BUILT.has(pfGameKey(players, d, { raked, chart: true }))) : [];
  const depths = forced === "ante" ? PF_ANTE_DEPTHS : PF_STRADDLE_DEPTHS;
  return depths.filter((d) => FORCED_BUILT.has(pfGameKey(players, d, { forced, raked, chart: chartFor(players, forced) })));
}

/** Whether a game with neither an ante nor a straddle is stored at the tree's own sizes (Study's, a preflop drill's): the
 * grid at 2 to 6 players, the full-ring games built at 7 to 9. */
export const pfPlainStored = (players: number, stack: number) =>
  (PF_DEPTHS as readonly number[]).includes(stack) &&
  ((PF_PLAYERS as readonly number[]).includes(players) || (isRing(players) && FORCED_BUILT.has(pfGameKey(players, stack, {}))));

/** What a grade's request adds to ask the stored game at the charts' raise sizes, where one is stored for the table size
 * and its forced bets (nothing for a tournament's request, whose stored presets are of the tree's own sizes). */
export const pfGradeSizes = (state: { players?: number; payouts?: unknown; bounties?: unknown; ante?: number; straddle?: boolean }): { pf_tree?: typeof PF_CHART_TREE } =>
  chartFor(state.players ?? 0, pfForcedOf(state.players ?? 0, state.ante, state.straddle)) && !state.payouts && !state.bounties ? { pf_tree: PF_CHART_TREE } : {};

/** Depths in words: "20, 25, 30, … or 200bb". */
export const depthsWords = (ds: readonly number[]) => (ds.length > 1 ? `${ds.slice(0, -1).join(", ")} or ${ds.at(-1)}bb` : `${ds[0] ?? 0}bb`);

/** The depth of `ds` nearest a stack. */
export const nearestOf = (ds: readonly number[], stack: number) => ds.reduce((a, b) => (Math.abs(b - stack) < Math.abs(a - stack) ? b : a));

/** The stored depths in words: "20, 25, 30, … or 200bb". */
export const PF_DEPTHS_WORDS = `${PF_DEPTHS.slice(0, -1).join(", ")} or ${PF_DEPTHS.at(-1)}bb`;

/** The stored game nearest a stack, for a refusal to name. */
export const nearestDepth = (stack: number) => PF_DEPTHS.reduce((a, b) => (Math.abs(b - stack) < Math.abs(a - stack) ? b : a));
