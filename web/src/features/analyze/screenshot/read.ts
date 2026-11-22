// A screenshot read: the cards (cards.ts) and the OCR's lines (numbers.ts) put together on the table's layout
// (layout.ts). Every value keeps how sure the reader is and what it was read from; what wasn't read is listed in words.
import type { CardScan, FoundCard } from "./cards";
import { centreOf, groupCards, seatLayout, type CardGroups, type SeatLayout } from "./layout";
import { readBlinds, readPot, readStacks, unitOf, type Amount, type OcrLine, type Read, type StackRead, type Unit } from "./numbers";

export interface Reading {
  width: number;
  height: number;
  cards: FoundCard[];
  groups: CardGroups;
  /** your two cards: the hand lowest on the screen */
  hero: { cards: FoundCard[]; conf: number } | null;
  fourColour: boolean;
  dealer: CardScan["dealer"];
  blinds: Read<{ sb: number; bb: number }> | null;
  pot: Read<Amount> | null;
  /** the stacks' unit: the screenshot's money, or big blinds where the room shows them so */
  unit: Unit;
  currency: string;
  layout: SeatLayout | null;
  lines: OcrLine[];
  /** what wasn't read, or was read in a way to check, in words */
  notes: string[];
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function readTable(size: { width: number; height: number }, scan: CardScan, lines: readonly OcrLine[]): Reading {
  const notes: string[] = [];
  const groups = groupCards(scan.cards, size);
  const lowest = groups.hands.at(-1);
  const hero = lowest ? { cards: lowest, conf: Math.min(...lowest.map((c) => c.conf)) * (groups.hands.length > 1 ? 0.8 : 1) } : null;
  if (!scan.cards.length) notes.push("No cards were found: a deck with a rank and suit in each corner, cards upright, reads best.");
  else if (!hero) notes.push("Your two cards weren't found as a pair.");
  if (groups.hands.length > 1) notes.push(`${groups.hands.length} hands show: the lowest on the screen was taken as yours.`);
  if (groups.boardGap) notes.push("The board has a gap where a card wasn't read: add it.");
  if (groups.loose.length) notes.push(`${groups.loose.length === 1 ? "A card" : `${groups.loose.length} cards`} found on ${groups.loose.length === 1 ? "its" : "their"} own, not in the board or a hand: left out.`);
  const cardBoxes = scan.cards.map((c) => c.box);
  const text = lines.filter((l) => !cardBoxes.some((b) => overlaps(b, l.box)));
  const blinds = readBlinds(text);
  if (!blinds) notes.push("The blinds weren't read, so the stacks weren't put in big blinds: set the stack yourself.");
  const pot = readPot(text);
  if (!pot) notes.push("The pot wasn't read.");
  const skip = text.filter((l) => l.text === blinds?.from || l.text === pot?.from);
  const stacks: StackRead[] = readStacks(text, skip);
  const unit = unitOf(stacks.filter((s) => !s.allIn));
  const currency = [blinds?.from, ...stacks.map((s) => s.amount.currency)].map((s) => /[$€£¥₹]/.exec(s ?? "")?.[0]).find(Boolean) ?? "";
  const boardMid = groups.board.length ? centreOf({ x: groups.board[0]!.box.x, y: groups.board[0]!.box.y, w: groups.board.at(-1)!.box.x + groups.board.at(-1)!.box.w - groups.board[0]!.box.x, h: groups.board[0]!.box.h }) : undefined;
  // your seat: by your cards; without them, by a card found alone lowest on the screen, or else the lowest seat (where
  // rooms seat you), either one a guess for the form to mark
  const lowestLoose = [...groups.loose].sort((a, b) => b.box.y - a.box.y)[0];
  const lowestStack = [...stacks].sort((a, b) => b.box.y - a.box.y)[0];
  const heroAt = hero
    ? centreOf({ x: hero.cards[0]!.box.x, y: hero.cards[0]!.box.y, w: hero.cards[1]!.box.x + hero.cards[1]!.box.w - hero.cards[0]!.box.x, h: hero.cards[0]!.box.h })
    : lowestLoose
      ? centreOf(lowestLoose.box)
      : lowestStack
        ? centreOf(lowestStack.box)
        : undefined;
  const layout = stacks.length >= 2 ? seatLayout(stacks, { middle: boardMid, heroAt, dealerAt: scan.dealer ?? undefined }) : null;
  if (!layout) notes.push(stacks.length ? "Only one seat's stack was read." : "No seat's stack was read.");
  else {
    if (!scan.dealer) notes.push("The dealer button wasn't found, so the seats' positions weren't named.");
    if (!hero) notes.push(`Without your cards, your seat was taken as the ${lowestLoose ? "one by the card found lowest on the screen" : "lowest on the screen"}: check it.`);
  }
  return { ...size, cards: scan.cards, groups, hero, fourColour: scan.fourColour, dealer: scan.dealer, blinds, pot, unit, currency, layout, lines: [...lines], notes };
}
