// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ComboRow, RangeGridData } from "@/solver/protocol";
import {
  amend,
  biggestMisses,
  blankPaint,
  brush,
  grade,
  historyOf,
  paintClasses,
  passiveOf,
  record,
  redo,
  scoreBuild,
  scoreByCombo,
  solutionPaint,
  undo,
} from "./build";

// upstream solver/tests/js/study.test.js NODE (its grid and pot)
const NODE: { grid: RangeGridData; pot_bb: number } = {
  pot_bb: 5.5,
  grid: {
    actions: ["check", "bet 33%", "bet 75%"],
    cells: {
      AA: { w: 1, f: [0.2, 0.3, 0.5], ev: [10, 11, 12], evm: 11.3, eq: 0.9 },
      KQo: { w: 0.5, f: [0.6, 0.4, 0], ev: [5, 5.5, 4], evm: 5.2, eq: 0.8 },
      "72s": { w: 1, f: [1, 0, 0], ev: [-0.02, -0.5, -1], evm: -0.02, eq: 0.6 },
      QJs: { w: 0, f: [1, 0, 0] },
    },
  },
};
const near = (a: number[], b: number[]) => expect(a.map((x) => +x.toFixed(6))).toEqual(b);

describe("the range builder (upstream study.test.js)", () => {
  it("paints blank to the passive action and brushes keep the rest's proportions", () => {
    expect(passiveOf(["fold", "call", "raise"])).toBe(0);
    expect(passiveOf(["check", "bet 33%"])).toBe(0);
    expect(passiveOf(["raise", "call"])).toBe(1);
    expect(blankPaint(NODE.grid)).toEqual({ AA: [1, 0, 0], KQo: [1, 0, 0], "72s": [1, 0, 0] });
    near(brush([1, 0, 0], 2, 1, 0), [0, 0, 1]);
    near(brush([1, 0, 0], 1, 0.5, 0), [0.5, 0.5, 0]);
    near(brush([0.5, 0.5, 0], 2, 0.5, 0), [0.25, 0.25, 0.5]);
    near(brush([0, 0, 1], 2, 0.5, 0), [0.5, 0, 0.5]);
    near(brush([1, 0, 0], 0, 0.5, 0), [0.5, 0.25, 0.25]);
  });

  it("scores the all-check paint as upstream does", () => {
    // AA (6 combos) 80% off, KQo (half its 12) 40%, 72s right: 1 - (6 x 0.8 + 6 x 0.4) / 16
    const sc = scoreBuild(NODE, blankPaint(NODE.grid));
    expect(sc.combos).toBe(16);
    expect(sc.acc).toBeCloseTo(0.55, 12);
    expect(sc.ev_loss_bb).toBeCloseTo(9 / 16, 12); // AA 11.3 - 10 = 1.3, KQo 5.2 - 5 = 0.2, a combo
    expect(sc.ev_loss_pct).toBeCloseTo((100 * 9) / 16 / 5.5, 12);
    near(sc.mine, [1, 0, 0]);
    near(sc.gto, [0.55, 0.2625, 0.1875]);
    expect(sc.cells.AA).toEqual({ off: 0.8, loss: expect.closeTo(1.3, 12), combos: 6 });
    expect(grade(sc.acc)).toBe("Off");
    expect(biggestMisses(sc).map(([c]) => c)).toEqual(["AA", "KQo"]);
  });

  it("scores the solver's own mix 100% and an action it never takes 0%", () => {
    const exact = scoreBuild(NODE, solutionPaint(NODE.grid));
    expect(exact.acc).toBe(1);
    expect(exact.ev_loss_bb).toBe(0);
    expect(biggestMisses(exact)).toEqual([]);
    const never = { grid: { actions: ["fold", "call", "raise"], cells: { AA: { w: 1, f: [0, 0.4, 0.6] }, KK: { w: 1, f: [0, 1, 0] } } } };
    expect(scoreBuild(never, blankPaint(never.grid)).acc).toBe(0);
  });

  it("grades preflop (no EVs) by accuracy alone", () => {
    const pre = { pot_bb: 1.5, grid: { actions: ["fold", "raise"], cells: { AA: { w: 1, f: [0, 1] }, "72o": { w: 1, f: [1, 0] } } } };
    const ps = scoreBuild(pre, blankPaint(pre.grid));
    expect(ps.ev_loss_bb).toBeNull();
    expect(ps.ev_loss_pct).toBeNull();
    expect(ps.acc).toBeCloseTo(12 / 18, 12);
    expect([grade(0.95), grade(0.85), grade(0.7), grade(0.55)]).toEqual(["Excellent", "Good", "Fair", "Off"]);
  });
});

describe("Lizard's additions", () => {
  it("paints many classes, skipping locked ones and hands out of the range", () => {
    const p = blankPaint(NODE.grid);
    const q = paintClasses(p, ["AA", "KQo", "72s", "QJs"], 2, 1, 0, new Set(["KQo"]));
    expect(q).toEqual({ AA: [0, 0, 1], KQo: [1, 0, 0], "72s": [0, 0, 1] });
    expect(p.AA).toEqual([1, 0, 0]);
    expect(paintClasses(p, ["QJs"], 2, 1, 0)).toBe(p);
  });

  it("undoes and redoes strokes to the exact weights", () => {
    const p0 = blankPaint(NODE.grid);
    let h = historyOf(p0);
    const p1 = paintClasses(p0, ["AA"], 1, 0.75, 0);
    h = record(h, p1);
    // a drag: one step however many hands it crosses
    h = amend(h, paintClasses(h.now, ["KQo"], 1, 0.75, 0));
    const p2 = paintClasses(h.now, ["72s"], 2, 0.25, 0);
    h = amend(h, p2);
    h = record(h, paintClasses(h.now, ["AA"], 2, 0.5, 0));
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.now).toBe(p2);
    expect(h.now.AA).toEqual([0.25, 0.75, 0]);
    h = undo(h);
    expect(h.now).toBe(p0);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.now).toBe(p2);
    // a new step drops what was undone
    h = record(h, blankPaint(NODE.grid));
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
    // a step that changes nothing isn't recorded
    expect(record(h, h.now)).toBe(h);
  });

  it("grades combo by combo against each combo's mix, with the class mixes' own score as the reference", () => {
    // AKs half in the range: one combo always bets, one always checks; the class mix is half and half
    const rows: ComboRow[] = [
      ["AsKs", 1, [1, 0], [1, 0], 0.6, 0, 0],
      ["AhKh", 1, [0, 1], [0, 2], 0.6, 0, 0],
    ];
    const res = { grid: { actions: ["check", "bet"], cells: { AKs: { w: 0.5, f: [0.5, 0.5], ev: [0.5, 1] } } }, combos: { AKs: rows } };
    const exact = scoreByCombo(res, solutionPaint(res.grid))!;
    expect(exact.acc).toBeCloseTo(0.5, 12);
    expect(exact.ev_loss_bb).toBeCloseTo(0.75, 12);
    // painting the class mixes is the reference itself
    expect(exact.ceiling.acc).toBeCloseTo(0.5, 12);
    expect(exact.ceiling.ev_loss_bb).toBeCloseTo(0.75, 12);
    // all bets: as accurate, and less EV given up than the class mix (the reference isn't the best class paint)
    const bets = scoreByCombo(res, { AKs: [0, 1] })!;
    expect(bets.acc).toBeCloseTo(0.5, 12);
    expect(bets.ev_loss_bb).toBeCloseTo(0.5, 12);
    expect(bets.ceiling.ev_loss_bb).toBeCloseTo(0.75, 12);
    expect(scoreByCombo({ grid: res.grid }, { AKs: [0, 1] })).toBeNull();
    const more = { ...res, grid: { ...res.grid, cells: { ...res.grid.cells, AA: { w: 1, f: [0, 1] } } } };
    expect(scoreByCombo(more, { AKs: [0, 1], AA: [0, 1] })).toBeNull();
    expect(scoreByCombo({ ...res, combos: { AKs: rows.map((r) => [r[0], r[1], r[2], null, null, 0, 0] as ComboRow) } }, { AKs: [0, 1] })!.ev_loss_bb).toBeNull();
  });
});
