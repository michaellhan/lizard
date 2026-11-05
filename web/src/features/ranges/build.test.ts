// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ALL_CLASSES, classCombos } from "@/engine/nlhe/cards";
import type { ComboRow, RangeGridData } from "@/solver/protocol";
import {
  actionHands,
  actionShares,
  amend,
  biggestMisses,
  blankPaint,
  brush,
  classMixes,
  clearCombo,
  comboSlots,
  grade,
  historyOf,
  paintClasses,
  paintParsed,
  paintRange,
  paintWeights,
  passiveOf,
  rangePaint,
  record,
  redo,
  scoreBuild,
  scoreByCombo,
  scoreRange,
  setCombo,
  SHAPES,
  solutionPaint,
  undo,
} from "./build";
import { formatRange, parseRange } from "./rangeText";

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

  it("paints each class at its own share (range text's weights), and reads an action's hands back", () => {
    const p = blankPaint(NODE.grid);
    const q = paintWeights(p, { AA: 1, KQo: 0.5, "72s": 0.25, QJs: 1, A2o: 1 }, 1, 0, new Set(["72s"]));
    expect(q).toEqual({ AA: [0, 1, 0], KQo: [0.5, 0.5, 0], "72s": [1, 0, 0] });
    expect(paintWeights(p, { QJs: 1, AA: 0 }, 1, 0)).toBe(p);
    expect(actionShares(q, 1)).toEqual({ AA: 1, KQo: 0.5 });
    expect(actionShares(q, 2)).toEqual({});
  });

  it("groups hands by shape", () => {
    const of = (key: string) => ALL_CLASSES.filter(SHAPES.find((x) => x.key === key)!.has);
    expect(of("pairs")).toHaveLength(13);
    expect(of("suited")).toHaveLength(78);
    expect(of("offsuit")).toHaveLength(78);
    expect(of("broadway").sort()).toEqual(["AJo", "AJs", "AKo", "AKs", "AQo", "AQs", "ATo", "ATs", "KJo", "KJs", "KQo", "KQs", "KTo", "KTs", "QJo", "QJs", "QTo", "QTs", "JTo", "JTs"].sort());
    expect(of("ax")).toHaveLength(24);
    expect(of("sc")).toEqual(["AKs", "KQs", "QJs", "JTs", "T9s", "98s", "87s", "76s", "65s", "54s", "43s", "32s"]);
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

describe("single combos", () => {
  // AKs on As7d2c: AsKs blocked, three live combos at different reach, each with its own mix and EVs. The class's numbers
  // are what the Advisor sends for them: w 2 of 4 combos, f and ev weighted by reach
  const ROWS: ComboRow[] = [
    ["AhKh", 1, [0, 1], [0, 2], 0.7, 0, 0],
    ["AdKd", 0.5, [1, 0], [1, 0], 0.6, 0, 0],
    ["AcKc", 0.5, [0.5, 0.5], [1, 1], 0.6, 0, 0],
  ];
  const RES = {
    board: "As7d2c",
    pot_bb: 10,
    grid: { actions: ["check", "bet"], cells: { AKs: { w: 0.5, f: [0.375, 0.625], ev: [0.5, 1.25] } } },
    combos: { AKs: ROWS },
  };
  const blank = () => rangePaint(blankPaint(RES.grid));
  const near1 = (x: number | null | undefined, y: number) => expect(x).toBeCloseTo(y, 12);

  it("says what each combo is: live, blocked by the board, or out of the range", () => {
    const slots = comboSlots(RES, "AKs");
    expect(slots.map((s) => [s.combo, s.state])).toEqual([
      ["AsKs", "blocked"],
      ["AhKh", "live"],
      ["AdKd", "live"],
      ["AcKc", "live"],
    ]);
    // a legal combo with no row (or no reach) is out, not blocked; a row's cards any way round are the same combo
    const res = { ...RES, combos: { AKs: [ROWS[0]!, ["KdAd", 0.5, [1, 0], [1, 0], 0.6, 0, 0], ["AcKc", 0, [1, 0], [1, 0], 0.6, 0, 0]] as ComboRow[] } };
    expect(comboSlots(res, "AKs").map((s) => s.state)).toEqual(["blocked", "live", "live", "out"]);
    // AA on an ace board: the three combos with the ace are blocked of six
    expect(comboSlots(RES, "AA").filter((s) => s.state === "blocked")).toHaveLength(3);
    // (preflop or a board the answer doesn't give: nothing is blocked)
    expect(comboSlots({ ...RES, board: "" }, "AKs").map((s) => s.state)).toEqual(["out", "live", "live", "live"]);
    expect(comboSlots({ ...RES, board: undefined }, "AKs")[0]!.state).toBe("out");
  });

  it("counts a class half painted over its live combos' reach, not its 4 combos or a flat 3", () => {
    const p = setCombo(blank(), "AKs", "AhKh", 1, 1, 0);
    expect(p.combos).toEqual({ AKs: { AhKh: [0, 1] } });
    // AhKh is 1 of the live 2 combos by reach: 50% bet, not 25% (of 4) or 33% (of 3)
    expect(classMixes(p, RES).AKs).toEqual([0.5, 0.5]);
    near1(scoreRange(RES, p).cls.mine[1], 0.5);
    // AdKd too: 1.5 of the 2
    expect(classMixes(setCombo(p, "AKs", "AdKd", 1, 1, 0), RES).AKs).toEqual([0.25, 0.75]);
    // the unpainted paint is the same object, as nothing's been averaged
    const b = blank();
    expect(classMixes(b, RES)).toBe(b.classes);
  });

  it("grades each combo against its own mix and EVs, over the reach of the live combos", () => {
    // all check, the class painted: off 1 (AhKh, reach 1), 0 (AdKd, .5), .5 (AcKc, .5), of a reach of 2
    const blankScore = scoreRange(RES, blank());
    expect(blankScore.byCombo).toBe(false);
    expect(blankScore.head).toBe(blankScore.cls);
    near1(blankScore.combo!.acc, 1 - 1.25 / 2);
    expect(blankScore.combo!.combos).toBe(2);
    // EV given up: AhKh 2 - 0, AdKd none, AcKc 1 - 1 = 0
    near1(blankScore.combo!.ev_loss_bb, 1);
    near1(blankScore.combo!.ev_loss_pct, 10);

    // fractional mixes: AhKh at 75% bet, AcKc at 25% bet
    const p = setCombo(setCombo(blank(), "AKs", "AhKh", 1, 0.75, 0), "AKs", "AcKc", 1, 0.25, 0);
    const sc = scoreRange(RES, p);
    expect(sc.byCombo).toBe(true);
    expect(sc.head).toBe(sc.combo);
    near1(sc.head.acc, 1 - (1 * 0.25 + 0.5 * 0.25) / 2);
    near1(sc.head.ev_loss_bb, (1 * 0.5) / 2);
    near1(sc.head.mine[1], (0.75 + 0.5 * 0.25) / 2);
    near1(sc.head.gto[1], 0.625);
    expect(sc.head.cells.AKs!.combos).toBe(2);
    near1(sc.head.cells.AKs!.off, 0.1875);
  });

  it("scores the solver's combos 100% where its class mix can't, and doesn't let a class mean hide swapped combos", () => {
    let p = blank();
    for (const [c, , f] of ROWS) p = setCombo(p, "AKs", c, 1, f[1]!, 0);
    const exact = scoreRange(RES, p);
    near1(exact.head.acc, 1);
    near1(exact.head.ev_loss_bb, 0);
    expect(biggestMisses(exact.head)).toEqual([]);
    expect(exact.combo!.ceiling.acc).toBeLessThan(1);

    // AhKh checks and AdKd bets, on a class with those two only at the same reach: the class mix is right on average
    const res = { ...RES, grid: { actions: ["check", "bet"], cells: { AKs: { w: 0.5, f: [0.5, 0.5] } } }, combos: { AKs: [["AhKh", 1, [0, 1], null, null, 0, 0], ["AdKd", 1, [1, 0], null, null, 0, 0]] as ComboRow[] } };
    const swapped = setCombo(setCombo(rangePaint(blankPaint(res.grid)), "AKs", "AhKh", 1, 0, 0), "AKs", "AdKd", 1, 1, 0);
    const sc = scoreRange(res, swapped);
    expect(sc.cls.acc).toBe(1);
    expect(sc.head.acc).toBe(0);
    expect(sc.head.ev_loss_bb).toBeNull();
    expect(biggestMisses(sc.head).map(([c]) => c)).toEqual(["AKs"]);
  });

  it("leaves a blocked combo out of the denominator, even with a row for it", () => {
    const res = { ...RES, combos: { AKs: [["AsKs", 1, [1, 0], [5, 0], 0.9, 0, 0] as ComboRow, ...ROWS] } };
    const sc = scoreByCombo(res, blankPaint(res.grid))!;
    expect(sc.combos).toBe(2);
    near1(sc.acc, 1 - 1.25 / 2);
    expect(classMixes(setCombo(blank(), "AKs", "AhKh", 1, 1, 0), res).AKs).toEqual([0.5, 0.5]);
  });

  it("says combos can't be graded where the answer has none, keeping the class score", () => {
    const chart = { grid: { actions: ["fold", "raise"], cells: { AA: { w: 1, f: [0, 1] } } } };
    const sc = scoreRange(chart, rangePaint(blankPaint(chart.grid)));
    expect(sc.combo).toBeNull();
    expect(sc.byCombo).toBe(false);
    expect(sc.head).toBe(sc.cls);
    expect(sc.head.combos).toBe(classCombos("AA"));
  });

  it("makes each change one undo step, back to the exact weights, and a change to nothing no step", () => {
    const p0 = blank();
    let h = historyOf(p0);
    h = record(h, setCombo(h.now, "AKs", "AhKh", 1, 0.75, 0));
    const p1 = h.now;
    h = record(h, setCombo(h.now, "AKs", "AdKd", 1, 0.25, 0));
    h = record(h, setCombo(h.now, "AKs", "AhKh", 1, 0.5, 0));
    expect(h.past).toHaveLength(3);
    expect(h.now.combos.AKs).toEqual({ AhKh: [0.5, 0.5], AdKd: [0.75, 0.25] });
    // the same share again changes nothing
    expect(setCombo(h.now, "AKs", "AhKh", 1, 0.5, 0)).toBe(h.now);
    expect(record(h, setCombo(h.now, "AKs", "AhKh", 1, 0.5, 0))).toBe(h);
    h = undo(h);
    expect(h.now.combos.AKs).toEqual({ AhKh: [0.25, 0.75], AdKd: [0.75, 0.25] });
    h = undo(h);
    expect(h.now).toBe(p1);
    h = undo(h);
    expect(h.now).toBe(p0);
    expect(h.now.combos).toEqual({});
    h = redo(h);
    expect(h.now).toBe(p1);
    // a locked class, or a hand out of the range, takes no combo
    expect(setCombo(p0, "AKs", "AhKh", 1, 1, 0, new Set(["AKs"]))).toBe(p0);
    expect(setCombo(p0, "QJs", "QhJh", 1, 1, 0)).toBe(p0);
  });

  it("drops a combo that's back on its class's mix, and class brushes carry combos with them", () => {
    let p = setCombo(blank(), "AKs", "AhKh", 1, 0.5, 0);
    expect(clearCombo(p, "AKs", "AhKh").combos).toEqual({});
    expect(clearCombo(p, "AKs", "AdKd")).toBe(p);
    expect(setCombo(p, "AKs", "AhKh", 1, 0, 0).combos).toEqual({});

    // a 3-action class: the brush plays its action at its share of each combo, whatever else each mixes
    const grid = { actions: ["check", "bet", "jam"], cells: { AKs: RES.grid.cells.AKs } };
    const q = setCombo(rangePaint(blankPaint(grid)), "AKs", "AhKh", 2, 1, 0);
    const half = paintRange(q, ["AKs"], 1, 0.5, 0);
    expect(half.classes.AKs).toEqual([0.5, 0.5, 0]);
    expect(half.combos.AKs).toEqual({ AhKh: [0, 0.5, 0.5] });
    // a whole brush leaves the class whole
    expect(paintRange(half, ["AKs"], 1, 1, 0).combos).toEqual({});
    // locked, or not named: left as they were
    expect(paintRange(q, ["AKs"], 1, 1, 0, new Set(["AKs"]))).toBe(q);
    p = paintRange(q, ["QJs"], 1, 1, 0);
    expect(p).toBe(q);
  });

  it("gives an action's hands back as text with each combo's weight, and reads them back the same", () => {
    let p = setCombo(blank(), "AKs", "AhKh", 1, 1, 0);
    p = setCombo(p, "AKs", "AdKd", 1, 0.25, 0);
    // (AcKc on the class's check: no class weight, the two combos alone)
    expect(actionHands(p, 1, RES)).toEqual({ weights: {}, combos: { AhKh: 1, AdKd: 0.25 } });
    expect(formatRange(actionHands(p, 1, RES).weights, actionHands(p, 1, RES).combos)).toBe("AdKd:0.25,AhKh");
    // check: the class at the least of its live combos (AhKh's 0), the rest alone. The blocked combo isn't named
    expect(actionHands(p, 0, RES)).toEqual({ weights: {}, combos: { AdKd: 0.75, AcKc: 1 } });

    // every live combo over a floor: the class at the floor, and only the combos above it, since a class weight above
    // a combo's would raise that combo
    const q = setCombo(paintRange(blank(), ["AKs"], 1, 0.25, 0), "AKs", "AhKh", 1, 0.5, 0);
    const out = actionHands(q, 1, RES);
    expect(out).toEqual({ weights: { AKs: 0.25 }, combos: { AhKh: 0.5 } });
    const text = formatRange(out.weights, out.combos);
    expect(text).toBe("AKs:0.25,AhKh:0.5");
    const back = paintParsed(blank(), parseRange(text), 1, 0, new Set(), RES).paint;
    expect(actionHands(back, 1, RES)).toEqual(out);
    expect(scoreRange(RES, back).combo!.acc).toBeCloseTo(scoreRange(RES, q).combo!.acc, 12);

    // all live combos the same: the class alone
    const same = setCombo(setCombo(setCombo(blank(), "AKs", "AhKh", 1, 0.5, 0), "AKs", "AdKd", 1, 0.5, 0), "AKs", "AcKc", 1, 0.5, 0);
    expect(actionHands(same, 1, RES)).toEqual({ weights: { AKs: 0.5 }, combos: {} });
  });

  it("paints combos typed in text exactly, counting what it can't paint", () => {
    const res = { ...RES, grid: { actions: ["check", "bet"], cells: { ...RES.grid.cells, QQ: { w: 1, f: [1, 0], ev: [1, 1] } } }, combos: { ...RES.combos, QQ: [["QsQh", 1, [1, 0], [1, 1], 0.5, 0, 0]] as ComboRow[] } };
    const start = rangePaint(blankPaint(res.grid));
    const parsed = parseRange("QQ:0.5, AsKs, AhKh:0.25, AdKd, 7h6h, QsQd");
    const r = paintParsed(start, parsed, 1, 0, new Set(), res);
    expect(r).toMatchObject({ hands: 1, combos: 2, out: 2, blocked: 1, held: 0 });
    expect(r.paint.combos.AKs).toEqual({ AhKh: [0.75, 0.25], AdKd: [0, 1] });
    expect(r.paint.classes.AKs).toEqual([1, 0]);
    expect(r.paint.classes.QQ).toEqual([0.5, 0.5]);

    // a combo beside its class at the larger of the two; a locked class keeps all of it
    const both = paintParsed(start, parseRange("AKs:0.5, AhKh:0.25, AdKd:0.75"), 1, 0, new Set(), res);
    expect(both.paint.classes.AKs).toEqual([0.5, 0.5]);
    expect(both.paint.combos.AKs).toEqual({ AdKd: [0.25, 0.75] });
    const held = paintParsed(start, parseRange("AKs, AhKh"), 1, 0, new Set(["AKs"]), res);
    expect(held).toMatchObject({ hands: 0, combos: 0, held: 2 });
    expect(held.paint).toBe(start);
  });

  it("keeps the class paints' API and numbers as they were", () => {
    const p = rangePaint(blankPaint(NODE.grid));
    const q = paintRange(p, ["AA", "KQo"], 1, 0.5, 0);
    expect(q.classes).toEqual(paintClasses(p.classes, ["AA", "KQo"], 1, 0.5, 0));
    expect(scoreRange(NODE, q).cls).toEqual(scoreBuild(NODE, q.classes));
    expect(actionHands(q, 1, NODE)).toEqual({ weights: actionShares(q.classes, 1), combos: {} });
  });
});
