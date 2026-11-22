// Rake in the PLO solvers: the winner pays pct of the pot as the hand ends, up to the cap, a tie splits it, and a fold's
// pot is raked too (postflop every pot is). Checked by hand on toys, and the game stops being zero-sum, so each seat's
// value is measured on its own. The independent check, through a flop and every turn and river, is
// flop/reference.test.ts against scripts/engine/plo_flop_reference.py.
import { describe, expect, it } from "vitest";
import { parseIds } from "../cards";
import { parseRange } from "../ranges";
import { compileGame } from "./game";
import { RiverSolver } from "./solver";
import { buildTree, checkRake, rakeOn } from "./tree";
import { compileTurn } from "../turn/game";
import { TurnSolver } from "../turn/solver";

const NONE = { bets: [], raises: [], raiseCap: 0, allIn: false };
const BOARD = "2c7d9hJsKd";
const range = (text: string, board: number[]) => {
  const r = parseRange(text, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("rake", () => {
  it("is pct of the pot, up to the cap, on every terminal node", () => {
    expect(rakeOn({ pct: 5, cap: 3 }, 20)).toBe(1);
    expect(rakeOn({ pct: 5, cap: 3 }, 100)).toBe(3);
    expect(rakeOn({ pct: 5, cap: Infinity }, 100)).toBe(5);
    expect(rakeOn(undefined, 100)).toBe(0);
    const t = buildTree(20, 100, { bets: [50], raises: [], raiseCap: 0, allIn: false }, { pct: 5, cap: 3 });
    // a bet of 10 folded to: the pot of 20 raked, the bet given back; called: the pot of 40
    expect(t.nodes.find((n) => n.path === "b1000.f")).toMatchObject({ kind: "fold", rake: 1 });
    expect(t.nodes.find((n) => n.path === "b1000.c")).toMatchObject({ kind: "showdown", rake: 2 });
    expect(t.nodes.find((n) => n.path === "x.x")).toMatchObject({ kind: "showdown", rake: 1 });
    expect(checkRake({ pct: 11, cap: 3 })).toMatch(/0 to 10/);
    expect(checkRake({ pct: 5, cap: 0 })).toMatch(/cap/);
  });

  it("comes off the winner of a showdown, and a tie splits it", () => {
    const board = parseIds(BOARD, 5)!;
    // OOP's straight beats IP's aces; then two hands with the same straight
    const win = compileGame({ board, ranges: [range("QhTh4c3c", board), range("AsAc8s8c", board)], pot: 10, stacks: [50, 50], sizes: NONE, rake: { pct: 5, cap: Infinity } });
    const m = new RiverSolver(win).measure();
    expect(m.values[0]).toBeCloseTo(5 - 0.5, 12);
    expect(m.values[1]).toBeCloseTo(-5, 12);
    expect(m.pct).toBeCloseTo(0, 12);
    const tie = compileGame({ board, ranges: [range("QhTh4c3c", board), range("QsTs5c6c", board)], pot: 10, stacks: [50, 50], sizes: NONE, rake: { pct: 5, cap: 0.3 } });
    const t = new RiverSolver(tie).measure();
    expect(t.values[0]).toBeCloseTo(-0.15, 12);
    expect(t.values[1]).toBeCloseTo(-0.15, 12);
  });

  it("takes the rake out of the two seats together, and still solves", () => {
    const board = parseIds(BOARD, 5)!;
    const ranges = [range("QhTh4c3c,6s5s4h3d", board), range("AsAc8s8c", board)] as const;
    const sizes = { bets: [100], raises: [], raiseCap: 0, allIn: false };
    const solve = (rake?: { pct: number; cap: number }) => {
      const s = new RiverSolver(compileGame({ board, ranges, pot: 10, stacks: [100, 100], sizes, ...(rake ? { rake } : {}) }));
      for (let i = 0; i < 400; i++) s.iterate();
      return s.measure();
    };
    const free = solve();
    const raked = solve({ pct: 5, cap: Infinity });
    // (this polarised toy converges slowly either way: 0.10% of the pot after 400 iterations, with rake or without)
    expect(raked.pct).toBeLessThan(0.15);
    expect(raked.pct).toBeLessThan(1.5 * free.pct);
    // the rake comes out of the two seats' values together
    expect(raked.values[0] + raked.values[1]).toBeLessThan(0);
    expect(free.values[0] + free.values[1]).toBeCloseTo(0, 12);
  });

  it("is taken on a turn's every river and its all-ins", () => {
    const board = parseIds("2c7d9hJs", 4)!;
    const ranges = [range("QhTh4c3c", board), range("AsAc8s8c", board)] as const;
    const g = compileTurn({ board, ranges, pot: 10, stacks: [5, 5], turnSizes: { bets: [], raises: [], raiseCap: 0, allIn: true }, riverSizes: NONE, rake: { pct: 5, cap: Infinity } });
    // the all-in closing (5 each, a pot of 20) carries its rake of 1; checked through, the river's tree takes 0.5
    const allIn = [...g.closings.values()].find((c) => c.stack === 0)!;
    expect(allIn.rake).toBeCloseTo(1, 12);
    const through = [...g.closings.values()].find((c) => c.stack > 0)!;
    expect(through.tree!.nodes.find((n) => n.path === "x.x")).toMatchObject({ rake: 0.5 });
    const s = new TurnSolver(g);
    for (let i = 0; i < 200; i++) s.iterate();
    const m = s.measure();
    expect(m.values[0] + m.values[1]).toBeLessThan(-0.49);
    expect(m.pct).toBeLessThan(0.05);
  });
});
