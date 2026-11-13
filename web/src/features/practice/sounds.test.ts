import { describe, expect, it } from "vitest";
import { noLines } from "@/poker/table";
import type { Decision, PracticeHand } from "./practice";
import { playSound, soundsBetween } from "./sounds";

const base = (): PracticeHand => ({ seed: 1, n: 0, players: 2, stack: 100, hero: "BB", hands: {}, board: ["As", "Kd", "7c", "2h", "3s"], shown: 0, lines: noLines(), decisions: [], result: null });
const decided = (verdict: string): Decision => ({ street: "preflop", chose: "call", move: { pos: "BB", action: "call" }, grade: { verdict } as Decision["grade"], mix: [], pot: 3, provenance: null, study: "" }) as unknown as Decision;

describe("soundsBetween", () => {
  it("deals a new hand", () => {
    expect(soundsBetween(base(), { ...base(), n: 1, seed: 2 })).toEqual(["deal"]);
  });
  it("sounds the last move by its kind", () => {
    const h = base();
    const raise = { ...h, lines: { ...noLines(), preflop: [{ pos: "SB", action: "raise" as const, to: 2.5 }] } };
    expect(soundsBetween(h, raise)).toEqual(["bet"]);
    const fold = { ...raise, lines: { ...raise.lines, preflop: [...raise.lines.preflop, { pos: "BB", action: "fold" as const }] } };
    expect(soundsBetween(raise, fold)).toEqual(["fold"]);
  });
  it("turns a card and chimes a decision by its grade", () => {
    const h = base();
    expect(soundsBetween(h, { ...h, shown: 3 })).toEqual(["card"]);
    expect(soundsBetween(h, { ...h, decisions: [decided("Best")] })).toEqual(["good"]);
    expect(soundsBetween(h, { ...h, decisions: [decided("Blunder")] })).toEqual(["bad"]);
    expect(soundsBetween(h, { ...h, decisions: [decided("Inaccuracy")] })).toEqual([]);
  });
  it("plays a win only for chips won", () => {
    const h = base();
    const res = { net: 4, folded: false, winners: ["BB"], says: "", pays: {} };
    expect(soundsBetween(h, { ...h, result: res })).toEqual(["win"]);
    expect(soundsBetween(h, { ...h, result: { ...res, net: -4 } })).toEqual([]);
  });
  it("is silent without Web Audio", () => {
    expect(() => playSound("bet")).not.toThrow();
  });
});
