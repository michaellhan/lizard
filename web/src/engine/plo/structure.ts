// A condensed view of four-card hands by their shape, as PLO players sort them before a board: the pair or connected
// structure (a row) against how the suits fall (a column). There's no 13x13 grid for PLO: 270,725 hands in 16,432 suit
// classes. This is a grouping for reading a range, not a strength order and not a solution: every number drawn on it
// comes from whatever range or solve it's laid over.
//
// Rows, first that fits: three or four of a rank; two pairs; one pair, by its rank; then a hand with four different
// ranks by how they connect (an ace also counts low, so A234 is a rundown): four in a row, four in five ranks (one gap),
// four in six (two gaps), three in a row and a dangler, an ace with three others, anything else.
// Columns: double-suited (2+2), single-suited (2+1+1), rainbow, three of a suit, four of a suit.
import type { HandClassGrid } from "../types";
import { cardName, cardRank, cardSuit, parseIds } from "./cards";
import { handAt, NUM_HANDS } from "./combos";

export const STRUCTURE_ROWS = [
  "Trips or quads",
  "Two pair",
  "AA",
  "KK",
  "QQ",
  "JJ–TT",
  "99–66",
  "55–22",
  "Rundown",
  "One gap",
  "Two gaps",
  "Three connected",
  "Ace and three",
  "Other",
] as const;

export const SUIT_COLUMNS = ["Double-suited", "Single-suited", "Rainbow", "Three of a suit", "Four of a suit"] as const;
/** short forms for a narrow table */
export const SUIT_SHORT = ["ds", "ss", "r", "3s", "4s"] as const;

const ROWS = STRUCTURE_ROWS.length;
const COLS = SUIT_COLUMNS.length;
const ACE = 12;

/** The row of the ranks (0..12, 2..A) of a hand's four cards. */
function rowOf(ranks: readonly number[]): number {
  const count = new Array<number>(13).fill(0);
  for (const r of ranks) count[r]!++;
  const most = Math.max(...count);
  if (most >= 3) return 0;
  const pairs = count.flatMap((n, r) => (n === 2 ? [r] : []));
  if (pairs.length === 2) return 1;
  if (pairs.length === 1) {
    const p = pairs[0]!;
    return p === ACE ? 2 : p === 11 ? 3 : p === 10 ? 4 : p >= 8 ? 5 : p >= 4 ? 6 : 7;
  }
  // four different ranks: the narrowest window holding them, the ace high or low
  const high = [...ranks].sort((a, b) => a - b);
  const spans = [high[3]! - high[0]!];
  if (high[3] === ACE) {
    const low = [-1, high[0]!, high[1]!, high[2]!];
    spans.push(low[3]! - low[0]!);
  }
  const span = Math.min(...spans);
  if (span === 3) return 8;
  if (span === 4) return 9;
  if (span === 5) return 10;
  // three in a row among them, the ace either way
  const has = new Set(ranks);
  if (has.has(ACE)) has.add(-1);
  for (let r = -1; r <= 10; r++) if (has.has(r) && has.has(r + 1) && has.has(r + 2)) return 11;
  if (ranks.includes(ACE)) return 12;
  return 13;
}

/** The column of the suits of a hand's four cards. */
function colOf(suits: readonly number[]): number {
  const count = [0, 0, 0, 0];
  for (const s of suits) count[s]!++;
  const shape = count.filter((n) => n > 0).sort((a, b) => b - a);
  if (shape[0] === 4) return 4;
  if (shape[0] === 3) return 3;
  if (shape[0] === 2) return shape[1] === 2 ? 0 : 1;
  return 2;
}

/** A hand's place on the grid: its row and column. */
export function structureOf(hand: ArrayLike<number>): { row: number; col: number } {
  const ranks: number[] = [];
  const suits: number[] = [];
  for (let i = 0; i < 4; i++) {
    ranks.push(cardRank(hand[i]!));
    suits.push(cardSuit(hand[i]!));
  }
  return { row: rowOf(ranks), col: colOf(suits) };
}

/** A cell's number, row * columns + column. */
export const cellOf = (hand: ArrayLike<number>): number => {
  const { row, col } = structureOf(hand);
  return row * COLS + col;
};

let counts: Int32Array | null = null;
/** How many of the 270,725 hands each cell holds: a sweep of every hand, done once on first use. */
export function cellCounts(): Int32Array {
  if (counts) return counts;
  const c = new Int32Array(ROWS * COLS);
  for (let i = 0; i < NUM_HANDS; i++) c[cellOf(handAt(i))]!++;
  return (counts = c);
}

export const cellLabel = (row: number, col: number) => `${STRUCTURE_ROWS[row]} ${SUIT_SHORT[col]}`;

function cellOfLabel(label: string): number {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (cellLabel(r, c) === label) return r * COLS + c;
  throw new Error(`no PLO hand structure "${label}"`);
}

/** A range or a decision laid over the grid: what each cell holds, by combo weight. */
export interface StructureCell {
  row: number;
  col: number;
  /** the combos in the cell with weight here, as indexes into the hands given */
  members: number[];
  /** the weight in the cell */
  weight: number;
  /** of the whole weight given */
  share: number;
  /** each action's frequency over the cell, by combo weight; empty when no strategy is given */
  frequency: number[];
  /** the cell's EV by combo weight, null where none is given or none of its combos can meet a hand */
  ev: number | null;
}

export interface Overlay {
  /** the number of actions; strategy is action * n + combo */
  actions: number;
  strategy: Float32Array;
  ev?: Float32Array;
}

/** Combos (hand indexes) with weights, and optionally a decision's strategy and EVs, by cell; cells with no weight are
 * left out. */
export function structureCells(hands: Int32Array, weight: ArrayLike<number>, overlay?: Overlay): StructureCell[] {
  const n = hands.length;
  const a = overlay?.actions ?? 0;
  const cells = new Map<number, { members: number[]; weight: number; mix: number[]; evW: number; ev: number }>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = weight[i]!;
    if (!(w > 0)) continue;
    total += w;
    const k = cellOf(handAt(hands[i]!));
    let cell = cells.get(k);
    if (!cell) cells.set(k, (cell = { members: [], weight: 0, mix: new Array<number>(a).fill(0), evW: 0, ev: 0 }));
    cell.members.push(i);
    cell.weight += w;
    for (let j = 0; j < a; j++) cell.mix[j]! += w * overlay!.strategy[j * n + i]!;
    const ev = overlay?.ev?.[i];
    if (ev !== undefined && !Number.isNaN(ev)) {
      cell.evW += w;
      cell.ev += w * ev;
    }
  }
  return [...cells.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([k, c]) => ({
      row: Math.floor(k / COLS),
      col: k % COLS,
      members: c.members,
      weight: c.weight,
      share: c.weight / total,
      frequency: c.mix.map((m) => m / c.weight),
      ev: c.evW > 0 ? c.ev / c.evW : null,
    }));
}

/** The grid as the registry's class grid (types.ts): rows of structure, columns of suits. `expand` lists a cell's
 * hands, up to tens of thousands of them. */
export const PLO_STRUCTURE_GRID: HandClassGrid = {
  rows: ROWS,
  cols: COLS,
  label: cellLabel,
  combos: (label) => cellCounts()[cellOfLabel(label)]!,
  expand(label) {
    const want = cellOfLabel(label);
    const out: string[] = [];
    for (let i = 0; i < NUM_HANDS; i++) {
      const h = handAt(i);
      if (cellOf(h) === want) out.push(h.map(cardName).join(""));
    }
    return out;
  },
  classOf(hand) {
    const ids = parseIds(hand, 4);
    if (!ids) throw new Error(`not a four-card hand: ${hand}`);
    const { row, col } = structureOf(ids);
    return cellLabel(row, col);
  },
};
