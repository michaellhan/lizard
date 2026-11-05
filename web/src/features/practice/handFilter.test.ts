// @vitest-environment node
// The drills' hand filter: the categories by Study's keys, the hand classes, what the board rules out.
import { describe, expect, it } from "vitest";
import { cardInt } from "@/library/entry";
import { flopHandTest, HAND_GROUPS, handLabel, handTest, isHandKey } from "./handFilter";

const c = (s: string) => cardInt(s);
const on = (key: string, board: string, a: string, b: string) => handTest(key, board.match(/../g)!.map(cardInt))(Math.min(c(a), c(b)), Math.max(c(a), c(b)));

describe("the hand filter", () => {
  it("lists Study's categories by key, and no key twice; the river's Plays the board and No draw aren't offered", () => {
    const keys = HAND_GROUPS.flatMap((g) => g.options.map((o) => o.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("m:top_tk");
    expect(keys).toContain("d:fd");
    expect(keys).toContain("c:sc");
    expect(keys).not.toContain("m:board");
    expect(keys).not.toContain("d:none");
    expect(handLabel("m:top_tk")).toBe("Top pair, top kicker");
    expect(isHandKey("d:combo")).toBe(true);
    expect(isHandKey("m:unknown")).toBe(false);
    expect(isHandKey(null)).toBe(false);
  });

  it("reads hand classes off the two cards, the ace on both ends", () => {
    expect(on("c:sc", "Ac4d3h", "9h", "8h")).toBe(true);
    expect(on("c:sc", "Ac4d3h", "Kh", "Ah")).toBe(true);
    expect(on("c:sc", "Ac4d3h", "2h", "Ah")).toBe(true);
    expect(on("c:sc", "Ac4d3h", "9h", "8d")).toBe(false);
    expect(on("c:sc", "Ac4d3h", "9h", "7h")).toBe(false);
    expect(on("c:sg", "Ac4d3h", "9h", "7h")).toBe(true);
    expect(on("c:sg", "Ac4d3h", "3s", "As")).toBe(true);
    expect(on("c:pairs", "Ac4d3h", "9h", "9d")).toBe(true);
    expect(on("c:sa", "Ac4d3h", "Ah", "7h")).toBe(true);
    expect(on("c:bw", "Ac4d3h", "Th", "Jd")).toBe(true);
    expect(on("c:bw", "Ac4d3h", "9h", "Jd")).toBe(false);
    expect(on("c:bw", "Ac4d3h", "Th", "Td")).toBe(false);
  });

  it("reads categories on the board it's given, a turn card included", () => {
    expect(on("m:top_tk", "Kc7d2h", "Ks", "Ad")).toBe(true);
    expect(on("d:fd", "Kc7c2h", "Ac", "5c")).toBe(true);
    expect(on("m:flush", "Kc7c2h9c", "Ac", "5c")).toBe(true);
    expect(on("m:flush", "Kc7c2h", "Ac", "5c")).toBe(false);
    expect(on("d:fd", "Kc7c2h9c", "Ac", "5c")).toBe(false);
    expect(flopHandTest("m:set", "Ac4d3h")(c("3c"), c("3d"))).toBe(true);
  });

  it("what the board can't hold, it says at once, as the hands would", () => {
    expect(on("m:flush", "Kc7d2h", "Ac", "5c")).toBe(false);
    expect(on("d:fd", "Kc7d2h", "Ac", "5c")).toBe(false);
    expect(on("m:full_house", "Kc7d2h", "Kd", "Ks")).toBe(false);
    expect(on("m:trips", "Kc7d7h", "As", "7s")).toBe(true);
    expect(on("m:full_house", "Kc7d7h", "Kd", "7s")).toBe(true);
    expect(on("m:quads", "Kc7d7h", "7c", "7s")).toBe(true);
  });
});
