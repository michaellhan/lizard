// A heads-up PLO spot as the solve form holds it (strings, as typed), to and from a link's query, so a spot opens in
// Study (`/study?game=plo4&…`) or Practice as it was. Nothing here is checked beyond reading: the solve request
// (engine/plo/river/run.ts specOf) says what's wrong with a spot.
import type { RiverRequest } from "@/engine/plo/river/run";
import type { RiverSizes } from "@/engine/plo/river/tree";
import { parseIds } from "@/engine/plo/cards";

export interface StreetSizesForm {
  bets: string;
  raises: string;
  cap: number;
  allIn: boolean;
}

export interface PloSpot {
  oop: string;
  ip: string;
  board: string;
  pot: string;
  stacks: [string, string];
  /** the first street's sizes */
  sizes: StreetSizesForm;
  /** a flop's turn */
  turn: StreetSizesForm;
  /** a turn's or a flop's river */
  river: StreetSizesForm;
}

export const DEFAULT_SPOT: PloSpot = {
  oop: "AAxx,KKxx,QQxx",
  ip: "JT98,JT97,T987",
  board: "Js9s4d2h7c",
  pot: "20",
  stacks: ["100", "100"],
  sizes: { bets: "50, 100", raises: "100", cap: 2, allIn: true },
  // (a turn solves every river too, a flop every turn and river: one size a street to start, as two sizes and a raise
  // are mostly over the limit)
  turn: { bets: "75", raises: "", cap: 0, allIn: true },
  river: { bets: "75", raises: "", cap: 0, allIn: true },
};

/** "50, 100" as numbers, or null if it isn't. An empty list is fine: that seat of the tree has no such size. */
export function readSizes(text: string): number[] | null {
  const items = text
    .split(",")
    .map((s) => s.trim().replace(/%$/, ""))
    .filter(Boolean);
  const out = items.map(Number);
  return out.every(Number.isFinite) ? out : null;
}

export const streetOfBoard = (board: string): "flop" | "turn" | "river" | null => {
  const n = parseIds(board)?.length;
  return n === 3 ? "flop" : n === 4 ? "turn" : n === 5 ? "river" : null;
};

const sizesOf = (f: StreetSizesForm): RiverSizes | null => {
  const bets = readSizes(f.bets);
  const raises = readSizes(f.raises);
  return bets && raises ? { bets, raises, raiseCap: f.cap, allIn: f.allIn } : null;
};

/** The solve request for a spot, or what's wrong with its sizes in words (the rest is the solver's to check). */
export function requestOf(spot: PloSpot, stop: { targetPct: number; seconds: number }): RiverRequest | string {
  const street = streetOfBoard(spot.board);
  const first = sizesOf(spot.sizes);
  const turn = sizesOf(spot.turn);
  const river = sizesOf(spot.river);
  if (!first || (street !== "river" && !river) || (street === "flop" && !turn)) return "Sizes are percents, separated by commas: 50, 100.";
  return {
    oop: spot.oop,
    ip: spot.ip,
    board: spot.board,
    pot: Number(spot.pot),
    stacks: [Number(spot.stacks[0]), Number(spot.stacks[1])],
    sizes: first,
    ...(street === "flop" ? { turnSizes: turn! } : {}),
    ...(street === "turn" || street === "flop" ? { riverSizes: river! } : {}),
    ...stop,
  };
}

const STREET_KEYS = [
  ["sizes", ""],
  ["turn", "t"],
  ["river", "r"],
] as const;

/** A spot as query parameters (the game's own key, `game=plo4`, is the caller's). A flop's or turn's later sizes only
 * where the board has those streets. */
export function spotToParams(spot: PloSpot): URLSearchParams {
  const q = new URLSearchParams();
  q.set("oop", spot.oop);
  q.set("ip", spot.ip);
  q.set("board", spot.board);
  q.set("pot", spot.pot);
  q.set("stacks", spot.stacks.join(","));
  const street = streetOfBoard(spot.board);
  for (const [key, p] of STREET_KEYS) {
    if (key === "turn" && street !== "flop") continue;
    if (key === "river" && street === "river") continue;
    const f = spot[key];
    q.set(`${p}bets`, f.bets.replace(/\s+/g, ""));
    if (f.raises.trim()) q.set(`${p}raises`, f.raises.replace(/\s+/g, ""));
    q.set(`${p}cap`, String(f.cap));
    if (!f.allIn) q.set(`${p}allin`, "0");
  }
  return q;
}

/** A spot read from a query; null when it holds no spot (no board). Anything missing is the default's. */
export function spotFromParams(q: URLSearchParams): PloSpot | null {
  const board = q.get("board");
  if (!board) return null;
  const stacks = (q.get("stacks") ?? "").split(",");
  const spot: PloSpot = {
    ...DEFAULT_SPOT,
    oop: q.get("oop") ?? DEFAULT_SPOT.oop,
    ip: q.get("ip") ?? DEFAULT_SPOT.ip,
    board,
    pot: q.get("pot") ?? DEFAULT_SPOT.pot,
    stacks: [stacks[0] || DEFAULT_SPOT.stacks[0], stacks[1] || stacks[0] || DEFAULT_SPOT.stacks[1]],
  };
  for (const [key, p] of STREET_KEYS) {
    const bets = q.get(`${p}bets`);
    if (bets === null) continue;
    const cap = Number(q.get(`${p}cap`) ?? 0);
    spot[key] = {
      bets: bets.split(",").filter(Boolean).join(", "),
      raises: (q.get(`${p}raises`) ?? "").split(",").filter(Boolean).join(", "),
      cap: Number.isInteger(cap) && cap >= 0 ? cap : 0,
      allIn: q.get(`${p}allin`) !== "0",
    };
  }
  return spot;
}
