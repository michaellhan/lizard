// "Review in Analyze": a history as the arena's server writes it (arena-worker/src/history.ts; this one is its output
// for a hand in its own tests) kept in Analyze through the hand-history importer, under the arena's site, once.
import { describe, expect, it } from "vitest";
import { getHand } from "@/data/hands";
import { importHand } from "@/hh/replay";
import { ARENA_SITE } from "./protocol";
import { analyzeLink, keepForReview } from "./review";

const PLAYED =
  "Lizard Arena Hand #A1793700000000-3: Hold'em No Limit (0.5/1) - 2026/11/22 18:30:00\nTable 'Lizard Arena' 2-max Seat #1 is the button\nSeat 1: Ann (100 in chips)\nSeat 2: Bob (100 in chips)\nAnn: posts small blind 0.5\nBob: posts big blind 1\n*** HOLE CARDS ***\nDealt to Ann [As Ah]\nDealt to Bob\nAnn: raises 1.5 to 2.5\nBob: calls 1.5\n*** FLOP *** [2c 7d 9h]\nBob: checks\nAnn: bets 2\nBob: folds\nUncalled bet (2) returned to Ann\nAnn collected 5 from pot\n*** SUMMARY ***\nTotal pot 5 | Rake 0\nBoard [2c 7d 9h]\nPlay money: a private practice game between two people.\n";
// Bob's side of a hand Ann folded on the button: he made no decision
const WALK =
  "Lizard Arena Hand #A1793700000000-4: Hold'em No Limit (0.5/1) - 2026/11/22 18:31:00\nTable 'Lizard Arena' 2-max Seat #1 is the button\nSeat 1: Ann (100 in chips)\nSeat 2: Bob (100 in chips)\nAnn: posts small blind 0.5\nBob: posts big blind 1\n*** HOLE CARDS ***\nDealt to Ann\nDealt to Bob [Ks Kh]\nAnn: folds\nUncalled bet (0.5) returned to Bob\nBob collected 1 from pot\n*** SUMMARY ***\nTotal pot 1 | Rake 0\nPlay money: a private practice game between two people.\n";

describe("Review in Analyze", () => {
  it("keeps the hand in Analyze under the arena's site, with your decisions to grade, and only once", async () => {
    const at = Date.UTC(2026, 10, 22, 19);
    const r = await keepForReview(PLAYED, at);
    expect(r).toEqual({ id: `${ARENA_SITE}|A1793700000000-3|AsAh`, had: false });
    const kept = await getHand(`${ARENA_SITE}|A1793700000000-3|AsAh`);
    expect(kept).toMatchObject({ site: ARENA_SITE, hero: "SB", hole: "AsAh", board: "2c7d9h", bb: "1bb", decisions: 2, importId: "arena-2026-11-22", text: PLAYED });
    expect(importHand(kept!.text).lines.flop).toEqual([
      { pos: "BB", action: "check" },
      { pos: "SB", action: "bet", to: 2 },
      { pos: "BB", action: "fold" },
    ]);
    expect(await keepForReview(PLAYED, at)).toMatchObject({ had: true });
    expect(analyzeLink("a|b")).toBe("/analyze?hand=a%7Cb");
  });

  it("says why a hand with no decision of yours, or one that won't read, isn't kept", async () => {
    expect(await keepForReview(WALK)).toMatchObject({ error: expect.stringMatching(/no decision/) });
    expect(await keepForReview("not a hand history")).toMatchObject({ error: expect.stringMatching(/couldn't be read/) });
  });
});
