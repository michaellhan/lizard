import { describe, expect, it } from "vitest";
import { isBasis } from "@/data/shapes";
import { basisOf } from "@/grading/basis";
import { gradeAnswer } from "@/grading/grade";
import type { AdvisorResponse } from "./protocol";
import { provenanceOf } from "./provenance";

const ctx = { mode: "quick" as const, transport: "worker" as const, solverVersion: "test", partial: false, now: 1 };

/** CO opens, BTN and BB call, Kd7s2c: BB's first decision, check 100% +0.24, bet 33% 0% -0.24 (pot 7.5). */
const BASE: AdvisorResponse = {
  street: "flop",
  pot_bb: 7.5,
  to_call_bb: 0,
  actions: [
    { action: "check", freq: 1, ev_bb: 0.24 },
    { action: "bet 33%", freq: 0, ev_bb: -2.6 },
  ],
  multiway: true,
};

const BUILT_TEXT =
  "this spot as built on the charts of 2026-11-16, which have changed since: BB's range differs from this pot's by 7.5% of its weight; CO and BTN's are the same";

describe("a 3-way spot served as built on older charts (engine/mw_near.py)", () => {
  const r: AdvisorResponse = {
    ...BASE,
    solver: { iterations: 400, exploitability_pct: 0.07 },
    precomputed: { spot: "mw_co_btn_bb", borrowed: { spot: "mw_co_btn_bb", cover: [1, 1, 0.966], dist: [0, 0, 0.15], text: BUILT_TEXT, built: { commit: "5b49b94", date: "2026-11-16", seats: ["CO", "BTN", "BB"] } } },
  };

  it("labels it as this spot as built, not another table's spot", () => {
    const p = provenanceOf(r, ctx);
    expect(p.approximate).toBe(true);
    expect(p.approximateLabel).toBe(BUILT_TEXT);
    expect(p.approximateLabel).not.toMatch(/another table/);
    // (the stored solve's figures describe the built ranges, not this pot's: not shown)
    expect(p.exploitabilityPct).toBeUndefined();
  });

  it("still says another table's spot for one borrowed from another table size", () => {
    const other: AdvisorResponse = { ...r, precomputed: { spot: "srp_btn_bb", borrowed: { text: "the 6-max spot read at 9-max" } } };
    expect(provenanceOf(other, ctx).approximateLabel).toBe("another table's spot read as this one (the 6-max spot read at 9-max)");
  });

  it("caps a Mistake with the reason that it's read from another solution, and keeps a clear blunder", () => {
    const b = basisOf(provenanceOf(r, ctx));
    const g = gradeAnswer({ freqs: [1, 0], evs: [0.24, -0.3], pot: 7.5 }, 1, b);
    expect(g.verdict).toBe("Inaccuracy");
    expect(g.capWhy).toMatch(/read from another solution/);
    const clear = gradeAnswer({ freqs: [1, 0], evs: [0.24, -2.6], pot: 7.5 }, 1, b);
    expect(clear.verdict).toBe("Blunder");
  });
});

describe("an answer approximate for a reason of its own (solver.approximate_reason)", () => {
  const REASON =
    "a quick answer's 3-way flop is solved in a small game (6 hand buckets a player on the turn and river, one bet size of half the pot), so its mix and EVs are a rough guide";
  const r: AdvisorResponse = { ...BASE, solver: { iterations: 120, exploitability_pct: 0.46, approximate: true, approximate_reason: REASON } };

  it("says the reason in the label and keeps it on the provenance", () => {
    const p = provenanceOf(r, ctx);
    expect(p.band).toBe("approximate");
    expect(p.approximateReason).toBe(REASON);
    expect(p.approximateLabel).toContain(REASON);
  });

  it("caps a grade with that reason, not 'short of its target'", () => {
    const b = basisOf(provenanceOf(r, ctx));
    expect(b.approximateReason).toBe(REASON);
    expect(isBasis(b)).toBe(true);
    const g = gradeAnswer({ freqs: [1, 0], evs: [0.24, -0.3], pot: 7.5 }, 1, b);
    expect(g.verdict).toBe("Inaccuracy");
    expect(g.capWhy).toContain("This answer is approximate: a quick answer's 3-way flop is solved in a small game");
    expect(g.capWhy).not.toMatch(/short of its target/);
  });

  it("leaves a solve short of its target worded as before", () => {
    const short: AdvisorResponse = { ...BASE, solver: { iterations: 120, exploitability_pct: 1.8, approximate: true, target_pct: 0.5 } };
    const p = provenanceOf(short, ctx);
    expect(p.approximateReason).toBeUndefined();
    const g = gradeAnswer({ freqs: [1, 0], evs: [0.24, -0.3], pot: 7.5 }, 1, basisOf(p));
    expect(g.capWhy).toMatch(/short of its target/);
  });

  it("ignores a reason on an answer the solver doesn't mark approximate", () => {
    const p = provenanceOf({ ...BASE, solver: { iterations: 300, exploitability_pct: 0.2, approximate_reason: REASON } }, ctx);
    expect(p.approximateReason).toBeUndefined();
    expect(p.approximate).toBe(false);
  });
});
