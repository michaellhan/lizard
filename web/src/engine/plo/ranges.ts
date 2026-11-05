// PLO4 ranges. There's no 13x13 grid to lean on: a range is a sparse list of hands, each with a weight, stored by hand
// index in two typed arrays (8 bytes a hand, 2.2 MB for every hand). A range whose weights don't depend on suit names
// also has a class form: one number for each of the 16,432 classes (66 KB), which is what a solver's table would hold.
//
// The text is this app's own, comma-separated, each item optionally "@percent":
//   AsKsQhJh    the exact hand
//   AAxx        by ranks, A..2 or x (or *) for any rank: "AAxx" is any hand holding two aces or more
//   KQJTds      the same, with a suit shape: ds double-suited (2+2), ss single-suited (2+1+1), r rainbow (1+1+1+1)
//   random      every hand
// A hand named twice keeps its highest weight.
import { RANKS } from "../nlhe/cards";
import { cardName, cardRank, cardSuit, parseIds } from "./cards";
import { canonicalise, classTable, handAt, handIndex, NUM_CLASSES, NUM_HANDS, orbit, sortHand } from "./combos";

export interface PloRange {
  /** hand indices, ascending */
  hands: Int32Array;
  /** each hand's weight, 0 < w <= 1 */
  weights: Float32Array;
}

const RANK_OF = new Map<string, number>([...RANKS].reverse().map((r, i) => [r, i]));
type Shape = "ds" | "ss" | "r" | null;

const shapeOf = (h: readonly number[]): string => {
  const n = [0, 0, 0, 0];
  for (const c of h) n[cardSuit(c)]!++;
  return n.sort((a, b) => b - a).join("");
};

const SHAPES: Record<Exclude<Shape, null>, string> = { ds: "2200", ss: "2110", r: "1111" };

function patternMatcher(ranks: string, shape: Shape): (h: readonly number[]) => boolean {
  const need = new Array<number>(13).fill(0);
  for (const r of ranks) if (r !== "X") need[RANK_OF.get(r)!]!++;
  const want = shape ? SHAPES[shape] : null;
  return (h) => {
    const have = new Array<number>(13).fill(0);
    for (const c of h) have[cardRank(c)]!++;
    return need.every((n, r) => have[r]! >= n) && (!want || shapeOf(h) === want);
  };
}

/** Parses a range; an error message for what can't be read. `dead` cards' hands are left out. */
export function parseRange(text: string, dead: readonly number[] = []): PloRange | string {
  const weights = new Map<number, number>();
  const items = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (!items.length) return "Enter a hand or a range.";
  const matchers: { test: (h: readonly number[]) => boolean; weight: number }[] = [];
  const add = (i: number, w: number) => weights.set(i, Math.max(weights.get(i) ?? 0, w));
  for (const item of items) {
    const [spec = "", pct, extra] = item.split("@");
    let weight = 1;
    if (pct !== undefined) {
      weight = Number(pct) / 100;
      if (extra !== undefined || !(weight > 0 && weight <= 1)) return `"${item}": a weight is @ and a percent above 0, up to 100.`;
    }
    const s = spec.trim();
    const exact = s.length === 8 ? parseIds(s, 4) : null;
    if (exact) {
      add(handIndex(sortHand(exact)), weight);
      continue;
    }
    if (/^(random|any)$/i.test(s)) {
      matchers.push({ test: () => true, weight });
      continue;
    }
    const m = /^([AKQJT2-9xX*]{4})(ds|ss|r)?$/.exec(s);
    if (!m) return `"${item}" isn't a hand or a pattern (AsKsQhJh, AAxx, KQJTds, random).`;
    const ranks = m[1]!.toUpperCase().replaceAll("*", "X");
    matchers.push({ test: patternMatcher(ranks, (m[2] ?? null) as Shape), weight });
  }
  if (matchers.length)
    for (let i = 0; i < NUM_HANDS; i++) {
      const h = handAt(i);
      for (const m of matchers) if (m.test(h)) add(i, m.weight);
    }
  return fromEntries([...weights].filter(([i]) => !blocked(i, dead)));
}

function blocked(i: number, dead: readonly number[]) {
  if (!dead.length) return false;
  const h = handAt(i);
  return h.some((c) => dead.includes(c));
}

function fromEntries(entries: [number, number][]): PloRange {
  entries.sort((a, b) => a[0] - b[0]);
  return { hands: Int32Array.from(entries, (e) => e[0]), weights: Float32Array.from(entries, (e) => e[1]) };
}

export const rangeSize = (r: PloRange): number => r.hands.length;

/** The sum of the weights: the range's size in hands. */
export function rangeWeight(r: PloRange): number {
  let t = 0;
  for (const w of r.weights) t += w;
  return t;
}

export const rangeHands = (r: PloRange): string[] => Array.from(r.hands, (i) => handAt(i).map(cardName).join(""));

/** The range without the hands that hold a dead card. */
export function withoutBlocked(r: PloRange, dead: readonly number[]): PloRange {
  const keep: [number, number][] = [];
  r.hands.forEach((h, k) => {
    if (!blocked(h, dead)) keep.push([h, r.weights[k]!]);
  });
  return fromEntries(keep);
}

/** Weights by class. Null if the range isn't one: a class whose hands aren't all at one weight has no single number. */
export function toClassWeights(r: PloRange): Float32Array | null {
  const t = classTable();
  const out = new Float32Array(NUM_CLASSES);
  const seen = new Uint8Array(NUM_CLASSES);
  r.hands.forEach((h, k) => {
    const c = t.classOf[h]!;
    if (seen[c] && out[c] !== r.weights[k]!) out[c] = NaN;
    else out[c] = r.weights[k]!;
    seen[c]!++;
  });
  for (let c = 0; c < NUM_CLASSES; c++) if (seen[c] && (seen[c] !== t.size[c] || Number.isNaN(out[c]!))) return null;
  return out;
}

export function fromClassWeights(weights: Float32Array): PloRange {
  const t = classTable();
  const entries: [number, number][] = [];
  weights.forEach((w, c) => {
    if (w > 0) for (const h of orbit(handAt(t.canonical[c]!))) entries.push([handIndex(h), w]);
  });
  return fromEntries(entries);
}

/** The class id of a hand given as cards. */
export const classIdOf = (cards: ArrayLike<number>): number => classTable().classOf[handIndex(canonicalise(sortHand(cards)).hand)]!;
