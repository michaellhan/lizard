// The flop sets: the solver's representative flops card for card (the fixture is representative_flops(n) from
// solver/gto/flop_library.py, written by Python), and each flop's weight.
import { describe, expect, it } from "vitest";
import expected from "@/test/fixtures/representative_flops.json";
import { allFlopClasses, canonicalFlop, flopSet, FLOP_SET_SIZES, representativeFlops, textureShares } from "./flopSets";
import { ALL_FLOPS, FLOP_CLASSES } from "./reports";

describe("flop classes", () => {
  it("are the 1,755 classes of the 22,100 flops", () => {
    const all = allFlopClasses();
    expect(all).toHaveLength(FLOP_CLASSES);
    expect(all.reduce((s, x) => s + x.count, 0)).toBe(ALL_FLOPS);
    // (a rainbow flop of three ranks has 24 relabellings, trips 4)
    expect(all.find((x) => x.f === "Kc7d2h")?.count).toBe(24);
    expect(all.find((x) => x.f === "2h2d2c")?.count).toBe(4);
  });

  it("name a flop by its least relabelling, high card first", () => {
    // Ks 7d 2c (cards 47, 21, 0) is Kc 7d 2h: the least of its relabellings as numbers high to low
    expect(canonicalFlop([47, 21, 0])).toEqual([44, 21, 2]);
  });
});

describe("representative flops", () => {
  for (const n of FLOP_SET_SIZES)
    it(`at ${n} are the solver's set, in its order`, () => {
      expect(representativeFlops(n).map((x) => x.f)).toEqual((expected as Record<string, string[]>)[String(n)]);
    });

  it("is every class at 1,755", () => {
    expect(representativeFlops(2000)).toHaveLength(FLOP_CLASSES);
    // (and then each flop weighs its own count, as report_weights has it)
    const all = flopSet(FLOP_CLASSES);
    expect(all.reduce((s, x) => s + x.w, 0)).toBe(ALL_FLOPS);
  });

  it("weighs each flop of a set 22,100/n, its own count shown beside", () => {
    const s = flopSet(25);
    expect(s).toHaveLength(25);
    for (const x of s) expect(x.w).toBe(ALL_FLOPS / 25);
    expect(s.reduce((t, x) => t + x.w, 0)).toBeCloseTo(ALL_FLOPS, 6);
    expect(s.every((x) => x.count >= 4 && x.count <= 24)).toBe(true);
  });

  it("is close to all flops' suit shares, closer as it grows", () => {
    const off = (n: number) => Math.max(...textureShares(flopSet(n), "suits").map((r) => Math.abs(r.set - r.all)));
    const all = textureShares(flopSet(184), "suits");
    expect(all.map((r) => r.value).sort()).toEqual(["mono", "rainbow", "twotone"]);
    expect(all.reduce((t, r) => t + r.all, 0)).toBeCloseTo(1, 9);
    expect(off(184)).toBeLessThan(0.01);
    expect(off(9)).toBeLessThan(0.1);
  });
});
