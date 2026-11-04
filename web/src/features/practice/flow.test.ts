// What a hand needs next (flow.ts): one place for a request and its key, and an opponent's move the table can't take.
import { describe, expect, it } from "vitest";
import type { Move } from "@/poker/table";
import type { PlayMove } from "@/solver/protocol";
import { adviceKey, moveKey, moveOf, needOf } from "./flow";
import { dealNext, finish, newHand, stateFor, withVillain, type PracticeHand } from "./practice";

const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const played = (h: PracticeHand, ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);

// the first hand of a session: you're on the button
const hand = () => newHand(6, 100, 0, 1);
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
