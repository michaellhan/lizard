import { describe, expect, it } from "vitest";
import { describe as describeProvenance, provenanceOf, sourceOf } from "./provenance";
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

    // a 3-way answer at once (Advisor._mw_instant) is not the 5+-way heuristic
    expect(sourceOf({ street: "flop", multiway: true, approximate: { source: "near", label: "3-way library" } })).toBe("instant");
    expect(provenanceOf({ street: "flop", multiway: true, players: 5 }, ctx)).toMatchObject({ source: "rules", approximate: true });
    expect(sourceOf({ street: "flop", multiway: true, solved: true, solver: { iterations: 200 } })).toBe("live");
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

  it("describes itself in words", () => {
    const p = provenanceOf({ precomputed: { spot: "srp_btn_bb" }, solver: { exploitability_pct: 0.2 } }, ctx);
    expect(describeProvenance(p)).toBe("Precomputed solution · srp_btn_bb · 0.20% pot from equilibrium");
  });
});
