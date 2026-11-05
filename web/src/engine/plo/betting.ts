// PLO4 on the table engine: poker/table.ts plays the hand, with `limit: "pot"` capping every bet and raise and this
// file holding what's Omaha's own. Rules, where a table's rules differ the TDA's are the ones taken (2026 Rules, v1.1):
//  - the largest raise: call, then raise by the pot after the call (Rule 56-C for the actual pot post-flop);
//  - before the flop the pot counts every blind as posted in full, even a short all-in one (Rule 56-B);
//  - the TDA doesn't say how antes count: here they're chips in the pot, so they count;
//  - the smallest raise is by the last full bet or raise, on the highest bet (Rules 45-A, 49-A);
//  - an all-in short of a full raise raises the bet without reopening the betting for seats that have acted, unless
//    with other short all-ins it comes to a full raise for them (Rule 49-A).
// The straddle is the table's: the first seat, 2bb, acting last preflop; a blind or straddle of any other size isn't
// offered except the small blind (`smallBlind`).
import { seatsOf } from "@/poker/seats";
import { DECK, noLines, settle, type Lines, type Rake, type Settlement, type TableSetup } from "@/poker/table";
import { rankOmaha } from "./evaluate";

export const potLimit = (t: TableSetup): TableSetup => ({ ...t, limit: "pot" });

/** A heads-up pot at the river on the table engine: `pot` in the middle, `stack` behind each seat, the river to come with
 * the big blind first, so `simulate`, `legal` and `recordOf` answer for it as for a hand played there. The pot over the
 * blinds is put in as antes, which is only how it gets on the table: a post-flop limit counts chips in, wherever from.
 * A pot under 2bb can't be: both seats have a blind in by the river. */
export function headsUpRiver(pot: number, stack: number): { table: TableSetup; lines: Lines } {
  if (!(pot >= 2)) throw new Error("a heads-up pot on the river is at least the two blinds");
  const table = potLimit({ players: 2, stacks: { SB: pot / 2 + stack, BB: pot / 2 + stack }, ante: pot / 2 - 1 });
  const checks = [
    { pos: "BB", action: "check" as const },
    { pos: "SB", action: "check" as const },
  ];
  return {
    table,
    lines: { ...noLines(), preflop: [{ pos: "SB", action: "call" }, { pos: "BB", action: "check" }], flop: checks, turn: checks },
  };
}

/** `settle`, with hands valued by the two-and-three rule. */
export function settleOmaha(
  t: TableSetup,
  inv: Readonly<Record<string, number>>,
  live: readonly string[],
  allin: ReadonlySet<string>,
  board: readonly string[],
  cardsOf: (p: string) => readonly string[],
  rake?: Rake,
  raked: boolean = board.length >= 3,
): Settlement {
  return settle(t, inv, live, allin, board, cardsOf, rake, raked, rankOmaha);
}

export interface OmahaDeal {
  hands: Record<string, [string, string, string, string]>;
  board: string[];
}

/** Four cards a seat and five for the board, from one shuffled deck. */
export function dealOmaha(players: number, rnd: () => number = Math.random): OmahaDeal {
  const deck = [...DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const hands: OmahaDeal["hands"] = {};
  for (const p of seatsOf(players)) hands[p] = [deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!];
  return { hands, board: deck.slice(0, 5) };
}
