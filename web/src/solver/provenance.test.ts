import { describe, expect, it } from "vitest";
import { describe as describeProvenance, provenanceOf, sourceOf } from "./provenance";

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
