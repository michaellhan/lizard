/// <reference types="node" />
// A leak's drill (leakDrill.ts): which decisions it deals and in what order, the action before each, a pick graded
// as the decision was (by EV from the library, by frequency from the charts), and the progress kept as a session.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { addScore, emptyScore } from "@/grading/grade";
import { importHand } from "@/hh/replay";
import { drillItems, drillSessionId, fromSession, gradePick, leakDrillAbout, leakDrillLink, leakParam, lineBefore, parseLeakParam, toSession } from "./leakDrill";

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
    const g = gradePick(lib, 1);
    expect([g.byEv, g.verdict, Math.round(g.loss * 100) / 100]).toEqual([true, "Mistake", 0.12]);
    expect(gradePick(lib, 2)).toMatchObject({ byEv: true, verdict: "Best", ok: true });
    const chart = d({ mix: [["fold", 0.2, null], ["raise", 0.8, null], ["call", 0, null]] });
    expect(gradePick(chart, 1)).toMatchObject({ byEv: false, ok: true });
    expect(gradePick(chart, 2)).toMatchObject({ byEv: false, ok: false });
  });

  it("keeps the progress as an analysis session and reads it back", () => {
    const l = { kind: "pf", key: "RFI" } as const;
    const score = addScore(emptyScore(), { ok: false, loss: 0, lossPct: 0, byEv: false });
    const s = toSession(l, { startedAt: 10, done: ["d1"], score }, 5, 20);
    expect(s).toMatchObject({ id: "leak-drill|pf:RFI", kind: "analysis", startedAt: 10, endedAt: 20, decisions: 1, meta: { drill: "leak", leak: "pf:RFI", total: 5, done: ["d1"] } });
    expect(fromSession(s)).toEqual({ startedAt: 10, done: ["d1"], score });
    expect([fromSession(undefined), fromSession({ ...s, meta: {} })]).toEqual([null, null]);
  });

  it("keeps a leak's drill as a link: the leak and the hands' filters, nothing else of the page", () => {
    const leak = { kind: "pf" as const, key: "BTN RFI" };
    const params = new URLSearchParams({ hand: "PokerStars|1|AhKd", pos: "BTN", bb: "0.5/1", q: "suited", drill: "freq:x", page: "2" });
    expect(leakDrillLink(leak, params)).toBe("/analyze?drill=pf%3ABTN+RFI&pos=BTN&bb=0.5%2F1&q=suited");
    expect(leakDrillAbout(leak, params)).toBe("Leak: BTN RFI · your seat BTN, stakes 0.5/1, search suited");
    expect([leakDrillLink(leak, new URLSearchParams()), leakDrillAbout(leak, new URLSearchParams())]).toEqual(["/analyze?drill=pf%3ABTN+RFI", "Leak: BTN RFI"]);
  });
});
