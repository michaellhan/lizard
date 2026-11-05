// Cards as small integers, for the PLO evaluator and equity loops, where a string per card would cost a thousand times
// over. A card is rank * 4 + suit: rank 0..12 for 2..A, suit 0..3 for s h d c. The names and text forms are the NLHE
// helpers' (engine/nlhe/cards.ts), so a hand reads the same everywhere.
import { RANKS, SUITS, parseCards } from "../nlhe/cards";
import type { Rank } from "../types";

/** Rank letters low to high, so a letter's index is its rank number. */
const RANK_LETTERS = [...RANKS].reverse();

export const NUM_CARDS = 52;
export const cardRank = (c: number): number => c >> 2;
export const cardSuit = (c: number): number => c & 3;

export function cardId(name: string): number {
  const r = RANK_LETTERS.indexOf(name[0] as Rank);
  const s = (SUITS as readonly string[]).indexOf(name[1] ?? "");
  if (r < 0 || s < 0 || name.length !== 2) throw new Error(`bad card ${name}`);
  return r * 4 + s;
}

export const cardName = (c: number): string => RANK_LETTERS[c >> 2]! + SUITS[c & 3]!;
export const cardsText = (cs: ArrayLike<number>): string => Array.from(cs, cardName).join("");

/** "AsKd" -> ids; null if malformed or duplicated (as parseCards), or not `n` cards when `n` is given. */
export function parseIds(text: string, n?: number): number[] | null {
  const cs = parseCards(text);
  if (!cs || (n !== undefined && cs.length !== n)) return null;
  return cs.map(cardId);
}

/** C(n, k), for the small numbers here. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}
