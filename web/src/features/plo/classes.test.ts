import { describe, expect, it } from "vitest";
import { parseIds } from "@/engine/plo/cards";
import { handIndex, sortHand } from "@/engine/plo/combos";
import { byClass, classOf } from "./classes";

const ids = (t: string) => parseIds(t)!;
const index = (t: string) => handIndex(sortHand(ids(t)));

describe("classOf", () => {
  it("names the best hand two from the hand and three from the board", () => {
    const river = ids("2c7d9hJsKd");
    expect(classOf(ids("QhTh4c3c"), river).name).toBe("Straight");
    expect(classOf(ids("AsAc8s8c"), river).name).toBe("One pair");
    expect(classOf(ids("6s5s4h3d"), river).name).toBe("High card");
    // four of a suit in the hand and one on the board is no flush: exactly two from the hand
    expect(classOf(ids("AsKsQs3s"), ids("2s7d9hJcKd")).name).toBe("One pair");
  });

  it("adds a flush draw on a turn, two of a suit in the hand beside two on the board, and not on a river", () => {
    const turn = ids("Th8h3c2d");
    expect(classOf(ids("AhKh5c5d"), turn).name).toBe("One pair, flush draw");
    expect(classOf(ids("AsKs5c5d"), turn).name).toBe("One pair");
    expect(classOf(ids("AhKh5c5d"), ids("Th8h3c2dQs")).name).toBe("One pair");
    expect(classOf(ids("AhKh5c5d"), turn).order).toBeGreaterThan(classOf(ids("AsKs5c5d"), turn).order);
  });
});

describe("byClass", () => {
  it("weighs each class's mix and EV by its combos' weight, strongest class first, skipping combos not reaching", () => {
    const hands = Int32Array.from([index("6s5s4h3d"), index("6d5d4s3h"), index("QhTh4c3c"), index("AsAc8s8c")]);
    // two actions: check, bet. strategy is action * n + combo
    const strategy = Float32Array.from([1, 0.5, 0, 0.3, /* bet */ 0, 0.5, 1, 0.7]);
    const node = { actions: ["x", "b"], strategy, weight: Float32Array.from([1, 3, 2, 0]), ev: Float32Array.from([0, 4, 10, NaN]) };
    const rows = byClass(hands, ids("2c7d9hJsKd"), node);
    expect(rows.map((r) => r.name)).toEqual(["Straight", "High card"]);
    expect(rows[0]).toEqual({ name: "Straight", combos: 1, share: 2 / 6, frequency: [0, 1], ev: 10 });
    expect(rows[1]!.combos).toBe(2);
    expect(rows[1]!.share).toBeCloseTo(4 / 6);
    expect(rows[1]!.frequency[0]).toBeCloseTo((1 * 1 + 3 * 0.5) / 4);
    expect(rows[1]!.frequency[1]).toBeCloseTo((3 * 0.5) / 4);
    expect(rows[1]!.ev).toBeCloseTo((1 * 0 + 3 * 4) / 4);
  });

  it("leaves a class's EV out where none of its combos can meet a hand", () => {
    const hands = Int32Array.from([index("AsAc8s8c")]);
    const rows = byClass(hands, ids("2c7d9hJsKd"), { actions: ["x"], strategy: Float32Array.from([1]), weight: Float32Array.from([1]), ev: Float32Array.from([NaN]) });
    expect(rows).toEqual([{ name: "One pair", combos: 1, share: 1, frequency: [1], ev: null }]);
  });
});
