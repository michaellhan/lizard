import { describe, expect, it } from "vitest";
import { seatsOf } from "@/poker/seats";
import { legal, maxRaiseTo, noLines, recordOf, seeded, sidePots, simulate, withMove, type Lines, type Move, type Sim, type TableSetup } from "@/poker/table";
import { dealOmaha, potLimit, settleOmaha } from "./betting";
import reference from "./vectors/betting.json";

const table = (players: number, stacks: Record<string, number> = {}, extra: Partial<TableSetup> = {}): TableSetup =>
  potLimit({ players, stacks: Object.fromEntries(seatsOf(players).map((p) => [p, stacks[p] ?? 100])), ...extra });

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
const line = (l: Partial<Record<keyof Lines, string>>): Lines => ({
  preflop: acts(l.preflop ?? ""),
  flop: acts(l.flop ?? ""),
  turn: acts(l.turn ?? ""),
  river: acts(l.river ?? ""),
});

describe("the largest raise: call, then raise by the pot after the call", () => {
  it("opens to 3.5bb at 0.5/1, first in: 1.5 in the pot, 1 to call, 2.5 after it", () => {
    const t = table(6);
    expect(legal(t, simulate(t, noLines(), 0))).toMatchObject({ toAct: "UTG", toCall: 1, minTo: 2, maxTo: 3.5 });
  });

  it("works a raise up by hand", () => {
    const t = table(6);
    // UTG makes it 3.5: pot 5, HJ calls 3.5 first (8.5), raises 8.5, to 12
    let s = simulate(t, line({ preflop: "UTG r3.5" }), 0);
    expect(legal(t, s)).toMatchObject({ toAct: "HJ", toCall: 3.5, minTo: 6, maxTo: 12 });
    // a caller in between adds to it: pot 8.5, CO calls 3.5 (12), raises 12, to 15.5
    s = simulate(t, line({ preflop: "UTG r3.5, HJ c" }), 0);
    expect(legal(t, s)).toMatchObject({ toAct: "CO", maxTo: 15.5 });
    // the small blind has 0.5 in already: pot 5, 3 to call (8), raises 8, to 11.5 (it's 3.5 + 8)
    s = simulate(t, line({ preflop: "UTG r3.5, HJ f, CO f, BTN f" }), 0);
    expect(legal(t, s)).toMatchObject({ toAct: "SB", toCall: 3, maxTo: 11.5 });
  });

  it("bets the pot on the flop, and raises a pot bet to 4 times it", () => {
    const t = table(2);
    let s = simulate(t, line({ preflop: "SB r3, BB c" }), 3);
    expect(legal(t, s)).toMatchObject({ toAct: "BB", toCall: 0, minTo: 1, maxTo: 6 });
    s = simulate(t, line({ preflop: "SB r3, BB c", flop: "BB b6" }), 3);
    expect(legal(t, s)).toMatchObject({ toAct: "SB", toCall: 6, minTo: 12, maxTo: 24 }); // pot 12, call 6 (18), raise 18
  });

  it("gives the big blind the same on its option: the bet stands at 1", () => {
    const t = table(3);
    const s = simulate(t, line({ preflop: "BTN c, SB c" }), 0);
    expect(legal(t, s)).toMatchObject({ toAct: "BB", toCall: 0, maxTo: 4 }); // pot 3, nothing to call, 1 + 3
  });

  it("counts antes and a straddle in the pot", () => {
    let t = table(6, {}, { ante: 0.25 });
    expect(legal(t, simulate(t, noLines(), 0))!.maxTo).toBe(5); // 1.5 + 1.5 of antes, 1 to call: 4, on the bet of 1
    t = table(6, {}, { straddle: true });
    expect(legal(t, simulate(t, noLines(), 0))).toMatchObject({ toAct: "HJ", toCall: 2, minTo: 4, maxTo: 7.5 }); // 3.5 + 2 = 5.5, to 7.5
  });

  it("takes another small blind", () => {
    const t = table(6, {}, { smallBlind: 1 });
    expect(legal(t, simulate(t, noLines(), 0))).toMatchObject({ toCall: 1, maxTo: 4 }); // 2 + 1 = 3, to 4
    expect(simulate(t, noLines(), 0).pot).toBe(2);
  });

  it("is capped by the stack", () => {
    const t = table(6, { UTG: 3 });
    expect(legal(t, simulate(t, noLines(), 0))).toMatchObject({ maxTo: 3, allInTo: 3 });
  });

  it("the TDA's pot-limit examples, Rule 56-B: 100-200 blinds, a short blind counted in full, first to act 700", () => {
    // the 2026 rules' second example, in big blinds: the small blind posts 0.5, the big blind is short with 0.5
    let t = table(6, { BB: 0.5 });
    let s = simulate(t, noLines(), 0);
    expect(s.pot).toBe(1); // the chips really there
    expect(legal(t, s)!.maxTo).toBe(3.5); // 700 at 100-200
    // short small blind: the same 3.5, where the chips alone would give 3.1
    t = table(6, { SB: 0.1 });
    s = simulate(t, noLines(), 0);
    expect(s.pot).toBeCloseTo(1.1, 9);
    expect(legal(t, s)!.maxTo).toBe(3.5);
    // it holds for the re-pot too, and stops at the flop (Rule 56-C: the actual pot)
    t = table(3, { BB: 0.5 });
    s = simulate(t, line({ preflop: "BTN r3.5" }), 0);
    expect(legal(t, s)).toMatchObject({ toAct: "SB", maxTo: 11.5 }); // counted 5, 3 to call: 8, on 3.5
    s = simulate(t, line({ preflop: "BTN r3.5, SB c" }), 3);
    expect(s.pot).toBe(7.5);
    expect(legal(t, s)!.maxTo).toBe(7.5);
  });

  it("refuses more than the limit, or cuts it to the limit for an opponent", () => {
    const t = table(6);
    const s = simulate(t, noLines(), 0);
    expect(recordOf(t, s, { action: "raise", to: 4 })).toBe("Pot limit: the largest raise is to 3.5bb.");
    expect(recordOf(t, s, { action: "raise", to: 4, clamp: true })).toEqual({ pos: "UTG", action: "raise", to: 3.5 });
    expect(recordOf(t, s, { action: "raise", to: 3.5 })).toEqual({ pos: "UTG", action: "raise", to: 3.5 });
    expect(recordOf(t, s, { action: "raise", to: 2.73 })).toEqual({ pos: "UTG", action: "raise", to: 2.73 }); // no half-blind rounding
    expect(recordOf(t, s, { action: "all-in" })).toBe("Pot limit: the largest raise is to 3.5bb.");
    expect(recordOf(t, s, { action: "all-in", clamp: true })).toEqual({ pos: "UTG", action: "raise", to: 3.5 });
    const f = simulate(t, line({ preflop: "UTG r3, HJ f, CO f, BTN f, SB f, BB c" }), 3);
    expect(recordOf(t, f, { action: "bet", to: 7 })).toBe("Pot limit: the largest bet is to 6.5bb.");
  });

  it("lets an all-in stand when the stack fits the limit", () => {
    const t = table(6, { UTG: 3 });
    expect(recordOf(t, simulate(t, noLines(), 0), { action: "all-in" })).toEqual({ pos: "UTG", action: "all-in" });
  });

  it("holds a line that breaks the limit to it on replay", () => {
    const t = table(6);
    const s = simulate(t, { ...noLines(), preflop: [{ pos: "UTG", action: "all-in" }] }, 0);
    expect(s.cur!.bets.UTG).toBe(3.5);
    expect(s.allin.has("UTG")).toBe(false);
  });

  it("no-limit's largest raise stays the stack", () => {
    const t: TableSetup = { players: 6, stacks: table(6).stacks };
    const s = simulate(t, noLines(), 0);
    expect(maxRaiseTo(t, s)).toBe(100);
    expect(legal(t, s)).not.toHaveProperty("maxTo");
  });
});

describe("the smallest raise and the incomplete all-in", () => {
  it("is by the last full raise, over the highest bet", () => {
    const t = table(6);
    expect(legal(t, simulate(t, line({ preflop: "UTG r3" }), 0))).toMatchObject({ minTo: 5 });
  });

  it("an all-in short of a full raise lifts the bet, leaves the minimum, and doesn't reopen for seats that acted", () => {
    const pf = { preflop: "BTN c, SB c, BB x" };
    const short = table(3, { BB: 4 });
    let s = simulate(short, line({ ...pf, flop: "SB b2, BB a" }), 3); // 3 left: 1 over a bet of 2, short of 2
    expect(s.cur!.curBet).toBe(3);
    expect(s.cur!.minRaise).toBe(2);
    expect(legal(short, s)).toMatchObject({ toAct: "BTN", toCall: 3, canRaise: true, minTo: 5 });
    s = simulate(short, line({ ...pf, flop: "SB b2, BB a, BTN c" }), 3);
    expect(legal(short, s)).toMatchObject({ toAct: "SB", toCall: 1, canRaise: false });
    expect(recordOf(short, s, { action: "raise", to: 6 })).toMatch(/can't raise/);
    expect(recordOf(short, s, { action: "raise", to: 6, clamp: true })).toEqual({ pos: "SB", action: "call" });
  });

  it("short all-ins that add up to a full raise do reopen, and the minimum stays the last full raise (TDA Rule 49-A)", () => {
    const pf = { preflop: "CO c, BTN c, SB c, BB x" }; // 1 each, then CO bets 2 and BTN calls
    const u = table(4, { SB: 3.5, BB: 4 }); // SB has 2.5, BB 3 left on the flop
    let s = simulate(u, line({ ...pf, flop: "SB x, BB x, CO b2, BTN c, SB a" }), 3); // 2.5: short
    expect(s.cur!.curBet).toBe(2.5);
    s = simulate(u, line({ ...pf, flop: "SB x, BB x, CO b2, BTN c, SB a, BB a" }), 3); // 3: short again, 1 over in all
    expect(s.cur!.curBet).toBe(3);
    expect(legal(u, s)).toMatchObject({ toAct: "CO", toCall: 1, canRaise: false }); // 1 is not 2: closed
    const v = table(4, { SB: 3.5, BB: 5 }); // BB has 4: CO now faces 2 more, a full raise by two short ones
    s = simulate(v, line({ ...pf, flop: "SB x, BB x, CO b2, BTN c, SB a, BB a" }), 3);
    expect(s.cur!.curBet).toBe(4);
    expect(legal(v, s)).toMatchObject({ toAct: "CO", toCall: 2, canRaise: true, minTo: 6 });
  });

  it("all-in under a call raises nothing", () => {
    const t = table(3, { SB: 2 });
    const s = simulate(t, line({ preflop: "BTN r3, SB a" }), 0);
    expect(s.cur!.curBet).toBe(3);
    expect(legal(t, s)).toMatchObject({ toAct: "BB", toCall: 2, canRaise: true });
  });
});

describe("side pots", () => {
  it("layers three all-ins of different sizes, with a folded seat's chips in the pots they reached", () => {
    const t = table(4, { CO: 10, BTN: 30, SB: 60 });
    const inv = { CO: 10, BTN: 30, SB: 60, BB: 60 };
    expect(sidePots(inv, ["CO", "BTN", "SB", "BB"], new Set(["CO", "BTN", "SB"]))).toEqual([
      { amount: 40, eligible: ["CO", "BTN", "SB", "BB"] },
      { amount: 60, eligible: ["BTN", "SB", "BB"] },
      { amount: 60, eligible: ["SB", "BB"] },
    ]);
    const hands = { CO: "AhAdKsKd", BTN: "QhQdJsJd", SB: "9h9d8s8d", BB: "7h7d6s6d" };
    const r = settleOmaha(t, inv, ["CO", "BTN", "SB", "BB"], new Set(["CO", "BTN", "SB"]), split("2c3c4h9cTs"), (p) => split(hands[p as keyof typeof hands]));
    // sets of nines beat all: the SB's set of 9s wins every pot it's in, and that's all three
    expect(r.pots.map((p) => p.winners)).toEqual([["SB"], ["SB"], ["SB"]]);
    expect(r.pays).toEqual({ SB: 160 });
    expect(r.val.SB![0]).toBe(3);
  });

  it("values hands by the two-and-three rule at showdown: a hold'em winner can lose", () => {
    const t = table(2);
    const s = simulate(t, line({ preflop: "SB r3, BB c", flop: "BB x, SB x", turn: "BB x, SB x", river: "BB x, SB x" }), 5);
    const board = split("AsKsQs2s7d");
    // one spade: no flush, whatever hold'em would say; two spades make one
    const hands = { SB: "Js2c3c4c", BB: "3s4s9d8d" };
    const r = settleOmaha(t, s.invested, [...s.active], s.allin, board, (p) => split(hands[p as keyof typeof hands]));
    expect(r.winners).toEqual(["BB"]);
    expect(r.pays).toEqual({ BB: 6 });
  });

  it("splits a tie, the odd cent to the first seat after the button", () => {
    const t: TableSetup = potLimit({ players: 3, stacks: { BTN: 100, SB: 100, BB: 100 } });
    const r = settleOmaha(t, { BTN: 1.01, SB: 0.5, BB: 1 }, ["BTN", "BB"], new Set(), split("AhKdQs2c3d"), (p) => split(p === "BTN" ? "JcTc4h5h" : "JdTd4c5c"));
    expect(r.pays).toEqual({ BB: 1.26, BTN: 1.25 });
  });
});

const split = (s: string) => s.match(/../g) ?? [];

describe("the independent reference (scripts/engine/plo_reference.py)", () => {
  it("agrees on every decision of 400 hands played out: the limits, who acts, each move's record, the pots and the pay", () => {
    expect(reference.hands.length).toBe(400);
    let decisions = 0;
    let sidePotted = 0;
    let shown = 0;
    let reopened = 0;
    for (const [n, h] of reference.hands.entries()) {
      const t: TableSetup = { players: h.players, stacks: h.stacks as Record<string, number>, ante: h.ante, smallBlind: h.smallBlind, straddle: h.straddle, limit: "pot" };
      let lines = noLines();
      let cards = 0;
      const sim = (): Sim => {
        for (;;) {
          const s = simulate(t, lines, cards);
          if (!s.waiting || s.toAct) return s;
          cards = { preflop: 0, flop: 3, turn: 4, river: 5 }[s.waiting];
        }
      };
      for (const [k, step] of h.steps.entries()) {
        const s = sim();
        const at = `hand ${n} step ${k}`;
        expect([at, s.current, s.toAct]).toEqual([at, step.street, step.pos]);
        const lg = legal(t, s)!;
        expect([at, lg.canRaise]).toEqual([at, step.canRaise]);
        for (const [got, want] of [
          [lg.toCall, step.toCall],
          [lg.minTo, step.minTo],
          [lg.maxTo!, step.maxTo],
          [lg.allInTo, step.allInTo],
          [s.pot, step.pot],
        ] as const)
          expect(Math.abs(got - want), `${at}: ${got} against ${want}`).toBeLessThan(1e-6);
        const move = step.move as Move;
        expect(recordOf(t, s, move)).toEqual(move);
        expect(lg.minTo).toBeLessThanOrEqual(lg.maxTo!);
        lines = withMove(lines, step.street as keyof Lines, move);
        decisions++;
        if (step.reopened) reopened++;
      }
      const s = sim();
      expect([`hand ${n}`, s.handOver]).toEqual([`hand ${n}`, true]);
      expect([...s.active].sort()).toEqual([...h.live].sort());
      for (const p of seatsOf(h.players)) expect(Math.abs(s.invested[p]! - h.invested[p as keyof typeof h.invested]!)).toBeLessThan(1e-6);
      const live = [...s.active];
      const r = settleOmaha(t, s.invested, live, s.allin, split(h.board), (p) => split(h.hands[p as keyof typeof h.hands]!));
      expect(r.pots.map((x) => ({ amount: x.amount, eligible: [...x.eligible].sort(), winners: [...x.winners] }))).toEqual(h.pots);
      expect(r.pays).toEqual(h.pays);
      expect(r.val).toEqual(h.values);
      if (h.pots.length > 1) sidePotted++;
      if (h.pots.length) shown++;
    }
    // the vectors reach what they're for
    expect(decisions).toBeGreaterThan(2000);
    expect(sidePotted).toBeGreaterThan(30);
    expect(shown).toBeGreaterThan(100);
    expect(reopened).toBeGreaterThan(0); // seats let back in by short all-ins that add up (TDA Rule 49-A)
  });
});

describe("random play", () => {
  it("every chip in is paid out, the limit is never broken, and the smallest raise never passes the largest", () => {
    const rnd = seeded(5);
    for (let n = 0; n < 3000; n++) {
      const players = 2 + (n % 8);
      const t = table(
        players,
        Object.fromEntries(seatsOf(players).map((p) => [p, Math.round((1 + rnd() * 150) * 100) / 100])),
        { ante: n % 3 === 0 ? 0.1 : 0, straddle: n % 5 === 0 },
      );
      const d = dealOmaha(players, rnd);
      let l = noLines();
      let shown = 0;
      for (let step = 0; step < 300; step++) {
        const s = simulate(t, l, shown);
        if (s.handOver) break;
        if (s.waiting) {
          shown = { flop: 3, turn: 4, river: 5, preflop: 0 }[s.waiting];
          continue;
        }
        const lg = legal(t, s)!;
        expect(lg.minTo).toBeLessThanOrEqual(lg.maxTo! + 1e-9);
        const x = rnd();
        const a =
          x < 0.15 && lg.toCall > 0
            ? { action: "fold" }
            : x < 0.5
              ? { action: "call" }
              : x < 0.7 && lg.canRaise
                ? { action: "raise", to: lg.maxTo!, clamp: true }
                : x < 0.85 && lg.canRaise
                  ? { action: "raise", to: lg.minTo + rnd() * 30, clamp: true }
                  : { action: "all-in", clamp: true };
        const m = recordOf(t, s, a);
        if (typeof m === "string") continue;
        if (m.to !== undefined) expect(m.to).toBeLessThanOrEqual(lg.maxTo! + 1e-9);
        l = withMove(l, s.current!, m);
      }
      const s = simulate(t, l, shown);
      expect(s.handOver).toBe(true);
      const live = [...s.active];
      const r = settleOmaha(t, s.invested, live, s.allin, d.board.slice(0, shown), (p) => d.hands[p]!);
      const inC = Math.round(Object.values(s.invested).reduce((x, y) => x + y, 0) * 100);
      expect(Math.round(Object.values(r.pays).reduce((x, y) => x + y, 0) * 100)).toBe(inC);
      for (const p of seatsOf(players)) expect(s.invested[p]!).toBeLessThanOrEqual(t.stacks[p]! + 1e-9);
    }
  });

  it("deals four cards a seat and five to the board, all different, the same again from a seed", () => {
    const a = dealOmaha(9, seeded(3));
    const all = [...Object.values(a.hands).flat(), ...a.board];
    expect(all).toHaveLength(41);
    expect(new Set(all).size).toBe(41);
    expect(dealOmaha(9, seeded(3))).toEqual(a);
  });
});
