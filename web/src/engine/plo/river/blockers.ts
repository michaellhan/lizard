// What a hand can meet: the sum over every opposing hand that shares no card with it. This is the one place a four-card
// game differs most from hold'em. A random four-card hand blocks about 30% of the hands left, not the 8% of two cards, and
// the blocked ones can't be read off a card at a time: a hand sharing two cards with this one is counted by both cards.
//
// Inclusion-exclusion puts it right exactly. For opposing reach r, with S the sum of r over the hands holding every card
// of a set, the sum over the hands that share no card with hand h is
//
//   total - (S of each 1 card of h) + (S of each 2) - (S of each 3) + (S of the 4)
//
// A hand sharing k >= 1 cards with h is counted 1 - k + C(k,2) - C(k,3) + C(k,4) = (1 - 1)^k = 0 times, and one sharing
// none once. So a pass costs 15 reads a hand and 15 writes a hand, against the n * n of asking each pair: it needs only
// the table of sets. Sets are given small ids, the single cards first, as those are read most, so the table is as short as
// the hands in play allow. blockers.test.ts holds it to the pair by pair count on random reaches.
import { handAt, NUM_HANDS } from "../combos";

/** the nonempty subsets of a four-card hand */
export const SUBSETS = 15;

const NUM_PAIRS = 1326;
const NUM_TRIPLES = 22100;
const PAIR_BASE = 52;
const TRIPLE_BASE = PAIR_BASE + NUM_PAIRS;
const QUAD_BASE = TRIPLE_BASE + NUM_TRIPLES;
const ALL_SETS = QUAD_BASE + NUM_HANDS;

const c2 = (n: number) => (n * (n - 1)) / 2;
const c3 = (n: number) => (n * (n - 1) * (n - 2)) / 6;

/** Sets a hand's 15 sets in place: its 4 cards, 6 pairs, 4 triples and itself, in that order. */
function setsOf(handIndex: number, out: Int32Array): void {
  const [a, b, c, d] = handAt(handIndex);
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  out[4] = PAIR_BASE + c2(b) + a;
  out[5] = PAIR_BASE + c2(c) + a;
  out[6] = PAIR_BASE + c2(c) + b;
  out[7] = PAIR_BASE + c2(d) + a;
  out[8] = PAIR_BASE + c2(d) + b;
  out[9] = PAIR_BASE + c2(d) + c;
  out[10] = TRIPLE_BASE + c3(c) + c2(b) + a;
  out[11] = TRIPLE_BASE + c3(d) + c2(b) + a;
  out[12] = TRIPLE_BASE + c3(d) + c2(c) + a;
  out[13] = TRIPLE_BASE + c3(d) + c2(c) + b;
  out[14] = QUAD_BASE + handIndex;
}

/** Each range's hands' sets, as ids in 0..count. */
export function subsetTables(ranges: readonly (ArrayLike<number> & Iterable<number>)[]): { tables: Int32Array[]; count: number } {
  const id = new Int32Array(ALL_SETS).fill(-1);
  const raw = ranges.map((hands) => {
    const t = new Int32Array(hands.length * SUBSETS);
    const one = new Int32Array(SUBSETS);
    let at = 0;
    for (const h of hands) {
      setsOf(h, one);
      t.set(one, at);
      at += SUBSETS;
    }
    return t;
  });
  let count = 0;
  // sized sets in order, singles first
  for (const [from, to] of [
    [0, 4],
    [4, 10],
    [10, 14],
    [14, 15],
  ] as const)
    for (const t of raw)
      for (let at = 0; at < t.length; at += SUBSETS)
        for (let k = from; k < to; k++) {
          const s = t[at + k]!;
          if (id[s] === -1) id[s] = count++;
        }
  for (const t of raw) for (let i = 0; i < t.length; i++) t[i] = id[t[i]!]!;
  return { tables: raw, count };
}

/** The reach of the hands sharing a card with the hand at `at`, from `sum`, the sums by set. */
export function blockedReach(sum: Float64Array, sets: Int32Array, at: number): number {
  return (
    sum[sets[at]!]! +
    sum[sets[at + 1]!]! +
    sum[sets[at + 2]!]! +
    sum[sets[at + 3]!]! -
    sum[sets[at + 4]!]! -
    sum[sets[at + 5]!]! -
    sum[sets[at + 6]!]! -
    sum[sets[at + 7]!]! -
    sum[sets[at + 8]!]! -
    sum[sets[at + 9]!]! +
    sum[sets[at + 10]!]! +
    sum[sets[at + 11]!]! +
    sum[sets[at + 12]!]! +
    sum[sets[at + 13]!]! -
    sum[sets[at + 14]!]!
  );
}

/** One hand's reach into every set it's in. */
export function addReach(sum: Float64Array, sets: Int32Array, at: number, r: number): void {
  for (let k = at; k < at + SUBSETS; k++) sum[sets[k]!]! += r;
}

/** The hands sharing no card, two hands at a time, for the tests and nothing else. */
export const sharesCard = (a: number, b: number): boolean => {
  const x = handAt(a);
  const y = new Set(handAt(b));
  return x.some((c) => y.has(c));
};
