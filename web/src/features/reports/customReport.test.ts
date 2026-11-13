// Your spot's flop report: the flops it samples, what it asks a flop, and the report it builds from the answers.
import { describe, expect, it } from "vitest";
import type { StudyHand } from "@/features/study/studyState";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { columns, rows } from "./reports";
import { callersAfter, checkSpot, customBase, customProvenance, customReport, customStudyHand, flopsToGo, newFlopReport, openers, potLine, seatsIn, solveFlop, type Ask, type CustomFlop } from "./customReport";
import { flopSet } from "./flopSets";

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

describe("a new report", () => {
  it("keeps the spot with no board and the set of n in its solving order, nothing solved yet", () => {
    const r = newFlopReport(base, { id: "a", name: "x", from: "solve", mode: "accurate", size: 25, now: 7 });
    expect(r).toMatchObject({ id: "a", from: "solve", mode: "accurate", size: 25, done: [], left: [], seats: null, status: "paused", createdAt: 7, updatedAt: 7 });
    expect(r.spot).not.toContain("b=");
    expect(r.spot).toContain("pre=");
    expect([...r.flops].sort()).toEqual(flopSet(25).map((x) => x.f).sort());
    // (spread: the first few aren't all of one suit pattern, as the set's texture order would have them)
    expect(new Set(r.flops.slice(0, 5).map((f) => new Set([f[1], f[3], f[5]]).size)).size).toBeGreaterThan(1);
    expect(newFlopReport(base, { id: "b", name: "y", from: "study", mode: "fast", size: 25, now: 8 }).flops).toEqual(r.flops);
  });

  it("goes on with the flops not tried, each weighted 22,100/n", () => {
    const r = newFlopReport(base, { id: "a", name: "x", from: "solve", mode: "fast", size: 9, now: 1 });
    const done = { f: r.flops[0]!, w: 22100 / 9, nodes: { "": { names: ["check"], freqs: [1] } }, bets: {}, source: "live" as const, approximate: false };
    const togo = flopsToGo({ ...r, done: [done], left: [{ f: r.flops[2]!, why: "rules" }] });
    expect(togo.map((x) => x.f)).toEqual([r.flops[1], ...r.flops.slice(3)]);
    expect(togo.every((x) => x.w === 22100 / 9)).toBe(true);
  });
});

describe("the spot", () => {
  const ask = (data: AdvisorResponse): Ask => async () => ({ data, provenance: prov("charts") });
  it("is reported where its line reaches a heads-up flop", async () => {
    expect(seatsIn(base)).toEqual(["BTN", "BB"]);
    expect(await checkSpot(ask({ study: "deal", street: "flop" }), base)).toEqual({ ok: true });
  });

  it("asks for a pot where the line doesn't reach a flop, or reaches it 3-way", async () => {
    expect(await checkSpot(ask({ study: "node", street: "preflop", actor: "UTG" }), { ...base, preflop: [] })).toMatchObject({ ok: false, unfinished: true });
    const threeWay = { ...base, preflop: base.preflop.map((a) => (a.pos === "SB" ? { pos: "SB", action: "call" } : a)) };
    expect(await checkSpot(ask({ study: "deal", street: "flop" }), threeWay)).toMatchObject({ ok: false, unfinished: true, why: expect.stringMatching(/3 players/) });
  });

  it("refuses a tournament spot, its EVs being prize equity", async () => {
    expect(await checkSpot(ask({ study: "deal", street: "flop" }), { ...base, setup: { tournament: { payouts: [50, 30, 20] } } })).toMatchObject({ ok: false, unfinished: false });
  });

  it("gets a pot's line from the spot's own preflop answers: folds to the opener, who raises, and the caller calls or 3-bets", async () => {
    const order = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
    // (a stand-in preflop: whoever's next, by the line so far; the hand is dealt once the betting closes)
    const preflop: Ask = async (state) => {
      const line = state.preflop ?? [];
      const raises = line.filter((a) => a.action.startsWith("raise")).length;
      const folded = new Set(line.filter((a) => a.action === "fold").map((a) => a.pos));
      const acted = line.length;
      const closed = raises > 0 && line.at(-1)?.action === "call" && order.filter((p) => !folded.has(p)).length === 2;
      if (closed) return { data: { study: "deal", street: "flop" }, provenance: prov("charts") };
      const actor = acted < 6 ? order[acted]! : "BTN";
      const sizes = raises === 0 ? [2.5] : [10, 22];
      return {
        data: {
          study: "node",
          street: "preflop",
          actor,
          actions: [{ action: "fold", freq: 0.5 }, ...(raises ? [{ action: "call", freq: 0.3 }] : []), ...sizes.map((x, i) => ({ action: `raise ${x}`, amount_bb: x, freq: i === 0 ? 0.15 : 0.05 }))],
        },
        provenance: prov("charts"),
      };
    };
    const srp = await potLine(preflop, { ...base, preflop: [] }, "BTN", "BB", "srp");
    expect(srp.preflop.map((a) => `${a.pos}:${a.action}`)).toEqual(["UTG:fold", "HJ:fold", "CO:fold", "BTN:raise", "SB:fold", "BB:call"]);
    expect(srp.preflop[3]).toMatchObject({ to: 2.5 });
    const tbp = await potLine(preflop, { ...base, preflop: [] }, "BTN", "BB", "3bp");
    expect(tbp.preflop.map((a) => `${a.pos}:${a.action}`)).toEqual(["UTG:fold", "HJ:fold", "CO:fold", "BTN:raise", "SB:fold", "BB:raise", "BTN:call"]);
    // (the 3-bet the answer plays most)
    expect(tbp.preflop[5]).toMatchObject({ to: 10 });
    expect(openers(6)).not.toContain("BB");
    expect(callersAfter(6, "BTN")).toEqual(["SB", "BB"]);
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

  it("says it's a live solve at the tier over n sampled flops, how close each solve came, and the flop model's abstraction error", () => {
    const f = (source: CustomFlop["source"], approximate = false, exploitabilityPct?: number, iterations?: number): CustomFlop => ({ f: "x", w: 1, nodes: {}, bets: {}, source, approximate, ...(exploitabilityPct !== undefined ? { exploitabilityPct, iterations } : {}) });
    const rec = { size: 25, mode: "fast" as const, flops: Array.from({ length: 25 }, (_, i) => `f${i}`), left: [{ f: "y", why: "rules" }] };
    const p = customProvenance({ ...rec, done: [f("live", false, 0.2, 300), f("live", true, 0.6, 400), f("library")] });
    expect(p.source).toBe("live");
    expect(p.approximate).toBe(true);
    expect(p.mode).toBe("fast");
    expect(p.view).toBe(
      "flop report of your spot over 3 sampled flops of the solver's representative 25, each standing for 1/25 of all flops; 2 solved live at Fast, 1 read from the flop library, which stores it; each solve 0.20% to 0.60% pot from equilibrium in its own game (mean 0.40%); 300–400 iterations a flop",
    );
    expect(p.approximateLabel).toBe("1 short of the accuracy target, 1 left out, not solved, 21 of the set not solved yet");
    expect(p.abstraction).toMatch(/^this flop model gave up 1\.9% pot on average, up to 4\.9%.*\(the library's flops: this flop model gave up 0\.6% pot on average/);
  });

  it("is not approximate once every flop is solved within its target, and names Accurate's model", () => {
    const flops = ["a", "b"];
    const done = flops.map((f) => ({ f, w: 1, nodes: {}, bets: {}, source: "live" as const, approximate: false, exploitabilityPct: 0.01, iterations: 1000 }));
    const p = customProvenance({ size: 2, mode: "accurate", flops, done, left: [] });
    expect(p.approximate).toBe(false);
    expect(p.approximateLabel).toBeUndefined();
    expect(p.abstraction).toMatch(/gave up 1\.9% pot on average, up to 5\.4%/);
    // (a local server's solves were never measured)
    expect(customProvenance({ size: 2, mode: "accurate", flops, done, left: [] }, "http").abstraction).toBeUndefined();
  });
});
