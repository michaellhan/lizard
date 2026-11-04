// What a hand needs next (flow.ts): one place for a request and its key, and an opponent's move the table can't take.
import { describe, expect, it } from "vitest";
import type { Move } from "@/poker/table";
import type { PlayMove } from "@/solver/protocol";
import type { SolveResult } from "@/solver/types";
import { chartKey } from "@/library/flops";
import { chartDraw, adviceKey, moveKey, moveOf, needOf, type Charts } from "./flow";
import { dealNext, finish, newHand, stateFor, withVillain, type PracticeHand } from "./practice";

const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const played = (h: PracticeHand, ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);

// the first hand of a session: you're on the button
const hand = () => newHand(6, 100, 0, 1);
/** Every starting hand a seat can hold (a chart's cells, by class). */
const RANKS = "AKQJT98765432";
const HANDS = [...RANKS].flatMap((a, i) => [...RANKS].map((b, j) => (i === j ? a + b : i < j ? `${a}${b}s` : `${b}${a}o`)));
const FOLDS = [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold")];

describe("needOf", () => {
  it("names the next step: an opponent's move, your spot, the cards, the end", () => {
    const start = hand();
    expect(needOf(start, "quick")).toMatchObject({ kind: "opp", street: "preflop", state: stateFor(start), play: { seat: "UTG", hole: start.hands.UTG!.join("") } });

    const yours = played(start, FOLDS);
    const you = needOf(yours, "quick");
    expect(you).toMatchObject({ kind: "you", street: "preflop", state: stateFor(yours) });
    expect(you).not.toHaveProperty("play");

    const called = played(yours, [mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")]);
    expect(needOf(called, "quick")).toEqual({ kind: "deal", street: "flop" });
    expect(needOf(dealNext(called, "flop"), "quick")).toMatchObject({ kind: "opp", street: "flop", play: { seat: "BB" } });

    const folded = played(yours, [mv("BTN", "fold")]);
    expect(needOf(folded, "quick")).toEqual({ kind: "over" });
  });

  it("plays your own preflop in a drill as a move at your seat", () => {
    const h = played(newHand(6, 100, 0, 1, { pot: "srp" }), FOLDS);
    expect(needOf(h, "quick")).toMatchObject({ kind: "opp", play: { seat: "BTN", hole: h.hands.BTN!.join("") } });
  });

  it("gives a key by the mode and the seat, not the hand's number or seed", () => {
    const yours = played(hand(), FOLDS);
    const key = (h: PracticeHand, mode: "quick" | "accurate" = "quick") => {
      const need = needOf(h, mode);
      return need.kind === "you" || need.kind === "opp" ? need.key : "";
    };
    expect(key(yours)).toBeTruthy();
    expect(key(yours, "accurate")).not.toBe(key(yours));
    expect(key(hand(), "accurate")).not.toBe(key(hand()));

    // the same spot from another seat
    const state = stateFor(hand());
    expect(adviceKey("quick", state)).not.toBe(adviceKey("quick", stateFor(hand(), "UTG")));
    expect(moveKey("quick", state, "UTG", "AhKd")).not.toBe(moveKey("quick", state, "HJ", "AhKd"));
    expect(moveKey("quick", state, "UTG", "AhKd")).not.toBe(moveKey("accurate", state, "UTG", "AhKd"));

    // the same request under another hand's number: one key
    expect(key({ ...yours, n: 5, seed: 99 })).toBe(key(yours));
  });

  it("waits for the index while Instant flops has no lines, before anything else", () => {
    const lib = newHand(6, 100, 0, 1, { pot: "lib" });
    expect(needOf(lib, "quick")).toEqual({ kind: "index" });
    expect(needOf(lib, "quick", undefined, new Map())).toEqual({ kind: "index" });
    expect(needOf({ ...lib, cands: [] }, "quick").kind).toBe("opp");
  });

  it("asks a node's chart once above one table, for a hand played for you, and its seats where it can't be drawn from", () => {
    const h = { ...newHand(6, 100, 0, 1, { pot: "srp" }) };
    const charts = new Map<string, null>();
    const state = stateFor(h);
    const ck = chartKey(state);
    const need = needOf(h, "quick", undefined, charts);
    expect(need).toEqual({ kind: "chart", key: `chart|${ck}`, ck, street: "preflop", state: { players: 6, stack: 100, board: "", preflop: [], flop: [], turn: [], river: [], study: true } });

    // (no hero and no hole: every hand at the node asks the same)
    expect(needOf(played(h, []), "accurate", undefined, charts)).toEqual(need);
    charts.set(ck, null);
    expect(needOf(h, "quick", undefined, charts)).toMatchObject({ kind: "opp", play: { seat: "UTG" } });
  });

  it("asks no chart at one table, in another game, or for a hand of your own", () => {
    const none = new Map<string, null>();
    const pot = (o: object = {}, stack = 100) => newHand(6, stack, 0, 1, { pot: "srp", ...o });
    expect(needOf(pot(), "quick").kind).toBe("opp");
    expect(needOf(pot({ ante: 0.1 }), "quick", undefined, none).kind).toBe("opp");
    expect(needOf(pot({ sizes: { flop: [50] } }), "quick", undefined, none).kind).toBe("opp");
    expect(needOf(pot({}, 40), "quick", undefined, none).kind).toBe("opp");
    expect(needOf(hand(), "quick", undefined, none).kind).toBe("opp");
    expect(needOf(dealNext(played(hand(), [...FOLDS, mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")]), "flop"), "quick", undefined, none).kind).toBe("opp");
  });

  it("builds the key from the request it sends", () => {
    const start = hand();
    const opp = needOf(start, "accurate");
    if (opp.kind !== "opp") throw new Error("an opponent's move, first");
    expect(opp.key).toBe(moveKey("accurate", opp.state, opp.play!.seat, opp.play!.hole));
    const you = needOf(played(start, FOLDS), "accurate");
    if (you.kind !== "you") throw new Error("your spot, next");
    expect(you.key).toBe(adviceKey("accurate", you.state));
  });

  it("asks a run-out from the seat's own view, and a move during the hand from yours", () => {
    const line = [mv("UTG", "raise", 2.5), mv("HJ", "call"), mv("CO", "fold"), mv("BTN", "fold")];
    const during = needOf(played(hand(), line.slice(0, 3)), "quick");
    if (during.kind !== "you") throw new Error("your spot, facing the raise");
    expect(during.state).toMatchObject({ hero: "BTN" });

    const folded = played(hand(), line);
    const out = needOf({ ...folded, result: finish(folded), run: "played" }, "quick");
    if (out.kind !== "opp") throw new Error("the others play on");
    expect(out.play).toEqual({ seat: "SB", hole: folded.hands.SB!.join("") });
    expect(out.state).toEqual(stateFor(folded, "SB"));
    expect(out.state).toMatchObject({ hero: "SB", hole: folded.hands.SB!.join("") });
  });
});

describe("chartDraw", () => {
  const raise = { action: "raise 2.5", freq: 1, amount_bb: 2.5 };
  const chart = (actor: string): SolveResult => ({
    data: { study: "node", street: "preflop", actor, actions: [raise], grid: { actions: [raise.action], cells: Object.fromEntries(HANDS.map((c) => [c, { w: 1, f: [1] }])) } },
    provenance: { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0 },
  });
  const pot = newHand(6, 100, 0, 1, { pot: "srp" });
  const charts = (h: PracticeHand, actor: string): Charts => new Map([[chartKey(stateFor(h)), chart(actor)]]);

  it("draws the seat's move from its node's chart, for a hand played for you", () => {
    expect(chartDraw(pot, "UTG", charts(pot, "UTG"))).toMatchObject({ pos: "UTG", action: "raise", to: 2.5 });
  });

  it("draws nothing at one table, for a chart that can't be drawn from, at another node, or for a hand of your own", () => {
    expect(chartDraw(pot, "UTG")).toBeNull();
    expect(chartDraw(pot, "UTG", new Map([[chartKey(stateFor(pot)), null]]))).toBeNull();
    expect(chartDraw(pot, "UTG", new Map())).toBeNull();
    expect(chartDraw(hand(), "UTG", charts(hand(), "UTG"))).toBeNull();
    // (an ante's hand has the same node's key: the chart isn't its game's)
    const ante = newHand(6, 100, 0, 1, { pot: "srp", ante: 0.1 });
    expect(chartDraw(ante, "UTG", charts(ante, "UTG"))).toBeNull();
  });

  it("draws afresh at each node of a hand", () => {
    const mixed = (): SolveResult => {
      const c = chart("UTG");
      return { ...c, data: { ...c.data, actions: [{ action: "fold", freq: 0.5 }, raise], grid: { actions: ["fold", raise.action], cells: Object.fromEntries(HANDS.map((x) => [x, { w: 1, f: [0.5, 0.5] }])) } } };
    };
    const at = (seed: number, moves: number) => {
      const h = { ...pot, seed, lines: { ...pot.lines, preflop: FOLDS.slice(0, moves) } };
      const seat = ["UTG", "HJ"][moves]!;
      const c = mixed();
      c.data.actor = seat;
      return chartDraw(h, seat, new Map([[chartKey(stateFor(h)), c]]))!.action;
    };
    const seeds = Array.from({ length: 40 }, (_, i) => i);
    expect(seeds.filter((s) => at(s, 0) !== at(s, 1)).length).toBeGreaterThan(5);
  });

  it("draws the same move for the same hand at the same node, and goes by the seed", () => {
    const mixed = chart("UTG");
    const cells = mixed.data.grid!.cells;
    mixed.data = { ...mixed.data, actions: [{ action: "fold", freq: 0.5 }, raise], grid: { actions: ["fold", raise.action], cells: Object.fromEntries(Object.keys(cells).map((c) => [c, { w: 1, f: [0.5, 0.5] }])) } };
    const map = new Map([[chartKey(stateFor(pot)), mixed]]);
    const draw = (seed: number) => chartDraw({ ...pot, seed }, "UTG", map)!.action;
    const seeds = Array.from({ length: 40 }, (_, i) => i);
    expect(seeds.map(draw)).toEqual(seeds.map(draw));
    expect(new Set(seeds.map(draw)).size).toBe(2);
  });
});

describe("moveOf", () => {
  it("records a move the table takes, a size lifted to the minimum included, with nothing to report", () => {
    expect(moveOf(hand(), { action: "call" })).toEqual({ move: mv("UTG", "call"), fallback: null });
    expect(moveOf(hand(), { action: "raise", to: 1.5 })).toEqual({ move: mv("UTG", "raise", 2), fallback: null });
  });

  it("reports a move it can't take, and plays a check or call", () => {
    const facing = moveOf(hand(), { action: "check" });
    expect(facing.move).toEqual(mv("UTG", "call"));
    expect(facing.fallback).toMatch(/can't check/);

    // the flop, checked to: no bet to call
    const flop = dealNext(played(hand(), [...FOLDS, mv("BTN", "call"), mv("SB", "call"), mv("BB", "check")]), "flop");
    const none = moveOf(flop, { action: "bet" });
    expect(none.move).toEqual(mv("SB", "check"));
    expect(none.fallback).toBe("Enter an amount.");
  });

  it("reports a worker's {error}, which has no action at all", () => {
    const res = moveOf(hand(), { error: "no such node" } as unknown as PlayMove);
    expect(res.move).toEqual(mv("UTG", "call"));
    expect(res.fallback).toBeTruthy();
  });
});
