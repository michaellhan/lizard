// The flop library as Instant flops reads it (multitable.js:82-145): which preflop lines and flops it holds, so a table can
// be dealt until it reaches one, and the preflop charts' mix at a node, so the seats on the way there are drawn here and
// not asked for one by one. All of it deals and orders: what answers your spot still comes from the solver with its own
// provenance, and a move drawn from a chart is labelled as one. The index is read from the resolved library, only above
// one table or at Accurate, as it's about 730 KB; `loadCatalog` keeps only counts of what's in it. Pure but for `flopIndex`.
import { kindOf } from "@/components/actions";
import { LIBRARY_SOURCES, type LibrarySourceId } from "@/config";
import { classOf } from "@/engine/nlhe/cards";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import { gameLabel, type LibrarySpotIndex } from "./catalog";
import { LibraryFiles } from "./files";

/** A spot Instant flops can deal: its preflop line as tokens, the seats still in, the flops it holds. */
export interface FlopSpot {
  id: string;
  label: string;
  toks: string[];
  players: string[];
  flops: ReadonlySet<string>;
  /** a spot of another game (none: 6-max 100bb) */
  game?: LibrarySpotIndex["game"];
}

/** A hand's game, as a spot is matched against it. */
export interface FlopGame {
  players: number;
  stack: number;
  ante?: number;
  straddle?: boolean;
  rake?: number;
  sizes?: unknown;
}

const R13 = "23456789TJQKA";
const SU = "cdhs";
const SUITS = [0, 1, 2, 3];
const PERMS = SUITS.flatMap((a) => SUITS.flatMap((b) => SUITS.flatMap((c) => SUITS.filter((d) => new Set([a, b, c, d]).size === 4).map((d) => [a, b, c, d]))));

/** A flop's name in the library, as gto/flop_library.py canonical(): the least of its 24 suit permutations, high to low. */
export function flopName(cards: readonly string[]): string {
  const ints = cards.map((c) => R13.indexOf(c[0]!) * 4 + SU.indexOf(c[1]!));
  let best: number[] | null = null;
  for (const p of PERMS) {
    const t = ints.map((c) => (c >> 2) * 4 + p[c & 3]!).sort((a, b) => b - a);
    if (!best || t[0]! < best[0]! || (t[0] === best[0] && (t[1]! < best[1]! || (t[1] === best[1] && t[2]! < best[2]!)))) best = t;
  }
  return best!.map((c) => R13[c >> 2]! + SU[c & 3]!).join("");
}

/** A move as the index's `line` writes it, "BTN:r2.5". */
export function lineToken(m: { pos: string; action: string; to?: number }): string {
  const size = (Math.round((m.to ?? 0) * 100) / 100).toString();
  return `${m.pos}:${m.action === "fold" ? "f" : m.action === "call" ? "c" : m.action === "check" ? "x" : m.action === "all-in" ? "a" : `r${size}`}`;
}

/** What Instant flops can deal from an index, read like anything from outside (no list: none). */
export function instantSpots(index: unknown): FlopSpot[] {
  const spots = (index as { spots?: unknown } | null | undefined)?.spots;
  if (!Array.isArray(spots)) return [];
  return (spots as Partial<LibrarySpotIndex>[]).flatMap((s) => {
    if (typeof s?.line !== "string" || !s.line || !s.flops) return [];
    const toks = s.line.split(",");
    return [{ id: s.id ?? "", label: s.label ?? "", toks, players: toks.filter((x) => !x.endsWith(":f")).map((x) => x.split(":")[0]!), flops: new Set(Object.keys(s.flops)), ...(s.game ? { game: s.game } : {}) }];
  });
}

/** The spots of this game: the same players, stack, ante and straddle, a spot with no `game` being 6-max 100bb. Nothing
 * with a rake or your own sizes, as no spot was solved under them. */
export function heldSpots(spots: readonly FlopSpot[], g: FlopGame): FlopSpot[] {
  if (g.rake || (g.sizes && Object.keys(g.sizes).length)) return [];
  return spots.filter((s) => {
    const { players, stack, ante, straddle } = s.game ?? { players: 6, stack: 100, ante: 0, straddle: false };
    return players === g.players && stack === g.stack && ante === (g.ante ?? 0) && straddle === !!g.straddle;
  });
}

/** A game in words. */
export const gameWords = (game: FlopSpot["game"]) => gameLabel({ game, seats: [] });

/** The games these spots are of, in words. */
export const gamesHeld = (spots: readonly FlopSpot[]) => [...new Set(spots.map((s) => gameWords(s.game)))];

/** The lines, as tokens, a hand can reach a spot by: you're in them, and the flop it was dealt is held there. */
export function candsFor(spots: readonly FlopSpot[], hero: string, board: readonly string[]): string[][] {
  const name = flopName(board.slice(0, 3));
  return spots.filter((s) => s.players.includes(hero) && s.flops.has(name)).map((s) => s.toks);
}

/** Whether the library holds this request's flop on its preflop line: an instant answer. */
export function libFlop(spots: readonly FlopSpot[], q: AdvisorState): boolean {
  const b = q.board ?? "";
  const line = (q.preflop ?? []).map(lineToken).join();
  const name = flopName([b.slice(0, 2), b.slice(2, 4), b.slice(4, 6)]);
  return spots.some((s) => s.toks.join() === line && s.flops.has(name));
}

/** A preflop node: every hand asks one chart there, whoever holds it. */
export const chartKey = (q: AdvisorState) => JSON.stringify([q.players, q.stack, q.preflop]);

/** Study's question at a preflop node: each hand class's mix (Advisor._study_preflop). */
export const chartState = (q: AdvisorState): AdvisorState => ({ players: q.players, stack: q.stack, board: "", preflop: q.preflop, flop: [], turn: [], river: [], study: true });

/** Whether an answer can be drawn from (else its seats are asked one by one). */
export const isChart = (r: AdvisorResponse) => !r.error && r.study === "node" && r.street === "preflop" && !!r.grid && Array.isArray(r.actions);

/** A seat's move from a node's chart, drawn from its hand class's mix as Advisor.play draws it; null where the chart isn't
 * that seat's or doesn't hold the class. `rng`: 0 to 1. */
export function chartMove(ch: AdvisorResponse, seat: string, hole: string, rng: () => number = Math.random): (Pick<PlayMove, "pos" | "action" | "name" | "freq"> & { to?: number }) | null {
  const c = ch.actor === seat ? ch.grid?.cells[classOf(hole)] : undefined;
  const actions = ch.actions ?? [];
  if (!c || !Array.isArray(c.f) || c.f.length !== actions.length) return null;
  const acts = actions.map((a, i) => ({ ...a, freq: c.f[i]! }));
  const live = acts.filter((a) => a.freq > 0);
  const from = live.length ? live : acts;
  let r = rng() * from.reduce((s, a) => s + a.freq, 0);
  let pick = from.at(-1);
  for (const a of from) {
    r -= a.freq;
    if (r <= 0) {
      pick = a;
      break;
    }
  }
  if (!pick) return null;
  const action = kindOf(pick.action);
  const to = action === "bet" || action === "raise" ? Math.round(Number(pick.amount_bb) * 100) / 100 : undefined;
  return { pos: seat, action, name: pick.action, freq: pick.freq, ...(to !== undefined ? { to } : {}) };
}

/** The index of the resolved library (unset: the first source, as the runtime's fallback is). */
export function flopIndex(source: LibrarySourceId | null): Promise<unknown> {
  const { base } = LIBRARY_SOURCES.find((s) => s.id === source) ?? LIBRARY_SOURCES[0];
  return new LibraryFiles(base).index();
}
