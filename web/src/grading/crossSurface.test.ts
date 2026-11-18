// One answer, one pick, every surface that grades it: Practice, the live drill, a Review retry (asked again or kept),
// Analyze, a leak drill, the preflop drill and PLO all grade through gradeAnswer on the same basis, so they give the same
// verdict, the same EV as measured and the same count for the score. (The grading audit of 2026-11-18 found five
// surfaces giving three verdicts for one answer: docs/ACCURACY.md section 27.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/data/db";
import type { ResultNode } from "@/engine/plo/river/run";
import { gradeAgainst, gradeDecision } from "@/features/analyze/grading";
import { gradePick } from "@/features/analyze/leakDrill";
import { gradeDrill, type DrillProblem } from "@/features/practice/drills";
import { gradeLive, readLive } from "@/features/practice/liveDeal";
import { flopPotOf, gradable, gradeMix, mixOf, practiceBasis } from "@/features/practice/practice";
import type { Reviewed } from "@/features/practice/review";
import { retrySpot } from "@/features/practice/SessionRetry";
import { gradeAt } from "@/features/plo/drill";
import { retried, type RetrySpot } from "@/features/review/mistakes";
import { keptAnswer } from "@/features/review/retry";
import { importHand } from "@/hh/replay";
import { simulate } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import { ploRiverProvenance, provenanceOf } from "@/solver/provenance";
import { basisOf } from "./basis";
import { scored, type Grade } from "./grade";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 0 };

/** A river answer, pot 20bb: check 98% for 5bb, bet 75% (15bb) 2% for 4.1bb. Betting gives up 0.9bb, 4.5% of the pot. */
const river = (solver: AdvisorResponse["solver"], extra: Partial<AdvisorResponse> = {}): AdvisorResponse => ({
  street: "river",
  pot_bb: 20,
  to_call_bb: 0,
  actions: [
    { action: "check", freq: 0.98, ev_bb: 5 },
    { action: "bet 75%", freq: 0.02, ev_bb: 4.1, amount_bb: 15 },
  ],
  solver,
  hero_range_combos: 50,
  villain_range_combos: 50,
  off_solution: [],
  widened: [],
  ...extra,
});

/** The same answer as a one-combo PLO node, for the PLO surfaces' plumbing. */
const ploNode = (r: AdvisorResponse): ResultNode =>
  ({
    id: 0,
    path: "",
    player: 0,
    reach: 1,
    rangeEv: [0, 0],
    frequency: [0.98, 0.02],
    actionRangeEv: [0, 0],
    strategy: Float64Array.from(r.actions!.map((a) => a.freq!)),
    weight: Float64Array.from([1]),
    ev: Float64Array.from([0]),
    actionEv: Float64Array.from(r.actions!.map((a) => a.ev_bb!)),
    bestEv: Float64Array.from(r.actions!.map((a) => a.ev_bb!)),
    line: "",
    actions: r.actions!.map((a) => ({ label: a.action })),
    bets: [0, 0],
  }) as unknown as ResultNode;

/** Every surface's grade of pick `i`, by name; a surface that refuses the answer is left out. `plo`: grade the same
 * numbers as a PLO node too (a PLO solve marks no rough EVs, so a rough answer is no PLO answer). */
function everyGrade(r: AdvisorResponse, i: number, plo = true): Record<string, Grade> {
  const p = provenanceOf(r, ctx);
  const pot = r.pot_bb!;
  const basis = basisOf(p, { res: r });
  const mix = gradable(mixOf(r), p);
  const out: Record<string, Grade> = {};
  // Practice (practice.ts decide: gradeMix on practiceBasis)
  out.practice = gradeMix(mix, pot, i, basis);
  // the live drill (liveDeal.ts readLive + gradeLive): it refuses what it can't grade
  const live = readLive({ data: r, provenance: p }, { pot, bet: 0 });
  if (live.st === "answer") out.live = gradeLive(live.answer, i);
  // the preflop drill's path (PreflopDrill.tsx: gradeLive on basisOf the node)
  out.preflopDrill = gradeLive({ mix, pot, basis: basisOf(p, { res: r }) }, i);
  // a Review retry, the solver asked again, and of a mistake kept with its basis (retry.ts keptAnswer)
  const spot = { ask: { via: "solver", state: {} }, provenance: p, mix, street: "river", study: "", chose: mix[i]!.action } as unknown as RetrySpot;
  out.retry = retried(spot, { mix, pot, provenance: p }, i, 0).grade;
  const kept = { ...spot, ask: { via: "kept", hand: "h", decision: "d" }, basis, pot } as unknown as RetrySpot & { pot: number };
  out.kept = retried(kept, keptAnswer(kept), i, 0).grade;
  // Analyze (grading.ts gradeDecision: gradeAgainst on basisOf the answer), then a leak drill on the record it keeps
  const a = r.actions![i]!;
  const move = { pos: "BB", action: a.action.startsWith("bet") ? "bet" : "check", ...(a.amount_bb ? { to: a.amount_bb } : {}) } as Parameters<typeof gradeAgainst>[1];
  const g = gradeAgainst(r, move, basis);
  if (g) {
    out.analyze = g.grade;
    const record = { id: "h|river|0", mix: g.mix, pot: g.pot, basis: g.basis, source: p.source, verdict: g.grade.verdict } as unknown as DecisionRecord;
    const pick = gradePick(record, i);
    if (pick) out.leakDrill = pick;
  }
  // PLO (plo/drill.ts gradeAt, on the basis its page passes)
  if (plo) out.plo = gradeAt(ploNode(r), 0, i, pot, basis);
  return out;
}

/** What a player sees of a grade: the verdict, whether it was capped, the EV as measured, and what the score counts. */
const seen = (g: Grade) => ({ verdict: g.verdict, capped: !!g.capped, loss: Math.round(g.loss * 100) / 100, counted: Math.round(scored(g).loss * 100) / 100 });

const CASES: [string, AdvisorResponse, string, number, boolean?][] = [
  // (noise: twice 0.25% of the pot, or the 0.5% floor: 0.1bb; 0.8bb past it is 4.0% of the pot)
  ["a converged live solve", river({ iterations: 300, exploitability_pct: 0.25 }), "Mistake", 8],
  // (a solve 5% from equilibrium can't tell 2bb apart: 0.9bb is within its noise)
  ["a fair live solve", river({ iterations: 300, exploitability_pct: 5 }), "Correct", 8],
  // (short of its target: it can't condemn a line)
  ["a solve short of its target", river({ iterations: 90, exploitability_pct: 0.4, approximate: true }), "Inaccuracy", 8],
  // (an opponent's rare line read by the betting rules: the live drill refuses it, every other surface caps it)
  ["ranges from the betting rules", river({ iterations: 300, exploitability_pct: 0.25 }, { off_solution: [{ street: "turn", pos: "BTN", why: "rare", action: "bet 33%", share: 1.2 }], widened: ["BTN"] }), "Inaccuracy", 7],
  // (a narrowing solve followed 95%: said in the label, but the ranges are mostly the solve's, so the grade is as measured)
  ["a narrowing solve followed 95%", river({ iterations: 300, exploitability_pct: 0.25 }, { off_solution: [{ street: "turn", why: "unsettled", trust: 95 }] }), "Mistake", 8],
  // (a bet the range almost never takes at 300 iterations: its EV may be 2.4% of the pot off, 0.48bb on the 0.1bb noise;
  // 0.32bb past both is 1.6% of the pot, an Inaccuracy, on every surface that reads the mark)
  [
    "a rough EV",
    river({ iterations: 300, exploitability_pct: 0.25 }, { actions: [{ action: "check", freq: 0.98, ev_bb: 5 }, { action: "bet 75%", freq: 0.02, ev_bb: 4.1, amount_bb: 15, rough_ev: true }] }),
    "Inaccuracy",
    7,
    false,
  ],
];

describe("one decision, every surface", () => {
  it.each(CASES)("%s: the same verdict, loss and count everywhere", (_name, r, verdict, surfaces, plo) => {
    const all = everyGrade(r, 1, plo ?? true);
    expect(Object.keys(all)).toHaveLength(surfaces);
    const first = seen(all.practice!);
    expect(first.verdict).toBe(verdict);
    expect(first.loss).toBe(0.9);
    for (const [surface, g] of Object.entries(all)) expect({ surface, ...seen(g) }).toEqual({ surface, ...first });
  });

  it("a clear blunder on ranges from the betting rules is a Blunder on every surface that grades it, and says why", () => {
    // (betting gives up 4.5bb, 22.5% of the 20bb pot: past the noise 22.0%, a clear blunder whatever the ranges)
    const r = river(
      { iterations: 300, exploitability_pct: 0.25 },
      {
        actions: [{ action: "check", freq: 0.98, ev_bb: 5 }, { action: "bet 75%", freq: 0.02, ev_bb: 0.5, amount_bb: 15 }],
        off_solution: [{ street: "turn", pos: "BTN", why: "rare", action: "bet 33%", share: 1.2 }],
        widened: ["BTN"],
      },
    );
    const all = everyGrade(r, 1);
    expect(Object.keys(all)).toHaveLength(7);
    for (const [surface, g] of Object.entries(all)) {
      expect({ surface, ...seen(g) }).toEqual({ surface, verdict: "Blunder", capped: false, loss: 4.5, counted: 4.4 });
      expect({ surface, why: g.clearWhy }).toEqual({ surface, why: "This answer's ranges lean on the betting rules, but this gives up 22.0% of the pot past its noise, 20% or more: a clear blunder, graded as measured." });
    }
  });

  it("the hand's main play is Best everywhere", () => {
    for (const [surface, g] of Object.entries(everyGrade(river({ iterations: 300, exploitability_pct: 0.25 }), 0))) expect({ surface, v: g.verdict }).toEqual({ surface, v: "Best" });
  });

  it("a library flop grades the same in a drill, Practice and Analyze: within two stored EV steps of the flop's pot", () => {
    // BB first to act on a 5.5bb flop, a stored solve 0.3% from equilibrium: check 48% 3.1bb, bet 33% 9% 3bb, bet 75% 43% 3.12bb
    const pr = { names: ["check", "bet 33%", "bet 75%"], freqs: [0.48, 0.09, 0.43], evs: [3.1, 3, 3.12], pot: 5.5, bet: 0 } as unknown as DrillProblem;
    const e = { head: { expl: 0.3 } } as Parameters<typeof gradeDrill>[2];
    const basis = { source: "library", flopPot: 5.5, exploitabilityPct: 0.3, band: "converged" };
    const res: AdvisorResponse = { street: "flop", pot_bb: 5.5, actions: pr.names.map((action, k) => ({ action, freq: pr.freqs[k], ev_bb: pr.evs![k], ...(k ? { amount_bb: k === 1 ? 2 : 4 } : {}) })) };
    const drill = gradeDrill(pr, 1, e);
    const practice = gradeMix(mixOf(res), 5.5, 1, basis);
    const analyze = gradeAgainst(res, { pos: "BB", action: "bet", to: 2 } as Parameters<typeof gradeAgainst>[1], basis)!.grade;
    // (0.12bb given up, 2.2% of the pot; 0.01bb past the 0.11bb of two steps: an Inaccuracy, not the Mistake it was)
    expect(seen(drill)).toEqual({ verdict: "Inaccuracy", capped: false, loss: 0.12, counted: 0.01 });
    expect(seen(practice)).toEqual(seen(drill));
    expect(seen(analyze)).toEqual(seen(drill));
  });
});

describe("a library flop facing a bet, on every surface that reads it", () => {
  // BB 3-bets 9c9d heads-up and calls the flop: 18bb in the pot at the flop, BTN bets 6bb (stars_heads_up.txt). The stored
  // answer at BB's call: fold 15% for 0, call 0.2% for 0.40bb, raise 84.8% for 0.82bb. Calling gives up 0.42bb, 1.75% of the
  // 24bb pot. Two stored EV steps are 2% of the flop's 18bb, 0.36bb: 0.06bb past them is an Inaccuracy. On the decision's
  // 24bb pot they'd be 0.48bb and the call Correct, which is what a surface that lost the flop's pot gave.
  const HH = readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", "stars_heads_up.txt"), "utf8");
  const r = importHand(HH);
  const res: AdvisorResponse = {
    street: "flop",
    pot_bb: 24,
    to_call_bb: 6,
    precomputed: { spot: "3bp_bb_btn" },
    actions: [
      { action: "fold", freq: 0.15, ev_bb: 0 },
      { action: "call", freq: 0.002, ev_bb: 0.4 },
      { action: "raise", freq: 0.848, ev_bb: 0.82, amount_bb: 20 },
    ],
  };
  const p = provenanceOf(res, ctx);
  const mix = gradable(mixOf(res), p);
  const want = { verdict: "Inaccuracy", capped: false, loss: 0.42, counted: 0.06 };

  it("Practice reads the flop's pot off the table, and Analyze off the hand", async () => {
    expect(p.source).toBe("library");
    // (Practice, at BB's call: the table as it stands, 18bb in before the flop's bets)
    const sim = simulate(r.setup, { preflop: r.lines.preflop, flop: r.lines.flop.slice(0, 2), turn: [], river: [] }, 3);
    expect(flopPotOf(sim)).toBe(18);
    const practice = gradeMix(mix, 24, 1, practiceBasis(res, p, sim));
    expect(seen(practice)).toEqual(want);
    // (Analyze, the same decision of the imported hand)
    const d = await gradeDecision({ id: "h" }, r, "flop", 2, async () => ({ data: res, provenance: p }));
    expect(d).toMatchObject({ matched: "call", pot: 24, basis: { source: "library", flopPot: 18 } });
    expect({ verdict: d.verdict, capped: !!d.capped, loss: d.evLossBb, counted: d.past }).toEqual(want);
    // (a leak drill on the record Analyze keeps, and a Review retry of the answer kept with it)
    expect(seen(gradePick(d, 1)!)).toEqual(want);
    const kept = { ask: { via: "kept", hand: "h", decision: d.id }, provenance: p, mix, street: "flop", study: "", chose: "call", basis: d.basis, pot: 24 } as unknown as RetrySpot & { pot: number };
    expect(seen(retried(kept, keptAnswer(kept), 1, 0).grade)).toEqual(want);
  });

  it("Analyze keeps why a clear blunder wasn't capped with the decision", async () => {
    // (a live solve on a range the rules widened, calling 6bb with a hand that loses all of it: 25% of the 24bb pot)
    const lean: AdvisorResponse = { ...res, precomputed: undefined, solver: { iterations: 300, exploitability_pct: 0.3 }, widened: ["BTN"], actions: [{ action: "fold", freq: 0.998, ev_bb: 0 }, { action: "call", freq: 0.002, ev_bb: -6 }] };
    const d = await gradeDecision({ id: "h" }, r, "flop", 2, async () => ({ data: lean, provenance: provenanceOf(lean, ctx) }), 0, "all");
    expect(d).toMatchObject({ verdict: "Blunder", matched: "call", evLossBb: 6, basis: { leans: true } });
    expect(d.capped).toBeUndefined();
    expect(d.clearWhy).toMatch(/^This answer's ranges lean on the betting rules, but this gives up 24\.\d% of the pot past its noise/);
  });

  it("the drill takes it from the stored pot less the bet", () => {
    const pr = { names: ["fold", "call", "raise"], freqs: [0.15, 0.002, 0.848], evs: [0, 0.4, 0.82], pot: 24, bet: 6 } as unknown as DrillProblem;
    expect(seen(gradeDrill(pr, 1, { head: {} } as Parameters<typeof gradeDrill>[2]))).toEqual(want);
  });

  it("a Practice session's retry keeps it from the first grade, as the solver asked again doesn't say it", () => {
    const sim = simulate(r.setup, { preflop: r.lines.preflop, flop: r.lines.flop.slice(0, 2), turn: [], river: [] }, 3);
    const basis = practiceBasis(res, p, sim);
    const first = gradeMix(mix, 24, 1, basis);
    const e = { d: { street: "flop", chose: "call", grade: first, mix, pot: 24, provenance: p, study: "", basis }, state: {} } as unknown as Reviewed;
    const spot = retrySpot(e)!;
    expect(spot.basis).toEqual(basis);
    // (the answer asked again: its own basis, without the flop's pot)
    const again = { mix, pot: 24, provenance: p, basis: basisOf(p, { res }) };
    expect(seen(retried(spot, again, 1, 0).grade)).toEqual(want);
    // (without the first grade's basis, as before: the decision's pot, and a Correct the first grade wasn't)
    expect(retried({ ...spot, basis: undefined }, again, 1, 0).grade.verdict).toBe("Correct");
  });
});

describe("a PLO solve's own provenance", () => {
  const sizes = { bets: [0.75], raises: [], raiseCap: 0, allIn: false };
  const r = river({ iterations: 300, exploitability_pct: 0.25 });
  const mix = mixOf(r);
  it("grades a converged solve as every surface does, and caps one cut short of its target", () => {
    const done = basisOf(ploRiverProvenance({ stop: "target", iterations: 400, seconds: 3, exploitabilityPct: 0.25, targetPct: 0.3, sizes }));
    expect(done).toMatchObject({ source: "plo-river", exploitabilityPct: 0.25, iterations: 400 });
    expect(seen(gradeAt(ploNode(r), 0, 1, 20, done))).toEqual(seen(gradeMix(mix, 20, 1, done)));
    expect(seen(gradeAt(ploNode(r), 0, 1, 20, done))).toEqual({ verdict: "Mistake", capped: false, loss: 0.9, counted: 0.8 });
    const short = basisOf(ploRiverProvenance({ stop: "time", iterations: 90, seconds: 10, exploitabilityPct: 0.6, targetPct: 0.3, sizes }));
    expect(short).toMatchObject({ approximate: true });
    const g = gradeAt(ploNode(r), 0, 1, 20, short);
    expect(seen(g)).toEqual(seen(gradeMix(mix, 20, 1, short)));
    expect(g).toMatchObject({ verdict: "Inaccuracy", capped: true });
  });
});
