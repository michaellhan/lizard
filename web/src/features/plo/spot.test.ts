import { describe, expect, it } from "vitest";
import { PLO_PRESETS } from "./presets";
import { DEFAULT_SPOT, readSizes, requestOf, spotFromParams, spotToParams } from "./spot";

describe("a PLO spot in a link", () => {
  it("goes to a query and back as it was, every preset too", () => {
    for (const s of [DEFAULT_SPOT, ...PLO_PRESETS.map((p) => p.spot)]) {
      const back = spotFromParams(spotToParams(s))!;
      expect(spotToParams(back).toString()).toBe(spotToParams(s).toString());
      expect(back.board).toBe(s.board);
      expect(back.sizes).toEqual({ ...s.sizes, bets: s.sizes.bets.replace(/,\s*/g, ", "), raises: s.sizes.raises.replace(/,\s*/g, ", ") });
    }
    // a river carries no later street's sizes; a flop carries both
    expect(spotToParams(DEFAULT_SPOT).has("rbets")).toBe(false);
    const flop = spotToParams({ ...DEFAULT_SPOT, board: "Js9s4d" });
    expect(flop.get("tbets")).toBe("75");
    expect(flop.get("rbets")).toBe("75");
    expect(spotFromParams(new URLSearchParams("game=plo4"))).toBeNull();
  });

  it("makes the solve request, or says what's wrong with the sizes", () => {
    const r = requestOf({ ...DEFAULT_SPOT, board: "Js9s4d2h" }, { targetPct: 0.1, seconds: 30 });
    expect(typeof r).toBe("object");
    if (typeof r === "string") return;
    expect(r.sizes).toEqual({ bets: [50, 100], raises: [100], raiseCap: 2, allIn: true });
    expect(r.riverSizes).toEqual({ bets: [75], raises: [], raiseCap: 0, allIn: true });
    expect(r.turnSizes).toBeUndefined();
    expect(requestOf({ ...DEFAULT_SPOT, sizes: { ...DEFAULT_SPOT.sizes, bets: "fifty" } }, { targetPct: 0.1, seconds: 30 })).toMatch(/percents/);
    expect(readSizes("50%, 75")).toEqual([50, 75]);
    expect(readSizes("")).toEqual([]);
  });
});
