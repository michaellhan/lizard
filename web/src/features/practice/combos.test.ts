import { describe, expect, it } from "vitest";
import { seeded } from "@/poker/table";
import { byRanks, CATEGORIES, categoryOf, classesOf, countCombos, dayOf, emptyStats, makeQuestion, optionsFor, ranked, rangeCombos, readStats, record, SAMPLE_RANGES, tally } from "./combos";

const v = (ranks: string) => [...ranks].map((r) => "23456789TJQKA".indexOf(r) + 2);

describe("hand categories", () => {
  it("name made hands by the hole cards' part, on paired flops too", () => {
    expect(byRanks(v("AK"), v("5AJ"))).toBe("toppair");
    expect(byRanks(v("KJ"), v("5AJ"))).toBe("otherpair");
    expect(byRanks(v("AJ"), v("5AJ"))).toBe("twopair");
    expect(byRanks(v("AA"), v("5AJ"))).toBe("trips");
    expect(byRanks(v("KK"), v("5AJ"))).toBe("pocket");
    expect(byRanks(v("KK"), v("5QJ"))).toBe("overpair");
    expect(byRanks(v("KQ"), v("5AJ"))).toBe("nopair");
    // a paired flop: 5-5-J
    expect(byRanks(v("J9"), v("55J"))).toBe("toppair");
    expect(byRanks(v("98"), v("55J"))).toBe("nopair");
    expect(byRanks(v("99"), v("55J"))).toBe("pocket");
    expect(byRanks(v("A5"), v("55J"))).toBe("trips");
    expect(byRanks(v("J5"), v("55J"))).toBe("fh");
    expect(byRanks(v("JJ"), v("55J"))).toBe("fh");
    expect(byRanks(v("55"), v("55J"))).toBe("quads");
    expect(byRanks(v("43"), v("5A2"))).toBe("straight");
    expect(byRanks(v("KQ"), v("JTA"))).toBe("straight");
  });

  it("read flushes and straight flushes off the suits, a full house above a flush", () => {
    expect(categoryOf(["Ah", "Kh"], ["2h", "7h", "9h"])).toBe("flush");
    expect(categoryOf(["9h", "8h"], ["7h", "6h", "5h"])).toBe("sf");
    expect(categoryOf(["Th", "9h"], ["8h", "7h", "6c"])).toBe("straight");
    expect(categoryOf(["Ah", "Kh"], ["2h", "7h", "9c"])).toBe("nopair");
  });
});

describe("counting a range", () => {
  // A worked example: AsKc on 5c Ad Jh against a 156-combo range. Every count was checked by hand: AJ has 2 live aces
  // by 3 live jacks (6) and A5s one suit (clubs) with both cards live; KJs two suits (not the K's clubs, not the J's hearts).
  const range = "AA-99,AKs-A8s,A6s-A5s,KQs-K9s,QJs-Q9s,JTs-J9s,T9s,AKo-AJo,KQo";
  const counted = countCombos(rangeCombos(range)!, ["As", "Kc"], ["5c", "Ad", "Jh"]);
  const t = tally(counted);

  it("has 156 combos, and each lands in one state and one category", () => {
    expect(counted).toHaveLength(156);
    const sum = (["live", "hand", "board"] as const).reduce((s, st) => s + CATEGORIES.reduce((x, c) => x + t[st][c.id], 0), 0);
    expect(sum).toBe(156);
  });

  it("counts the live combos by category", () => {
    expect(t.live).toMatchObject({ trips: 4, twopair: 7, toppair: 22, otherpair: 11, pocket: 21, nopair: 30, overpair: 0, flush: 0, straight: 0 });
  });

  it("counts what can't be dealt, by your hand or the flop, by ranks", () => {
    const blocked = Object.fromEntries(CATEGORIES.map((c) => [c.id, t.hand[c.id] + t.board[c.id]]));
    expect(blocked).toMatchObject({ trips: 8, twopair: 13, toppair: 26, otherpair: 5, pocket: 3, nopair: 6 });
    // KK's three blocked combos are all your Kc's. Of AA's five, the three with the Ad are dead on the flop and AsAh,
    // AsAc are your As's; JJ's three are the Jh's
    expect(t.hand.pocket).toBe(3);
    expect(t.hand.trips).toBe(2);
    expect(t.board.trips).toBe(6);
  });

  it("says which classes make a count", () => {
    expect(classesOf(counted, "live", "twopair").map((c) => [c.cls, c.n])).toEqual([
      ["AJo", 5],
      ["AJs", 1],
      ["A5s", 1],
    ]);
  });

  it("weights a class or a single combo, and refuses text that isn't a range", () => {
    const r = rangeCombos("AKs:0.5,AhKh")!;
    expect(r.map((c) => [c.combo, c.w])).toEqual([
      ["AsKs", 0.5],
      ["AhKh", 1],
      ["AdKd", 0.5],
      ["AcKc", 0.5],
    ]);
    expect(rangeCombos("AKs, nonsense")).toBeNull();
    const w = tally(countCombos(r, ["2c", "3d"], ["Ks", "8h", "4d"]));
    expect(w.live.toppair).toBe(2);
    expect(w.board.toppair).toBe(0.5);
  });
});

describe("questions", () => {
  it("ask a count the tally has, among four distinct choices low to high", () => {
    const rand = seeded(7);
    for (let i = 0; i < 300; i++) {
      const q = makeQuestion(SAMPLE_RANGES[i % SAMPLE_RANGES.length]!, rand)!;
      expect(q.answer).toBe(q.tally[q.bucket][q.cat]);
      expect(q.answer).toBeGreaterThan(0);
      expect(q.options).toContain(q.answer);
      expect(new Set(q.options).size).toBe(4);
      expect([...q.options].sort((a, b) => a - b)).toEqual(q.options);
      expect(q.options.every((o) => o >= 0)).toBe(true);
      expect(new Set([...q.hero, ...q.flop]).size).toBe(5);
      expect(q.flop.every((c) => c[0] === q.flop[0][0])).toBe(false);
    }
  });

  it("offer the count a slip gives (your blockers forgotten) as a choice", () => {
    expect(optionsFor(7, [10, 23], seeded(1))).toContain(10);
    expect(optionsFor(0, [0, 3], seeded(1))).toEqual(expect.arrayContaining([0, 3]));
  });

  it("are none on a range with nothing in it", () => {
    expect(makeQuestion({ key: "typed", name: "x", text: "", source: "" })).toBeNull();
    expect(makeQuestion({ key: "typed", name: "x", text: "AK, zz", source: "" })).toBeNull();
  });
});

describe("the record", () => {
  it("keeps marks by category, a streak an assisted answer doesn't break, and 30 days", () => {
    let s = emptyStats();
    s = record(s, "live", "toppair", "correct", "2026-11-12");
    s = record(s, "live", "toppair", "assisted", "2026-11-13");
    s = record(s, "live", "toppair", "correct", "2026-11-13");
    expect(s.streak).toBe(2);
    s = record(s, "hand", "twopair", "wrong", "2026-11-13");
    expect(s).toMatchObject({ streak: 0, best: 2, total: { correct: 2, assisted: 1, wrong: 1 }, days: { "2026-11-12": 1, "2026-11-13": 3 } });
    expect(s.byCat["live:toppair"]).toEqual({ correct: 2, assisted: 1, wrong: 0 });
    expect(ranked(s).map((r) => r.key)).toEqual(["live:toppair"]);
    for (let d = 1; d <= 40; d++) s = record(s, "live", "nopair", "correct", `2026-10-${String(d).padStart(2, "0")}`);
    expect(Object.keys(s.days)).toHaveLength(30);
    expect(s.days["2026-11-13"]).toBe(3);
    expect(s.recent).toHaveLength(20);
  });

  it("reads what's kept, or starts afresh", () => {
    expect(readStats(undefined)).toEqual(emptyStats());
    expect(readStats({ v: 2 })).toEqual(emptyStats());
    expect(dayOf(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
