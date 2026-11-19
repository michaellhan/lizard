// What a surface knows of an answer, put the way its grade reads it (grade.ts AnswerBasis): every surface builds its
// basis here from the answer's provenance, so one answer grades the same in Practice, a drill, Review and Analyze.
import type { AdvisorResponse } from "@/solver/protocol";
import { leansOnRules } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import { CHART_SOURCES, type AnswerBasis } from "./grade";

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
  // (the preflop solve's table size: heads-up, it can't condemn a line: grade.ts HEADS_UP_PF)
  if (p.source === "preflop-solve" && b.players === undefined && typeof res?.players === "number") b.players = res.players;
  // (the charts' frequency of each move, where pfGrade.ts read the solve at a spot the charts answer: a move they play 10%
  // or more the solve can't condemn, grade.ts CHART_PARTS)
  if (p.source === "preflop-solve" && b.chart === undefined && CHART_SOURCES.has(typeof res?.chart_source === "string" ? res.chart_source : "charts")) {
    const chart = chartFreqsOf(res);
    if (chart) b.chart = chart;
    if (chart && b.chartSource === undefined && typeof res?.chart_source === "string") b.chartSource = res.chart_source;
  }
  return b;
}

/** The charts' frequency of each of an answer's actions (pfGrade.ts stamps `chart_freq` on the solve's answer as your
 * options), null for a move they don't have; null where none is stamped. */
export function chartFreqsOf(res: AdvisorResponse | null | undefined): (number | null)[] | null {
  const acts = res && !res.error && Array.isArray(res.actions) ? res.actions : [];
  const c = acts.map((a) => (typeof a.chart_freq === "number" && Number.isFinite(a.chart_freq) && a.chart_freq >= 0 && a.chart_freq <= 1 ? a.chart_freq : null));
  return c.some((x) => x !== null) ? c : null;
}

/** Per action, whether the engine marked its EV rough (advisor.py rough_ev; practice.ts mixOf carries it as `rough`). */
export const roughOf = (mix: readonly { rough?: boolean }[]): boolean[] => mix.map((x) => x.rough === true);
