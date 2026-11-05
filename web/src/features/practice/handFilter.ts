// A drill's hand filter: one made-hand or draw category (Study's, by the same key: filters.ts, categories.ts) or one
// hand class. A key is "m:<id>", "d:<id>" or "c:<id>". Whether a hand fits is read on the canonical cards: a suit
// relabelling changes neither. Practice's pot drills deal to one too (`drawFit`).
import { DRAWS, drawCategory, MADE, madeCategory } from "@/features/study/categories";
import { cardInt, cardStr, flopCards } from "@/library/entry";
import { cmp, rank7 } from "@/poker/evaluate";
import { DECK, seeded } from "@/poker/table";
import { flopsLike, type TextureFilter } from "./texture";

type Test = (hi: number, lo: number, suited: boolean) => boolean;
const gap = (hi: number, lo: number) => (hi === 12 ? Math.min(hi - lo, lo + 1) : hi - lo);
export const HAND_CLASSES: readonly { id: string; label: string; test: Test }[] = [
  { id: "pairs", label: "Pocket pairs", test: (hi, lo) => hi === lo },
  { id: "sc", label: "Suited connectors", test: (hi, lo, s) => s && gap(hi, lo) === 1 },
  { id: "sg", label: "Suited one-gappers", test: (hi, lo, s) => s && gap(hi, lo) === 2 },
  { id: "sa", label: "Suited aces", test: (hi, _, s) => s && hi === 12 },
  { id: "bw", label: "Two broadway cards", test: (hi, lo) => hi !== lo && lo >= 8 },
];

/** `on`: what a key is read on, for a page that deals to it: the flop dealt, or your two cards alone. */
export const HAND_GROUPS: readonly { label: string; on: "flop" | "cards"; options: readonly { key: string; label: string }[] }[] = [
  // (not offered, though a live river can deal a hand that plays the board)
  { label: "Made hands", on: "flop", options: MADE.filter(([id]) => id !== "board").map(([id, label]) => ({ key: `m:${id}`, label })) },
  // (as Study's, "No draw" is no category)
  { label: "Draws", on: "flop", options: DRAWS.filter(([id]) => id !== "none").map(([id, label]) => ({ key: `d:${id}`, label })) },
  { label: "Hand classes", on: "cards", options: HAND_CLASSES.map((c) => ({ key: `c:${c.id}`, label: c.label })) },
];
const LABELS = new Map(HAND_GROUPS.flatMap((g) => g.options.map((o) => [o.key, o.label] as const)));

export const isHandKey = (x: unknown): x is string => typeof x === "string" && LABELS.has(x);
export const handLabel = (key: string): string => LABELS.get(key) ?? key;

const NEVER = () => false;
const mostOfASuit = (board: readonly number[]) => Math.max(...[0, 1, 2, 3].map((s) => board.filter((c) => (c & 3) === s).length));
const paired = (board: readonly number[]) => new Set(board.map((c) => c >> 2)).size < board.length;
/** the categories five cards can be on their own, and so a river's board can */
const BOARD_CAN_MAKE = new Set(["straight", "flush", "full_house", "quads"]);

/** Whether two cards do better than a river's five on their own: a higher straight or a bigger flush does, playing the board doesn't. */
const beatsBoard = (a: number, b: number, board: readonly string[]) => cmp(rank7([cardStr(a), cardStr(b), ...board]), rank7(board)) > 0;

/** Whether a combo (a < b, as COMBOS) is in the filter, on this board of 3 to 5 cards (no card to come, no draw). What the board rules out is
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
    // (a straight flush is "quads or better": three of a suit can make one with no pair)
    if ((id === "full_house" || id === "trips" || (id === "quads" && mostOfASuit(board) < 3)) && !paired(board)) return NEVER;
    if (board.length === 5 && BOARD_CAN_MAKE.has(id)) {
      const five = board.map(cardStr);
      return (a, b) => madeCategory([a, b], board) === id && beatsBoard(a, b, five);
    }
    return (a, b) => madeCategory([a, b], board) === id;
  }
  if ((id === "fd" || id === "combo") && mostOfASuit(board) < 2) return NEVER;
  return (a, b) => drawCategory([a, b], board) === id;
}

/** the same on a canonical flop as stored ("Ac4d3h") */
export const flopHandTest = (key: string, flop: string) => handTest(key, flopCards(flop).map(cardInt));

/** the draws of a flop and two cards `drawFit` may take */
export const HAND_DRAWS = 200_000;
const SPOT = new Map(DECK.map((c, i) => [c, i]));
const INT = DECK.map(cardInt);

/** A flop and your two cards drawn evenly from every pair of them that fits the key (from these `flops`, if any), by
 * drawing a pair and looking, so a hand filter leaves what's dealt otherwise as it was; null where none came in HAND_DRAWS. */
export function drawFit(key: string, rnd: () => number, flops?: readonly string[] | null): { flop: [string, string, string]; hole: [string, string] } | null {
  const pick = (n: number) => Math.floor(rnd() * n);
  const cls = key.startsWith("c:") ? handTest(key, []) : null;
  for (let i = 0; i < HAND_DRAWS; i++) {
    let x: number, y: number, z: number;
    if (flops) {
      const f = flops[pick(flops.length)]!;
      x = SPOT.get(f.slice(0, 2))!;
      y = SPOT.get(f.slice(2, 4))!;
      z = SPOT.get(f.slice(4, 6))!;
    } else {
      x = pick(52);
      do y = pick(52);
      while (y === x);
      do z = pick(52);
      while (z === x || z === y);
    }
    let a: number, b: number;
    do a = pick(52);
    while (a === x || a === y || a === z);
    do b = pick(52);
    while (b === x || b === y || b === z || b === a);
    const [lo, hi] = INT[a]! < INT[b]! ? [INT[a]!, INT[b]!] : [INT[b]!, INT[a]!];
    if ((cls ?? handTest(key, [INT[x]!, INT[y]!, INT[z]!]))(lo, hi)) return { flop: [DECK[x]!, DECK[y]!, DECK[z]!], hole: [DECK[a]!, DECK[b]!] };
  }
  return null;
}

const FITS = new Map<string, boolean>();

/** Whether `drawFit` finds the key on these flops: what a setup is refused by, the same answer each time. Any flop at all
 * holds every key offered, so only a board filter is searched, once for each pair, at worst a third of a second in Node with nothing to find. */
export function handFits(key: string, board?: TextureFilter | null): boolean {
  if (!isHandKey(key)) return false;
  const on = board && Object.values(board).some(Boolean) ? board : null;
  if (!on) return true;
  const id = JSON.stringify([key, on]);
  let fits = FITS.get(id);
  if (fits === undefined) {
    const flops = flopsLike(on);
    fits = flops.length > 0 && !!drawFit(key, seeded(1), flops);
    FITS.set(id, fits);
  }
  return fits;
}
