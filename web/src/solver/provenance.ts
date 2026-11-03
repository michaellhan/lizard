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

/** The Advisor's top-level `approximate` ({source, label}): an answer read at once, before or instead of a solve. */
function approximateOf(r: AdvisorResponse): { source?: string; label?: string } | null {
  const a = r.approximate;
  return a && typeof a === "object" ? (a as { source?: string; label?: string }) : null;
}

/** Read from the flop library's stored turn strategies: the Advisor marks these approximate {source: "store"} (an
 * answer at once) or top-level source "store" (Study's runouts). Not solver.by "the flop library": Advisor._study_near
 * sets that too, on a flop read off the nearest stored flops. */
function isStoredTurn(r: AdvisorResponse): boolean {
  return approximateOf(r)?.source === "store" || r.source === "store";
}

export function sourceOf(r: AdvisorResponse): ResultSource {
  if (r.fallback) return FALLBACK_SOURCES[r.fallback] ?? "rules";
  if (r.precomputed) return "library";
  if (isStoredTurn(r)) return "library-turn";
  if (typeof r.pf_solve === "object" || r.study === "pf_progress") return "preflop-solve";
  if (r.street === "preflop") return "charts";
  // approximate {source}: "solve" is a live solve stopped at a look, or one cut to fit Quick (advisor.py _study_look,
  // _mw_look, the instant sources); "near", "prev", "unraked", "offtree" are reads of other solutions: an answer at once
  const approx = approximateOf(r);
  if (approx) return approx.source === "solve" ? "live" : "instant";
  // 5+ players on the flop or turn: a Monte Carlo heuristic, not a solve (3-way and 4+ way rivers say solved: true)
  if (r.multiway && !r.solved && !r.solver) return "rules";
  if (r.solver && typeof r.solver.iterations === "number" && r.solver.iterations > 0) return "live";
  return "unknown";
}

export function provenanceOf(r: AdvisorResponse, ctx: ProvenanceContext): Provenance {
  const source = sourceOf(r);
  const approx = approximateOf(r);
  // a stored turn's or an answer at once's solver numbers are another solve's (the flop entry, the previous street's
  // solve), which do not describe this answer: not shown. The Advisor's label says what it was read from.
  const sv = source === "library-turn" || source === "instant" ? {} : (r.solver ?? {});
  const p: Provenance = {
    source,
    approximate:
      Boolean(sv.approximate) ||
      Boolean(approx) ||
      source === "rules" ||
      source === "equity" ||
      source === "library-turn" ||
      source === "instant" ||
      ctx.partial,
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
  if (typeof approx?.label === "string") p.approximateLabel = approx.label;
  return p;
}

const LABELS: Record<ResultSource, string> = {
  library: "Precomputed solution",
  "library-turn": "Stored turn from the flop library",
  instant: "Answer at once",
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
  if (p.approximateLabel && p.source !== "library-turn") parts.push(p.approximateLabel);
  if (p.exploitabilityPct !== undefined) parts.push(`${p.exploitabilityPct.toFixed(2)}% pot from equilibrium`);
  if (p.iterations !== undefined) parts.push(`${p.iterations} iterations`);
  if (p.partial) parts.push("in progress");
  else if (p.approximate) parts.push("approximate");
  return parts.join(" · ");
}
