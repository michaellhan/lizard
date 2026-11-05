// The 270,725 starting hands and their 16,432 classes under relabelling the suits.
//
// A hand here is four card ids, ascending; handIndex is its place in colexicographic order, a dense 0..270,724 with
// handAt its inverse. The suits of a hand don't matter as names: a hand is fixed by which ranks each suit holds, a
// 13-bit mask per suit, so two hands are the same but for suit names exactly when they have the same four masks in some
// order. Sorting the masks (longest suit first, then highest) gives the canonical hand, and the sort is the relabelling.
// The class table takes a sweep of all the hands, so it's built on first use and stays out of everything that doesn't.
import { cardRank, cardSuit } from "./cards";

export const NUM_HANDS = 270_725;
export const NUM_CLASSES = 16_432;

export type Hand = readonly [number, number, number, number];
/** maps a suit to a suit, a permutation of 0..3 */
export type SuitMap = readonly [number, number, number, number];

const C2 = (n: number) => (n * (n - 1)) / 2;
const C3 = (n: number) => (n * (n - 1) * (n - 2)) / 6;
const C4 = (n: number) => (n * (n - 1) * (n - 2) * (n - 3)) / 24;

export function handIndex(h: Hand): number {
  return h[0] + C2(h[1]) + C3(h[2]) + C4(h[3]);
}

export function handAt(index: number): [number, number, number, number] {
  if (!Number.isInteger(index) || index < 0 || index >= NUM_HANDS) throw new Error(`no hand ${index}`);
  let x = index;
  const take = (k: number, of: (n: number) => number) => {
    let n = k - 1;
    while (of(n + 1) <= x) n++;
    x -= of(n);
    return n;
  };
  const d = take(4, C4);
  const c = take(3, C3);
  const b = take(2, C2);
  return [x, b, c, d];
}

export function sortHand(cards: ArrayLike<number>): [number, number, number, number] {
  const h = Array.from(cards).sort((a, b) => a - b);
  if (h.length !== 4 || new Set(h).size !== 4) throw new Error("a PLO4 hand is 4 different cards");
  return h as [number, number, number, number];
}

export const relabel = (h: Hand, map: SuitMap): [number, number, number, number] =>
  sortHand(h.map((c) => (c & ~3) | map[cardSuit(c)]!));

export function invertSuits(map: SuitMap): SuitMap {
  const inv = [0, 0, 0, 0] as [number, number, number, number];
  map.forEach((to, from) => (inv[to] = from));
  return inv;
}

export interface Canonical {
  hand: [number, number, number, number];
  /** canonical = relabel(hand, map); relabel(canonical, invertSuits(map)) gives the hand back */
  map: SuitMap;
}

const bits = (m: number) => {
  let n = 0;
  for (let x = m; x; x &= x - 1) n++;
  return n;
};

export function canonicalise(hand: Hand): Canonical {
  const masks = [0, 0, 0, 0];
  for (const c of hand) masks[cardSuit(c)]! |= 1 << cardRank(c);
  const order = [0, 1, 2, 3].sort((a, b) => bits(masks[b]!) - bits(masks[a]!) || masks[b]! - masks[a]! || a - b);
  const map = [0, 0, 0, 0] as [number, number, number, number];
  order.forEach((suit, to) => (map[suit] = to));
  return { hand: relabel(hand, map), map };
}

/** Every hand of a canonical hand's class, each once: 24 relabellings over how many leave it fixed. */
export function orbit(hand: Hand): Hand[] {
  const seen = new Map<number, Hand>();
  for (const map of ALL_SUIT_MAPS) {
    const h = relabel(hand, map);
    seen.set(handIndex(h), h);
  }
  return [...seen.values()];
}

export const ALL_SUIT_MAPS: readonly SuitMap[] = (() => {
  const out: SuitMap[] = [];
  for (const a of [0, 1, 2, 3])
    for (const b of [0, 1, 2, 3])
      for (const c of [0, 1, 2, 3])
        for (const d of [0, 1, 2, 3]) if (new Set([a, b, c, d]).size === 4) out.push([a, b, c, d]);
  return out;
})();

export interface ClassTable {
  /** class id by hand index */
  classOf: Uint16Array;
  /** canonical hand's index by class id, ascending */
  canonical: Int32Array;
  /** hands in each class */
  size: Uint8Array;
}

let table: ClassTable | null = null;

export function classTable(): ClassTable {
  if (table) return table;
  const canon = new Int32Array(NUM_HANDS);
  for (let i = 0; i < NUM_HANDS; i++) canon[i] = handIndex(canonicalise(handAt(i)).hand);
  const reps = Int32Array.from(new Set(canon)).sort();
  const id = new Map<number, number>();
  reps.forEach((r, i) => id.set(r, i));
  const classOf = new Uint16Array(NUM_HANDS);
  const size = new Uint8Array(reps.length);
  for (let i = 0; i < NUM_HANDS; i++) {
    const c = id.get(canon[i]!)!;
    classOf[i] = c;
    size[c]!++;
  }
  table = { classOf, canonical: reps, size };
  return table;
}
