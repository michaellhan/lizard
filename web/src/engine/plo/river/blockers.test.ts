import { describe, expect, it } from "vitest";
import { seeded } from "@/poker/table";
import { parseIds } from "../cards";
import { handIndex, sortHand } from "../combos";
import { compileGame, RiverError, Terminals, type RiverGame, type RiverSpec } from "./game";
import { sharesCard } from "./blockers";
import type { PloRange } from "../ranges";

const sizes = { bets: [100], raises: [], raiseCap: 0, allIn: false };
const BOARD = parseIds("2c7d9hJsKd", 5)!;

/** `size` hands of the cards given (the whole deck by default), off the board. */
function dealRange(rnd: () => number, cards: readonly number[], size: number): PloRange {
  const left = cards.filter((c) => !BOARD.includes(c));
  const seen = new Set<number>();
  while (seen.size < size) {
    const hand = new Set<number>();
    while (hand.size < 4) hand.add(left[Math.floor(rnd() * left.length)]!);
    seen.add(handIndex(sortHand([...hand])));
  }
  const hands = Int32Array.from([...seen].sort((a, b) => a - b));
  return { hands, weights: Float32Array.from(hands, () => 0.05 + 0.95 * rnd()) };
}

const gameOf = (a: PloRange, b: PloRange): RiverGame => compileGame({ board: BOARD, ranges: [a, b], pot: 10, stacks: [50, 50], sizes } satisfies RiverSpec);

/** The sums by asking every pair. */
function pairByPair(game: RiverGame, hero: 0 | 1, reach: Float64Array) {
  const me = game.sides[hero];
  const other = game.sides[1 - hero]!;
  const meet = new Float64Array(me.n);
  const sign = new Float64Array(me.n);
  for (let i = 0; i < me.n; i++)
    for (let j = 0; j < other.n; j++) {
      if (sharesCard(me.hands[i]!, other.hands[j]!)) continue;
      meet[i]! += reach[j]!;
      sign[i]! += reach[j]! * Math.sign(me.strength[i]! - other.strength[j]!);
    }
  return { meet, sign };
}

const ALL = Array.from({ length: 52 }, (_, i) => i);
/** 22 cards, so the hands block one another far more than the whole deck's do */
const FEW = ALL.filter((c) => c >> 2 >= 7);

describe("the sum over hands that can meet", () => {
  for (const [name, cards, size] of [
    ["the whole deck", ALL, 150],
    ["few cards, heavy blocking", FEW, 150],
    ["ten cards, most of their hands", FEW.slice(0, 12), 150],
  ] as const)
    it(`inclusion-exclusion is the pair by pair count, ${name}`, () => {
      const rnd = seeded(size + cards.length);
      const game = gameOf(dealRange(rnd, cards, size), dealRange(rnd, cards, size));
      const t = new Terminals(game);
      for (const hero of [0, 1] as const) {
        const other = game.sides[1 - hero]!;
        // uneven reaches, some of them nothing: what a pass deep in the tree hands over
        const reach = Float64Array.from({ length: other.n }, () => (rnd() < 0.3 ? 0 : rnd() ** 3));
        const out = new Float64Array(game.sides[hero].n);
        const want = pairByPair(game, hero, reach);
        t.meet(hero, reach, out);
        out.forEach((x, i) => expect(x).toBeCloseTo(want.meet[i]!, 9));
        t.fold(hero, reach, 7.5, out);
        out.forEach((x, i) => expect(x).toBeCloseTo(7.5 * want.meet[i]!, 9));
        t.showdown(hero, reach, 3, out);
        out.forEach((x, i) => expect(x).toBeCloseTo(3 * want.sign[i]!, 9));
      }
    });

  it("two hands sharing two or more cards are taken off once, not twice", () => {
    const of = (t: string): PloRange => {
      const ids = t.split(",").map((h) => handIndex(sortHand(parseIds(h, 4)!)));
      return { hands: Int32Array.from(ids).sort(), weights: new Float32Array(ids.length).fill(1) };
    };
    const game = gameOf(of("AsAcKhQh"), of("AsAc3h4h,AsAcKhQh,As3s4s5s,3s4s5s6s"));
    const t = new Terminals(game);
    const out = new Float64Array(1);
    t.meet(0, new Float64Array(game.sides[1].n).fill(1), out);
    expect(game.unmatched).toEqual([0, 3]);
    expect(game.sides[1].n).toBe(1);
    expect(out[0]).toBe(1);
  });

  it("counts every matchup of the same hands the same in the game's total", () => {
    const rnd = seeded(5);
    const a = dealRange(rnd, FEW, 80);
    const b = dealRange(rnd, FEW, 80);
    const game = gameOf(a, b);
    let want = 0;
    a.hands.forEach((x, i) => b.hands.forEach((y, j) => (want += sharesCard(x, y) ? 0 : a.weights[i]! * b.weights[j]!)));
    expect(game.matchups).toBeCloseTo(want, 6);
  });

  it("refuses a pair of ranges that can't meet", () => {
    const hands = (t: string): PloRange => ({ hands: Int32Array.of(handIndex(sortHand(parseIds(t, 4)!))), weights: Float32Array.of(1) });
    expect(() => gameOf(hands("AsAcKhQh"), hands("As3c4h5h"))).toThrow(RiverError);
    expect(() => gameOf(hands("AsAcKhQh"), hands("As3c4h5h"))).toThrow(/no matchup/);
  });
});
