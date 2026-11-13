// A PLO hand you played, laid over a solve of one of its streets: your combo and the street's actions as played (from
// Analyze's link: `hand`, `seat`, `act`), walked down the solve's tree, each of your decisions graded against the solve's
// mix and EVs for your combo (drill.ts gradeAt, Lizard's one scale). A step the tree doesn't have (a size not listed),
// or a combo outside the range typed, is said and not graded: nothing is guessed.
import type { Grade } from "@/grading/grade";
import { parseIds } from "@/engine/plo/cards";
import { handIndex, sortHand } from "@/engine/plo/combos";
import type { ResultNode, RiverResult } from "@/engine/plo/river/run";
import { gradeAt, potAt } from "./drill";

export interface Mine {
  /** your four cards */
  hand: string;
  /** your seat in the solve: 0 out of position, 1 in position */
  seat: 0 | 1;
  /** the street's actions as played, both seats in turn: x, f, c, b<to>, r<to> (amounts the street's totals, bb) */
  act: string[];
  /** where the hand came from, in words */
  from?: string;
  /** the kept PLO hand's id (data/ploHands.ts), to keep the grade with it */
  plo?: string;
}

export function mineFromParams(q: URLSearchParams): Mine | null {
  const hand = q.get("hand");
  const seat = q.get("seat");
  if (!hand || !parseIds(hand, 4) || (seat !== "0" && seat !== "1")) return null;
  const act = (q.get("act") ?? "").split(",").filter((t) => /^(x|f|c|[br]\d+(\.\d+)?)$/.test(t));
  const from = q.get("from");
  const plo = q.get("plo");
  return { hand, seat: seat === "0" ? 0 : 1, act, ...(from ? { from } : {}), ...(plo ? { plo } : {}) };
}

export interface MyStep {
  node: ResultNode;
  /** the action taken, as the node's index */
  taken: number;
  /** yours, graded; null where it's the other seat's, or yours can't be graded (`why`) */
  grade: Grade | null;
  why?: string;
}

export interface MyWalk {
  /** your combo's index in your seat's hands, null when the range typed doesn't hold it */
  combo: number | null;
  steps: MyStep[];
  /** why the walk stopped short of the line, null when it didn't */
  stop: string | null;
}

/** The node's action that the played token is: the kind, and for a bet or raise the tree's amount within 3% of the pot
 * here (an all-in matching an all-in); -1 for none. */
export function matchAction(node: ResultNode, token: string, streetPot: number): number {
  const kind = token[0] === "x" ? "check" : token[0] === "f" ? "fold" : token[0] === "c" ? "call" : token[0] === "b" ? "bet" : "raise";
  if (kind !== "bet" && kind !== "raise") return node.actions.findIndex((a) => a.kind === kind);
  const to = Number(token.slice(1));
  const slack = Math.max(0.03 * potAt(node, streetPot), 0.05);
  let best = -1;
  let gap = Infinity;
  node.actions.forEach((a, k) => {
    if (a.kind !== kind || a.amount === undefined) return;
    const d = Math.abs(a.amount - to);
    if (d < gap) {
      gap = d;
      best = k;
    }
  });
  return gap <= slack ? best : -1;
}

/** The solve's tree walked along the line played, your decisions graded where the solve can say. */
export function walkMine(result: Pick<RiverResult, "hands" | "nodes" | "pot">, mine: Mine, band: string | undefined): MyWalk {
  const ids = parseIds(mine.hand, 4)!;
  const want = handIndex(sortHand(ids));
  const hands = result.hands[mine.seat];
  let combo: number | null = hands.indexOf(want);
  if (combo < 0) combo = null;
  const byPath = new Map(result.nodes.map((n) => [n.path, n]));
  const steps: MyStep[] = [];
  let node = byPath.get("");
  for (const token of mine.act) {
    if (!node) return { combo, steps, stop: null };
    const taken = matchAction(node, token, result.pot);
    if (taken < 0) {
      const sizes = node.actions.filter((a) => a.kind === "bet" || a.kind === "raise").map((a) => a.amount!.toFixed(2));
      return { combo, steps, stop: `The solve's tree hasn't the ${token[0] === "r" ? "raise to" : token[0] === "b" ? "bet of" : "action"} ${token.slice(1) || token} played here${sizes.length ? ` (its sizes: ${sizes.join(", ")})` : ""}: add the size to grade from here on.` };
    }
    let grade: Grade | null = null;
    let why: string | undefined;
    if (node.player === mine.seat) {
      const n = node.weight.length;
      if (combo === null) why = "Your hand isn't in the range typed for your seat.";
      else if (!(node.weight[combo]! > 0)) why = "The range typed never brings your hand here.";
      else if (node.actions.some((_, a) => !Number.isFinite(node!.bestEv[a * n + combo!]!))) why = "Your hand has no EV here (blocked).";
      else grade = gradeAt(node, combo, taken, result.pot, band);
    }
    steps.push({ node, taken, grade, ...(why ? { why } : {}) });
    const token2 = node.actions[taken]!.token;
    node = byPath.get(node.path ? `${node.path}.${token2}` : token2);
  }
  return { combo, steps, stop: null };
}
