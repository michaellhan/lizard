/// <reference types="node" />
// Grading imported decisions on the classic fixtures (solver/tests/data/hh), against canned answers shaped as the
// Advisor's (advisor.py: the charts' preflop actions, a library flop's with EVs): the request at each decision as
// the classic page sends it, your move matched to the answer's actions as index.html gradeWith does, and what is
// kept, its provenance included.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importHand, type ReplayedHand } from "@/hh/replay";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import { adviceStateAt, decisionsIn, gradeAgainst, gradedMove, gradeDecision, jamOffTree, matchMove, roleOf, situationAt, type Ask } from "./grading";

const HH = (f: string) => readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", f), "utf8");
const SRP = () => importHand(HH("stars_6max_srp.txt"));
const answer = (data: AdvisorResponse) => ({ data, provenance: provenanceOf(data, { mode: "fast", transport: "worker", solverVersion: "t", partial: false, now: 0 }) });
const CHART: AdvisorResponse = {
  street: "preflop",
  pot_bb: 1.5,
  actions: [{ action: "fold", freq: 0.1 }, { action: "raise", freq: 0.9, amount_bb: 2.5 }],
};
const LIB: AdvisorResponse = {
  street: "flop",
  pot_bb: 5.5,
  precomputed: { spot: "srp_btn_bb" },
  actions: [
    { action: "check", freq: 0.48, ev_bb: 3.1 },
    { action: "bet 33%", freq: 0.09, ev_bb: 3.0, amount_bb: 1.8 },
    { action: "bet 75%", freq: 0.43, ev_bb: 3.12, amount_bb: 4.1 },
  ],
};
// a hand of two seats, built by hand (only what the grading reads)
const hu = (stacks: Record<string, number>, preflop: ReplayedHand["lines"]["preflop"]): ReplayedHand =>
  ({
    hand: { players: 2, hero: "BB", hole: ["Ah", "Ad"], board: [], stack: stacks.BB, ante: 0, straddle: false },
    setup: { players: 2, stacks },
    lines: { preflop, flop: [], turn: [], river: [] },
    stopped: null,
    warnings: [],
  }) as unknown as ReplayedHand;

describe("the request at each of your decisions", () => {
  it("is the classic page's: your seat and stack, every seat's stack where they differ, the actions before it", () => {
    const r = SRP();
    expect(decisionsIn(r, "preflop")).toEqual([{ street: "preflop", i: 3 }]);
    expect(decisionsIn(r, "library")).toEqual([{ street: "preflop", i: 3 }, { street: "flop", i: 1 }]);
    const pre = adviceStateAt(r, "preflop", 3);
    expect(pre).toEqual({
      players: 6, hero: "BTN", hole: "AhQd", board: "", stack: 100,
      stacks: { UTG: 100, HJ: 143.27, CO: 100, BTN: 100, SB: 62.4, BB: 100 },
      preflop: [{ pos: "UTG", action: "fold" }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "fold" }], flop: [], turn: [], river: [],
    });
    const flop = adviceStateAt(r, "flop", 1);
    expect([flop.board, flop.flop, flop.library_only, flop.preflop?.at(3)]).toEqual(["Qs8d3c", [{ pos: "BB", action: "check" }], true, { pos: "BTN", action: "raise", to: 2.5 }]);
    // a bet is sent as its amount; a turn isn't asked of the library
    const turn = adviceStateAt(r, "turn", 1);
    expect([turn.flop?.[1], turn.library_only]).toEqual([{ pos: "BTN", action: "bet", amount: 1.8 }, undefined]);
    // the ante and the straddle go with it
    expect(adviceStateAt(importHand(HH("stars_9max_mtt_ante.txt")), "preflop", 5).ante).toBe(0.1);
    expect(adviceStateAt(importHand(HH("gg_straddle.txt")), "preflop", 4).straddle).toBe(true);
  });

  it("names the situation, and your role after the flop", () => {
    const r = SRP();
    expect(situationAt(r, "preflop", 3)).toEqual({ situation: "RFI", potType: "SRP", facing: true });
    expect(situationAt(r, "flop", 1)).toEqual({ situation: "SRP · IP · checked to", potType: "SRP", facing: false, ip: true, multi: false });
    expect(roleOf(r)).toBe("PFR");
    const tb = importHand(HH("stars_3bet_pot.txt"));
    expect(situationAt(tb, "preflop", 4).situation).toBe("BB defence");
    expect(situationAt(tb, "flop", 2)).toEqual({ situation: "3bet pot · OOP · facing bet", potType: "3bet pot", facing: true, ip: false, multi: false });
  });

  it("grades an all-in nobody can match in full as the call it is", () => {
    // BB's 50bb all-in facing a raise to 60: a call
    expect(gradedMove(hu({ SB: 100, BB: 50 }, [{ pos: "SB", action: "raise", to: 60 }, { pos: "BB", action: "all-in" }]), "preflop", 1)).toEqual({ pos: "BB", action: "call" });
    // facing a raise to 3 with 100bb each: an all-in
    expect(gradedMove(hu({ SB: 100, BB: 100 }, [{ pos: "SB", action: "raise", to: 3 }, { pos: "BB", action: "all-in" }]), "preflop", 1).action).toBe("all-in");
  });
});

describe("your move among the answer's actions", () => {
  it("preflop: the same action, the nearest raise, a move the chart leaves out played 0%", () => {
    expect(matchMove(CHART, { pos: "BTN", action: "raise", to: 2.5 })).toEqual({ actions: CHART.actions, index: 1 });
    expect(matchMove(CHART, { pos: "BTN", action: "raise", to: 3 })).toEqual({ actions: CHART.actions, index: 1 });
    expect(matchMove(CHART, { pos: "BTN", action: "raise", to: 4 })?.note).toBe("your raise to 4, graded as raise (2.5)");
    expect(matchMove(CHART, { pos: "BTN", action: "all-in" })).toMatchObject({ index: 1, note: "your all-in, graded as the chart's raise" });
    const limp = matchMove(CHART, { pos: "BTN", action: "call" })!;
    expect([limp.index, limp.actions.at(-1)]).toEqual([2, { action: "call", freq: 0 }]);
    // graded by frequency: no EV lost
    expect(gradeAgainst(CHART, { pos: "BTN", action: "call" })).toMatchObject({ grade: { verdict: "Mistake", byEv: false, loss: 0 }, matched: "call" });
    expect(gradeAgainst(CHART, { pos: "BTN", action: "fold" })!.grade.verdict).toBe("Correct");
  });

  it("after the flop: the nearest size, by EV; an all-in the answer has no all-in for is asked again", () => {
    const g = gradeAgainst(LIB, { pos: "BTN", action: "bet", to: 1.8 })!;
    expect([g.matched, g.grade.verdict, g.grade.byEv, g.pot]).toEqual(["bet 33%", "Mistake", true, 5.5]);
    expect(g.grade.loss).toBeCloseTo(0.12, 9);
    expect(gradeAgainst(LIB, { pos: "BTN", action: "bet", to: 4 })!.grade.verdict).toBe("Best");
    expect(matchMove(LIB, { pos: "BTN", action: "all-in" })).toBeNull();
    expect(jamOffTree(LIB, { pos: "BTN", action: "all-in" })).toBe(true);
    expect(jamOffTree(CHART, { pos: "BTN", action: "all-in" })).toBe(false);
  });
});

describe("gradeDecision", () => {
  const asking = (answers: AdvisorResponse[]) => {
    const asked: AdvisorState[] = [];
    const ask: Ask = async (s) => {
      asked.push(s);
      return answer(answers[asked.length - 1] ?? { error: "no answer" });
    };
    return { ask, asked };
  };

  it("keeps the grade with what it stands on: the charts by frequency, the library by EV", async () => {
    const r = SRP();
    const { ask } = asking([CHART, LIB]);
    const pre = await gradeDecision({ id: "h1" }, r, "preflop", 3, ask, 7);
    expect(pre).toMatchObject({
      id: "h1|preflop|3", handId: "h1", street: "preflop", i: 3, pos: "BTN", action: "raise to 2.5", situation: "RFI", potType: "SRP",
      verdict: "Best", evLossBb: null, lossPct: null, byEv: false, freq: 0.9, matched: "raise", best: "raise", bestFreq: 0.9, pot: 1.5,
      source: "charts", label: "Preflop charts · approximate", gradedAt: 7,
    });
    const flop = await gradeDecision({ id: "h1" }, r, "flop", 1, ask, 7);
    expect(flop).toMatchObject({ verdict: "Mistake", evLossBb: 0.12, lossPct: 2.2, byEv: true, matched: "bet 33%", best: "check", bestFreq: 0.48, source: "library", situation: "SRP · IP · checked to", facing: false, ip: true, multi: false, role: "PFR" });
    expect(flop.label).toMatch(/^Precomputed solution · srp_btn_bb/);
    expect(flop.mix).toEqual([["check", 0.48, 3.1], ["bet 33%", 0.09, 3], ["bet 75%", 0.43, 3.12]]);
  });

  it("says why a decision isn't graded: not a library flop, an answer by the rules, an error", async () => {
    const r = SRP();
    const skip = await gradeDecision({ id: "h" }, r, "flop", 1, asking([{ skipped: "not a flop-library spot" }]).ask);
    expect([skip.verdict, skip.why, skip.evLossBb]).toEqual(["Not graded", "not a flop-library spot", null]);
    const rules = await gradeDecision({ id: "h" }, r, "flop", 1, asking([{ ...LIB, precomputed: undefined, fallback: "rules", fallback_reason: "x" }]).ask);
    expect([rules.verdict, rules.source]).toEqual(["Not graded", "rules"]);
    expect(rules.why).toMatch(/^answered by Heuristic rules \(not a solve\)/);
    const err = await gradeDecision({ id: "h" }, r, "preflop", 3, asking([{ error: "boom" }]).ask);
    expect(err.why).toBe("the solver couldn't answer (boom)");
    await expect(gradeDecision({ id: "h" }, r, "preflop", 3, asking([{ cancelled: true }]).ask)).rejects.toThrow("cancelled");
  });

  it("asks again with jam where your all-in isn't in the answer", async () => {
    // the hero's flop bet made an all-in
    const r = SRP();
    r.lines.flop[1] = { pos: "BTN", action: "all-in" };
    const jam = { ...LIB, actions: [...LIB.actions!, { action: "all-in", freq: 0, ev_bb: 1.5, amount_bb: 97.5 }] };
    const { ask, asked } = asking([LIB, jam]);
    const d = await gradeDecision({ id: "h" }, r, "flop", 1, ask);
    expect(asked.map((s) => s.jam)).toEqual([undefined, true]);
    expect([d.verdict, d.matched, d.evLossBb]).toEqual(["Blunder", "all-in", 1.62]);
  });
});
