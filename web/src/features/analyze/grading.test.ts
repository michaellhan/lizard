/// <reference types="node" />
// Grading imported decisions on the classic fixtures (solver/tests/data/hh), against canned answers shaped as the
// Advisor's (advisor.py: the charts' preflop actions, a library flop's with EVs): the request at each decision as
// the classic page sends it, your move matched to the answer's actions as index.html gradeWith does, and what is
// kept, its provenance included.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importHand, type ReplayedHand } from "@/hh/replay";
import nodes from "@/test/fixtures/pf_nodes.json";
import { practiceRecord } from "@/features/practice/history";
import { gradedOn, PF_MODEL } from "@/features/practice/pfGrade";
import { decide, finish, newHand, setupOf, withVillain, type PracticeHand, type TournamentOptions } from "@/features/practice/practice";
import { readDraft, stageDraft } from "@/features/practice/TournamentFields";
import { FINAL_TABLE_SET, FORMAT_PRESETS, STAGE_PRESETS } from "@/features/tournaments/tournament";
import { seatsOf } from "@/poker/seats";
import type { Move } from "@/poker/table";
import { SolverError, type Provenance } from "@/solver/types";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import type { DecisionRecord, HandRecord } from "@/data/db";
import {
  adviceStateAt,
  answeredIds,
  decisionsIn,
  deepened,
  earlierAt,
  fillEarlier,
  lacksEarlier,
  gradeAgainst,
  gradedMove,
  gradeDecision,
  gradeHands,
  jamOffTree,
  matchMove,
  offText,
  pfOut,
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
    // a decision made after Reveal in Practice isn't one to grade: the answer was seen
    expect(decisionsIn(r, "library", undefined, ["flop|1"])).toEqual([{ street: "preflop", i: 3 }]);
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
    // a Practice hand's rake goes with the question; a history alone has none to send
    expect(adviceStateAt(r, "flop", 1, "library", { rake: 5, rakeCap: 3 })).toMatchObject({ rake: 0.05, rake_cap: 3 });
    expect(adviceStateAt(r, "flop", 1, "library", { rake: 4.5 })).toMatchObject({ rake: 0.045 });
    expect(adviceStateAt(r, "flop", 1, "library", { rake: 4.5 }).rake_cap).toBeUndefined();
    expect(adviceStateAt(r, "flop", 1).rake).toBeUndefined();
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

  it("stamps a grade with what graded it, and says nothing where it can't tell", async () => {
    const r = SRP();
    const on = (data: AdvisorResponse, p: Partial<ReturnType<typeof answer>["provenance"]> = {}): Ask => async () => {
      const a = answer(data);
      return { ...a, provenance: { ...a.provenance, ...p } };
    };
    // (the charts come with the solver build)
    expect((await gradeDecision({ id: "h" }, r, "preflop", 3, on(CHART))).version).toBe("build:t");
    const stored = await gradeDecision({ id: "h" }, r, "flop", 1, on(LIB, { libraryVersion: "library:srp_btn_bb:11112222:Qs8d3c:abc" }));
    expect(stored.version).toBe("library:srp_btn_bb:11112222:Qs8d3c:abc");
    // a stored answer whose index couldn't be read has no build to stand in for it; nor does a local server or a dev build
    expect((await gradeDecision({ id: "h" }, r, "flop", 1, on(LIB))).version).toBeUndefined();
    expect((await gradeDecision({ id: "h" }, r, "preflop", 3, on(CHART, { transport: "http" }))).version).toBeUndefined();
    expect((await gradeDecision({ id: "h" }, r, "preflop", 3, on(CHART, { solverVersion: "dev" }))).version).toBeUndefined();
    expect(await gradeDecision({ id: "h" }, r, "flop", 1, on({ skipped: "not a flop-library spot" }))).not.toHaveProperty("version");
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

  it("doesn't grade by EV an answer that gives no pot: every loss would read as an Inaccuracy", async () => {
    const r = SRP();
    const answer = (pot: Partial<AdvisorResponse>): AdvisorResponse => ({ street: "flop", solver: { iterations: 300, exploitability_pct: 2 }, ...pot, actions: [{ action: "check", freq: 0.98, ev_bb: 30 }, { action: "bet 33%", freq: 0.02, ev_bb: 2, amount_bb: 1.8 }] });
    for (const a of [answer({}), answer({ pot_bb: 0 })]) {
      expect(gradeAgainst(a, { pos: "BTN", action: "bet", to: 1.8 })).toBeNull();
      const d = await gradeDecision({ id: "h" }, r, "flop", 1, asking([a]).ask, 7, "all");
      expect([d.verdict, d.evLossBb, d.lossPct, d.why]).toEqual(["Not graded", null, null, "the answer gave no pot to measure the EV lost against"]);
    }
    // (by frequency an answer needs no pot; with one it grades by EV as ever)
    expect(gradeAgainst({ ...answer({}), actions: [{ action: "check", freq: 1 }, { action: "bet 33%", freq: 0, amount_bb: 1.8 }] }, { pos: "BTN", action: "bet", to: 1.8 })?.grade.byEv).toBe(false);
    expect(gradeAgainst(answer({ pot_bb: 5.5 }), { pos: "BTN", action: "bet", to: 1.8 })?.grade.verdict).toBe("Blunder");
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
    for (const scope of ["triage", "all", "accurate"] as const) expect(decisionsIn(r, scope)).toEqual([{ street: "preflop", i: 3 }, { street: "flop", i: 1 }, { street: "turn", i: 1 }, { street: "river", i: 1 }]);
    for (const [street, i] of [["preflop", 3], ["flop", 1], ["turn", 1], ["river", 1]] as const) {
      expect(adviceStateAt(r, street, i, "triage")).toMatchObject({ triage: true });
      expect(adviceStateAt(r, street, i, "triage").library_only).toBeUndefined();
      expect(adviceStateAt(r, street, i, "all").triage).toBeUndefined();
      expect(adviceStateAt(r, street, i, "all").library_only).toBeUndefined();
      expect(adviceStateAt(r, street, i, "accurate")).not.toHaveProperty("library_only");
      expect(adviceStateAt(r, street, i, "accurate")).not.toHaveProperty("triage");
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

  it("keeps the mix and the pot on a turn and a river at Quick and at Fast, so a drill can deal them, and which EVs are rough", async () => {
    const r = SRP();
    for (const street of ["turn", "river"] as const)
      for (const [mode, data] of [["triage", { ...LIVE, street, ...tri("quick", "medium") }], ["all", { ...LIVE, street }]] as const) {
        const d = await gradeDecision(hand, r, street, 1, once(data), 0, mode);
        expect(d.mix).toEqual([["check", 0.7, 3], ["bet 33%", 0.1, 2.9], ["bet 75%", 0.2, 2.5]]);
        expect(d.pot).toBe(9.1);
      }
    const rough = await gradeDecision(hand, r, "turn", 1, once({ ...LIVE, actions: [{ ...LIVE.actions![0]!, rough_ev: true }, ...LIVE.actions!.slice(1)] }), 0, "all");
    expect(rough.roughEvs).toEqual(["check"]);
    expect((await gradeDecision(hand, r, "turn", 1, once(LIVE), 0, "all")).roughEvs).toBeUndefined();
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

  it("grades nothing Practice played for you: not in a scope, a run or a preflop-only one", async () => {
    const text = HH("stars_6max_srp.txt");
    const r = importHand(text);
    expect(decisionsIn(r, "preflop", "preflop")).toEqual([]);
    expect(decisionsIn(r, "library", "preflop")).toEqual([{ street: "flop", i: 1 }]);
    expect(decisionsIn(r, "all", "preflop").map((d) => d.street)).toEqual(["flop", "turn", "river"]);

    const h = { id: "h", text, playedFor: "preflop" } as HandRecord;
    const asked: AdvisorState[] = [];
    const ask: Ask = async (s) => {
      asked.push(s);
      return answer(LIVE);
    };
    const pause = async () => {};
    expect(await gradeHands([h], "preflop", new Set(), ask, { pause })).toEqual({ graded: 0, hands: 1, stopped: false });
    expect(asked).toEqual([]);
    const run = await gradeHands([h], "all", new Set(), ask, { pause });
    expect(run.graded).toBe(3);
    expect(asked.every((s) => s.board)).toBe(true);
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

describe("preflop by the stored solve", () => {
  const NODES = nodes as unknown as Record<"first" | "opened" | "offSize" | "other" | "unsolved", AdvisorResponse>;
  const CHART_OPENED: AdvisorResponse = { street: "preflop", pot_bb: 4, actions: [{ action: "fold", freq: 0.1 }, { action: "call", freq: 0.6 }, { action: "raise", freq: 0.3, amount_bb: 7.5 }] };
  const CHART_BB: AdvisorResponse = { street: "preflop", pot_bb: 4, actions: [{ action: "raise", freq: 0.2, amount_bb: 10 }, { action: "call", freq: 0.7 }, { action: "fold", freq: 0.1 }] };
  const CHART_P: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "1", partial: false, receivedAt: 0 };
  const OPEN: Move[] = [{ pos: "UTG", action: "raise", to: 2.5 }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "fold" }];
  const TO_BB: Move[] = [{ pos: "BTN", action: "fold" }, { pos: "SB", action: "fold" }];
  const BEHIND: Move[] = [{ pos: "SB", action: "fold" }, { pos: "BB", action: "fold" }, { pos: "UTG", action: "fold" }];

  /** the chart, then the node; what was asked; a throw or an answer in place of the node */
  const pair = (chart: AdvisorResponse, node: AdvisorResponse | Error) => {
    const asked: AdvisorState[] = [];
    const ask: Ask = async (s) => {
      asked.push(s);
      if (!s.preflop_solve) return answer(chart);
      if (node instanceof Error) throw node;
      return answer(node);
    };
    return { ask, asked };
  };
  const table = (hero: string, line: Move[], opts = {}): PracticeHand => {
    let h: PracticeHand = { ...newHand(6, 100, 0, 7, { pfSolve: true, ...opts }), hero };
    for (const m of line) h = withVillain(h, m);
    return h;
  };
  /** the hand as the table played it, your move by the option `i` of what graded it, then kept as Practice keeps it */
  const kept = (h: PracticeHand, chart: AdvisorResponse, node: AdvisorResponse, i: number, rest: Move[] = []) => {
    const on = gradedOn(h, { data: chart, provenance: CHART_P, pf: answer(node) });
    const r = decide(h, on.data, i, on.provenance, undefined, on.pfWhy);
    if ("error" in r) throw new Error(r.error);
    const after = rest.reduce<PracticeHand>((x, m) => withVillain(x, m), r.hand);
    const rec = practiceRecord({ ...after, result: finish(after) }, { id: "s", startedAt: 1 }, new Date(2));
    return { rec, replayed: importHand(rec.text), table: r.decision, on };
  };
  const yours = (r: ReplayedHand) => r.lines.preflop.findIndex((m) => m.pos === r.hand.hero);
  // a site's hand of the stored game (only what the grading reads)
  const site = (line: Move[], hero = "BTN"): ReplayedHand =>
    ({
      hand: { players: 6, hero, hole: ["Ah", "Kd"], board: [], stack: 100, ante: 0, straddle: false },
      setup: setupOf(newHand(6, 100, 0, 7)),
      lines: { preflop: line, flop: [], turn: [], river: [] },
      stopped: null,
      warnings: [],
    }) as unknown as ReplayedHand;

  it("gives a kept Practice hand the grade the table gave it", async () => {
    const { rec, replayed, table: d } = kept(table("BTN", OPEN), CHART_OPENED, NODES.opened, 2, BEHIND);
    const { ask, asked } = pair(CHART_OPENED, NODES.opened);
    const g = await gradeDecision(rec, replayed, "preflop", yours(replayed), ask);
    expect(g).toMatchObject({ source: "preflop-solve", byEv: true, pot: d.pot, verdict: d.grade!.verdict, evLossBb: Math.round(d.grade!.loss * 100) / 100 });
    expect(g.mix!.map((m) => m[0])).toEqual(d.mix.map((m) => m.action));
    expect(g.mix!.map((m) => m[2])).toEqual(d.mix.map((m) => m.ev));
    expect(g.pfWhy).toBeUndefined();
    expect(g.note).toBeUndefined();
    // read, never run, and never a chart under its name
    expect(asked[1]).toMatchObject({ study: true, preflop_solve: true });
    expect(asked[1]).not.toHaveProperty("run");
    expect(asked[1]).not.toHaveProperty("triage");
    expect(g.label).toContain("Preflop solve (class-level model)");
    expect(g.label).toContain(PF_MODEL);
  });
  it("asks a raked hand's own stored game", async () => {
    const { rec, replayed } = kept(table("BTN", OPEN, { rake: 5, rakeCap: 3 }), CHART_OPENED, NODES.opened, 2, BEHIND);
    const { ask, asked } = pair(CHART_OPENED, NODES.opened);
    await gradeDecision(rec, replayed, "preflop", yours(replayed), ask);
    expect(asked[1]).toMatchObject({ preflop_solve: true, rake: 0.05, rake_cap: 3 });
  });
  it("leaves a spot the table left to the chart to the chart, labelled so, and says why", async () => {
    const { rec, replayed, table: d, on } = kept(table("BB", [...OPEN, ...TO_BB]), CHART_BB, NODES.offSize, 2);
    expect(d.provenance!.source).toBe("charts");
    const { ask } = pair(CHART_BB, NODES.offSize);
    const g = await gradeDecision(rec, replayed, "preflop", yours(replayed), ask);
    expect(g).toMatchObject({ source: "charts", byEv: false, evLossBb: null, verdict: d.grade!.verdict, pfWhy: on.pfWhy });
    expect(g.label).toBe("Preflop charts · approximate");
  });
  it("reads a hand kept at the solve's sizes as the table did, at them", async () => {
    const { rec, replayed, table: d } = kept(table("BB", [...OPEN, ...TO_BB], { pfSizes: true }), CHART_BB, NODES.offSize, 0, [{ pos: "UTG", action: "fold" }]);
    expect(d.move).toEqual({ pos: "BB", action: "raise", to: 12 });
    expect(rec.setup).toEqual({ pfSizes: true });
    const { ask } = pair(CHART_BB, NODES.offSize);
    const g = await gradeDecision(rec, replayed, "preflop", yours(replayed), ask);
    expect(g).toMatchObject({ source: "preflop-solve", byEv: true, verdict: d.grade!.verdict, matched: "raise" });
    expect(g.pfWhy).toBeUndefined();
  });
  it("reads a site's hand of the stored game by the move made, and says what it took for the rake", async () => {
    const { ask } = pair(CHART_OPENED, NODES.opened);
    const g = await gradeDecision({ id: "x", site: "PokerStars" }, site([...OPEN, { pos: "BTN", action: "raise", to: 7.5 }]), "preflop", 3, ask);
    expect(g).toMatchObject({ source: "preflop-solve", byEv: true, matched: "raise" });
    expect(g.note).toContain("stored game with no rake");
  });
  it("keeps a site's raise the solve has no such size for by the chart, and says why", async () => {
    const { ask } = pair(CHART_OPENED, NODES.opened);
    const g = await gradeDecision({ id: "x", site: "PokerStars" }, site([...OPEN, { pos: "BTN", action: "raise", to: 9 }]), "preflop", 3, ask);
    expect(g.source).toBe("charts");
    expect(g.byEv).toBe(false);
    expect(g.pfWhy).toMatch(/no such move here.*raise 9bb.*raise 7\.5bb/);
  });
  it("changes nothing for a hand that isn't one of the stored games: one question, the chart's answer, no word of the solve", async () => {
    const heads = hu({ SB: 90, BB: 90 }, [{ pos: "SB", action: "raise", to: 2.5 }, { pos: "BB", action: "fold" }] as never);
    const { ask, asked } = pair({ ...CHART, pot_bb: 3 }, NODES.opened);
    const g = await gradeDecision({ id: "x", site: "PokerStars" }, heads, "preflop", 1, ask);
    expect(asked).toHaveLength(1);
    expect(g.source).toBe("charts");
    expect(g).not.toHaveProperty("pfWhy");
    const { ask: ask2, asked: asked2 } = pair(CHART, NODES.first);
    const srp = await gradeDecision({ id: "h1", tournament: "x" } as never, site([...OPEN, { pos: "BTN", action: "raise", to: 7.5 }]), "preflop", 3, ask2);
    expect(asked2).toHaveLength(1);
    expect(srp).not.toHaveProperty("pfWhy");
  });
  it("keeps the chart's grade, and why, where the solve can't be read, and stops on a stop", async () => {
    const line = site([...OPEN, { pos: "BTN", action: "call" }]);
    const failed = await gradeDecision({ id: "x", site: "PokerStars" }, line, "preflop", 3, pair(CHART_OPENED, new Error("the file didn't come")).ask);
    expect(failed).toMatchObject({ source: "charts", byEv: false });
    expect(failed.pfWhy).toContain("the file didn't come");
    const unsolved = await gradeDecision({ id: "x", site: "PokerStars" }, line, "preflop", 3, pair(CHART_OPENED, NODES.unsolved).ask);
    expect(unsolved).toMatchObject({ source: "charts", byEv: false });
    expect(unsolved.pfWhy).toMatch(/\w+ \w+/);
    await expect(gradeDecision({ id: "x", site: "PokerStars" }, line, "preflop", 3, pair(CHART_OPENED, new SolverError("cancelled", "cancelled")).ask)).rejects.toThrow();
  });
  it("asks again once a chart's grade kept from before, in a stored game, and only those", async () => {
    const { rec } = kept(table("BTN", OPEN), CHART_OPENED, NODES.opened, 2, BEHIND);
    const other = { ...rec, id: "t", tournament: "Practice" };
    const chart = (handId: string, o: Partial<DecisionRecord> = {}): DecisionRecord => ({ id: `${handId}|preflop|3`, handId, street: "preflop", pos: "BTN", action: "raise to 7.5", verdict: "Correct", evLossBb: null, lossPct: null, source: "charts", label: "Preflop charts · approximate", gradedAt: 0, ...o });
    const ds = [chart(rec.id), chart(other.id), { ...chart(rec.id), id: "said", pfWhy: "why" }, { ...chart(rec.id), id: "solve", source: "preflop-solve" }];
    const ids = answeredIds(ds, [rec, other]);
    expect(ids.has(ds[0]!.id)).toBe(false);
    expect([ds[1]!, ds[2]!, ds[3]!].every((x) => ids.has(x.id))).toBe(true);
    // (without the hands, as ever)
    expect(answeredIds(ds).has(ds[0]!.id)).toBe(true);
  });
});

describe("a Practice hand of a stored tournament spot", () => {
  /** a hand of a session set to this preset, everyone folding to the big blind, kept as Practice keeps it */
  const keptHand = (name: string, bounty?: TournamentOptions["bounty"]) => {
    const st = [...STAGE_PRESETS, ...FORMAT_PRESETS, ...FINAL_TABLE_SET].find((p) => p.name === name)!;
    const { players, stack, ante, draft } = stageDraft(st);
    const tournament = { ...readDraft(draft, players, stack, 250).value!, ...(bounty ? { bounty } : {}) };
    let h = newHand(players, stack, 0, 7, { ante, tournament, pfSolve: true });
    for (const p of seatsOf(players).slice(0, -1)) h = withVillain(h, { pos: p, action: "fold" });
    const rec = practiceRecord({ ...h, result: finish(h) }, { id: "s", startedAt: 1 }, new Date(2));
    return { rec, replayed: importHand(rec.text), stack };
  };

  it("keeps its prizes, asks its answers in prize equity, and is graded by the stored solve", () => {
    for (const name of ["Sit & go bubble", "Final table", "Final table, 6 left, 20bb average, chip leader on the button"]) {
      const { rec, replayed } = keptHand(name);
      expect(rec.setup?.tournament?.payouts, name).toBeTruthy();
      expect(pfOut(rec, replayed), name).toBeNull();
      const st = adviceStateAt(replayed, "preflop", 0, "preflop", rec.setup);
      expect(st.payouts, name).toEqual(rec.setup!.tournament!.payouts);
    }
  });

  it("isn't graded by a solve where its game isn't the one stored, and says which are", () => {
    const ko = keptHand("Sit & go bubble", { format: "ko", seats: { CO: 10, BTN: 10, SB: 10, BB: 10 }, field: 10 });
    expect(pfOut(ko.rec, ko.replayed)).toMatch(/stored only for these spots.*final-table set/);
    const old = keptHand("Sit & go bubble");
    const setup = { ...old.rec.setup! };
    delete setup.tournament;
    expect(pfOut({ ...old.rec, setup }, old.replayed)).toMatch(/aren't kept with this hand/);
  });
});

describe("what you'd done earlier in the hand", () => {
  // Hero opens the cutoff, calls the button's 3-bet, checks the flop and raises its bet, then bets the turn and river
  const TEXT = [
    "PokerStars Hand #9: Hold'em No Limit ($0.50/$1.00 USD) - 2026/11/09 10:00:00 ET",
    "Table 'T' 4-max Seat #2 is the button",
    "Seat 1: Hero ($100 in chips)",
    "Seat 2: Ann ($100 in chips)",
    "Seat 3: Bob ($100 in chips)",
    "Seat 4: Cat ($100 in chips)",
    "Bob: posts small blind $0.50",
    "Cat: posts big blind $1",
    "*** HOLE CARDS ***",
    "Dealt to Hero [Ah Kh]",
    "Hero: raises $1.50 to $2.50",
    "Ann: raises $5.50 to $8",
    "Bob: folds",
    "Cat: folds",
    "Hero: calls $5.50",
    "*** FLOP *** [Kd 7s 2c]",
    "Hero: checks",
    "Ann: bets $5",
    "Hero: raises $10 to $15",
    "Ann: calls $10",
    "*** TURN *** [Kd 7s 2c] [5h]",
    "Hero: bets $20",
    "Ann: calls $20",
    "*** RIVER *** [Kd 7s 2c 5h] [9s]",
    "Hero: bets $30",
    "Ann: folds",
    "Uncalled bet ($30) returned to Hero",
    "Hero collected $87.50 from pot",
    "*** SUMMARY ***",
    "Total pot $87.50 | Rake $0",
  ].join("\n");

  it("keeps your first preflop decision, a check before a flop raise, and your flop and turn bets before the river", () => {
    const r = importHand(TEXT);
    const at = (street: "preflop" | "flop" | "turn" | "river") => r.lines[street].flatMap((m, i) => (m.pos === r.hand.hero ? [earlierAt(r, street, i)] : []));
    expect(at("preflop")).toEqual([{ firstIn: true, callers: 0 }, { firstIn: false, callers: 0 }]);
    expect(at("flop")).toEqual([{ ownCheck: false }, { ownCheck: true }]);
    expect(at("turn")).toEqual([{ flopAggr: true }]);
    expect(at("river")).toEqual([{ flopAggr: true, turnAggr: true }]);
  });

  it("counts the calls of the open before a blind's decision, so its squeeze is one", () => {
    const r = importHand(
      [
        "PokerStars Hand #10: Hold'em No Limit ($0.50/$1.00 USD) - 2026/11/10 10:00:00 ET",
        "Table 'T' 4-max Seat #2 is the button",
        "Seat 1: Ann ($100 in chips)",
        "Seat 2: Bob ($100 in chips)",
        "Seat 3: Cat ($100 in chips)",
        "Seat 4: Hero ($100 in chips)",
        "Cat: posts small blind $0.50",
        "Hero: posts big blind $1",
        "*** HOLE CARDS ***",
        "Dealt to Hero [Qs Qd]",
        "Ann: folds",
        "Bob: raises $1.50 to $2.50",
        "Cat: calls $2",
        "Hero: raises $10.50 to $13",
        "Bob: folds",
        "Cat: folds",
        "Uncalled bet ($10.50) returned to Hero",
        "Hero collected $6 from pot",
        "*** SUMMARY ***",
        "Total pot $6 | Rake $0",
      ].join("\n"),
    );
    expect(situationAt(r, "preflop", 3).situation).toBe("BB defence");
    expect(earlierAt(r, "preflop", 3)).toEqual({ firstIn: true, callers: 1 });
  });

  it("gives a grade kept before then its facts from the hand's history, and leaves one that has them", async () => {
    const r = importHand(TEXT);
    const kept = (street: string, i: number, o: Partial<DecisionRecord> = {}): DecisionRecord =>
      ({ id: `h9|${street}|${i}`, handId: "h9", street, i, pos: r.lines[street as "flop"][i]!.pos, action: "x", verdict: "Best", evLossBb: 0, lossPct: 0, source: "live", label: "", gradedAt: 0, ...o }) as DecisionRecord;
    const old = [kept("preflop", 4), kept("flop", 2), kept("river", 0), kept("turn", 0), kept("flop", 0, { ownCheck: false })];
    // (an id from before `i` was kept: its last part)
    const noI = { ...kept("preflop", 0), i: undefined };
    const filled = await fillEarlier([...old, noI], new Map([["h9", { text: TEXT }]]));
    expect(filled.map((d) => [d.street, d.i, d.firstIn, d.ownCheck, d.flopAggr, d.turnAggr])).toEqual([
      ["preflop", 4, false, undefined, undefined, undefined],
      ["flop", 2, undefined, true, undefined, undefined],
      ["river", 0, undefined, undefined, true, true],
      ["preflop", undefined, true, undefined, undefined, undefined],
    ]);
    expect(filled.every((d) => !lacksEarlier(d))).toBe(true);
    // a hand not kept, or one that no longer reads, is left as it was
    expect(await fillEarlier(old, new Map())).toEqual([]);
    expect(await fillEarlier(old, new Map([["h9", { text: "not a hand" }]]))).toEqual([]);
  });
});
