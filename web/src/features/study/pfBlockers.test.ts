// Preflop blockers (pfBlockers.ts): card removal from a class-level range, worked by hand; the folds it moves, one seat
// and several; the ranking; and what's read where, with the charts and the push/fold model given a reason.
import { describe, expect, it } from "vitest";
import { ALL_CLASSES } from "@/engine/nlhe/cards";
import type { AdvisorAction, AdvisorResponse, GridCell } from "@/solver/protocol";
import { allFold, blockedClasses, pfBlockerPlan, pfEffect, pfRange, pfRanking, takenOut, type PfRange } from "./pfBlockers";

const node = (actor: string, cells: Record<string, Pick<GridCell, "w" | "f">>, actions = ["fold", "call", "raise to 9"]): AdvisorResponse => ({
  study: "node",
  street: "preflop",
  actor,
  actions: actions.map((a) => ({ action: a, ...(a.startsWith("raise to ") ? { amount_bb: Number(a.slice(9)) } : {}) })),
  grid: { actions, cells },
});
const range = (r: PfRange | { why: string }): PfRange => {
  if ("why" in r) throw new Error(r.why);
  return r;
};
const read = (res: AdvisorResponse, take?: AdvisorAction) => range(pfRange(res, { who: String(res.actor), source: "preflop-solve", ...(take ? { take } : {}) }));

describe("card removal from a class-level range", () => {
  it("takes 101 of the 1,326 combos out of a whole range, as postflop with no board", () => {
    const all = read(node("BB", Object.fromEntries(ALL_CLASSES.map((c) => [c, { w: 1, f: [0.5, 0.5, 0] }]))));
    expect(all.combos).toBe(1326);
    for (const c of ["AhKd", "2c2d", "7s6s"]) expect(takenOut(all, c).w).toBeCloseTo(101, 9);
    expect(all.folds).toBeCloseTo(663, 9);
  });

  it("weighs each class's combos alike, at its weight: AhKd leaves half of AA, AsAh one of six", () => {
    const aa = read(node("BB", { AA: { w: 0.5, f: [0, 0, 1] } }));
    expect(aa.combos).toBe(3);
    expect(takenOut(aa, "AhKd").w).toBeCloseTo(1.5, 9);
    expect(takenOut(aa, "AsAh").w).toBeCloseTo(2.5, 9);
    expect(blockedClasses(aa, "AsAh")).toEqual([{ cls: "AA", removed: 2.5, of: 3 }]);
  });
});

describe("the folds a hand moves, worked by hand", () => {
  // BB: AA never folds (6 combos), 72o always does (12): folds 12 of 18, two thirds
  const bb = node("BB", { AA: { w: 1, f: [0, 0, 1] }, "72o": { w: 1, f: [1, 0, 0] } });
  const r = read(bb);

  it("one seat: AsAh leaves 1 AA and every 72o, so 12 of 13 fold; 7s2s takes out six 72o, so 6 of 12", () => {
    expect(r.folds).toBe(12);
    const aces = pfEffect([r], "AsAh");
    expect(aces.seats[0]).toMatchObject({ who: "BB", combos: 18, removed: 5, foldBefore: 2 / 3, removedFold: 0 });
    expect(aces.seats[0]!.foldAfter).toBeCloseTo(12 / 13, 12);
    expect(aces.allBefore).toBeCloseTo(2 / 3, 12);
    expect(aces.allAfter).toBeCloseTo(12 / 13, 12);
    const sevens = pfEffect([r], "7s2s");
    expect(sevens.seats[0]).toMatchObject({ removed: 6, removedFold: 6 });
    expect(sevens.seats[0]!.foldAfter).toBeCloseTo(0.5, 12);
  });

  it("a class is the mean over its combos: every AA combo takes out five, every 72o five of the 72o and none of AA", () => {
    expect(pfEffect([r], "AA").seats[0]!.foldAfter).toBeCloseTo(12 / 13, 12);
    // 7s2h takes out the 72o combos holding the 7s (7s2h, 7s2d, 7s2c) or the 2h (7s2h, 7d2h, 7c2h): 5, so 7 of 13 fold
    const off = pfEffect([r], "72o").seats[0]!;
    expect(off.removed).toBeCloseTo(5, 12);
    expect(off.foldAfter).toBeCloseTo(7 / 13, 12);
  });

  it("several seats: all fold is the product, each seat's cards taken as apart", () => {
    const sb = read(node("SB", { KK: { w: 1, f: [0, 0, 1] }, "83o": { w: 1, f: [1, 0, 0] } }));
    expect(allFold([r, sb])).toBeCloseTo((2 / 3) * (2 / 3), 12);
    const e = pfEffect([r, sb], "AsKs");
    // AsKs takes 3 AA from BB and 3 KK from SB: 12 of 15 fold at each
    expect(e.allAfter).toBeCloseTo((12 / 15) ** 2, 12);
  });

  it("ranks our classes by how much more often all fold, the most first", () => {
    const rk = pfRanking([r], ["AA", "72o", "KQs"]);
    expect(rk.map((x) => x.cls)).toEqual(["AA", "KQs", "72o"]);
    expect(rk[0]!.move).toBeCloseTo(12 / 13 - 2 / 3, 12);
    expect(rk[1]!.move).toBe(0);
    expect(rk[2]!.move).toBeLessThan(0);
  });

  it("reads the range that took a raise, with no reply: their reach times its mix", () => {
    const btn = node("BTN", { AA: { w: 1, f: [0, 0.5, 0.5] }, "72o": { w: 1, f: [0.9, 0, 0.1] } });
    const raised = read(btn, { pos: "BTN", action: "raise", to: 9 });
    expect(raised.combos).toBeCloseTo(3 + 1.2, 12);
    expect(raised.folds).toBeNull();
    const e = pfEffect([raised], "AhKd");
    expect(e.allBefore).toBeNull();
    expect(e.seats[0]).toMatchObject({ foldBefore: null, foldAfter: null });
    expect(e.seats[0]!.removed).toBeCloseTo(1.5, 12);
    // ranked by the share of the range taken out
    const rk = pfRanking([raised], ["AA", "72o"]);
    expect(rk[0]!.cls).toBe("AA");
    expect(rk[0]!.move).toBeCloseTo(2.5 / 4.2, 12);
  });

  it("won't read a range from another source, another seat's node, or a raise that isn't in it", () => {
    expect(pfRange(bb, { who: "BB", source: "charts" })).toHaveProperty("why");
    expect(pfRange(bb, { who: "SB", source: "preflop-solve" })).toHaveProperty("why");
    expect(pfRange(bb, { who: "BB", source: "preflop-solve", take: { pos: "BB", action: "raise", to: 25 } })).toHaveProperty("why");
    expect(pfRange({ ...bb, street: "flop" }, { who: "BB", source: "preflop-solve" })).toHaveProperty("why");
  });
});

describe("what's read where", () => {
  const open = node("BTN", { AA: { w: 1, f: [0, 0, 1] } }, ["fold", "raise to 2.5", "all-in"]);

  it("gives the charts and the push/fold model a reason, never blockers", () => {
    const charts = pfBlockerPlan(open, "charts", []);
    expect(charts).toMatchObject({ kind: "none" });
    expect(charts.kind === "none" && charts.why).toMatch(/^No preflop blockers here: this answer is the preflop charts: .*no solve behind them/);
    const pf = pfBlockerPlan(open, "push-fold", []);
    expect(pf.kind === "none" && pf.why).toMatch(/push\/fold model/);
    expect(pfBlockerPlan({ ...open, street: "flop" }, "live", []).kind).toBe("none");
  });

  it("offers the reply to each raise of ours, and the last raise before us", () => {
    const p = pfBlockerPlan(open, "preflop-solve", [{ pos: "UTG", action: "fold" }]);
    expect(p).toEqual({ kind: "ok", hero: "BTN", reads: [{ kind: "reply", i: 1, name: "raise to 2.5" }, { kind: "reply", i: 2, name: "all-in" }] });
    const vs = node("BB", {}, ["fold", "call", "raise to 9"]);
    const line: AdvisorAction[] = [{ pos: "BTN", action: "raise", to: 2.5 }, { pos: "SB", action: "fold" }];
    const q = pfBlockerPlan(vs, "preflop-solve", line);
    expect(q.kind === "ok" && q.reads).toEqual([
      { kind: "reply", i: 2, name: "raise to 9" },
      { kind: "last", who: "BTN", last: line[0], at: 0, name: "BTN's raise to 2.5bb" },
    ]);
    // facing an all-in: only the jammer's range
    const jam = node("BB", {}, ["fold", "call"]);
    const r = pfBlockerPlan(jam, "preflop-solve", [{ pos: "SB", action: "all-in" }]);
    expect(r.kind === "ok" && r.reads.map((x) => x.kind)).toEqual(["last"]);
    expect(pfBlockerPlan(jam, "preflop-solve", [{ pos: "SB", action: "call" }]).kind).toBe("none");
  });
});
