import { describe, expect, it } from "vitest";
import {
  describe as describeProvenance,
  provenanceOf,
  sourceOf,
} from "./provenance";
import type { AdvisorResponse } from "./protocol";
import { SINGLE_SIZE_TREE, singleSizeWords } from "./singleSize";

const ctx = {
  mode: "fast" as const,
  transport: "worker" as const,
  solverVersion: "x",
  partial: false,
  now: 1,
};
const SIZES = { flop: [25], turn: [75], river: [75] };

describe("a single-size answer's provenance", () => {
  it("names the one-size tree, the flop's size picked by automatic sizing, and that it was read from the single-size library", () => {
    const r: AdvisorResponse = {
      street: "flop",
      precomputed: { spot: "ss_srp_btn_bb" },
      solver: { iterations: 300, exploitability_pct: 0.11 },
      single_size: {
        stored: true,
        spot: "ss_srp_btn_bb",
        flop: { spot: "ss_srp_btn_bb", flop: "Ac7d2h", pct: 25 },
        sizes: SIZES,
        library: true,
      },
    };
    expect(sourceOf(r)).toBe("library");
    const p = provenanceOf(r, ctx);
    expect(p.singleSize).toMatch(
      new RegExp(
        `^${SINGLE_SIZE_TREE}: one bet size a node, the flop's 25% picked for this flop by the solver's automatic sizing`,
      ),
    );
    expect(p.singleSize).toMatch(
      /turn and river bets 75%; read from the single-size library$/,
    );
    const line = describeProvenance(p);
    expect(line).toMatch(
      /^Precomputed solution · single-size tree with solver-chosen sizes/,
    );
    expect(line).toContain("ss_srp_btn_bb");
    expect(line).toContain("0.11% pot from equilibrium");
  });

  it("says a later street stands on the stored flop and was solved live on the same tree", () => {
    const w = singleSizeWords(
      {
        stored: false,
        flop: { spot: "ss_3bp_bb_btn", flop: "KcQc8d", pct: 200 },
        sizes: SIZES,
        library: true,
      },
      "turn",
    );
    expect(w).toMatch(/the flop's 200% picked/);
    expect(w).toMatch(
      /the flop read from the single-size library, the turn solved live on the same tree$/,
    );
  });

  it("says a flop it doesn't hold was solved live", () => {
    const w = singleSizeWords({
      stored: false,
      sizes: { flop: [33], turn: [75], river: [75] },
      library: true,
    });
    expect(w).toMatch(
      /solved live: this flop isn't in the single-size library$/,
    );
    const p = provenanceOf(
      {
        street: "flop",
        solver: { iterations: 200, exploitability_pct: 0.4 },
        single_size: { stored: false, library: true },
      },
      ctx,
    );
    expect(p.source).toBe("live");
    expect(describeProvenance(p)).toMatch(/^Live solve · single-size tree/);
  });

  it("names an ante or straddle game's ranges as its stored preflop solve's, not the charts'", () => {
    const r: AdvisorResponse = {
      street: "flop",
      precomputed: { spot: "ss_srp_btn_bb_ante" },
      solver: { iterations: 300, exploitability_pct: 0.12 },
      single_size: {
        stored: true,
        spot: "ss_srp_btn_bb_ante",
        flop: { spot: "ss_srp_btn_bb_ante", flop: "5c4d2h", pct: 33 },
        sizes: { flop: [33], turn: [75], river: [75] },
        library: true,
        game: {
          spot: "ss_srp_btn_bb_ante",
          players: 6,
          stack: 100,
          ante: 0.17,
          straddle: false,
        },
        ranges: {
          source: "preflop solve",
          key: "lz4_6max_100bb_a0.17_ch",
          sha1: "7fd4d92bdcb4",
          words: "1bb big-blind ante (0.17bb a seat)",
          model: "calibrated class-level model",
        },
      },
    };
    const p = provenanceOf(r, ctx);
    expect(p.singleSize).toMatch(
      /read from the single-size library; ranges entering the flop from Lizard's stored preflop solve of this game \(1bb big-blind ante \(0.17bb a seat\)\) lz4_6max_100bb_a0.17_ch \(7fd4d92bdcb4\), not the charts; preflop is approximate$/,
    );
    expect(describeProvenance(p)).toContain(
      "1bb big-blind ante (0.17bb a seat)",
    );
    const turn = singleSizeWords(
      {
        stored: false,
        flop: { spot: "ss_srp_btn_utg_straddle", pct: 200 },
        library: true,
        game: { straddle: true },
      },
      "turn",
    );
    expect(turn).toMatch(
      /the turn solved live on the same tree; ranges entering the flop from Lizard's stored preflop solve of this game \(2bb straddle\)/,
    );
  });

  it("is nothing for an answer that isn't one", () => {
    expect(singleSizeWords(undefined)).toBeNull();
    expect(
      provenanceOf({ street: "flop", precomputed: { spot: "srp_btn_bb" } }, ctx)
        .singleSize,
    ).toBeUndefined();
  });
});
