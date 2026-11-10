// A heads-up PLO4 turn as numbers: the turn's betting tree, and where the turn's betting closes with chips behind, a river
// for every card that can come, each its own exact river game (../river/game.ts) on its own betting tree. Where the turn's
// betting closes all-in, every river card is a showdown.
//
// The turn's sides are the ranges' hands left once the board's four cards are out, less the combos that can't meet a single
// opposing hand. A river card's sides are those of them without the card, in order of strength on that board, each mapped
// back to its turn combo (`back`). A matchup that can be dealt leaves 52 - 4 - 8 = 40 cards for the river, each as likely,
// so a river's values count 1/40 at the turn: summed over the 48 cards, each matchup is counted over exactly the 40 it can
// see. A river card on which no matchup can be dealt has no game and counts nothing, which is what it's worth.
//
// Values inside are in chips, zero-sum, each seat credited half the turn's pot: a river's values, credited half the river's
// pot, are the same numbers, as the turn's bets are what makes the river's pot bigger.
import { NUM_CARDS } from "../cards";
import type { PloRange } from "../ranges";
import { withoutBlocked } from "../ranges";
import { addReach, blockedReach, SUBSETS, subsetTables } from "../river/blockers";
import { compileSides, RiverError, Terminals, type RiverGame, type Side } from "../river/game";
import { buildTree, checkSizes, type RiverSizes, type RiverTree, type Seat } from "../river/tree";

/** the river cards a matchup that can be dealt leaves */
export const RIVERS_PER_MATCHUP = NUM_CARDS - 4 - 8;

export interface TurnSpec {
  board: readonly number[];
  /** the seat acting first, then the seat acting last */
  ranges: readonly [PloRange, PloRange];
  pot: number;
  /** each seat's chips behind at the turn: only the shorter one plays */
  stacks: readonly [number, number];
  turnSizes: RiverSizes;
  riverSizes: RiverSizes;
}

/** A river card's sides, in the river game's order, and each combo's turn index. */
export interface River {
  card: number;
  game: Pick<RiverGame, "sides" | "matchups" | "unmatched" | "setCount">;
  back: [Int32Array, Int32Array];
  terminals: Terminals;
}

/** Where the turn's betting closes: the river's pot and stack, and its tree, or null for all-in. */
export interface Closing {
  /** the turn node's id */
  id: number;
  /** the pot as the river starts */
  pot: number;
  /** chips behind as the river starts (0: all-in) */
  stack: number;
  tree: RiverTree | null;
}

export interface TurnGame {
  board: readonly number[];
  sides: [Side, Side];
  tree: RiverTree;
  /** the weight of every matchup that can be dealt on the turn */
  matchups: number;
  /** combos dropped for sharing a card with every hand the other side holds */
  unmatched: [number, number];
  setCount: number;
  /** every card that can come, with a game; a card where no matchup can be dealt is left out */
  rivers: River[];
  /** by turn node id */
  closings: Map<number, Closing>;
  riverSizes: RiverSizes;
}

function pick<T extends Int32Array | Float32Array>(xs: T, keep: readonly number[]): T {
  const out = new (xs.constructor as new (n: number) => T)(keep.length);
  keep.forEach((i, k) => (out[k] = xs[i]!));
  return out;
}

/** A street's sides before the river: no strength, as the street has no showdown of its own. */
export function turnSides(ranges: readonly [PloRange, PloRange], board: readonly number[]): Pick<TurnGame, "sides" | "matchups" | "unmatched" | "setCount"> {
  const live = ranges.map((r) => withoutBlocked(r, board));
  const a = live[0]!;
  const b = live[1]!;
  if (!a.hands.length || !b.hands.length) throw new RiverError(`The ${a.hands.length ? "IP" : "OOP"} range has no hand left once the board's cards are out.`);
  const counted = subsetTables([a.hands, b.hands]);
  const meets = (me: Int32Array, other: Int32Array, otherN: number) => {
    const sum = new Float64Array(counted.count);
    for (let j = 0; j < otherN; j++) addReach(sum, other, j * SUBSETS, 1);
    return Float64Array.from({ length: me.length / SUBSETS }, (_, i) => otherN - blockedReach(sum, me, i * SUBSETS));
  };
  const keepOf = (can: Float64Array) => Array.from(can.keys()).filter((i) => can[i]! > 0.5);
  const keepA = keepOf(meets(counted.tables[0]!, counted.tables[1]!, b.hands.length));
  const keepB = keepOf(meets(counted.tables[1]!, counted.tables[0]!, a.hands.length));
  if (!keepA.length || !keepB.length) throw new RiverError("Every hand of one range shares a card with every hand of the other: no matchup can be dealt.");
  const ha = pick(a.hands, keepA);
  const hb = pick(b.hands, keepB);
  const { tables, count } = subsetTables([ha, hb]);
  const side = (hands: Int32Array, weights: Float32Array, sets: Int32Array): Side => ({
    n: hands.length,
    hands,
    weights: Float64Array.from(weights),
    strength: new Int32Array(hands.length),
    sets,
  });
  const sides: [Side, Side] = [side(ha, pick(a.weights, keepA), tables[0]!), side(hb, pick(b.weights, keepB), tables[1]!)];
  const sum = new Float64Array(count);
  let total = 0;
  for (let j = 0; j < sides[1].n; j++) {
    addReach(sum, sides[1].sets, j * SUBSETS, sides[1].weights[j]!);
    total += sides[1].weights[j]!;
  }
  let matchups = 0;
  for (let i = 0; i < sides[0].n; i++) matchups += sides[0].weights[i]! * (total - blockedReach(sum, sides[0].sets, i * SUBSETS));
  return { sides, matchups, unmatched: [a.hands.length - keepA.length, b.hands.length - keepB.length], setCount: count };
}

export const asRange = (s: Side): PloRange => ({ hands: s.hands, weights: Float32Array.from(s.weights) });

/** What a turn is on its card, whatever was bet before it: its sides and every river card's game. */
export type TurnCards = Pick<TurnGame, "board" | "sides" | "matchups" | "unmatched" | "setCount" | "rivers">;

/** A turn's sides and rivers on a board of four, or a RiverError (no matchup can be dealt). */
export function turnCards(ranges: readonly [PloRange, PloRange], board: readonly number[]): TurnCards {
  const turn = turnSides(ranges, board);
  const live: [PloRange, PloRange] = [asRange(turn.sides[0]), asRange(turn.sides[1])];
  const index = turn.sides.map((s) => new Map(Array.from(s.hands, (h, i) => [h, i])));
  const used = new Set(board);
  const rivers: River[] = [];
  for (let card = 0; card < NUM_CARDS; card++) {
    if (used.has(card)) continue;
    let game: River["game"];
    try {
      game = compileSides(live, [...board, card]);
    } catch (e) {
      if (e instanceof RiverError) continue; // (no matchup can be dealt with this card out)
      throw e;
    }
    const back = game.sides.map((s, seat) => Int32Array.from(s.hands, (h) => index[seat]!.get(h)!)) as [Int32Array, Int32Array];
    rivers.push({ card, game, back, terminals: new Terminals(game) });
  }
  return { board, ...turn, rivers };
}

/** Where a street's betting closes, by node id: the next street's pot and stack, and its tree at `sizes` (null all-in).
 * `trees` shares a tree between closings with the same pot and stack. */
export function closingsOf(tree: RiverTree, pot: number, stack: number, sizes: RiverSizes, trees = new Map<string, RiverTree>()): Map<number, Closing> {
  const closings = new Map<number, Closing>();
  for (const node of tree.nodes) {
    if (node.kind !== "showdown") continue;
    const bet = node.bets[0];
    const nextPot = Math.round((pot + 2 * bet) * 100) / 100;
    const behind = Math.round((stack - bet) * 100) / 100;
    if (behind <= 0) {
      closings.set(node.id, { id: node.id, pot: nextPot, stack: 0, tree: null });
      continue;
    }
    const key = `${nextPot}:${behind}`;
    if (!trees.has(key)) trees.set(key, buildTree(nextPot, behind, sizes));
    closings.set(node.id, { id: node.id, pot: nextPot, stack: behind, tree: trees.get(key)! });
  }
  return closings;
}

/** The game of a spec, or a RiverError saying what's wrong with it. */
export function compileTurn(spec: TurnSpec): TurnGame {
  const { board, pot, stacks } = spec;
  if (board.length !== 4 || new Set(board).size !== 4) throw new RiverError("A turn board is four different cards.");
  if (!(pot >= 2)) throw new RiverError("The pot is at least 2bb: both seats have a blind in by the turn.");
  const stack = Math.min(stacks[0], stacks[1]);
  if (!(stack > 0)) throw new RiverError("Both seats need chips behind.");
  for (const [street, sizes] of [
    ["turn", spec.turnSizes],
    ["river", spec.riverSizes],
  ] as const) {
    const wrong = checkSizes(sizes);
    if (wrong) throw new RiverError(`The ${street}: ${wrong}`);
  }

  const cards = turnCards(spec.ranges, board);
  const tree = buildTree(pot, stack, spec.turnSizes);
  return { ...cards, tree, closings: closingsOf(tree, pot, stack, spec.riverSizes), riverSizes: spec.riverSizes };
}

/** A river card's game at one closing of the turn. */
export const riverGame = (r: River, tree: RiverTree): RiverGame => ({ ...r.game, tree });

/** A seat's other. */
export const other = (s: Seat): Seat => (1 - s) as Seat;
