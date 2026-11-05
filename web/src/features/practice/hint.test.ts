// A hint: what the spot is and what a call costs, from the chips on the table alone. Neither function is handed an answer,
// so a mix can't reach one.
import { describe, expect, it } from "vitest";
import { noLines, type Move } from "@/poker/table";
import type { DrillProblem } from "./drills";
import { drillHint, handHint } from "./hint";
import { dealNext, simOf, withVillain, type PracticeHand } from "./practice";

function hand(players: number, hero: string, stack = 100, extra: Partial<PracticeHand> = {}): PracticeHand {
  return { seed: 0, n: 0, players, stack, hero, hands: { [hero]: ["Ah", "Kd"] }, board: "Ks7d2c9h3s".match(/../g)!, shown: 0, lines: noLines(), decisions: [], result: null, ...extra };
}
const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const play = (h: PracticeHand, ...ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);
const hint = (h: PracticeHand) => handHint(h, simOf(h));

describe("handHint", () => {
  it("takes the hand and the table, and no answer", () => {
    expect(handHint.length).toBe(2);
    expect(drillHint.length).toBe(1);
  });

  it("first in: the blinds' price", () => {
    expect(hint(hand(2, "SB"))).toBe("Preflop in BTN/SB, no one has come in yet. A call is 0.5bb to win 1.5bb: pot odds of 25.0%, the equity it needs if no more chips go in.");
  });

  it("facing a raise, then a 3-bet", () => {
    const h = play(hand(6, "BB"), mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "raise", 2.5), mv("BTN", "fold"), mv("SB", "fold"));
    expect(hint(h)).toBe("Preflop in BB, facing a raise. A call is 1.5bb to win 4bb: pot odds of 27.3%, the equity it needs if no more chips go in.");
    const again = play(hand(6, "CO"), mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "raise", 2.5), mv("BTN", "raise", 8), mv("SB", "fold"), mv("BB", "fold"));
    expect(hint(again)).toMatch(/^Preflop in CO, facing a 3-bet\. A call is 5\.5bb to win 12bb: pot odds of 31\.4%/);
  });

  it("behind a limp, and the big blind's option with nothing to call", () => {
    const h = play(hand(6, "BTN"), mv("UTG", "fold"), mv("HJ", "call"), mv("CO", "fold"));
    expect(hint(h)).toMatch(/^Preflop in BTN, behind a limp\. A call is 1bb to win/);
    const option = play(hand(2, "BB"), mv("SB", "call"));
    expect(hint(option)).toBe("Preflop in BB, with the option to raise. Nothing to call: the pot is 2bb and you have 99bb behind.");
  });

  it("the straddle's own bet isn't a limp", () => {
    const h = hand(6, "HJ", 100, { straddle: true });
    expect(hint(h)).toMatch(/^Preflop in HJ, no one has come in yet\. A call is 2bb/);
  });

  it("on the flop: the pot's kind, your position, and the price of a bet", () => {
    const pre = play(hand(2, "BB"), mv("SB", "raise", 2.5), mv("BB", "call"));
    const flop = dealNext(pre, "flop");
    expect(hint(flop)).toBe("Flop of a single-raised pot, heads-up against BTN/SB, out of position. Nothing to call: the pot is 5bb and you have 97.5bb behind.");
    const facing = play(flop, mv("BB", "check"));
    const you = { ...facing, hero: "SB", hands: { SB: ["Ah", "Kd"] as [string, string] } };
    expect(hint(you)).toMatch(/^Flop of a single-raised pot, heads-up against BB, in position\. Nothing to call/);
    const bet = play(flop, mv("BB", "check"), mv("SB", "bet", 2));
    expect(hint(bet)).toBe("Flop of a single-raised pot, heads-up against BTN/SB, out of position. A call is 2bb to win 7bb: pot odds of 22.2%, the equity it needs if no more chips go in.");
  });

  it("counts the players left where there are more than one", () => {
    const pre = play(hand(6, "BB"), mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "raise", 2.5), mv("BTN", "call"), mv("SB", "fold"), mv("BB", "call"));
    expect(hint(dealNext(pre, "flop"))).toMatch(/^Flop of a single-raised pot in BB, against 2 players\./);
  });

  it("a short call: the price stops at what you can match, and what you can win with it", () => {
    const stacks = { SB: 100, BB: 10 };
    const h = play(hand(2, "BB", 100, { stacks }), mv("SB", "raise", 50));
    // you call 9 more to have 10 in: the 40 above that isn't yours to win, so 10 of theirs and 1 of yours
    expect(hint(h)).toMatch(/A call is 9bb to win 11bb: pot odds of 45\.0%/);
  });

  it("says a rake is left out where there is one", () => {
    expect(hint(hand(2, "SB", 100, { rake: { pct: 5 } }))).toMatch(/if no more chips go in, before the rake\.$/);
  });
});

describe("drillHint", () => {
  const pr = (o: Partial<DrillProblem>) => ({ player: 0 as 0 | 1, hero: "BB", pot: 5.5, bet: 0, turn: undefined, ...o }) as Pick<DrillProblem, "player" | "hero" | "pot" | "bet" | "turn">;

  it("says where you sit and the pot", () => {
    expect(drillHint(pr({}))).toBe("Flop, heads-up, BB out of position. Nothing to call: the pot is 5.5bb.");
    expect(drillHint(pr({ player: 1, hero: "BTN" }))).toBe("Flop, heads-up, BTN in position. Nothing to call: the pot is 5.5bb.");
  });

  it("prices a bet: the pot already holds it", () => {
    expect(drillHint(pr({ player: 1, hero: "BTN", bet: 1.8, pot: 7.3 }))).toMatch(/^Flop, heads-up, BTN in position\. A call is 1\.8bb to win 7\.3bb: pot odds of 19\.8%/);
  });
});
