import { describe, expect, it } from "vitest";
import { addScore, capGrade, emptyScore, grade, noiseOf, pfNoisePct, summary, whoOf, whyText } from "./grade";

// cases ported from solver/tests/js/drills.test.js ("grading: ...", "score bookkeeping: ...")
describe("grade", () => {
  it("the best EV, or a played mix, is correct; the EV given up is against the best", () => {
    const pr = { pot: 7.3, freqs: [0, 0.62, 0.38], evs: [0, 1.2, 1.18] };
    let g = grade(pr, 1);
    expect([g.verdict, g.ok, g.mixed, g.loss, g.best, g.byEv]).toEqual(["Best", true, true, 0, 1, true]);
    g = grade(pr, 2); // played 38%: correct, with the small EV gap shown
    expect([g.verdict, g.ok, g.mixed]).toEqual(["Correct", true, true]);
    expect(g.loss).toBeCloseTo(0.02, 9);
    g = grade(pr, 0); // 1.2bb of a 7.3bb pot: 16%
    expect([g.verdict, g.ok]).toEqual(["Blunder", false]);
    expect(g.lossPct).toBeCloseTo((1.2 / 7.3) * 100, 9);
    const pure = { pot: 5.5, freqs: [0.95, 0.05], evs: [2, 1.95] };
    g = grade(pure, 1); // 5% isn't a mix: 0.05bb, under 2% of the pot
    expect([g.verdict, g.ok, g.mixed]).toEqual(["Inaccuracy", false, false]);
    expect(grade({ ...pure, evs: [2, 1.8] }, 1).verdict).toBe("Mistake");
    // equal EVs (the library's step) count as best, whatever the frequency
    expect(grade({ ...pure, evs: [2, 1.99] }, 1).verdict).toBe("Best");
  });

  it("does not call a rarely played action a costly mistake for its frequency alone (ROADMAP Phase 1)", () => {
    // 0.5% of a 10bb pot = 0.05bb
    const rare = grade({ pot: 10, freqs: [0.95, 0.05], evs: [1, 0.95] }, 1);
    expect(rare.verdict).toBe("Inaccuracy");
    const played = grade({ pot: 10, freqs: [0.85, 0.15], evs: [1, 0.95] }, 1);
    expect(played.verdict).toBe("Correct");
  });

  it("grades by frequency only without EVs (preflop charts), and counts no EV lost", () => {
    const pr = { pot: 1.5, freqs: [0.6, 0.35, 0.04, 0.01], evs: null };
    expect(grade(pr, 0)).toMatchObject({ verdict: "Best", byEv: false, loss: 0, lossPct: 0 });
    expect(grade(pr, 1).verdict).toBe("Correct");
    expect(grade(pr, 2).verdict).toBe("Inaccuracy");
    expect(grade(pr, 3).verdict).toBe("Mistake");
    // a chart decision is never an EV grade: no Blunder, whatever the frequency
    expect(grade({ ...pr, freqs: [1, 0, 0, 0] }, 3).verdict).toBe("Mistake");
  });

  it("thresholds sit where documented: 2% and 8% of the pot", () => {
    const at = (lossPct: number) => grade({ pot: 100, freqs: [1, 0], evs: [10, 10 - lossPct] }, 1).verdict;
    // (at the precision shown, one decimal of the pot: 1.99% shows as 2.0%, a Mistake beside it)
    expect(at(1.94)).toBe("Inaccuracy");
    expect(at(1.99)).toBe("Mistake");
    expect(at(2)).toBe("Mistake");
    expect(at(7.94)).toBe("Mistake");
    expect(at(7.99)).toBe("Blunder");
    expect(at(8)).toBe("Blunder");
  });
});

describe("why", () => {
  // the classic trainer's rule-based why (practice.js:431-444), in the answer's own name
  const names = ["check", "bet 33%", "bet 75%"];
  it("says how often the answer plays your action and which is best", () => {
    const pot = 10;
    const evs = [2, 2.005, 1.2];
    expect(whyText(grade({ freqs: [1, 0, 0], evs: [2, 1.5, 1], pot }, 0), names, [1, 0, 0])).toBe("The solver always plays this here.");
    expect(whyText(grade({ freqs: [0.6, 0.4, 0], evs, pot }, 0), names, [0.6, 0.4, 0])).toBe("The solver picks this most often here: 60.0% of the time.");
    // best by EV but less often played: a mix's actions are worth about the same
    expect(whyText(grade({ freqs: [0.6, 0.4, 0], evs, pot }, 1), names, [0.6, 0.4, 0])).toBe("The solver plays this 40.0% of the time, and its EV is as high as any action's here.");
    const mix = { freqs: [0.55, 0.3, 0.15], evs: [2.2, 2, 1.9], pot };
    expect(whyText(grade(mix, 1), names, mix.freqs)).toBe("The solver mixes this in 30.0% of the time; its best by EV is check (55.0% of the time).");
    const never = { freqs: [1, 0, 0], evs: [2, 1.5, 1], pot };
    expect(whyText(grade(never, 2), names, never.freqs)).toBe("The solver never plays this; its best by EV is check (100.0% of the time).");
    const rare = { freqs: [0.96, 0.04, 0], evs: [2, 1.9, 1], pot };
    expect(whyText(grade(rare, 1), names, rare.freqs)).toBe("The solver plays this only 4.0% of the time; its best by EV is check (96.0% of the time).");
    // the charts by frequency, in their name: not a solver
    const pf = { freqs: [0.7, 0.3, 0], evs: null, pot: 1.5 };
    expect(whyText(grade(pf, 1), ["raise", "call", "fold"], pf.freqs, whoOf("charts"))).toBe("The chart mixes this in 30.0% of the time; its best is raise (70.0% of the time).");
    expect(whoOf("library")).toBe("The solver");
    expect(whoOf("rules")).toBe("The rule-based model");
  });
});

describe("scores", () => {
  it("accuracy, EV lost, streaks, the last 100", () => {
    let s = emptyScore();
    const ok = { ok: true, loss: 0, lossPct: 0, byEv: true };
    const bad = { ok: false, loss: 0.5, lossPct: 10, byEv: true };
    for (const g of [ok, ok, bad, ok, ok, ok]) s = addScore(s, g);
    expect([s.n, s.ok, s.streak, s.best, s.loss, s.lossPct]).toEqual([6, 5, 3, 3, 0.5, 10]);
    expect(s.recent).toEqual([1, 1, 0, 1, 1, 1]);
    const m = summary(s);
    expect(m.acc).toBeCloseTo(5 / 6, 12);
    expect(m.loss).toBeCloseTo(0.5 / 6, 12);
    for (let i = 0; i < 150; i++) s = addScore(s, bad);
    expect(s.recent).toHaveLength(100);
    expect([s.n, s.streak, s.best]).toEqual([156, 0, 3]);
    expect(addScore(undefined, ok).n).toBe(1);
  });

  it("averages EV lost over the decisions graded by EV only", () => {
    let s = addScore(undefined, { ok: false, loss: 0, lossPct: 0, byEv: false });
    expect(summary(s).loss).toBeNull();
    s = addScore(s, { ok: false, loss: 1, lossPct: 4, byEv: true });
    expect(summary(s)).toEqual({ acc: 0, loss: 1, lossPct: 4 });
  });

  it("stops a rough or cut-short answer's grade at an Inaccuracy, its EV as measured, and names a read at once as what it is", () => {
    const g = grade({ freqs: [0.95, 0.05], evs: [9, 1], pot: 10 }, 1);
    expect(g.verdict).toBe("Blunder");
    expect(capGrade(g, "rough")).toEqual({ ...g, verdict: "Inaccuracy", capped: true });
    expect(capGrade(g, "approximate")).toMatchObject({ verdict: "Inaccuracy", capped: true, loss: 8 });
    expect(capGrade(g, "converged")).toBe(g);
    expect(capGrade(g, undefined)).toBe(g);
    const small = grade({ freqs: [0.95, 0.05], evs: [3, 2.99], pot: 10 }, 1);
    expect(capGrade(small, "rough")).toBe(small);
    expect(whoOf("instant")).toBe("The read at once");
  });
});

describe("grade: actions tied on EV", () => {
  // (the turn of 2026-11-17: check, bet 33% and bet 75% all 1.02bb, bet 125% 0.96)
  const spot = { freqs: [0.236, 0.329, 0.435, 0], evs: [1.0204, 1.0201, 1.0199, 0.96], pot: 6 };
  it("names your action best when it ties the top", () => {
    const g = grade(spot, 1);
    expect(g.verdict).toBe("Best");
    expect(g.best).toBe(1);
  });
  it("else names the most played of the tied actions, not the first by a fraction of a cent", () => {
    expect(grade(spot, 3).best).toBe(2);
  });
});

describe("grade: the preflop solve's noise", () => {
  // BTN 87o, 6-max 100bb, folded to: the stored game raises it 100% for 0.022bb, where the published solves fold it half
  // the time (the charts' 87o:0.5); the model's EVs can't tell a gap that small apart
  const btn87o = { pot: 1.5, freqs: [1, 0], evs: [0.022, 0], source: "preflop-solve" };
  it("grows with the pot as measured: about 5% of it first in, 8% facing an open, 11% facing a 3-bet, 13% a 4-bet", () => {
    expect([1.5, 4, 13, 34].map((p) => Math.round(pfNoisePct(p)))).toEqual([5, 8, 11, 14]);
    expect(noiseOf("preflop-solve", 1.5)).toBeCloseTo(0.0767, 3);
    expect([noiseOf("solver", 13), noiseOf("preflop-solve", 0)]).toEqual([0, 0]);
  });
  it("calls a fold within the noise of the best Correct, its EV lost as measured", () => {
    const g = grade(btn87o, 1);
    expect([g.verdict, g.ok, g.close, g.best]).toEqual(["Correct", true, true, 0]);
    expect(g.loss).toBeCloseTo(0.022, 9);
    expect(whyText(g, ["raise", "fold"], btn87o.freqs, whoOf("preflop-solve"))).toBe(
      "The preflop solve never plays this, but it gives up only 0.02bb against the top EV, raise (100.0% of the time): within what the answer's EVs can tell apart here (0.08bb).",
    );
  });
  it("grades only the EV lost past the noise, so a gap just over it isn't a Blunder", () => {
    // facing a 3-bet, pot 13bb: noise 1.44bb; 1.6bb lost is 12% of the pot, but 0.16bb (1.2%) past the noise
    const vs3bet = { pot: 13, freqs: [0, 1, 0], evs: [0, 1.6, 0], source: "preflop-solve" };
    const g = grade(vs3bet, 0);
    expect([g.verdict, g.close, g.loss]).toEqual(["Inaccuracy", undefined, 1.6]);
    expect(g.lossPct).toBeCloseTo((1.6 / 13) * 100, 9);
    expect(whyText(g, ["fold", "call", "raise"], vs3bet.freqs, whoOf("preflop-solve"))).toBe(
      "The preflop solve never plays this; its best by EV is call (100.0% of the time). Graded on the 0.16bb past what the answer's EVs can tell apart here (1.44bb).",
    );
    expect(grade({ ...vs3bet, evs: [0, 1.44 + 0.13 * 8, 0] }, 0).verdict).toBe("Blunder");
    // folding aces first in is still a Blunder: 8.25bb is far past 0.08bb
    expect(grade({ ...btn87o, evs: [8.25, 0] }, 1).verdict).toBe("Blunder");
  });
  it("keeps every other source's grade as it was", () => {
    const solver = grade({ ...btn87o, source: "solver" }, 1);
    expect([solver.verdict, solver.close, solver.noise]).toEqual(["Inaccuracy", undefined, undefined]);
    expect(grade(btn87o, 0)).toMatchObject({ verdict: "Best", loss: 0 });
  });
});
