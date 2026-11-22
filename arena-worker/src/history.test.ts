// A hand's history from each seat, read back by Analyze's own importer (web/src/hh/replay.ts importHand, through
// the web page's review.ts): the same seats, stacks, cards and moves the table played, so "Review in Analyze" grades
// what happened. And only what that seat saw: the other seat's cards only where they were shown, the table's id never.
import { describe, expect, it } from "vitest";
import { importHand } from "../../web/src/hh/replay";
import { DECK, STREETS } from "../../web/src/poker/table";
import { act, deal, type Hand } from "./game";
import { ARENA_SITE, handHistory } from "./history";

const deckOf = (...top: string[]) => [...top, ...DECK.filter((c) => !top.includes(c))];
const NOW = Date.UTC(2026, 10, 22, 18, 30);
const TOP = ["As", "Ah", "Ks", "Kh", "2c", "7d", "9h", "Jc", "3s"];
const NAMES = ["Ann Lee", "bob_99"] as const;

function played(button: 0 | 1, moves: [0 | 1, string, number?][], stack = 100): Hand {
  const h = deal(7, button, stack, deckOf(...TOP), NOW);
  for (const [s, action, to] of moves) {
    const r = act(h, s, { action: action as "call", ...(to !== undefined ? { to } : {}) }, NOW);
    if (typeof r === "string") throw new Error(`${s} ${action}: ${r}`);
  }
  return h;
}

describe("a hand's history", () => {
  it("reads back in Analyze as the table played it, from either seat", () => {
    // seat 1 on the button this time
    const h = played(1, [
      [1, "raise", 2.5],
      [0, "raise", 9],
      [1, "call"],
      [0, "bet", 6],
      [1, "raise", 18],
      [0, "call"],
      [0, "check"],
      [1, "check"],
      [0, "bet", 30],
      [1, "fold"],
    ]);
    expect(h.result).not.toBeNull();
    for (const seat of [0, 1] as const) {
      const text = handHistory(h, seat, NAMES, 1793700000000);
      const r = importHand(text);
      expect(r.stopped).toBeNull();
      expect(r.hand.heroName).toBe(NAMES[seat]);
      expect(r.hand.hero).toBe(h.seatOf.SB === seat ? "SB" : "BB");
      expect(r.hand.hole).toEqual(h.hole[r.hand.hero as "SB" | "BB"]);
      expect(r.hand.stacks).toEqual({ SB: 100, BB: 100 });
      expect(r.hand.board).toEqual(h.board.slice(0, h.shown));
      for (const s of STREETS) expect(r.lines[s]).toEqual(h.lines[s]);
      // (the page keeps it under ARENA_SITE, as Practice keeps its own: web/src/features/arena/review.test.ts)
      expect(text.startsWith(`${ARENA_SITE} Hand #A1793700000000-7: Hold'em No Limit (0.5/1) - 2026/11/22 18:30:00`)).toBe(true);
    }
  });

  it("shows the other seat's cards only after a showdown", () => {
    const folded = played(0, [[0, "raise", 3], [1, "fold"]]);
    const t0 = handHistory(folded, 0, NAMES, 1);
    expect(t0).toContain("As Ah");
    expect(t0).not.toContain("Ks Kh");
    expect(t0).not.toContain("SHOW DOWN");
    expect(handHistory(folded, 1, NAMES, 1)).not.toContain("As Ah");

    const shown = played(0, [[0, "all-in"], [1, "call"]]);
    const t1 = handHistory(shown, 1, NAMES, 1);
    expect(t1).toContain("*** SHOW DOWN ***");
    expect(t1).toContain(`${NAMES[0]}: shows [As Ah]`);
    const r = importHand(t1);
    expect(r.stopped).toBeNull();
    expect(r.hand.board).toHaveLength(5);
    expect(t1).toContain(`${NAMES[0]} collected 200 from pot`);
  });

  it("never writes the table's id, and says it's play money", () => {
    const h = played(0, [[0, "call"], [1, "check"], [1, "check"], [0, "check"], [1, "check"], [0, "check"], [1, "check"], [0, "check"]]);
    const text = handHistory(h, 0, NAMES, 1793700000000);
    expect(text).not.toMatch(/[0-9a-f]{32}/);
    expect(text).toMatch(/Play money/);
    expect(importHand(text).stopped).toBeNull();
  });
});
