// Game engines: what a game (NLHE, PLO4) provides so the shared UI (range views, hand entry, trainers) can work with it
// without game-specific branches, and what each page can't do for it yet, so a page hides or marks those parts.

export type Rank = "A" | "K" | "Q" | "J" | "T" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
export type Suit = "s" | "h" | "d" | "c";
export type Card = `${Rank}${Suit}`;

export type GameId = "nlhe" | "plo4";

/** The pages a game can open on. */
export type GamePage = "study" | "practice" | "analyze";

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
  /** what the solver covers for this game, in words for a label */
  solverScope: string;
  /** whether any preflop spot is solved (PLO: no) */
  preflopSolved: boolean;
  /** the pages that open for this game, each with the parts it doesn't have for it yet, by name ([] for none missing) */
  pages: Partial<Record<GamePage, readonly string[]>>;
  seatLayout(players: number): SeatLayout;
  /** the range view's grouping: NLHE's 13x13 grid, PLO's hand shapes (rows of structure, columns of suits) */
  classGrid: HandClassGrid | null;
  parseHand(text: string): Card[] | null;
}
