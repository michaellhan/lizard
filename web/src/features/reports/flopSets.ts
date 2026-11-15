// The flop sets a custom report solves: the solver's representative flops (solver/gto/flop_library.py
// representative_flops), ported so a set of n here is the very set the library stores at n, card for card.
//
// How the solver picks them. Every flop up to suit relabelling (the 1,755 classes, each the least of its 24 relabellings
// as a tuple of card numbers high to low), sorted by texture (suit pattern, pairing, the ranks high to low, and on a
// two-tone flop whether the low card is one of the suited two), then one class at each 1/n step of the cumulative count
// of the 22,100 flops: systematic sampling by how often each occurs. So a class is picked about in proportion to how
// often it's dealt, and each picked flop then stands for 22,100/n flops (report_weights: its own count would weigh it
// twice). A card is rank * 4 + suit, the suits c d h s.
import { texture, type TextureKey } from "@/features/practice/texture";
import { ALL_FLOPS } from "./reports";

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const PERMS: readonly number[][] = (() => {
  const out: number[][] = [];
  const go = (rest: number[], acc: number[]) => (rest.length ? rest.forEach((c, i) => go([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, c])) : out.push(acc));
  go([0, 1, 2, 3], []);
  return out;
})();

const cardText = (c: number) => RANKS[c >> 2]! + SUITS[c & 3]!;
const less = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

/** A flop's class: the least, as its cards high to low, of its 24 suit relabellings (flop_library.canonical). */
export function canonicalFlop(cards: readonly number[]): number[] {
  let best: number[] | null = null;
  for (const p of PERMS) {
    const t = cards.map((c) => (c >> 2) * 4 + p[c & 3]!).sort((x, y) => y - x);
    if (!best || less(t, best)) best = t;
  }
  return best!;
}

export interface FlopClass {
  /** the class's flop as the solver names it ("Ks7d2c", high card first) */
  f: string;
  cards: number[];
  /** how many of the 22,100 flops it stands for (its suit relabellings) */
  count: number;
}

let classes: FlopClass[] | null = null;

/** Every class, in the order the solver first meets it (all_flops), with its count. Worked out once: 22,100 flops x 24. */
export function allFlopClasses(): readonly FlopClass[] {
  if (classes) return classes;
  const at = new Map<string, FlopClass>();
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++) {
        const k = canonicalFlop([a, b, c]);
        const f = k.map(cardText).join("");
        const have = at.get(f);
        if (have) have.count++;
        else at.set(f, { f, cards: k, count: 1 });
      }
  return (classes = [...at.values()]);
}

/** flop_library._texture, as an array compared item by item (the ranks spread in place). */
function textureKey(f: readonly number[]): number[] {
  const bySuit = [0, 1, 2, 3].map((s) => f.filter((c) => (c & 3) === s).length);
  const suits = [...bySuit].sort((x, y) => y - x);
  const ranks = f.map((c) => c >> 2).sort((x, y) => y - x);
  const paired = 3 - new Set(ranks).size;
  let suitedLo = 0;
  if (suits[0] === 2) {
    // (Python's max over the suits picks the first at the most)
    const s = bySuit.indexOf(2);
    suitedLo = Math.min(...f.filter((c) => (c & 3) === s).map((c) => c >> 2)) === ranks[2] ? 1 : 0;
  }
  return [suits[0]!, paired, ...ranks, suitedLo];
}

const cmp = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

/** The n representative flops (representative_flops(n)), in texture order; every class where n is 1,755 or more. */
export function representativeFlops(n: number): FlopClass[] {
  const all = allFlopClasses();
  // (a stable sort, as Python's: classes alike in texture keep the order they were met)
  const keys = [...all].map((x) => ({ x, k: textureKey(x.cards) })).sort((a, b) => cmp(a.k, b.k)).map((y) => y.x);
  if (n >= keys.length) return keys;
  const tot = keys.reduce((s, x) => s + x.count, 0);
  const out: FlopClass[] = [];
  let acc = 0;
  let j = 0;
  for (const k of keys) {
    const lo = acc;
    acc += k.count;
    while (j < n && lo <= ((j + 0.5) * tot) / n && ((j + 0.5) * tot) / n < acc) {
      if (out.at(-1) !== k) out.push(k);
      j++;
    }
  }
  return out;
}

/** The set sizes offered: the solver's representative sets, the largest the library's own 184. Each flop is a solve, so
 * the largest bounds how long a report runs and how much it keeps. */
export const FLOP_SET_SIZES = [9, 25, 49, 95, 184] as const;
export type FlopSetSize = (typeof FLOP_SET_SIZES)[number];
export const isFlopSetSize = (n: unknown): n is FlopSetSize => (FLOP_SET_SIZES as readonly unknown[]).includes(n);

/** A flop of a set, with the weight it has in the report's averages (22,100/n: report_weights) and how often it's dealt. */
export interface SetFlop {
  f: string;
  /** flops of the 22,100 it stands for in the averages */
  w: number;
  /** flops of the 22,100 its own class is */
  count: number;
}

/** The set of n, with each flop's weight. */
export function flopSet(n: number): SetFlop[] {
  const fl = representativeFlops(n);
  const each = fl.length >= allFlopClasses().length ? null : ALL_FLOPS / fl.length;
  return fl.map((x) => ({ f: x.f, w: each ?? x.count, count: x.count }));
}

/** For each value of a texture group, its share in the set (by weight) and among all 22,100 flops: how representative a
 * set is, shown beside it. */
export function textureShares(set: readonly SetFlop[], key: TextureKey): { value: string; set: number; all: number }[] {
  const tally = (xs: readonly { f: string; w: number }[]) => {
    const m = new Map<string, number>();
    let tot = 0;
    for (const x of xs) {
      const v = texture(x.f)[key];
      m.set(v, (m.get(v) ?? 0) + x.w);
      tot += x.w;
    }
    return { m, tot };
  };
  const s = tally(set);
  const a = tally(allFlopClasses().map((x) => ({ f: x.f, w: x.count })));
  return [...a.m.keys()].map((value) => ({ value, set: (s.m.get(value) ?? 0) / (s.tot || 1), all: a.m.get(value)! / a.tot }));
}
