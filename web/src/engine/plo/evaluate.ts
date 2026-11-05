// PLO4 hand strength: the best five cards using exactly two of the four hole cards and exactly three of the board's.
// The rest is plain five-card poker, so a value reads as poker/evaluate.ts does (rankOmaha returns its HandValue, with
// its cmp and handName), and evaluate.test.ts holds eval5 to that file's rank7 and to the published counts.
//
// eval5 is the loop's inner step: it allocates nothing and returns one integer, higher is better. The category sits
// above bit 17, and under it the tie-breakers: a set of ranks as a 13-bit mask, which compares the way the sorted ranks
// do, and a single rank as a number.
import { cmp, type HandValue } from "@/poker/evaluate";
import { cardId } from "./cards";

export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

const SHIFT = 17;
/** bits set in a 13-bit mask */
const COUNT = new Uint8Array(8192);
/** a mask of five ranks that is a straight -> its top rank, 3 for the wheel (0 otherwise: no straight tops out on a 2) */
const STRAIGHT_TOP = new Uint8Array(8192);
for (let m = 1; m < 8192; m++) COUNT[m] = COUNT[m >> 1]! + (m & 1);
for (let top = 4; top <= 12; top++) STRAIGHT_TOP[0x1f << (top - 4)] = top;
STRAIGHT_TOP[0x100f] = 3; // A2345

const topRank = (mask: number) => 31 - Math.clz32(mask);

/** Five distinct cards as a value. */
export function eval5(a: number, b: number, c: number, d: number, e: number): number {
  const ba = 1 << (a >> 2);
  const bb = 1 << (b >> 2);
  const bc = 1 << (c >> 2);
  const bd = 1 << (d >> 2);
  const be = 1 << (e >> 2);
  const ranks = ba | bb | bc | bd | be;
  if (COUNT[ranks] === 5) {
    const suit = a & 3;
    const flush = (b & 3) === suit && (c & 3) === suit && (d & 3) === suit && (e & 3) === suit;
    const top = STRAIGHT_TOP[ranks]!;
    if (top) return ((flush ? STRAIGHT_FLUSH : STRAIGHT) << SHIFT) | top;
    return ((flush ? FLUSH : HIGH_CARD) << SHIFT) | ranks;
  }
  // bits seen at least two, three and four times
  let two = 0;
  let three = 0;
  let four = 0;
  let seen = ba;
  two |= seen & bb;
  seen |= bb;
  three |= two & bc;
  two |= seen & bc;
  seen |= bc;
  four |= three & bd;
  three |= two & bd;
  two |= seen & bd;
  seen |= bd;
  four |= three & be;
  three |= two & be;
  two |= seen & be;
  if (four) return (QUADS << SHIFT) | (topRank(four) << 4) | topRank(ranks ^ four);
  if (three) {
    if (two !== three) return (FULL_HOUSE << SHIFT) | (topRank(three) << 4) | topRank(two ^ three);
    return (TRIPS << SHIFT) | (topRank(three) << 13) | (ranks ^ three);
  }
  if (COUNT[two] === 2) return (TWO_PAIR << SHIFT) | (two << 4) | topRank(ranks ^ two);
  return (PAIR << SHIFT) | (topRank(two) << 13) | (ranks ^ two);
}

/** The ranks of a mask as card values 2..14, high first. */
function valuesOf(mask: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0; r--) if (mask & (1 << r)) out.push(r + 2);
  return out;
}

/** A value of eval5 as poker/evaluate.ts writes it: [category, tie-breakers...], ranks 2..14. */
export function toHandValue(score: number): HandValue {
  const category = score >> SHIFT;
  const low = score & ((1 << SHIFT) - 1);
  switch (category) {
    case STRAIGHT_FLUSH:
    case STRAIGHT:
      return [category, low + 2]; // (the wheel's top card is its five)
    case QUADS:
    case FULL_HOUSE:
      return [category, (low >> 4) + 2, (low & 15) + 2];
    case FLUSH:
    case HIGH_CARD:
      return [category, ...valuesOf(low)];
    case TWO_PAIR:
      return [category, ...valuesOf(low >> 4), (low & 15) + 2];
    default: // trips, a pair: the rank, then its kickers
      return [category, (low >> 13) + 2, ...valuesOf(low & 8191)];
  }
}

/** The best value of a hand on a board of 3 to 5 cards, exactly two from the hand and three from the board. */
export function bestOmaha(hole: ArrayLike<number>, board: ArrayLike<number>): number {
  let best = -1;
  const n = board.length;
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 4; j++) {
      const x = hole[i]!;
      const y = hole[j]!;
      for (let p = 0; p < n - 2; p++)
        for (let q = p + 1; q < n - 1; q++)
          for (let r = q + 1; r < n; r++) {
            const v = eval5(x, y, board[p]!, board[q]!, board[r]!);
            if (v > best) best = v;
          }
    }
  return best;
}

function check(hole: readonly unknown[], board: readonly unknown[]) {
  if (hole.length !== 4) throw new Error(`a PLO4 hand has 4 cards, not ${hole.length}`);
  if (board.length < 3 || board.length > 5) throw new Error(`a PLO4 hand is valued on 3 to 5 board cards, not ${board.length}`);
}

/** As rank7, for PLO4: what `settle` takes as its hand. */
export function rankOmaha(hole: readonly string[], board: readonly string[]): HandValue {
  check(hole, board);
  return toHandValue(bestOmaha(hole.map(cardId), board.map(cardId)));
}

export interface OmahaHand {
  value: HandValue;
  /** the two hole cards played */
  hole: [string, string];
  /** the three board cards played */
  board: [string, string, string];
}

/** The best hand and the cards it plays (the first such, where several ways give the same value). */
export function bestOmahaHand(hole: readonly string[], board: readonly string[]): OmahaHand {
  check(hole, board);
  let best: OmahaHand | null = null;
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 4; j++)
      for (let p = 0; p < board.length - 2; p++)
        for (let q = p + 1; q < board.length - 1; q++)
          for (let r = q + 1; r < board.length; r++) {
            const two: [string, string] = [hole[i]!, hole[j]!];
            const three: [string, string, string] = [board[p]!, board[q]!, board[r]!];
            const [a, b, c, d, e] = [...two, ...three].map(cardId) as [number, number, number, number, number];
            const value = toHandValue(eval5(a, b, c, d, e));
            if (!best || cmp(value, best.value) > 0) best = { value, hole: two, board: three };
          }
  return best!;
}
