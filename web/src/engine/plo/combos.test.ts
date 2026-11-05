import { describe, expect, it } from "vitest";
import { choose } from "./cards";
import { ALL_SUIT_MAPS, canonicalise, classTable, handAt, handIndex, invertSuits, NUM_CLASSES, NUM_HANDS, orbit, relabel, sortHand, type Hand } from "./combos";
import reference from "./vectors/classes.json";

describe("the hands", () => {
  it("indexes all 270,725, each once, with handAt the inverse", () => {
    expect(NUM_HANDS).toBe(choose(52, 4));
    let i = 0;
    for (let d = 3; d < 52; d++)
      for (let c = 2; c < d; c++)
        for (let b = 1; b < c; b++)
          for (let a = 0; a < b; a++) {
            const h: Hand = [a, b, c, d];
            expect(handIndex(h)).toBe(i);
            expect(handAt(i)).toEqual(h);
            i++;
          }
    expect(i).toBe(NUM_HANDS);
    expect(() => handAt(NUM_HANDS)).toThrow();
  });
});

describe("the classes", () => {
  it("are computed: 16,432, matching the reference's count and its independent Burnside count", () => {
    const t = classTable();
    expect(t.canonical.length).toBe(16432);
    expect(NUM_CLASSES).toBe(16432);
    expect(reference.classes).toBe(16432);
    expect(reference.burnsideClasses).toBe(16432);
    expect(reference.hands).toBe(NUM_HANDS);
  });

  it("group the hands as the reference does: same class sizes, and the same smallest hand in every class", () => {
    const t = classTable();
    const least = new Int32Array(NUM_CLASSES).fill(-1);
    for (let i = 0; i < NUM_HANDS; i++) if (least[t.classOf[i]!] === -1) least[t.classOf[i]!] = i;
    const sizes: Record<string, number> = {};
    for (const s of t.size) sizes[s] = (sizes[s] ?? 0) + 1;
    expect(sizes).toEqual(reference.orbitSizes);
    const order = [...Array(NUM_CLASSES).keys()].sort((a, b) => least[a]! - least[b]!);
    let h = 0x811c9dc5;
    for (const c of order) {
      const text = `${least[c]!}:${t.size[c]!};`;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
    expect(h).toBe(reference.digest);
  });

  it("maps every one of the 270,725 hands to its canonical hand and back", () => {
    for (let i = 0; i < NUM_HANDS; i++) {
      const h = handAt(i);
      const { hand, map } = canonicalise(h);
      expect(relabel(h, map)).toEqual(hand);
      expect(relabel(hand, invertSuits(map))).toEqual(h);
      expect(canonicalise(hand).hand).toEqual(hand); // a canonical hand is its own
    }
  });

  it("are unchanged by any relabelling of the suits, and each orbit is exactly its class", () => {
    const t = classTable();
    let total = 0;
    for (let c = 0; c < NUM_CLASSES; c += 37) {
      const hand = handAt(t.canonical[c]!);
      const hands = orbit(hand);
      expect(hands.length).toBe(t.size[c]);
      for (const h of hands) expect(t.classOf[handIndex(h)]).toBe(c);
      for (const m of ALL_SUIT_MAPS) expect(canonicalise(relabel(hand, m)).hand).toEqual(hand);
    }
    for (const s of t.size) total += s;
    expect(total).toBe(NUM_HANDS);
  });

  it("knows quads in the hand is alone in its class, and a rainbow of four different ranks has 24", () => {
    const t = classTable();
    const quad = sortHand([48, 49, 50, 51]); // the four aces
    expect(t.size[t.classOf[handIndex(quad)]!]).toBe(1);
    expect(t.size[t.classOf[handIndex(sortHand([48, 45, 42, 39]))]!]).toBe(24); // As Kh Qd Jc
  });
});
