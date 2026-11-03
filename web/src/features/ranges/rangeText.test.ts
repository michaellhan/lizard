import { describe, expect, it } from "vitest";
import { ALL_CLASSES } from "@/engine/nlhe/cards";
import { formatRange, parseRange, rangeCombos } from "./rangeText";

describe("range text", () => {
  it("expands plus and dash shorthands", () => {
    expect(Object.keys(parseRange("22+").weights)).toHaveLength(13);
    expect(Object.keys(parseRange("TT-77").weights).sort()).toEqual(["77", "88", "99", "TT"]);
    expect(Object.keys(parseRange("A2s+").weights)).toHaveLength(12);
    expect(Object.keys(parseRange("K9s+").weights).sort()).toEqual(["K9s", "KJs", "KQs", "KTs"]);
    expect(Object.keys(parseRange("KTo-K7o").weights).sort()).toEqual(["K7o", "K8o", "K9o", "KTo"]);
    expect(Object.keys(parseRange("AK").weights).sort()).toEqual(["AKo", "AKs"]);
  });

  it("reads weights and reports what it cannot parse", () => {
    const r = parseRange("AKs:0.5, QQ, AhKh, KAs, 77:2");
    expect(r.weights).toEqual({ AKs: 0.5, QQ: 1 });
    expect(r.unknown).toEqual(["AhKh", "KAs", "77:2"]);
  });

  it("formats in grid order and round-trips", () => {
    const text = "AA,AKs,AQs:0.25,AKo,72o:0.5";
    expect(formatRange(parseRange(text).weights)).toBe(text);
  });

  it("counts weighted combos", () => {
    expect(rangeCombos(parseRange("AA,AKs,AKo").weights)).toBe(22);
    expect(rangeCombos(parseRange("AKo:0.5").weights)).toBe(6);
    expect(rangeCombos(Object.fromEntries(ALL_CLASSES.map((c) => [c, 1])))).toBe(1326);
  });
});
