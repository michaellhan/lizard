/// <reference types="node" />
// A leak's drill (leakDrill.ts): which decisions it deals and in what order, the action before each, a pick graded
// as the decision was (by EV from the library, by frequency from the charts), and the progress kept as a session.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { addScore, emptyScore } from "@/grading/grade";
import { importHand } from "@/hh/replay";
import { canDrill, carriedWords, decisionIndex, drillItems, drillSessionId, fromSession, gradePick, leakDrillAbout, leakDrillLink, leakParam, lineBefore, notDealt, notDealtWords, parseLeakParam, roughActions, toSession } from "./leakDrill";

const hand = (id: string, playedAt: number) => ({ id, playedAt }) as HandRecord;
const hands = new Map([["h1", hand("h1", 1)], ["h2", hand("h2", 2)]]);
let k = 0;
const d = (o: Partial<DecisionRecord>): DecisionRecord => ({
  id: `d${k++}`,
  handId: "h1",
  street: "preflop",
  pos: "BTN",
  action: "raise to 2.5",
  situation: "RFI",
  verdict: "Best",
  evLossBb: null,
  mix: [["fold", 0.5, null], ["raise", 0.5, null]],
  source: "charts",
  label: "Preflop charts · approximate",
  gradedAt: 0,
  ...o,
});

describe("leakDrill", () => {
  it("reads the leak from the URL and back", () => {
    expect(parseLeakParam(leakParam({ kind: "spot", key: "SRP · IP · checked to" }))).toEqual({ kind: "spot", key: "SRP · IP · checked to" });
    expect(parseLeakParam("pf:vs 3bet")).toEqual({ kind: "pf", key: "vs 3bet" });
    expect(parseLeakParam(leakParam({ kind: "pf", key: "vs 3bet (preflop solve)" }))).toEqual({ kind: "pf", key: "vs 3bet (preflop solve)" });
    expect([parseLeakParam(null), parseLeakParam("pf:"), parseLeakParam("nope:RFI")]).toEqual([null, null, null]);
    expect(drillSessionId({ kind: "freq", key: "Open (RFI)" })).toBe("leak-drill|freq:Open (RFI)");
  });

  it("deals the leak's graded decisions with a mix in kept hands, misses first", () => {
    const ds = [
      d({ id: "ok-old" }),
      d({ id: "ok-new", handId: "h2" }),
      d({ id: "rare", verdict: "Mistake", freq: 0 }),
      d({ id: "less-rare", verdict: "Inaccuracy", freq: 0.02 }),
      d({ id: "costly", verdict: "Mistake", evLossBb: 0.4, freq: 0.1 }),
      d({ id: "no-mix", verdict: "Mistake", mix: undefined }),
      d({ id: "not-graded", verdict: "Not graded", why: "skipped" }),
      d({ id: "gone", handId: "h9", verdict: "Mistake" }),
      d({ id: "vs-open", situation: "vs open", verdict: "Mistake" }),
      d({ id: "flop", street: "flop", verdict: "Mistake" }),
    ];
    expect(drillItems(ds, { kind: "pf", key: "RFI" }, hands).map((x) => x.d.id)).toEqual(["costly", "rare", "less-rare", "ok-new", "ok-old"]);
    expect(drillItems(ds, { kind: "spot", key: "RFI" }, hands).map((x) => x.d.id)).toEqual(["flop"]);
  });

  it("says the action before a decision, with the board to its street", () => {
    const r = importHand(readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", "stars_6max_srp.txt"), "utf8"));
    const pre = lineBefore(r, "preflop", 3);
    expect(pre.board).toEqual([]);
    expect(pre.streets).toEqual([{ street: "preflop", says: ["UTG folds", "HJ folds", "CO folds"] }]);
    const flop = lineBefore(r, "flop", 1);
    expect(flop.board).toEqual(["Qs", "8d", "3c"]);
    expect(flop.streets.map((s) => s.street)).toEqual(["preflop", "flop"]);
    expect(flop.streets[0]!.says).toContain("You raise to 2.5");
    expect(flop.streets[1]!.says).toEqual(["BB checks"]);
  });

  it("grades a pick by EV where the mix has every EV, else by frequency", () => {
    const lib = d({ street: "flop", pot: 5.5, mix: [["check", 0.48, 3.1], ["bet 33%", 0.09, 3.0], ["bet 75%", 0.43, 3.12]] });
    const g = gradePick(lib, 1)!;
    expect([g.byEv, g.verdict, Math.round(g.loss * 100) / 100]).toEqual([true, "Mistake", 0.12]);
    expect(gradePick(lib, 2)).toMatchObject({ byEv: true, verdict: "Best", ok: true });
    const chart = d({ mix: [["fold", 0.2, null], ["raise", 0.8, null], ["call", 0, null]] });
    expect(gradePick(chart, 1)).toMatchObject({ byEv: false, ok: true });
    expect(gradePick(chart, 2)).toMatchObject({ byEv: false, ok: false });
  });

  it("doesn't grade a pick by EV with no pot to measure it against, and leaves it out of the drill", () => {
    const mix: DecisionRecord["mix"] = [["check", 0.5, 3.1], ["bet 33%", 0.5, 1]];
    for (const pot of [undefined, 0]) {
      const noPot = d({ street: "flop", ...(pot === undefined ? {} : { pot }), mix });
      expect(gradePick(noPot, 1)).toBeNull();
      expect(drillItems([{ ...noPot, street: "preflop" }], { kind: "pf", key: "RFI" }, hands)).toEqual([]);
    }
    // (by frequency a mix needs no pot)
    expect(gradePick(d({ mix: [["fold", 0.2, null], ["raise", 0.8, null]] }), 1)).toMatchObject({ byEv: false, ok: true });
  });

  describe("after the flop", () => {
    const LIVE = { pot: 9.1, situation: "SRP · IP · checked to", mix: [["check", 0.9, 3], ["bet 33%", 0.05, 2.9], ["bet 75%", 0.05, 2.5]] as NonNullable<DecisionRecord["mix"]>, source: "live", label: "Live solve · 0.80%", band: "converged" as const };
    const turn = (o: Partial<DecisionRecord> = {}) => d({ street: "turn", verdict: "Mistake", ...LIVE, ...o });

    it("deals a turn and a river wherever the mix was kept, from a solve by EV or a stored turn by frequency", () => {
      const ds = [
        turn({ id: "t" }),
        turn({ id: "r", street: "river" }),
        turn({ id: "quick", confidence: "medium", triageSource: "quick" }),
        turn({ id: "stored", mix: [["check", 0.6, null], ["bet 33%", 0.4, null]], source: "library", label: "A stored turn" }),
      ];
      expect(drillItems(ds, { kind: "spot", key: "Turn · SRP · IP · checked to" }, hands).map((x) => x.d.id).sort()).toEqual(["quick", "stored", "t"]);
      expect(drillItems(ds, { kind: "spot", key: "River · SRP · IP · checked to" }, hands).map((x) => x.d.id)).toEqual(["r"]);
      expect(gradePick(ds[1]!, 2)).toMatchObject({ byEv: true, verdict: "Mistake" });
      expect(gradePick(ds[3]!, 1)).toMatchObject({ byEv: false, verdict: "Correct" });
    });

    it("says how many it can't deal and why, instead of leaving them out unsaid", () => {
      const ds = [turn({ id: "ok" }), turn({ id: "old", mix: undefined }), turn({ id: "older", mix: undefined }), turn({ id: "nopot", pot: 0 }), turn({ id: "good", verdict: "Not graded", mix: undefined })];
      const left = notDealt(ds, { kind: "spot", key: "Turn · SRP · IP · checked to" }, hands);
      expect(left).toEqual({ noMix: 2, noPot: 1 });
      expect(notDealtWords(left)).toBe("3 of this leak's graded decisions aren't dealt here, as there's nothing to grade a pick against: 2 kept no mix with the grade, 1 kept EVs with no pot to measure a pick against. Forget the grades and grade again to keep them.");
      expect(notDealtWords({ noMix: 0, noPot: 0 })).toBeNull();
      expect(canDrill(ds[1]!)).toBe(false);
    });

    it("grades by the same cap as the grade: a rough solve's pick stops at an Inaccuracy, kept grades and old alike", () => {
      const big = { mix: [["check", 0.95, 9], ["bet 33%", 0.05, 1]] as NonNullable<DecisionRecord["mix"]> };
      expect(gradePick(turn({ ...big }), 1)).toMatchObject({ verdict: "Blunder" });
      expect(gradePick(turn({ ...big, band: "rough" }), 1)).toMatchObject({ verdict: "Inaccuracy", capped: true });
      expect(gradePick(turn({ ...big, band: "approximate" }), 1)).toMatchObject({ verdict: "Inaccuracy", capped: true });
      expect(gradePick(turn({ ...big, band: undefined, capped: true }), 1)).toMatchObject({ verdict: "Inaccuracy", capped: true });
    });

    it("says what it carries from the grade: how it was checked, its confidence, the cap and the version", () => {
      const quick = turn({ confidence: "low", triageSource: "quick", version: "build:abc/123", band: "rough", mix: [["check", 0.95, 9], ["bet 33%", 0.05, 1]] });
      const words = carriedWords(quick, gradePick(quick, 1)!).join(" ");
      expect(words).toMatch(/A Quick triage read at low confidence/);
      expect(words).toMatch(/stops at Inaccuracy/);
      expect(words).toMatch(/Version: /);
      const rough = turn({ roughEv: true, matched: "check" });
      expect(roughActions(rough)).toEqual(new Set(["check"]));
      expect(roughActions(turn({ roughEvs: ["bet 75%"], roughEv: true, matched: "check" }))).toEqual(new Set(["bet 75%"]));
      expect(carriedWords(rough, gradePick(rough, 0)!).join(" ")).toMatch(/its EV is rough/);
      expect(carriedWords(turn({ version: "build:abc/123" }), gradePick(turn(), 0)!).join(" ")).not.toMatch(/Quick|rough|Inaccuracy/);
    });

    it("finds the decision's place in an old grade that kept no index, from its id", () => {
      expect(decisionIndex(turn({ i: 2 }))).toBe(2);
      expect(decisionIndex(turn({ i: undefined, id: "h1|turn|3" }))).toBe(3);
    });
  });

  it("keeps the progress as an analysis session and reads it back", () => {
    const l = { kind: "pf", key: "RFI" } as const;
    const score = addScore(emptyScore(), { ok: false, loss: 0, lossPct: 0, byEv: false });
    const s = toSession(l, { startedAt: 10, done: ["d1"], score }, 5, 20);
    expect(s).toMatchObject({ id: "leak-drill|pf:RFI", kind: "analysis", startedAt: 10, endedAt: 20, decisions: 1, meta: { drill: "leak", leak: "pf:RFI", total: 5, done: ["d1"] } });
    expect(fromSession(s)).toEqual({ startedAt: 10, done: ["d1"], score });
    // its picks a way, kept beside the score: what a damaged way leaves out, History counts apart
    const ways = { ev: { n: 1, ok: 1, loss: 0, lossPct: 0 } };
    const kept = toSession(l, { startedAt: 10, done: ["d1"], score, ways }, 5, 20);
    expect(kept.meta.ways).toEqual(ways);
    expect(fromSession(kept)).toEqual({ startedAt: 10, done: ["d1"], score, ways });
    expect(fromSession({ ...kept, meta: { ...kept.meta, ways: { ev: { n: "1" }, other: { n: 1, ok: 1 } } } })?.ways).toEqual({});
    expect([fromSession(undefined), fromSession({ ...s, meta: {} })]).toEqual([null, null]);
  });

  it("keeps a leak's drill as a link: the leak and the hands' filters, nothing else of the page", () => {
    const leak = { kind: "pf" as const, key: "BTN RFI" };
    const params = new URLSearchParams({ hand: "PokerStars|1|AhKd", pos: "BTN", bb: "0.5/1", q: "suited", drill: "freq:x", page: "2" });
    expect(leakDrillLink(leak, params)).toBe("/analyze?drill=pf%3ABTN+RFI&pos=BTN&bb=0.5%2F1&q=suited");
    expect(leakDrillAbout(leak, params)).toBe("Leak: BTN RFI · your seat BTN, stakes 0.5/1, search suited");
    expect([leakDrillLink(leak, new URLSearchParams()), leakDrillAbout(leak, new URLSearchParams())]).toEqual(["/analyze?drill=pf%3ABTN+RFI", "Leak: BTN RFI"]);
    expect(leakDrillAbout(leak, new URLSearchParams("lost=2"))).toBe("Leak: BTN RFI · EV lost ≥ 2bb");
  });
});
