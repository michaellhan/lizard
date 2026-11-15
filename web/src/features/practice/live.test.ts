// Live opponents (live.ts): the hand-set rules a live regular's move is made by, drawn the same at the same spot.
import { describe, expect, it } from "vitest";
import type { Move } from "@/poker/table";
import { moveOf } from "./flow";
import { handTier, liveMove, playable, type OppMove } from "./live";
import { dealNext, newHand, simOf, withVillain, type PracticeHand } from "./practice";

const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const played = (h: PracticeHand, ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);
const cards = (s: string) => s.match(/../g)!;
const holding = (h: PracticeHand, seat: string, hole: string): PracticeHand => ({ ...h, hands: { ...h.hands, [seat]: cards(hole) as [string, string] } });
// (a 6-max hand with you on the button, UTG first to act)
const live = (seed = 1) => newHand(6, 100, 0, seed, { opponents: "live" });
const at = (h: PracticeHand, m: OppMove) => liveMove(h, m, simOf(h));
const OPEN: OppMove = { action: "fold", actions: [{ action: "fold" }, { action: "call" }, { action: "raise 2.5", amount_bb: 2.5 }] };

describe("playable", () => {
  it("takes the hands a live regular plays and leaves the rest", () => {
    for (const c of ["AA", "22", "A2s", "K9s", "T8s", "54s", "64s", "ATo", "JTo", "KQo"]) expect(playable(c), c).toBe(true);
    for (const c of ["K8s", "T7s", "43s", "53s", "A9o", "J9o", "72o", "Q8o"]) expect(playable(c), c).toBe(false);
  });
});

describe("handTier", () => {
  it("reads a set, top pair, a weaker pair, a draw and nothing", () => {
    expect(handTier(cards("7c7d"), cards("7hKs2d"))).toEqual({ tier: 3, draw: false });
    expect(handTier(cards("AhKd"), cards("Ks7c2d"))).toEqual({ tier: 2, draw: false });
    expect(handTier(cards("QhQd"), cards("Js7c2d"))).toEqual({ tier: 2, draw: false });
    expect(handTier(cards("9h9d"), cards("Js7c2d"))).toEqual({ tier: 1, draw: false });
    expect(handTier(cards("Ah7d"), cards("Ks7c2d"))).toEqual({ tier: 1, draw: false });
    expect(handTier(cards("AhQh"), cards("Kh7h2d"))).toEqual({ tier: 0, draw: true });
    expect(handTier(cards("9d8c"), cards("Ts7h2d"))).toEqual({ tier: 0, draw: true });
    expect(handTier(cards("AdQc"), cards("Ks7h2d"))).toEqual({ tier: 0, draw: false });
  });

  it("counts the board's own pair as nobody's, and a draw as none on the river", () => {
    // (a pair of fives under a paired board is a pair, not two pair)
    expect(handTier(cards("Ah5d"), cards("KsKc5c")).tier).toBe(1);
    // (the board's two pair, played with an ace: nothing of yours)
    expect(handTier(cards("AhQd"), cards("KsKc5c5d2h")).tier).toBe(0);
    expect(handTier(cards("AhQh"), cards("Kh7h2d3c4s")).draw).toBe(false);
  });
});

describe("liveMove", () => {
  it("leaves the move alone outside a live session", () => {
    const h = holding(newHand(6, 100, 0, 1), "UTG", "7h2c");
    expect(at(h, OPEN)).toBe(OPEN);
  });

  it("limps a playable hand the equilibrium folds, and raises aces at the mix's size", () => {
    expect(at(holding(live(), "UTG", "6s5s"), OPEN)).toEqual({ action: "call" });
    expect(at(holding(live(), "UTG", "7h2c"), OPEN)).toBe(OPEN);
    expect(at(holding(live(), "UTG", "AsAd"), OPEN)).toEqual({ action: "raise", to: 2.5 });
  });

  it("calls a raise with a playable hand and folds to a 3-bet without a strong one", () => {
    const raised = played(live(), [mv("UTG", "raise", 2.5)]);
    expect(at(holding(raised, "HJ", "8s7s"), { action: "fold" })).toEqual({ action: "call" });
    // (no 3-bet bluff: the equilibrium's raise with a weak hand folds)
    expect(at(holding(raised, "HJ", "Qs5s"), { action: "raise", to: 8 }).action).toBe("fold");

    const threeBet = played(live(), [mv("UTG", "raise", 2.5), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 8), mv("SB", "fold"), mv("BB", "fold")]);
    expect(at(holding(threeBet, "UTG", "8s7s"), { action: "call" })).toEqual({ action: "fold" });
    expect(at(holding(threeBet, "UTG", "QsQd"), { action: "fold" })).toEqual({ action: "call" });
    expect(at(holding(threeBet, "UTG", "KsKd"), { action: "call" })).toEqual({ action: "all-in" });
  });

  it("calls a flop bet with a pair, folds nothing most of the time, and never bluff-raises", () => {
    const pre = played(live(), [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")]);
    const flop = { ...dealNext(pre, "flop"), board: cards("Ks7c2dQh3s") };
    const bet = played(flop, [mv("BB", "check"), mv("BTN", "bet", 2)]);
    expect(at(holding(bet, "BB", "Ah7d"), { action: "fold" })).toEqual({ action: "call" });
    expect(at(holding(bet, "BB", "AhKd"), { action: "raise", to: 7 })).toEqual({ action: "call" });
    const air = Array.from({ length: 40 }, (_, s) => at(holding({ ...bet, seed: s }, "BB", "9h8h"), { action: "raise", to: 7 }).action);
    expect(air).not.toContain("raise");
    expect(air.filter((a) => a === "fold").length).toBeGreaterThan(25);
  });

  it("draws the same move at the same spot, so the look-ahead and the table agree", () => {
    const h = holding(live(7), "UTG", "AhQd");
    expect(moveOf(h, OPEN)).toEqual(moveOf(h, OPEN));
    const moves = new Set(Array.from({ length: 30 }, (_, s) => at({ ...h, seed: s }, OPEN).action));
    expect([...moves].sort()).toEqual(["call", "raise"]);
  });
});
