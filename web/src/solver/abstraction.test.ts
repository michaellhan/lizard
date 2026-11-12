// A heads-up flop answer's figure is in its solve's own smaller game: what that game's flop gave up in the full game
// (scripts/benchmarks/abstraction.py, docs/ACCURACY.md section 21) goes beside it, on the answers those models give.
import { describe, expect, it } from "vitest";
import { abstractionWords, FLOP_GIVEN_UP, flopModelOf } from "./abstraction";
import { describe as describeProvenance, provenanceOf } from "./provenance";
import type { AdvisorResponse } from "./protocol";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "v", partial: false, now: 1 };
const FLOP: AdvisorResponse = { street: "flop", solver: { iterations: 400, exploitability_pct: 0.04 } };

describe("the flop abstraction's measured cost", () => {
  it("is the benchmark's, each model's average below its worst", () => {
    for (const g of Object.values(FLOP_GIVEN_UP)) expect(g.mean).toBeLessThanOrEqual(g.most);
    expect(abstractionWords("fast")).toBe("this flop model gave up 1.9% pot on average, up to 4.9%, against the full game on 3 narrow test spots");
    expect(abstractionWords(null)).toBeNull();
  });

  it("goes on a heads-up flop from the browser's Fast or Accurate, or the library, and nowhere else", () => {
    expect(flopModelOf(FLOP, "live", "fast", "worker")).toBe("fast");
    expect(flopModelOf(FLOP, "live", "accurate", "worker")).toBe("accurate");
    expect(flopModelOf(FLOP, "node-lock", "fast", "worker")).toBe("fast");
    expect(flopModelOf({ ...FLOP, precomputed: { spot: "srp" } }, "library", "fast", "http")).toBe("library");
    // not measured: Quick's smaller game, a local server's own configs, other streets, multiway
    expect(flopModelOf(FLOP, "live", "quick", "worker")).toBeNull();
    expect(flopModelOf(FLOP, "live", "fast", "http")).toBeNull();
    expect(flopModelOf({ ...FLOP, street: "turn" }, "live", "fast", "worker")).toBeNull();
    expect(flopModelOf({ ...FLOP, multiway: true }, "live", "fast", "worker")).toBeNull();
  });

  it("is said right after the figure measured in the solved game", () => {
    const p = provenanceOf(FLOP, ctx);
    expect(p.abstraction).toBe(abstractionWords("fast"));
    expect(describeProvenance(p)).toBe(
      "Live solve · 0.04% pot from equilibrium in the solved game (converged) · this flop model gave up 1.9% pot on average, up to 4.9%, against the full game on 3 narrow test spots · 400 iterations",
    );
    expect(provenanceOf({ ...FLOP, street: "turn" }, ctx).abstraction).toBeUndefined();
  });
});
