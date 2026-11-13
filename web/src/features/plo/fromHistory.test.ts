import { describe, expect, it } from "vitest";
import { parseHandHistory } from "@/hh/parse";
import { spotsFromHistory, type HistoryRead } from "./fromHistory";

import { PLO } from "./fromHistory.test.fixture";

const read = (t: string) => {
  const r = spotsFromHistory(t);
  if (typeof r === "string") throw new Error(r);
  return r as HistoryRead;
};

describe("a PLO hand you played, as spots to solve", () => {
  it("gives each street two players saw with chips behind, its board, pot and stacks as the hand had them", () => {
    const r = read(PLO);
    expect(r).toMatchObject({ heroPos: "BTN", hole: "AhQdJsTd" });
    expect(r.spots).toEqual([
      { street: "flop", board: "Qs8d3c", pot: 5.5, stacks: [97.5, 97.5], seats: ["BB", "BTN"], hero: 1 },
      { street: "turn", board: "Qs8d3c7h", pot: 9.1, stacks: [95.7, 95.7], seats: ["BB", "BTN"], hero: 1 },
      { street: "river", board: "Qs8d3c7h2s", pot: 21.3, stacks: [89.6, 89.6], seats: ["BB", "BTN"], hero: 1 },
    ]);
  });

  it("leaves out a street three players saw, and stops at an all-in", () => {
    const three = PLO.replace("snowman_9: folds", "snowman_9: calls $2").replace(
      "*** FLOP *** [Qs 8d 3c]\nOldTAG: checks\nHeroName: bets $1.80\nOldTAG: calls $1.80",
      "*** FLOP *** [Qs 8d 3c]\nsnowman_9: checks\nOldTAG: checks\nHeroName: bets $1.80\nsnowman_9: folds\nOldTAG: calls $1.80",
    );
    const r = read(three);
    expect(r.spots.map((s) => s.street)).toEqual(["turn", "river"]);
    expect(r.skipped).toEqual(["3 players saw the flop: the PLO solver plays heads-up."]);
    expect(r.spots[0]!.pot).toBeCloseTo(11.1, 9); // (the small blind's call is in it)

    // all-in on the turn (a pot bet, a pot raise, a re-raise all-in under the limit, a call): no river to solve
    const allIn = read(
      PLO.replace("HeroName: bets $6.10\nOldTAG: calls $6.10", "HeroName: bets $9.10\nOldTAG: raises $27.30 to $36.40\nHeroName: raises $59.30 to $95.70 and is all-in\nOldTAG: calls $59.30 and is all-in").replace(
        "OldTAG: checks\nHeroName: bets $14.50\nOldTAG: folds\nUncalled bet ($14.50) returned to HeroName\n",
        "",
      ),
    );
    expect(allIn.spots.map((s) => s.street)).toEqual(["flop", "turn"]);
    expect(allIn.skipped).toEqual(["The river came with a player all-in: nothing is left to decide."]);
  });

  it("refuses what isn't four-card Omaha high, in words, and Hold'em's reader still refuses Omaha", () => {
    expect(spotsFromHistory(PLO.replace("Omaha Pot Limit", "Hold'em No Limit").replace("[Ah Qd Js Td]", "[Ah Qd]"))).toMatch(/Not an Omaha hand/);
    expect(spotsFromHistory(PLO.replace("Omaha Pot Limit", "Omaha Hi/Lo Pot Limit"))).toMatch(/Only four-card Omaha high/);
    expect(spotsFromHistory(PLO.replace("Omaha Pot Limit", "5 Card Omaha Pot Limit"))).toMatch(/Only four-card Omaha high/);
    expect(spotsFromHistory(PLO.replace("[Ah Qd Js Td]", "[Ah Qd Js Td 9c]"))).toMatch(/Only four-card Omaha high/);
    expect(spotsFromHistory("hello")).toMatch(/Not an Omaha hand/);
    expect(() => parseHandHistory(PLO)).toThrow("Only Hold'em hands can be imported.");
  });
});
