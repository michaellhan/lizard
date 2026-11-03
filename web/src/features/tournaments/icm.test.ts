// The page's ICM against the engine's (solver/gto/icm.py Model: base / real_pool and bubble_factor, run on
// 2026-11-03 for these setups): the same numbers to 4 places, a field over 12 players stood in for, every player left
// paid giving no ratio, and the table built from a spot's setup as the engine builds its model.
import { describe, expect, it } from "vitest";
import { callNeed } from "./BubbleTable";
import { bubbleTable, bubbleTableOf, compressPayouts, equities, fieldStacks, icmModel } from "./icm";

const engine = {
  uneven4: {
    share: { CO: 0.315953, BTN: 0.177234, SB: 0.384474, BB: 0.122339 },
    bf: { CO: { BTN: 1.1577, SB: 3.4263, BB: 1.099 }, BTN: { CO: 2.1714, SB: 2.3861, BB: 1.1188 }, SB: { CO: 1.3253, BTN: 1.0777, BB: 1.0542 }, BB: { CO: 1.6647, BTN: 1.1452, SB: 1.7822 } },
  },
  field: { share: { BTN: 0.11666, SB: 0.053707, BB: 0.162388 }, bf: { BTN: { SB: 1.1478, BB: 1.6267 }, SB: { BTN: 1.2301, BB: 1.2669 }, BB: { BTN: 1.3752, SB: 1.1143 } } },
  bigfield: {
    share: { UTG: 0.02259, HJ: 0.03324, CO: 0.017097, BTN: 0.053104, SB: 0.011499, BB: 0.027972 },
    bf: { UTG: { HJ: 1.0785, CO: 1.0521, BTN: 1.0909, SB: 1.0332, BB: 1.0756 }, BTN: { UTG: 1.0649, HJ: 1.1067, CO: 1.0466, SB: 1.0297, BB: 1.0848 }, SB: { BB: 1.0382 } },
    payouts: [21.333333, 8.333333, 3.666667],
  },
  sat: { share: { BTN: 0.301987, SB: 0.243081, BB: 0.318853, CO: 0.136079 }, bf: { BTN: { SB: 1.8792, BB: 11.7504, CO: 1.2323 }, CO: { BTN: 1.7899, SB: 1.2717, BB: 1.9383 } } },
};

function expectLike(t: ReturnType<typeof bubbleTable>, e: { share: Record<string, number>; bf: Record<string, Record<string, number>> }) {
  for (const [p, x] of Object.entries(e.share)) expect(t.share[p]).toBeCloseTo(x, 5);
  for (const [h, row] of Object.entries(e.bf)) for (const [v, x] of Object.entries(row)) expect(t.bf[h]![v]).toBeCloseTo(x, 3);
}

describe("ICM in the page (gto/icm.py)", () => {
  it("splits equal stacks equally, a winner-takes-all by chips, and a bust's place to the busted", () => {
    expect(equities([20, 20, 20], [50, 30, 20]).map((x) => +x.toFixed(6))).toEqual([33.333333, 33.333333, 33.333333]);
    expect(equities([10, 30], [100])).toEqual([25, 75]);
    // (heads-up for 50/30/20 with a player out: the third prize is theirs)
    const e = equities([10, 30, 0], [50, 30, 20]);
    expect(e[2]).toBe(20);
    expect(e[0]! + e[1]!).toBeCloseTo(80, 9);
  });

  it("gives the engine's bubble factors: six 20bb stacks paying 50/30/20, and uneven stacks", () => {
    const six = bubbleTable(icmModel({ UTG: 20, HJ: 20, CO: 20, BTN: 20, SB: 20, BB: 20 }, [50, 30, 20]));
    expect(six.bf.UTG!.BB).toBeCloseTo(1.3889, 3);
    expect(six.share.SB).toBeCloseTo(1 / 6, 6);
    expectLike(bubbleTable(icmModel({ CO: 35, BTN: 12, SB: 60, BB: 8 }, [50, 30, 20])), engine.uneven4);
  });

  it("holds the other tables in the model, and stands in for a field over 12 players", () => {
    expectLike(bubbleTable(icmModel({ BTN: 25, SB: 10, BB: 40 }, [40, 25, 15, 10, 6, 4], Array<number>(5).fill(30))), engine.field);
    const m = icmModel({ UTG: 20, HJ: 30, CO: 15, BTN: 50, SB: 10, BB: 25 }, [30, 20, 14, 10.5, 8, 6.5, 5, 3.5, 2.5], Array<number>(30).fill(25));
    expect(m.approx).toBe(true);
    expect(m.players).toBe(36);
    m.payouts.forEach((x, i) => expect(x).toBeCloseTo(engine.bigfield.payouts[i]!, 5));
    const t = bubbleTable(m);
    expect(t.modelled).toBe(12);
    expectLike(t, engine.bigfield);
  });

  it("prices a satellite's bubble, and gives no ratio once every player left is paid", () => {
    expectLike(bubbleTable(icmModel({ BTN: 20, SB: 10, BB: 30, CO: 5 }, [1, 1, 1])), engine.sat);
    const all = bubbleTable(icmModel({ BTN: 20, SB: 10, BB: 30 }, [1, 1, 1, 1]));
    expect(all.bf.BTN).toEqual({ SB: null, BB: null });
    expect(all.share.BTN).toBeCloseTo(1 / 3, 6);
  });

  it("groups the field and spreads the payouts as the engine does", () => {
    expect(fieldStacks([10, 40, 20, 30], 2)).toEqual([35, 15]);
    expect(fieldStacks([10, 0, 20], 5)).toEqual([20, 10]);
    // 27 players paying 12, modelled by 12: each model place covers 2.25 real places
    const c = compressPayouts(Array<number>(12).fill(1), 27, 12);
    expect(c.length).toBe(6);
    expect(c[0]).toBeCloseTo(1, 9);
    expect(c[5]).toBeCloseTo(0.75 / 2.25, 9);
  });

  it("builds a spot's table as the engine builds its model", () => {
    const setup = { stacks: { BTN: 12, BB: 8 }, tournament: { payouts: [50, 30, 20] } };
    expectLike(bubbleTableOf(4, 35, { ...setup, stacks: { ...setup.stacks, SB: 60 } })!, engine.uneven4);
    expect(bubbleTableOf(3, 25, { stacks: { SB: 10, BB: 40 }, tournament: { payouts: [40, 25, 15, 10, 6, 4], field: { players: 5, avg: 30 } } })!.bf.BTN!.BB).toBeCloseTo(1.6267, 3);
    // winner-takes-all, bounties with no payouts, heads-up for two prizes (the difference is a winner-takes-all),
    // every player left paid the same, a stack not a number
    expect(bubbleTableOf(3, 20, { tournament: { payouts: [100] } })).toBeNull();
    expect(bubbleTableOf(3, 20, { tournament: { bounty: { format: "ko", each: 1 } } })).toBeNull();
    expect(bubbleTableOf(2, 20, { tournament: { payouts: [60, 40, 0] } })!.bf.SB!.BB).toBeCloseTo(1, 9);
    expect(bubbleTableOf(3, 20, { stacks: { BTN: 30 }, tournament: { payouts: [1, 1, 1, 1] } })!.bf.BTN!.BB).toBeNull();
    expect(bubbleTableOf(3, 20, { stacks: { BB: NaN }, tournament: { payouts: [50, 30, 20] } })).toBeNull();
  });
});

describe("the equity to call from a bubble factor", () => {
  it("is icm.py's call_need for an all-in with nothing else in the pot, its premium that less 50%", () => {
    // (gto/icm.py Model({UTG: 20, BB: 30, BTN: 25}, [50, 30, 20]): bubble_factor("BB", "UTG") 1.175824, call_need of
    // UTG's 20bb all-in 0.540404 against 0.5 in chips, premium 0.040404)
    expect(callNeed(1)).toBe(0.5);
    const bf = bubbleTable(icmModel({ UTG: 20, BB: 30, BTN: 25 }, [50, 30, 20])).bf.BB!.UTG!;
    expect(bf).toBeCloseTo(1.175824, 5);
    expect(callNeed(bf)).toBeCloseTo(0.540404, 5);
  });
});
