import { describe, expect, it } from "vitest";
import { ALL_CLASSES, expandClass } from "@/engine/nlhe/cards";
import { comboName, formatRange, parseRange, rangeCombos } from "./rangeText";

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
    const r = parseRange("AKs:0.5, QQ, KAs:0.25, 77:2, AhAh, AKs:0.5:1, XYZ");
    // a hand named twice keeps its larger weight, as the solver's parser does
    expect(r.weights).toEqual({ AKs: 0.5, QQ: 1 });
    expect(r.unknown).toEqual(["77:2", "AhAh", "AKs:0.5:1", "XYZ"]);
    expect(r.combos).toEqual([]);
  });

  it("reads the solver's syntax: spaces between hands, any case, either rank order, gap runs, random", () => {
    expect(parseRange("aa kqs\nAJo : 0.5").weights).toEqual({ AA: 1, KQs: 1, AJo: 0.5 });
    expect(Object.keys(parseRange("ka").weights).sort()).toEqual(["AKo", "AKs"]);
    expect(Object.keys(parseRange("T9s-65s").weights)).toEqual(["T9s", "98s", "87s", "76s", "65s"]);
    expect(Object.keys(parseRange("65s-T9s").weights)).toHaveLength(5);
    expect(Object.keys(parseRange("J9o-64o").weights)).toEqual(["J9o", "T8o", "97o", "86o", "75o", "64o"]);
    expect(Object.keys(parseRange("AT-A8").weights).sort()).toEqual(["A8o", "A8s", "A9o", "A9s", "ATo", "ATs"]);
    expect(parseRange("KTo-K7s").unknown).toEqual(["KTo-K7s"]);
    expect(parseRange("T9s-64s").unknown).toEqual(["T9s-64s"]);
    expect(Object.keys(parseRange("random").weights)).toHaveLength(169);
    expect(rangeCombos(parseRange("any").weights)).toBe(1326);
  });

  it("reads a single combo as its share of the class, beside the class's own weight", () => {
    const r = parseRange("AhKh, KdAd, ahkh:0.5, 7c7d:0.5, AKs:0.5, QhJc");
    expect(r.combos).toEqual(["AhKh", "KdAd", "ahkh", "7c7d", "QhJc"]);
    expect(r.unknown).toEqual([]);
    // AKs: two of four combos at 1, the other two at the class's 0.5
    expect(r.weights.AKs).toBeCloseTo(0.75);
    expect(r.weights["77"]).toBeCloseTo(0.5 / 6);
    expect(r.weights.QJo).toBeCloseTo(1 / 12);
    expect(rangeCombos(parseRange("AhKh,AsKs,AdKd,AcKc").weights)).toBe(4);
    expect(formatRange(parseRange("AhKh").weights)).toBe("AKs:0.25");
  });

  it("names combos one way, whichever way round they're typed, and gives them apart from the classes", () => {
    expect(["KhAh", "AhAs", "2c7d", "acad"].map(comboName)).toEqual(["AhKh", "AsAh", "7d2c", "AdAc"]);
    for (const cls of ALL_CLASSES) for (const c of expandClass(cls)) expect(comboName(c)).toBe(c);
    const r = parseRange("KhAh:0.25, AKs:0.5, QQ, ahkh:0.75");
    expect(r.classWeights).toEqual({ AKs: 0.5, QQ: 1 });
    expect(r.comboWeights).toEqual({ AhKh: 0.75 });
  });

  it("writes single combos after their class, and the larger weight wins on reading, as in the solver's parser", () => {
    expect(formatRange({ AKs: 0.25, QQ: 1 }, { AhKh: 0.5, AdKd: 1, AcKc: 0, "7d2c": 0.125 })).toBe("AKs:0.25,AdKd,AhKh:0.5,QQ,7d2c:0.125");
    expect(formatRange({ AA: 1 })).toBe("AA");
    const r = parseRange("AKs:0.25,AdKd,AhKh:0.5");
    expect(r.classWeights).toEqual({ AKs: 0.25 });
    expect(r.comboWeights).toEqual({ AdKd: 1, AhKh: 0.5 });
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

describe("a weight left empty", () => {
  it("is a mistake, as in the engine, and not a weight of 0", () => {
    const r = parseRange("AKs:, QQ");
    expect(r.unknown).toEqual(["AKs:"]);
    expect(parseRange("AKs:").unknown).toEqual(["AKs:"]);
  });
});
