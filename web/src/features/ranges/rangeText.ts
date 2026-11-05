// Range text in the common solver format (PioSOLVER / GTO+ style): classes or combos separated by commas or spaces,
// each with an optional ":weight" (0..1), plus "+" and "-" shorthands ("22+", "A2s+", "KTo-K7o", "T9s-65s") and
// "random" (or "any", "100%") for every hand, in any case, as the solver reads them (solver/gto/ranges.py). This is
// the UI's model, by hand class: a single combo ("AhKh") is read as its share of the class (a quarter of AKs).
import { ALL_CLASSES, classCombos, classOf, RANKS } from "@/engine/nlhe/cards";

export type ClassWeights = Record<string, number>;

const R = (c: string) => RANKS.indexOf(c as (typeof RANKS)[number]);
const RK = "([AKQJT2-9])";

/** the classes of two ranks (RANKS indexes, either order) and a suitedness ("" for both) */
function classes(a: number, b: number, s: string): string[] {
  if (a === b) return [RANKS[a]! + RANKS[a]!];
  const [hi, lo] = a < b ? [a, b] : [b, a];
  return (s ? [s] : ["s", "o"]).map((x) => RANKS[hi]! + RANKS[lo]! + x);
}

function expandToken(tok: string): string[] {
  const t = tok.trim().toUpperCase();
  if (!t) return [];
  if (t === "RANDOM" || t === "ANY" || t === "100%") return [...ALL_CLASSES];
  // pairs: "77", "22+", "TT-77"
  let m = new RegExp(`^${RK}\\1(\\+)?$`).exec(t);
  if (m) return m[2] ? RANKS.slice(0, R(m[1]!) + 1).map((r) => r + r) : [m[1]! + m[1]!];
  m = new RegExp(`^${RK}\\1-${RK}\\2$`).exec(t);
  if (m) {
    const [a, b] = [R(m[1]!), R(m[2]!)].sort((x, y) => x - y) as [number, number];
    return RANKS.slice(a, b + 1).map((r) => r + r);
  }
  // non-pairs: "AKs", "KAs", "A2s+" (the kicker up to just under the top card), "AK" (both)
  m = new RegExp(`^${RK}${RK}([SO])?(\\+)?$`).exec(t);
  if (m && m[1] !== m[2]) {
    const [hi, lo] = [R(m[1]!), R(m[2]!)].sort((x, y) => x - y) as [number, number];
    const s = (m[3] ?? "").toLowerCase();
    return m[4] ? RANKS.slice(hi + 1, lo + 1).flatMap((_, k) => classes(hi, hi + 1 + k, s)) : classes(hi, lo, s);
  }
  // runs: the same top card, kickers between ("KTo-K7o"), or the same gap, tops between ("T9s-65s")
  m = new RegExp(`^${RK}${RK}([SO])?-${RK}${RK}([SO])?$`).exec(t);
  if (m && m[1] !== m[2] && m[4] !== m[5] && (m[6] ?? m[3]) === m[3]) {
    const s = (m[3] ?? "").toLowerCase();
    const [a1, a2, b1, b2] = [R(m[1]!), R(m[2]!), R(m[4]!), R(m[5]!)];
    if (a1 === b1) {
      const [x, y] = [a2, b2].sort((p, q) => p - q) as [number, number];
      return RANKS.slice(x, y + 1).flatMap((_, k) => (x + k === a1 ? [] : classes(a1, x + k, s)));
    }
    const gap = a2 - a1;
    if (gap !== b2 - b1 || gap <= 0) return [];
    const [x, y] = [a1, b1].sort((p, q) => p - q) as [number, number];
    return RANKS.slice(x, y + 1).flatMap((_, k) => classes(x + k, x + k + gap, s));
  }
  return [];
}

/** a single combo ("AhKh", "kdks"): its two cards in a fixed order and its class; null for anything else */
function comboOf(tok: string): { key: string; cls: string } | null {
  const m = new RegExp(`^${RK}([SHDC])${RK}([SHDC])$`).exec(tok.trim().toUpperCase());
  if (!m) return null;
  const [x, y] = [m[1]! + m[2]!.toLowerCase(), m[3]! + m[4]!.toLowerCase()];
  if (x === y) return null;
  return { key: [x, y].sort().join(""), cls: classOf(x + y) };
}

/**
 * Parse range text into class weights. A hand named twice keeps its larger weight, as the solver's parser does. Single
 * combos come back in `combos` too: each is its class's share (one of AKs's four combos: AKs at 0.25, beside the
 * class's own weight where the text names it), since a class weight can't say which combos.
 */
export function parseRange(text: string): { weights: ClassWeights; unknown: string[]; combos: string[] } {
  const weights: ClassWeights = {};
  const unknown: string[] = [];
  const combos: string[] = [];
  const byCombo = new Map<string, Map<string, number>>();
  // (no spaces around a colon; split there, as a regex over a long run of spaces takes the square of its length)
  for (const part of text.split(":").map((x) => x.trim()).join(":").split(/[,\s]+/)) {
    if (!part) continue;
    const [tok = "", w, ...more] = part.split(":");
    const weight = w === undefined ? 1 : Number(w);
    const combo = comboOf(tok);
    const cls = combo ? [] : expandToken(tok);
    if (more.length || !(weight >= 0 && weight <= 1) || (!combo && !cls.length)) {
      unknown.push(part);
      continue;
    }
    if (combo) {
      const m = byCombo.get(combo.cls) ?? new Map<string, number>();
      byCombo.set(combo.cls, m.set(combo.key, Math.max(m.get(combo.key) ?? 0, weight)));
      combos.push(tok);
    }
    for (const c of cls) weights[c] = Math.max(weights[c] ?? 0, weight);
  }
  for (const [c, m] of byCombo) {
    const base = weights[c] ?? 0;
    let sum = base * (classCombos(c) - m.size);
    for (const w of m.values()) sum += Math.max(base, w);
    weights[c] = sum / classCombos(c);
  }
  return { weights, unknown, combos };
}

/** Class weights -> range text, one class per entry (weight omitted when 1). */
export function formatRange(weights: ClassWeights): string {
  return ALL_CLASSES.filter((c) => (weights[c] ?? 0) > 0)
    .map((c) => (weights[c]! >= 0.999 ? c : `${c}:${Number(weights[c]!.toFixed(3))}`))
    .join(",");
}

export function rangeCombos(weights: ClassWeights): number {
  let n = 0;
  for (const [c, w] of Object.entries(weights)) n += w * (c.length === 2 ? 6 : c[2] === "s" ? 4 : 12);
  return n;
}
