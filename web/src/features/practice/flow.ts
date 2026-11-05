// What a hand needs next: cards dealt, an answer at your spot, an opponent's move, or nothing. `needOf` alone builds a
// request and its key, so the key is always the request it names. A key is the request as the solver reads it, with
// the mode (`stateFor` carries no speed), and no hand number or seed: two hands at the same spot ask the same thing.
// Above one table two more: the flop library's index, which Instant flops deals by, and a preflop node's chart, which a
// hand being dealt to its pot draws each seat's move from, so that's one request a node all session, not one a seat a hand.
import { chartKey, chartMove, chartState } from "@/library/flops";
import { recordOf, seeded, type Move, type Sim, type Street } from "@/poker/table";
import type { AdvisorState, PlayMove } from "@/solver/protocol";
import type { PlayRequest, SolveMode, SolveResult } from "@/solver/types";
import { adviceState, charting, needsIndex, pfState, phaseOf, setupOf, simOf, stateFor, villainMove, type PracticeHand } from "./practice";

export type Need =
  | { kind: "deal"; street: Street }
  | { kind: "over" }
  | { kind: "index" }
  /** `pf`: your preflop in a session graded by the preflop solve, the solve's node to ask once the chart has answered */
  | { kind: "you" | "opp"; key: string; state: AdvisorState; play?: PlayRequest; pf?: AdvisorState; street: Street }
  | { kind: "chart"; key: string; ck: string; state: AdvisorState; street: "preflop" };

/** The charts asked for so far, by `chartKey`: null where a node's can't be drawn from, so its seats are asked one by one. */
export type Charts = ReadonlyMap<string, SolveResult | null>;

export const adviceKey = (mode: SolveMode, state: AdvisorState) => JSON.stringify([mode, state]);
export const moveKey = (mode: SolveMode, state: AdvisorState, seat: string, hole: string) => JSON.stringify([mode, state, seat, hole]);

/** Your spot's two requests as one key: the chart's and the solve's come together, and it's no key of either alone, so a
 * retry that asks one of them isn't handed both. */
export const pfKey = (mode: SolveMode, state: AdvisorState) => `${adviceKey(mode, state)}|pf`;

/** What the hand needs next: your spot's advice, or an opponent's move (`play`; your own preflop in a drill is one).
 * `charts`: above one table, where a move played for you comes from the node's chart once that's been asked. */
export function needOf(h: PracticeHand, mode: SolveMode, sim: Sim = simOf(h), charts?: Charts): Need {
  if (needsIndex(h)) return { kind: "index" };
  const ph = phaseOf(h, sim);
  if (ph.kind === "deal" || ph.kind === "over") return ph;
  if (ph.kind === "hero") {
    const state = adviceState(h, sim);
    if (h.pfSolve && ph.street === "preflop") return { kind: "you", key: pfKey(mode, state), state, pf: pfState(h), street: ph.street };
    return { kind: "you", key: adviceKey(mode, state), state, street: ph.street };
  }
  // (a run-out after your fold: from the seat's own view, as the classic page asks it)
  const state = h.run ? stateFor(h, ph.seat) : stateFor(h);
  if (charts && charting(h) && !charts.has(chartKey(state))) return { kind: "chart", key: `chart|${chartKey(state)}`, ck: chartKey(state), state: chartState(state), street: "preflop" };
  const hole = h.hands[ph.seat]!.join("");
  return { kind: "opp", key: moveKey(mode, state, ph.seat, hole), state, play: { seat: ph.seat, hole }, street: ph.street };
}

/** The move at `seat` drawn from its node's chart, or null: not a hand played for you, no chart there, or none for this
 * hand class, where the seat is asked. Drawn by the hand's seed and place, so it takes nothing from the deals' seeds. */
export function chartDraw(h: PracticeHand, seat: string, charts?: Charts) {
  const ch = charts && charting(h) ? charts.get(chartKey(stateFor(h))) : null;
  return ch ? chartMove(ch.data, seat, h.hands[seat]!.join(""), seeded((h.seed ^ 0x9e3779b9) + h.lines.preflop.length)) : null;
}

/** An opponent's answer as the move it records. `fallback`: why the table couldn't take it, where it's played as a
 * check or call instead (villainMove; it should not happen). */
export function moveOf(h: PracticeHand, mv: Pick<PlayMove, "action" | "to">, sim: Sim = simOf(h)): { move: Move; fallback: string | null } {
  const m = recordOf(setupOf(h), sim, { action: mv.action, to: mv.to, clamp: true });
  return typeof m === "string" ? { move: villainMove(h, mv, sim), fallback: m } : { move: m, fallback: null };
}
