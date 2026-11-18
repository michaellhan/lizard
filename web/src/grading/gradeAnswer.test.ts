// The one entry point every surface grades through (gradeAnswer): each answer's noise, what it can't condemn, the words
// beside a grade, and what grading reads off an answer's provenance (basis.ts).
import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import { basisOf, roughOf } from "./basis";
import { actionNoise, answerNoise, capReason, CLEAR_PCT, gradeAnswer, lossBrief, lossWords, noiseTail, roughErrPct, scored, SCORE_LOSS_WORDS, whyText } from "./grade";

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
  // (16% of the pot: a Blunder where it's measured, short of a clear blunder)
  const fold = { freqs: [0, 1], evs: [0, 1.2], pot: 7.5 };
  it("stops at Inaccuracy, its EV as measured, and says why: in this order", () => {
    const at = (b: Parameters<typeof gradeAnswer>[2]) => gradeAnswer(fold, 0, b);
    expect(at({ source: "rules" })).toMatchObject({
      verdict: "Inaccuracy",
      capped: true,
      loss: 1.2,
      capWhy: "The rule-based model is no solve, so it can't condemn a line: this grade stops at Inaccuracy, short of a clear blunder (20% of the pot past the noise).",
    });
    expect(at({ source: "live", partial: true }).capWhy).toMatch(/^The solve was cut short before it measured how close it got/);
    expect(at({ source: "live", leans: true, exploitabilityPct: 0.2 }).capWhy).toMatch(/^This answer's ranges lean on the betting rules/);
    expect(at({ source: "live", band: "rough", exploitabilityPct: 3 }).capWhy).toMatch(/^The solve stopped 3\.00% of the pot from equilibrium, too far to trust/);
    expect(at({ source: "live", band: "approximate", exploitabilityPct: 1 }).capWhy).toMatch(/short of its target/);
    expect(at({ source: "library-turn", approximate: true }).capWhy).toMatch(/^This answer is read from another solution, its error unmeasured/);
  });

  it("condemns where it's measured: a settled solve, a cut-short one that measured itself, the preflop solve labelled approximate", () => {
    expect(gradeAnswer(fold, 0, { source: "live", band: "converged", exploitabilityPct: 0.2 }).verdict).toBe("Blunder");
    expect(gradeAnswer(fold, 0, { source: "live", partial: true, exploitabilityPct: 0.8 }).verdict).toBe("Blunder");
    expect(gradeAnswer({ ...fold, evs: [0, 3] }, 0, { source: "preflop-solve", approximate: true }).verdict).toBe("Blunder");
    // (an approximate answer that measured its distance, as a settled solve on a narrowing followed half or more is)
    expect(gradeAnswer(fold, 0, { source: "live", approximate: true, exploitabilityPct: 0.4, band: "converged" }).verdict).toBe("Blunder");
    expect(capReason({ source: "live", rough: [true, false] }, 1, true)).toBeNull();
  });

  it("but a clear blunder, CLEAR_PCT of the pot or more past the noise, is a Blunder whatever answered, and says why", () => {
    const nuts = { freqs: [0, 1], evs: [0, 3], pot: 7.5 };
    const g = gradeAnswer(nuts, 0, { source: "rules" });
    expect(g).toMatchObject({ verdict: "Blunder", loss: 3 });
    expect(g.capped).toBeUndefined();
    expect(g.clearWhy).toBe("The rule-based model is no solve, but this gives up 39.5% of the pot past its noise, 20% or more: a clear blunder, graded as measured.");
    expect(whyText(g, ["fold", "call"], nuts.freqs, "The rule-based model")).toMatch(/The rule-based model never plays this; its best by EV is call \(100\.0% of the time\)\. Graded on the 2\.96bb past .* a clear blunder, graded as measured\.$/);
    for (const b of [{ source: "live", leans: true, exploitabilityPct: 0.3 }, { source: "live", partial: true }, { source: "live", band: "rough", exploitabilityPct: 5 }, { source: "library-turn", approximate: true }])
      expect(gradeAnswer(nuts, 0, b).verdict).toBe("Blunder");
    // (just short of the line, on the page's precision: 19.9% past is capped, 20.0% isn't)
    const at = (lossPct: number) => gradeAnswer({ freqs: [0, 1], evs: [0, ((lossPct + 0.5) / 100) * 10], pot: 10 }, 0, { source: "rules" });
    expect([at(19.9).verdict, at(CLEAR_PCT).verdict]).toEqual(["Inaccuracy", "Blunder"]);
  });

  it("the heads-up preflop solve: it parts from the published solves past its noise, so it stops at Inaccuracy", () => {
    // heads-up 100bb, SB 65o first in (the stored game, lz4_2max_100bb): the solve raises 100% for 0.304bb and values the
    // limp the charts play 93% at 0.161bb; 0.143bb is 4.4% of the 1.5bb pot past its noise, a Mistake at 6-max
    const limp = { freqs: [1, 0, 0], evs: [0.304, 0.161, 0], pot: 1.5 };
    const hu = gradeAnswer(limp, 1, { source: "preflop-solve", players: 2 });
    expect(hu).toMatchObject({ verdict: "Inaccuracy", capped: true });
    expect(hu.loss).toBeCloseTo(0.143, 9);
    expect(hu.capWhy).toBe(
      "The heads-up preflop solve often parts from the published solves' charts, by more than its noise, so it can't condemn a line: this grade stops at Inaccuracy, short of a clear blunder (20% of the pot past the noise).",
    );
    for (const players of [3, 6, undefined]) expect(gradeAnswer(limp, 1, { source: "preflop-solve", players }).verdict).toBe("Mistake");
    // (and only the preflop solve's: another answer at a heads-up table condemns as it did)
    expect(gradeAnswer(fold, 0, { source: "live", band: "converged", exploitabilityPct: 0.2, players: 2 }).verdict).toBe("Blunder");
    // folding aces first in is still a clear blunder heads-up
    const aa = gradeAnswer({ freqs: [1, 0, 0], evs: [2.4, 1.9, 0], pot: 1.5 }, 2, { source: "preflop-solve", players: 2 });
    expect([aa.verdict, aa.capped]).toEqual(["Blunder", undefined]);
    expect(aa.clearWhy).toMatch(/^The heads-up preflop solve often parts from the published solves' charts, by more than its noise, but this gives up/);
  });

  it("the heads-up cap holds at 20bb too, where the solve condemns the chart's main move at hands it plays one way", () => {
    // 2-max 20bb, BB 9cAh facing a raise to 3: the chart calls 97%, the solve shoves; the call gives up 0.45bb, 3.4% of the
    // pot past the noise (the QA sweep's 2max-20bb-gto-any hand 3; ACCURACY 18.10)
    const shove = { freqs: [0, 0, 1], evs: [0, 1.0, 1.45], pot: 4 };
    const call = gradeAnswer(shove, 1, { source: "preflop-solve", players: 2 });
    expect(call).toMatchObject({ verdict: "Inaccuracy", capped: true });
    expect(call.loss).toBeCloseTo(0.45, 9);
    expect(gradeAnswer(shove, 1, { source: "preflop-solve", players: 3 }).verdict).toBe("Mistake");
  });

  it("leaves a grade already milder as it is", () => {
    const g = gradeAnswer({ freqs: [0.5, 0.5], evs: [3, 2.5], pot: 7.5 }, 1, { source: "rules" });
    expect([g.verdict, g.capped]).toEqual(["Correct", undefined]);
  });
});

describe("a move the range almost never takes", () => {
  it("has its EV's measured error by the solve's iterations on top of the answer's noise: 6% of the pot at 100, 2.4% at 300, 0.6% at 1,000", () => {
    expect([roughErrPct(undefined), roughErrPct(50), roughErrPct(100), roughErrPct(300), roughErrPct(400), roughErrPct(1000), roughErrPct(5000)]).toEqual([6, 6, 6, 2.4, 1.6, 0.6, 0.6]);
    expect(roughErrPct(200)).toBeGreaterThan(2.4);
    expect(roughErrPct(200)).toBeLessThan(6);
    const b = { source: "live", exploitabilityPct: 0.2, iterations: 300, rough: [true, false] };
    expect(actionNoise(b, 10, 0).extra).toBeCloseTo(0.24, 9);
    expect(actionNoise(b, 10, 1).extra).toBe(0);
  });

  it("is graded on what's past both, and says so: no cap, as its error is measured", () => {
    const spot = { freqs: [0.004, 0.996], evs: [4.72, 5], pot: 10 };
    const b = { source: "live", exploitabilityPct: 0.2, iterations: 300, rough: [true, false] };
    const g = gradeAnswer(spot, 0, b);
    // (0.28bb given up, 0.05 + 0.24bb allowed: 2.8% of the pot, a Mistake on the answer's noise alone)
    expect(g).toMatchObject({ verdict: "Correct", close: true, rough: true });
    expect(g.noise).toBeCloseTo(0.29, 9);
    expect(gradeAnswer(spot, 0, { ...b, rough: undefined }).verdict).toBe("Mistake");
    expect(lossWords(g, 10)).toBe("EV given up: 0.28bb, 2.8% of the 10bb pot: within the answer's noise for a move its range almost never takes (0.29bb), so not counted.");
    // (far past both it stays a Blunder: folding 40% of the pot)
    const far = gradeAnswer({ freqs: [0.004, 0.996], evs: [0, 4], pot: 10 }, 0, b);
    expect(far).toMatchObject({ verdict: "Blunder", rough: true });
    expect(far.capped).toBeUndefined();
    expect(whyText(far, ["fold", "call"], [0.004, 0.996])).toMatch(/Graded on the 3\.71bb past what the answer's EVs can tell apart for a move its range almost never takes \(0\.29bb\)\.$/);
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
    expect(basisOf({ ...live, leansOnRules: true, approximate: true })).toEqual({ ...basisOf(live), approximate: true, leans: true });
    expect(basisOf({ ...live, iterations: 300 })).toMatchObject({ iterations: 300 });
    expect(basisOf({ ...live, iterations: 300 }, { iterations: 120 }).iterations).toBe(120);
    expect(basisOf({ ...live, partial: true })).toMatchObject({ partial: true });
    expect(basisOf({ source: "library" }, { flopPot: 5.5 })).toEqual({ source: "library", flopPot: 5.5 });
    expect(basisOf(null)).toEqual({});
  });

  it("and the preflop solve's table size, off its answer (heads-up, it can't condemn a line)", () => {
    const node: AdvisorResponse = { study: "node", street: "preflop", players: 2 };
    expect(basisOf({ source: "preflop-solve" }, { res: node })).toEqual({ source: "preflop-solve", players: 2 });
    expect(basisOf({ source: "preflop-solve" }, { res: { ...node, players: 6 } }).players).toBe(6);
    expect(basisOf({ source: "preflop-solve" }).players).toBeUndefined();
    expect(basisOf({ source: "charts" }, { res: node }).players).toBeUndefined();
  });

  it("and off the answer itself where its provenance didn't say: a rules-read line, a widened range, a narrowing followed under half", () => {
    const rare = { street: "flop", pos: "BTN", why: "rare", action: "bet 33%", share: 2 } as const;
    const res: AdvisorResponse = { street: "flop", off_solution: [rare], widened: ["BTN"] };
    expect(basisOf(live, { res })).toMatchObject({ leans: true });
    expect(basisOf(live, { res: { ...res, widened: [], off_solution: [{ ...rare, resolved: true }] } }).leans).toBeUndefined();
    expect(basisOf(live, { res: { street: "flop", off_solution: [{ street: "preflop", pos: "BTN", why: "filled" as const }] } }).leans).toBeUndefined();
    const unsettled = (trust: number): AdvisorResponse => ({ street: "turn", off_solution: [{ street: "flop", why: "unsettled", trust }] });
    expect([basisOf(live, { res: unsettled(30) }).leans, basisOf(live, { res: unsettled(95) }).leans]).toEqual([true, undefined]);
    expect(roughOf([{ rough: true }, {}, { rough: false }])).toEqual([true, false, false]);
  });
});
