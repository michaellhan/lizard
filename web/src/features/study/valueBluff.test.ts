import { describe, expect, it } from "vitest";
import type { AdvisorResponse, Breakdown, BreakdownSide, ComboRow } from "@/solver/protocol";
import { isAggressive, valueBluff, valueBluffText, valueShare, whyNotSolved, type ValueBluff } from "./valueBluff";

const side = (who: string): BreakdownSide => ({ who, combos: 100, made: [], draws: [] });
const bd = (more: Partial<Breakdown> = {}): Breakdown => ({ actions: ["check", "bet 50%", "all-in"], pot: 6, hero: side("BB"), villains: [side("BTN")], nut_eq: 0.8, runouts: [1, 1], ...more });

const CATS = { made: [["set", "Set"], ["top_tk", "Top pair, top kicker"], ["nothing", "No made hand"]] as [string, string][], draws: [["fd", "Flush draw"], ["none", "No draw"]] as [string, string][] };
const row = (cards: string, w: number, bet: number, eq: number | null, made: number, draw: number): ComboRow => [cards, w, [1 - bet, bet, 0], [0, 0, 0], eq, made, draw];

// Worked by hand. Combos in "bet 50%" (reach x mix):
//   AhAd 1 x 0.5  = 0.5,  90% equity: value
//   AcAd 0.5 x 1  = 0.5,  80%: value
//   7h2d 1 x 0.25 = 0.25, 20%: bluff
//   KhQh 0.8 x 0.5 = 0.4, exactly 50%: bluff (value has to beat the line)
//   JhTh 0.5 x 1  = 0.5,  no equity: in neither count
// value 1.0, bluff 0.65, so 1 / 1.65 = 60.6% value.
const res = (more: Partial<AdvisorResponse> = {}): AdvisorResponse => ({
  categories: CATS,
  combos: {
    AA: [row("AhAd", 1, 0.5, 0.9, 0, 1), row("AcAd", 0.5, 1, 0.8, 1, 1)],
    "72o": [row("7h2d", 1, 0.25, 0.2, 2, 1)],
    KQs: [row("KhQh", 0.8, 0.5, 0.5, 2, 0)],
    JTs: [row("JhTh", 0.5, 1, null, 2, 0)],
  },
  ...more,
});
const split = (r = res(), b = bd(), a = 1) => valueBluff(r, b, a, "live") as ValueBluff;

describe("valueBluff", () => {
  it("splits the worked example, leaving the hand with no equity in neither count", () => {
    const s = split();
    expect(s.kind).toBe("split");
    expect(s.line).toBe(0.5);
    expect(s.value).toBeCloseTo(1, 9);
    expect(s.bluff).toBeCloseTo(0.65, 9);
    expect(s.unknown).toBeCloseTo(0.5, 9);
    expect(valueShare(s)).toBeCloseTo(1 / 1.65, 9);
  });

  it("adds up to the action's combos, in total and by category", () => {
    const s = split();
    expect(s.value + s.bluff + s.unknown).toBeCloseTo(0.5 + 0.5 + 0.25 + 0.4 + 0.5, 9);
    const sum = (m: ValueBluff["made"]) => Object.values(m).reduce((t, c) => t + c.value + c.bluff, 0);
    expect(sum(s.made)).toBeCloseTo(s.value + s.bluff, 9);
    expect(sum(s.draws)).toBeCloseTo(s.value + s.bluff, 9);
  });

  it("counts by category, so a filtered view can say how much of a category is value", () => {
    const s = split();
    expect(s.made.set).toEqual({ value: 0.5, bluff: 0 });
    expect(s.made.nothing).toEqual({ value: 0, bluff: 0.25 + 0.4 });
    expect(s.draws.none!.value).toBeCloseTo(1, 9);
    expect(valueShare(s.made.top_tk!)).toBe(1);
  });

  it("uses each player's fair share of the pot as the line: a third 3-way", () => {
    const s = split(res(), bd({ villains: [side("BTN"), side("SB")] }));
    expect(s.line).toBeCloseTo(1 / 3, 9);
    expect(s.value).toBeCloseTo(1.4, 9); // (the 50% hand clears a third now)
    expect(s.bluff).toBeCloseTo(0.25, 9);
  });

  it("counts the all-in as a bet, by its own mix", () => {
    expect(isAggressive("all-in")).toBe(true);
    expect(isAggressive("raise to 12")).toBe(true);
    expect(valueBluff(res(), bd(), 2, "library")).toMatchObject({ kind: "none", why: expect.stringContaining("hardly any combos") as string });
  });

  it("isn't defined for a check, call or fold", () => {
    for (const name of ["check", "call", "fold"]) expect(valueBluff(res(), bd({ actions: [name, "bet 50%", "all-in"] }), 0, "live")).toMatchObject({ kind: "none", why: expect.stringContaining("bet or raise") as string });
  });

  it.each([
    ["charts", "the preflop charts, not a solve"],
    ["preflop-solve", "the preflop solve"],
    ["rules", "the betting rules, not a solve"],
    ["equity", "an equity estimate, not a solve"],
    ["unknown", "a source it doesn't name"],
  ] as const)("shows nothing from %s, whatever the rows say", (source, text) => {
    const a = valueBluff(res(), bd(), 1, source);
    expect(a.kind).toBe("none");
    expect(a).toMatchObject({ why: expect.stringContaining(text) as string });
  });

  it.each(["library", "library-turn", "instant", "live"] as const)("reads an answer from %s, which its badge qualifies", (source) => {
    expect(whyNotSolved(source)).toBeNull();
  });

  it("shows nothing with no equities, and says 4-way where it is", () => {
    const blank = res({ combos: { AA: [row("AhAd", 1, 1, null, 0, 1)] } });
    expect(valueBluff(blank, bd(), 1, "live")).toMatchObject({ kind: "none", why: "No value and bluff split: this answer holds no equities to test the hands with." });
    const four = bd({ villains: [side("BTN"), side("SB"), side("CO")] });
    expect(valueBluff(blank, four, 1, "live")).toMatchObject({ kind: "none", why: expect.stringContaining("4-way") as string });
    expect(valueBluff(res({ combos: {} }), bd(), 1, "live").kind).toBe("none");
  });
});

describe("valueBluffText", () => {
  it("says the definition in words, with what the answer doesn't hold", () => {
    const t = valueBluffText(split(), bd(), res());
    expect(t).toContain("over 50% equity against BTN's whole range;");
    expect(t).toContain("bluff: 50% or less.");
    expect(t).toContain("on the river, no cards to come");
    expect(t).not.toContain("tournament");
  });

  it("reads a raise against calling, 3-way against both ranges, and a tournament in chips", () => {
    const three = bd({ villains: [side("BTN"), side("SB")] });
    const t = valueBluffText(split(res(), three), three, res({ to_call_bb: 3, tournament: { note: "x" } }));
    expect(t).toContain("over 33.3% equity against both other ranges");
    expect(t).toContain("In chips, not prizes");
    const four = bd({ villains: [side("BTN"), side("SB"), side("CO")] });
    expect(valueBluffText(split(res(), four), four, res())).toContain("over 25.0% equity against the other ranges");
  });
});
