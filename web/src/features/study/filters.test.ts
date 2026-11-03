import { describe, expect, it } from "vitest";
import type { AdvisorResponse, ComboRow } from "@/solver/protocol";
import { catsOf, filterRes } from "./filters";

// the fixture of solver/tests/js/study.test.js ("the filter: ..."), on its NODE
const NODE: AdvisorResponse = {
  study: "node",
  street: "flop",
  actor: "BTN",
  opponent: "BB",
  pot_bb: 5.5,
  actions: [
    { action: "check", freq: 0.5, combos: 200, ev_bb: 3.1 },
    { action: "bet 33%", amount_bb: 2, freq: 0.4, combos: 160, ev_bb: 4.2 },
    { action: "bet 75%", amount_bb: 4, freq: 0.1, combos: 40, ev_bb: 6 },
  ],
  grid: {
    actions: ["check", "bet 33%", "bet 75%"],
    cells: {
      AA: { w: 1, f: [0.2, 0.3, 0.5], ev: [10, 11, 12], evm: 11.3, eq: 0.9 },
      KQo: { w: 0.5, f: [0.6, 0.4, 0], ev: [5, 5.5, 4], evm: 5.2, eq: 0.8 },
      "72s": { w: 1, f: [1, 0, 0], ev: [-0.02, -0.5, -1], evm: -0.02, eq: 0.6 },
    },
  },
  range_combos: 400,
  range_eq: 0.55,
};

const combos: Record<string, ComboRow[]> = {
  AA: [
    ["AsAh", 1, [0, 0, 1], [10, 11, 12], 0.9, 1, 1],
    ["AdAc", 1, [1, 0, 0], [9, 8, 7], 0.88, 1, 0],
  ],
  KQo: [
    ["KsQh", 1, [0.5, 0.5, 0], [5, 6, 4], 0.8, 2, 1],
    ["KhQd", 0.5, [1, 0, 0], [4, 4, 4], 0.7, 2, 1],
  ],
  "72s": [["7s2s", 1, [0, 0, 1], [3, 2, 8], 0.95, 0, 1]],
};

const node: AdvisorResponse = {
  ...NODE,
  categories: {
    made: [
      ["set", "Set"],
      ["overpair", "Overpair"],
      ["top_tk", "Top pair, top kicker"],
    ],
    draws: [
      ["fd", "Flush draw"],
      ["none", "No draw"],
    ],
  },
  combos,
};

const near = (xs: readonly (number | null | undefined)[], ys: readonly (number | null)[]) =>
  expect(xs.map((x) => (x == null ? x : Number(x.toFixed(6))))).toEqual(ys);

describe("hand-category filter", () => {
  it("lists the categories the range holds, without 'No draw'", () => {
    expect(catsOf(node).map((c) => [c.key, c.label, c.combos])).toEqual([
      ["m:set", "Set", 1],
      ["m:overpair", "Overpair", 2],
      ["m:top_tk", "Top pair, top kicker", 1.5],
      ["d:fd", "Flush draw", 1],
    ]);
    expect(catsOf(NODE)).toEqual([]); // (preflop, or an answer without them)
  });

  it("recomputes the grid, the actions and the range's totals over the category's hands", () => {
    const op = filterRes(node, "m:overpair");
    expect(Object.keys(op.grid!.cells)).toEqual(["AA"]);
    const aa = op.grid!.cells.AA!;
    near([aa.w, aa.evm, aa.eq], [Number((2 / 6).toFixed(6)), 10.5, 0.89]);
    near(aa.f, [0.5, 0, 0.5]);
    near(aa.ev ?? [], [9.5, 9.5, 9.5]);
    near(op.actions!.map((a) => a.freq), [0.5, 0, 0.5]);
    near(op.actions!.map((a) => a.ev_bb), [9, null, 12]); // (none for an action no hand of it takes)
    expect(op.actions!.map((a) => a.action)).toEqual(["check", "bet 33%", "bet 75%"]);
    near([op.range_combos, op.range_ev_bb, op.range_eq], [2, 10.5, 0.89]);
    expect(op.filter).toEqual({ key: "m:overpair", label: "Overpair", of: 400 });
    const tp = filterRes(node, "m:top_tk").grid!.cells.KQo!;
    near([tp.w, ...tp.f], [0.125, Number((2 / 3).toFixed(6)), Number((1 / 3).toFixed(6)), 0]);
    expect(filterRes(node, "d:fd").combos).toEqual({ AA: [combos.AA![1]] });
  });

  it("returns the answer itself for a key not of this node, or none", () => {
    expect(filterRes(node, "d:oesd")).toBe(node); // draws on the river: every hand
    expect(filterRes(node, null)).toBe(node);
  });

  it("makes up no EVs for an answer at once (combo rows without EVs)", () => {
    const atOnce: AdvisorResponse = {
      ...node,
      combos: { ...combos, AA: [["AsAh", 1, [0, 0, 1], null, null, 1, 1], combos.AA![1]!] },
    };
    const op = filterRes(atOnce, "m:overpair");
    expect(op.grid!.cells.AA!.evm).toBeNull();
    expect(op.grid!.cells.AA!.ev).toBeNull();
    expect(op.range_ev_bb).toBeNull();
    expect(op.actions!.every((a) => a.ev_bb === null)).toBe(true);
  });
});
