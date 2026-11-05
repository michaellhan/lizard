// A Practice setup as a link: what's played, your seat and the table, in the address, so a page can offer a session with
// its settings and nothing need be stored until you save it. A link can come from anywhere, so it's read as a stored
// setup is (data/scenarios.ts readSetup): one that makes no sense starts nothing.
import { readSetup, type ScenarioSetup } from "@/data/scenarios";
import { isPotDrill, type PotDrill } from "./practice";

export type PlayKind = "full" | "preflop" | PotDrill;
export interface LinkSetup {
  play: PlayKind;
  /** a seat's name, or "moves" */
  seat: string;
  players: number;
  stack: number;
}

export const SETUP_PARAMS = ["play", "seat", "players", "stack"] as const;

/** The setup a link stands for, whole and playable, else null. */
export const linkSetup = ({ play, seat, players, stack }: LinkSetup): ScenarioSetup | null =>
  play === "full" || play === "preflop" || isPotDrill(play) ? readSetup({ players, stack, opts: { seat, preflopOnly: play === "preflop", pot: isPotDrill(play) ? play : null } }) : null;

export const setupLink = ({ play, seat, players, stack }: LinkSetup): string => `/practice?${new URLSearchParams({ play, seat, players: String(players), stack: String(stack) })}`;

/** The link's own params in an address, as a string that stands still while nothing about them moves; null with none. */
export function setupLinkKey(p: URLSearchParams): string | null {
  if (!p.get("play")) return null;
  return new URLSearchParams(SETUP_PARAMS.flatMap((k) => (p.get(k) ? [[k, p.get(k)!]] : []))).toString();
}

/** A link's setup read back; null where it isn't one. */
export function readSetupLink(p: URLSearchParams): ScenarioSetup | null {
  const [play, seat, players, stack] = SETUP_PARAMS.map((k) => p.get(k));
  if (!play || !seat || !players || !stack) return null;
  return linkSetup({ play: play as PlayKind, seat, players: Number(players), stack: Number(stack) });
}
