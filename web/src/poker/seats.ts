// Seats by table size, in preflop action order, and the postflop order: the classic page's SEATS / ORDER_POST
// (solver/gto/static/index.html), which are also the seat names the Advisor reads.

export const SEATS: Readonly<Record<number, readonly string[]>> = {
  2: ["SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;

export function seatsOf(players: number): readonly string[] {
  const s = SEATS[players];
  if (!s) throw new Error(`no table of ${players}`);
  return s;
}

/** Postflop action order: the blinds first, then the rest in preflop order; heads-up the big blind first. */
export function orderPost(players: number): readonly string[] {
  const s = seatsOf(players);
  return players === 2 ? ["BB", "SB"] : ["SB", "BB", ...s.filter((p) => p !== "SB" && p !== "BB")];
}

/** A seat's name on screen: heads-up the small blind is also the button. */
export function seatLabel(p: string, players: number): string {
  return players === 2 && p === "SB" ? "BTN/SB" : p;
}
