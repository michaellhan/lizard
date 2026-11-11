// A 3-way spot's flop report, built in the page: the 3-way library (solver/gto/mw_library.py) stores no report.json,
// but each flop's entry header holds the range's mix at every stored decision (first to act, the second after a
// check, the third after two checks), so the report is those headers side by side. A Lizard release also puts them in
// one file per spot, <spot>/heads.json (scripts/library/assemble.py, named in mw_index.json by hash as `heads`), so
// the page reads that, not one entry per flop (1,755 of them once the spot holds every flop); without it, the entries.
// Strategies only: the headers hold no range EVs or equities.
//
// The weights: a spot's flops were flop_library.representative_flops(184), a systematic sample of the flop space by
// weight, plus Kc7d2h, and its own build (scripts/library/build_mw_every_flop.py) takes it to every flop, part of the
// way at any time. So the stored flops are weighted by texture strata, which reads any of those sets right: every
// flop of a stratum (suit pattern, pairing, high card) shares its weight (how many of the 22100 flops its canonical
// flops stand for) equally among the stratum's stored flops; a stratum with none stored hands its weight to its suit
// pattern and pairing's stored flops, and failing that to every stored flop. All 1,755 stored, each flop then stands
// for its own suit count, as flop_library.report_weights has it; on the 185 flops of the first build, every decision's
// average moves under 2 points from the sample's equal weights (22100 / 184 a flop, the extra flop none; checked on
// the snapshot's four spots in mwReport.test.ts).
import type { LibrarySpotIndex } from "./catalog";
import type { EntryHead } from "./entry";
import type { LibraryReport } from "./files";

const RANKS = "23456789TJQKA";

/** <spot>/heads.json (assemble.py write_mw_heads): its entries' stored mixes */
export interface MwHeads {
  format: number;
  /** node path ('|'-joined) -> its action names */
  nodes: Record<string, string[]>;
  /** flop -> node path -> the range's frequencies, in the names' order */
  flops: Record<string, Record<string, number[]>>;
}
export const MW_HEADS_FORMAT = 1;

type Pattern = "rainbow" | "twotone" | "monotone";
type Pairing = "none" | "paired" | "trips";

/** a canonical flop's stratum: [suit pattern and pairing, high card] */
function stratum(flop: string): [string, number] {
  const ranks = [0, 2, 4].map((i) => RANKS.indexOf(flop[i]!));
  const suits = new Set([1, 3, 5].map((i) => flop[i])).size;
  const distinct = new Set(ranks).size;
  const pattern: Pattern = suits === 3 ? "rainbow" : suits === 2 ? "twotone" : "monotone";
  const pairing: Pairing = distinct === 3 ? "none" : distinct === 2 ? "paired" : "trips";
  return [`${pattern}:${pairing}`, Math.max(...ranks)];
}

/** every stratum's weight: how many of the 22100 flops its canonical flops stand for */
const STRATA: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  const add = (k: string, w: number) => m.set(k, (m.get(k) ?? 0) + w);
  for (let a = 0; a < 13; a++)
    for (let b = 0; b <= a; b++)
      for (let c = 0; c <= b; c++) {
        if (a > b && b > c) {
          add(`rainbow:none|${a}`, 24); // one canonical flop of 24
          add(`twotone:none|${a}`, 36); // three (which two share the suit), 12 each
          add(`monotone:none|${a}`, 4);
        } else if (a === b && b === c) add(`rainbow:trips|${a}`, 4);
        else {
          add(`rainbow:paired|${a}`, 12); // the kicker off both of the pair's suits
          add(`twotone:paired|${a}`, 12); // or on one
        }
      }
  return m;
})();

/** how many of the 22100 flops each stored flop stands for (see the weights above) */
export function flopWeights(flops: readonly string[]): number[] {
  const fine = new Map<string, number[]>();
  const mid = new Map<string, number[]>();
  flops.forEach((f, i) => {
    const [pp, hi] = stratum(f);
    for (const [m, k] of [
      [fine, `${pp}|${hi}`],
      [mid, pp],
    ] as const)
      m.set(k, [...(m.get(k) ?? []), i]);
  });
  const w = flops.map(() => 0);
  const share = (who: number[], total: number) => who.forEach((i) => (w[i] = w[i]! + total / who.length));
  for (const [k, total] of STRATA) {
    const who = fine.get(k) ?? mid.get(k.split("|")[0]!) ?? flops.map((_, i) => i);
    if (who.length) share(who, total);
  }
  return w;
}

function build(sp: LibrarySpotIndex, nodes: Record<string, string[]>, flops: { f: string; n: Record<string, number[]> }[]): LibraryReport {
  const w = flopWeights(flops.map((x) => x.f));
  return {
    format: 1,
    id: sp.id,
    label: sp.label,
    line: sp.line,
    seats: sp.seats as LibraryReport["seats"],
    pot: sp.pot,
    stack: sp.stack,
    nodes,
    flops: flops.map((x, i) => ({ f: x.f, w: w[i]!, n: x.n })),
    ...(sp.game ? { game: sp.game } : {}),
  };
}

/** the report from a spot's index entry and its flops' entry headers */
export function reportFromHeads(sp: LibrarySpotIndex, heads: readonly EntryHead[]): LibraryReport {
  const nodes: Record<string, string[]> = {};
  for (const h of heads) for (const nd of h.nodes) nodes[nd.path.join("|")] ??= nd.names;
  return build(
    sp,
    nodes,
    heads.map((h) => ({ f: h.board, n: Object.fromEntries(h.nodes.map((nd) => [nd.path.join("|"), nd.freqs])) })),
  );
}

/** the report from a spot's heads.json, or null where the file isn't this spot's flops as the index lists them */
export function reportFromHeadsFile(sp: LibrarySpotIndex, file: MwHeads): LibraryReport | null {
  if (file?.format !== MW_HEADS_FORMAT || !file.flops || !file.nodes) return null;
  const flops = Object.keys(sp.flops).sort();
  if (Object.keys(file.flops).length !== flops.length || !flops.every((f) => Object.hasOwn(file.flops, f))) return null;
  return build(
    sp,
    file.nodes,
    flops.map((f) => ({ f, n: file.flops[f]! })),
  );
}
