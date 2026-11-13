import { describe, expect, it } from "vitest";
import { parseHandHistory } from "@/hh/parse";
import { PLO } from "@/features/plo/fromHistory.test.fixture";
import { spotsFromHistory, type HistoryRead } from "@/features/plo/fromHistory";
import { mineFromParams } from "@/features/plo/mine";
import { spotFromParams } from "@/features/plo/spot";
import { readOmaha, streetLine, streetRows } from "./omaha";
import { GG_PLO } from "./omaha.test.fixture";

const imp = { name: "test", at: 1 };
const rec = (t: string) => {
  const r = readOmaha(t, imp);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("Omaha hands in Analyze", () => {
  it("reads a PokerStars and a GGPoker PLO hand as PLO hands", () => {
    const stars = rec(PLO);
    expect(stars).toMatchObject({ site: parseHandHistory(PLO, { omaha: true }).site, number: "249012345679", hero: "BTN", hole: "AhQdJsTd", board: "Qs8d3c7h2s", players: 6 });
    const gg = rec(GG_PLO);
    expect(gg).toMatchObject({ number: "RC2049187654", hero: "BTN", hole: "KhQhJcTc", board: "9h8c2d3sJh" });
    expect(gg.site).toMatch(/gg/i);
    expect(gg.id).not.toBe(stars.id);
    // Hold'em's reader still refuses both
    expect(() => parseHandHistory(GG_PLO)).toThrow("Only Hold'em hands can be imported.");
    expect(readOmaha(PLO.replace("Omaha Pot Limit", "Omaha Hi/Lo Pot Limit"), imp)).toMatch(/Only four-card Omaha high/);
  });

  it("says each street you acted on: preflop ungraded, heads-up streets to solve, with the line as played", () => {
    const rows = streetRows(rec(GG_PLO));
    expect(rows.map((r) => [r.street, r.status])).toEqual([
      ["preflop", "ungraded"],
      ["flop", "solve"],
      ["turn", "solve"],
      ["river", "solve"],
    ]);
    expect(rows[0]!.why).toBe("PLO preflop isn't solved.");
    // the flop's link: the spot, the sizes played among the tree's, your cards, seat and the street's actions
    const q = new URLSearchParams(rows[1]!.link!.split("?")[1]);
    expect(q.get("game")).toBe("plo4");
    const spot = spotFromParams(q)!;
    // in big blinds ($0.50): the pot $3.75, $48.25 behind
    expect(spot).toMatchObject({ board: "9h8c2d", pot: "7.5", stacks: ["96.5", "96.5"] });
    // a bet of 5 into 7.5 is 66.7%; the raise to 22 over 5 is 17 of the pot after the call, 17.5: 97.1%
    expect(spot.sizes).toEqual({ bets: "66.7", raises: "97.1", cap: 1, allIn: true });
    expect(mineFromParams(q)).toEqual({ hand: "KhQhJcTc", seat: 1, act: ["x", "b5", "r22", "c"], from: "hand #RC2049187654, the flop", plo: rec(GG_PLO).id });
  });

  it("names a street three saw as ungraded, and why", () => {
    const three = PLO.replace("snowman_9: folds", "snowman_9: calls $2").replace(
      "*** FLOP *** [Qs 8d 3c]\nOldTAG: checks\nHeroName: bets $1.80\nOldTAG: calls $1.80",
      "*** FLOP *** [Qs 8d 3c]\nsnowman_9: checks\nOldTAG: checks\nHeroName: bets $1.80\nsnowman_9: folds\nOldTAG: calls $1.80",
    );
    const rows = streetRows(rec(three));
    expect(rows.find((r) => r.street === "flop")).toEqual({ street: "flop", status: "ungraded", why: "3 players saw the flop: the PLO solver plays heads-up." });
    expect(rows.find((r) => r.street === "turn")!.status).toBe("solve");
  });

  it("turns an all-in into its street total", () => {
    const read = spotsFromHistory(
      PLO.replace("HeroName: bets $6.10\nOldTAG: calls $6.10", "HeroName: bets $9.10\nOldTAG: raises $27.30 to $36.40\nHeroName: raises $59.30 to $95.70 and is all-in\nOldTAG: calls $59.30 and is all-in").replace(
        "OldTAG: checks\nHeroName: bets $14.50\nOldTAG: folds\nUncalled bet ($14.50) returned to HeroName\n",
        "",
      ),
    ) as HistoryRead;
    const turn = read.spots.find((s) => s.street === "turn")!;
    const line = streetLine(read.lines, turn);
    expect(line.act).toEqual(["x", "b9.1", "r36.4", "r95.7", "c"]);
    expect(line.bets).toEqual([100]);
    expect(line.raiseCount).toBe(2);
  });
});
