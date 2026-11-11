import { describe, expect, it } from "vitest";
import { isNextKey, KEY_HELP, optionFromKey } from "./keys";

describe("optionFromKey", () => {
  const pre = ["fold", "call", "raise 2.5", "raise 7", "all-in"];
  const flop = ["check", "bet 33%", "bet 75%"];

  it("takes 1–9 by place, and nothing past the last", () => {
    expect(optionFromKey("1", pre)).toBe(0);
    expect(optionFromKey("5", pre)).toBe(4);
    expect(optionFromKey("6", pre)).toBe(-1);
    expect(optionFromKey("0", pre)).toBe(-1);
  });

  it("takes F, C or X, A by what the option is, either case", () => {
    expect(optionFromKey("f", pre)).toBe(0);
    expect(optionFromKey("c", pre)).toBe(1);
    expect(optionFromKey("X", pre)).toBe(1);
    expect(optionFromKey("x", flop)).toBe(0);
    expect(optionFromKey("a", pre)).toBe(4);
    // (no fold to check behind, no all-in offered)
    expect(optionFromKey("f", flop)).toBe(-1);
    expect(optionFromKey("a", flop)).toBe(-1);
  });

  it("takes R or B as the smallest bet or raise, Shift with it the largest", () => {
    expect(optionFromKey("r", pre)).toBe(2);
    expect(optionFromKey("R", pre)).toBe(3);
    expect(optionFromKey("b", flop)).toBe(1);
    expect(optionFromKey("B", flop)).toBe(2);
    // (an all-in is the raise where it's the only one: push/fold)
    expect(optionFromKey("r", ["fold", "all-in"])).toBe(1);
    expect(optionFromKey("r", ["fold", "call"])).toBe(-1);
  });

  it("takes no other key", () => {
    for (const k of ["k", "s", "n", "Enter", " ", "?"]) expect(optionFromKey(k, pre)).toBe(-1);
  });
});

describe("the key list", () => {
  it("says Enter, Space and N are the next hand", () => {
    expect(["Enter", " ", "n", "N"].every(isNextKey)).toBe(true);
    expect(isNextKey("m")).toBe(false);
  });

  it("names each key once", () => {
    const keys = KEY_HELP.flatMap((g) => g.rows.flatMap((r) => r.keys)).filter((k) => k !== "–" && k !== "1" && k !== "9");
    expect(new Set(keys).size).toBe(keys.length);
  });
});
