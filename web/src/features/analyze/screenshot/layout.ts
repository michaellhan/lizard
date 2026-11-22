// Where things are on the table: the board (a row of three to five cards, the one nearest the middle), the hands (two
// cards side by side, touching or overlapping), whose hand is yours (the lowest on the screen, where rooms seat you),
// and the seats (each stack read), in clockwise order around the table's middle, named from the dealer button.
import { SEATS } from "@/poker/seats";
import type { FoundCard } from "./cards";
import type { Box } from "./glyph";
import type { StackRead } from "./numbers";

export const centreOf = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export interface CardGroups {
  board: FoundCard[];
  /** hands of two cards, top to bottom of the screen */
  hands: FoundCard[][];
  /** cards in no row or pair */
  loose: FoundCard[];
  /** the board has a gap where a card wasn't read */
  boardGap: boolean;
}

/** The board and the hands among the cards found. */
export function groupCards(cards: readonly FoundCard[], img: { width: number; height: number }): CardGroups {
  // rows: cards level with each other and the same size (a seat's shown hand a little above or below the board isn't)
  const rows: FoundCard[][] = [];
  for (const c of [...cards].sort((a, b) => a.box.x - b.box.x)) {
    const row = rows.find((r) => Math.abs(r[0]!.box.y - c.box.y) <= 0.15 * c.faceH && Math.abs(r[0]!.faceH - c.faceH) <= 0.2 * c.faceH);
    if (row) row.push(c);
    else rows.push([c]);
  }
  // runs in a row: the next card starts close after this one ends
  const runs: FoundCard[][] = [];
  const gapped = new Set<FoundCard[]>();
  // (cards side by side, none covering the next: a board's, not a hand's)
  const apart = (r: FoundCard[]) => r.every((c, i) => i === 0 || c.box.x - r[i - 1]!.box.x >= 0.6 * c.faceH);
  for (const r of rows) {
    const inRow: FoundCard[][] = [];
    let run: FoundCard[] = [];
    for (const c of r) {
      const prev = run.at(-1);
      if (prev && c.box.x - (prev.box.x + prev.box.w) > 0.6 * c.faceH) {
        inRow.push(run);
        run = [];
      }
      run.push(c);
    }
    if (run.length) inRow.push(run);
    // a board with a card in it not read: two runs of cards side by side, one card's room between them
    for (let i = 0; i + 1 < inRow.length; i++) {
      const a = inRow[i]!, b = inRow[i + 1]!;
      const last = a.at(-1)!;
      const gap = b[0]!.box.x - (last.box.x + last.box.w);
      if (a.length + b.length >= 3 && a.length + b.length <= 4 && apart(a) && apart(b) && gap <= 1.3 * last.faceH) {
        const merged = [...a, ...b];
        inRow.splice(i, 2, merged);
        gapped.add(merged);
      }
    }
    runs.push(...inRow);
  }
  const mid = { x: img.width / 2, y: img.height / 2 };
  const dist = (run: FoundCard[]) => {
    const c = centreOf(run[Math.floor(run.length / 2)]!.box);
    return Math.hypot(c.x - mid.x, c.y - mid.y);
  };
  // the board: a run of 3 or more whose cards don't overlap (a hand's do, or nearly touch)
  const boards = runs.filter((r) => r.length >= 3 && r.length <= 5).sort((a, b) => dist(a) - dist(b));
  const board = boards[0] ?? [];
  const hands: FoundCard[][] = [];
  const loose: FoundCard[] = [];
  for (const r of runs) {
    if (r === board) continue;
    if (r.length === 2) hands.push(r);
    else if (r.length > 2 && r !== board) {
      // (a longer run that isn't the board: taken two by two)
      for (let i = 0; i + 1 < r.length; i += 2) hands.push([r[i]!, r[i + 1]!]);
      if (r.length % 2) loose.push(r.at(-1)!);
    } else loose.push(...r);
  }
  hands.sort((a, b) => a[0]!.box.y - b[0]!.box.y);
  return { board, hands, loose, boardGap: gapped.has(board) };
}

/** Each seat's position, seats in clockwise order with the button at `dealer`. */
export function positionsClockwise(n: number, dealer: number): string[] {
  const seats = SEATS[n];
  if (!seats) return [];
  const others = seats.filter((p) => p !== "SB" && p !== "BB");
  const order = n === 2 ? ["BB", "SB"] : ["SB", "BB", ...others];
  const out = new Array<string>(n);
  for (let k = 0; k < n; k++) out[(dealer + 1 + k) % n] = order[k]!;
  return out;
}

export interface SeatRead {
  stack: StackRead;
  /** the seat's position, where the button was found */
  pos: string | null;
  hero: boolean;
  dealer: boolean;
}

export interface SeatLayout {
  seats: SeatRead[];
  /** the table's middle the seats were ordered round */
  middle: { x: number; y: number };
  /** the hero's seat found by its cards, and the button's seat, by index into seats */
  hero: number;
  dealer: number;
}

/** The seats, clockwise round the table's middle (the board's, or the stacks' own), each named from the button. */
export function seatLayout(stacks: readonly StackRead[], opts: { middle?: { x: number; y: number } | undefined; heroAt?: { x: number; y: number } | undefined; dealerAt?: { x: number; y: number } | undefined }): SeatLayout {
  let reads = [...stacks];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const middle = opts.middle ?? { x: mean(reads.map((s) => centreOf(s.box).x)), y: mean(reads.map((s) => centreOf(s.box).y)) };
  // more than 9: the outer ring are the seats (an amount nearer the middle is a bet)
  if (reads.length > 9) {
    const far = (s: StackRead) => Math.hypot(centreOf(s.box).x - middle.x, centreOf(s.box).y - middle.y);
    reads = reads.sort((a, b) => far(b) - far(a)).slice(0, 9);
  }
  const angle = (s: StackRead) => {
    const c = centreOf(s.box);
    return Math.atan2(c.y - middle.y, c.x - middle.x);
  };
  reads.sort((a, b) => angle(a) - angle(b));
  const nearest = (p: { x: number; y: number } | undefined) => {
    if (!p || !reads.length) return -1;
    let best = -1, bd = Infinity;
    reads.forEach((s, i) => {
      const c = centreOf(s.box);
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) [best, bd] = [i, d];
    });
    return best;
  };
  const hero = nearest(opts.heroAt);
  const dealer = nearest(opts.dealerAt);
  const n = reads.length;
  const pos = n >= 2 && n <= 9 && dealer >= 0 ? positionsClockwise(n, dealer) : [];
  return {
    seats: reads.map((stack, i) => ({ stack, pos: pos[i] ?? null, hero: i === hero, dealer: i === dealer })),
    middle,
    hero,
    dealer,
  };
}
