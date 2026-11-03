// Derive an answer's provenance from the Advisor's response. The rule: never present a number without saying
// what produced it (library / live solve / charts / heuristic rules) and how close to equilibrium it is.
import type { AdvisorResponse } from "./protocol";
import type { ConvergenceBand, Provenance, ResultSource, SolveMode, TransportKind } from "./types";

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
  // approximate {source}: "solve" with no solver.by is this street's own solve stopped at a look (advisor.py
  // _study_look) or one cut to fit Quick; "solve" with solver.by is a read of an earlier decision's solve on this
  // street (_study_mw_prev), and "near", "prev", "unraked", "offtree" are reads of other solutions: answers at once
  const approx = approximateOf(r);
  if (approx) return approx.source === "solve" && !r.solver?.by ? "live" : "instant";
  // 5+ players on the flop or turn: a Monte Carlo heuristic, not a solve (3-way and 4+ way rivers say solved: true)
  if (r.multiway && !r.solved && !r.solver) return "rules";
  if (r.solver && typeof r.solver.iterations === "number" && r.solver.iterations > 0) return "live";
  return "unknown";
}

/** A borrowed library spot's description ("" when it has none), or null when the answer's spot is its own. */
function borrowedOf(r: AdvisorResponse): string | null {
  const b = r.precomputed?.borrowed;
  if (!b || typeof b !== "object") return null;
  const text = (b as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

/** Band of a measured exploitability (% of the pot), as the classic app draws it (index.html convergence()). */
export function bandOf(exploitabilityPct: number, solverApproximate = false): ConvergenceBand {
  if (solverApproximate) return "approximate";
  return exploitabilityPct < 3 ? "converged" : exploitabilityPct < 10 ? "fair" : "rough";
}

export function provenanceOf(r: AdvisorResponse, ctx: ProvenanceContext): Provenance {
  const source = sourceOf(r);
  const approx = approximateOf(r);
  // a library spot borrowed from another table size (flop_library / mw_library info().borrowed): approximate, "that
  // spot read as this one"; its exploitability is that spot's, on its own ranges
  const borrowed = borrowedOf(r);
  // a stored turn's, an answer at once's or a borrowed spot's solver numbers are another solve's (the flop entry, the
  // previous street's solve, another table's spot), which do not describe this answer: not shown. The label says what
  // it was read from.
  const sv = source === "library-turn" || source === "instant" || borrowed !== null ? {} : (r.solver ?? {});
  const p: Provenance = {
    source,
    approximate:
      Boolean(sv.approximate) ||
      Boolean(approx) ||
      borrowed !== null ||
      source === "charts" ||
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
  if (typeof sv.exploitability_pct === "number") {
    p.exploitabilityPct = sv.exploitability_pct;
    p.band = bandOf(sv.exploitability_pct, Boolean(sv.approximate));
  }
  if (typeof sv.target_pct === "number") p.targetPct = sv.target_pct;
  if (typeof sv.iterations === "number") p.iterations = sv.iterations;
  const secs =
    typeof sv.seconds === "number" ? sv.seconds : typeof sv.solve_seconds === "number" ? sv.solve_seconds : r.seconds;
  if (typeof secs === "number") p.seconds = secs;
  if (r.precomputed && typeof r.precomputed.spot === "string") p.librarySpot = r.precomputed.spot;
  if (typeof r.fallback_reason === "string") p.fallbackReason = r.fallback_reason;
  if (typeof approx?.label === "string") p.approximateLabel = approx.label;
  else if (borrowed !== null) p.approximateLabel = `another table's spot read as this one${borrowed ? ` (${borrowed})` : ""}`;
  if (r.multiway) p.multiway = true;
  const tm = tournamentModelOf(r, source);
  if (tm) p.tournament = tm;
  return p;
}

/** What a tournament answer's numbers are in (ROADMAP Phase 7), from the engine's `tournament` block and notes: a
 * postflop solve pays prize equity (the engine never reads the chip-EV library for one); preflop, your own all-in is
 * the push/fold equilibrium in prize equity, a call of a jam is priced in prize equity, and anything else is the chip
 * chart with a risk premium; a fallback plays chips. Null for an answer that isn't a tournament's. */
export function tournamentModelOf(r: AdvisorResponse, source: ResultSource): string | null {
  const t = r.tournament;
  if (!t || typeof t !== "object") return null;
  const { note, bounties } = t as { note?: unknown; bounties?: { format?: unknown } };
  const notes = r.notes ?? [];
  const has = (s: string) => notes.some((n) => n.includes(s));
  const said = typeof note === "string" ? note : "";
  const solve = said.startsWith("tournament: no payouts")
    ? "chip-EV solve with bounties (no payouts given: the prizes taken as the bounties in play)"
    : said.includes("winner-take-all")
      ? "prize-equity solve (winner takes all: chips are prizes)"
      : "prize-equity solve (ICM)";
  const what =
    source === "rules" || source === "equity"
      ? "a tournament, but the fallback plays chips"
      : source === "charts"
        ? has("all-in, range from the push/fold equilibrium")
          ? "push/fold equilibrium in prize equity"
          : has("calling needs")
            ? "a call priced in prize equity"
            : "chip chart with a risk premium"
        : solve;
  const format = bounties && typeof bounties === "object" ? bounties.format : undefined;
  // a field over icm.MAX_PLAYERS is modelled by stand-ins (icm.field_stacks, compress_payouts): the note says so
  const modelled = /\((\d+) players modelled by (\d+)\)/.exec(said);
  return [
    what,
    modelled ? `${modelled[1]} players modelled by ${modelled[2]}` : null,
    format === "mystery" ? "mystery bounties at the average envelope" : typeof format === "string" ? `${format.toUpperCase()} bounties, proportional model` : null,
  ]
    .filter(Boolean)
    .join(", ");
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

/** What answered, in words ("Live solve", "Preflop charts"…). */
export const sourceLabel = (s: ResultSource): string => LABELS[s];

export function describe(p: Provenance): string {
  const parts = [LABELS[p.source]];
  if (p.librarySpot) parts.push(p.librarySpot);
  if (p.tournament) parts.push(p.tournament);
  if (p.approximateLabel) parts.push(p.approximateLabel);
  // measured in the game the solver played (its bet menu and buckets), not the full game; for 3- and 4-way answers the
  // figure is the players' mean best-response gain (advisor.py), not a two-player exploitability
  if (p.exploitabilityPct !== undefined) {
    const what = p.multiway ? "mean best-response gain" : "from equilibrium";
    const band = p.band ? ` (${p.band}${p.band === "approximate" && p.targetPct !== undefined ? `, target ${p.targetPct}%` : ""})` : "";
    parts.push(`${p.exploitabilityPct.toFixed(2)}% pot ${what} in the solved game${band}`);
  }
  if (p.iterations !== undefined) parts.push(`${p.iterations} iterations`);
  if (p.partial) parts.push("in progress");
  else if (p.approximate) parts.push("approximate");
  return parts.join(" · ");
}
