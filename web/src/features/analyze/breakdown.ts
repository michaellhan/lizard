// Your graded decisions broken down by what they were: seat, street, pot type, the size faced or chosen, the effective
// stack, the flop's texture. Each row is a tally of the report's (report.ts), with its count, what its grades stand on
// and the interval on its share in the mix. What a kept decision can't say isn't guessed: a decision stores whether it
// faced a bet and not how much, and no stack, so those three come from its hand's history, through the same one pass as
// the stats as played (stats.ts MoveFact). A decision neither can answer for is counted under `left`, with why.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { TEXTURE_GROUPS, texture, type TextureKey } from "@/features/practice/texture";
import type { Street } from "@/poker/table";
import { POT_TYPES, STREETS } from "./analyze";
import { basisOf, BASES, groupBy, isGraded, type Group } from "./report";
import { RAISE_SIZES, raiseBucket, SIZES, sizeBucket, type HandStats, type MoveFact } from "./stats";

export type BreakBy = "pos" | "street" | "pot" | "faced" | "chosen" | "stack" | TextureKey;

/** The ways to break the decisions down: `history` says what's read from the hand's history and not the decision. */
export const BREAKDOWNS: readonly { by: BreakBy; label: string; first: string; history?: boolean; note?: string }[] = [
  { by: "pos", label: "Your seat", first: "Your seat" },
  { by: "street", label: "Street", first: "Street" },
  { by: "pot", label: "Pot type", first: "Pot type" },
  { by: "faced", label: "Bet size faced", first: "Faced", history: true, note: "The size is read from the hand's history, as a decision stores only that it faced a bet. Preflop it's the raise to, in big blinds; after the flop the bet's share of the pot it went into." },
  { by: "chosen", label: "Bet size chosen", first: "Chose", history: true, note: "The size is read from the hand's history. A bet is in % of the pot before it; a raise in multiples of the bet raised, the big blind's for an open. An all-in counts at its size." },
  { by: "stack", label: "Effective stack", first: "Effective stack", history: true, note: "Read from the hand's history, as a decision stores no stack: yours at the start of the hand against the deepest opponent who stayed in." },
  ...TEXTURE_GROUPS.map((g) => ({ by: g.key, label: `Flop: ${g.label.toLowerCase()}`, first: g.label, note: "The flop's texture, for your decisions on the flop and the streets after it." })),
];

/** Under `max`, each. */
export const STACKS: readonly { label: string; max: number }[] = [
  { label: "Under 20bb", max: 20 },
  { label: "20–40bb", max: 40 },
  { label: "40–75bb", max: 75 },
  { label: "75–125bb", max: 125 },
  { label: "125–200bb", max: 200 },
  { label: "Over 200bb", max: Infinity },
];
const PRE_FACED: readonly { label: string; max: number }[] = [
  { label: "under 2.5bb", max: 2.5 },
  { label: "2.5–3.5bb", max: 3.5 },
  { label: "3.5–6bb", max: 6 },
  { label: "6–12bb", max: 12 },
  { label: "12–30bb", max: 30 },
  { label: "over 30bb", max: Infinity },
];
const label = (list: readonly { label: string; max: number }[], x: number) => list.find((s) => x < s.max)?.label;

const facedPre = (s: string) => `Preflop: a raise to ${s}`;
const facedPost = (s: string) => `After the flop: a bet of ${s} of the pot`;
const chosePre = (s: string) => `Preflop: a raise of ${s}`;
const choseBet = (s: string) => `After the flop: a bet of ${s} of the pot`;
const choseRaise = (s: string) => `After the flop: a raise of ${s}`;

const ORDERS: Partial<Record<BreakBy, readonly string[]>> = {
  pos: ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  street: STREETS,
  pot: POT_TYPES,
  faced: [...PRE_FACED.map((s) => facedPre(s.label)), ...SIZES.map((s) => facedPost(s.label))],
  chosen: [...RAISE_SIZES.map((s) => chosePre(s.label)), ...SIZES.map((s) => choseBet(s.label)), ...RAISE_SIZES.map((s) => choseRaise(s.label))],
  stack: STACKS.map((s) => s.label),
  ...Object.fromEntries(TEXTURE_GROUPS.map((g) => [g.key, Object.values(g.values)])),
};

export interface BreakContext {
  hands: ReadonlyMap<string, HandRecord>;
  /** each hand's stats as played, for what's read from the history (a hand the replay stopped short of is null) */
  facts?: ReadonlyMap<string, HandStats | null> | null;
}

/** Why a decision has no row, or its row. */
type Cell = { key: string } | { why: string };

/** A decision's index on its street: its own, or, kept before that was, its id's last part. */
export function moveIndex(d: Pick<DecisionRecord, "i" | "id">): number | null {
  if (d.i !== undefined) return d.i;
  const n = Number(d.id.slice(d.id.lastIndexOf("|") + 1));
  return Number.isInteger(n) ? n : null;
}

const WHY = {
  pos: "kept without a seat",
  pot: "kept without a pot type, its hand has none either",
  stopped: "its hand's replay stopped short of the history",
  place: "kept without its place in the hand",
  move: "its move isn't in the history",
  noBet: "no bet or raise to answer",
  noSize: "a fold, check or call has no size",
  preflop: "before the flop, there's no board",
  board: "its hand keeps no flop",
};

function factOf(d: DecisionRecord, facts: BreakContext["facts"]): MoveFact | string {
  const s = facts?.get(d.handId);
  if (!s) return WHY.stopped;
  const i = moveIndex(d);
  if (i === null) return WHY.place;
  return s.moves.find((m) => m.street === (d.street as Street) && m.i === i) ?? WHY.move;
}

/** A decision's row in a breakdown. (Pure and per decision: the row's hands are found by asking it again.) */
export function cellOf(d: DecisionRecord, by: BreakBy, ctx: BreakContext): Cell {
  const h = ctx.hands.get(d.handId);
  if (by === "pos") return d.pos ? { key: d.pos } : { why: WHY.pos };
  if (by === "street") return { key: d.street };
  if (by === "pot") {
    const pot = d.potType ?? h?.potType;
    return pot ? { key: pot } : { why: WHY.pot };
  }
  if (by === "faced") {
    const f = factOf(d, ctx.facts);
    if (typeof f === "string") return { why: f };
    if (f.faced === undefined) return { why: WHY.noBet };
    const s = label(f.street === "preflop" ? PRE_FACED : SIZES, f.faced);
    return s ? { key: f.street === "preflop" ? facedPre(s) : facedPost(s) } : { why: WHY.move };
  }
  if (by === "chosen") {
    const f = factOf(d, ctx.facts);
    if (typeof f === "string") return { why: f };
    if (f.betPct !== undefined) return { key: choseBet(SIZES[sizeBucket(f.betPct)]!.label) };
    if (f.raiseX === undefined) return { why: WHY.noSize };
    const s = RAISE_SIZES[raiseBucket(f.raiseX)]!.label;
    return { key: f.street === "preflop" ? chosePre(s) : choseRaise(s) };
  }
  if (by === "stack") {
    const s = ctx.facts?.get(d.handId);
    return s ? { key: label(STACKS, s.eff)! } : { why: WHY.stopped };
  }
  if (d.street === "preflop") return { why: WHY.preflop };
  const flop = h?.board.slice(0, 6) ?? "";
  if (flop.length < 6) return { why: WHY.board };
  const g = TEXTURE_GROUPS.find((x) => x.key === by)!;
  return { key: g.values[texture(flop)[by as TextureKey]]! };
}

export interface BreakRow extends Group {
  /** what its grades stand on, the most solid first */
  bases: { basis: string; n: number }[];
}

export interface Breakdown {
  /** the graded decisions gone through */
  graded: number;
  rows: BreakRow[];
  /** the graded decisions with no row, by why */
  left: { why: string; n: number }[];
}

export function breakdown(ds: readonly DecisionRecord[], by: BreakBy, ctx: BreakContext): Breakdown {
  const graded = ds.filter(isGraded);
  const left = new Map<string, number>();
  const keys = new Map<DecisionRecord, string>();
  for (const d of graded) {
    const c = cellOf(d, by, ctx);
    if ("key" in c) keys.set(d, c.key);
    else left.set(c.why, (left.get(c.why) ?? 0) + 1);
  }
  const bases = new Map<string, Map<string, number>>();
  for (const [d, k] of keys) {
    const m = bases.get(k) ?? new Map<string, number>();
    const b = basisOf(d);
    m.set(b, (m.get(b) ?? 0) + 1);
    bases.set(k, m);
  }
  const rows = groupBy(graded, (d) => keys.get(d), ORDERS[by]).map((g) => ({
    ...g,
    bases: BASES.flatMap((basis) => {
      const n = bases.get(g.key)?.get(basis);
      return n ? [{ basis, n }] : [];
    }),
  }));
  return { graded: graded.length, rows, left: [...left].map(([why, n]) => ({ why, n })).sort((a, b) => b.n - a.n) };
}

/** A row's decisions, the worst first. */
export const worstFirst = (ds: readonly DecisionRecord[]): DecisionRecord[] =>
  [...ds].sort((a, b) => (b.evLossBb ?? 0) - (a.evLossBb ?? 0) || (a.freq ?? 1) - (b.freq ?? 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
