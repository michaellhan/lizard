// The tests a leak is read by, worked by hand.
import { describe, expect, it } from "vitest";
import { meanTest, normInv, okChance, pairTest, zBar } from "./leakStats";

describe("leakStats", () => {
  it("has the normal's quantiles", () => {
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.995)).toBeCloseTo(2.575829, 5);
    expect(normInv(1 - 1e-6)).toBeCloseTo(4.753424, 4);
    expect(normInv(0.025)).toBeCloseTo(-1.959964, 5);
    expect(normInv(0)).toBe(-Infinity);
    expect(normInv(1)).toBe(Infinity);
  });

  it("shares 5% among the tests made: one test's bar is 1.96, a hundred's 3.48", () => {
    expect(zBar(0)).toBeCloseTo(1.959964, 5);
    expect(zBar(1)).toBeCloseTo(1.959964, 5);
    expect(zBar(100)).toBeCloseTo(3.4808, 3);
    expect(zBar(1000)).toBeGreaterThan(zBar(100));
  });

  it("pairs each action with that hand's own answer, the spread no narrower than the answer's own", () => {
    // ten raises where the answer raises half: d = 0.5 each, no spread of their own, the answer's 0.25: se = sqrt(0.25/10)
    const t = pairTest(Array(10).fill(1), Array(10).fill(0.5));
    expect(t.mean).toBeCloseTo(0.5, 12);
    expect(t.se).toBeCloseTo(Math.sqrt(0.025), 12);
    expect(t.z).toBeCloseTo(0.5 / Math.sqrt(0.025), 9);
    // a pure answer, and you never take it: no spread at all, certainly off
    expect(pairTest([1, 1, 1], [0, 0, 0]).z).toBe(Infinity);
    expect(pairTest([0, 0], [1, 1]).z).toBe(-Infinity);
    // played as the answer: nothing
    expect(pairTest([1, 0], [1, 0]).z).toBe(0);
    expect(pairTest([], [])).toEqual({ n: 0, mean: 0, se: 0, z: 0 });
  });

  it("reads a mean against nothing by its own spread", () => {
    // 0, 2: mean 1, s = sqrt(2), se = 1
    expect(meanTest([0, 2])).toEqual({ n: 2, mean: 1, se: 1, z: 1 });
    expect(meanTest([0.6, 0.6]).z).toBe(Infinity);
    expect(meanTest([0, 0]).z).toBe(0);
  });

  it("says how often the answer's own mix is graded in the mix by frequency", () => {
    // (the most played, any tied with it, and anything played 10% or more: grade.ts)
    expect(okChance([0.5, 0.5])).toBe(1);
    expect(okChance([0.92, 0.05, 0.03])).toBeCloseTo(0.92, 12);
    expect(okChance([0.85, 0.1, 0.05])).toBeCloseTo(0.95, 12);
    expect(okChance([1, 0])).toBe(1);
    expect(okChance([])).toBe(1);
  });
});
