// Bunching (engine/bunching.py): the setup's key goes to the worker and never to a local server, round-trips through the
// link, and the answer's block is said in a live solve's provenance (whose folds, how, and that runouts are even).
import { describe, expect, it } from "vitest";
import { describe as describeProvenance, provenanceOf } from "./provenance";
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { bunchingWords, nextCardWords, withBunching, type BunchingBlock } from "./bunching";
import { describeSetup, setupFromParams, setupProblems, setupRequest, setupToParams, tidySetup } from "@/features/solve/setup";
import { freshHand, fromSearch, studyRequest, toSearch, withBunchingOn, withPf, type StudyHand } from "@/features/study/studyState";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "v", partial: false, now: 1 };

const BLOCK: BunchingBlock = {
  source: "charts",
  label: "the preflop charts' fold ranges",
  folders: [
    { seat: "UTG", combos: 1077.7 },
    { seat: "HJ", combos: 1022.4 },
    { seat: "CO", combos: 928.8 },
    { seat: "SB", combos: 1122.8 },
  ],
  seats: { BB: { combos: 410.2, weighted: 352.1, spread: 0.79 }, BTN: { combos: 520.3, weighted: 450.6, spread: 0.8 } },
  method: "sampled",
  samples: 60000,
  stderr_pct: 0.29,
  conditioned_on: "the flop",
  runouts: "dealt evenly",
  next_card: {
    street: "turn",
    by_rank: [
      { rank: "A", p: 0.08805, even: 0.08163 },
      { rank: "K", p: 0.06371, even: 0.06122 },
      { rank: "9", p: 0.08138, even: 0.08163 },
      { rank: "2", p: 0.05878, even: 0.06122 },
    ],
    most_moved: { card: "Ah", p: 0.0221, even: 0.0204 },
  },
};

describe("the request", () => {
  it("goes to the worker as the setup says, and never to a local server (upstream has no such key)", () => {
    const st: AdvisorState = { players: 6, board: "Kd7c2h", bunching: "charts" };
    expect(withBunching(st, "worker")).toBe(st);
    expect(withBunching(st, "http")).toEqual({ players: 6, board: "Kd7c2h" });
    const plain: AdvisorState = { players: 6 };
    expect(withBunching(plain, "http")).toBe(plain);
  });

  it("is a setup key: kept, sent, in the link, said, and checked", () => {
    expect(tidySetup({ bunching: "solve" })).toEqual({ bunching: "solve" });
    expect(setupRequest({ bunching: "charts" }, 6)).toEqual({ bunching: "charts" });
    const q = new URLSearchParams();
    setupToParams({ bunching: "solve", ante: 0.1 }, q);
    expect(q.get("bunch")).toBe("solve");
    expect(setupFromParams(q)).toEqual({ ante: 0.1, bunching: "solve" });
    expect(setupFromParams(new URLSearchParams("bunch=everything"))).toBeUndefined();
    expect(describeSetup({ bunching: "charts" })).toEqual(["bunching from the preflop charts' fold ranges"]);
    expect(setupProblems(6, { bunching: "charts" })).toEqual([]);
    expect(setupProblems(2, { bunching: "charts" })).toEqual(["bunching needs 3 or more players: heads-up nobody folds before the flop"]);
  });
});

describe("Study's switch", () => {
  const flop: StudyHand = { ...freshHand(6, 100), board: "Kd7c2h", preflop: [{ pos: "UTG", action: "fold" }] };

  it("takes the folds from the preflop source in use, and keeps them in the link", () => {
    const on = withBunchingOn(flop, true);
    expect(on.setup).toEqual({ bunching: "charts" });
    expect(studyRequest(on).bunching).toBe("charts");
    expect(fromSearch(toSearch(on))?.setup).toEqual({ bunching: "charts" });
    const solver = withBunchingOn(withPf(flop, "solver"), true);
    expect(solver.setup).toEqual({ bunching: "solve" });
    expect(withBunchingOn(on, false).setup).toBeUndefined();
    // (the rest of a setup stays as it was)
    expect(withBunchingOn({ ...flop, setup: { ante: 0.2 } }, false).setup).toEqual({ ante: 0.2 });
  });

  it("sends the preflop solve's sizes with its folds, so they're read off the game that played the line", () => {
    const h = withBunchingOn({ ...withPf(flop, "solver"), pfSizes: { open: 3 } }, true);
    expect(studyRequest(h)).toMatchObject({ bunching: "solve", pf_sizes: { open: 3 } });
    expect(studyRequest(withBunchingOn({ ...flop, pfSizes: { open: 3 } }, true)).pf_sizes).toBeUndefined();
  });
});

describe("the answer's bunching in words", () => {
  it("names the folders, whose folds, the error, and that runouts are dealt evenly", () => {
    expect(bunchingWords(undefined)).toBeNull();
    expect(bunchingWords(BLOCK)).toBe(
      "bunching: ranges weighed by the hands UTG, HJ, CO, SB folded, from the preflop charts' fold ranges, sampled over 60,000 deals, ±0.29% a combo; turn and river still dealt evenly",
    );
    expect(bunchingWords({ ...BLOCK, method: "exact", folders: [{ seat: "BTN", combos: 900 }] })).toMatch(/hands BTN folded, .* exact;/);
    expect(bunchingWords({ ...BLOCK, asked: "solve", why: "the preflop solve of this game isn't stored or solved yet" })).toContain(
      "(the preflop solve's were asked for, but the preflop solve of this game isn't stored or solved yet)",
    );
    expect(bunchingWords({ off: "nobody folded preflop: there is no bunching" })).toBe("bunching off: nobody folded preflop: there is no bunching");
  });

  it("names the ranks the folds move most on the next card", () => {
    expect(nextCardWords(BLOCK, 2)).toBe("Turn card odds the folds give: A 8.8% (even 8.2%), K 6.4% (even 6.1%)");
    expect(nextCardWords({ off: "x" })).toBeNull();
  });

  it("goes into a live solve's provenance and a node lock's, and nowhere else", () => {
    const live: AdvisorResponse = { street: "flop", bunching: BLOCK, solver: { iterations: 200, exploitability_pct: 0.3 } };
    const p = provenanceOf(live, ctx);
    expect(p.bunching).toBe(bunchingWords(BLOCK));
    expect(describeProvenance(p)).toContain("Live solve · bunching: ranges weighed by the hands UTG, HJ, CO, SB folded");
    expect(provenanceOf({ street: "flop", precomputed: { spot: "srp" }, bunching: BLOCK }, ctx).bunching).toBeUndefined();
    expect(provenanceOf({ street: "preflop", bunching: BLOCK }, ctx).bunching).toBeUndefined();
  });
});
