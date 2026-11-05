// Held to scripts/engine/plo_river_reference.py, which shares no code with this solver: it asks every pair of hands whether
// they share a card, works the tree out in cents and solves by CFR+ on dense matrices. Three checks on each of its spots:
//  - the tree is the same, path for path, with the same chips;
//  - its strategy, put into this solver, measures the same: this file's best response on someone else's numbers;
//  - this solver's own solve lands on the same game value, inside the bracket the reference proves.
import { describe, expect, it } from "vitest";
import { parseIds } from "../cards";
import { parseRange, rangeHands } from "../ranges";
import reference from "../vectors/river.json";
import { compileGame, type RiverGame } from "./game";
import { RiverSolver } from "./solver";

interface Fixture {
  name: string;
  board: string;
  oop: string;
  ip: string;
  pot: number;
  stack: number;
  bets: number[];
  raises: number[];
  raiseCap: number;
  allIn: boolean;
  hands: [string[], string[]];
  tree: { path: string; kind: string; bets: number[]; player?: number; tokens?: string[]; folded?: number }[];
  matchups: number;
  value: number;
  lower: number;
  upper: number;
  best: [number, number];
  exploitabilityPct: number;
  strategy: Record<string, number[][]>;
}

const spots = reference.spots as unknown as Fixture[];

function gameOf(f: Fixture): RiverGame {
  const board = parseIds(f.board, 5)!;
  const parsed = [f.oop, f.ip].map((t) => {
    const r = parseRange(t, board);
    if (typeof r === "string") throw new Error(r);
    return r;
  });
  return compileGame({ board, ranges: [parsed[0]!, parsed[1]!], pot: f.pot, stacks: [f.stack, f.stack], sizes: { bets: f.bets, raises: f.raises, raiseCap: f.raiseCap, allIn: f.allIn } });
}

/** Cards in the order this side prints them, sorted, so two spellings of a hand match. */
const key = (h: string) => (h.match(/../g) ?? []).sort().join("");

describe.each(spots.map((f) => [f.name, f] as const))("%s", (_, f) => {
  const g = gameOf(f);
  // the combos the game holds, read back through the ranges' own text form
  const named = (seat: 0 | 1) => rangeHands({ hands: g.sides[seat].hands, weights: new Float32Array(g.sides[seat].n) }).map(key);

  it("has the same tree", () => {
    const ours = g.tree.nodes.map((n) => ({
      path: n.path,
      kind: n.kind,
      bets: n.bets,
      ...(n.kind === "action" ? { player: n.player, tokens: n.actions.map((a) => a.token) } : {}),
      ...(n.kind === "fold" ? { folded: n.folded } : {}),
    }));
    const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
    expect([...ours].sort(byPath)).toEqual([...f.tree].sort(byPath));
  });

  it("has the same matchups", () => {
    expect(g.matchups).toBeCloseTo(f.matchups, 5);
  });

  it("measures the reference's strategy as the reference does", () => {
    const s = new RiverSolver(g);
    const row = [0, 1].map((seat) => new Map(f.hands[seat]!.map((h, i) => [key(h), i])));
    const names = [named(0), named(1)] as const;
    s.setAverage((node, seat) => {
      const stored = f.strategy[node.path]!;
      const n = g.sides[seat].n;
      const out = new Float64Array(node.actions.length * n);
      node.actions.forEach((_a, k) => names[seat].forEach((h, i) => (out[k * n + i] = stored[k]![row[seat]!.get(h)!]!)));
      return out;
    });
    const m = s.measure();
    expect(m.best[0]).toBeCloseTo(f.best[0], 5);
    expect(m.best[1]).toBeCloseTo(f.best[1], 5);
    expect(m.value).toBeCloseTo(f.value, 5);
    expect(m.pct).toBeCloseTo(f.exploitabilityPct, 4);
  });

  it("solves to the same game value", () => {
    const s = new RiverSolver(g);
    let m = s.measure();
    while (s.iterations < 60000 && m.pct > 1e-3) {
      for (let i = 0; i < 20; i++) s.iterate();
      m = s.measure();
    }
    expect(m.pct).toBeLessThanOrEqual(1e-3);
    // each solve proves a bracket for the one game value: they have to overlap, and this one's point has to sit in the
    // reference's, give or take this solve's own width
    const lower = -m.best[1];
    const upper = m.best[0];
    expect(lower).toBeLessThanOrEqual(f.upper + 1e-6);
    expect(f.lower).toBeLessThanOrEqual(upper + 1e-6);
    expect(Math.abs(m.value - f.value)).toBeLessThanOrEqual(upper - lower + (f.upper - f.lower) + 1e-6);
  });
});
