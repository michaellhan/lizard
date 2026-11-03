// NLHE card and hand-class primitives for the UI (the solver has its own, in solver/gto/cards.py; these only
// label, group and validate). Grid convention (as the upstream page): row i, col j over ranks AKQ...2;
// i == j pairs, i < j suited (upper-right), i > j offsuit (lower-left).
import type { Card, HandClassGrid, Rank, Suit } from "../types";

export const RANKS: readonly Rank[] = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
export const SUITS: readonly Suit[] = ["s", "h", "d", "c"];

const RANK_INDEX = new Map<string, number>(RANKS.map((r, i) => [r, i]));

export function isCard(s: string): s is Card {
  return s.length === 2 && RANK_INDEX.has(s[0]!) && (SUITS as readonly string[]).includes(s[1]!);
}

/** "AhKd" / "Ah Kd" / "ahkd" -> ["Ah","Kd"]; null if malformed or duplicated. */
export function parseCards(text: string): Card[] | null {
  const t = text.replace(/[\s,]+/g, "");
  if (t.length % 2) return null;
  const out: Card[] = [];
  for (let i = 0; i < t.length; i += 2) {
    const c = t[i]!.toUpperCase() + t[i + 1]!.toLowerCase();
    if (!isCard(c) || out.includes(c)) return null;
    out.push(c);
  }
  return out;
}

export function classLabel(row: number, col: number): string {
  const a = RANKS[row]!;
  const b = RANKS[col]!;
  if (row === col) return a + b;
  return row < col ? `${a}${b}s` : `${b}${a}o`;
}

/** Inverse of classLabel. */
export function classPosition(label: string): [number, number] {
  const hi = RANK_INDEX.get(label[0]!);
  const lo = RANK_INDEX.get(label[1]!);
  if (hi === undefined || lo === undefined) throw new Error(`bad hand class ${label}`);
  if (label.length === 2) return [hi, hi];
  return label[2] === "s" ? [hi, lo] : [lo, hi];
}

export function classCombos(label: string): number {
  if (label.length === 2) return 6;
  return label[2] === "s" ? 4 : 12;
}

export function expandClass(label: string): string[] {
  const a = label[0]!;
  const b = label[1]!;
  const out: string[] = [];
  if (label.length === 2) {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) out.push(`${a}${SUITS[i]}${b}${SUITS[j]}`);
  } else if (label[2] === "s") {
    for (const s of SUITS) out.push(`${a}${s}${b}${s}`);
  } else {
    for (const s of SUITS) for (const t of SUITS) if (s !== t) out.push(`${a}${s}${b}${t}`);
  }
  return out;
}

export function classOf(hand: string): string {
  const cs = parseCards(hand);
  if (!cs || cs.length !== 2) throw new Error(`bad hand ${hand}`);
  let [x, y] = cs as [Card, Card];
  if (RANK_INDEX.get(x.charAt(0))! > RANK_INDEX.get(y.charAt(0))!) [x, y] = [y, x];
  const [rx, ry] = [x.charAt(0), y.charAt(0)];
  if (rx === ry) return rx + ry;
  return `${rx}${ry}${x.charAt(1) === y.charAt(1) ? "s" : "o"}`;
}

/** all 169 classes in grid order (row-major) */
export const ALL_CLASSES: readonly string[] = RANKS.flatMap((_, i) => RANKS.map((__, j) => classLabel(i, j)));

export const NLHE_GRID: HandClassGrid = {
  rows: 13,
  cols: 13,
  label: classLabel,
  combos: classCombos,
  expand: expandClass,
  classOf,
};

/** Combos of a class not blocked by the given dead cards (board / hero). */
export function liveCombos(label: string, dead: readonly string[]): string[] {
  return expandClass(label).filter((c) => !dead.includes(c.slice(0, 2)) && !dead.includes(c.slice(2, 4)));
}
