// The QA sweep's configs: the default matrix (about 20 minutes on this Mac) and --quick (about 3-5). Each is a
// Practice session's setup as the page would start it, played for `hands` hands from its own seed. Most hands of an
// "any hand" config end with your preflop fold in a second, so those configs deal more hands than a drill's.
import type { PotDrill } from "@/features/practice/practice";
import type { SolveMode } from "@/solver/types";

export interface QaConfig {
  name: string;
  players: number;
  stack: number;
  opponents?: "gto" | "live" | "loose";
  /** a pot drill (its preflop played for you), or any hand */
  pot?: PotDrill | null;
  /** Practice's mode: Quick is its default (room.ts: the Fast setting plays Quick too); "fast" is the room's fixedMode */
  mode: SolveMode;
  ante?: number;
  straddle?: boolean;
  rake?: number;
  rakeCap?: number;
  /** the preflop solve's grade: undefined, Practice's default (on where the game is stored, pfByDefault); false, off */
  pfSolve?: false;
  /** a stored tournament preset (pfIcmStored.ts), by name */
  tournament?: string;
  hands: number;
}

const base = { players: 6, stack: 100, mode: "quick" as SolveMode };

export const QUICK: QaConfig[] = [
  { ...base, name: "6max-100bb-gto-any", hands: 24 },
  { ...base, name: "6max-100bb-gto-srp", pot: "srp", hands: 6 },
  { ...base, name: "3max-100bb-live-any", players: 3, opponents: "live", hands: 6 },
  { ...base, name: "6max-100bb-loose-any", opponents: "loose", hands: 6 },
];

export const MATRIX: QaConfig[] = [
  { ...base, name: "6max-100bb-gto-any", hands: 30 },
  { ...base, name: "6max-100bb-gto-srp", pot: "srp", hands: 8 },
  { ...base, name: "6max-100bb-gto-3bet", pot: "3bet", hands: 6 },
  { ...base, name: "6max-100bb-live-any", opponents: "live", hands: 16 },
  { ...base, name: "6max-100bb-loose-any", opponents: "loose", hands: 10 },
  { ...base, name: "6max-100bb-gto-srp-fast", pot: "srp", mode: "fast", hands: 4 },
  { ...base, name: "6max-100bb-gto-any-pfoff", pfSolve: false, hands: 20 },
  { ...base, name: "2max-100bb-gto-any", players: 2, hands: 12 },
  { ...base, name: "2max-20bb-gto-any", players: 2, stack: 20, hands: 12 },
  { ...base, name: "3max-100bb-gto-any", players: 3, hands: 14 },
  { ...base, name: "3max-40bb-live-any", players: 3, stack: 40, opponents: "live", hands: 14 },
  { ...base, name: "9max-100bb-gto-any", players: 9, hands: 30 },
  { ...base, name: "9max-40bb-loose-any", players: 9, stack: 40, opponents: "loose", hands: 8 },
  { ...base, name: "6max-200bb-gto-srp", stack: 200, pot: "srp", hands: 6 },
  { ...base, name: "6max-40bb-gto-srp", stack: 40, pot: "srp", hands: 6 },
  { ...base, name: "6max-20bb-gto-any", stack: 20, hands: 24 },
  { ...base, name: "6max-15bb-gto-any", stack: 15, hands: 24 },
  { ...base, name: "6max-100bb-gto-any-rake5cap3", rake: 5, rakeCap: 3, hands: 20 },
  { ...base, name: "6max-100bb-gto-any-ante", ante: 0.12, hands: 20 },
  { ...base, name: "6max-100bb-gto-any-straddle", straddle: true, hands: 20 },
  { ...base, name: "tournament-final-table-bubble", players: 5, stack: 40, tournament: "Final-table bubble", hands: 20 },
];

/** How many of your postflop decisions in Quick are asked again at a reference mode: Fast, and Accurate for a few. */
export const REFS = {
  quick: { fast: 26, accurate: 2, share: 1 },
  full: { fast: 220, accurate: 12, share: 0.7 },
};
