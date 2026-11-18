// The one entry point every surface grades through (gradeAnswer): each answer's noise, what it can't condemn, the words
// beside a grade, and what grading reads off an answer's provenance (basis.ts).
import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import { basisOf, roughOf } from "./basis";
import { answerNoise, capReason, gradeAnswer, lossBrief, lossWords, noiseTail, scored, SCORE_LOSS_WORDS } from "./grade";

describe("an answer's noise", () => {
  it("is half a percent of the pot at least, twice a solve's measured distance from equilibrium, and two stored EV steps of a library flop", () => {
    expect(answerNoise({}, 20)).toBeCloseTo(0.1, 9);
    expect(answerNoise({ source: "live", exploitabilityPct: 0.63 }, 9.5)).toBeCloseTo(0.1197, 9);
    // (the flop library stores EVs in steps of 1% of the flop's pot: 5.5bb, so 0.11bb at any later decision of the flop)
    expect(answerNoise({ source: "library", flopPot: 5.5 }, 9.5)).toBeCloseTo(0.11, 9);
    expect(answerNoise({ source: "library" }, 5.5)).toBeCloseTo(0.11, 9);
    expect(answerNoise({ source: "library", flopPot: 5.5, exploitabilityPct: 4 }, 9.5)).toBeCloseTo(0.76, 9);
    // (the preflop solve's own, as measured against the published solves)
    expect(answerNoise({ source: "preflop-solve" }, 1.5)).toBeCloseTo(0.0767, 3);
    // (a noise kept with a decision is the one it was graded with)
    expect(answerNoise({ source: "live", noise: 0.3 }, 20)).toBe(0.3);
    expect([answerNoise({}, 0), answerNoise({}, NaN), answerNoise({ exploitabilityPct: NaN }, 10)]).toEqual([0, 0, 0.05]);
  });
});

describe("gaps far past the noise stay condemned", () => {
  it("folding the nuts on the river is a Blunder", () => {
    const g = gradeAnswer({ freqs: [0, 1], evs: [0, 30], pot: 40 }, 0, { source: "live", band: "converged", exploitabilityPct: 0.3 });
    expect(g).toMatchObject({ verdict: "Blunder", loss: 30 });
    expect(scored(g).loss).toBeCloseTo(30 - 0.24, 9);
  });

  it("folding aces first in is a Blunder by the preflop solve", () => {
    expect(gradeAnswer({ freqs: [0, 1], evs: [0, 2.4], pot: 1.5 }, 0, { source: "preflop-solve" }).verdict).toBe("Blunder");
  });

  it("folding a library flop's top set to a bet is a Blunder", () => {
    expect(gradeAnswer({ freqs: [0, 0.6, 0.4], evs: [0, 6.2, 6.4], pot: 9.5 }, 0, { source: "library", flopPot: 5.5, exploitabilityPct: 0.3, band: "converged" }).verdict).toBe("Blunder");
  });
});

describe("what an answer can't condemn", () => {
  const fold = { freqs: [0, 1], evs: [0, 3], pot: 7.5 };
  it("stops at Inaccuracy, its EV as measured, and says why: in this order", () => {
    const at = (b: Parameters<typeof gradeAnswer>[2]) => gradeAnswer(fold, 0, b);
    expect(at({ source: "rules" })).toMatchObject({ verdict: "Inaccuracy", capped: true, loss: 3, capWhy: "The rule-based model is no solve, so it can't condemn a line: this grade stops at Inaccuracy." });
    expect(at({ source: "live", partial: true }).capWhy).toMatch(/^The solve was cut short before it measured how close it got/);
    expect(at({ source: "live", leans: true, exploitabilityPct: 0.2 }).capWhy).toMatch(/^This answer's ranges lean on the betting rules/);
    expect(at({ source: "live", band: "rough", exploitabilityPct: 14 }).capWhy).toMatch(/^The solve stopped 14\.00% of the pot from equilibrium, too far to trust/);
    expect(at({ source: "live", band: "approximate", exploitabilityPct: 1 }).capWhy).toMatch(/short of its target/);
    expect(at({ source: "library-turn", approximate: true }).capWhy).toMatch(/^This answer is read from another solution, its error unmeasured/);
    expect(at({ source: "live", exploitabilityPct: 0.2, rough: [true, false] }).capWhy).toMatch(/^The range almost never takes this move, so its EV is rough/);
  });

  it("condemns where it's measured: a settled solve, a cut-short one that measured itself, the preflop solve labelled approximate", () => {
    expect(gradeAnswer(fold, 0, { source: "live", band: "converged", exploitabilityPct: 0.2 }).verdict).toBe("Blunder");
    expect(gradeAnswer(fold, 0, { source: "live", partial: true, exploitabilityPct: 0.8 }).verdict).toBe("Blunder");
    expect(gradeAnswer(fold, 0, { source: "preflop-solve", approximate: true }).verdict).toBe("Blunder");
    expect(capReason({ source: "live", rough: [true, false] }, 1, true)).toBeNull();
  });

  it("leaves a grade already milder as it is", () => {
    const g = gradeAnswer({ freqs: [0.5, 0.5], evs: [3, 2.5], pot: 7.5 }, 1, { source: "rules" });
    expect([g.verdict, g.capped]).toEqual(["Correct", undefined]);
  });
});

describe("the words beside a grade", () => {
  const pot = 20;
  const best = gradeAnswer({ freqs: [0.3, 0.7], evs: [5, 5.05], pot }, 1, { source: "live", exploitabilityPct: 0.3 });
  const close = gradeAnswer({ freqs: [0.97, 0.03], evs: [5, 4.95], pot }, 1, { source: "live", exploitabilityPct: 0.3 });
  const mix = gradeAnswer({ freqs: [0.6, 0.4], evs: [5, 4.5], pot }, 1, { source: "live", exploitabilityPct: 0.3 });
  const miss = gradeAnswer({ freqs: [0.98, 0.02], evs: [5, 4.1], pot }, 1, { source: "live", exploitabilityPct: 0.25 });

  it("say a loss within the noise or in the mix isn't counted, and what a miss gave up past the noise", () => {
    expect([best.verdict, close.verdict, mix.verdict, miss.verdict]).toEqual(["Best", "Correct", "Correct", "Mistake"]);
    expect(noiseTail(close)).toBe(" (within the answer's noise, not counted)");
    expect(noiseTail(mix)).toBe(" (part of the hand's mix, not counted)");
    expect(noiseTail(miss)).toBe(", 0.80bb past the answer's noise");
    expect(lossBrief(miss)).toBe("0.90bb given up, 4.5% of the pot, 0.80bb past the answer's noise");
    expect(lossBrief(mix)).toBe("0.50bb given up, 2.5% of the pot (part of the hand's mix, not counted)");
    expect(lossBrief({ ...miss, byEv: false })).toBe("");
    // (a grade kept before noise was: its loss alone)
    expect(noiseTail({ verdict: "Mistake", byEv: true, loss: 1, lossPct: 5 })).toBe("");
    expect(lossWords(mix, pot)).toBe("EV given up: 0.50bb, 2.5% of the 20bb pot: part of the hand's mix, so not counted.");
    expect(lossWords(close, pot)).toBe("EV given up: 0.05bb, 0.2% of the 20bb pot: within the answer's noise here (0.12bb), so not counted.");
    expect(lossWords(miss, pot)).toBe("EV given up: 0.90bb, 4.5% of the 20bb pot.");
  });

  it("count for the score only a miss's loss past the noise, and say so where a score is shown", () => {
    expect([scored(best).loss, scored(close).loss, scored(mix).loss]).toEqual([0, 0, 0]);
    expect(scored(miss).loss).toBeCloseTo(0.8, 9);
    expect(scored(miss).lossPct).toBeCloseTo(4, 9);
    expect(SCORE_LOSS_WORDS).toMatch(/only the decisions graded below Correct/);
  });
});

describe("what grading reads off an answer's provenance", () => {
  const live = { source: "live" as const, band: "converged" as const, exploitabilityPct: 0.63, approximate: false, partial: false };
  it("its source, band, distance, a cut-short or approximate answer, and ranges that lean on the betting rules", () => {
    expect(basisOf(live)).toEqual({ source: "live", band: "converged", exploitabilityPct: 0.63 });
    expect(basisOf({ ...live, rangesOff: "the flop is narrowed by the betting rules, not solved", approximate: true })).toEqual({ ...basisOf(live), approximate: true, leans: true });
    expect(basisOf({ ...live, partial: true })).toMatchObject({ partial: true });
    expect(basisOf({ source: "library" }, { flopPot: 5.5 })).toEqual({ source: "library", flopPot: 5.5 });
    expect(basisOf(null)).toEqual({});
  });

  it("and off the answer itself where its provenance didn't say: a rules-read line, a widened range", () => {
    const rare = { street: "flop", pos: "BTN", why: "rare", action: "bet 33%", share: 2 } as const;
    const res: AdvisorResponse = { street: "flop", off_solution: [rare], widened: ["BTN"] };
    expect(basisOf(live, { res })).toMatchObject({ leans: true });
    expect(basisOf(live, { res: { ...res, widened: [], off_solution: [{ ...rare, resolved: true }] } }).leans).toBeUndefined();
    expect(basisOf(live, { res: { street: "flop", off_solution: [{ street: "preflop", pos: "BTN", why: "filled" as const }] } }).leans).toBeUndefined();
    expect(roughOf([{ rough: true }, {}, { rough: false }])).toEqual([true, false, false]);
  });
});
