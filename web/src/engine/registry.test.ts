import { describe, expect, it } from "vitest";
import { ENGINES, gameOf, gamesFor, NLHE, PLO4 } from "./registry";

describe("game registry", () => {
  it("has PLO4 solvable for heads-up postflop, with its shape grid and no preflop", () => {
    expect(PLO4.solverSupported).toBe(true);
    expect(PLO4.preflopSolved).toBe(false);
    expect(PLO4.solverScope).toMatch(/heads-up/);
    expect(PLO4.classGrid?.classOf("AsAhKsKh")).toBe("Two pair ds");
    expect(PLO4.parseHand("AsAhKsKh")).toHaveLength(4);
    expect(PLO4.parseHand("AsAh")).toBeNull();
    // every page it opens on names what it doesn't have
    for (const page of ["study", "practice", "analyze"] as const) expect(PLO4.pages[page]!.length).toBeGreaterThan(0);
    expect(PLO4.pages.study).toContain("preflop ranges and solves");
  });

  it("keeps Hold'em as it was, and reads a link's game", () => {
    expect(NLHE.classGrid?.rows).toBe(13);
    expect(NLHE.pages.study).toEqual([]);
    expect(gameOf(null)).toBe(NLHE);
    expect(gameOf("plo4")).toBe(PLO4);
    expect(gameOf("stud")).toBe(NLHE);
    expect(gameOf("toString")).toBe(NLHE);
    expect(gamesFor("study").map((g) => g.id)).toEqual(Object.keys(ENGINES));
  });
});
