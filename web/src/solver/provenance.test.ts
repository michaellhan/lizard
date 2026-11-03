import { describe, expect, it } from "vitest";
import { bandOf, describe as describeProvenance, provenanceOf, sourceOf } from "./provenance";
import type { AdvisorResponse } from "./protocol";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "9b907bd6/abc", partial: false, now: 1 };

describe("provenance", () => {
  it("names what answered", () => {
    expect(sourceOf({ precomputed: { spot: "srp_btn_bb" }, street: "flop" })).toBe("library");
    expect(sourceOf({ street: "preflop" })).toBe("charts");
    expect(sourceOf({ street: "turn", solver: { iterations: 300 } })).toBe("live");
    expect(sourceOf({ fallback: "rules", street: "river" })).toBe("rules");
    expect(sourceOf({ fallback: "chart" })).toBe("charts");
    expect(sourceOf({ study: "pf_progress" })).toBe("preflop-solve");
    expect(sourceOf({})).toBe("unknown");
  });

  it("labels stored turns, answers at once and 5+-way heuristics as what they are (advisor.py's shapes)", () => {
    const storedTurn: AdvisorResponse = {
      street: "turn",
      approximate: { source: "store", label: "the flop library's stored turn", iterations: 300 },
      solver: { iterations: 300, exploitability_pct: 0.12, by: "the flop library" },
    };
    const p = provenanceOf(storedTurn, ctx);
    expect(p).toMatchObject({ source: "library-turn", approximate: true });
    expect(p.exploitabilityPct).toBeUndefined(); // the flop entry's number, not the turn's
    expect(sourceOf({ study: "runouts", source: "store", solver: { iterations: 300, by: "the flop library" } })).toBe("library-turn");

    // Advisor._study_near: a flop the library does not store, read off the most similar stored flops
    const nearLabel = "the precomputed solves of the most similar flops (Kd7c2h), by card substitution";
    const near: AdvisorResponse = {
      study: "node",
      street: "flop",
      approximate: { source: "near", label: nearLabel, iterations: null },
      solver: { iterations: null, exploitability_pct: null, by: "the flop library" },
    };
    const instant = provenanceOf(near, ctx);
    expect(instant).toMatchObject({ source: "instant", approximate: true, approximateLabel: nearLabel });
    expect(describeProvenance(instant)).toBe(`Answer at once · ${nearLabel} · approximate`);

    // Advisor._study_prev: the turn read off the flop's live solve, whose numbers are the flop's, not this answer's
    const prev = provenanceOf(
      {
        study: "node",
        street: "turn",
        approximate: { source: "prev", label: "the flop solve's view of the turn (by card class)", iterations: 412 },
        solver: { iterations: 412, by: "the flop's solve", exploitability_pct: 0.31 },
      },
      { ...ctx, partial: true },
    );
    expect(prev).toMatchObject({ source: "instant", approximate: true });
    expect(prev.exploitabilityPct).toBeUndefined();
    expect(prev.iterations).toBeUndefined();

    // Advisor._study_look: this street's own solve so far, stopped at a look (its numbers are in the label)
    const look = provenanceOf(
      {
        study: "node",
        street: "turn",
        approximate: { source: "solve", label: "this street's solve so far (200 iterations, 0.36% of the pot from equilibrium)", iterations: 200 },
        solver: { iterations: null, exploitability_pct: null },
      },
      { ...ctx, partial: true },
    );
    expect(describeProvenance(look)).toBe("Live solve · this street's solve so far (200 iterations, 0.36% of the pot from equilibrium) · in progress");

    // Advisor._study_mw_prev's own branch: a read of an earlier decision's 3-way solve on this street, not this node's
    const mwOwn = provenanceOf(
      {
        study: "node",
        street: "flop",
        multiway: true,
        approximate: { source: "solve", label: "this street's 3-way solve from SB's decision (300 iterations, 0.25% of the pot from equilibrium), on the line since", iterations: null },
        solver: { iterations: null, exploitability_pct: null, by: "the flop's earlier solve" },
      },
      { ...ctx, partial: true },
    );
    expect(mwOwn).toMatchObject({ source: "instant", approximate: true });

    // a 3-way answer at once (Advisor._mw_instant) is not the 5+-way heuristic
    expect(sourceOf({ street: "flop", multiway: true, approximate: { source: "near", label: "3-way library" } })).toBe("instant");
    expect(provenanceOf({ street: "flop", multiway: true, players: 5 }, ctx)).toMatchObject({ source: "rules", approximate: true });
    expect(sourceOf({ street: "flop", multiway: true, solved: true, solver: { iterations: 200 } })).toBe("live");
  });

  it("marks borrowed library spots and preflop charts approximate, and shows a stored turn's label", () => {
    const borrowed = provenanceOf(
      {
        street: "flop",
        precomputed: { spot: "srp_btn_bb", borrowed: { dist: [0.02], text: "this table's ranges differ from that spot's by 2.0% of their weight at most" } },
        solver: { iterations: 1000, exploitability_pct: 0.12 },
      },
      ctx,
    );
    expect(borrowed).toMatchObject({ source: "library", approximate: true, librarySpot: "srp_btn_bb" });
    expect(borrowed.exploitabilityPct).toBeUndefined(); // that spot's, on its own ranges
    expect(describeProvenance(borrowed)).toBe(
      "Precomputed solution · srp_btn_bb · another table's spot read as this one (this table's ranges differ from that spot's by 2.0% of their weight at most) · approximate",
    );
    expect(provenanceOf({ street: "preflop", grid: { actions: [], cells: {} } }, ctx)).toMatchObject({ source: "charts", approximate: true });
    const turn = provenanceOf({ street: "turn", approximate: { source: "store", label: "the nearest spot that stores its turns (srp_co_bb)" } }, ctx);
    expect(describeProvenance(turn)).toBe("Stored turn from the flop library · the nearest spot that stores its turns (srp_co_bb) · approximate");
  });

  it("marks heuristic fallbacks and partial answers approximate, and keeps the convergence numbers", () => {
    expect(provenanceOf({ fallback: "rules", fallback_reason: "timeout" }, ctx)).toMatchObject({
      source: "rules",
      approximate: true,
      fallbackReason: "timeout",
    });
    const live = provenanceOf({ street: "turn", solver: { iterations: 400, exploitability_pct: 0.31, solve_seconds: 2.5 } }, ctx);
    expect(live).toMatchObject({ source: "live", approximate: false, iterations: 400, exploitabilityPct: 0.31, seconds: 2.5 });
    expect(provenanceOf({ street: "turn", solver: { iterations: 40 } }, { ...ctx, partial: true }).approximate).toBe(true);
  });

  it("bands a measured figure as the classic app does: converged under 3%, fair under 10%, else rough", () => {
    expect([2.99, 3.0, 9.99, 10.0].map((x) => bandOf(x))).toEqual(["converged", "fair", "fair", "rough"]);
    expect(bandOf(0.1, true)).toBe("approximate");
    const cut = provenanceOf({ street: "turn", solver: { iterations: 12, exploitability_pct: 4 } }, ctx);
    expect(cut.band).toBe("fair");
    expect(describeProvenance(cut)).toBe("Live solve · 4.00% pot from equilibrium in the solved game (fair) · 12 iterations");
    const short = provenanceOf({ street: "turn", solver: { iterations: 90, exploitability_pct: 0.5, approximate: true, target_pct: 0.3 } }, ctx);
    expect(describeProvenance(short)).toBe(
      "Live solve · 0.50% pot from equilibrium in the solved game (approximate, target 0.3%) · 90 iterations · approximate",
    );
    // no measured figure, no band (a stored turn, an answer at once, the charts)
    expect(provenanceOf({ street: "preflop" }, ctx).band).toBeUndefined();
  });

  it("describes itself in words", () => {
    const p = provenanceOf({ precomputed: { spot: "srp_btn_bb" }, solver: { exploitability_pct: 0.2 } }, ctx);
    expect(describeProvenance(p)).toBe("Precomputed solution · srp_btn_bb · 0.20% pot from equilibrium in the solved game (converged)");
    const mw = provenanceOf({ street: "flop", multiway: true, solved: true, solver: { iterations: 300, exploitability_pct: 0.25 } }, ctx);
    expect(describeProvenance(mw)).toBe("Live solve · 0.25% pot mean best-response gain in the solved game (converged) · 300 iterations");
  });

  // (the engine's answers, as advisor.py _tournament_info and _push write them)
  const ICM = { equity_share: 0.0719, bubble_factors: { BB: 1.2 }, note: "tournament: ICM, CO's prize equity 7.2% of what's left to pay; bubble factor up to 1.20" };
  it("says which model a tournament answer is in, and never puts chips for prize equity", () => {
    const solve = provenanceOf({ street: "flop", tournament: ICM, notes: [ICM.note], solver: { iterations: 158, exploitability_pct: 0.29 } }, ctx);
    expect(describeProvenance(solve)).toBe("Live solve · prize-equity solve (ICM) · 0.29% pot from equilibrium in the solved game (converged) · 158 iterations");
    const jam = provenanceOf({ street: "preflop", tournament: ICM, notes: [ICM.note, "a raise here commits too much of a 8bb stack: all-in, range from the push/fold equilibrium against 3 players in prize equity (ICM: both the jams and the calls)"] }, ctx);
    expect(jam.tournament).toBe("push/fold equilibrium in prize equity");
    const call = provenanceOf({ street: "preflop", tournament: ICM, notes: [ICM.note, "BTN's 10bb jam range: push/fold equilibrium against 2", "tournament: calling needs 48.1% equity in prize equity against 41.0% in chips (a risk premium of +7.1%)"] }, ctx);
    expect(call.tournament).toBe("a call priced in prize equity");
    const chart = provenanceOf({ street: "preflop", tournament: ICM, notes: [ICM.note, "preflop: the 40bb chart (the 100bb chart moved by solves of this game)"] }, ctx);
    expect(describeProvenance(chart)).toBe("Preflop charts · chip chart with a risk premium · approximate");
    expect(provenanceOf({ street: "river", fallback: "rules", tournament: ICM, notes: [] }, ctx).tournament).toBe("a tournament, but the fallback plays chips");
    const mystery = { ...ICM, bounties: { format: "mystery" } };
    expect(provenanceOf({ street: "turn", tournament: mystery, solver: { iterations: 300 } }, ctx).tournament).toBe("prize-equity solve (ICM), mystery bounties at the average envelope");
    // a large field modelled by stand-ins (advisor.py _tournament_info's note)
    const big = { ...ICM, note: "tournament: ICM (54 players modelled by 12), CO's prize equity 1.9% of what's left to pay; bubble factor up to 1.31" };
    expect(provenanceOf({ street: "flop", tournament: big, solver: { iterations: 300 } }, ctx).tournament).toBe("prize-equity solve (ICM), 54 players modelled by 12");
    const pko = { ...ICM, note: "tournament: no payouts given, so chip EV: …", bounties: { format: "pko" } };
    expect(provenanceOf({ street: "turn", tournament: pko, solver: { iterations: 300 } }, ctx).tournament).toBe(
      "chip-EV solve with bounties (no payouts given: the prizes taken as the bounties in play), PKO bounties, proportional model",
    );
    const wta = { ...ICM, note: "tournament: winner-take-all (prize equity is chips), BB's equity 40.0% of the prize pool left", bounties: { format: "ko" } };
    expect(provenanceOf({ street: "flop", tournament: wta, solver: { iterations: 300 } }, ctx).tournament).toBe("prize-equity solve (winner takes all: chips are prizes), KO bounties, proportional model");
    // a cash answer has none; a chip answer's own all-in from the push/fold equilibrium says so
    expect(provenanceOf({ street: "flop", solver: { iterations: 300 } }, ctx).tournament).toBeUndefined();
    const chipJam = provenanceOf({ street: "preflop", notes: ["a raise here commits too much of a 10bb stack: all-in, range from the push/fold equilibrium against 5 players"] }, ctx);
    expect(describeProvenance(chipJam)).toBe("Preflop charts · push/fold equilibrium in chips · approximate");
    expect(provenanceOf({ street: "preflop", notes: ["BTN's 10bb jam range: push/fold equilibrium against 2"] }, ctx).view).toBeUndefined();
  });

  it("a Quick triage's answers say so, with how far to trust them", () => {
    const quick = provenanceOf({ solver: { iterations: 300, exploitability_pct: 0.8 }, triage: { source: "quick", confidence: "medium", label: "a Quick solve" } }, ctx);
    expect([quick.source, quick.mode, quick.confidence]).toEqual(["live", "quick", "medium"]);
    expect(describeProvenance(quick)).toBe("Live solve (Quick) · 0.80% pot from equilibrium in the solved game (converged) · 300 iterations · medium confidence");
    // the street's own solve read for a later decision: an answer at once, nothing solved for it, and not timed
    const own = provenanceOf({ street: "turn", approximate: { source: "solve", label: "this street's solve from your earlier decision" }, triage: { source: "approx", confidence: "low", label: "x" } }, ctx);
    expect([own.source, own.mode]).toEqual(["instant", ctx.mode]);
    expect(describeProvenance(own)).toMatch(/^Answer at once/);
    // one cut to fit Quick is still a solve
    const cut = provenanceOf({ street: "turn", approximate: { source: "solve", label: "cut" }, solver: { iterations: 40, exploitability_pct: 14 }, triage: { source: "quick", confidence: "low", label: "x" } }, ctx);
    expect([cut.source, cut.mode]).toEqual(["live", "quick"]);
    // a library answer to a triage is the library's, whatever the mode
    const lib = provenanceOf({ precomputed: { spot: "srp_btn_bb" }, triage: { source: "library", confidence: "high", label: "x" } }, ctx);
    expect([lib.source, lib.mode, lib.confidence]).toEqual(["library", "fast", "high"]);
    // and no triage, nothing said
    expect(provenanceOf({ solver: { iterations: 300 } }, ctx).confidence).toBeUndefined();
    expect(describeProvenance({ ...quick, mode: "fast", confidence: undefined })).toMatch(/^Live solve · /);
  });
});
