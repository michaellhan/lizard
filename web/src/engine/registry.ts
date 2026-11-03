import type { GameEngine, GameId } from "./types";
import { NLHE_GRID, parseCards } from "./nlhe/cards";

// Seat names exactly as solver/gto/preflop.py's SEATS (the Advisor reads these names).
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

export const NLHE: GameEngine = {
  id: "nlhe",
  name: "No-Limit Hold'em",
  holeCards: 2,
  minPlayers: 2,
  maxPlayers: 9,
  solverSupported: true,
  seatLayout(players: number) {
    const seats = SEATS[players];
    if (!seats) throw new Error(`NLHE supports 2-9 players, not ${players}`);
    return { seats: [...seats] };
  },
  classGrid: NLHE_GRID,
  parseHand(text: string) {
    const cs = parseCards(text);
    return cs && cs.length === 2 ? cs : null;
  },
};

/** Placeholder registration so the UI can list PLO4 honestly as not yet solvable. */
export const PLO4: GameEngine = {
  id: "plo4",
  name: "Pot-Limit Omaha (4 cards)",
  holeCards: 4,
  minPlayers: 2,
  maxPlayers: 6,
  solverSupported: false,
  seatLayout(players: number) {
    return NLHE.seatLayout(players);
  },
  classGrid: null,
  parseHand(text: string) {
    const cs = parseCards(text);
    return cs && cs.length === 4 ? cs : null;
  },
};

export const ENGINES: Record<GameId, GameEngine> = { nlhe: NLHE, plo4: PLO4 };
