// 7-card hand strength and its name, ported from the classic trainer (solver/gto/static/practice.js rank7, cmp,
// handName). A value is [category, tie-breakers...], compared left to right; ranks are 2..14 (ace high).

const RANKS = "AKQJT98765432";

export type HandValue = number[];

export const CATEGORIES = [
  "high card",
  "a pair",
  "two pair",
  "three of a kind",
  "a straight",
  "a flush",
  "a full house",
  "four of a kind",
  "a straight flush",
] as const;

const valueOf = (c: string) => 14 - RANKS.indexOf(c[0]!);

/** The highest straight's top card among these ranks (the wheel counts the ace low), 0 if none. */
function straightHigh(vals: Iterable<number>): number {
  const s = new Set(vals);
  if (s.has(14)) s.add(1);
  for (let h = 14; h >= 5; h--) if ([0, 1, 2, 3, 4].every((k) => s.has(h - k))) return h;
  return 0;
}

/** The best five-card hand among 5 to 7 cards ("As", "Kd", ...). */
export function rank7(cards: readonly string[]): HandValue {
  const cnt = new Map<number, number>();
  const suits = new Map<string, number[]>();
  for (const c of cards) {
    const v = valueOf(c);
    cnt.set(v, (cnt.get(v) ?? 0) + 1);
    const s = suits.get(c[1]!) ?? [];
    s.push(v);
    suits.set(c[1]!, s);
  }
  const flush = [...suits.values()].find((x) => x.length >= 5);
  if (flush && straightHigh(flush)) return [8, straightHigh(flush)];
  const g = [...cnt.entries()].map(([r, n]) => [n, r] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = (not: number[], n: number) =>
    [...cnt.keys()]
      .filter((r) => !not.includes(r))
      .sort((a, b) => b - a)
      .slice(0, n);
  const [g0, g1] = [g[0]!, g[1]];
  if (g0[0] === 4) return [7, g0[1], ...kick([g0[1]], 1)];
  if (g0[0] === 3 && g1 && g1[0] >= 2) return [6, g0[1], g1[1]];
  if (flush) return [5, ...[...flush].sort((a, b) => b - a).slice(0, 5)];
  const st = straightHigh(cnt.keys());
  if (st) return [4, st];
  if (g0[0] === 3) return [3, g0[1], ...kick([g0[1]], 2)];
  if (g0[0] === 2 && g1 && g1[0] === 2) return [2, g0[1], g1[1], ...kick([g0[1], g1[1]], 1)];
  if (g0[0] === 2) return [1, g0[1], ...kick([g0[1]], 3)];
  return [0, ...kick([], 5)];
}

/** > 0 when a beats b, 0 on a tie. */
export function cmp(a: HandValue, b: HandValue): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

const WORD: Record<number, string> = {
  2: "twos",
  3: "threes",
  4: "fours",
  5: "fives",
  6: "sixes",
  7: "sevens",
  8: "eights",
  9: "nines",
  10: "tens",
  11: "jacks",
  12: "queens",
  13: "kings",
  14: "aces",
};
const HI = (x: number) => (x === 10 ? "10" : "  23456789TJQKA"[x]!);

/** A value in words, "Q-high flush", "two pair, kings and sevens"; against a hand of the same name (vs), with
 * the kicker that decides it. */
export function handName(v: HandValue, vs?: HandValue): string {
  const [c = 0, a = 0, b = 0] = v;
  const n = [
    `${HI(a)}-high`,
    `pair of ${WORD[a]}`,
    `two pair, ${WORD[a]} and ${WORD[b]}`,
    `three ${WORD[a]}`,
    `${HI(a)}-high straight`,
    `${HI(a)}-high flush`,
    `full house, ${WORD[a]} full of ${WORD[b]}`,
    `four ${WORD[a]}`,
    a === 14 ? "royal flush" : `${HI(a)}-high straight flush`,
  ][c]!;
  if (!vs || vs[0] !== c || handName(vs) !== n) return n;
  const i = v.findIndex((x, k) => k > 0 && x !== vs[k]);
  return i > 0 ? `${n}, ${HI(v[i]!)} kicker` : n;
}
