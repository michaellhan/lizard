// What a single-size answer is, in words (engine/single_size.py's `single_size` block; library/singleSize.ts sends the
// request): the tree it's on, one bet size a node, the flop's chosen per flop by the solver's automatic sizing, and
// whether this answer is the stored entry, stands on a stored flop, or was solved live on the same one-size tree.

/** engine/single_size.py: the answer's `single_size` */
export interface SingleSizeBlock {
  /** this answer is the single-size library's entry */
  stored: boolean;
  spot?: string;
  /** the entry read during this request (a later street's answer stands on it) */
  flop?: { spot?: string; flop?: string; pct?: number | null };
  /** the sizes the request asked (% of the pot, a street) */
  sizes?: Record<string, number[]>;
  /** whether the library has a single-size index at all */
  library: boolean;
  /** an ante or straddle game's spot (W13): the game and the spot it read */
  game?: {
    spot?: string;
    players?: number;
    stack?: number;
    ante?: number;
    straddle?: boolean;
  };
  /** that spot's ranges entering the flop: Lizard's stored preflop solve of the game (engine/pf_solve.py), not the charts */
  ranges?: {
    source?: string;
    key?: string;
    sha1?: string;
    words?: string;
    model?: string;
  };
}

/** The ranges of an ante or straddle game's answer, in words (null where the answer plays the charts' ranges). */
export function gameRangesWords(b: Partial<SingleSizeBlock>): string | null {
  if (!b.game && !b.ranges) return null;
  const g = b.game ?? {};
  const words =
    b.ranges?.words ??
    ([g.ante ? `${g.ante}bb ante a seat` : "", g.straddle ? "2bb straddle" : ""]
      .filter(Boolean)
      .join(" and ") ||
      "this game");
  const id = b.ranges?.key
    ? ` ${b.ranges.key}${b.ranges.sha1 ? ` (${b.ranges.sha1})` : ""}`
    : "";
  return `ranges entering the flop from Lizard's stored preflop solve of this game (${words})${id}, not the charts; preflop is approximate`;
}

/** The tree in words, as the provenance line says it. */
export const SINGLE_SIZE_TREE = "single-size tree with solver-chosen sizes";

const pctWords = (x: unknown) =>
  typeof x === "number" ? `${Math.round(x * 10) / 10}%` : null;

/** A single-size answer's provenance, in words; null where the answer isn't one. */
export function singleSizeWords(b: unknown, street?: string): string | null {
  if (!b || typeof b !== "object") return null;
  const s = b as Partial<SingleSizeBlock>;
  const flopPct = pctWords(s.flop?.pct) ?? pctWords(s.sizes?.flop?.[0]);
  const later = pctWords(s.sizes?.turn?.[0]) ?? "75%";
  const tree = `${SINGLE_SIZE_TREE}: one bet size a node, the flop's${flopPct ? ` ${flopPct}` : ""} picked for this flop by the solver's automatic sizing (a first solve over 25% to 200% of the pot and all-in, the size used most kept), turn and river bets ${later}`;
  const ranges = gameRangesWords(s);
  const r = ranges ? `; ${ranges}` : "";
  if (s.stored) return `${tree}; read from the single-size library${r}`;
  if (s.flop?.spot)
    return `${tree}; the flop read from the single-size library, the ${street ?? "street"} solved live on the same tree${r}`;
  return `${tree}; solved live: this flop isn't in the single-size library${r}`;
}
