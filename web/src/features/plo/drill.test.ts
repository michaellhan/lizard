import { describe, expect, it } from "vitest";
import type { ResultNode } from "@/engine/plo/river/run";
import { deal, gradeAt, mixAt, potAt, tallied, toCall, EMPTY_TALLY } from "./drill";

const action = (kind: "check" | "bet" | "call" | "fold", label: string) => ({ kind, label, token: label });

/** A node of 3 combos and 2 actions; strategy and EVs are action * n + combo. */
function node(o: Partial<ResultNode> & { id: number }): ResultNode {
  return {
    path: "",
    player: 0,
    reach: 1,
    rangeEv: [0, 0],
    frequency: [0.5, 0.5],
    actionRangeEv: [0, 0],
    strategy: Float32Array.from([1, 0.5, 0, /* second action */ 0, 0.5, 1]),
    weight: Float32Array.from([1, 1, 1]),
    ev: Float32Array.from([0, 0, 0]),
    actionEv: Float32Array.from([2, 3, 1, /* second */ 1, 3, 4]),
    bestEv: Float32Array.from([2, 3, 1, /* second */ 1, 3, 4]),
    line: "",
    actions: [action("check", "Check"), action("bet", "Bet 10")],
    bets: [0, 0],
    ...o,
  } as ResultNode;
}

/** rand() handing back the given numbers in turn */
const seq = (...xs: number[]) => () => xs.shift()!;

describe("deal", () => {
  it("draws a decision by its reach and a combo by its weight there", () => {
    const nodes = [node({ id: 0, reach: 1 }), node({ id: 3, reach: 0.25, weight: Float32Array.from([0, 3, 1]) })];
    // 1.25 of reach in all: 0.9 of it is the root, 1.1 the second node
    expect(deal(nodes, seq(0.9 / 1.25, 0))).toEqual({ node: 0, combo: 0 });
    expect(deal(nodes, seq(1.1 / 1.25, 0))).toEqual({ node: 3, combo: 1 });
    // 4 of weight: the first 3 are combo 1 (combo 0 has none), the last 1 combo 2
    expect(deal(nodes, seq(1.1 / 1.25, 0.74))).toEqual({ node: 3, combo: 1 });
    expect(deal(nodes, seq(1.1 / 1.25, 0.76))).toEqual({ node: 3, combo: 2 });
  });

  it("never deals a combo without an EV for every action, nor a line never reached", () => {
    const blocked = node({ id: 0, bestEv: Float32Array.from([NaN, 3, 1, NaN, 3, 4]) });
    for (const r of [0, 0.2, 0.5, 0.99]) expect(deal([blocked], seq(0, r))!.combo).not.toBe(0);
    expect(deal([node({ id: 0, reach: 0 })])).toBeNull();
    expect(deal([node({ id: 0, weight: Float32Array.from([0, 0, 0]) })])).toBeNull();
  });
});

describe("a decision graded", () => {
  it("reads the pot, the call and the combo's mix from the solve", () => {
    const facing = node({ id: 2, player: 1, bets: [10, 0] });
    expect(potAt(facing, 20)).toBe(30);
    expect(toCall(facing)).toBe(10);
    expect(toCall(node({ id: 0 }))).toBe(0);
    expect(mixAt(facing, 2)).toEqual([
      { freq: 0, ev: 1 },
      { freq: 1, ev: 4 },
    ]);
  });

  it("by the EV given up in % of the pot at the decision, on the one scale", () => {
    const n = node({ id: 0, bets: [0, 0] });
    // combo 2: check is never played and gives up 3bb of a 20bb pot, 15%: a Blunder
    const g = gradeAt(n, 2, 0, 20, "converged");
    expect(g).toMatchObject({ verdict: "Blunder", best: 1, loss: 3, lossPct: 15, ok: false });
    // combo 1 mixes at equal EV: either is Best
    expect(gradeAt(n, 1, 0, 20, "converged")).toMatchObject({ verdict: "Best", mixed: true, loss: 0 });
    // a solve short of converged can't condemn: capped at an Inaccuracy, the EV as measured
    expect(gradeAt(n, 2, 0, 20, "approximate")).toMatchObject({ verdict: "Inaccuracy", capped: true, loss: 3 });
  });

  it("keeps a tally", () => {
    const n = node({ id: 0 });
    const t = tallied(tallied(EMPTY_TALLY, gradeAt(n, 2, 0, 20, "converged")), gradeAt(n, 0, 0, 20, "converged"));
    expect(t).toEqual({ hands: 2, ok: 1, loss: 3 });
  });
});
