import { describe, expect, it } from "vitest";
import { offText as analyzeOffText } from "@/features/analyze/grading";
import { basisOf } from "@/grading/basis";
import { gradeAnswer } from "@/grading/grade";
import type { AdvisorResponse } from "./protocol";
import { describe as describeProvenance, leansOnRules, offText, provenanceOf, rangesOffOf } from "./provenance";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "test", partial: false, now: 1 };

/** BTN opens, BB calls, Qs8d4c, BB checks, BTN bets 2: BB's answer, a live solve that settled (0.4% of the pot). */
const SETTLED: AdvisorResponse = {
  street: "flop",
  pot_bb: 7.5,
  to_call_bb: 2,
  actions: [
    { action: "fold", freq: 0, ev_bb: 0 },
    { action: "call", freq: 1, ev_bb: 3 },
  ],
  solver: { iterations: 300, exploitability_pct: 0.4 },
  off_solution: [],
  widened: [],
};
const at = (over: Partial<AdvisorResponse>) => ({ ...SETTLED, ...over });
const prov = (over: Partial<AdvisorResponse>) => provenanceOf(at(over), ctx);

const RARE_BET = { street: "flop", pos: "BTN", why: "rare", action: "bet 33%", share: 2.1 } as const;

describe("ranges that lean on the betting rules", () => {
  it("leaves a settled solve on the solve's own ranges as it is", () => {
    const p = prov({});
    expect(p.approximate).toBe(false);
    expect(p.rangesOff).toBeUndefined();
    expect(leansOnRules(SETTLED)).toBe(false);
    expect(describeProvenance(p)).not.toMatch(/approximate|betting rules/);
  });

  it("marks an opponent's rare line read by the rules: approximate, and the label says whose line", () => {
    const r = at({ off_solution: [RARE_BET], widened: ["BTN"] });
    expect(leansOnRules(r)).toBe(true);
    const p = provenanceOf(r, ctx);
    expect(p.approximate).toBe(true);
    expect(p.rangesOff).toBe("BTN's bet 33% on the flop is only 2.1% in the solve, so their range from there is the betting rules'");
    expect(p.approximateLabel).toBe(p.rangesOff);
    expect(describeProvenance(p)).toMatch(/BTN's bet 33% on the flop is only 2\.1% in the solve.* · approximate$/);
    // (its distance is still the solve's, and said)
    expect(p.exploitabilityPct).toBe(0.4);
  });

  it("marks an earlier street the rules narrowed, said once where a note says it too", () => {
    const bare = prov({ street: "turn", off_solution: [{ street: "flop", pos: "BTN", why: "rules" }] });
    expect(bare.approximate).toBe(true);
    expect(bare.rangesOff).toBe("the flop is narrowed by the betting rules, not solved");
    const noted = at({
      street: "turn",
      notes: ["flop: ranges narrowed by simple betting rules (a quick answer: the street isn't solved)"],
      off_solution: [{ street: "flop", why: "rules" }],
    });
    expect(rangesOffOf(noted)).toBe("ranges through the flop from the betting rules, not a solve");
  });

  it("marks a range the rules widened, even where the play after it was solved again", () => {
    const resolved = { ...RARE_BET, resolved: true };
    // a rare line solved again from there, its seat's range here not widened: the solve's from there on
    expect(leansOnRules(at({ off_solution: [resolved] }))).toBe(false);
    expect(prov({ off_solution: [resolved] }).rangesOff).toBeUndefined();
    // widened: their range here is still the rules'
    const w = prov({ off_solution: [resolved], widened: ["BTN"] });
    expect(w.approximate).toBe(true);
    expect(w.rangesOff).toMatch(/BTN's bet 33% on the flop is only 2\.1% in the solve, so their range from there is the betting rules' and the play after it is solved again from there/);
    // widened with no line said: the seat
    expect(prov({ widened: ["BTN"] }).rangesOff).toBe("BTN's range here comes from the betting rules on a line the solve rarely plays");
  });

  it("leaves a filled range as it was, and says an unsettled narrowing once", () => {
    const filled = prov({ off_solution: [{ street: "preflop", pos: "BTN", why: "filled" }] });
    expect(filled.approximate).toBe(false);
    expect(filled.rangesOff).toBeUndefined();
    // an unsettled narrowing: its note says it, the off_solution entry isn't said again
    const unsettled = at({
      street: "turn",
      notes: ["flop: the solve that narrows ranges is 4.2% of the pot from equilibrium (60 iterations), so ranges follow it 70% and simple betting rules the rest"],
      off_solution: [{ street: "flop", why: "unsettled", trust: 70 }],
    });
    expect(leansOnRules(unsettled)).toBe(false);
    expect(prov({ ...unsettled }).leansOnRules).toBeUndefined();
    expect(rangesOffOf(unsettled)).toBe("the flop's narrowing solve stopped 4.2% of the pot from equilibrium after 60 iterations on its time budget, so the ranges follow it 70% and the betting rules the rest, and can differ from run to run");
  });

  it("doesn't add it to an answer that is the rules", () => {
    const p = prov({ fallback: "rules", solver: undefined, off_solution: [RARE_BET], widened: ["BTN"] });
    expect(p.source).toBe("rules");
    expect(p.rangesOff).toBeUndefined();
  });

  it("says off_solution in the same words in Analyze", () => {
    const r = at({ off_solution: [RARE_BET, { street: "preflop", pos: "CO", why: "filled" }] });
    expect(analyzeOffText(r)).toBe(offText(r));
    expect(offText(r)).toBe("BTN's bet 33% on the flop is only 2.1% in the solve, so their range from there is the betting rules'; CO's preflop line isn't in the charts, so their range is the hands that take its last action");
    expect(offText(SETTLED)).toBeNull();
  });
});

describe("one test of ranges that lean on the betting rules: the provenance keeps it, every grade and the live drill read it", () => {
  const followed = (trust: number, why: "unsettled" = "unsettled"): Partial<AdvisorResponse> => ({
    street: "turn",
    notes: [`flop: the solve that narrows ranges is 4.2% of the pot from equilibrium (60 iterations), so ranges follow it ${trust}% and simple betting rules the rest`],
    off_solution: [{ street: "flop", why, trust }],
  });
  it("a narrowing solve followed under half leans; followed half or more it's said but doesn't", () => {
    expect([leansOnRules(at(followed(30))), leansOnRules(at(followed(49))), leansOnRules(at(followed(50))), leansOnRules(at(followed(95)))]).toEqual([true, true, false, false]);
    expect(prov(followed(30)).leansOnRules).toBe(true);
    expect(prov(followed(95))).toMatchObject({ approximate: true });
    expect(prov(followed(95)).leansOnRules).toBeUndefined();
  });

  it("reads advisor.py's notes where off_solution doesn't list it: a 3-way street the rules narrowed, a 3-way narrowing followed under half", () => {
    expect(leansOnRules(at({ notes: ["BTN, BB: multiway, ranges narrowed by simple betting rules"] }))).toBe(true);
    expect(leansOnRules(at({ notes: ["flop: ranges narrowed by simple betting rules (a quick answer: the street isn't solved)"] }))).toBe(true);
    const mw = (f: number) => at({ notes: [`flop: 3-way, ranges narrowed through your advice (80 iterations, 3.1% of the pot from equilibrium: followed ${f}%`] });
    expect([leansOnRules(mw(40)), leansOnRules(mw(70))]).toEqual([true, false]);
    expect(leansOnRules(at({ notes: ["anything else"] }))).toBe(false);
  });

  it("isn't set on an answer that is the rules, the charts or push/fold: those are capped by their source", () => {
    expect(prov({ fallback: "rules", solver: undefined, off_solution: [RARE_BET], widened: ["BTN"] }).leansOnRules).toBeUndefined();
  });
});

describe("a grade on ranges that lean on the betting rules", () => {
  // (1.20bb of a 7.5bb pot: 16%, a Blunder where it's measured, short of a clear blunder)
  const spot = { freqs: [0, 1], evs: [0, 1.2], pot: 7.5 };
  it("can't condemn a line: folding is graded Inaccuracy, its EV as measured, and says why", () => {
    const g = gradeAnswer(spot, 0, basisOf(prov({ off_solution: [RARE_BET], widened: ["BTN"] })));
    expect(g).toMatchObject({ verdict: "Inaccuracy", capped: true, loss: 1.2 });
    expect(g.capWhy).toMatch(/ranges lean on the betting rules/);
    // (read off the kept provenance alone, as a kept decision has it)
    const kept = prov({ off_solution: [RARE_BET], widened: ["BTN"] });
    expect(basisOf({ source: kept.source, leansOnRules: kept.leansOnRules, exploitabilityPct: kept.exploitabilityPct }).leans).toBe(true);
  });

  it("but a clear blunder stays one: folding the nuts for 3bb of the 7.5bb pot", () => {
    const g = gradeAnswer({ ...spot, evs: [0, 3] }, 0, basisOf(prov({ off_solution: [RARE_BET], widened: ["BTN"] })));
    expect(g).toMatchObject({ verdict: "Blunder", loss: 3 });
    expect(g.clearWhy).toMatch(/^This answer's ranges lean on the betting rules, but this gives up 39\.2% of the pot past its noise, 20% or more: a clear blunder, graded as measured\.$/);
  });

  it("condemns it on the solve's own ranges, and on a narrowing solve followed half or more", () => {
    expect(gradeAnswer(spot, 0, basisOf(prov({}))).verdict).toBe("Blunder");
    expect(gradeAnswer(spot, 0, basisOf(prov({ off_solution: [{ street: "preflop", pos: "BTN", why: "filled" }] }))).verdict).toBe("Blunder");
    const narrowed = at({ street: "turn", off_solution: [{ street: "flop", why: "unsettled", trust: 95 }] });
    expect(gradeAnswer(spot, 0, basisOf(provenanceOf(narrowed, ctx), { res: narrowed })).verdict).toBe("Blunder");
    const loose = at({ street: "turn", off_solution: [{ street: "flop", why: "unsettled", trust: 30 }] });
    expect(gradeAnswer(spot, 0, basisOf(provenanceOf(loose, ctx), { res: loose })).verdict).toBe("Inaccuracy");
  });
});
