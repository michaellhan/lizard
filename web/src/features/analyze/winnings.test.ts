/// <reference types="node" />
// Analyze's results tally on the classic fixtures (solver/tests/data/hh): cash and tournaments apart, the running
// total in the order played, the showdown split, by seat, money by currency, and the hands that can't say.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importHand } from "@/hh/replay";
import { PRACTICE_SITE } from "@/data/hands";
import { recordOf } from "./analyze";
import { CLASSIC_SITE } from "./classic";
import { handWin, signed, tallyWinnings, unitOf, winningsOf } from "./winnings";

const HH_DIR = join(process.cwd(), "..", "solver", "tests", "data", "hh");
const HH = (f: string) => readFileSync(join(HH_DIR, f), "utf8");
const IMP = { id: "imp1", name: "test.txt", at: 1000 };
const RECS = readdirSync(HH_DIR)
  .sort()
  .map((f) => recordOf(HH(f), importHand(HH(f)), IMP));

describe("results tally", () => {
  it("signs an amount as it's shown: nothing for what rounds to nothing, a loss's own for what rounds to a tenth", () => {
    expect([signed(0), signed(0.04), signed(-0.04), signed(0.05), signed(-0.05), signed(-1.25, 2), signed(0.004, 2)]).toEqual(["0.0", "0.0", "0.0", "+0.1", "−0.1", "−1.25", "0.00"]);
  });

  it("adds up cash games and tournaments apart, in the order played", () => {
    const w = tallyWinnings(RECS.map((h) => ({ h, w: handWin(h.text) })));
    // GG's EV Cashout, and its hand cut short with no winner line
    expect(w.left).toEqual([
      { why: "unread", n: 1 },
      { why: "cashout", n: 1 },
    ]);
    const c = w.cash!;
    expect(c.hands).toBe(14);
    expect(c.net).toBeCloseTo(-100.1, 6);
    expect(c.bb100).toBeCloseTo(-715, 6);
    // won at showdown and not adds up to the whole (no replay here stops short)
    expect(c.sd + c.nonSd).toBeCloseTo(c.net, 6);
    expect(c.sd).toBeCloseTo(-100.5, 6);
    // each hand's net in its own money: the dollar tables and iPoker's and Winamax's euro ones
    expect(c.money).toEqual([
      { unit: "$", net: -45.07 },
      { unit: "€", net: -400 },
    ]);
    expect(c.byPos.map((p) => p.pos)).toEqual(["UTG", "BTN", "SB", "BB"]);
    expect(c.byPos.reduce((a, p) => a + p.net, 0)).toBeCloseTo(c.net, 6);
    expect(c.byPos.reduce((a, p) => a + p.hands, 0)).toBe(14);
    // the running total by the history's clock: the three copies of the 2024-03-02 hand first, each +10.5bb
    expect(c.total.slice(0, 3)).toEqual([10.5, 21, 31.5]);
    expect(c.total.at(-1)).toBeCloseTo(c.net, 6);
    expect(c.atSd.at(-1)).toBeCloseTo(c.sd, 6);
    expect(c.noSd.at(-1)).toBeCloseTo(c.nonSd, 6);
    const at = new Map(RECS.map((h) => [h.id, h.playedAt]));
    expect(c.ids.map((id) => at.get(id)!)).toEqual([...c.ids.map((id) => at.get(id)!)].sort((a, b) => a - b));
    const [lo, hi] = c.range!;
    expect(lo).toBeLessThan(c.bb100);
    expect(hi).toBeGreaterThan(c.bb100);
    // the all-in EV: the six heads-up all-ins with cards to come at their equity (iPoker's hides the other hand)
    expect(c.allIns).toBe(6);
    const evs = RECS.filter((h) => !h.tournament).map((h) => handWin(h.text));
    expect(c.ev).toBeCloseTo(evs.reduce((a, x) => a + (x.allIn?.ev ?? x.net ?? 0), 0), 3);
    expect(c.evRun.at(-1)).toBeCloseTo(c.ev, 3);
    expect(Object.values(c.allIn).map((a) => a.street).sort()).toEqual(["flop", "flop", "preflop", "preflop", "turn", "turn"]);
    expect(w.tour!.allIns).toBe(2);
    // tournaments: chips, so no money
    const t = w.tour!;
    expect(t.hands).toBe(7);
    expect(t.net).toBeCloseTo(-24.2, 6);
    expect(t.money).toEqual([]);
    expect(t.byPos).toEqual([
      { pos: "CO", hands: 4, net: 50.8 },
      { pos: "BB", hands: 3, net: -75 },
    ]);
  });

  it("keeps the hands played at Practice's tables (and the classic app's) apart", () => {
    const h = RECS.find((x) => x.site === "PokerStars" && !x.tournament)!;
    const w = tallyWinnings([PRACTICE_SITE, CLASSIC_SITE, "PokerStars"].map((site, k) => ({ h: { ...h, id: `${k}`, site }, w: handWin(h.text) })));
    expect([w.cash?.hands, w.tour, w.practice?.hands]).toEqual([1, null, 2]);
  });

  it("reads a large set a chunk at a time, and stops on the signal", async () => {
    const seen: number[] = [];
    const w = await winningsOf(RECS, { chunk: 5, onProgress: (n) => seen.push(n) });
    expect(w!.cash!.hands + w!.tour!.hands).toBe(21);
    expect(await winningsOf(RECS, { chunk: 5 })).toEqual(w);
    const ac = new AbortController();
    ac.abort();
    const fresh = RECS.map((h) => ({ ...h, id: `${h.id}:2` }));
    expect(await winningsOf(fresh, { chunk: 5, signal: ac.signal })).toBeNull();
    expect(seen.length).toBeGreaterThan(0);
  });

  it("names a cash game's currency", () => {
    expect(["$0.50", "€2", "£1", "300 chips", "1"].map(unitOf)).toEqual(["$", "€", "£", "", ""]);
  });
});
