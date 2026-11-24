// Your flop play by board (GTO Wizard's "GTO Reports" flop view, from your own hands): each flop frequency of the
// report's (report.ts FREQS: the c-bet, folding to and raising a c-bet, raising a bet out of position, the check-raise)
// by the flop's texture class (practice/texture.ts, the one Drills, Reports and the breakdowns use: high card, suits,
// pairing, connectedness), and the flops behind each class, against the answer's. The method is the frequency table's
// (report.ts freqs): your share of the action over the graded decisions, against the mean of the answer's own mix for
// the hand you held at each of them, so both sides are over the same hands at the same decisions. Each row has its
// count, its 95% Wilson interval and "few" under MIN_READ, and says what its answers stand on (report.ts basisOf). A
// decision with no row is counted under `left`, with why. Flops alike but for their suits are one row.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { TEXTURE_GROUPS, texture, type TextureKey } from "@/features/practice/texture";
import { basisOf, BASES, FREQS, isGraded, MIN_READ, shareOf, took, type Cls } from "./report";
import { wilson } from "./stats";

/** The report's flop frequencies (FREQS), by label. */
export const BOARD_FREQS: readonly { label: string; cls: Cls; test: (d: DecisionRecord) => boolean }[] = FREQS.filter(([label]) => label.startsWith("Flop")).map(([label, cls, test]) => ({ label, cls, test }));

export interface BoardCell {
  key: string;
  label: string;
  n: number;
  /** of them, the times you took it */
  k: number;
  you: number;
  /** your rate's 95% interval */
  range: [number, number];
  /** the mean of the answer's share of it for the hands you held */
  gto: number;
  /** under MIN_READ: too wide to read */
  few: boolean;
  /** what the answers stand on, the most solid first */
  bases: { basis: string; n: number }[];
}

export interface BoardClass extends BoardCell {
  flops: BoardCell[];
}

export interface BoardGroup {
  key: TextureKey;
  label: string;
  classes: BoardClass[];
}

export interface BoardView {
  freq: string;
  /** every decision of the frequency with a flop, together */
  all: BoardCell | null;
  groups: BoardGroup[];
  /** the frequency's graded decisions with no row, by why */
  left: { why: string; n: number }[];
}

export type Seat = "ip" | "oop";
export interface BoardFilter {
  /** the pot type (the decision's, else its hand's) */
  pot?: string | null;
  /** in or out of position */
  seat?: Seat | null;
}

const SUITS = "shdc";
const RANKS = "23456789TJQKA";
const PERMS: readonly number[][] = (() => {
  const out: number[][] = [];
  const go = (rest: number[], acc: number[]) => (rest.length ? rest.forEach((c, i) => go([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, c])) : out.push(acc));
  go([0, 1, 2, 3], []);
  return out;
})();

/** A flop as its class up to suits: its cards high to low, the suits relabelled so the first card is a spade and each
 * new suit after it the next of hearts, diamonds, clubs (the least of the 24 relabellings). "7d2cKs" -> "Ks7h2d". */
export function flopClass(f: string): string {
  const cs = [f.slice(0, 2), f.slice(2, 4), f.slice(4, 6)].map((c) => [RANKS.indexOf(c[0]!), SUITS.indexOf(c[1]!)] as const);
  let best: [number, number][] | null = null;
  // (every relabelling's cards sort to the same ranks, so the least is the least run of suits)
  const less = (a: readonly [number, number][], b: readonly [number, number][]) => {
    const i = a.findIndex((x, j) => x[1] !== b[j]![1]);
    return i >= 0 && a[i]![1] < b[i]![1];
  };
  for (const p of PERMS) {
    const t = cs.map(([r, s]) => [r, p[s]!] as [number, number]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    if (!best || less(t, best)) best = t;
  }
  return best!.map(([r, s]) => RANKS[r]! + SUITS[s]!).join("");
}

const WHY = {
  board: "its hand keeps no flop",
  pot: "kept without a pot type, its hand has none either",
  seat: "kept without whether you were in position",
};

function cell(key: string, label: string, ds: readonly DecisionRecord[], cls: Cls): BoardCell {
  let [k, gto] = [0, 0];
  const bases = new Map<string, number>();
  for (const d of ds) {
    k += Number(took(d.action, cls));
    gto += shareOf(d, cls);
    const b = basisOf(d);
    bases.set(b, (bases.get(b) ?? 0) + 1);
  }
  const n = ds.length;
  return {
    key,
    label,
    n,
    k,
    you: n ? k / n : 0,
    range: wilson(k, n),
    gto: n ? gto / n : 0,
    few: n < MIN_READ,
    bases: BASES.flatMap((basis) => {
      const m = bases.get(basis);
      return m ? [{ basis, n: m }] : [];
    }),
  };
}

/** A decision's flop, or null where its hand keeps none. */
export const flopOf = (d: DecisionRecord, byId: ReadonlyMap<string, HandRecord>): string | null => {
  const f = byId.get(d.handId)?.board.slice(0, 6) ?? "";
  return f.length === 6 ? f : null;
};

/** The frequency's graded decisions that fit the filter, each with its flop, and those left out with why. */
export function boardDecisions(ds: readonly DecisionRecord[], byId: ReadonlyMap<string, HandRecord>, freq: string, filter: BoardFilter = {}) {
  const f = BOARD_FREQS.find((x) => x.label === freq);
  const kept: { d: DecisionRecord; flop: string }[] = [];
  const left = new Map<string, number>();
  if (!f) return { kept, left: [] as { why: string; n: number }[] };
  for (const d of ds) {
    if (!isGraded(d) || !d.mix || !f.test(d)) continue;
    if (filter.pot) {
      const pot = d.potType ?? byId.get(d.handId)?.potType;
      if (!pot) {
        left.set(WHY.pot, (left.get(WHY.pot) ?? 0) + 1);
        continue;
      }
      if (pot !== filter.pot) continue;
    }
    if (filter.seat) {
      if (d.ip === undefined) {
        left.set(WHY.seat, (left.get(WHY.seat) ?? 0) + 1);
        continue;
      }
      if (d.ip !== (filter.seat === "ip")) continue;
    }
    const flop = flopOf(d, byId);
    if (!flop) {
      left.set(WHY.board, (left.get(WHY.board) ?? 0) + 1);
      continue;
    }
    kept.push({ d, flop });
  }
  return { kept, left: [...left].map(([why, n]) => ({ why, n })).sort((a, b) => b.n - a.n) };
}

/** A texture class's key, as its group and value ("suits:mono"). */
export const classKey = (g: TextureKey, v: string) => `${g}:${v}`;

export function boardView(ds: readonly DecisionRecord[], byId: ReadonlyMap<string, HandRecord>, freq: string, filter: BoardFilter = {}): BoardView {
  const f = BOARD_FREQS.find((x) => x.label === freq);
  const { kept, left } = boardDecisions(ds, byId, freq, filter);
  if (!f || !kept.length) return { freq, all: null, groups: [], left };
  const tex = new Map(kept.map((x) => [x.d, texture(x.flop)]));
  const groups = TEXTURE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    classes: Object.entries(g.values).flatMap(([v, label]) => {
      const in_ = kept.filter((x) => tex.get(x.d)![g.key] === v);
      if (!in_.length) return [];
      const byFlop = new Map<string, { label: string; ds: DecisionRecord[] }>();
      for (const x of in_) {
        const c = flopClass(x.flop);
        const e = byFlop.get(c) ?? { label: c, ds: [] };
        e.ds.push(x.d);
        byFlop.set(c, e);
      }
      const flops = [...byFlop]
        .map(([c, e]) => cell(c, e.label, e.ds, f.cls))
        // (the most played first, then high card down)
        .sort((a, b) => b.n - a.n || RANKS.indexOf(b.key[0]!) - RANKS.indexOf(a.key[0]!) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return [{ ...cell(classKey(g.key, v), label, in_.map((x) => x.d), f.cls), flops }];
    }),
  }));
  return { freq, all: cell("all", "Every flop", kept.map((x) => x.d), f.cls), groups, left };
}

/** The test for a row's decisions: a class's key ("hi:A"), a flop class ("Ks7h2d"), or "all". */
export function boardTest(byId: ReadonlyMap<string, HandRecord>, key: string): (d: DecisionRecord) => boolean {
  if (key === "all") return () => true;
  const at = key.indexOf(":");
  if (at > 0) {
    const [g, v] = [key.slice(0, at) as TextureKey, key.slice(at + 1)];
    return (d) => {
      const flop = flopOf(d, byId);
      return !!flop && texture(flop)[g] === v;
    };
  }
  return (d) => {
    const flop = flopOf(d, byId);
    return !!flop && flopClass(flop) === key;
  };
}
