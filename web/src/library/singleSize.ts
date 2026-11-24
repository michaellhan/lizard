// The single-size library (GTO Wizard's "single size solutions"): the heads-up 6-max 100bb preflop lines on a set of
// representative flops, each flop solved with one bet size at every node, the flop's size chosen for that flop by the
// solver's automatic sizing (scripts/library/build_single_size.py, docs/single-size-library.md). It is published beside
// the library as ss_index.json; the worker reads it through engine/single_size.py when a request says `single_size`.
//
// A spot's flops are on different trees (a 25% flop, a 75% one), so Study asks a single-size node with that flop's own
// size as the request's flop size, and 75% on the turn and river (the library model's later-street size), which is the
// stored tree exactly: the worker then reads the stored entry as it reads any library flop. Pure but for loadSingleSize.
//
// The 3-way set (W15, build_single_size.py --set mw3) is rows of the same index with `players: 3`: 3-way 6-max 100bb
// lines, every flop on one fixed flop size (33%, tied within noise with 25 and 50% on a sample: the automatic sizing is
// heads-up only) and 50% on the turn and river (the 3-way model's later-street size), solved by three-player CFR, which has no Nash guarantee.
import type { AdvisorAction, AdvisorState } from "@/solver/protocol";
import { flopName, lineToken } from "./flops";

/** The turn's and river's one bet size in every single-size tree (flop_library.library_config's later_sizes). */
export const LATER_PCT = 75;
/** The turn's and river's one bet size in the 3-way set's tree (gto/mw_library.library_config's turn and river bets). */
export const MW_LATER_PCT = 50;
/** The game the single-size library holds: 6-max, 100bb (no ante or straddle, and the games of SS_FORCED). */
export const SS_GAME = { players: 6, stack: 100 } as const;

/** A spot's game, where it has an ante or a straddle (the index's `game`; each seat's ante in bb, a 2bb straddle from the
 * first seat). */
export interface SsGame {
  players: number;
  stack: number;
  ante: number;
  straddle: boolean;
}

/** The ante and straddle games the single-size library is built for (scripts/library/build_single_size.py GAMES, W13):
 * 6-max 100bb with a 1bb big-blind ante as each seat's share (0.17bb), or a 2bb straddle from UTG. Their spots' ranges
 * entering the flop are Lizard's stored preflop solve of that game, not the charts. */
export const SS_FORCED: readonly { ante: number; straddle: boolean }[] = [
  { ante: 0.17, straddle: false },
  { ante: 0, straddle: true },
];

export interface SsSpot {
  id: string;
  /** the several-size library's spot of the same line */
  base?: string;
  label: string;
  /** preflop line, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c" */
  line: string;
  seats: string[];
  pot: number;
  stack: number;
  /** flop -> sha1(entry)[:10] */
  flops: Record<string, string>;
  /** flop -> its one flop bet size, % of the pot */
  sizes: Record<string, number>;
  /** other lines that reach the same game (the same ranges, pot and stack) and so read this spot */
  aliases?: { label: string; line: string }[];
  /** the flops solved on the old tree (the river blind on the turn: no turn file) */
  old?: string[];
  turns?: boolean | string[];
  /** an ante or straddle game's spot: the game (none: 6-max 100bb without either) */
  game?: SsGame;
  /** that game's stored preflop solve, whose ranges the spot was built on (engine/pf_solve.py's key, its file's sha1) */
  pf?: { key?: string; sha1?: string; model?: string; words?: string };
  /** 3 for a row of the 3-way set (none: heads-up) */
  players?: number;
  /** the 3-way set's convergence: its entries' median iterations and mean (and worst) best-response gain, % of the pot,
   * and the target it stopped at */
  conv?: { iters?: number; expl?: number; max_expl?: number; target?: number };
}

/** A spot's player count: 3 for the 3-way set's rows, else 2. */
export const ssPlayers = (s: Pick<SsSpot, "players">): 2 | 3 => (s.players === 3 ? 3 : 2);

export interface SsIndex {
  format: number;
  ss_format: number;
  /** the flops every spot holds, in the build's order (assemble.py) */
  flops?: string[];
  spots: SsSpot[];
}

/** ss_index.json read like anything from outside: null unless it's the format this page reads. */
export function parseSsIndex(raw: unknown): SsIndex | null {
  const r = raw as Partial<SsIndex> | null | undefined;
  if (!r || r.format !== 2 || r.ss_format !== 1 || !Array.isArray(r.spots)) return null;
  const spots = r.spots.filter(
    (s): s is SsSpot =>
      !!s && typeof s.id === "string" && typeof s.line === "string" && typeof s.label === "string" && !!s.flops && typeof s.flops === "object" && !!s.sizes && typeof s.sizes === "object",
  );
  return { format: 2, ss_format: 1, ...(Array.isArray(r.flops) ? { flops: r.flops.filter((f): f is string => typeof f === "string") } : {}), spots };
}

/** A hand's ante and straddle: its forced bets from its setup, or null where the setup holds anything else (sizes, rake,
 * ranges, stacks, a tournament, bunching: a tree or ranges of its own). */
export function ssHandGame(
  setup: object | undefined,
): { ante: number; straddle: boolean } | null {
  const s = (setup ?? {}) as { ante?: number; straddle?: boolean };
  if (
    Object.entries(s).some(
      ([k, v]) => v !== undefined && k !== "ante" && k !== "straddle",
    )
  )
    return null;
  return {
    ante: typeof s.ante === "number" && s.ante > 0 ? s.ante : 0,
    straddle: !!s.straddle,
  };
}

const ANTE_TOL = 1e-9;

/** Whether a spot is of a hand's game: no game, no ante or straddle; else the same ante (to the cent's float) and straddle. */
export function sameGame(
  g: SsGame | undefined,
  h: { ante: number; straddle: boolean },
): boolean {
  if (!g) return !h.ante && !h.straddle;
  return (
    g.players === SS_GAME.players &&
    g.stack === SS_GAME.stack &&
    Math.abs((g.ante ?? 0) - h.ante) < ANTE_TOL &&
    !!g.straddle === h.straddle
  );
}

/** A game in words, as the spot's preflop solve names it ("1bb big-blind ante (0.17bb a seat)"), else from its numbers. */
export function gameWords(
  g: SsGame | { ante: number; straddle: boolean },
  pf?: SsSpot["pf"],
): string {
  if (pf?.words) return pf.words;
  return (
    [
      g.ante ? `${g.ante}bb ante a seat` : "",
      g.straddle ? "2bb straddle from UTG" : "",
    ]
      .filter(Boolean)
      .join(" and ") || "no ante"
  );
}

/** The flops the single-size library covers on every spot of a game, in the build's order: the 100bb heads-up spots' (no
 * ante or straddle) from the index's list, else the flops every one of the game's spots holds (`players`: of the 3-way
 * set's, or the heads-up ones), in its first spot's order. */
export function coveredFlops(
  idx: SsIndex,
  game: { ante: number; straddle: boolean } = { ante: 0, straddle: false },
  players: 2 | 3 = 2,
): string[] {
  const plain = !game.ante && !game.straddle;
  if (plain && players === 2 && idx.flops?.length) return idx.flops;
  const all = gameSpots(idx, game, players).map((s) => Object.keys(s.flops));
  const first = all[0] ?? [];
  const sets = all.map((x) => new Set(x));
  return first.filter((f) => sets.every((x) => x.has(f)));
}

/** The spots of a game (none given: the 100bb spots without an ante or straddle), the heads-up ones or (`players` 3) the
 * 3-way set's. */
export function gameSpots(
  idx: SsIndex,
  game: { ante: number; straddle: boolean } = { ante: 0, straddle: false },
  players: 2 | 3 = 2,
): SsSpot[] {
  return idx.spots.filter((s) => sameGame(s.game, game) && ssPlayers(s) === players);
}

/** What a hand needs for the single-size library to hold its spot: the game, and no setup of its own that changes the
 * tree or the ranges (sizes, rake, ranges, stacks, a tournament, bunching) beyond an ante or straddle game it holds. */
export interface SsHand {
  players: number;
  stack: number;
  board: string;
  preflop: readonly AdvisorAction[];
  setup?: object;
}

export interface SsMatch {
  spot: SsSpot;
  /** the line's own label (an alias's where the hand came by one) */
  label: string;
  /** the hand's flop as the library names it, or null before the flop */
  flop: string | null;
  /** that flop's one bet size, % of the pot; null where the spot doesn't hold the flop */
  pct: number | null;
}

/** The single-size spot a hand's preflop line reaches (its own line or an alias), with the flop and its size; null
 * where the library holds no such line, or the hand isn't its game. */
export function ssMatch(idx: SsIndex | null | undefined, h: SsHand): SsMatch | null {
  if (!idx || h.players !== SS_GAME.players || h.stack !== SS_GAME.stack) return null;
  const game = ssHandGame(h.setup);
  if (!game) return null;
  const line = h.preflop.map(lineToken).join();
  let hit: { spot: SsSpot; label: string } | null = null;
  for (const s of idx.spots) {
    if (!sameGame(s.game, game)) continue;
    if (s.line === line) hit = { spot: s, label: s.label };
    else {
      const a = s.aliases?.find((x) => x.line === line);
      if (a) hit = { spot: s, label: a.label };
    }
    if (hit) break;
  }
  if (!hit) return null;
  const b = h.board;
  const flop = b.length >= 6 ? flopName([b.slice(0, 2), b.slice(2, 4), b.slice(4, 6)]) : null;
  const pct = flop && Object.hasOwn(hit.spot.flops, flop) && typeof hit.spot.sizes[flop] === "number" ? hit.spot.sizes[flop]! : null;
  return { ...hit, flop, pct };
}

/** The request's single-size part: `single_size` and the flop's own size (turn and river LATER_PCT; the 3-way set's
 * MW_LATER_PCT), so the advisor's tree is the stored one; null where the library doesn't hold the hand's flop (that node
 * is asked as it would be without). */
export function ssRequest(m: SsMatch | null): Pick<AdvisorState, "sizes"> & { single_size: true } | null {
  if (!m || m.pct === null) return null;
  const later = ssPlayers(m.spot) === 3 ? MW_LATER_PCT : LATER_PCT;
  return { single_size: true, sizes: { flop: [m.pct], turn: [later], river: [later] } };
}

/** A flop size in words: "33%", or "all-in (167%)" where one bet of it puts the stack in. */
export function sizeWords(pct: number, spot?: Pick<SsSpot, "pot" | "stack">): string {
  const p = `${Math.round(pct * 10) / 10}%`;
  return spot && (pct / 100) * spot.pot >= spot.stack - 1e-6 ? `all-in (${p})` : p;
}

const cache = new Map<string, Promise<SsIndex | null>>();

/** A library's ss_index.json (null where it has none or it won't read), once a page load per library. */
export function loadSingleSize(base: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<SsIndex | null> {
  let p = cache.get(base);
  if (!p) {
    p = fetchImpl(`${base}ss_index.json`, { cache: "no-cache" })
      .then(async (r) => (r.ok ? parseSsIndex(await r.json()) : null))
      .catch(() => null);
    cache.set(base, p);
  }
  return p;
}

/** (tests) */
export const clearSingleSizeCache = () => cache.clear();
