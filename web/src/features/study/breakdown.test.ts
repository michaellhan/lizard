import { describe, expect, it } from "vitest";
import type { Breakdown, BreakdownSide } from "@/solver/protocol";
import { curveAt, curvesOf, nutAdvantage, rangeAdvantage, runoutText, sidesOf, takingAction } from "./breakdown";

const side = (who: string, more: Partial<BreakdownSide> = {}): BreakdownSide => ({ who, combos: 100, made: [], draws: [], ...more });
const bd = (more: Partial<Breakdown> = {}): Breakdown => ({
  actions: ["check", "bet 50%"],
  pot: 6,
  hero: side("BB", { eq: 0.46, nuts: 0.12, curve: [1, 0.5, 0] }),
  villains: [side("BTN", { eq: 0.54, nuts: 0.2, curve: [1, 0.6, 0] })],
  nut_eq: 0.8,
  ...more,
});

describe("runoutText", () => {
  it.each([
    [[1, 1], "on the river, no cards to come"],
    [[48, 48], "with every river card dealt out"],
    [[1081, 1081], "with every runout dealt out"],
    [[99, 1081], "over an even sample of 99 of the 1081 turn and river runouts"],
  ] as [[number, number], string][])("reads %j", (runouts, text) => {
    expect(runoutText(bd({ runouts }))).toBe(text);
  });

  it("makes no claim where the answer doesn't say", () => {
    expect(runoutText(bd())).toBe("over the runouts");
  });
});

describe("the advantages", () => {
  it("names who has more equity", () => {
    expect(rangeAdvantage(sidesOf(bd()))).toBe("BTN has the range advantage (54.0% equity).");
  });

  it("names who has more of their range at the threshold, and by how much", () => {
    expect(nutAdvantage(sidesOf(bd()), 0.8)).toBe("BTN has the nut advantage: 8.0 points more of the range at 80% equity or better.");
  });

  it("calls a lead under a point none", () => {
    const ss = [side("BB", { nuts: 0.2 }), side("BTN", { nuts: 0.205 })];
    expect(nutAdvantage(ss, 0.8)).toBe("Neither range has a nut advantage.");
  });

  it("says no range of three, not neither", () => {
    const ss = [side("SB", { nuts: 0.027 }), side("BB", { nuts: 0.021 }), side("BTN", { nuts: 0.033 })];
    expect(nutAdvantage(ss, 0.8)).toBe("No range has a nut advantage.");
  });

  it("compares the best two of three", () => {
    const ss = [side("SB", { eq: 0.3, nuts: 0.1 }), side("BB", { eq: 0.31, nuts: 0.05 }), side("BTN", { eq: 0.39, nuts: 0.15 })];
    expect(rangeAdvantage(ss)).toMatch(/^BTN/);
    expect(nutAdvantage(ss, 0.8)).toMatch(/^BTN has the nut advantage: 5\.0 points/);
  });

  it("says nothing with fewer than two to compare", () => {
    expect(rangeAdvantage([side("BB", { eq: 0.5 }), side("BTN")])).toBeNull();
    expect(nutAdvantage([side("BB")], 0.8)).toBeNull();
  });
});

describe("the curves", () => {
  it("leaves out a side with none", () => {
    const b = bd({ villains: [side("BTN"), side("SB", { curve: [0.9, 0.1] })] });
    expect(curvesOf(b).map((s) => s.who)).toEqual(["BB", "SB"]);
  });

  it("reads a line at a share of the range, held to its ends", () => {
    const s = side("BB", { curve: [1, 0.5, 0] });
    expect(curveAt(s, 0)).toBe(1);
    expect(curveAt(s, 0.5)).toBe(0.5);
    expect(curveAt(s, 2)).toBe(0);
    expect(curveAt(side("BB"), 0.5)).toBeUndefined();
  });
});

describe("takingAction", () => {
  const rows = [
    { id: "set", label: "Set", c: 10, eq: 0.95, f: [0.25, 0.75], ev: 8 },
    { id: "nothing", label: "No made hand", c: 30, eq: 0.2, f: [1, 0], ev: 0.5 },
  ];

  it("counts the combos of each category that take the action, leaving out those with none", () => {
    expect(takingAction(rows, 1)).toEqual([{ id: "set", label: "Set", c: 7.5 }]);
    expect(takingAction(rows, 0).map((r) => r.c)).toEqual([2.5, 30]);
  });

  it("adds up to the action's share of the rows", () => {
    const total = rows.reduce((t, r) => t + r.c, 0);
    const shares = [0, 1].map((a) => takingAction(rows, a).reduce((t, r) => t + r.c, 0) / total);
    expect(shares[0]! + shares[1]!).toBeCloseTo(1);
  });

  it("drops the whole category's equity and EV, and a row with no mix has nothing to count", () => {
    expect(takingAction(rows, 1)[0]).not.toHaveProperty("eq");
    expect(takingAction(rows, 1)[0]).not.toHaveProperty("ev");
    expect(takingAction([{ id: "x", label: "X", c: 5 }], 0)).toEqual([]);
  });
});
