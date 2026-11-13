// Spots that open a PLO Study or Practice with something to look at: each measured to solve in the browser in seconds
// (FEATURE_MATRIX, PLO4). Ranges a person gives, not anyone's solution: the labels say whose they are.
import { DEFAULT_SPOT, type PloSpot } from "./spot";

export interface PloPreset {
  id: string;
  name: string;
  spot: PloSpot;
}

export const PLO_PRESETS: readonly PloPreset[] = [
  { id: "river-overpairs", name: "River: overpairs against rundowns, Js9s4d2h7c", spot: DEFAULT_SPOT },
  {
    id: "river-ds",
    name: "River: aces double-suited against broadway wraps, Kh Td 6c 3h 2s",
    spot: { ...DEFAULT_SPOT, oop: "AAxxds", ip: "KQJT,KQJ9,QJT9", board: "KhTd6c3h2s", pot: "12", stacks: ["94", "94"], sizes: { bets: "33, 75", raises: "100", cap: 1, allIn: true } },
  },
  {
    id: "turn-aces-wrap",
    name: "Turn: aces against JT98, Js9s4d2h, and every river",
    spot: { ...DEFAULT_SPOT, oop: "AAxx", ip: "JT98", board: "Js9s4d2h", pot: "20", stacks: ["100", "100"], sizes: { bets: "75", raises: "", cap: 0, allIn: true } },
  },
  {
    id: "flop-aakk",
    name: "Flop: AAKK against JT98, Js9s4d, every turn and river (about 30 s)",
    spot: { ...DEFAULT_SPOT, oop: "AAKK", ip: "JT98", board: "Js9s4d", pot: "20", stacks: ["100", "100"], sizes: { bets: "75", raises: "", cap: 0, allIn: true } },
  },
];
