// Range text in the common solver format (PioSOLVER / GTO+ style): comma-separated classes or combos, each with an
// optional ":weight" (0..1), plus "+" and "-" shorthands for pairs and kicker runs ("22+", "A2s+", "KTo-K7o").
// The solver parses ranges itself (solver/gto/ranges.py); this is the UI's editor model.
import { ALL_CLASSES, RANKS } from "@/engine/nlhe/cards";

export type ClassWeights = Record<string, number>;

const R = (c: string) => RANKS.indexOf(c as (typeof RANKS)[number]);

function expandToken(tok: string): string[] {
  const t = tok.trim();
  if (!t) return [];
  // pairs: "77", "22+", "TT-77"
  let m = /^([AKQJT2-9])\1(\+)?$/.exec(t);
  if (m) {
    const i = R(m[1]!);
    if (!m[2]) return [m[1]! + m[1]!];
    return RANKS.slice(0, i + 1).map((r) => r + r);
  }
  m = /^([AKQJT2-9])\1-([AKQJT2-9])\2$/.exec(t);
  if (m) {
    const [a, b] = [R(m[1]!), R(m[2]!)].sort((x, y) => x - y) as [number, number];
    return RANKS.slice(a, b + 1).map((r) => r + r);
  }
  // non-pairs: "AKs", "A2s+", "KTo-K7o", "AK" (both)
  m = /^([AKQJT2-9])([AKQJT2-9])([so])?(\+)?$/.exec(t);
  if (m) {
    const [hi, lo] = [R(m[1]!), R(m[2]!)];
    if (hi >= lo) return [];
    const suits = m[3] ? [m[3]] : ["s", "o"];
    const los = m[4] ? RANKS.slice(hi + 1, lo + 1) : [RANKS[lo]!];
    return los.flatMap((l) => suits.map((s) => `${m![1]}${l}${s}`));
  }
  m = /^([AKQJT2-9])([AKQJT2-9])([so])-\1([AKQJT2-9])\3$/.exec(t);
  if (m) {
    const [a, b] = [R(m[2]!), R(m[4]!)].sort((x, y) => x - y) as [number, number];
    return RANKS.slice(a, b + 1).map((l) => `${m![1]}${l}${m![3]}`);
  }
  return [];
}

/** Parse range text into class weights. Single combos ("AhKh") are not supported yet and come back in `unknown`. */
export function parseRange(text: string): { weights: ClassWeights; unknown: string[] } {
  const weights: ClassWeights = {};
  const unknown: string[] = [];
  for (const part of text.split(",")) {
    const [tok = "", w] = part.split(":");
    const weight = w === undefined ? 1 : Number(w);
    const classes = expandToken(tok);
    if (!classes.length || !(weight >= 0 && weight <= 1)) {
      if (tok.trim()) unknown.push(part.trim());
      continue;
    }
    for (const c of classes) weights[c] = weight;
  }
  return { weights, unknown };
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
