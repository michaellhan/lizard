// Game engines. NLHE is the only one implemented; the interface is what a new engine (e.g. PLO4) must provide
// so the shared UI (range views, hand entry, trainers) can work with it without NLHE-specific branches.

export type Rank = "A" | "K" | "Q" | "J" | "T" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
export type Suit = "s" | "h" | "d" | "c";
export type Card = `${Rank}${Suit}`;

export type GameId = "nlhe" | "plo4";

export interface SeatLayout {
  /** seat names in preflop action order, e.g. ["UTG","HJ","CO","BTN","SB","BB"] */
  seats: string[];
}

/** A grouping of starting hands for range displays (NLHE: the 169 classes on a 13x13 grid). */
export interface HandClassGrid {
  rows: number;
  cols: number;
  /** class label at (row, col) */
  label(row: number, col: number): string;
  /** number of card combos in the class (unblocked) */
  combos(label: string): number;
  /** every concrete combo of a class, e.g. "AKs" -> ["AsKs","AhKh",...] */
  expand(label: string): string[];
  /** the class a concrete hand belongs to */
  classOf(hand: string): string;
}

export interface GameEngine {
  id: GameId;
  name: string;
  holeCards: number;
  minPlayers: number;
  maxPlayers: number;
  /** whether the in-browser solver backend supports this game */
  solverSupported: boolean;
  seatLayout(players: number): SeatLayout;
  /** null when the game has no compact class grid (PLO) */
  classGrid: HandClassGrid | null;
  parseHand(text: string): Card[] | null;
}
