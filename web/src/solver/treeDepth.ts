// How big a tree this device's heads-up solves may build (engine/tree_depth.py `max_cells`): a setting, sent with every
// request to the browser's worker when it isn't the engine's own 24M. A tree past the cap is cut to fit (fewer sizes,
// then fewer raises: advisor.py TRIMS), and the answer says how; a bigger cap keeps more of a big menu at the cost of
// memory and time. A local server runs upstream without engine/: it's sent neither this nor a spot's raise cap, and keeps
// upstream's 2 bets-and-raises and 24M.
//
// Memory: scripts/benchmarks/tree_depth.py measured a solve's peak natively (TREE_MEMORY below); Pyodide's heap ran ~10%
// under native on the same tree (advisor.py, above MAX_CELLS), so these are the high end in the browser, whose worker
// has a 2 GB heap shared with the solves it keeps (engine/tree_depth.py makes room for a bigger tree first).
import type { AdvisorState } from "./protocol";
import type { TransportKind } from "./types";

export type TreeCap = "phone" | "standard" | "large";

/** The engine's own cap (solver/gto/advisor.py MAX_CELLS): sent as nothing. */
export const ENGINE_CELLS = 24_000_000;

/** Measured by scripts/benchmarks/tree_depth.py memory (native, one thread): MB at a solve's peak for a tree of
 * that many cells, base + cells x bytes. */
export const TREE_MEMORY = { baseMb: 120, bytesPerCell: 27 };

export const peakMb = (cells: number) => Math.round(TREE_MEMORY.baseMb + (cells * TREE_MEMORY.bytesPerCell) / 2 ** 20);

export const TREE_CAPS: Record<TreeCap, { cells: number; label: string }> = {
  phone: { cells: 12_000_000, label: "Phone" },
  standard: { cells: ENGINE_CELLS, label: "Standard" },
  large: { cells: 32_000_000, label: "Large" },
};

/** "12M cells, up to ~0.4 GB" */
export const capWords = (c: TreeCap) => `${TREE_CAPS[c].cells / 1e6}M cells, up to ~${(peakMb(TREE_CAPS[c].cells) / 1024).toFixed(1)} GB`;

/** The request as sent on this backend: the worker gets this device's cap where it isn't the engine's; a local server
 * gets neither the cap nor a raise cap (upstream has no such keys: it would ignore them). */
export function withTreeCap(state: AdvisorState, cap: TreeCap, transport: TransportKind): AdvisorState {
  if (transport !== "worker") {
    if (state.raises === undefined && state.max_cells === undefined) return state;
    const s = { ...state };
    delete s.raises;
    delete s.max_cells;
    return s;
  }
  const cells = TREE_CAPS[cap]?.cells ?? ENGINE_CELLS;
  return cells === ENGINE_CELLS ? state : { ...state, max_cells: cells };
}

/** What an answer's tree was asked under (engine/tree_depth.py `tree`), in words; null where it says nothing. */
export function treeWords(tree: unknown): string | null {
  if (!tree || typeof tree !== "object") return null;
  const { raises, max_cells } = tree as { raises?: unknown; max_cells?: unknown };
  const out: string[] = [];
  if (typeof raises === "number") out.push(raises <= 1 ? "a bet a street, then all-in only" : `up to ${raises} bets and raises a street`);
  if (typeof max_cells === "number") out.push(`trees up to ${Math.round(max_cells / 1e5) / 10}M cells`);
  return out.length ? out.join(", ") : null;
}
