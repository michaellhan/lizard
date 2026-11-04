// What a hand needs next: cards dealt, an answer at your spot, an opponent's move, or nothing. `needOf` alone builds a
// request and its key, so the key is always the request it names. A key is the request as the solver reads it, with
// the mode (`stateFor` carries no speed), and no hand number or seed: two hands at the same spot ask the same thing.
import { recordOf, type Move, type Sim, type Street } from "@/poker/table";
import type { AdvisorState, PlayMove } from "@/solver/protocol";
import type { PlayRequest, SolveMode } from "@/solver/types";
import { phaseOf, setupOf, simOf, stateFor, villainMove, type PracticeHand } from "./practice";

export type Need = { kind: "deal"; street: Street } | { kind: "over" } | { kind: "you" | "opp"; key: string; state: AdvisorState; play?: PlayRequest; street: Street };

export const adviceKey = (mode: SolveMode, state: AdvisorState) => JSON.stringify([mode, state]);
export const moveKey = (mode: SolveMode, state: AdvisorState, seat: string, hole: string) => JSON.stringify([mode, state, seat, hole]);

/** What the hand needs next: your spot's advice, or an opponent's move (`play`; your own preflop in a drill is one). */
export function needOf(h: PracticeHand, mode: SolveMode, sim: Sim = simOf(h)): Need {
  const ph = phaseOf(h, sim);
  if (ph.kind === "deal" || ph.kind === "over") return ph;
  if (ph.kind === "hero") {
    const state = stateFor(h);
    return { kind: "you", key: adviceKey(mode, state), state, street: ph.street };
  }
  // (a run-out after your fold: from the seat's own view, as the classic page asks it)
  const state = h.run ? stateFor(h, ph.seat) : stateFor(h);
  const hole = h.hands[ph.seat]!.join("");
  return { kind: "opp", key: moveKey(mode, state, ph.seat, hole), state, play: { seat: ph.seat, hole }, street: ph.street };
}

/** An opponent's answer as the move it records. `fallback`: why the table couldn't take it, where it's played as a
 * check or call instead (villainMove; it should not happen). */
export function moveOf(h: PracticeHand, mv: Pick<PlayMove, "action" | "to">, sim: Sim = simOf(h)): { move: Move; fallback: string | null } {
  const m = recordOf(setupOf(h), sim, { action: mv.action, to: mv.to, clamp: true });
  return typeof m === "string" ? { move: villainMove(h, mv, sim), fallback: m } : { move: m, fallback: null };
}
