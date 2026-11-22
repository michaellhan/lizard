import { describe, expect, it } from "vitest";
import { parseIds } from "./cards";
import { parseRange } from "./ranges";
import { compileFlop } from "./flop/game";
import { FlopSolver } from "./flop/solver";
import { compileTurn } from "./turn/game";
import { TurnSolver } from "./turn/solver";
import { candidatesOf, pickCards } from "./sample";

const NONE = { bets: [], raises: [], raiseCap: 0, allIn: false };
const range = (text: string, board: number[]) => {
  const r = parseRange(text, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("the card sample", () => {
  it("spreads the picks over ranks and suits, the flush suit its share", () => {
    const board = parseIds("Js9s4d", 3)!;
    const suits = (got: number[]) => [0, 1, 2, 3].map((s) => got.filter((c) => c % 4 === s).length);
    const got = pickCards(candidatesOf(board), 12);
    expect(new Set(got).size).toBe(12);
    expect(got.every((c) => !board.includes(c))).toBe(true);
    // twelve ranks, three of each suit: spades (11 of the 49 left) as many as the rest
    expect(new Set(got.map((c) => c >> 2)).size).toBe(12);
    expect(suits(got)).toEqual([3, 3, 3, 3]);
    // every rank from 16 cards on, and each suit within a card of its share
    for (const k of [16, 24]) {
      const more = pickCards(candidatesOf(board), k);
      expect(new Set(more.map((c) => c >> 2)).size).toBe(13);
      suits(more).forEach((n, s) => expect(Math.abs(n - (k * candidatesOf(board).filter((c) => c % 4 === s).length) / 49)).toBeLessThan(1));
    }
    // another phase is another sample, as spread
    const other = pickCards(candidatesOf(board), 12, 0);
    expect(other).not.toEqual(got);
    expect(suits(other)).toEqual([3, 3, 3, 3]);
    expect(pickCards(candidatesOf(board), 49)).toHaveLength(49);
  });

  it("is no sample at all on every card: the same game, the same numbers", () => {
    const board = parseIds("Js9s4d", 3)!;
    const ranges = [range("AhAdKhKd,6s5s3h2h", board), range("Tc9c8h7h,QsQhJcTd", board)] as const;
    const sizes = { bets: [100], raises: [], raiseCap: 0, allIn: false };
    const spec = { board, ranges, pot: 10, stacks: [40, 40] as const, flopSizes: sizes, turnSizes: sizes, riverSizes: NONE };
    const full = compileFlop(spec);
    const same = compileFlop({ ...spec, turnSample: 49, riverSample: 48 });
    expect(same.sample).toBeUndefined();
    expect(same.turns[0]!.cards.sample).toBeUndefined();
    const a = new FlopSolver(full);
    const b = new FlopSolver(same);
    for (let i = 0; i < 30; i++) {
      a.iterate();
      b.iterate();
    }
    expect(b.measure()).toEqual(a.measure());
  });

  it("checked down, a sampled turn is the equity over its sampled rivers, weighted to add to one", () => {
    // one hand a side, neither holding a sampled card or both holding the same number: every weight is exact
    const board = parseIds("Js9s4d2h", 4)!;
    const ranges = [range("AhAdKhKd", board), range("Tc9c8h7h", board)] as const;
    const game = compileTurn({ board, ranges, pot: 10, stacks: [40, 40], turnSizes: NONE, riverSizes: NONE, riverSample: 12 });
    expect(game.rivers.length).toBeLessThanOrEqual(12);
    expect(game.sample!.error.max).toBeLessThan(1e-12);
    const m = new TurnSolver(game).measure();
    // by hand: the equity over the sampled rivers neither hand holds, each as likely
    let share = 0;
    let n = 0;
    for (const r of game.rivers) {
      const w = r.game.sides[0].strength[0]! > r.game.sides[1].strength[0]! ? 1 : r.game.sides[0].strength[0] === r.game.sides[1].strength[0] ? 0.5 : 0;
      share += w;
      n++;
    }
    expect(m.value).toBeCloseTo(10 * (share / n) - 5, 9);
  });

  it("says how far its weights are from exact, and keeps them close", () => {
    const board = parseIds("Ts7h2h", 3)!;
    const ranges = [range("AAxx", board), range("JT98,T987", board)] as const;
    const sizes = { bets: [100], raises: [], raiseCap: 0, allIn: false };
    const game = compileFlop({ board, ranges, pot: 10, stacks: [40, 40], flopSizes: sizes, turnSizes: NONE, riverSizes: NONE, turnSample: 12, riverSample: 12 });
    expect(game.turns).toHaveLength(12);
    expect(game.sample!.error.max).toBeGreaterThan(0);
    expect(game.sample!.error.max).toBeLessThan(0.12);
    expect(game.sample!.error.mean).toBeLessThan(0.02);
    for (const t of game.turns) expect(t.cards.rivers.length).toBeLessThanOrEqual(12);
  });

  it("refuses a sample too small to leave every matchup a card", () => {
    const board = parseIds("Ts7h2h", 3)!;
    const ranges = [range("AAxx", board), range("JT98", board)] as const;
    expect(() => compileFlop({ board, ranges, pot: 10, stacks: [40, 40], flopSizes: NONE, turnSizes: NONE, riverSizes: NONE, turnSample: 8 })).toThrow(/at least 9/);
  });
});
