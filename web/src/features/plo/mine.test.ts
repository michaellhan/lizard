import { describe, expect, it } from "vitest";
import { runJob, startJob, type RiverResult } from "@/engine/plo/river/run";
import { cardName } from "@/engine/plo/cards";
import { handAt } from "@/engine/plo/combos";
import { gradeAt } from "./drill";
import { matchAction, mineFromParams, walkMine } from "./mine";

async function solve(): Promise<RiverResult> {
  const job = startJob({
    oop: "AAxx@50,JT98",
    ip: "KKxx,T987",
    board: "Js9s4d2h7c",
    pot: 10,
    stacks: [50, 50],
    sizes: { bets: [50], raises: [], raiseCap: 0, allIn: false },
    targetPct: 0.05,
    seconds: 20,
  });
  const { result } = await runJob(job, { pause: () => Promise.resolve() });
  return result!;
}

describe("a hand you played over a PLO solve", () => {
  it("reads the link", () => {
    const q = new URLSearchParams("hand=AsAhKdQc&seat=1&act=x,b5,c,zz&from=Hand%20%231");
    expect(mineFromParams(q)).toEqual({ hand: "AsAhKdQc", seat: 1, act: ["x", "b5", "c"], from: "Hand #1" });
    expect(mineFromParams(new URLSearchParams("hand=AsAh&seat=0"))).toBeNull();
    expect(mineFromParams(new URLSearchParams("hand=AsAhKdQc&seat=2"))).toBeNull();
  });

  it("walks the line, grading only your decisions, as the drill grades them", async () => {
    const r = await solve();
    const root = r.nodes.find((n) => n.path === "")!;
    expect(matchAction(root, "x", r.pot)).toBe(root.actions.findIndex((a) => a.kind === "check"));
    // the 50% bet is 5: 5.2 is within 3% of the pot of 10, 6 isn't
    const bet = root.actions.findIndex((a) => a.kind === "bet");
    expect(matchAction(root, "b5.2", r.pot)).toBe(bet);
    expect(matchAction(root, "b6", r.pot)).toBe(-1);

    // a combo OOP holds and that bets: the walk's grade is the drill's for that combo
    const oopHands = r.hands[0];
    const combo = [...oopHands.keys()].find((c) => root.weight[c]! > 0)!;
    const hand = handAt(oopHands[combo]!).map(cardName).join("");
    const walk = walkMine(r, { hand, seat: 0, act: ["b5", "c"] }, undefined);
    expect(walk.combo).toBe(combo);
    expect(walk.stop).toBeNull();
    expect(walk.steps).toHaveLength(2);
    expect(walk.steps[0]!.grade).toEqual(gradeAt(root, combo, bet, r.pot, undefined));
    expect(walk.steps[1]!.node.player).toBe(1);
    expect(walk.steps[1]!.grade).toBeNull();

    // a size the tree hasn't: said, and the walk stops
    const off = walkMine(r, { hand, seat: 0, act: ["b8"] }, undefined);
    expect(off.steps).toHaveLength(0);
    expect(off.stop).toMatch(/hasn't the bet of 8.*5\.00/);

    // a hand outside the range typed: ungraded, in words
    const out = walkMine(r, { hand: "2c3c4h5h", seat: 0, act: ["x"] }, undefined);
    expect(out.combo).toBeNull();
    expect(out.steps[0]!.grade).toBeNull();
    expect(out.steps[0]!.why).toMatch(/isn't in the range/);
  });
});
