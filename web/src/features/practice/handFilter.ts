// A drill's hand filter: one made-hand or draw category (Study's, by the same key: filters.ts, categories.ts) or one
// hand class. A key is "m:<id>", "d:<id>" or "c:<id>". Whether a hand fits is read on the canonical cards: a suit
// relabelling changes neither.
import { DRAWS, drawCategory, MADE, madeCategory } from "@/features/study/categories";
import { cardInt, flopCards } from "@/library/entry";

type Test = (hi: number, lo: number, suited: boolean) => boolean;
const gap = (hi: number, lo: number) => (hi === 12 ? Math.min(hi - lo, lo + 1) : hi - lo);
export const HAND_CLASSES: readonly { id: string; label: string; test: Test }[] = [
  { id: "pairs", label: "Pocket pairs", test: (hi, lo) => hi === lo },
  { id: "sc", label: "Suited connectors", test: (hi, lo, s) => s && gap(hi, lo) === 1 },
  { id: "sg", label: "Suited one-gappers", test: (hi, lo, s) => s && gap(hi, lo) === 2 },
  { id: "sa", label: "Suited aces", test: (hi, _, s) => s && hi === 12 },
  { id: "bw", label: "Two broadway cards", test: (hi, lo) => hi !== lo && lo >= 8 },
];

export const HAND_GROUPS: readonly { label: string; options: readonly { key: string; label: string }[] }[] = [
  // (no drill reaches a river, where a hand plays the board)
  { label: "Made hands", options: MADE.filter(([id]) => id !== "board").map(([id, label]) => ({ key: `m:${id}`, label })) },
  // (as Study's, "No draw" is no category)
  { label: "Draws", options: DRAWS.filter(([id]) => id !== "none").map(([id, label]) => ({ key: `d:${id}`, label })) },
  { label: "Hand classes", options: HAND_CLASSES.map((c) => ({ key: `c:${c.id}`, label: c.label })) },
];
const LABELS = new Map(HAND_GROUPS.flatMap((g) => g.options.map((o) => [o.key, o.label] as const)));

export const isHandKey = (x: string | null): x is string => x !== null && LABELS.has(x);
export const handLabel = (key: string): string => LABELS.get(key) ?? key;

const NEVER = () => false;
const mostOfASuit = (board: readonly number[]) => Math.max(...[0, 1, 2, 3].map((s) => board.filter((c) => (c & 3) === s).length));
const paired = (board: readonly number[]) => new Set(board.map((c) => c >> 2)).size < board.length;

/** Whether a combo (a < b, as COMBOS) is in the filter, on this board of 3 or 4 cards. What the board rules out is
 * ruled out before any hand is looked at: Flush on a spot's rainbow flops is otherwise most of a filter's work. */
export function handTest(key: string, board: readonly number[]): (a: number, b: number) => boolean {
  const [part, id] = [key.slice(0, 1), key.slice(2)];
  if (part === "c") {
    const c = HAND_CLASSES.find((x) => x.id === id);
    if (!c) return NEVER;
    return (a, b) => c.test(Math.max(a >> 2, b >> 2), Math.min(a >> 2, b >> 2), (a & 3) === (b & 3));
  }
  if (part === "m") {
    if (id === "flush" && mostOfASuit(board) < 3) return NEVER;
    if ((id === "quads" || id === "full_house" || id === "trips") && !paired(board)) return NEVER;
    return (a, b) => madeCategory([a, b], board) === id;
  }
  if ((id === "fd" || id === "combo") && mostOfASuit(board) < 2) return NEVER;
  return (a, b) => drawCategory([a, b], board) === id;
}

/** the same on a canonical flop as stored ("Ac4d3h") */
export const flopHandTest = (key: string, flop: string) => handTest(key, flopCards(flop).map(cardInt));
