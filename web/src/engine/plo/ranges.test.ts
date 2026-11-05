import { describe, expect, it } from "vitest";
import { parseIds } from "./cards";
import { canonicalise, classTable, handAt, handIndex, NUM_CLASSES, NUM_HANDS, sortHand } from "./combos";
import { classIdOf, fromClassWeights, parseRange, rangeHands, rangeSize, rangeWeight, toClassWeights, withoutBlocked, type PloRange } from "./ranges";

const r = (text: string, dead: number[] = []): PloRange => {
  const x = parseRange(text, dead);
  if (typeof x === "string") throw new Error(x);
  return x;
};

describe("parseRange", () => {
  it("reads a hand", () => {
    expect(rangeHands(r("AsKsQhJh")).map((h) => [...h.match(/../g)!].sort().join(""))).toEqual(["AsJhKsQh"]);
    expect(rangeWeight(r("AsKsQhJh@50"))).toBeCloseTo(0.5);
  });

  it("counts patterns by hand: combinations that can be worked out on paper", () => {
    expect(rangeSize(r("random"))).toBe(NUM_HANDS);
    expect(rangeSize(r("xxxx"))).toBe(NUM_HANDS);
    // at least two aces: C(4,2)C(48,2) + C(4,3)C(48,1) + 1
    expect(rangeSize(r("AAxx"))).toBe(6 * 1128 + 4 * 48 + 1);
    expect(rangeSize(r("AAAA"))).toBe(1);
    expect(rangeSize(r("AAKK"))).toBe(36); // 6 x 6
    expect(rangeSize(r("AKQJ"))).toBe(256); // 4^4
    // JT98 double-suited: choose the two suits (ordered by which pair of ranks takes which, 4x3) for each of three
    // ways to pair the four ranks up
    expect(rangeSize(r("JT98ds"))).toBe(3 * 4 * 3);
    // rainbow: 4! ways to give the four ranks the four suits
    expect(rangeSize(r("JT98r"))).toBe(24);
    // single-suited: 6 pairs of ranks share one of 4 suits, the other two take 3 x 2 of the others
    expect(rangeSize(r("JT98ss"))).toBe(6 * 4 * 3 * 2);
    // aces double-suited: As Ah, with the kings' suits the same two: C(4,2)
    expect(rangeSize(r("AAKKds"))).toBe(6);
    // the shapes of four ranks: those three, then three of a suit (4 x 4 x 3 x 1) and all four (4) make up the 4^4
    expect(24 + 144 + 36 + 48 + 4).toBe(rangeSize(r("JT98")));
  });

  it("takes the highest weight for a hand named twice", () => {
    const x = r("AAKK@50, AsAhKsKh@75, AAKK@25");
    expect(rangeSize(x)).toBe(36);
    expect(rangeWeight(x)).toBeCloseTo(35 * 0.5 + 0.75, 5);
  });

  it("leaves out dead cards' hands", () => {
    expect(rangeSize(r("AAxx", parseIds("AsAh")!))).toBe(1128); // the other two aces, and any two of the 48 cards left
    const left = withoutBlocked(r("AKQJ"), parseIds("As")!);
    expect(rangeSize(left)).toBe(3 * 4 * 4 * 4);
  });

  it("says what it can't read", () => {
    expect(parseRange("")).toMatch(/Enter/);
    expect(parseRange("AAK")).toMatch(/isn't a hand/);
    expect(parseRange("AsAs2c3d")).toMatch(/isn't a hand/);
    expect(parseRange("AAxx@0")).toMatch(/weight/);
    expect(parseRange("AAxx@120")).toMatch(/weight/);
    expect(parseRange("AAxx@5@5")).toMatch(/weight/);
  });
});

describe("the class form", () => {
  it("round-trips a range whose weights ignore suits", () => {
    const x = r("AAKK, JT98ds@40");
    const w = toClassWeights(x)!;
    expect(w.length).toBe(NUM_CLASSES);
    const back = fromClassWeights(w);
    expect(back.hands).toEqual(x.hands);
    expect(back.weights).toEqual(x.weights);
  });

  it("is refused where suits matter: a hand on its own, or two weights in a class", () => {
    expect(toClassWeights(r("AsAhKsKh"))).toBeNull();
    expect(toClassWeights(r("AAKK, AsAhKsKh@50"))).not.toBeNull(); // (the highest wins, so it's still one weight)
    expect(toClassWeights(r("AAKK@50, AsAhKsKh"))).toBeNull();
  });

  it("gives a hand's class by its cards, the same for every relabelling", () => {
    const a = classIdOf(parseIds("AsKsQhJh", 4)!);
    expect(classIdOf(parseIds("AdKdQcJc", 4)!)).toBe(a);
    expect(classIdOf(parseIds("AsKhQhJs", 4)!)).not.toBe(a);
    const t = classTable();
    expect(handIndex(canonicalise(handAt(t.canonical[a]!)).hand)).toBe(t.canonical[a]);
    expect(t.classOf[handIndex(sortHand(parseIds("AsKsQhJh", 4)!))]).toBe(a);
  });
});
