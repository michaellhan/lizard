import type { GameEngine, GameId, GamePage } from "./types";
import { NLHE_GRID, parseCards } from "./nlhe/cards";
import { PLO_STRUCTURE_GRID } from "./plo/structure";

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
  solverScope: "preflop charts and solves, postflop solves heads-up and multiway",
  preflopSolved: true,
  pages: { study: [], practice: [], analyze: [] },
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

/** PLO4: heads-up postflop from ranges a person gives (engine/plo/river, turn, flop), and nothing before the flop. */
export const PLO4: GameEngine = {
  id: "plo4",
  name: "Pot-Limit Omaha (4 cards)",
  holeCards: 4,
  minPlayers: 2,
  maxPlayers: 6,
  solverSupported: true,
  solverScope: "heads-up flop, turn or river from ranges you give, at sizes you list; no preflop",
  preflopSolved: false,
  pages: {
    study: ["preflop ranges and solves", "three or more players", "the solved library and reports", "node locking", "compare spots", "auto-size", "ICM", "the range builder", "saved spots"],
    practice: ["preflop", "full hands from the deal", "three or more players", "tournaments and ICM", "sessions saved to History", "kept mistakes"],
    analyze: ["preflop grading", "grading without a solve", "stats, sessions and winnings", "Review and leak drills"],
  },
  seatLayout(players: number) {
    return NLHE.seatLayout(players);
  },
  classGrid: PLO_STRUCTURE_GRID,
  parseHand(text: string) {
    const cs = parseCards(text);
    return cs && cs.length === 4 ? cs : null;
  },
};

export const ENGINES: Record<GameId, GameEngine> = { nlhe: NLHE, plo4: PLO4 };

/** The game a link's `game` names, NLHE when it names none or none known. */
export const gameOf = (param: string | null | undefined): GameEngine => (param && Object.hasOwn(ENGINES, param) ? ENGINES[param as GameId] : NLHE);

/** The games a page opens for, in the registry's order. */
export const gamesFor = (page: GamePage): GameEngine[] => Object.values(ENGINES).filter((g) => g.solverSupported && g.pages[page] !== undefined);
