// Your play at each node against the answer's, laid out as GTO Wizard's reports lay it out: preflop, each of your
// frequencies (report.ts FREQS) from each seat, the charts' and the preflop solve's apart and never pooled; after the flop,
// each spot's fold, check or call and bet or raise. A cell is your share of an action against the answer's share of it for
// the same hands at the same decisions, with its test (leakStats.ts pairTest). A cell past the 95% bar on its own is marked,
// so about one cell in twenty is marked by chance alone: the leak list (report.ts readLeaks) holds rows to a bar shared over
// every test it makes.
import type { DecisionRecord } from "@/data/db";
import { pairTest, Z_ONE } from "./leakStats";
import { countedBb, FREQS, isGraded, isPfSolve, missesOf, spotOf, shareOf, took, type Cls } from "./report";

/** Seats in the order they act preflop. */
export const SEAT_ORDER = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
/** The preflop rows of your frequencies, and the open-limp beside the open (a row of its own here only: in Your
 * frequencies it would be 0% against 0% at most tables). */
const PRE = FREQS.slice(0, FREQS.findIndex(([label]) => label === "Flop c-bet"));
const OPEN = PRE.findIndex(([label]) => label === "Open (RFI)");
export const PF_FREQS: typeof FREQS = [...PRE.slice(0, OPEN + 1), ["Open limp (RFI)", "passive", (d) => d.situation === "RFI"], ...PRE.slice(OPEN + 1)];
/** Under this many a cell isn't marked however it looks: the test's normal shape doesn't hold. */
export const MIN_MARK = 10;

export interface Cell {
  n: number;
  /** of them, the times you took it */
  k: number;
  you: number;
  gto: number;
  z: number;
  /** past the 95% bar alone, with MIN_MARK decisions or more: over or under the answer */
  mark: "over" | "under" | null;
}

const hasMix = (d: DecisionRecord) => isGraded(d) && Array.isArray(d.mix) && d.mix.length > 0;

/** Your share of a kind of action against the answer's for the same hands; null with no decision. */
export function cellOf(rs: readonly DecisionRecord[], cls: Cls): Cell | null {
  if (!rs.length) return null;
  const ys = rs.map((d) => Number(took(d.action, cls)));
  const ms = rs.map((d) => shareOf(d, cls));
  const t = pairTest(ys, ms);
  const k = ys.reduce((s, y) => s + y, 0);
  const mark = rs.length >= MIN_MARK && Math.abs(t.z) >= Z_ONE ? (t.z > 0 ? "over" : "under") : null;
  return { n: rs.length, k, you: k / rs.length, gto: ms.reduce((s, m) => s + m, 0) / rs.length, z: t.z, mark };
}

/** A preflop cell's decisions: a frequency's row, from one seat or every seat, by one answer. */
export const pfCellTest = (label: string, solve: boolean, seat?: string) => {
  const row = PF_FREQS.find(([l]) => l === label);
  return (d: DecisionRecord) => !!row && hasMix(d) && d.street === "preflop" && isPfSolve(d) === solve && row[2](d) && (seat === undefined || d.pos === seat);
};

export interface GridRow {
  label: string;
  cls: Cls;
  all: Cell;
  bySeat: Record<string, Cell | null>;
}

/** Your preflop frequencies by seat, against one answer: the charts' (solve false) or the preflop solve's. */
export function seatGrid(ds: readonly DecisionRecord[], solve: boolean): { seats: string[]; rows: GridRow[] } {
  const rs = ds.filter((d) => hasMix(d) && d.street === "preflop" && isPfSolve(d) === solve);
  const present = new Set(rs.map((d) => d.pos));
  const seats = [...SEAT_ORDER.filter((s) => present.has(s)), ...[...present].filter((s) => !SEAT_ORDER.includes(s)).sort()];
  const rows: GridRow[] = [];
  for (const [label, cls, test] of PF_FREQS) {
    const its = rs.filter(test);
    const all = cellOf(its, cls);
    // (a row neither you nor the answer ever takes says nothing)
    if (!all || (all.k === 0 && all.gto === 0)) continue;
    rows.push({ label, cls, all, bySeat: Object.fromEntries(seats.map((s) => [s, cellOf(its.filter((d) => d.pos === s), cls)])) });
  }
  return { seats, rows };
}

export interface SpotRow {
  key: string;
  n: number;
  fold: Cell | null;
  passive: Cell | null;
  aggr: Cell | null;
  /** of them graded by EV, and the EV given up per decision past the answers' noise (countedBb) */
  ev: number;
  avg: number | null;
}

/** Each spot after the flop: your fold, check or call and bet or raise against the answer's, the most decisions first. A
 * spot's kinds of action that neither of you takes get no cell. */
export function spotTable(ds: readonly DecisionRecord[]): SpotRow[] {
  const by = new Map<string, DecisionRecord[]>();
  for (const d of ds) {
    const k = hasMix(d) ? spotOf(d) : null;
    if (k) (by.get(k) ?? by.set(k, []).get(k)!).push(d);
  }
  const cell = (rs: readonly DecisionRecord[], cls: Cls) => {
    const c = cellOf(rs, cls);
    return c && (c.k > 0 || c.gto > 0) ? c : null;
  };
  return [...by]
    .map(([key, rs]) => {
      const evs = rs.filter((d) => d.evLossBb != null);
      return {
        key,
        n: rs.length,
        fold: cell(rs, "fold"),
        passive: cell(rs, "passive"),
        aggr: cell(rs, "aggr"),
        ev: evs.length,
        avg: evs.length ? Math.round((evs.reduce((t, d) => t + countedBb(d), 0) / evs.length) * 1000) / 1000 : null,
      };
    })
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
}

/** A spot's decisions, by frequency as the table reads them. */
export const spotCellTest = (key: string) => (d: DecisionRecord) => hasMix(d) && spotOf(d) === key;

/** A cell's decisions to look through, the costliest first: your misses worst first (report.ts missesOf), then the rest. */
export function cellDecisions(ds: readonly DecisionRecord[], test: (d: DecisionRecord) => boolean): DecisionRecord[] {
  const its = ds.filter(test);
  const misses = missesOf(its);
  const shown = new Set(misses.map((d) => d.id));
  return [...misses, ...its.filter((d) => !shown.has(d.id))];
}
