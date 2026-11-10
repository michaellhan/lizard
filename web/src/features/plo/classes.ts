// A condensed view of a PLO range at one decision: there's no 13x13 grid for four-card hands, so combos are put in
// classes by what they hold on the board (the made hand, best two from the hand and three from the board, and on a
// turn a flush draw beside it), each class with its share of the range here, its mix and its EV.
import { cardSuit } from "@/engine/plo/cards";
import { handAt } from "@/engine/plo/combos";
import { bestOmaha, FLUSH, toHandValue } from "@/engine/plo/evaluate";

const CATEGORY = ["High card", "One pair", "Two pair", "Trips or a set", "Straight", "Flush", "Full house", "Quads", "Straight flush"];

/** What a decision's report holds, by combo: as `NodeReport` (engine/plo/river/solver.ts). */
export interface ClassedNode {
  actions: readonly unknown[];
  strategy: Float32Array;
  weight: Float32Array;
  ev: Float32Array;
}

export interface ClassRow {
  name: string;
  /** combos reaching here in the class */
  combos: number;
  /** of the reaching range's weight */
  share: number;
  /** each action's frequency over the class, by combo weight */
  frequency: number[];
  /** the class's EV, weighted by combo, null where none of its combos can meet a hand */
  ev: number | null;
}

/** A combo's class on a board of 4 or 5 cards, and a rank to sort by (the higher, the stronger). */
export function classOf(hand: ArrayLike<number>, board: readonly number[]): { name: string; order: number } {
  const category = toHandValue(bestOmaha(hand, board))[0]!;
  let name = CATEGORY[category]!;
  let order = category * 2;
  // a turn: a flush draw is two of a suit in the hand with two on the board (a hand plays exactly two of its own)
  if (board.length === 4 && category < FLUSH) {
    const onBoard = [0, 0, 0, 0];
    for (const c of board) onBoard[cardSuit(c)]!++;
    const inHand = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) inHand[cardSuit(hand[i]!)]!++;
    if (inHand.some((n, s) => n >= 2 && onBoard[s] === 2)) {
      name += ", flush draw";
      order += 1;
    }
  }
  return { name, order };
}

/** The decision's reaching combos by class, strongest class first. */
export function byClass(hands: Int32Array, board: readonly number[], node: ClassedNode): ClassRow[] {
  const n = hands.length;
  const a = node.actions.length;
  const rows = new Map<string, { order: number; combos: number; weight: number; mix: number[]; evWeight: number; ev: number }>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = node.weight[i]!;
    if (!(w > 0)) continue;
    total += w;
    const { name, order } = classOf(handAt(hands[i]!), board);
    let row = rows.get(name);
    if (!row) rows.set(name, (row = { order, combos: 0, weight: 0, mix: new Array<number>(a).fill(0), evWeight: 0, ev: 0 }));
    row.combos++;
    row.weight += w;
    for (let k = 0; k < a; k++) row.mix[k]! += w * node.strategy[k * n + i]!;
    const ev = node.ev[i]!;
    if (!Number.isNaN(ev)) {
      row.evWeight += w;
      row.ev += w * ev;
    }
  }
  return [...rows.entries()]
    .sort((x, y) => y[1].order - x[1].order)
    .map(([name, r]) => ({ name, combos: r.combos, share: r.weight / total, frequency: r.mix.map((m) => m / r.weight), ev: r.evWeight > 0 ? r.ev / r.evWeight : null }));
}
