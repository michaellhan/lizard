// Your spot's flop report: the flops it samples, what it asks a flop, and the report it builds from the answers.
import { describe, expect, it } from "vitest";
import { texture } from "@/features/practice/texture";
import type { StudyHand } from "@/features/study/studyState";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { columns, rows } from "./reports";
import { customBase, customProvenance, customReport, customStudyHand, flopClassList, sampleOrder, solveFlop, type Ask } from "./customReport";

const base: StudyHand = {
  players: 6,
  stack: 100,
  board: "Ks7d2c",
  preflop: [
    { pos: "UTG", action: "fold" },
    { pos: "HJ", action: "fold" },
    { pos: "CO", action: "fold" },
    { pos: "BTN", action: "raise", to: 2.5 },
    { pos: "SB", action: "fold" },
    { pos: "BB", action: "call" },
  ],
  flop: [{ pos: "BB", action: "check" }],
  turn: [],
  river: [],
};

const prov = (source: Provenance["source"]): Provenance => ({ source, approximate: false, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, seconds: 4 });

/** a stand-in solver: the root bets or checks, in position after a check bets or checks, a bet is folded to or called */
function fakeAsk(source: Provenance["source"] = "live", seen: AdvisorState[] = []): Ask {
  return async (state) => {
    seen.push(state);
    const fl = state.flop ?? [];
    const last = fl.at(-1);
    let data: AdvisorResponse;
    if (!fl.length)
      data = {
        street: "flop",
        actor: "BB",
        opponent: "BTN",
        pot_bb: 5.5,
        range_ev_bb: 2,
        range_eq: 0.45,
        opponent_eq: 0.55,
        actions: [
          { action: "check", freq: 0.9 },
          { action: "bet 33%", freq: 0.1, amount_bb: 1.8 },
        ],
      };
    else if (last?.action === "check")
      data = {
        street: "flop",
        actor: "BTN",
        actions: [
          { action: "check", freq: 0.4 },
          { action: "bet 33%", freq: 0.5, amount_bb: 1.8 },
          { action: "bet 75%", freq: 0.1, amount_bb: 4.1 },
        ],
      };
    else
      data = {
        street: "flop",
        actor: last?.pos === "BB" ? "BTN" : "BB",
        actions: [
          { action: "fold", freq: 0.3 },
          { action: "call", freq: 0.6 },
          { action: "raise", freq: 0.1, amount_bb: 6 },
        ],
      };
    return { data, provenance: prov(source) } as SolveResult<AdvisorResponse>;
  };
}

describe("the flops sampled", () => {
  it("are the 1,755 flop classes, standing for all 22,100 flops", () => {
    const all = flopClassList();
    expect(all).toHaveLength(1755);
    expect(all.reduce((a, x) => a + x.w, 0)).toBe(22100);
    expect(new Set(all.map((x) => x.f)).size).toBe(1755);
    // (a rainbow flop of three ranks stands for 24, a monotone one for 4, a trip for 4)
    const ranks = (f: string) => f[0]! + f[2]! + f[4]!;
    const of = (r: string, suits: string) => all.filter((x) => ranks(x.f) === r && texture(x.f).suits === suits).map((x) => x.w);
    expect(of("AK2", "rainbow")).toEqual([24]);
    expect(of("AK2", "mono")).toEqual([4]);
    expect(of("777", "rainbow")).toEqual([4]);
  });

  it("walk every class once, and any stretch from the start spreads over the suits", () => {
    const order = sampleOrder(1);
    expect(order).toHaveLength(1755);
    expect(new Set(order.map((x) => x.f)).size).toBe(1755);
    const suits = new Set(order.slice(0, 12).map((x) => texture(x.f).suits));
    expect(suits.size).toBeGreaterThan(1);
    expect(sampleOrder(1).map((x) => x.f)).toEqual(order.map((x) => x.f));
  });
});

describe("a flop solved", () => {
  it("asks the root on the flop with no action, then the nodes the views read, from the spot's line", async () => {
    const seen: AdvisorState[] = [];
    const got = await solveFlop(fakeAsk("live", seen), base, { f: "Qh8c3d", w: 24 });
    expect(seen[0]).toMatchObject({ board: "Qh8c3d", flop: [], preflop: base.preflop, study: true });
    expect(Object.keys(got.nodes).sort()).toEqual(["", "bet 33%", "check", "check|bet 33%"]);
    expect(got.nodes["check"]).toEqual({ names: ["check", "bet 33%", "bet 75%"], freqs: [0.4, 0.5, 0.1] });
    expect(got.bets).toEqual({ "bet 33%": 1.8, "check|bet 33%": 1.8 });
    expect(got).toMatchObject({ ev: [2, 3.5], eq: [0.45, 0.55], source: "live", seconds: 4 });
  });

  it("refuses a root the rules answered: a report shows solves only", async () => {
    await expect(solveFlop(fakeAsk("rules"), base, { f: "Qh8c3d", w: 24 })).rejects.toThrow(/rules, not a solve/);
  });

  it("gives no EV where the spot is raked: the two EVs don't add up to the pot", async () => {
    const got = await solveFlop(fakeAsk(), { ...base, setup: { rake: 5 } }, { f: "Qh8c3d", w: 24 });
    expect(got.ev).toBeUndefined();
    expect(got.eq).toEqual([0.45, 0.55]);
  });
});

describe("the report", () => {
  it("is drawn as a library report is: names joined over the flops, rows weighted", async () => {
    const a = await solveFlop(fakeAsk(), base, { f: "Qh8c3d", w: 24 });
    const b = { ...(await solveFlop(fakeAsk(), base, { f: "7s7d2c", w: 12 })), nodes: { "": { names: ["check", "bet 75%"], freqs: [0.7, 0.3] } } };
    const rep = customReport(customBase(base), ["BB", "BTN"], 5.5, [a, b]);
    expect(rep.nodes[""]).toEqual(["check", "bet 33%", "bet 75%"]);
    expect(rep.flops[1]!.n[""]).toEqual([0.7, 0, 0.3]);
    expect(rep.line).toBe("UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c");
    expect(columns(rep, "oop")).toEqual(["check", "bet 33%", "bet 75%"]);
    expect(rows(rep, "ip").map((r) => r.freqs)).toEqual([[0.4, 0.5, 0.1], null]);
  });

  it("opens a row's node in Study at the size it was answered with", async () => {
    const fl = await solveFlop(fakeAsk(), base, { f: "Qh8c3d", w: 24 });
    expect(customStudyHand(base, ["BB", "BTN"], fl, "")?.flop).toEqual([]);
    expect(customStudyHand(base, ["BB", "BTN"], fl, "check")?.flop).toEqual([{ pos: "BB", action: "check" }]);
    expect(customStudyHand(base, ["BB", "BTN"], fl, "check|bet 33%")).toMatchObject({ board: "Qh8c3d", flop: [{ pos: "BB", action: "check" }, { pos: "BTN", action: "bet", to: 1.8 }] });
    expect(customStudyHand(base, ["BB", "BTN"], fl, "bet 33%")?.flop).toEqual([{ pos: "BB", action: "bet", to: 1.8 }]);
    expect(customStudyHand(base, ["BB", "BTN"], fl, "bet 75%")).toBeNull();
  });

  it("says how many flops it stands on and how each was answered", () => {
    const f = (source: Provenance["source"], approximate = false) => ({ f: "x", w: 1, nodes: {}, bets: {}, source, approximate });
    const p = customProvenance([f("live"), f("live", true), f("library")], "fast", 2);
    expect(p.source).toBe("live");
    expect(p.approximate).toBe(true);
    expect(p.approximateLabel).toBe("flop report of your spot over 3 sampled flops (2 solved here, 1 read from the library), 1 short of the accuracy target, 2 left out");
  });
});
