import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "./protocol";
import { provenanceOf, rangesOffOf } from "./provenance";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 0 };
const mw = (notes: string[]): AdvisorResponse =>
  ({ street: "flop", multiway: true, solved: true, actions: [], notes, solver: { exploitability_pct: 0.07, iterations: 200 } }) as unknown as AdvisorResponse;

describe("3-way ranges narrowed through a solve", () => {
  it("is approximate where the narrowing solve is followed only in part", () => {
    const r = mw(["flop: 3-way, ranges narrowed through a solve from the street's start (52 iterations, 3.1% of the pot from equilibrium: followed 42%, the rest by the betting rules)"]);
    expect(rangesOffOf(r)).toBe(
      "the flop's 3-way narrowing solve stopped 3.1% of the pot from equilibrium after 52 iterations, so the ranges follow it 42% and the betting rules the rest, and can differ from run to run",
    );
    const p = provenanceOf(r, ctx);
    expect(p.approximate).toBe(true);
    expect(p.approximateLabel).toContain("3-way narrowing solve");
  });

  it("is a solve where the narrowing solve is followed whole", () => {
    const r = mw(["flop: 3-way, ranges narrowed through a solve from the street's start (100 iterations, 0.4% of the pot from equilibrium: followed 100%, the rest by the betting rules)"]);
    expect(rangesOffOf(r)).toBeNull();
    expect(provenanceOf(r, ctx).approximate).toBe(false);
  });

  it("still says the betting rules where no solve narrowed them", () => {
    const r = mw(["flop: multiway, ranges narrowed by simple betting rules rather than a solve"]);
    expect(rangesOffOf(r)).toBe("ranges through the flop from the betting rules, not a solve");
  });
});
