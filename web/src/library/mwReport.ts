// A 3-way spot's flop report, built in the page: the 3-way library (solver/gto/mw_library.py) stores no report.json,
// but each flop's entry header holds the range's mix at every stored decision (first to act, the second after a
// check, the third after two checks), so the report is those headers side by side. Strategies only: the headers hold
// no range EVs or equities.
//
// The weights: a 3-way spot's flops are flop_library.representative_flops(184), a systematic sample of the flop
// space by weight, plus mw_library.EXTRA_FLOPS (scripts/build_mw_library.py; checked for all four spots, 2026-11-03).
// As flop_library.report_weights has it for a sample, each sample flop stands for 22100 / 184 (its own suit count
// would count the weight twice); the extra flop, outside the sample, is listed but weighs nothing.
import type { LibrarySpotIndex } from "./catalog";
import type { EntryHead } from "./entry";
import type { LibraryReport } from "./files";

/** mw_library.EXTRA_FLOPS: solved besides the sample */
export const MW_EXTRA_FLOPS: readonly string[] = ["Kc7d2h"];
const ALL_FLOPS = 22100;

/** the report from a spot's index entry and its flops' entry headers */
export function reportFromHeads(sp: LibrarySpotIndex, heads: readonly EntryHead[]): LibraryReport {
  const nodes: Record<string, string[]> = {};
  for (const h of heads) for (const nd of h.nodes) nodes[nd.path.join("|")] ??= nd.names;
  const sample = heads.filter((h) => !MW_EXTRA_FLOPS.includes(h.board)).length;
  return {
    format: 1,
    id: sp.id,
    label: sp.label,
    line: sp.line,
    seats: sp.seats as LibraryReport["seats"],
    pot: sp.pot,
    stack: sp.stack,
    nodes,
    flops: heads.map((h) => ({
      f: h.board,
      w: MW_EXTRA_FLOPS.includes(h.board) ? 0 : ALL_FLOPS / sample,
      n: Object.fromEntries(h.nodes.map((nd) => [nd.path.join("|"), nd.freqs])),
    })),
    ...(sp.game ? { game: sp.game } : {}),
  };
}
