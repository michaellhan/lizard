// Practice on a PLO solve: a hand dealt from the solve as it comes up, and the action you take graded against the solve's
// own mix for that combo and each action's EV with the best play after it (the report's bestEv: below an action a strategy
// never takes, its average is untrained, so EVs played on at it would charge that action for play no one would choose), on
// Lizard's one scale (grading/grade.ts). A decision is drawn by how often its line is
// played (its reach over every matchup), then a combo of the player to act by how often it gets there (its weight at the
// node, the start weight times the strategy along the line). Nothing here is solved again: every number is the solve's.
import { capGrade, grade, type Grade } from "@/grading/grade";
import type { ResultNode } from "@/engine/plo/river/run";

export interface DrillSpot {
  node: number;
  /** the combo's index in the acting seat's hands */
  combo: number;
}

/** Whether this combo can be graded here: it reaches the node and has an EV for every action. */
function gradable(n: ResultNode, c: number): boolean {
  const size = n.weight.length;
  if (!(n.weight[c]! > 0)) return false;
  for (let a = 0; a < n.actions.length; a++) if (!Number.isFinite(n.bestEv[a * size + c]!)) return false;
  return true;
}

/** A decision and a combo, drawn as play would bring them; null where no decision is reached. `rand` in [0, 1). */
export function deal(nodes: readonly ResultNode[], rand: () => number = Math.random): DrillSpot | null {
  // a node's chance is its reach; a combo's within it, its weight there
  const totals = nodes.map((n) => {
    let w = 0;
    for (let c = 0; c < n.weight.length; c++) if (gradable(n, c)) w += n.weight[c]!;
    return w > 0 && n.reach > 0 ? w : 0;
  });
  const reach = nodes.reduce((t, n, i) => t + (totals[i]! > 0 ? n.reach : 0), 0);
  if (!(reach > 0)) return null;
  let r = rand() * reach;
  let i = nodes.findIndex((n, k) => totals[k]! > 0 && (r -= n.reach) < 0);
  if (i < 0) i = totals.findLastIndex((t) => t > 0);
  const n = nodes[i]!;
  let s = rand() * totals[i]!;
  let last = -1;
  for (let c = 0; c < n.weight.length; c++) {
    if (!gradable(n, c)) continue;
    last = c;
    if ((s -= n.weight[c]!) < 0) return { node: n.id, combo: c };
  }
  return { node: n.id, combo: last };
}

/** The pot at a decision: the street's pot and what's been bet on the street so far. */
export const potAt = (n: ResultNode, streetPot: number) => streetPot + n.bets[0] + n.bets[1];

/** What the player to act has to call here. */
export const toCall = (n: ResultNode) => Math.max(0, n.bets[1 - n.player]! - n.bets[n.player]!);

/** This combo's mix by action, and each action's EV with its best play after it, as the solve has them. */
export function mixAt(n: ResultNode, c: number): { freq: number; ev: number }[] {
  const size = n.weight.length;
  return n.actions.map((_, a) => ({ freq: n.strategy[a * size + c]!, ev: n.bestEv[a * size + c]! }));
}

/** Action `a` graded against the solve, by EV lost in bb and in % of the pot at the decision; a solve short of its target
 * or far from converged stops the verdict at an Inaccuracy (capGrade), as every trainer does. */
export function gradeAt(n: ResultNode, c: number, a: number, streetPot: number, band: string | undefined): Grade {
  const mix = mixAt(n, c);
  return capGrade(grade({ freqs: mix.map((x) => x.freq), evs: mix.map((x) => x.ev), pot: potAt(n, streetPot) }, a), band);
}

export interface DrillTally {
  hands: number;
  ok: number;
  loss: number;
}

export const EMPTY_TALLY: DrillTally = { hands: 0, ok: 0, loss: 0 };

export const tallied = (t: DrillTally, g: Grade): DrillTally => ({ hands: t.hands + 1, ok: t.ok + (g.ok ? 1 : 0), loss: t.loss + g.loss });
