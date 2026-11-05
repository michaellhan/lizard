// A heads-up PLO4 river as numbers: both ranges in order of strength, the tree, and the two sums every terminal node
// needs, over the hands each hand can meet (blockers.ts). A hand's weight is its range's; a matchup holding a card twice
// can't be dealt, so it has no weight, and the matchups that can be dealt are weighted by the product of their hands'
// weights, as engine/plo/equity.ts weights them.
//
// Values inside are in chips, zero-sum: each seat is credited half the pot at the start and the rest follows. A value
// `v` here is v + pot / 2 as EV, chips won from the pot less chips bet on the river.
import type { PloRange } from "../ranges";
import { rangeSize, withoutBlocked } from "../ranges";
import { handAt } from "../combos";
import { bestOmaha } from "../evaluate";
import { addReach, blockedReach, SUBSETS, subsetTables } from "./blockers";
import { buildTree, checkSizes, type RiverSizes, type RiverTree } from "./tree";

export class RiverError extends Error {}

export interface RiverSpec {
  board: readonly number[];
  /** the seat acting first, then the seat acting last */
  ranges: readonly [PloRange, PloRange];
  pot: number;
  /** each seat's chips behind: only the shorter one plays */
  stacks: readonly [number, number];
  sizes: RiverSizes;
}

export interface Side {
  n: number;
  /** hand index of each combo, weakest hand first */
  hands: Int32Array;
  weights: Float64Array;
  /** the hand's value on this board (evaluate.ts), ascending */
  strength: Int32Array;
  /** SUBSETS set ids a combo */
  sets: Int32Array;
}

export interface RiverGame {
  sides: [Side, Side];
  tree: RiverTree;
  /** the weight of every matchup that can be dealt */
  matchups: number;
  /** combos dropped for sharing a card with every hand the other side holds */
  unmatched: [number, number];
  /** sets in use, across both sides */
  setCount: number;
}

function sideOf(range: PloRange, board: readonly number[]): { hands: Int32Array; weights: Float64Array; strength: Int32Array } {
  const n = rangeSize(range);
  const value = new Int32Array(n);
  for (let i = 0; i < n; i++) value[i] = bestOmaha(handAt(range.hands[i]!), board);
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => value[a]! - value[b]! || a - b);
  return {
    hands: Int32Array.from(order, (i) => range.hands[i]!),
    weights: Float64Array.from(order, (i) => range.weights[i]!),
    strength: Int32Array.from(order, (i) => value[i]!),
  };
}

function pick<T extends Int32Array | Float64Array>(xs: T, keep: readonly number[]): T {
  const out = new (xs.constructor as new (n: number) => T)(keep.length);
  keep.forEach((i, k) => (out[k] = xs[i]!));
  return out;
}

/** The game of a spec, or a RiverError saying what's wrong with it. */
export function compileGame(spec: RiverSpec): RiverGame {
  const { board, pot, stacks, sizes } = spec;
  if (board.length !== 5 || new Set(board).size !== 5) throw new RiverError("A river board is five different cards.");
  if (!(pot >= 2)) throw new RiverError("The pot is at least 2bb: both seats have a blind in by the river.");
  const stack = Math.min(stacks[0], stacks[1]);
  if (!(stack > 0)) throw new RiverError("Both seats need chips behind.");
  const wrong = checkSizes(sizes);
  if (wrong) throw new RiverError(wrong);

  const live = spec.ranges.map((r) => sideOf(withoutBlocked(r, board), board));
  const a = live[0]!;
  const b = live[1]!;
  if (!a.hands.length || !b.hands.length) throw new RiverError(`The ${a.hands.length ? "IP" : "OOP"} range has no hand left once the board's cards are out.`);

  // a combo that can't meet a single opposing hand plays no part: count what each can meet, in whole hands
  const counted = subsetTables([a.hands, b.hands]);
  const meets = (me: Int32Array, other: Int32Array, otherN: number) => {
    const sum = new Float64Array(counted.count);
    for (let j = 0; j < otherN; j++) addReach(sum, other, j * SUBSETS, 1);
    return Float64Array.from({ length: me.length / SUBSETS }, (_, i) => otherN - blockedReach(sum, me, i * SUBSETS));
  };
  const canA = meets(counted.tables[0]!, counted.tables[1]!, b.hands.length);
  const canB = meets(counted.tables[1]!, counted.tables[0]!, a.hands.length);
  const keepOf = (can: Float64Array) => Array.from(can.keys()).filter((i) => can[i]! > 0.5);
  const keepA = keepOf(canA);
  const keepB = keepOf(canB);
  if (!keepA.length || !keepB.length) throw new RiverError("Every hand of one range shares a card with every hand of the other: no matchup can be dealt.");

  const trim = (s: (typeof live)[number], keep: number[]) => ({ hands: pick(s.hands, keep), weights: pick(s.weights, keep), strength: pick(s.strength, keep) });
  const ta = trim(a, keepA);
  const tb = trim(b, keepB);
  const { tables, count } = subsetTables([ta.hands, tb.hands]);
  const sides: [Side, Side] = [
    { n: keepA.length, ...ta, sets: tables[0]! },
    { n: keepB.length, ...tb, sets: tables[1]! },
  ];

  const sum = new Float64Array(count);
  let total = 0;
  for (let j = 0; j < sides[1].n; j++) {
    addReach(sum, sides[1].sets, j * SUBSETS, sides[1].weights[j]!);
    total += sides[1].weights[j]!;
  }
  let matchups = 0;
  for (let i = 0; i < sides[0].n; i++) matchups += sides[0].weights[i]! * (total - blockedReach(sum, sides[0].sets, i * SUBSETS));

  return {
    sides,
    tree: buildTree(pot, stack, sizes),
    matchups,
    unmatched: [a.hands.length - keepA.length, b.hands.length - keepB.length],
    setCount: count,
  };
}

/** The two sums, over the hands each hero hand can meet, for one reach of the other side. */
export class Terminals {
  private readonly sum: Float64Array;
  private readonly low: Float64Array;

  constructor(private readonly game: RiverGame) {
    this.sum = new Float64Array(game.setCount);
    this.low = new Float64Array(Math.max(game.sides[0].n, game.sides[1].n));
  }

  /** out[i]: the reach `reach` of the other side that hero's hand i can meet. */
  meet(hero: 0 | 1, reach: Float64Array, out: Float64Array): void {
    const { sum } = this;
    const me = this.game.sides[hero];
    const other = this.game.sides[1 - hero]!;
    sum.fill(0);
    let total = 0;
    for (let j = 0; j < other.n; j++) {
      const r = reach[j]!;
      if (r !== 0) {
        addReach(sum, other.sets, j * SUBSETS, r);
        total += r;
      }
    }
    for (let i = 0; i < me.n; i++) out[i] = total - blockedReach(sum, me.sets, i * SUBSETS);
  }

  /** A fold: `val` chips times the reach each hand can meet. */
  fold(hero: 0 | 1, reach: Float64Array, val: number, out: Float64Array): void {
    this.meet(hero, reach, out);
    const n = this.game.sides[hero].n;
    for (let i = 0; i < n; i++) out[i]! *= val;
  }

  /** A showdown for `val` chips each way: out[i] is val times what hand i beats less what beats it, of what it can meet. */
  showdown(hero: 0 | 1, reach: Float64Array, val: number, out: Float64Array): void {
    const { sum, low } = this;
    const me = this.game.sides[hero];
    const other = this.game.sides[1 - hero]!;
    const { sets: mine, strength: ours, n } = me;
    const { sets: theirs, strength: rival, n: m } = other;
    sum.fill(0);
    let total = 0;
    let j = 0;
    for (let start = 0; start < n; ) {
      const s = ours[start]!;
      let end = start + 1;
      while (end < n && ours[end] === s) end++;
      for (; j < m && rival[j]! < s; j++) {
        const r = reach[j]!;
        if (r !== 0) {
          addReach(sum, theirs, j * SUBSETS, r);
          total += r;
        }
      }
      // low[i]: what it beats. out[i] for now: that, plus what it ties, the two counted the same way
      for (let i = start; i < end; i++) low[i] = total - blockedReach(sum, mine, i * SUBSETS);
      let tied = false;
      for (; j < m && rival[j]! === s; j++) {
        const r = reach[j]!;
        if (r !== 0) {
          addReach(sum, theirs, j * SUBSETS, r);
          total += r;
          tied = true;
        }
      }
      if (tied) for (let i = start; i < end; i++) out[i] = total - blockedReach(sum, mine, i * SUBSETS);
      else for (let i = start; i < end; i++) out[i] = low[i]!;
      start = end;
    }
    for (; j < m; j++) {
      const r = reach[j]!;
      if (r !== 0) {
        addReach(sum, theirs, j * SUBSETS, r);
        total += r;
      }
    }
    // beaten - beating = beaten + (beaten or tied) - everything it can meet
    for (let i = 0; i < n; i++) {
      const can = total - blockedReach(sum, mine, i * SUBSETS);
      out[i] = val * (low[i]! + out[i]! - can);
    }
  }
}
