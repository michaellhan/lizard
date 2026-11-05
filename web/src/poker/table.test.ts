import { describe, expect, it } from "vitest";
import { seatsOf } from "./seats";
import {
  deal,
  legal,
  noLines,
  recordOf,
  seeded,
  settle,
  sidePots,
  simulate,
  withMove,
  type Lines,
  type Move,
  type TableSetup,
} from "./table";

// "UTG f, HJ f, CO a, BTN c" -> moves (the classic suites' acts())
const acts = (s: string): Move[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [pos = "", a = ""] = x.split(" ");
      const kind = { f: "fold", c: "call", x: "check", a: "all-in" }[a[0] ?? ""];
      if (kind) return { pos, action: kind } as Move;
      return { pos, action: a[0] === "b" ? "bet" : "raise", to: parseFloat(a.slice(1)) };
    });

const table = (players: number, stacks: Record<string, number> = {}, stack = 100): TableSetup => ({
  players,
  stacks: Object.fromEntries(seatsOf(players).map((p) => [p, stacks[p] ?? stack])),
});
const lines = (l: Partial<Record<keyof Lines, string>>): Lines => ({
  preflop: acts(l.preflop ?? ""),
  flop: acts(l.flop ?? ""),
  turn: acts(l.turn ?? ""),
  river: acts(l.river ?? ""),
});

// cases of solver/tests/js/stacks.test.js
describe("simulate", () => {
  it("a short stack's all-in: calls for less and the side pot", () => {
    const t = table(6, { CO: 30 });
    let l = lines({ preflop: "UTG f, HJ f, CO a, BTN c, SB f, BB c" });
    let s = simulate(t, l, 3);
    expect([s.current, s.toAct, s.pot, [...s.allin]]).toEqual(["flop", "BB", 90.5, ["CO"]]);
    l = { ...l, flop: acts("BB b20, BTN c") };
    s = simulate(t, l, 4);
    expect([s.current, s.toAct, s.pot]).toEqual(["turn", "BB", 130.5]);
    const live = [...s.active];
    expect(sidePots(s.invested, live, s.allin)).toEqual([
      { amount: 90.5, eligible: ["CO", "BTN", "BB"] },
      { amount: 40, eligible: ["BTN", "BB"] },
    ]);
    l = { ...l, turn: acts("BB a, BTN c") };
    s = simulate(t, l, 4);
    expect([s.waiting, s.runout, s.pot, [...s.allin].sort()]).toEqual(["river", true, 230.5, ["BB", "BTN", "CO"]]);
    expect(sidePots(s.invested, [...s.active], s.allin).map((x) => x.amount)).toEqual([90.5, 140]);
  });

  it("a bet nobody can call in full comes back once the street closes", () => {
    let s = simulate(table(6, { BB: 20 }), lines({ preflop: "UTG f, HJ f, CO f, BTN a, SB f, BB c" }), 0);
    expect([s.waiting, s.runout, s.pot, [...s.allin], s.streets.preflop!.returned]).toEqual(["flop", true, 40.5, ["BB"], { BTN: 80 }]);
    expect(s.invested.BTN).toBe(20);
    s = simulate(table(6, { BB: 20 }), lines({ preflop: "UTG f, HJ f, CO f, BTN a, SB f, BB c" }), 3);
    expect([s.waiting, s.cur]).toEqual(["turn", null]); // no flop betting: one player has chips
    // all-in for less than the big blind: the big blind has nothing to call
    s = simulate(table(2, { SB: 0.75 }), lines({ preflop: "SB c" }), 0);
    expect([s.waiting, s.pot, [...s.allin], s.streets.preflop!.returned]).toEqual(["flop", 1.5, ["SB"], { BB: 0.25 }]);
    s = simulate(table(2, { SB: 10 }), lines({ preflop: "SB a, BB c" }), 0);
    expect([s.waiting, s.pot, s.runout]).toEqual(["flop", 20, true]);
  });

  it("a hand that ends on a fold to a raise: the uncalled part goes back", () => {
    const s = simulate(table(6), lines({ preflop: "UTG f, HJ f, CO f, BTN r2.5, SB f, BB c", flop: "BB b6, BTN r20.5, BB f" }), 3);
    expect([s.handOver, s.pot, s.invested.BTN, s.streets.flop!.returned]).toEqual([true, 17.5, 8.5, { BTN: 14.5 }]);
  });

  it("acts in order: preflop from UTG (heads-up the small blind), postflop from the blinds (heads-up the big blind)", () => {
    expect(simulate(table(6), noLines(), 0).toAct).toBe("UTG");
    expect(simulate(table(2), noLines(), 0).toAct).toBe("SB");
    expect(simulate(table(2), lines({ preflop: "SB c, BB x" }), 3).toAct).toBe("BB");
    expect(simulate(table(6), lines({ preflop: "UTG f, HJ f, CO c, BTN f, SB c, BB x" }), 3).toAct).toBe("SB");
    // the big blind's option after limps
    expect(simulate(table(3), lines({ preflop: "BTN c, SB c" }), 0).toAct).toBe("BB");
  });

  it("an all-in for less than a full raise doesn't reopen the betting", () => {
    // BTN raises to 3, SB (4bb) jams to 4, BB calls: BTN may call, not raise again
    const t = table(3, { SB: 4 });
    const s = simulate(t, lines({ preflop: "BTN r3, SB a, BB c" }), 0);
    expect(s.toAct).toBe("BTN");
    expect(legal(t, s)).toMatchObject({ toAct: "BTN", toCall: 1, canRaise: false });
    expect(recordOf(t, s, { action: "raise", to: 10 })).toMatch(/can't raise/);
    expect(recordOf(t, s, { action: "raise", to: 10, clamp: true })).toEqual({ pos: "BTN", action: "call" });
  });

  it("a straddle: the first seat posts 2bb and acts last preflop, a raise is to 4 or more (not heads-up)", () => {
    const t = { ...table(6), straddle: true };
    const s = simulate(t, noLines(), 0);
    expect([s.toAct, s.cur?.curBet, s.cur?.bets.UTG, s.pot]).toEqual(["HJ", 2, 2, 3.5]);
    expect(legal(t, s)).toMatchObject({ toAct: "HJ", toCall: 2, minTo: 4 });
    const after = simulate(t, lines({ preflop: "HJ f, CO r7, BTN f, SB f, BB f" }), 0);
    expect(after.toAct).toBe("UTG");
    // folded round to it, the straddle checks its option
    expect(simulate(t, lines({ preflop: "HJ c, CO f, BTN f, SB f, BB f" }), 0).toAct).toBe("UTG");
    expect(simulate({ ...table(2), straddle: true }, noLines(), 0).cur?.curBet).toBe(1);
  });
});

describe("recordOf", () => {
  it("rounds sizes to half a big blind, refuses one under the minimum, lifts an opponent's", () => {
    const t = table(6);
    const s = simulate(t, noLines(), 0);
    expect(recordOf(t, s, { action: "raise", to: 2.6 })).toEqual({ pos: "UTG", action: "raise", to: 2.5 });
    expect(recordOf(t, s, { action: "raise", to: 1.5 })).toBe("The smallest raise is to 2bb.");
    expect(recordOf(t, s, { action: "raise", to: 1.5, clamp: true })).toEqual({ pos: "UTG", action: "raise", to: 2 });
    expect(recordOf(t, s, { action: "raise", to: 500 })).toEqual({ pos: "UTG", action: "all-in" });
    expect(recordOf(t, s, { action: "check" })).toBe("UTG can't check, there's 1bb to call.");
    const f = simulate(t, lines({ preflop: "UTG f, HJ f, CO f, BTN r2.5, SB f, BB c" }), 3);
    expect(recordOf(t, f, { action: "bet", to: 2 })).toEqual({ pos: "BB", action: "bet", to: 2 });
    expect(recordOf(t, f, { action: "bet", to: 0.5 })).toBe("The smallest bet is 1bb.");
    expect(recordOf(t, f, { action: "call" })).toEqual({ pos: "BB", action: "check" });
  });
});

// cases of solver/tests/js/table.test.js ("showdown: ...")
describe("settle", () => {
  const end = (t: TableSetup, l: Lines, hands: Record<string, string[]>, board: string[]) => {
    const s = simulate(t, l, 5);
    expect(s.handOver).toBe(true);
    return settle(t, s.invested, [...s.active], s.allin, board, (p) => hands[p] ?? []);
  };
  const checks = (players: string[]) => players.map((p) => `${p} x`).join(", ");

  it("pays the best hand, splits a tie, and pays side pots to the best hand in each", () => {
    const t = table(3);
    const down = { flop: checks(["SB", "BB", "BTN"]), turn: checks(["SB", "BB", "BTN"]), river: checks(["SB", "BB", "BTN"]) };
    let r = end(t, lines({ preflop: "BTN c, SB c, BB x", ...down }), { BTN: ["Qh", "4h"], SB: ["Kc", "7c"], BB: ["2d", "3s"] }, ["Kd", "7d", "9h", "2h", "Jh"]);
    expect([r.winners, r.pays]).toEqual([["BTN"], { BTN: 3 }]);
    // the board's straight: all three split
    r = end(t, lines({ preflop: "BTN r3, SB c, BB c", ...down }), { BTN: ["2c", "3c"], SB: ["4d", "5d"], BB: ["2s", "8d"] }, ["Ah", "Kd", "Qs", "Jc", "Th"]);
    expect(r.winners).toEqual(["SB", "BB", "BTN"]);
    expect(r.pays).toEqual({ SB: 3, BB: 3, BTN: 3 });
    r = end(t, lines({ preflop: "BTN r3, SB c, BB c", ...down }), { BTN: ["Ah", "Kh"], SB: ["Ad", "Kd"], BB: ["2s", "8d"] }, ["As", "Kc", "7s", "4c", "3h"]);
    expect(r.pays).toEqual({ SB: 4.5, BTN: 4.5 });
    // the button (10bb) all-in; the blinds bet on: the main pot to the button's aces, the side pot to the kings
    const short = table(3, { BTN: 10 });
    const side = { preflop: "BTN a, SB c, BB c", flop: "SB b20, BB c", turn: "SB x, BB x", river: "SB x, BB x" };
    r = end(short, lines(side), { BTN: ["Ah", "Ad"], SB: ["Kh", "Kd"], BB: ["Qh", "Qd"] }, ["2c", "7d", "9h", "Js", "3s"]);
    expect(r.pots).toEqual([
      { amount: 30, eligible: ["BTN", "SB", "BB"], winners: ["BTN"] },
      { amount: 40, eligible: ["SB", "BB"], winners: ["SB"] },
    ]);
    expect(r.pays).toEqual({ BTN: 30, SB: 40 });
    r = end(short, lines(side), { BTN: ["Ah", "Kc"], SB: ["Ad", "Ks"], BB: ["Qh", "Qd"] }, ["2c", "7d", "9h", "Js", "3s"]);
    expect(r.pots.map((x) => x.winners)).toEqual([["BB"], ["BB"]]);
    expect(r.pays).toEqual({ BB: 70 });
  });

  it("gives the odd cent of a split to the first winner after the button", () => {
    // the board plays (a broadway straight): 2.51bb split two ways, the big blind first after the button
    const t: TableSetup = { players: 3, stacks: { BTN: 100, SB: 100, BB: 100 } };
    const odd = settle(t, { BTN: 1.01, SB: 0.5, BB: 1 }, ["BTN", "BB"], new Set(), ["Ah", "Kd", "Qs", "Jc", "Th"], () => ["2c", "3d"]);
    expect(odd.pays).toEqual({ BB: 1.26, BTN: 1.25 });
  });

  it("takes the rake from pots that saw a flop, up to the cap", () => {
    const t = table(2);
    const s = simulate(t, lines({ preflop: "SB r3, BB c", flop: "BB x, SB b2, BB f" }), 3);
    const r = settle(t, s.invested, [...s.active], s.allin, [], () => [], { pct: 5, cap: 0.2 }, true);
    expect(r.rake).toBe(0.2); // 5% of 6bb, capped at 0.2
    expect(r.pays).toEqual({ SB: 5.8 });
    // preflop: no flop, no drop
    const pre = simulate(t, lines({ preflop: "SB r3, BB f" }), 0);
    expect(settle(t, pre.invested, [...pre.active], pre.allin, [], () => [], { pct: 5 }).pays).toEqual({ SB: 2 }); // (the raise not called comes back)
  });
});

describe("chip conservation", () => {
  // random legal play from random deals, every table size and uneven stacks: every chip put in is paid out
  it("pays out exactly what was put in, every hand", () => {
    const rnd = seeded(7);
    for (let n = 0; n < 10000; n++) {
      const players = 2 + (n % 8);
      const t = table(
        players,
        Object.fromEntries(seatsOf(players).map((p) => [p, Math.round((5 + rnd() * 195) * 2) / 2])),
      );
      const d = deal(players, rnd);
      let l = noLines();
      let shown = 0;
      for (let step = 0; step < 200; step++) {
        const s = simulate(t, l, shown);
        if (s.handOver) break;
        if (s.waiting) {
          shown = { flop: 3, turn: 4, river: 5, preflop: 0 }[s.waiting];
          continue;
        }
        const lg = legal(t, s)!;
        const x = rnd();
        const a =
          x < 0.15 && lg.toCall > 0
            ? { action: "fold" }
            : x < 0.6
              ? { action: "call" }
              : x < 0.8 && lg.canRaise
                ? { action: "raise", to: lg.minTo + rnd() * 10, clamp: true }
                : x < 0.9
                  ? { action: "check" }
                  : { action: "all-in" };
        const m = recordOf(t, s, a);
        if (typeof m === "string") continue; // (a check facing a bet: try again)
        l = withMove(l, s.current!, m);
      }
      const s = simulate(t, l, shown);
      expect(s.handOver).toBe(true);
      const board = d.board.slice(0, shown);
      const live = [...s.active];
      const r = settle(t, s.invested, live, s.allin, board, (p) => d.hands[p]!);
      const inC = Math.round(Object.values(s.invested).reduce((a, b) => a + b, 0) * 100);
      const outC = Math.round(Object.values(r.pays).reduce((a, b) => a + b, 0) * 100);
      expect(outC).toBe(inC);
      // nobody puts in more than its stack, and only players still in are paid
      for (const p of seatsOf(players)) expect(s.invested[p]!).toBeLessThanOrEqual(t.stacks[p]! + 1e-9);
      for (const p of Object.keys(r.pays)) expect(live).toContain(p);
    }
  });

  it("deals 2 cards a seat and 5 to the board, all different, the same again from a seed", () => {
    const a = deal(9, seeded(3));
    const all = [...Object.values(a.hands).flat(), ...a.board];
    expect(all).toHaveLength(23);
    expect(new Set(all).size).toBe(23);
    expect(deal(9, seeded(3))).toEqual(a);
  });
});

describe("a big blind all-in for under half a big blind", () => {
  const t = table(2, { SB: 100, BB: 0.3 });

  it("leaves the small blind nothing to call: the bet it covered closes, and the excess goes back", () => {
    const s = simulate(t, noLines(), 0);
    expect(s.toAct).toBeNull();
    expect(legal(t, s)).toBeNull();
    expect(s.streets.preflop).toMatchObject({ closed: true, returned: { SB: expect.closeTo(0.2) } });
    expect(s.invested).toEqual({ SB: 0.3, BB: 0.3 });
    expect(s.pot).toBeCloseTo(0.6);
    expect(s.runout).toBe(true);
    expect(s.waiting).toBe("flop");
  });

  it("gives the hand to the board, with no chips lost to a fold", () => {
    const s = simulate(t, noLines(), 5);
    expect(s.handOver).toBe(true);
    const hole: Record<string, string[]> = { SB: ["Ah", "Ad"], BB: ["Kh", "Kd"] };
    const r = settle(t, s.invested, [...s.active], s.allin, ["2c", "3d", "4h", "5s", "9c"], (p) => hole[p]!);
    expect(r.pays).toEqual({ SB: 0.6 });
  });

  it("holds behind a seat that folds to it, and with the small blind's own chips short", () => {
    const three = table(3, { BTN: 100, SB: 100, BB: 0.25 });
    expect(simulate(three, noLines(), 0).toAct).toBe("BTN"); // (anyone else still calls the full blind)
    const s = simulate(three, lines({ preflop: "BTN f" }), 0);
    expect(s.toAct).toBeNull();
    expect(s.invested.SB).toBeCloseTo(0.25);
    const short = table(2, { SB: 0.4, BB: 0.3 });
    expect(simulate(short, noLines(), 5).invested).toEqual({ SB: 0.3, BB: 0.3 });
  });

  it("counts the chips left after an ante", () => {
    const a = { ...table(2, { SB: 100, BB: 0.8 }), ante: 0.5 };
    expect(simulate(a, noLines(), 0).toAct).toBeNull();
  });

  it("still replays a fold or a call a stored hand has there", () => {
    const fold = simulate(t, lines({ preflop: "SB f" }), 0);
    expect([fold.handOver, [...fold.active]]).toEqual([true, ["BB"]]);
    expect(fold.invested.SB).toBeCloseTo(0.3);
    const call = simulate(t, lines({ preflop: "SB c" }), 0);
    expect(call.invested).toEqual({ SB: 0.3, BB: 0.3 });
  });

  it("leaves every stack from half a big blind up as it was: the small blind is asked", () => {
    for (const BB of [0.5, 0.75, 1]) {
      const s = simulate(table(2, { SB: 100, BB }), noLines(), 0);
      expect(s.toAct).toBe("SB");
      expect(legal(table(2, { SB: 100, BB }), s)?.toCall).toBeCloseTo(0.5);
    }
    // (a raise is a bet to face, however short the blind)
    expect(simulate(table(3, { BTN: 100, SB: 100, BB: 0.3 }), lines({ preflop: "BTN r2.5" }), 0).toAct).toBe("SB");
  });
});
