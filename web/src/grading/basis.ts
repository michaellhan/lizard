// What a surface knows of an answer, put the way its grade reads it (grade.ts AnswerBasis): every surface builds its
// basis here from the answer's provenance, so one answer grades the same in Practice, a drill, Review and Analyze.
import type { AdvisorResponse } from "@/solver/protocol";
import { leansOnRules } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import type { AnswerBasis } from "./grade";

/** The provenance fields a grade reads; a kept record may carry only some of them. */
export type BasisProvenance = Pick<Provenance, "source"> & Partial<Pick<Provenance, "band" | "exploitabilityPct" | "partial" | "approximate" | "leansOnRules" | "iterations" | "approximateReason">>;

/** What the answer's provenance tells its grade: its source, band and measured distance from equilibrium, its iterations
 * (which size a rough EV's error), whether it was cut short or is approximate, and whether its ranges lean on the betting
 * rules: provenance.ts leansOnRules, the one test of it, which the provenance keeps as `leansOnRules` and the answer
 * itself (`res`) is read by where its provenance wasn't derived from it. (A narrowing solve followed half or more is said
 * in the provenance's rangesOff but doesn't lean.) `more` adds what the provenance doesn't hold: the actions with rough
 * EVs, the flop library's starting pot, a kept noise; and for the preflop solve, the table's size its answer gives. */
export function basisOf(p: BasisProvenance | null | undefined, more: Omit<AnswerBasis, "source"> & { res?: AdvisorResponse } = {}): AnswerBasis {
  const { res, ...rest } = more;
  const leans = rest.leans || p?.leansOnRules === true || (res ? leansOnRules(res) : false);
  if (!p) return { ...rest, ...(leans ? { leans: true } : {}) };
  const b: AnswerBasis = { source: p.source, ...rest };
  if (p.band !== undefined) b.band = p.band;
  if (typeof p.exploitabilityPct === "number") b.exploitabilityPct = p.exploitabilityPct;
  if (typeof p.iterations === "number" && b.iterations === undefined) b.iterations = p.iterations;
  if (p.partial) b.partial = true;
  if (p.approximate) b.approximate = true;
  if (p.approximateReason) b.approximateReason = p.approximateReason;
  if (leans) b.leans = true;
  // (the preflop solve's table size: heads-up, it can't condemn a line deeper than 20bb: grade.ts HEADS_UP_PF)
  if (p.source === "preflop-solve" && b.players === undefined && typeof res?.players === "number") b.players = res.players;
  if (p.source === "preflop-solve" && b.depth === undefined && b.players === 2 && res) {
    const d = headsUpDepth(res);
    if (d !== undefined) b.depth = d;
  }
  return b;
}

/** A heads-up cash preflop solve's depth, bb, from its node: the actor's stack behind plus half the pot left after the
 * call faced (each has put in half of it), which is the table's stack, antes included. A tournament's (`pf_icm`), whose
 * stacks differ, has none. */
export function headsUpDepth(res: Pick<AdvisorResponse, "pot_bb" | "to_call_bb"> & { stack_bb?: unknown; pf_icm?: unknown }): number | undefined {
  const { stack_bb: s, pot_bb: pot, to_call_bb: call } = res;
  if (res.pf_icm === true || typeof s !== "number" || typeof pot !== "number" || typeof call !== "number") return undefined;
  const d = s + (pot - call) / 2;
  return Number.isFinite(d) ? Math.round(d * 100) / 100 : undefined;
}

/** Per action, whether the engine marked its EV rough (advisor.py rough_ev; practice.ts mixOf carries it as `rough`). */
export const roughOf = (mix: readonly { rough?: boolean }[]): boolean[] => mix.map((x) => x.rough === true);
