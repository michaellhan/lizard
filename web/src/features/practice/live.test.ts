// Live opponents (live.ts): the hand-set rules a live regular's move is made by, drawn the same at the same spot.
import { describe, expect, it } from "vitest";
import type { Move } from "@/poker/table";
import { moveOf } from "./flow";
import { handTier, liveMove, looseCalls, noPairCall, playable, weakCall, worthPlaying, type OppMove } from "./live";
import { classOf } from "@/engine/nlhe/cards";
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

  it("reads the river against the board's own hand: a better one is strong, the board's nuts is never folded", () => {
    // (an ace-high straight over the board's king-high one)
    expect(handTier(cards("AcQc"), cards("QsKdJcTd9s")).tier).toBe(3);
    // (playing the board's broadway: the nuts with no flush possible, a split at worst; else a weak showdown hand)
    expect(handTier(cards("2c3d"), cards("AsKdQcJsTh")).tier).toBe(2);
    expect(handTier(cards("2c3d"), cards("AsKdQsJsTh")).tier).toBe(1);
    expect(handTier(cards("2c3d"), cards("AhKhQhJhTh")).tier).toBe(2);
    // (the board's two pair: an overpair over it is yours, a kicker isn't)
    expect(handTier(cards("ThTc"), cards("4d9h3s4s9s")).tier).toBe(2);
    expect(handTier(cards("AhKc"), cards("4d9h3s4s9s")).tier).toBe(0);
  });

  it("reads a hand that beats the board's straight or better by how many holdings beat it in turn", () => {
    // (quads on the board: the ace kicker is the nuts, the king loses to an ace (17%), the four to any card over it (96%))
    expect(handTier(cards("Ad3d"), cards("7c7d7h7s2c")).tier).toBe(3);
    expect(handTier(cards("KdQd"), cards("7c7d7h7s2c")).tier).toBe(2);
    expect(handTier(cards("4d3d"), cards("7c7d7h7s2c")).tier).toBe(1);
    // (five hearts on the board: the queen of hearts is beaten by nothing but a straight flush, the three by any higher heart)
    expect(handTier(cards("Qh4c"), cards("AhKh9h5h2h")).tier).toBe(3);
    expect(handTier(cards("3h4c"), cards("AhKh9h5h2h")).tier).toBe(1);
    // (a better straight than the board's: strong where nothing else can be made, weak with four hearts out)
    expect(handTier(cards("Tc2d"), cards("5s6d7c8h9s")).tier).toBe(3);
    expect(handTier(cards("TcJc"), cards("5h6h7h8h9c")).tier).toBe(1);
  });
});

describe("the price of a call", () => {
  it("keeps the rate facing a third of the pot, cuts it facing more, and seldom calls the stack with nothing", () => {
    expect(noPairCall(0.4, 1 / 3, false)).toBe(0.4);
    expect(noPairCall(0.4, 0.2, true)).toBe(0.4);
    expect(noPairCall(0.4, 1, false)).toBeCloseTo(0.4 / 9);
    expect(noPairCall(0.4, 1, true)).toBeLessThanOrEqual(0.02);
    expect(noPairCall(0.2, 3, true)).toBeLessThanOrEqual(0.02);
    // (on the river, an all-in or a call of half the chips with nothing is 2% at most at any price; the flop keeps its float)
    expect(noPairCall(0.12, 0.2, true, true)).toBe(0.02);
    expect(noPairCall(0.12, 0.2, false, true)).toBe(0.12);
    // (a weak pair or a draw: the profile's rate small, its pot-size rate facing the pot, its cap with the stack at stake)
    expect(weakCall(0.85, 0.6, 0.3, 1 / 3, false)).toBe(0.85);
    expect(weakCall(0.85, 0.6, 0.3, 1, false)).toBeCloseTo(0.6);
    expect(weakCall(0.85, 0.6, 0.3, 2, false)).toBeCloseTo(0.3);
    expect(weakCall(0.97, 0.85, 0.45, 1, true)).toBe(0.45);
  });
});

describe("liveMove, the price", () => {
  // (BTN 200, SB 200, BB 12: after a raise to 3 called twice and a flop bet of 6 called twice, BB has 3 behind in a 27bb pot,
  // and the turn's 191bb shove costs it those 3)
  const shoved = (kind: "live" | "loose", seed: number, hole: string): PracticeHand => {
    const h = newHand(3, 100, 0, seed, { opponents: kind, carry: true }, { stacks: { BTN: 200, SB: 200, BB: 12 }, rebuys: [], hero: "BTN" });
    const pre = played({ ...h, board: cards("Ks9d4c2s3h") }, [mv("BTN", "raise", 3), mv("SB", "call"), mv("BB", "call")]);
    const flop = played(dealNext(pre, "flop"), [mv("SB", "check"), mv("BB", "check"), mv("BTN", "bet", 6), mv("SB", "call"), mv("BB", "call")]);
    return holding(played(dealNext(flop, "turn"), [mv("SB", "check"), mv("BB", "check"), mv("BTN", "all-in"), mv("SB", "fold")]), "BB", hole);
  };
  const folds = (kind: "live" | "loose", hole: string) =>
    Array.from({ length: 200 }, (_, s) => at(shoved(kind, s + 1, hole), { action: "call" }).action).filter((a) => a === "fold").length / 200;

  it("prices a short stack's call as its last chips, not the whole bet", () => {
    expect(simOf(shoved("live", 1, "7h7c")).toAct).toBe("BB");
    // (a weak pair calls its last 3bb into 27 at the small-bet rate: 85% live, 97% loose)
    expect(folds("live", "7h7c")).toBeLessThan(0.25);
    expect(folds("loose", "7h7c")).toBeLessThan(0.1);
  });

  it("calls a big bet that stakes the stack with a pair and a draw at least as often as with the draw alone", () => {
    // (BB has 6 behind after calling a raise to 2.5, and the flop bet of 6 into 6 puts it all-in)
    const jam = (seed: number, hole: string) => {
      const h = newHand(6, 100, 0, seed, { opponents: "live", carry: true }, { stacks: { UTG: 100, HJ: 100, CO: 100, BTN: 100, SB: 100, BB: 8.5 }, rebuys: [], hero: "BTN" });
      const pre = played({ ...h, board: cards("Kh7c2hQs3d") }, [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")]);
      return holding(played(dealNext(pre, "flop"), [mv("BB", "check"), mv("BTN", "bet", 6)]), "BB", hole);
    };
    const calls = (hole: string) => Array.from({ length: 300 }, (_, s) => at(jam(s + 1, hole), { action: "fold" }).action).filter((a) => a === "call").length / 300;
    // (8h7h: a pair of sevens and a flush draw; Ah5h: the draw alone; both at the draw's cap of 45%)
    expect(calls("8h7h")).toBeGreaterThan(0.38);
    expect(calls("8h7h")).toBeGreaterThan(calls("Ah5h") - 0.08);
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

// More action: the hands dealt you, and the loose opponents' moves.
const RANKS = "AKQJT98765432";
/** Every starting-hand class with its number of combos. */
const classes = (): [string, number][] =>
  [...RANKS].flatMap((x, i) => [...RANKS.slice(i)].flatMap((y): [string, number][] => (x === y ? [[x + y, 6]] : [[`${x}${y}s`, 4], [`${x}${y}o`, 12]])));
const combos = (f: (c: string) => boolean) => classes().reduce((n, [c, k]) => n + (f(c) ? k : 0), 0);
const loose = (seed = 1) => newHand(6, 100, 0, seed, { opponents: "loose" });

describe("worthPlaying and looseCalls", () => {
  it("are the best 36% and 62% of hands, as their notes say", () => {
    expect(combos(worthPlaying)).toBe(482);
    expect(combos(looseCalls)).toBe(822);
    // (every hand dealt you is one a loose player would call with too)
    expect(classes().every(([c]) => !worthPlaying(c) || looseCalls(c))).toBe(true);
    for (const c of ["22", "A2o", "K2s", "Q6s", "J7s", "54s", "T9o", "KTo"]) expect(worthPlaying(c), c).toBe(true);
    for (const c of ["Q5s", "J6s", "43s", "K9o", "98o", "72o"]) expect(worthPlaying(c), c).toBe(false);
    for (const c of ["72s", "J9o", "K7o", "54o", "T8o"]) expect(looseCalls(c), c).toBe(true);
    for (const c of ["72o", "J5o", "K6o", "43o", "T7o"]) expect(looseCalls(c), c).toBe(false);
  });
});

describe("More action (loose opponents)", () => {
  it("deals you only hands worth playing, by the seed, and leaves a drill's pot alone", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const h = loose(seed);
      expect(h.opponents).toBe("loose");
      expect(worthPlaying(classOf(h.hands[h.hero]!.join(""))), `seed ${seed}`).toBe(true);
      expect(new Set(Object.values(h.hands).flat().concat(h.board)).size).toBe(17);
    }
    expect(loose(5)).toEqual(loose(5));
    expect(newHand(6, 100, 0, 1, { opponents: "loose", pot: "srp" }).opponents).toBeUndefined();
  });

  it("limps and calls opens wide, and sees more flops than a live regular", () => {
    expect(at(holding(loose(), "UTG", "Js9d"), OPEN)).toEqual({ action: "call" });
    expect(at(holding(live(), "UTG", "Js9d"), OPEN)).toBe(OPEN);
    const raised = (h: PracticeHand) => played(h, [mv("UTG", "raise", 2.5)]);
    expect(at(holding(raised(loose()), "HJ", "Td8c"), { action: "fold" })).toEqual({ action: "call" });
    expect(at(holding(raised(live()), "HJ", "Td8c"), { action: "fold" })).toEqual({ action: "fold" });
    // (across every class at the HJ facing an open, the loose player calls or raises far more often)
    const inPot = (h: PracticeHand) =>
      classes().reduce((n, [c, k]) => {
        const hole = c.length === 2 ? `${c[0]}s${c[1]}d` : c[2] === "s" ? `${c[0]}s${c[1]}s` : `${c[0]}s${c[1]}d`;
        const a = at(holding(raised(h), "HJ", hole), { action: "fold" }).action;
        return n + (a === "fold" ? 0 : k);
      }, 0);
    expect(inPot(loose())).toBeGreaterThan(inPot(live()) * 2);
  });

  it("calls a flop bet with any pair or draw nearly always, floats with nothing, and still folds air sometimes", () => {
    const pre = played(loose(), [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")]);
    const flop = { ...dealNext(pre, "flop"), board: cards("Ks7c2dQh3s") };
    const bet = played(flop, [mv("BB", "check"), mv("BTN", "bet", 2)]);
    const many = (hole: string) => Array.from({ length: 60 }, (_, s) => at(holding({ ...bet, seed: s }, "BB", hole), { action: "fold" }).action);
    expect(many("Ah7d").filter((a) => a === "fold").length).toBeLessThan(6);
    const air = many("9h8h");
    expect(air.filter((a) => a === "call").length).toBeGreaterThan(12);
    expect(air).toContain("fold");
  });

  it("draws the same move at the same spot", () => {
    const h = holding(loose(7), "UTG", "AhQd");
    expect(moveOf(h, OPEN)).toEqual(moveOf(h, OPEN));
  });
});
