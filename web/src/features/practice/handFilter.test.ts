// @vitest-environment node
// The drills' hand filter: the categories by Study's keys, the hand classes, what the board rules out.
import { describe, expect, it } from "vitest";
import { cardInt } from "@/library/entry";
import { flopsLike } from "@/features/practice/texture";
import { seeded } from "@/poker/table";
import { drawFit, flopHandTest, HAND_DRAWS, HAND_GROUPS, handFits, handLabel, handTest, isHandKey } from "./handFilter";

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

  it("takes only a key it offers, whatever it's handed", () => {
    for (const x of [undefined, null, 5, {}, ["m:set"], "", "m:board", "d:none", "c:constructor", "__proto__"]) expect(isHandKey(x)).toBe(false);
  });

  it("says what each group is read on", () => {
    expect(HAND_GROUPS.map((g) => [g.label, g.on])).toEqual([
      ["Made hands", "flop"],
      ["Draws", "flop"],
      ["Hand classes", "cards"],
    ]);
  });
});

describe("drawing to a filter", () => {
  const keys = HAND_GROUPS.flatMap((g) => g.options.map((o) => o.key));
  const fit = (key: string, seed: number, flops?: readonly string[]) => drawFit(key, seeded(seed), flops);
  const fitsIt = (key: string, f: NonNullable<ReturnType<typeof drawFit>>) => {
    const [a, b] = f.hole.map(c);
    return handTest(key, f.flop.map(c))(Math.min(a!, b!), Math.max(a!, b!));
  };

  it("finds every key offered, on the flop it gives, five cards from one deck", () => {
    for (const key of keys)
      for (let seed = 1; seed <= 8; seed++) {
        const f = fit(key, seed)!;
        expect(fitsIt(key, f)).toBe(true);
        expect(new Set([...f.flop, ...f.hole]).size).toBe(5);
      }
  });

  it("stays on the flops it's given", () => {
    const flops = flopsLike({ pair: "paired" });
    for (let seed = 1; seed <= 20; seed++) {
      const f = fit("m:trips", seed, flops)!;
      expect(flops).toContain(f.flop.join(""));
    }
  });

  it("gives up after its draws where nothing fits", () => {
    let draws = 0;
    expect(
      drawFit(
        "m:flush",
        () => {
          draws += 1;
          return Math.random();
        },
        flopsLike({ suits: "rainbow" }),
      ),
    ).toBeNull();
    // (each draw takes a flop and two cards, and a card that clashes is drawn again)
    expect(draws).toBeGreaterThanOrEqual(HAND_DRAWS * 3);
    expect(draws).toBeLessThan(HAND_DRAWS * 4);
  });

  it("deals what fits as evenly as any deal would", () => {
    // Pocket pairs: thirteen ranks, each as often. Sets: a set of any rank as often, a pair of rank r only on a flop with an r.
    const ranks = new Map<string, number>();
    const N = 13000;
    for (let seed = 1; seed <= N; seed++) {
      const r = fit("c:pairs", seed)!.hole[0][0]!;
      ranks.set(r, (ranks.get(r) ?? 0) + 1);
    }
    expect(ranks.size).toBe(13);
    for (const n of ranks.values()) expect(Math.abs(n - N / 13)).toBeLessThan(4 * Math.sqrt(N / 13));
    // (given a flop, each of the cards left is as likely: 2 of the 3 flop ranks aren't favoured over the third)
    const places = [0, 0, 0];
    for (let seed = 1; seed <= 3000; seed++) {
      const f = fit("m:set", seed)!;
      places[f.flop.findIndex((x) => x[0] === f.hole[0][0])]! += 1;
    }
    for (const n of places) expect(Math.abs(n - 1000)).toBeLessThan(4 * Math.sqrt(1000));
  });

  it("gives the same draw from the same seed", () => {
    expect(fit("d:fd", 42)).toEqual(fit("d:fd", 42));
  });
});

describe("whether a filter can be met", () => {
  it("is never in doubt with no flop filter, a key it doesn't offer never fits", () => {
    expect(handFits("m:quads")).toBe(true);
    expect(handFits("m:quads", {})).toBe(true);
    expect(handFits("m:unknown")).toBe(false);
  });

  it("says no to what the flops can't hold, and yes to what they can", () => {
    expect(handFits("m:flush", { suits: "rainbow" })).toBe(false);
    expect(handFits("d:fd", { suits: "rainbow" })).toBe(false);
    expect(handFits("m:straight", { conn: "dry" })).toBe(false);
    expect(handFits("m:top_tk", { pair: "trips" })).toBe(false);
    expect(handFits("m:flush", { suits: "mono" })).toBe(true);
    expect(handFits("c:pairs", { suits: "rainbow" })).toBe(true);
    expect(handFits("m:set", { pair: "trips", suits: "mono" })).toBe(false);
  });
});
