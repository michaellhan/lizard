// The dealer's randomness: a full deck every time, indexes drawn without bias, and the platform's CSPRNG behind it.
import { describe, expect, it, vi } from "vitest";
import { DECK } from "../../web/src/poker/table";
import { below, cryptoRandom, randomHex, sha256, shuffled, type Random } from "./rng";

describe("the dealer's randomness", () => {
  it("shuffles to a permutation of the 52 cards", () => {
    for (let i = 0; i < 50; i++) {
      const d = shuffled(cryptoRandom);
      expect(d).toHaveLength(52);
      expect(new Set(d)).toEqual(new Set(DECK));
    }
  });

  it("draws again above the largest multiple of n (no modulo bias)", () => {
    // n = 3: 2^32 % 3 = 1, so the one value 2^32 - 1 is above the limit and must be drawn again
    const vals = [0xffffffff, 7];
    let k = 0;
    const r: Random = (b) => {
      const x = vals[k++]!;
      b.set([(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
    };
    expect(below(3, r)).toBe(1);
    expect(k).toBe(2);
    expect(() => below(0, r)).toThrow();
  });

  it("uses crypto.getRandomValues, never Math.random", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    const math = vi.spyOn(Math, "random");
    shuffled(cryptoRandom);
    randomHex(cryptoRandom);
    expect(spy).toHaveBeenCalled();
    expect(math).not.toHaveBeenCalled();
    spy.mockRestore();
    math.mockRestore();
  });

  it("deals every card to the first place about as often (chi-square, 26,000 shuffles)", () => {
    const counts = new Map<string, number>();
    const N = 26_000;
    for (let i = 0; i < N; i++) {
      const c = shuffled(cryptoRandom)[0]!;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const e = N / 52;
    const chi = [...DECK].reduce((s, c) => s + ((counts.get(c) ?? 0) - e) ** 2 / e, 0);
    // 51 degrees of freedom: p = 1e-6 is at about 110
    expect(chi).toBeLessThan(110);
  });

  it("makes 128-bit ids and hashes tokens", async () => {
    const a = randomHex(cryptoRandom);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(cryptoRandom)).not.toBe(a);
    expect(await sha256("x")).toBe("2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");
  });
});
