// Quick triage's second pass and clock, on the classic analyzer's cases (solver/tests/js/session.test.js "Quick
// triage"): what's flagged, the order of a check at Fast, and the estimates.
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { deepenPlan, estimate, flagged, fmtDur, secondsLeft, toAsk } from "./triage";

const read = (o: Partial<DecisionRecord>): DecisionRecord => ({
  id: "h|turn|0",
  handId: "h",
  street: "turn",
  pos: "BTN",
  action: "check",
  verdict: "Best",
  evLossBb: 0,
  source: "live",
  label: "x",
  confidence: "medium",
  pot: 8,
  gradedAt: 0,
  ...o,
});

describe("what's flagged for Fast", () => {
  it("as the classic cases: the charts and the library's own spot never, a medium read in the mix not, the doubtful ones", () => {
    expect(flagged(read({ source: "charts", confidence: "high" }))).toBe(false);
    // (off the mix, but Fast says the same)
    expect(flagged(read({ source: "library", confidence: "high", verdict: "Mistake" }))).toBe(false);
    expect(flagged(read({ source: "instant", verdict: "Correct", evLossBb: null }))).toBe(false);
    expect(flagged(read({ source: "instant", verdict: "Correct", evLossBb: null, confidence: "low" }))).toBe(true);
    expect(flagged(read({ verdict: "Inaccuracy" }))).toBe(true);
    // 0.2bb of an 8bb pot: 2.5%, in the mix or not
    expect(flagged(read({ verdict: "Correct", evLossBb: 0.2 }))).toBe(true);
    expect(flagged(read({ verdict: "Correct", evLossBb: 0.1 }))).toBe(false);
  });

  it("every: all that Fast could answer otherwise", () => {
    expect(flagged(read({}), true)).toBe(true);
    expect(flagged(read({ source: "library", confidence: "medium", approximate: true }), true)).toBe(true);
    expect(flagged(read({ source: "library", confidence: "high" }), true)).toBe(false);
  });

  it("not what isn't a triage read, nor what's been checked; the rules, an error and a move the read lacks, yes", () => {
    expect(flagged(read({ confidence: undefined, verdict: "Mistake" }), true)).toBe(false);
    expect(flagged(read({ read: { verdict: "Mistake", source: "live", label: "x", evLossBb: 1 }, verdict: "Mistake" }), true)).toBe(false);
    // (Fast solves what Quick leaves to the rules, a 4-way flop in the browser; a spot Fast leaves to them too is asked once)
    expect(flagged(read({ verdict: "Not graded", source: "rules", triageSource: "rules", confidence: "low" }))).toBe(true);
    expect(flagged(read({ verdict: "Not graded", source: "rules", triageSource: "rules", confidence: "low", notChecked: "the rules again" }))).toBe(false);
    expect(flagged(read({ verdict: "Not graded", source: "", confidence: "low" }))).toBe(true);
    expect(flagged(read({ verdict: "Not graded", source: "live", triageSource: "quick", confidence: "low" }))).toBe(true);
    // one Fast couldn't grade isn't asked again, unless every read is
    expect(flagged(read({ confidence: "low", notChecked: "no answer" }))).toBe(false);
    expect(flagged(read({ confidence: "low", notChecked: "no answer" }), true)).toBe(true);
  });
});

describe("a check at Fast", () => {
  it("takes the hands with the biggest flagged pots first, and only hands still kept", () => {
    const hands = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] as HandRecord[];
    const low = { confidence: "low" as const };
    const ds = [
      read({ ...low, id: "a|flop|0", handId: "a", street: "flop", pot: 5 }),
      read({ ...low, id: "b|turn|0", handId: "b", pot: 20 }),
      read({ ...low, id: "c|river|0", handId: "c", street: "river", pot: 5 }),
      read({ id: "d|turn|0", handId: "d", pot: 100 }),
      read({ ...low, id: "gone|turn|0", handId: "gone", pot: 500 }),
    ];
    const p = deepenPlan(hands, ds);
    expect(p.hands.map((h) => h.id)).toEqual(["b", "a", "c"]);
    expect([...p.reads.keys()].sort()).toEqual(["a|flop|0", "b|turn|0", "c|river|0"]);
    expect(p.left).toEqual({ preflop: 0, flop: 1, turn: 1, river: 1 });
    expect(deepenPlan(hands, ds, true).hands.map((h) => h.id)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("the clock", () => {
  it("the classic estimates", () => {
    expect(estimate("preflop", "triage")).toBe(0.02);
    expect(estimate("preflop", "all")).toBe(0.2);
    expect(estimate("flop", "library")).toBe(0.4);
    expect(estimate("turn", "triage")).toBe(1.2);
    // at Fast in the browser (8 s, 3 s): 70% of the street and its flop's, the street's own answer and overhead
    expect(estimate("turn", "all", [8, 3])).toBeCloseTo(0.7 * 11 + 0.3);
    expect(estimate("river", "all", [8, 3])).toBeCloseTo(0.15 * 14 + 0.3);
    expect(estimate("flop", "all", [8, 3])).toBeCloseTo(0.3 * 8 + 0.3);
    // 8 threads: the classic's measured shares, in between geometrically
    expect(estimate("turn", "all", [8, 3], 8)).toBeCloseTo(8 * 0.28);
    expect(estimate("turn", "triage", [8, 3], 8)).toBeCloseTo(1.2 * 0.92);
    expect(estimate("flop", "triage", [8, 3], 4.5)).toBeCloseTo(0.6 * Math.sqrt(0.38));
  });

  it("follows the pace measured once a street has two answers", () => {
    const left = { preflop: 10, flop: 2, turn: 3, river: 0 };
    const est = 10 * 0.02 + 2 * 0.6 + 3 * 1.2;
    expect(secondsLeft(left, {}, "triage", [8, 3])).toBeCloseTo(est);
    expect(secondsLeft(left, { turn: [3, 1] }, "triage", [8, 3])).toBeCloseTo(est);
    expect(secondsLeft(left, { turn: [10, 2] }, "triage", [8, 3])).toBeCloseTo(10 * 0.02 + 2 * 0.6 + 3 * 5);
  });

  it("says a time", () => {
    expect([0.4, 40, 90, 3600 + 25 * 60].map(fmtDur)).toEqual(["under a second", "40 s", "2 min", "1 h 25 min"]);
  });

  it("counts what a run would ask, by street, leaving what's answered", async () => {
    const hand = await import("node:fs").then((fs) => fs.readFileSync(`${process.cwd()}/../solver/tests/data/hh/stars_6max_srp.txt`, "utf8"));
    const hands = [{ id: "h", text: hand }, { id: "bad", text: "not a hand" }] as HandRecord[];
    expect(await toAsk(hands, "triage", new Set())).toEqual({ preflop: 1, flop: 1, turn: 1, river: 1 });
    expect(await toAsk(hands, "library", new Set(["h|preflop|3"]))).toEqual({ preflop: 0, flop: 1, turn: 0, river: 0 });
    const stop = new AbortController();
    stop.abort();
    expect(await toAsk(hands, "all", new Set(), { signal: stop.signal })).toBeNull();
  });
});
