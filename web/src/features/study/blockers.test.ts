import { describe, expect, it } from "vitest";
import { ALL_CLASSES, expandClass, classOf } from "@/engine/nlhe/cards";
import type { AdvisorAction, AdvisorActionStat, AdvisorResponse, Breakdown, BreakdownSide, ComboRow } from "@/solver/protocol";
import { actionTaken, blockerPlan, cardsOf, opponentRange, picksOf, removal, type OppHand, type OppRange } from "./blockers";
import { freshHand } from "./studyState";

const hand = (who: string, made?: string, more: Partial<OppHand> = {}): OppHand => ({ cards: cardsOf(who), w: 1, made, draw: undefined, eq: null, fold: null, ...more });
const range = (rows: OppHand[]): OppRange => ({ who: "BTN", rows, labels: { made: {}, draws: {} }, line: 0.5 });
const ALL = ALL_CLASSES.flatMap(expandClass);
const live = (board: string) => ALL.filter((c) => !cardsOf(c).some((x) => board.includes(x)));
const one = (combo: string) => [{ cards: cardsOf(combo), w: 1 }];

describe("1,326 combos and card removal", () => {
  it("has 1,326 combos, none twice", () => {
    expect(ALL).toHaveLength(1326);
    expect(new Set(ALL).size).toBe(1326);
  });

  it("takes 101 of the 1,326 out with no board: 51 with each card, less the hand counted twice, leaving C(50,2)", () => {
    for (const c of ["AhKd", "2c2d", "7s6s"]) {
      const r = removal(range(ALL.map((x) => hand(x))), one(c));
      expect(r.combos).toBe(1326);
      expect(r.removed).toBe(101);
      expect(r.combos - r.removed).toBe(1225);
    }
  });

  it.each([
    ["flop", "Ks7d2c", 1176, 95, 1081],
    ["turn", "Ks7d2c5h", 1128, 93, 1035],
    ["river", "Ks7d2c5h9d", 1081, 91, 990],
  ])("on the %s: C(n,2) legal combos, 2n - 3 removed", (_, board, legal, out, left) => {
    const r = removal(range(live(board).map((x) => hand(x))), one("AhQd"));
    expect(r.combos).toBe(legal);
    expect(r.removed).toBe(out);
    expect(r.combos - r.removed).toBe(left);
  });

  it("counts by class exactly: AhAd leaves 1 of 6 AA and 8 of 16 AK", () => {
    const r = removal(range(ALL.map((x) => hand(x, classOf(x)))), one("AhAd"));
    const of = (id: string) => r.made.find((b) => b.id === id);
    expect(of("AA")).toMatchObject({ removed: 5, of: 6 });
    expect(of("AKo")!.removed + of("AKs")!.removed).toBe(8);
    expect(of("AKo")!.of + of("AKs")!.of).toBe(16);
    expect(of("KK")).toBeUndefined();
  });

  it("takes a hand sharing both cards out once", () => {
    expect(removal(range([hand("AhKd")]), one("AhKd")).removed).toBe(1);
  });
});

describe("removal, worked by hand", () => {
  // Board Ks7d2c. BTN, in combos, what each folds to the bet, equity against it:
  //   AsAd 1    folds 0     90%  overpair
  //   AhAd 0.5  folds 0     90%  overpair
  //   AhQh 1    folds 0.5   40%  ace high, flush draw
  //   QhJh 0.8  folds 0.25  30%  nothing, flush draw
  //   6s5s 0.5  folds 1     10%  nothing
  // 3.8 combos; folds 0.5 + 0.2 + 0.5 = 1.2, so 31.58% fold, 68.42% continue; value (over 50%) 1.5.
  // AhTd takes out AhAd and AhQh: 1.5 combos, 0.5 of them folds, 1.0 continues, 0.5 of the value, 1 of the 1.8 draws.
  // Left: 2.3 combos, folds 0.7, so 30.43% fold, 69.57% continue.
  const r: OppRange = {
    who: "BTN",
    labels: { made: { overpair: "Overpair", ace_high: "Ace high", nothing: "No made hand" }, draws: { fd: "Flush draw", none: "No draw" } },
    line: 0.5,
    rows: [
      { cards: ["As", "Ad"], w: 1, made: "overpair", draw: "none", eq: 0.9, fold: 0 },
      { cards: ["Ah", "Ad"], w: 0.5, made: "overpair", draw: "none", eq: 0.9, fold: 0 },
      { cards: ["Ah", "Qh"], w: 1, made: "ace_high", draw: "fd", eq: 0.4, fold: 0.5 },
      { cards: ["Qh", "Jh"], w: 0.8, made: "nothing", draw: "fd", eq: 0.3, fold: 0.25 },
      { cards: ["6s", "5s"], w: 0.5, made: "nothing", draw: "none", eq: 0.1, fold: 1 },
    ],
  };

  it("counts the combos at their real weights", () => {
    const x = removal(r, one("AhTd"));
    expect(x.combos).toBeCloseTo(3.8, 9);
    expect(x.removed).toBeCloseTo(1.5, 9);
  });

  it("moves the reply", () => {
    const { reply } = removal(r, one("AhTd"));
    expect(reply!.foldBefore).toBeCloseTo(1.2 / 3.8, 9);
    expect(reply!.before).toBeCloseTo(2.6 / 3.8, 9);
    expect(reply!.foldAfter).toBeCloseTo(0.7 / 2.3, 9);
    expect(reply!.after).toBeCloseTo(1.6 / 2.3, 9);
    expect(reply!.removedContinue).toBeCloseTo(1, 9);
    expect(reply!.removedFold).toBeCloseTo(0.5, 9);
  });

  it("says the value and draws it blocks, biggest first, the no-draw line left out", () => {
    const x = removal(r, one("AhTd"));
    expect(x.value).toEqual({ removed: 0.5, of: 1.5 });
    expect(x.made.map((b) => [b.label, b.removed, b.of])).toEqual([
      ["Ace high", 1, 1],
      ["Overpair", 0.5, 1.5],
    ]);
    expect(x.draws.map((b) => [b.label, b.removed])).toEqual([["Flush draw", 1]]);
    expect(x.draws[0]!.of).toBeCloseTo(1.8, 9);
  });

  it("averages a class's combos by how much of each the range holds", () => {
    // AhTd 0.5 and AsTs 1.5 of the pick: AsAd out a share 1.5 / 2, AhAd 0.5 / 2, AhQh 0.5 / 2
    const x = removal(r, [
      { cards: ["Ah", "Td"], w: 0.5 },
      { cards: ["As", "Ts"], w: 1.5 },
    ]);
    expect(x.removed).toBeCloseTo(0.75 + 0.125 + 0.25, 9);
  });

  it("has no reply or value lines where the rows have none", () => {
    const x = removal(range([hand("AhKd")]), one("AsAd"));
    expect(x.reply).toBeNull();
    expect(x.value).toBeNull();
  });
});

const row = (cards: string, w: number, mix: number[], eq: number | null = 0.5): ComboRow => [cards, w, mix, null, eq, 0, 1];
const CATS = { made: [["set", "Set"]] as [string, string][], draws: [["fd", "Flush draw"], ["none", "No draw"]] as [string, string][] };
const next = (more: Partial<AdvisorResponse> = {}): AdvisorResponse => ({
  study: "node",
  actor: "BTN",
  categories: CATS,
  grid: { actions: ["fold", "call"], cells: {} },
  actions: [{ action: "fold" }, { action: "call" }],
  combos: { AA: [row("AhAd", 2, [0.25, 0.75])], KK: [row("KhKd", 1, [1, 0])] },
  ...more,
});
const opts = { who: "BTN", combos: 3 as number | undefined, source: "live" as const, line: 0.5 };

describe("opponentRange", () => {
  it("reads their hands, categories and fold from the next answer", () => {
    const r = opponentRange(next(), opts) as OppRange;
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ cards: ["Ah", "Ad"], w: 2, made: "set", draw: "none", eq: 0.5, fold: 0.25 });
    expect(r.labels.draws.fd).toBe("Flush draw");
  });

  it("has no fold where the answer has none", () => {
    const r = opponentRange(next({ grid: { actions: ["check", "bet 50%"], cells: {} } }), opts) as OppRange;
    expect(r.rows[0]!.fold).toBeNull();
  });

  it("refuses a range that isn't this node's, past rounding", () => {
    expect(opponentRange(next(), { ...opts, combos: 3.9 })).toHaveProperty("rows");
    expect(opponentRange(next(), { ...opts, combos: 5 })).toEqual({ why: expect.stringContaining("that answer has 3.0 combos for BTN, not this node's 5.0") as string });
    expect(opponentRange(next(), { ...opts, combos: undefined })).toHaveProperty("why");
    // (a rare line: the engine widens the range behind it, so more comes to this node than took the action)
    const last = { pos: "BTN", action: "fold" } as AdvisorAction;
    const widened = opponentRange(next({ actions: [{ action: "fold" }, { action: "call" }] as AdvisorActionStat[] }), { ...opts, combos: 80, last });
    expect(widened).toEqual({ why: expect.stringContaining("wider than the") as string });
  });

  it("refuses another seat's node, a node with no hands, and an answer that isn't a solve", () => {
    expect(opponentRange(next({ actor: "SB" }), opts)).toHaveProperty("why");
    expect(opponentRange(next({ study: "deal" }), opts)).toHaveProperty("why");
    expect(opponentRange(next({ combos: {} }), opts)).toHaveProperty("why");
    expect(opponentRange(next(), { ...opts, source: "rules" })).toEqual({ why: expect.stringContaining("the betting rules, not a solve") as string });
  });

  it("reads the range by the action they took, with no reply", () => {
    const parent = next({ actions: [{ action: "check" }, { action: "bet 50%", amount_bb: 3 }], grid: { actions: ["check", "bet 50%"], cells: {} } });
    const r = opponentRange(parent, { ...opts, combos: 1.5, last: { pos: "BTN", action: "bet", to: 3 } }) as OppRange;
    expect(r.rows.map((h) => h.w)).toEqual([1.5]); // (AhAd 2 x 0.75; KhKd never bets)
    expect(r.rows[0]!.fold).toBeNull();
  });

  it("refuses when their action isn't in that answer", () => {
    expect(opponentRange(next(), { ...opts, last: { pos: "BTN", action: "bet", to: 3 } })).toHaveProperty("why");
  });
});

describe("actionTaken", () => {
  const acts = [{ action: "check" }, { action: "bet 33%", amount_bb: 2 }, { action: "bet 75%", amount_bb: 4.5 }, { action: "all-in", amount_bb: 97 }];

  it("finds a bet by its size and an all-in by its kind", () => {
    expect(actionTaken(acts, { pos: "BTN", action: "bet", to: 4.5 })).toBe(2);
    expect(actionTaken(acts, { pos: "BTN", action: "all-in" })).toBe(3);
    expect(actionTaken(acts, { pos: "BTN", action: "check" })).toBe(0);
  });

  it("finds nothing for a size that isn't there", () => {
    expect(actionTaken(acts, { pos: "BTN", action: "bet", to: 9 })).toBe(-1);
  });
});

describe("blockerPlan", () => {
  const side = (who: string): BreakdownSide => ({ who, combos: 100, made: [], draws: [] });
  const bd = (more: Partial<Breakdown> = {}): Breakdown => ({ actions: ["check", "bet 50%"], pot: 6, hero: side("BB"), villains: [side("BTN")], nut_eq: 0.8, ...more });
  const res: AdvisorResponse = { combos: { AA: [row("AhAd", 1, [1, 0])] } };
  const h = { ...freshHand(2, 100), board: "Ks7d2c" };

  it("reads the reply to each bet or raise on offer", () => {
    expect(blockerPlan(res, bd(), h, "live")).toEqual({ kind: "reply", who: "BTN", actions: [{ i: 1, name: "bet 50%" }] });
  });

  it("reads their last action with no bet or raise on offer", () => {
    const last = { pos: "BTN", action: "all-in" };
    expect(blockerPlan(res, bd({ actions: ["fold", "call"] }), { ...h, flop: [last] }, "library")).toEqual({ kind: "last", who: "BTN", last });
  });

  it("says why it can't otherwise", () => {
    expect(blockerPlan(res, bd({ actions: ["fold", "call"] }), h, "live")).toMatchObject({ kind: "none" });
    expect(blockerPlan(res, bd({ villains: [side("BTN"), side("SB")] }), h, "live")).toMatchObject({ kind: "none", why: expect.stringContaining("3-way") as string });
    expect(blockerPlan(res, bd(), h, "charts")).toMatchObject({ kind: "none", why: expect.stringContaining("preflop charts") as string });
    expect(blockerPlan(res, bd(), h, "rules")).toMatchObject({ kind: "none" });
    expect(blockerPlan({}, bd(), h, "live")).toMatchObject({ kind: "none" });
  });
});

describe("picksOf", () => {
  const rows = [row("AhAd", 0.5, [1]), row("AsAc", 1, [1])];

  it("takes a combo as itself and a class by reach", () => {
    expect(picksOf(rows, "AsAc")).toEqual([{ cards: ["As", "Ac"], w: 1 }]);
    expect(picksOf(rows, "").map((p) => p.w)).toEqual([0.5, 1]);
  });
});
