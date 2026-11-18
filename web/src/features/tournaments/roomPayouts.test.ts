import { describe, expect, it } from "vitest";
import { ROOM_CHOICES } from "./PayoutTools";
import { expandPlaces, postedBy, ROOM_PAYOUTS, ROOMS, roomMtt } from "./roomPayouts";
import { payoutProblems } from "./tournament";

describe("room payouts as posted", () => {
  it("every table adds up to 100% with its bands spelled out, as the pages' columns do", () => {
    for (const p of ROOM_PAYOUTS) {
      const sum = p.payouts.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 100), `${p.source.room} ${p.name}: ${sum}`).toBeLessThan(0.011);
      expect(payoutProblems(p.payouts), p.name).toEqual([]);
    }
  });

  it("every table names its room, page, address and the date it was read", () => {
    for (const p of ROOM_PAYOUTS) {
      expect(p.source.url).toMatch(/^https:\/\//);
      expect(p.source.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(postedBy(p)).toBe(`as posted by ${p.source.room} on ${p.source.read}`);
    }
    expect(ROOMS).toEqual(["WSOP Online", "BetMGM Poker", "PlayNow (BCLC)"]);
  });

  it("spells out bands", () => {
    expect(expandPlaces("1:50 2:30 3-4:10")).toEqual([50, 30, 10, 10]);
  });

  it("finds an MTT's table by its entrants, and none past the ranges kept", () => {
    const t = roomMtt("WSOP Online", 10, 180)!;
    expect(t.name).toBe("MTT, 151-200 entrants, top 10% paid");
    expect(t.payouts.length).toBe(20);
    expect(t.payouts.slice(0, 3)).toEqual([27, 16, 10]);
    expect(roomMtt("WSOP Online", 15, 1000)!.payouts.length).toBe(200);
    expect(roomMtt("WSOP Online", 20, 5000)).toBeNull();
    // (each share's ranges meet end to end from 2 entrants)
    for (const pct of [10, 15, 20]) {
      const rows = ROOM_PAYOUTS.filter((p) => p.name.endsWith(`top ${pct}% paid`));
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.entrants[0]).toBe(rows[i - 1]!.entrants[1] + 1);
      expect(rows[0]!.entrants[0]).toBe(2);
    }
  });

  it("offers each sit & go's table and the MTTs by share paid", () => {
    expect(ROOM_CHOICES.filter((c) => c.mtt).map((c) => c.label)).toEqual([
      "WSOP Online: MTT, top 10% paid, by entrants",
      "WSOP Online: MTT, top 15% paid, by entrants",
      "WSOP Online: MTT, top 20% paid, by entrants",
    ]);
    expect(ROOM_CHOICES.some((c) => c.label === "WSOP Online: Sit & go, 9 players (3 paid)")).toBe(true);
  });
});
