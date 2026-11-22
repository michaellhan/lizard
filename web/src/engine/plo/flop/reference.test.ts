// Held to scripts/engine/plo_flop_reference.py, which shares no code with this solver: it asks every pair of hands, and
// every turn and river card, whether they share a card, solves the turn cards and each turn's rivers side by side as two
// axes of dense tensors, folds the chance weights (a card sample's too) and the rake into two payoff tensors per terminal
// node, works the three trees out in cents and solves by CFR+. Four checks on each of its spots:
//  - the flop's tree, each closing's turn tree and each turn closing's river tree are the same, path for path;
//  - the hands, the matchups and the turn and river cards (a sample's) are the same;
//  - its strategy, put into this solver on the flop, every turn card and every river card, measures the same: this
//    file's best responses and each seat's value, rake and sample included, on someone else's numbers;
//  - this solver's own solve gets as close to equilibrium, and (with no rake, where the game has one value) lands inside
//    the reference's bracket.
import { describe, expect, it } from "vitest";
import { cardName, parseIds } from "../cards";
import { parseRange, rangeHands } from "../ranges";
import type { Rake, RiverTree } from "../river/tree";
import reference from "../vectors/flop.json";
import { compileFlop, type FlopGame } from "./game";
import { FlopSolver } from "./solver";

type Sizes = { bets: number[]; raises: number[]; raiseCap: number; allIn: boolean };
type TreeJson = { path: string; kind: string; bets: number[]; player?: number; tokens?: string[]; folded?: number }[];

interface Fixture {
  name: string;
  board: string;
  oop: string;
  ip: string;
  pot: number;
  stack: number;
  flopSizes: Sizes;
  turnSizes: Sizes;
  riverSizes: Sizes;
  rake?: Rake;
  turnSample?: number;
  riverSample?: number;
  hands: [string[], string[]];
  turnCards: string[];
  riverCards: Record<string, string[]>;
  tree: TreeJson;
  turnTrees: Record<string, TreeJson>;
  riverTrees: Record<string, TreeJson>;
  matchups: number;
  value: number;
  values: [number, number];
  lower: number;
  upper: number;
  best: [number, number];
  exploitabilityPct: number;
  strategy: Record<string, number[][]>;
  turnStrategy: Record<string, Record<string, Record<string, number[][]>>>;
  riverStrategy: Record<string, Record<string, Record<string, Record<string, number[][]>>>>;
  turnWeightError?: { max: number; mean: number };
}

const spots = reference.spots as unknown as Fixture[];

function gameOf(f: Fixture): FlopGame {
  const board = parseIds(f.board, 3)!;
  const parsed = [f.oop, f.ip].map((t) => {
    const r = parseRange(t, board);
    if (typeof r === "string") throw new Error(r);
    return r;
  });
  return compileFlop({
    board,
    ranges: [parsed[0]!, parsed[1]!],
    pot: f.pot,
    stacks: [f.stack, f.stack],
    flopSizes: f.flopSizes,
    turnSizes: f.turnSizes,
    riverSizes: f.riverSizes,
    ...(f.rake ? { rake: f.rake } : {}),
    ...(f.turnSample !== undefined ? { turnSample: f.turnSample } : {}),
    ...(f.riverSample !== undefined ? { riverSample: f.riverSample } : {}),
  });
}

/** Cards in the order this side prints them, sorted, so two spellings of a hand match. */
const key = (h: string) => (h.match(/../g) ?? []).sort().join("");
const names = (hands: Int32Array) => rangeHands({ hands, weights: new Float32Array(hands.length) }).map(key);
const cardKey = (c: string) => cardName(parseIds(c, 1)![0]!);

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

  it("has the same flop tree, turn trees and river trees", () => {
    expect(treeOf(g.tree)).toEqual(sorted(f.tree));
    const turnTrees = Object.fromEntries([...g.closings.values()].filter((c) => c.tree).map((c) => [g.tree.nodes[c.id]!.path, treeOf(c.tree!)]));
    expect(Object.keys(turnTrees).sort()).toEqual(Object.keys(f.turnTrees).sort());
    for (const [path, t] of Object.entries(f.turnTrees)) expect(turnTrees[path], path).toEqual(sorted(t));
    const riverTrees: Record<string, unknown> = {};
    for (const c of g.closings.values())
      for (const tc of c.turnClosings?.values() ?? []) if (tc.tree) riverTrees[`${g.tree.nodes[c.id]!.path}|${c.tree!.nodes[tc.id]!.path}`] = treeOf(tc.tree);
    expect(Object.keys(riverTrees).sort()).toEqual(Object.keys(f.riverTrees).sort());
    for (const [path, t] of Object.entries(f.riverTrees)) expect(riverTrees[path], path).toEqual(sorted(t));
  });

  it("has the same hands, matchups and cards", () => {
    expect(names(g.sides[0].hands).sort()).toEqual(f.hands[0].map(key).sort());
    expect(names(g.sides[1].hands).sort()).toEqual(f.hands[1].map(key).sort());
    expect(g.matchups).toBeCloseTo(f.matchups, 5);
    // (a card with no game is left out here; none of these spots has one)
    expect(g.turns.map((t) => cardName(t.card)).sort()).toEqual(f.turnCards.map(cardKey).sort());
    for (const t of g.turns) expect(t.cards.rivers.map((r) => cardName(r.card)).sort(), cardName(t.card)).toEqual(f.riverCards[cardName(t.card)]!.map(cardKey).sort());
    if (f.turnWeightError) {
      expect(g.sample!.error.max).toBeCloseTo(f.turnWeightError.max, 9);
      expect(g.sample!.error.mean).toBeCloseTo(f.turnWeightError.mean, 9);
    }
  });

  it("measures the reference's strategy as the reference does, through every turn and river", () => {
    const s = new FlopSolver(g);
    const row = [0, 1].map((seat) => new Map(f.hands[seat]!.map((h, i) => [key(h), i])));
    const fill = (stored: number[][], k: number, hand: string, seat: number) => stored[k]![row[seat]!.get(hand)!]!;
    // (the reference leaves out a node with one action: its strategy is that action)
    const put = (stored: number[][] | undefined, hands: string[], actions: number, seat: number) => {
      const n = hands.length;
      const out = new Float64Array(actions * n);
      if (!stored) {
        if (actions !== 1) throw new Error("a strategy missing");
        return out.fill(1);
      }
      for (let k = 0; k < actions; k++) hands.forEach((h, i) => (out[k * n + i] = fill(stored, k, h, seat)));
      return out;
    };
    const flopNames = [names(g.sides[0].hands), names(g.sides[1].hands)];
    s.setAverage((node, seat) => put(f.strategy[node.path], flopNames[seat]!, node.actions.length, seat));
    const turnNames = new Map<number, string[][]>();
    for (const t of g.turns) turnNames.set(t.card, [names(t.cards.sides[0].hands), names(t.cards.sides[1].hands)]);
    const riverNames = new Map<string, string[][]>();
    for (const t of g.turns)
      for (const r of t.cards.rivers) riverNames.set(`${t.card}:${r.card}`, [names(r.game.sides[0].hands), names(r.game.sides[1].hands)]);
    s.setTurnAverage((closing, card, node, seat) => put(f.turnStrategy[g.tree.nodes[closing]!.path]?.[cardName(card)]?.[node.path], turnNames.get(card)![seat]!, node.actions.length, seat));
    s.setRiverAverage((closing, turn, turnClosing, river, node, seat) => {
      const c = g.closings.get(closing)!;
      const k = `${g.tree.nodes[closing]!.path}|${c.tree!.nodes[turnClosing]!.path}`;
      return put(f.riverStrategy[k]?.[cardName(turn)]?.[cardName(river)]?.[node.path], riverNames.get(`${turn}:${river}`)![seat]!, node.actions.length, seat);
    });
    const m = s.measure();
    expect(m.best[0]).toBeCloseTo(f.best[0], 5);
    expect(m.best[1]).toBeCloseTo(f.best[1], 5);
    expect(m.values[0]).toBeCloseTo(f.values[0], 5);
    expect(m.values[1]).toBeCloseTo(f.values[1], 5);
    expect(m.pct).toBeCloseTo(f.exploitabilityPct, 4);
  });

  it("solves as close to equilibrium, and to the same value where there's one", () => {
    const s = new FlopSolver(g);
    let m = s.measure();
    while (s.iterations < 5000 && m.pct > 1e-3) {
      for (let i = 0; i < 20; i++) s.iterate();
      m = s.measure();
    }
    expect(m.pct).toBeLessThanOrEqual(1e-3);
    if (f.rake) return;
    const lower = -m.best[1];
    const upper = m.best[0];
    expect(lower).toBeLessThanOrEqual(f.upper + 1e-6);
    expect(f.lower).toBeLessThanOrEqual(upper + 1e-6);
    expect(Math.abs(m.value - f.value)).toBeLessThanOrEqual(upper - lower + (f.upper - f.lower) + 1e-6);
  }, 120000);
});
