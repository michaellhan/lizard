// What a surface knows of an answer, put the way its grade reads it (grade.ts AnswerBasis): every surface builds its
// basis here from the answer's provenance, so one answer grades the same in Practice, a drill, Review and Analyze.
import type { AdvisorResponse } from "@/solver/protocol";
import { leansOnRules } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import type { AnswerBasis } from "./grade";

/** The provenance fields a grade reads; a kept record may carry only some of them. */
export type BasisProvenance = Pick<Provenance, "source"> & Partial<Pick<Provenance, "band" | "exploitabilityPct" | "partial" | "approximate" | "leansOnRules" | "iterations">>;

/** What the answer's provenance tells its grade: its source, band and measured distance from equilibrium, its iterations
 * (which size a rough EV's error), whether it was cut short or is approximate, and whether its ranges lean on the betting
 * rules: provenance.ts leansOnRules, the one test of it, which the provenance keeps as `leansOnRules` and the answer
 * itself (`res`) is read by where its provenance wasn't derived from it. (A narrowing solve followed half or more is said
 * in the provenance's rangesOff but doesn't lean.) `more` adds what the provenance doesn't hold: the actions with rough
 * EVs, the flop library's starting pot, a kept noise. */
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
  if (leans) b.leans = true;
  return b;
}

/** Per action, whether the engine marked its EV rough (advisor.py rough_ev; practice.ts mixOf carries it as `rough`). */
export const roughOf = (mix: readonly { rough?: boolean }[]): boolean[] => mix.map((x) => x.rough === true);
