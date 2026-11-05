import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import { describeTarget, foldTargets } from "./foldTargets";
import { back, forward, freshHand, fromSearch, lineOf, lineSteps, parseLine, play, toSearch, type StudyHand } from "./studyState";

const at = (players: number, pre = "", extra: Partial<StudyHand> = {}): StudyHand => ({ ...freshHand(players, 100), preflop: parseLine(pre), ...extra });
const seats = (h: StudyHand, res?: AdvisorResponse) => foldTargets(h, res).map((t) => t.seat);

describe("foldTargets: where the folds can reach", () => {
  it("offers each seat up to the last one who still has someone to play, and never the end of the hand", () => {
    expect(seats(at(6))).toEqual(["HJ", "CO", "BTN", "SB"]); // (BB would be the last one left: everyone folded, nobody decides)
    expect(seats(at(9))).toEqual(["UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB"]);
    expect(seats(at(3))).toEqual(["SB"]);
  });

  it("offers nothing where one fold would end the hand", () => {
    expect(seats(at(2))).toEqual([]); // heads-up, the small blind's fold
    expect(seats(at(6, "UTG:f,HJ:f,CO:f,BTN:f"))).toEqual([]); // folded to the small blind
    expect(seats(at(3, "BTN:f"))).toEqual([]);
  });

  it("goes round the table past the blinds to a seat that still has to answer: CO opens, BTN 3-bets", () => {
    const h = at(6, "UTG:f,HJ:f,CO:r2.5,BTN:r8");
    expect(foldTargets(h).map((t) => [t.seat, t.folds])).toEqual([["BB", ["SB"]], ["CO", ["SB", "BB"]]]);
    expect(foldTargets(h)[1]?.hand.preflop.slice(-2)).toEqual([{ pos: "SB", action: "fold" }, { pos: "BB", action: "fold" }]);
    // (CO folding too would hand BTN the pot)
    expect(seats(foldTargets(h)[1]!.hand)).toEqual([]);
  });

  it("skips seats that have folded, and reaches a caller who faces a raise", () => {
    expect(seats(at(6, "UTG:r2.5,HJ:c,CO:r8"))).toEqual(["SB", "BB", "UTG", "HJ"]);
    expect(seats(at(6, "UTG:f,HJ:r2.5,CO:c,BTN:r8"))).toEqual(["BB", "HJ", "CO"]);
  });

  it("stops at the fold that closes the betting: no seat acts after it, the flop comes", () => {
    expect(seats(at(6, "UTG:r2.5,HJ:c"))).toEqual(["BTN", "SB", "BB"]);
    expect(seats(at(6, "UTG:r2.5,HJ:c,CO:f,BTN:f,SB:f"))).toEqual([]); // (BB's fold closes it: UTG and HJ see a flop)
  });

  it("doesn't fake a fold for a big blind with nothing to call: it can reach that seat, not go past it", () => {
    expect(seats(at(6, "UTG:c"))).toEqual(["CO", "BTN", "SB", "BB"]);
    expect(seats(at(6, "UTG:c,HJ:f,CO:f,BTN:f,SB:f"))).toEqual([]);
    expect(seats(at(2, "SB:c"))).toEqual([]);
    expect(seats(at(3, "BTN:c,SB:c"))).toEqual([]);
  });

  it("does fold a big blind who faces a raise", () => {
    const t = foldTargets(at(6, "UTG:r2.5,HJ:f,CO:f,BTN:r8"));
    expect(t.map((x) => x.seat)).toEqual(["BB", "UTG"]);
    expect(t[1]?.folds).toEqual(["SB", "BB"]);
  });

  it("follows the straddle's order: the straddler acts last, the big blind faces 2bb and can fold", () => {
    const setup = { straddle: true };
    expect(seats(at(6, "", { setup }))).toEqual(["CO", "BTN", "SB", "BB"]); // (HJ first; the straddler only wins the blinds)
    const limped = foldTargets(at(6, "HJ:c", { setup }));
    expect(limped.map((t) => t.seat)).toEqual(["BTN", "SB", "BB", "UTG"]);
    expect(limped.at(-1)?.folds).toEqual(["CO", "BTN", "SB", "BB"]);
    expect(seats(limped.at(-1)!.hand)).toEqual([]); // (the straddler can check)
  });

  it("passes over a seat all-in from its blind or ante, who has no decision", () => {
    expect(seats(at(6, "UTG:c", { setup: { stacks: { SB: 0.5 } } }))).toEqual(["CO", "BTN", "BB"]);
    expect(seats(at(6, "", { setup: { ante: 1, stacks: { CO: 1 } } }))).toEqual(["HJ", "BTN", "SB"]);
    // (the big blind all-in: the last fold leaves it and UTG to the flop, with no seat to pick)
    expect(seats(at(6, "UTG:c", { setup: { stacks: { BB: 1 } } }))).toEqual(["CO", "BTN", "SB"]);
  });

  it("takes each seat's own stack: an all-in raise for less leaves the same seats to answer it", () => {
    const short = at(6, "UTG:a,HJ:c", { setup: { stacks: { UTG: 10, HJ: 10 } } });
    expect(seats(short)).toEqual(["BTN", "SB", "BB"]);
    const out = at(6, "UTG:a", { setup: { stacks: { UTG: 10 } } });
    expect(seats(out)).toEqual(["CO", "BTN", "SB", "BB"]);
  });

  it("stays preflop", () => {
    expect(seats(at(6, "UTG:r2.5,HJ:c,CO:c,BTN:f,SB:f,BB:f", { board: "Ks7d2c" }))).toEqual([]);
    expect(seats(at(6, "UTG:r2.5,HJ:c,CO:c,BTN:f,SB:f,BB:f", { board: "Ks7d2c", flop: parseLine("UTG:b2,HJ:c") }))).toEqual([]);
  });
});

describe("foldTargets: the answer at the node", () => {
  const h = at(6);
  const node = (actor: string, actions = ["fold", "raise 2.5"]): AdvisorResponse => ({ study: "node", street: "preflop", actor, actions: actions.map((action) => ({ action })) });

  it("agrees where it names this actor and offers the fold", () => {
    expect(seats(h, node("UTG"))).toEqual(["HJ", "CO", "BTN", "SB"]);
  });

  it("offers nothing where it disagrees: another actor, no fold on offer, or no decision", () => {
    expect(seats(h, node("HJ"))).toEqual([]);
    expect(seats(h, node("UTG", ["check", "raise 2.5"]))).toEqual([]);
    expect(seats(h, { study: "over" })).toEqual([]);
    expect(seats(h, { study: "pf_unsolved" })).toEqual([]);
    expect(seats(h, { error: "the solve's tree has no call for BTN here" })).toEqual([]);
  });
});

describe("foldTargets: the line it leaves", () => {
  const clicks = (from: StudyHand, seats: string[]) =>
    seats.reduce((h, actor) => play(h, { study: "node", street: "preflop", actor }, { action: "fold", freq: 0.5 }), from);

  it("is the line the same folds make clicked one by one, in the URL as well", () => {
    const from = at(6, "UTG:f,HJ:f,CO:r2.5,BTN:r8");
    const t = foldTargets(from).at(-1)!;
    const clicked = clicks(from, t.folds);
    expect(t.hand).toEqual(clicked);
    expect(toSearch(t.hand)).toBe(toSearch(clicked));
    expect(new URLSearchParams(toSearch(t.hand)).get("pre")).toBe("UTG:f,HJ:f,CO:r2.5,BTN:r8,SB:f,BB:f");
    expect(fromSearch(toSearch(t.hand))).toEqual(t.hand);
  });

  it("leaves the hand's game as it was: setup, solver source and sizes", () => {
    const setup = { ante: 0.1 };
    const t = foldTargets(at(6, "", { setup, pf: "solver", pfSizes: { open: 3 } }))[1]!;
    expect(t.hand).toMatchObject({ setup, pf: "solver", pfSizes: { open: 3 }, players: 6, stack: 100 });
  });

  it("has each fold as a step: Back undoes one, Forward redoes it, the breadcrumb merges the run", () => {
    const t = foldTargets(at(6)).at(-1)!; // (to the small blind)
    expect(t.folds).toEqual(["UTG", "HJ", "CO", "BTN"]);
    expect(lineOf(t.hand)).toHaveLength(5);
    const prev = back(t.hand)!;
    expect(prev.preflop.map((a) => a.pos)).toEqual(["UTG", "HJ", "CO"]);
    expect(forward(prev, t.hand)).toEqual(t.hand);
    const steps = lineSteps(t.hand, t.hand);
    expect(steps.map((s) => [s.label, s.at])).toEqual([["4 folds", "here"]]);
    expect(steps[0]?.detail).toBe("UTG, HJ, CO, BTN fold");
  });

  it("is said in plain words", () => {
    expect(describeTarget({ seat: "CO", folds: ["UTG", "HJ"] })).toBe("UTG, HJ fold, CO to act");
    expect(describeTarget({ seat: "HJ", folds: ["UTG"] })).toBe("UTG folds, HJ to act");
  });
});
