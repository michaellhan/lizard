// Held to scripts/engine/plo_turn_reference.py, which shares no code with this solver: it asks every pair of hands, and
// every river card, whether they share a card, solves the 48 rivers side by side as one axis of dense tensors, works
// both trees out in cents and solves by CFR+. Four checks on each of its spots:
//  - the turn's tree and each closing's river tree are the same, path for path, with the same chips;
//  - the matchups are the same;
//  - its strategy, put into this solver on the turn and on every river card, measures the same: this file's best
//    response through every river on someone else's numbers;
//  - this solver's own solve lands on the same game value, inside the bracket the reference proves.
import { describe, expect, it } from "vitest";
import { cardName, parseIds } from "../cards";
import { parseRange, rangeHands } from "../ranges";
import type { RiverTree } from "../river/tree";
import reference from "../vectors/turn.json";
import { compileTurn, type TurnGame } from "./game";
import { TurnSolver } from "./solver";

type Sizes = { bets: number[]; raises: number[]; raiseCap: number; allIn: boolean };
type TreeJson = { path: string; kind: string; bets: number[]; player?: number; tokens?: string[]; folded?: number }[];

interface Fixture {
  name: string;
  board: string;
  oop: string;
  ip: string;
  pot: number;
  stack: number;
  turnSizes: Sizes;
  riverSizes: Sizes;
  hands: [string[], string[]];
  tree: TreeJson;
  riverTrees: Record<string, TreeJson>;
  matchups: number;
  value: number;
  lower: number;
  upper: number;
  best: [number, number];
  exploitabilityPct: number;
  strategy: Record<string, number[][]>;
  riverStrategy: Record<string, Record<string, Record<string, number[][]>>>;
}

const spots = reference.spots as unknown as Fixture[];

function gameOf(f: Fixture): TurnGame {
  const board = parseIds(f.board, 4)!;
  const parsed = [f.oop, f.ip].map((t) => {
    const r = parseRange(t, board);
    if (typeof r === "string") throw new Error(r);
    return r;
  });
  return compileTurn({ board, ranges: [parsed[0]!, parsed[1]!], pot: f.pot, stacks: [f.stack, f.stack], turnSizes: f.turnSizes, riverSizes: f.riverSizes });
}

/** Cards in the order this side prints them, sorted, so two spellings of a hand match. */
const key = (h: string) => (h.match(/../g) ?? []).sort().join("");
const names = (hands: Int32Array) => rangeHands({ hands, weights: new Float32Array(hands.length) }).map(key);

const treeOf = (t: RiverTree) =>
  t.nodes
    .map((n) => ({
      path: n.path,
      kind: n.kind,
      bets: n.bets,
      ...(n.kind === "action" ? { player: n.player, tokens: n.actions.map((a) => a.token) } : {}),
      ...(n.kind === "fold" ? { folded: n.folded } : {}),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
const sorted = (t: TreeJson) => [...t].sort((a, b) => a.path.localeCompare(b.path));

describe.each(spots.map((f) => [f.name, f] as const))("%s", (_, f) => {
  const g = gameOf(f);

  it("has the same turn tree, and the same river tree at each closing with chips behind", () => {
    expect(treeOf(g.tree)).toEqual(sorted(f.tree));
    const ours = Object.fromEntries([...g.closings.values()].filter((c) => c.tree).map((c) => [g.tree.nodes[c.id]!.path, treeOf(c.tree!)]));
    expect(Object.keys(ours).sort()).toEqual(Object.keys(f.riverTrees).sort());
    for (const [path, t] of Object.entries(f.riverTrees)) expect(ours[path], path).toEqual(sorted(t));
  });

  it("has the same hands and matchups", () => {
    expect(names(g.sides[0].hands).sort()).toEqual(f.hands[0].map(key).sort());
    expect(names(g.sides[1].hands).sort()).toEqual(f.hands[1].map(key).sort());
    expect(g.matchups).toBeCloseTo(f.matchups, 5);
  });

  it("measures the reference's strategy as the reference does, through every river", () => {
    const s = new TurnSolver(g);
    const row = [0, 1].map((seat) => new Map(f.hands[seat]!.map((h, i) => [key(h), i])));
    const turnNames = [names(g.sides[0].hands), names(g.sides[1].hands)] as const;
    const fill = (stored: number[][], k: number, hand: string, seat: number) => stored[k]![row[seat]!.get(hand)!]!;
    s.setAverage((node, seat) => {
      const stored = f.strategy[node.path]!;
      const n = g.sides[seat].n;
      const out = new Float64Array(node.actions.length * n);
      node.actions.forEach((_a, k) => turnNames[seat].forEach((h, i) => (out[k * n + i] = fill(stored, k, h, seat))));
      return out;
    });
    const riverNames = new Map(g.rivers.map((r) => [r.card, [names(r.game.sides[0].hands), names(r.game.sides[1].hands)] as const]));
    s.setRiverAverage((closing, card, node, seat) => {
      const stored = f.riverStrategy[g.tree.nodes[closing]!.path]![cardName(card)]![node.path]!;
      const hands = riverNames.get(card)![seat];
      const n = hands.length;
      const out = new Float64Array(node.actions.length * n);
      node.actions.forEach((_a, k) => hands.forEach((h, i) => (out[k * n + i] = fill(stored, k, h, seat))));
      return out;
    });
    const m = s.measure();
    expect(m.best[0]).toBeCloseTo(f.best[0], 5);
    expect(m.best[1]).toBeCloseTo(f.best[1], 5);
    expect(m.value).toBeCloseTo(f.value, 5);
    expect(m.pct).toBeCloseTo(f.exploitabilityPct, 4);
  });

  it("solves to the same game value", () => {
    const s = new TurnSolver(g);
    let m = s.measure();
    while (s.iterations < 20000 && m.pct > 1e-3) {
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
  }, 60000);
});
