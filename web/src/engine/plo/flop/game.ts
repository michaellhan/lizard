// A heads-up PLO4 flop as numbers: the flop's betting tree, and where the flop's betting closes with chips behind, a turn
// for every card that can come, each its own turn game (../turn/game.ts) with every river after it, on the turn's tree
// for that closing's pot and stack. Where the flop's betting closes all-in, every turn and river is a showdown.
//
// The flop's sides are the ranges' hands left once the board's three cards are out, less the combos that can't meet a
// single opposing hand. A turn card's sides are those of them without the card, each mapped back to its flop combo
// (`back`). A matchup that can be dealt leaves 52 - 3 - 8 = 41 cards for the turn, each as likely, so a turn's values
// count 1/41 at the flop. Values inside are in chips, zero-sum, each seat credited half the flop's pot.
import { NUM_CARDS } from "../cards";
import type { PloRange } from "../ranges";
import { RiverError, Terminals } from "../river/game";
import { buildTree, checkSizes, type RiverSizes, type RiverTree } from "../river/tree";
import { asRange, closingsOf, turnCards, turnSides, type Closing, type TurnCards, type TurnGame } from "../turn/game";

/** the turn cards a matchup that can be dealt leaves */
export const TURNS_PER_MATCHUP = NUM_CARDS - 3 - 8;

export interface FlopSpec {
  board: readonly number[];
  /** the seat acting first, then the seat acting last */
  ranges: readonly [PloRange, PloRange];
  pot: number;
  /** each seat's chips behind at the flop: only the shorter one plays */
  stacks: readonly [number, number];
  flopSizes: RiverSizes;
  turnSizes: RiverSizes;
  riverSizes: RiverSizes;
}

/** A turn card: its turn's sides and rivers, each combo's flop index, and the sums its folds are counted with. */
export interface TurnCard {
  card: number;
  cards: TurnCards;
  back: [Int32Array, Int32Array];
  terminals: Terminals;
}

/** Where the flop's betting closes: the turn's pot and stack, its tree and the turn's own closings, or null all-in. */
export interface FlopClosing extends Closing {
  turnClosings: Map<number, Closing> | null;
}

export interface FlopGame {
  board: readonly number[];
  sides: TurnGame["sides"];
  tree: RiverTree;
  matchups: number;
  unmatched: [number, number];
  setCount: number;
  /** every card that can come on the turn, with a game */
  turns: TurnCard[];
  /** by flop node id */
  closings: Map<number, FlopClosing>;
  turnSizes: RiverSizes;
  riverSizes: RiverSizes;
}

/** The game of a spec, or a RiverError saying what's wrong with it. */
export function compileFlop(spec: FlopSpec): FlopGame {
  const { board, pot, stacks } = spec;
  if (board.length !== 3 || new Set(board).size !== 3) throw new RiverError("A flop board is three different cards.");
  if (!(pot >= 2)) throw new RiverError("The pot is at least 2bb: both seats have a blind in by the flop.");
  const stack = Math.min(stacks[0], stacks[1]);
  if (!(stack > 0)) throw new RiverError("Both seats need chips behind.");
  for (const [street, sizes] of [
    ["flop", spec.flopSizes],
    ["turn", spec.turnSizes],
    ["river", spec.riverSizes],
  ] as const) {
    const wrong = checkSizes(sizes);
    if (wrong) throw new RiverError(`The ${street}: ${wrong}`);
  }

  const flop = turnSides(spec.ranges, board);
  const live: [PloRange, PloRange] = [asRange(flop.sides[0]), asRange(flop.sides[1])];
  const index = flop.sides.map((s) => new Map(Array.from(s.hands, (h, i) => [h, i])));
  const used = new Set(board);
  const turns: TurnCard[] = [];
  for (let card = 0; card < NUM_CARDS; card++) {
    if (used.has(card)) continue;
    let cards: TurnCards;
    try {
      cards = turnCards(live, [...board, card]);
    } catch (e) {
      if (e instanceof RiverError) continue; // (no matchup can be dealt with this card out)
      throw e;
    }
    const back = cards.sides.map((s, seat) => Int32Array.from(s.hands, (h) => index[seat]!.get(h)!)) as [Int32Array, Int32Array];
    turns.push({ card, cards, back, terminals: new Terminals(cards) });
  }

  const tree = buildTree(pot, stack, spec.flopSizes);
  const riverTrees = new Map<string, RiverTree>();
  const closings = new Map<number, FlopClosing>();
  for (const c of closingsOf(tree, pot, stack, spec.turnSizes).values())
    closings.set(c.id, { ...c, turnClosings: c.tree ? closingsOf(c.tree, c.pot, c.stack, spec.riverSizes, riverTrees) : null });
  return { board, ...flop, tree, turns, closings, turnSizes: spec.turnSizes, riverSizes: spec.riverSizes };
}

/** A turn card's game at one closing of the flop (one with chips behind). */
export function turnGameAt(t: TurnCard, closing: FlopClosing, riverSizes: RiverSizes): TurnGame {
  if (!closing.tree || !closing.turnClosings) throw new Error("an all-in closing has no turn to play");
  return { ...t.cards, tree: closing.tree, closings: closing.turnClosings, riverSizes };
}
