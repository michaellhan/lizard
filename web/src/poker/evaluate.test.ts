import { describe, expect, it } from "vitest";
import { cmp, handName, rank7 } from "./evaluate";

// cases of solver/tests/js/practice.test.js ("hand strength") and table.test.js ("hand names")
const r = (s: string) => rank7(s.split(" "));
const name = (a: string, b?: string) => handName(r(a), b ? r(b) : undefined);

describe("rank7", () => {
  it("categories and kickers", () => {
    expect(r("Ah Kh Qh Jh Th 2c 3d")).toEqual([8, 14]);
    expect(r("5s 4d 3c 2h Ah Kd Kc")).toEqual([4, 5]); // the wheel beats a pair
    expect(r("Ks Kd Kc 7h 7d 7c 2s")).toEqual([6, 13, 7]);
    expect(r("2h 3h 9h Jh Kh Ks Kd")).toEqual([5, 13, 11, 9, 3, 2]);
    expect(r("As Ad Ks Kd Qs Qd 2c")).toEqual([2, 14, 13, 12]);
    expect(r("9s 9d 5c 7h Jd Kc 2s")).toEqual([1, 9, 13, 11, 7]);
    expect(r("Ah Ad Ac As 2h 3h 4h")).toEqual([7, 14, 4]);
  });

  it("compares left to right", () => {
    expect(cmp(r("As Ad Kc 7h Jd 4c 2s"), r("Ah Ac Qc 7h Jd 4c 2s"))).toBeGreaterThan(0);
    expect(cmp(r("Ah Kd Qs Jc Th 2c 3c"), r("Ah Kd Qs Jc Th 4d 5d"))).toBe(0);
  });
});

describe("handName", () => {
  it("names categories, and the kicker when two hands share a name", () => {
    expect(name("Ah Kh Qh Jh Th 2c 3d")).toBe("royal flush");
    expect(name("9h 8h 7h 6h 5h 2c 3d")).toBe("9-high straight flush");
    expect(name("Ks Kd Kc 7h 7d 7c 2s")).toBe("full house, kings full of sevens");
    expect(name("5s 4d 3c 2h Ah Kd Kc")).toBe("5-high straight");
    expect(name("Ts 9d 8c 7h 6h Kd 2c")).toBe("10-high straight");
    expect(name("9s 9d 9c 7h Jd Kc 2s")).toBe("three nines");
    expect(name("As Ad Ac Ah 2h 3h 4h")).toBe("four aces");
    expect(name("As Ad Kc 7h Jd 4c 2s", "Ah Ac Qc 7h Jd 4c 2s")).toBe("pair of aces, K kicker");
    expect(name("Ac 9d 7c 5h 3d 2c Ts")).toBe("A-high");
  });
});
