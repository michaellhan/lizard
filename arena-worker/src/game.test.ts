// The hand engine: blinds, who acts when, the smallest raise, all-ins (the part nobody can call given back, the board run
// out face up), showdowns and split pots, time-outs; on Lizard's own table rules (web/src/poker/table.ts).
import { describe, expect, it } from "vitest";
import { DECK } from "../../web/src/poker/table";
import { act, deal, says, simOf, timeOut, toActOf, type Hand } from "./game";

/** A deck with these cards first (SB's two, BB's two, then the board), the rest after in any order. */
const deckOf = (...top: string[]) => [...top, ...DECK.filter((c) => !top.includes(c))];
const NOW = 1_000_000;

/** seat 0 on the button (small blind), 100bb; SB AsAh, BB KsKh, board 2c 7d 9h Jc 3s */
const fresh = (stack = 100, top = ["As", "Ah", "Ks", "Kh", "2c", "7d", "9h", "Jc", "3s"]): Hand => deal(1, 0, stack, deckOf(...top), NOW);

describe("a heads-up hand", () => {
  it("posts the blinds, and the small blind (the button) acts first before the flop", () => {
    const h = fresh();
    const sim = simOf(h);
    expect(sim.streets.preflop?.bets).toEqual({ SB: 0.5, BB: 1 });
    expect(toActOf(h)).toBe(0);
    expect(h.shown).toBe(0);
    expect(h.hole).toEqual({ SB: ["As", "Ah"], BB: ["Ks", "Kh"] });
  });

  it("gives the big blind its option after a limp, then the big blind acts first after the flop", () => {
    const h = fresh();
    expect(act(h, 1, { action: "check" }, NOW)).toBe("not_your_turn");
    expect(act(h, 0, { action: "call" }, NOW)).toEqual({ pos: "SB", action: "call" });
    expect(toActOf(h)).toBe(1);
    expect(h.shown).toBe(0);
    act(h, 1, { action: "check" }, NOW);
    expect(h.shown).toBe(3);
    expect(toActOf(h)).toBe(1);
    act(h, 1, { action: "check" }, NOW);
    expect(toActOf(h)).toBe(0);
  });

  it("refuses a raise below the smallest one and a check facing a bet; takes the smallest raise to the cent", () => {
    const h = fresh();
    expect(act(h, 0, { action: "check" }, NOW)).toBe("illegal");
    expect(act(h, 0, { action: "raise", to: 1.5 }, NOW)).toBe("illegal");
    expect(act(h, 0, { action: "raise" }, NOW)).toBe("illegal");
    expect(act(h, 0, { action: "raise", to: 3 }, NOW)).toEqual({ pos: "SB", action: "raise", to: 3 });
    // facing 3, the smallest reraise is to 5 (a raise of 2 more)
    expect(act(h, 1, { action: "raise", to: 4.5 }, NOW)).toBe("illegal");
    expect(act(h, 1, { action: "raise", to: 5 }, NOW)).toEqual({ pos: "BB", action: "raise", to: 5 });
    expect(simOf(h).streets.preflop?.minRaise).toBe(2);
  });

  it("gives back the part of an all-in nobody called, and the hand ends with nothing shown on a fold", () => {
    const h = fresh();
    act(h, 0, { action: "all-in" }, NOW);
    act(h, 1, { action: "fold" }, NOW);
    expect(h.result).not.toBeNull();
    expect(h.reveal).toBe(false);
    // SB won the big blind: +1, BB lost it
    expect(h.result!.net).toEqual([1, -1]);
    expect(h.result!.pays).toEqual({ SB: 2, BB: 0 });
    expect(simOf(h).streets.preflop?.returned).toEqual({ SB: 99 });
    expect(says(h, ["Ann", "Bob"])).toBe("Ann wins 2bb.");
  });

  it("runs the board out face up once both are all in, and pays the best hand all of it", () => {
    const h = fresh();
    act(h, 0, { action: "raise", to: 3 }, NOW);
    act(h, 1, { action: "all-in" }, NOW);
    expect(h.reveal).toBe(false);
    act(h, 0, { action: "call" }, NOW);
    expect(h.reveal).toBe(true);
    expect(h.shown).toBe(5);
    expect(h.result!.net).toEqual([100, -100]);
    expect(h.result!.winners).toEqual([0]);
    expect(says(h, ["Ann", "Bob"])).toBe("Ann wins 200bb with pair of aces.");
  });

  it("splits a pot to the cent where the hands tie", () => {
    // both play the board's straight
    const h = fresh(20, ["2s", "3h", "2d", "3c", "Th", "Js", "Qd", "Kc", "Ac"]);
    act(h, 0, { action: "call" }, NOW);
    for (let i = 0; i < 4; i++) {
      act(h, 1, { action: "check" }, NOW);
      act(h, 0, { action: "check" }, NOW);
    }
    expect([...h.result!.winners].sort()).toEqual([0, 1]);
    expect(h.result!.net).toEqual([0, 0]);
    expect(says(h, ["Ann", "Bob"])).toMatch(/^Split pot/);
  });

  it("settles a showdown on the river after bets on every street", () => {
    const h = fresh(40);
    act(h, 0, { action: "raise", to: 2.5 }, NOW);
    act(h, 1, { action: "call" }, NOW);
    act(h, 1, { action: "check" }, NOW);
    act(h, 0, { action: "bet", to: 2 }, NOW);
    act(h, 1, { action: "call" }, NOW);
    act(h, 1, { action: "check" }, NOW);
    act(h, 0, { action: "check" }, NOW);
    act(h, 1, { action: "bet", to: 5 }, NOW);
    act(h, 0, { action: "call" }, NOW);
    expect(h.result!.net).toEqual([9.5, -9.5]);
    expect(h.reveal).toBe(true);
  });

  it("an all-in raise for less than a full raise doesn't reopen the betting (short stack: 2.5bb)", () => {
    const h = fresh(2.5);
    act(h, 0, { action: "raise", to: 2 }, NOW);
    act(h, 1, { action: "all-in" }, NOW);
    // BB's all-in to 2.5 is half a raise: SB may only call or fold
    const v = simOf(h);
    expect(v.cur?.locked.has("SB")).toBe(true);
    expect(act(h, 0, { action: "raise", to: 5 }, NOW)).toBe("illegal");
    act(h, 0, { action: "call" }, NOW);
    expect(h.result).not.toBeNull();
  });

  it("times out a seat: a check where it may, else a fold", () => {
    const h = fresh();
    act(h, 0, { action: "call" }, NOW);
    expect(timeOut(h, NOW)).toBe(1);
    expect(h.lines.preflop.at(-1)).toEqual({ pos: "BB", action: "check" });
    act(h, 1, { action: "bet", to: 2 }, NOW);
    expect(timeOut(h, NOW)).toBe(0);
    expect(h.result!.timedOut).toBe(0);
    expect(says(h, ["Ann", "Bob"])).toMatch(/^Ann ran out of time\. Bob wins/);
  });

  it("refuses a bad deck", () => {
    expect(() => deal(1, 0, 100, ["As", "As", "Kd", "Qd", "2c", "3c", "4c", "5c", "6c"], NOW)).toThrow();
  });
});
