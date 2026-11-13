// Bunching (engine/bunching.py): the ranges entering the flop weighed by the hands the seats that folded preflop were
// holding, an option a spot asks for (Solve's setup, Study's switch). The request sends `bunching` with whose fold
// ranges weigh them: the preflop charts' (the same charts the ranges entering the flop come from) or the preflop
// solve's (engine/pf_solve.py, where this game is stored or was solved in this browser; else the charts', and the
// answer says why). Every street is then solved live (the flop libraries hold the even deal), and the answer's
// `bunching` block says which folds were used and how; the solves still deal the turn and river evenly. A local server
// runs upstream without engine/, so it's sent nothing: its answers carry no block and claim nothing.
import type { AdvisorState } from "./protocol";
import type { TransportKind } from "./types";

export type BunchingSource = "charts" | "solve";

export const BUNCHING_SOURCES: Record<BunchingSource, string> = {
  charts: "the preflop charts' fold ranges",
  solve: "the preflop solve's fold ranges",
};

/** The answer's `bunching` (engine/bunching.py Plan.info), or {off} where it was asked but couldn't apply. */
export interface BunchingBlock {
  off?: string;
  source?: BunchingSource;
  label?: string;
  folders?: { seat: string; combos: number }[];
  seats?: Record<string, { combos: number; weighted: number; spread: number | null }>;
  method?: "exact" | "sampled";
  samples?: number | null;
  stderr_pct?: number;
  conditioned_on?: string;
  runouts?: string;
  asked?: BunchingSource;
  why?: string;
  next_card?: { street: "turn" | "river"; by_rank: { rank: string; p: number; even: number }[]; most_moved: { card: string; p: number; even: number } };
}

/** The request as sent on this backend: a local server gets no `bunching` (upstream has no such key). */
export function withBunching(state: AdvisorState, transport: TransportKind): AdvisorState {
  if (transport === "worker" || state.bunching === undefined) return state;
  const s = { ...state };
  delete s.bunching;
  return s;
}

const isBlock = (b: unknown): b is BunchingBlock => !!b && typeof b === "object";

/** The answer's bunching in words, for its provenance; null where the answer has none. */
export function bunchingWords(b: unknown): string | null {
  if (!isBlock(b)) return null;
  if (typeof b.off === "string") return `bunching off: ${b.off}`;
  if (!b.source || !Array.isArray(b.folders)) return null;
  const who = b.folders.map((f) => f.seat).join(", ");
  const how = b.method === "exact" ? "exact" : `sampled over ${(b.samples ?? 0).toLocaleString("en-US")} deals, ±${b.stderr_pct ?? "?"}% a combo`;
  const asked = b.asked && b.asked !== b.source ? ` (the preflop solve's were asked for, but ${b.why ?? "it isn't held"})` : "";
  return `bunching: ranges weighed by the hands ${who} folded, from ${BUNCHING_SOURCES[b.source]}${asked}, ${how}; turn and river still dealt evenly`;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The next card's odds the folds give, the ranks they move most (Study's panel): "A 8.8% (even 8.2%)". */
export function nextCardWords(b: unknown, n = 3): string | null {
  if (!isBlock(b) || !b.next_card) return null;
  const moved = [...b.next_card.by_rank].sort((x, y) => Math.abs(y.p / y.even - 1) - Math.abs(x.p / x.even - 1)).slice(0, n);
  return `${b.next_card.street === "turn" ? "Turn" : "River"} card odds the folds give: ${moved.map((r) => `${r.rank} ${pct(r.p)} (even ${pct(r.even)})`).join(", ")}`;
}
