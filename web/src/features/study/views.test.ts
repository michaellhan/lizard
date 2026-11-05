import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import { actionLine, comboEqr, comboEv, viewsOf } from "./views";

describe("viewsOf", () => {
  it("offers strategy only for preflop charts and reads at once, EV for a preflop solve", () => {
    expect(viewsOf({ street: "preflop" })).toEqual(["mix"]);
    expect(viewsOf({ street: "preflop", source: "solver" })).toEqual(["mix", "ev"]);
    // a look at this street's solve, a stored turn: the Advisor nulls their EVs and equities (_no_values)
    expect(viewsOf({ street: "turn", approximate: { source: "store" }, range_eq: null })).toEqual(["mix"]);
  });

  it("offers equity only where the answer has it", () => {
    expect(viewsOf({ street: "flop", range_eq: 0.52 })).toEqual(["mix", "ev", "eq", "eqr"]);
    // (a solved 4-way flop: range_eq null)
    expect(viewsOf({ street: "flop", range_eq: null } as AdvisorResponse)).toEqual(["mix", "ev"]);
  });
});

describe("comboEqr", () => {
  it("is the combo's own mix over its own EVs, over its own equity and the pot", () => {
    expect(comboEv(["AsKs", 1, [0.25, 0.75], [4, 8], 0.7, 0, 0])).toBeCloseTo(7);
    expect(comboEqr(["AsKs", 1, [0.25, 0.75], [4, 8], 0.7, 0, 0], 10).value).toBeCloseTo(1);
    // a losing combo's is negative, as the class's
    expect(comboEqr(["AsKs", 1, [1, 0], [-2, 8], 0.5, 0, 0], 10).value).toBeCloseTo(-0.4);
  });

  it("says why where there's none, and never a zero", () => {
    expect(comboEqr(["AsKs", 1, [1, 0], null, null, 0, 0], 10)).toEqual({ why: "this answer has no EV or equity by combo" });
    expect(comboEqr(["AsKs", 1, [1, 0], null, 0.5, 0, 0], 10)).toEqual({ why: "this answer has no EV by combo" });
    expect(comboEqr(["AsKs", 1, [1, 0], [1, 2], null, 0, 0], 10)).toEqual({ why: "this answer has no equity by combo" });
    expect(comboEqr(["AsKs", 1, [1, 0], [1, 2], 0, 0, 0], 10)).toEqual({ why: "0% equity: no share of the pot to realize" });
    expect(comboEqr(["AsKs", 1, [1, 0], [1, 2], 0.5, 0, 0], undefined)).toEqual({ why: "this answer has no pot" });
  });
});

describe("actionLine", () => {
  it("shows the Advisor's ev_bb, marked when rough, and nothing for a null EV", () => {
    expect(actionLine({ action: "bet 33%", freq: 0.4, combos: 120.5, ev_bb: 3.25 })).toBe("40.0% · 120.5 combos · EV 3.25");
    expect(actionLine({ action: "check", freq: 0.6, combos: 80, ev_bb: -0.5, rough_ev: true })).toBe("60.0% · 80.0 combos · EV ≈−0.50");
    expect(actionLine({ action: "check", freq: 1, combos: 80, ev_bb: null })).toBe("100.0% · 80.0 combos");
    // in % of the pot (Settings: EV in % of pot)
    expect(actionLine({ action: "bet 33%", freq: 0.4, combos: 120.5, ev_bb: 3.25 }, (x) => `${((x / 6.5) * 100).toFixed(1)}%`)).toBe(
      "40.0% · 120.5 combos · EV 50.0%",
    );
  });
});
