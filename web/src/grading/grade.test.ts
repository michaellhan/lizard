import { describe, expect, it } from "vitest";
import { addScore, emptyScore, grade, summary } from "./grade";

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
    expect(at(1.99)).toBe("Inaccuracy");
    expect(at(2)).toBe("Mistake");
    expect(at(7.99)).toBe("Mistake");
    expect(at(8)).toBe("Blunder");
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
});
