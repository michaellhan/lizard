// The custom setup: each setting maps to the engine's key (advisor.py _advise), out-of-range input is refused before
// any request, and the setup rides in Study's URL after the line (a link without one reads as before).
import { describe, expect, it } from "vitest";
import { freshHand, fromSearch, studyRequest, toSearch, type StudyHand } from "@/features/study/studyState";
import { describeSetup, gameSetup, setupProblems, setupRequest, tidySetup, type SpotSetup } from "./setup";

const FULL: SpotSetup = {
  stacks: { BTN: 40, BB: 120 },
  sizes: { flop: [33, 75], turn: [75], raise: [60] },
  rake: 5,
  rakeCap: 3,
  ante: 0.1,
  straddle: true,
  ranges: { BB: "22+,A2s+,KTo+", BTN: "AhKh,QQ+" },
};

describe("the custom setup", () => {
  it("maps each setting to the engine's key: stacks, sizes in % of the pot, rake as a share, ante, straddle, ranges", () => {
    expect(setupRequest(FULL, 6)).toEqual({
      stacks: { BTN: 40, BB: 120 },
      sizes: { flop: [33, 75], turn: [75], raise: [60] },
      rake: 0.05,
      rake_cap: 3,
      ante: 0.1,
      straddle: true,
      ranges: { BB: "22+,A2s+,KTo+", BTN: "AhKh,QQ+" },
    });
    // nothing set, or set to nothing: no keys (a cap without rake means nothing)
    const none: SpotSetup = { rake: 0, rakeCap: 3, ante: 0, straddle: false, ranges: { BB: "  " }, sizes: { flop: [] }, stacks: {} };
    expect(setupRequest(none, 6)).toEqual({});
    expect(tidySetup(none)).toBeUndefined();
    expect(setupRequest(undefined, 6)).toEqual({});
    expect(setupRequest({ rake: 4.5 }, 6)).toEqual({ rake: 0.045 });
  });

  it("refuses what's out of range before it reaches the solver", () => {
    expect(setupProblems(6, FULL)).toEqual([]);
    expect(setupProblems(6, { sizes: { flop: [25, 33, 75, 125] } })).toEqual(["at most 3 flop bet sizes (each one multiplies the game tree)"]);
    expect(setupProblems(6, { sizes: { river: [2], raise: [600] } })).toEqual(["river bet sizes must be 5–500% of the pot", "raise sizes must be 5–500% of the pot"]);
    expect(setupProblems(6, { sizes: { turn: [NaN] } })).toEqual(["turn bet sizes must be 5–500% of the pot"]);
    expect(setupProblems(6, { rake: 30 })).toEqual(["the rake must be 0–25% of the pot"]);
    expect(setupProblems(6, { rake: 5, rakeCap: -1 })).toEqual(["the rake's cap must be a positive number of big blinds"]);
    expect(setupProblems(6, { ante: 2 })).toEqual(["the ante must be 0–1bb a seat"]);
    expect(setupProblems(2, { straddle: true })).toEqual(["a straddle needs 3 or more players"]);
    expect(setupProblems(2, { stacks: { BTN: 40, BB: 0, SB: NaN } })).toEqual(["BTN isn't a seat at this table", "BB's stack must be more than 0 and at most 1000bb", "SB's stack must be more than 0 and at most 1000bb"]);
    expect(setupProblems(6, { ranges: { BB: "22+,XYZ,AA:2", SB: "AhKh,QsQd:0.5,JJ:0.25", LJ: "AA" } })).toEqual([
      `BB's range: can't read "XYZ", "AA:2"`,
      "LJ isn't a seat at this table",
    ]);
    expect(setupProblems(6, undefined)).toEqual([]);
    // a game's ante and straddle, for the links from a hand or a library spot
    expect(gameSetup(9, 0.1, false)).toEqual({ ante: 0.1 });
    expect(gameSetup(6, 0, true)).toEqual({ straddle: true });
    expect(gameSetup(6)).toBeUndefined();
    expect(gameSetup(6, 1.5)).toBeNull();
    expect(gameSetup(2, 0, true)).toBeNull();
  });

  it("rides in Study's URL after the line, read back the same, and in Study's request", () => {
    const h: StudyHand = { ...freshHand(6, 100), preflop: [{ pos: "UTG", action: "fold" }], setup: FULL };
    const q = toSearch(h);
    expect(q).toBe(
      "p=6&s=100&pre=UTG%3Af&stacks=BTN%3A40%2CBB%3A120&sz.flop=33%2C75&sz.turn=75&sz.raise=60&rake=5&cap=3&ante=0.1&straddle=1&rg.BB=22%2B%2CA2s%2B%2CKTo%2B&rg.BTN=AhKh%2CQQ%2B",
    );
    expect(fromSearch(q)).toEqual(h);
    expect(studyRequest(h)).toMatchObject({ players: 6, stack: 100, study: true, stacks: { BTN: 40, BB: 120 }, rake: 0.05, rake_cap: 3, ranges: FULL.ranges });
    // without a setup: the same link and request as before
    expect(toSearch(freshHand(6, 100))).toBe("p=6&s=100");
    expect(fromSearch("p=6&s=100")).toEqual(freshHand(6, 100));
    expect(Object.keys(studyRequest(freshHand(2, 50))).sort()).toEqual(["board", "flop", "players", "preflop", "river", "stack", "study", "turn"]);
  });

  it("says the setup in a few words", () => {
    expect(describeSetup(FULL)).toEqual([
      "stacks BTN 40bb, BB 120bb",
      "flop bets 33%, 75%",
      "turn bets 75%",
      "raises 60%",
      "rake 5%, capped at 3bb",
      "ante 0.1bb",
      "straddle",
      "BB, BTN ranges set",
    ]);
    expect(describeSetup({ ranges: { BB: "22+" } })).toEqual(["BB range set"]);
    expect(describeSetup(undefined)).toEqual([]);
  });
});
