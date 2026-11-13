// What a heads-up flop answer's figure can't see: its solve plays a smaller game than the one asked (the turn by card
// class, the turn and river by hand bucket), and its exploitability is measured inside that game. How far that game's
// flop strategy is from the full game's was measured by scripts/benchmarks/abstraction.py (docs/ACCURACY.md section
// 21): each flop model's strategy held combo by combo in the exact game, every turn and river dealt, the rest
// re-solved, and the EV each player gave up. Said beside the figure on the answers those models give.
import type { AdvisorResponse } from "./protocol";
import type { ResultSource, SolveMode, TransportKind } from "./types";

export type FlopModel = "fast" | "accurate" | "library";

/** The EV a player gave up, % of the pot, by flop model, over the benchmark's spots and both players (ACCURACY section
 * 21, results/abstraction.json, 2026-11-11): the most, and the average of the six. */
export const FLOP_GIVEN_UP: Record<FlopModel, { most: number; mean: number }> = {
  // (to one place: 4.85 and 1.85 Fast, 5.41 and 1.91 Accurate, 2.14 and 0.57 the library)
  fast: { most: 4.9, mean: 1.9 },
  accurate: { most: 5.4, mean: 1.9 },
  library: { most: 2.1, mean: 0.6 },
};
/** How many spots that's over: narrow ranges, about 30 combos a player, one raise a street. */
export const FLOP_SPOTS = 3;

/** The flop model behind a heads-up flop answer, where the benchmark measured it: the browser's Fast and Accurate (a
 * local server's configs are its own) and the flop library. Null elsewhere: other streets, multiway, Quick, and a
 * tournament's prize-equity solve (the benchmark is in chips). */
export function flopModelOf(r: AdvisorResponse, source: ResultSource, mode: SolveMode, transport: TransportKind): FlopModel | null {
  if (r.street !== "flop" || r.multiway || r.tournament) return null;
  if (source === "library") return "library";
  if (source !== "live" && source !== "node-lock" && source !== "profile-solve") return null;
  if (transport !== "worker") return null;
  return mode === "fast" || mode === "accurate" ? mode : null;
}

/** The full game's gap in words, or null where nothing was measured. */
export function abstractionWords(model: FlopModel | null): string | null {
  if (!model || !FLOP_SPOTS) return null;
  const g = FLOP_GIVEN_UP[model];
  return `this flop model gave up ${g.mean.toFixed(1)}% pot on average, up to ${g.most.toFixed(1)}%, against the full game on ${FLOP_SPOTS} narrow test spots`;
}
