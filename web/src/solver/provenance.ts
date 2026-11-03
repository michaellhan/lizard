// Derive an answer's provenance from the Advisor's response. The rule: never present a number without saying
// what produced it (library / live solve / charts / heuristic rules) and how close to equilibrium it is.
import type { AdvisorResponse } from "./protocol";
import type { Provenance, ResultSource, SolveMode, TransportKind } from "./types";

export interface ProvenanceContext {
  mode: SolveMode;
  transport: TransportKind;
  solverVersion: string;
  partial: boolean;
  now?: number;
}

const FALLBACK_SOURCES: Record<string, ResultSource> = {
  rules: "rules",
  chart: "charts",
  charts: "charts",
  equity: "equity",
};

export function sourceOf(r: AdvisorResponse): ResultSource {
  if (r.fallback) return FALLBACK_SOURCES[r.fallback] ?? "rules";
  if (r.precomputed) return "library";
  if (typeof r.pf_solve === "object" || r.study === "pf_progress") return "preflop-solve";
  if (r.street === "preflop") return "charts";
  if (r.solver && typeof r.solver.iterations === "number" && r.solver.iterations > 0) return "live";
  return "unknown";
}

export function provenanceOf(r: AdvisorResponse, ctx: ProvenanceContext): Provenance {
  const source = sourceOf(r);
  const sv = r.solver ?? {};
  const p: Provenance = {
    source,
    approximate: Boolean(sv.approximate) || source === "rules" || source === "equity" || ctx.partial,
    mode: ctx.mode,
    transport: ctx.transport,
    solverVersion: ctx.solverVersion,
    partial: ctx.partial,
    receivedAt: ctx.now ?? Date.now(),
  };
  if (typeof sv.exploitability_pct === "number") p.exploitabilityPct = sv.exploitability_pct;
  if (typeof sv.target_pct === "number") p.targetPct = sv.target_pct;
  if (typeof sv.iterations === "number") p.iterations = sv.iterations;
  const secs =
    typeof sv.seconds === "number" ? sv.seconds : typeof sv.solve_seconds === "number" ? sv.solve_seconds : r.seconds;
  if (typeof secs === "number") p.seconds = secs;
  if (r.precomputed && typeof r.precomputed.spot === "string") p.librarySpot = r.precomputed.spot;
  if (typeof r.fallback_reason === "string") p.fallbackReason = r.fallback_reason;
  return p;
}

const LABELS: Record<ResultSource, string> = {
  library: "Precomputed solution",
  live: "Live solve",
  charts: "Preflop charts",
  "preflop-solve": "Preflop solve",
  rules: "Heuristic rules (not a solve)",
  equity: "Equity estimate (not a solve)",
  unknown: "Unlabelled",
};

export function describe(p: Provenance): string {
  const parts = [LABELS[p.source]];
  if (p.librarySpot) parts.push(p.librarySpot);
  if (p.exploitabilityPct !== undefined) parts.push(`${p.exploitabilityPct.toFixed(2)}% pot from equilibrium`);
  if (p.iterations !== undefined) parts.push(`${p.iterations} iterations`);
  if (p.partial) parts.push("in progress");
  else if (p.approximate) parts.push("approximate");
  return parts.join(" · ");
}
