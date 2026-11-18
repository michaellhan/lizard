// One answer, one pick, every surface that grades it: Practice, the live drill, a Review retry (asked again or kept),
// Analyze, a leak drill, the preflop drill and PLO all grade through gradeAnswer on the same basis, so they give the same
// verdict, the same EV as measured and the same count for the score. (The grading audit of 2026-11-18 found five
// surfaces giving three verdicts for one answer: docs/ACCURACY.md section 27.)
import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/data/db";
import type { ResultNode } from "@/engine/plo/river/run";
import { gradeAgainst } from "@/features/analyze/grading";
import { gradePick } from "@/features/analyze/leakDrill";
import { gradeDrill, type DrillProblem } from "@/features/practice/drills";
import { gradeLive, readLive } from "@/features/practice/liveDeal";
import { gradable, gradeMix, mixOf } from "@/features/practice/practice";
import { gradeAt } from "@/features/plo/drill";
import { retried, type RetrySpot } from "@/features/review/mistakes";
import { keptAnswer } from "@/features/review/retry";
import type { AdvisorResponse } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
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

/** Every surface's grade of pick `i`, by name; a surface that refuses the answer is left out. */
function everyGrade(r: AdvisorResponse, i: number): Record<string, Grade> {
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
  out.plo = gradeAt(ploNode(r), 0, i, pot, basis);
  return out;
}

/** What a player sees of a grade: the verdict, whether it was capped, the EV as measured, and what the score counts. */
const seen = (g: Grade) => ({ verdict: g.verdict, capped: !!g.capped, loss: Math.round(g.loss * 100) / 100, counted: Math.round(scored(g).loss * 100) / 100 });

const CASES: [string, AdvisorResponse, string, number][] = [
  // (noise: twice 0.25% of the pot, or the 0.5% floor: 0.1bb; 0.8bb past it is 4.0% of the pot)
  ["a converged live solve", river({ iterations: 300, exploitability_pct: 0.25 }), "Mistake", 8],
  // (a solve 5% from equilibrium can't tell 2bb apart: 0.9bb is within its noise)
  ["a fair live solve", river({ iterations: 300, exploitability_pct: 5 }), "Correct", 8],
  // (short of its target: it can't condemn a line)
  ["a solve short of its target", river({ iterations: 90, exploitability_pct: 0.4, approximate: true }), "Inaccuracy", 8],
  // (an opponent's rare line read by the betting rules: the live drill refuses it, every other surface caps it)
  ["ranges from the betting rules", river({ iterations: 300, exploitability_pct: 0.25 }, { off_solution: [{ street: "turn", pos: "BTN", why: "rare", action: "bet 33%", share: 1.2 }], widened: ["BTN"] }), "Inaccuracy", 7],
];

describe("one decision, every surface", () => {
  it.each(CASES)("%s: the same verdict, loss and count everywhere", (_name, r, verdict, surfaces) => {
    const all = everyGrade(r, 1);
    expect(Object.keys(all)).toHaveLength(surfaces);
    const first = seen(all.practice!);
    expect(first.verdict).toBe(verdict);
    expect(first.loss).toBe(0.9);
    for (const [surface, g] of Object.entries(all)) expect({ surface, ...seen(g) }).toEqual({ surface, ...first });
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
