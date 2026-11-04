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
import type { DecisionRecord, HandRecord } from "@/data/db";
import {
  adviceStateAt,
  answeredIds,
  decisionsIn,
  deepened,
  gradeAgainst,
  gradedMove,
  gradeDecision,
  gradeHands,
  jamOffTree,
  matchMove,
  offText,
  roleOf,
  situationAt,
  type Ask,
} from "./grading";

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

  it("a rough or cut-short solve can't condemn a line: it stops at an Inaccuracy, its EV kept", async () => {
    const r = SRP();
    const solve = (solver: AdvisorResponse["solver"]): AdvisorResponse => ({
      street: "flop",
      pot_bb: 5.5,
      solver,
      actions: [{ action: "check", freq: 0.98, ev_bb: 3 }, { action: "bet 33%", freq: 0.02, ev_bb: 2.5, amount_bb: 1.8 }],
    });
    const scoped = (a: AdvisorResponse) => gradeDecision({ id: "h" }, r, "flop", 1, asking([a]).ask, 7, "all");
    const settled = await scoped(solve({ iterations: 300, exploitability_pct: 2 }));
    expect([settled.verdict, settled.capped, settled.evLossBb]).toEqual(["Blunder", undefined, 0.5]);
    // (fair isn't rough: under 10% of the pot it may still condemn)
    expect((await scoped(solve({ iterations: 300, exploitability_pct: 9 }))).verdict).toBe("Blunder");
    const rough = await scoped(solve({ iterations: 300, exploitability_pct: 14 }));
    expect([rough.verdict, rough.capped, rough.evLossBb, rough.band]).toEqual(["Inaccuracy", true, 0.5, "rough"]);
    const short = await scoped(solve({ iterations: 40, exploitability_pct: 2, approximate: true }));
    expect([short.verdict, short.capped, short.band]).toEqual(["Inaccuracy", true, "approximate"]);
    // (a grade already milder stays what it is)
    const mild = { ...solve({ iterations: 300, exploitability_pct: 14 }), actions: [{ action: "check", freq: 0.5, ev_bb: 3 }, { action: "bet 33%", freq: 0.5, ev_bb: 2.5, amount_bb: 1.8 }] };
    const correct = await scoped(mild);
    expect([correct.verdict, correct.capped]).toEqual(["Correct", undefined]);
  });

  it("keeps the pot of a decision it couldn't grade", async () => {
    const d = await gradeDecision({ id: "h" }, SRP(), "flop", 1, asking([{ error: "boom" }]).ask);
    expect([d.verdict, d.pot]).toEqual(["Not graded", 5.5]);
  });

  it("says what stands behind the ranges, a rare line solved again from there included", () => {
    const o = { why: "rare", pos: "BB", action: "raise", street: "flop", share: 1.2 };
    expect(offText({ off_solution: [o] })).toBe("BB's raise on the flop is only 1.2% in the solve, so their range from there is the betting rules'");
    expect(offText({ off_solution: [{ ...o, resolved: true }] })).toBe("BB's raise on the flop is only 1.2% in the solve, so their range from there is the betting rules' and the play after it is solved again from there");
  });
});

describe("turns and rivers", () => {
  const LIVE: AdvisorResponse = {
    street: "turn",
    pot_bb: 9.1,
    solver: { iterations: 300, exploitability_pct: 0.8 },
    actions: [{ action: "check", freq: 0.7, ev_bb: 3 }, { action: "bet 33%", freq: 0.1, ev_bb: 2.9, amount_bb: 3 }, { action: "bet 75%", freq: 0.2, ev_bb: 2.5, amount_bb: 6.8 }],
  };
  const tri = (source: string, confidence: "high" | "medium" | "low", label = source) => ({ triage: { source, confidence, label } });
  const once = (data: AdvisorResponse): Ask => async () => answer(data);
  const hand = { id: "h" };

  it("every street is in the wider scopes, and each scope asks its own way", () => {
    const r = SRP();
    expect(decisionsIn(r, "library").map((d) => d.street)).toEqual(["preflop", "flop"]);
    for (const scope of ["triage", "all"] as const) expect(decisionsIn(r, scope)).toEqual([{ street: "preflop", i: 3 }, { street: "flop", i: 1 }, { street: "turn", i: 1 }, { street: "river", i: 1 }]);
    for (const [street, i] of [["preflop", 3], ["flop", 1], ["turn", 1], ["river", 1]] as const) {
      expect(adviceStateAt(r, street, i, "triage")).toMatchObject({ triage: true });
      expect(adviceStateAt(r, street, i, "triage").library_only).toBeUndefined();
      expect(adviceStateAt(r, street, i, "all").triage).toBeUndefined();
      expect(adviceStateAt(r, street, i, "all").library_only).toBeUndefined();
    }
    expect(adviceStateAt(r, "turn", 1).board).toBe("Qs8d3c7h");
  });

  it("a Quick solve grades by EV and says it's Quick, how settled, and how far to trust it", async () => {
    const d = await gradeDecision(hand, SRP(), "turn", 1, once({ ...LIVE, ...tri("quick", "medium", "a Quick solve (300 iterations, 0.8% of the pot from equilibrium)") }), 0, "triage");
    expect([d.verdict, d.source, d.confidence, d.triageSource, d.byEv, d.pot]).toEqual([d.verdict, "live", "medium", "quick", true, 9.1]);
    expect(d.verdict).not.toBe("Not graded");
    expect(d.label).toBe("Live solve (Quick) · 0.80% pot from equilibrium in the solved game (converged) · 300 iterations · medium confidence");
    expect(d.band).toBe("converged");
    expect(d.approximate).toBeUndefined();
    // at Fast the same answer has no triage mark at all
    const fast = await gradeDecision(hand, SRP(), "turn", 1, once(LIVE), 0, "all");
    expect([fast.confidence, fast.triageSource]).toEqual([undefined, undefined]);
    expect(fast.label).toBe("Live solve · 0.80% pot from equilibrium in the solved game (converged) · 300 iterations");
  });

  it("the rest of a triage's reads: a stored turn and a read at once by frequency where they have no EVs, the rules never", async () => {
    const noEv = LIVE.actions!.map((a) => ({ ...a, ev_bb: null }));
    const stored = await gradeDecision(hand, SRP(), "turn", 1, once({ ...LIVE, solver: undefined, actions: noEv, approximate: { source: "store", label: "the flop's stored turn" }, ...tri("approx", "medium") }), 0, "triage");
    expect([stored.source, stored.byEv, stored.evLossBb, stored.confidence, stored.approximate]).toEqual(["library-turn", false, null, "medium", true]);
    expect(stored.label).toContain("Stored turn from the flop library · the flop's stored turn · approximate · medium confidence");
    const near = await gradeDecision(hand, SRP(), "turn", 1, once({ ...LIVE, solver: undefined, actions: noEv, approximate: { source: "near", label: "the nearest stored flops" }, ...tri("approx", "low") }), 0, "triage");
    expect([near.source, near.confidence, near.evLossBb]).toEqual(["instant", "low", null]);
    for (const data of [{ ...LIVE, fallback: "rules", ...tri("rules", "low") }, { ...LIVE, solver: undefined, multiway: true, solved: false, ...tri("rules", "low") }]) {
      const d = await gradeDecision(hand, SRP(), "turn", 1, once(data), 0, "triage");
      expect([d.verdict, d.source, d.evLossBb, d.mix]).toEqual(["Not graded", "rules", null, undefined]);
      expect(d.why).toContain("which isn't graded against");
    }
    const equity = await gradeDecision(hand, SRP(), "turn", 1, once({ ...LIVE, fallback: "equity" }), 0, "all");
    expect([equity.verdict, equity.source]).toEqual(["Not graded", "equity"]);
    // nor may a scope that solves nothing stand on a solve
    const narrow = await gradeDecision(hand, SRP(), "flop", 1, once({ ...LIVE, street: "flop" }), 0, "library");
    expect([narrow.verdict, narrow.source]).toEqual(["Not graded", "live"]);
    expect(narrow.why).toContain("not the charts or the library");
  });

  it("an error at triage is a low read to check; a skip isn't a read", async () => {
    const err = await gradeDecision(hand, SRP(), "turn", 1, once({ error: "boom" }), 0, "triage");
    expect([err.verdict, err.source, err.confidence, err.triageSource]).toEqual(["Not graded", "", "low", undefined]);
    const skip = await gradeDecision(hand, SRP(), "flop", 1, once({ skipped: "not in the library" }), 0, "library");
    expect([skip.verdict, skip.confidence]).toEqual(["Not graded", undefined]);
  });

  it("keeps what the turn's frequencies need, a rough EV and ranges that aren't the solve's", async () => {
    const r = SRP();
    const d = await gradeDecision(hand, r, "turn", 1, once({ ...LIVE, actions: LIVE.actions!.map((a) => ({ ...a, rough_ev: true })), off_solution: [{ why: "rules", street: "flop" }] }), 0, "all");
    expect([d.flopAggr, d.roughEv, d.off]).toEqual([true, true, "the flop is narrowed by the betting rules, not solved"]);
    const flop = await gradeDecision(hand, r, "flop", 1, once({ ...LIVE, street: "flop" }), 0, "all");
    expect(flop.flopAggr).toBeUndefined();
    expect(offText({})).toBeNull();
    expect(offText({ off_solution: [{ pos: "BB", action: "call", street: "flop", why: "rare", share: 0 }, { street: "turn", trust: 40 }] })).toBe(
      "BB's call on the flop is never in the solve, so their range from there is the betting rules'; the turn solve hadn't settled, so ranges follow it 40% and the betting rules the rest",
    );
  });

  it("what's asked again, and a check at Fast", async () => {
    const graded = { id: "a", verdict: "Best", source: "charts" } as DecisionRecord;
    const rules = { id: "b", verdict: "Not graded", source: "rules" } as DecisionRecord;
    const skipped = { id: "c", verdict: "Not graded", source: "" } as DecisionRecord;
    expect([...answeredIds([graded, rules, skipped])]).toEqual(["a", "b"]);
    const read = { id: "r", verdict: "Mistake", source: "instant", label: "read", confidence: "low", triageSource: "approx", evLossBb: null, freq: 0.01 } as DecisionRecord;
    const fast = { id: "r", verdict: "Best", source: "live", label: "Live solve", evLossBb: 0 } as DecisionRecord;
    expect(deepened(read, fast)).toEqual({ ...fast, read: { verdict: "Mistake", source: "instant", label: "read", confidence: "low", triageSource: "approx", evLossBb: null, freq: 0.01, mix: read.mix } });
    // an answer at Fast that can't grade the move doesn't take the read's place
    // (and when it was asked, or restoring a backup keeps the copy without the note)
    expect(deepened(read, { ...fast, verdict: "Not graded", why: "no answer", gradedAt: 9 })).toEqual({ ...read, notChecked: "no answer", gradedAt: 9 });
  });

  it("a run checks only the reads it's given, in the order played, and leaves the rest", async () => {
    const r = HH("stars_6max_srp.txt");
    const h = { id: "h", text: r } as HandRecord;
    const asked: AdvisorState[] = [];
    const ask: Ask = async (s) => {
      asked.push(s);
      return answer(LIVE);
    };
    const read = { id: "h|river|1", handId: "h", street: "river", verdict: "Mistake", source: "live", label: "Quick", confidence: "low", evLossBb: 1 } as DecisionRecord;
    const turn = { ...read, id: "h|turn|1", street: "turn" };
    const out: DecisionRecord[] = [];
    const run = await gradeHands([h], "all", new Set(), ask, { deepen: new Map([[read.id, read], [turn.id, turn]]), onHand: (_k, _n, ds) => void out.push(...ds), pause: async () => {} });
    expect(run).toEqual({ graded: 2, hands: 1, stopped: false });
    expect(asked.map((s) => [s.board?.length, s.triage])).toEqual([[8, undefined], [10, undefined]]);
    expect(out.map((d) => [d.id, d.read?.verdict])).toEqual([["h|turn|1", "Mistake"], ["h|river|1", "Mistake"]]);
  });
});
