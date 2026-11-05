// A library answer's version (grading/version.ts). The published library has no version of its own: index.json holds
// its format, tree and spots, each spot its ranges' fingerprints (`fp`, from the charts that built it), its tree, each
// flop's sha1(entry)[:10] and sha1(report.json)[:10]; lizard-library.json only when it was assembled and how many flops
// each spot holds. Both of those last two move every time a growing spot gains a flop, which changes no answer already
// stored. What a stored answer rests on is its spot's ranges and tree, and its own entry: `fp` and the tree make a
// spot's version (a change in the charts or the bet tree re-solves the spot), and a flop's entry hash goes with it.
import type { LibraryIndex, LibrarySpotIndex } from "./catalog";

/** A short hash for telling two versions apart (FNV-1a, 32 bits): nothing here needs more, and it's synchronous. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** A spot's version; undefined for one that doesn't say its ranges. */
function spotId(sp: Pick<LibrarySpotIndex, "fp" | "tree">, tree: unknown): string | undefined {
  return sp.fp?.length ? hash(JSON.stringify([sp.fp, sp.tree ?? tree ?? null])) : undefined;
}

/** A stored answer's stamp: its spot's version and, given its flop, that entry's hash. `tree`: the index's, for a spot
 * that has none of its own. */
export function spotStamp(sp: Pick<LibrarySpotIndex, "id" | "fp" | "tree" | "flops">, tree: unknown, flop?: string): string | undefined {
  const id = spotId(sp, tree);
  if (!id) return undefined;
  const entry = flop !== undefined ? sp.flops?.[flop] : undefined;
  return `library:${sp.id}:${id}${entry ? `:${flop}:${entry}` : ""}`;
}

/** The stamp of an answer that names its spot and flop as the engine does (`precomputed`), or, naming no spot, the
 * whole library's. Undefined for a spot this index doesn't hold. */
export type LibraryStamp = (spot?: string, flop?: string) => string | undefined;

export function libraryStamps(index: LibraryIndex, mw?: LibraryIndex | null): LibraryStamp {
  const by = new Map<string, { sp: LibrarySpotIndex; tree: unknown }>();
  for (const ix of [index, mw]) for (const sp of ix?.spots ?? []) by.set(sp.id, { sp, tree: ix!.tree });
  const whole = hash(
    [...by.values()]
      .map(({ sp, tree }) => `${sp.id}=${spotId(sp, tree) ?? ""}`)
      .sort()
      .join(),
  );
  return (spot, flop) => {
    if (!spot) return `library:*:${whole}`;
    const s = by.get(spot);
    return s && spotStamp(s.sp, s.tree, flop);
  };
}
