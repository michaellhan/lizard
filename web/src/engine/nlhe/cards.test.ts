import { describe, expect, it } from "vitest";
import { ALL_CLASSES, classCombos, classLabel, classOf, classPosition, expandClass, parseCards } from "./cards";

describe("hand classes", () => {
  it("lays out the grid as the upstream page: pairs on the diagonal, suited above, offsuit below", () => {
    expect(classLabel(0, 0)).toBe("AA");
    expect(classLabel(0, 1)).toBe("AKs");
    expect(classLabel(1, 0)).toBe("AKo");
    expect(classLabel(12, 12)).toBe("22");
    expect(classLabel(11, 12)).toBe("32s");
  });

  it("round-trips labels and positions for all 169 classes", () => {
    expect(ALL_CLASSES).toHaveLength(169);
    expect(new Set(ALL_CLASSES).size).toBe(169);
    for (const c of ALL_CLASSES) expect(classLabel(...classPosition(c))).toBe(c);
  });

  it("counts 1326 combos, and expands each class into exactly its combos", () => {
    expect(ALL_CLASSES.reduce((n, c) => n + classCombos(c), 0)).toBe(1326);
    const all = new Set<string>();
    for (const c of ALL_CLASSES) {
      const combos = expandClass(c);
      expect(combos).toHaveLength(classCombos(c));
      for (const h of combos) {
        expect(classOf(h)).toBe(c);
        all.add(h);
      }
    }
    expect(all.size).toBe(1326);
  });

  it("parses cards leniently but rejects malformed and duplicated input", () => {
    expect(parseCards("ah kd")).toEqual(["Ah", "Kd"]);
    expect(parseCards("AhAh")).toBeNull();
    expect(parseCards("Ah1d")).toBeNull();
    expect(parseCards("Ahk")).toBeNull();
  });
});
