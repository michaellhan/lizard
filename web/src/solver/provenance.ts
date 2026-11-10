// Derive an answer's provenance from the Advisor's response. The rule: never present a number without saying
// what produced it (library / live solve / charts / heuristic rules) and how close to equilibrium it is.
import { describeLock, type Lock } from "@/features/study/locks";
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

const said = (r: AdvisorResponse, s: string) => (r.notes ?? []).some((n) => n.includes(s));
/** a seat's own all-in from the push/fold equilibrium (advisor.py _push) */
const OWN_JAM = "all-in, range from the push/fold equilibrium";

/** The answer's action names: a node of Study's has them as words. */
const actionNames = (r: AdvisorResponse) => (Array.isArray(r.actions) ? (r.actions as unknown[]) : []).map((a) => (typeof a === "string" ? a : (a as { action?: string }).action));

/** The chart with a raise the push/fold equilibrium has made an all-in: it still calls by the chart, so it's the chart's
 * answer with one action from the model. */
const chartWithJam = (r: AdvisorResponse) => said(r, OWN_JAM) && actionNames(r).includes("call");

/** At 12bb or less a first-in hand jams or folds from the push/fold equilibrium (_push), and a call of a jam from such a
 * range is priced by equity against it (_vs_jam). Neither is a chart, a solve of the game, or an EV. */
const isPushFold = (r: AdvisorResponse) =>
  (said(r, OWN_JAM) && !chartWithJam(r)) || (said(r, "facing an all-in, call when equity beats the pot odds") && said(r, "jam range: push/fold equilibrium"));

export function sourceOf(r: AdvisorResponse): ResultSource {
  if (r.node_lock || r.study === "nodelock_progress") return "node-lock";
  if (r.fallback) return FALLBACK_SOURCES[r.fallback] ?? "rules";
  if (r.precomputed) return "library";
  if (isStoredTurn(r)) return "library-turn";
  if (typeof r.pf_solve === "object" || r.study === "pf_progress") return "preflop-solve";
  if (r.street === "preflop") return isPushFold(r) ? "push-fold" : "charts";
  // approximate {source}: "solve" with no solver.by is this street's own solve stopped at a look (advisor.py
  // _study_look) or one cut to fit Quick; "solve" with solver.by is a read of an earlier decision's solve on this
  // street (_study_mw_prev), and "near", "prev", "unraked", "offtree" are reads of other solutions: answers at once, as
  // is a triage read marked "approx" (Advisor.instant on the street's own solve: a mix and no EVs, nothing solved for it)
  const approx = approximateOf(r);
  if (approx) return approx.source === "solve" && !r.solver?.by && r.triage?.source !== "approx" ? "live" : "instant";
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

/** advisor.py's notes on how an earlier street narrowed the ranges this answer starts from, when it wasn't (only) a
 * settled solve. An earlier street's narrowing solve runs on a time budget, so on a slow or busy device it stops short and
 * the ranges lean on the rules, by how short: the same spot then gives different ranges from one run to the next (a
 * heads-up river's SB: 247 combos behind a flop narrowing at 55 iterations, 118-126 behind settled ones). */
const UNSETTLED_NOTE = /^(\w+): the solve that narrows ranges is ([\d.]+)% of the pot from equilibrium \((\d+) iterations\), so ranges follow it (\d+)%/;
const RULES_NOTE = /^(\w+): ranges narrowed by simple betting rules/;
const MW_RULES_NOTE = /^([\w, ]+): multiway, ranges narrowed by simple betting rules/;

/** The ranges behind an answer in words, where an earlier street narrowed them by the betting rules in part or whole;
 * null where every earlier street was solved and settled (or there was none). */
export function rangesOffOf(r: AdvisorResponse): string | null {
  const out: string[] = [];
  for (const n of r.notes ?? []) {
    const u = UNSETTLED_NOTE.exec(n);
    const rules = RULES_NOTE.exec(n) ?? MW_RULES_NOTE.exec(n);
    if (u) out.push(`the ${u[1]}'s narrowing solve stopped ${u[2]}% of the pot from equilibrium after ${u[3]} iterations on its time budget, so the ranges follow it ${u[4]}% and the betting rules the rest, and can differ from run to run`);
    else if (rules) out.push(`ranges through the ${rules[1]} from the betting rules, not a solve`);
  }
  return out.length ? out.join("; ") : null;
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
      source === "push-fold" ||
      source === "rules" ||
      source === "equity" ||
      source === "library-turn" ||
      source === "instant" ||
      ctx.partial,
    // (a triage solve is Quick whatever the request's budgets said: Advisor.triage sets its own)
    mode: r.triage?.source === "quick" ? "quick" : ctx.mode,
    transport: ctx.transport,
    solverVersion: ctx.solverVersion,
    partial: ctx.partial,
    receivedAt: ctx.now ?? Date.now(),
  };
  if (r.triage?.confidence) p.confidence = r.triage.confidence;
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
  // ranges entering this street that are partly or wholly the betting rules: the answer stands on them, so it's approximate
  const off = rangesOffOf(r);
  if (off && source !== "rules" && source !== "charts" && source !== "push-fold") {
    p.approximate = true;
    p.approximateLabel = p.approximateLabel ? `${p.approximateLabel}; ${off}` : off;
  }
  // a true node lock (engine/study_lock.py): the lock in words and what the tree it's solved on abstracts
  if (r.node_lock) {
    p.lock = [r.node_lock.words, ...(r.node_lock.also ?? []).map((x) => x.words)].join("; ");
    p.view = `${r.node_lock.abstraction} ${r.node_lock.scope}`;
  }
  // a lock's answer is the best response to it, on the solve (advisor.py _advise_at, "locked": {seat: {key: number}})
  const locked = r.locked && typeof r.locked === "object" ? Object.entries(r.locked as Record<string, Lock>) : [];
  // (preflop, on the charts' strategy: in the preflop words)
  if (locked.length) {
    p.lock = `best response to ${locked.map(([seat, l]) => `${seat} ${describeLock(l, r.street === "preflop")}`).join("; ")}, not an equilibrium re-solve`;
    // (advisor.py `villain_range_combos`, `widened`: a line the read rarely reaches can leave few combos, or the rules' value hands)
    const combos = typeof r.villain_range_combos === "number" ? `against ${r.villain_range_combos.toFixed(1)} combos as the read leaves them` : "";
    const added = Array.isArray(r.widened) && r.widened.length ? "their range is the solve's with the rules' value hands added" : "";
    if (combos || added) p.lockRange = [combos, added].filter(Boolean).join(", ");
  }
  // optimize_sizes (advisor.py _optimize_sizes): the sizes this answer bets were picked by a first, shorter solve of the
  // street over a wide menu, whose distance from equilibrium isn't reported; the figures below are the second solve's
  if (Array.isArray(r.sizes_kept) && r.sizes_kept.length)
    p.sizing = `${r.street ?? "street"} bet sizes ${(r.sizes_kept as string[]).join(", ")} chosen by a first solve over a wide menu (one street deep, one raise)`;
  if (source === "preflop-solve") preflopSolveOf(r, p);
  const tm = tournamentModelOf(r, source);
  if (tm) {
    p.tournament = tm;
    const evIn = evInOf(r, source);
    if (evIn) p.evIn = evIn;
  }
  // a chip answer from the push/fold model: which part of it, so it isn't read as a chart's mix, nor taken for another
  // model beside a tournament's push/fold (chips: pf_classes._fictitious_play, callers alike and one of them calling)
  else if (source === "push-fold") p.view = said(r, OWN_JAM) ? "jam-or-fold equilibrium in chips, by hand class, one caller assumed" : "a call priced by equity against the jam's push/fold range";
  else if (source === "charts" && said(r, OWN_JAM)) p.view = "the chart, its all-in from the push/fold equilibrium in chips";
  return p;
}

/** A preflop solve's node (pf_study.Solve.node): its distance in mbb/hand a seat, where its solve came from, and
 * approximate while the solve isn't finished or on a line it rarely or never plays (its "rough"). */
function preflopSolveOf(r: AdvisorResponse, p: Provenance): void {
  const st = (typeof r.pf_solve === "object" && r.pf_solve ? r.pf_solve : {}) as { mbb?: unknown; done?: unknown; stored?: unknown; cached?: unknown };
  if (typeof st.mbb === "number") p.mbbPerHand = st.mbb;
  if (st.cached) p.view = "solved earlier in this browser";
  else if (st.stored) p.view = "precomputed";
  if (r.study !== "node") return;
  if (!st.done) {
    p.approximate = true;
    p.approximateLabel = "the solve isn't finished: the numbers can still move";
  } else if (r.rough) {
    p.approximate = true;
    p.approximateLabel = `a line the solve rarely plays (the range gives up ${typeof r.regret_bb === "number" ? r.regret_bb.toFixed(3) : "?"}bb a hand to its best actions here): rough`;
  }
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
      : source === "charts" || source === "push-fold"
        ? chartWithJam(r)
          ? "chip chart with a risk premium, its all-in from the push/fold equilibrium in prize equity"
          : has(OWN_JAM)
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

/** What a tournament answer's EVs are in. A solve's are chips worth as much prize equity (icm.Model.value), on another
 * base from chips won; a fallback's are its own chips. Bounties with no payouts are priced in chips, as a cash answer's. */
function evInOf(r: AdvisorResponse, source: ResultSource): Provenance["evIn"] {
  const note = (r.tournament as { note?: unknown } | undefined)?.note;
  if (typeof note === "string" && note.startsWith("tournament: no payouts")) return undefined;
  return source === "rules" || source === "equity" || source === "unknown" ? "chips" : "prize";
}

/** What an EV shown under this provenance is in, as it follows a number: "0.40bb", "0.40bb of prize equity". */
export const PRIZE_UNIT = "bb of prize equity";
export const evUnit = (p: Pick<Provenance, "evIn"> | null | undefined) => (p?.evIn === "prize" ? PRIZE_UNIT : "bb");

const LABELS: Record<ResultSource, string> = {
  library: "Precomputed solution",
  "library-turn": "Stored turn from the flop library",
  instant: "Answer at once",
  live: "Live solve",
  charts: "Preflop charts",
  "preflop-solve": "Preflop solve (class-level model)",
  "push-fold": "Push/fold model (not a solve)",
  "best-response": "Exploiting an assumed profile (best response, not a solve)",
  "node-lock": "Node-locked equilibrium of the restricted game, not the unlocked equilibrium",
  "plo-river": "Heads-up PLO4 solve of every combo from the street typed (a river, or a turn and every river after it): earlier streets aren't solved",
  rules: "Heuristic rules (not a solve)",
  equity: "Equity estimate (not a solve)",
  unknown: "Unlabelled",
};

/** What answered, in words ("Live solve", "Preflop charts"…). */
export const sourceLabel = (s: ResultSource): string => LABELS[s];

/** The bubble factor table's numbers (features/tournaments/icm.ts): no answer's, but the page's own port of the
 * engine's prize model, run on the setup (so an answer's own bubble factors are its row). */
export const ICM_TABLE_LABEL = "ICM (Malmuth-Harville), worked out in this page from the setup with the engine's prize model";

/** A kept line stands as what was said at the time: `describe` wrote it, so it opens with its source's words, and whatever
 * says otherwise didn't come from a grade. The charts are always said from here, so a restored record can't call them
 * anything else. (Its `transport` tells nothing: a decision with a build stamp is kept as "worker", for its version.) */
const keptWords = (p: Provenance) => (p.keptLabel && p.source !== "charts" && p.keptLabel.startsWith(LABELS[p.source]) ? p.keptLabel : null);

export function describe(p: Provenance): string {
  const kept = keptWords(p);
  if (kept) return kept;
  const parts = [p.source === "live" && p.mode === "quick" ? `${LABELS.live} (Quick)` : LABELS[p.source]];
  if (p.exploit) parts.push(p.exploit);
  if (p.lock) parts.push(p.lock);
  if (p.lockRange) parts.push(p.lockRange);
  if (p.sizing) parts.push(p.sizing);
  if (p.librarySpot) parts.push(p.librarySpot);
  if (p.view) parts.push(p.view);
  if (p.tournament) parts.push(p.tournament);
  if (p.approximateLabel) parts.push(p.approximateLabel);
  // measured in the game the solver played (its bet menu and buckets), not the full game; for 3- and 4-way answers the
  // figure is the players' mean best-response gain (advisor.py), not a two-player exploitability
  if (p.exploitabilityPct !== undefined) {
    const what = p.multiway ? "mean best-response gain" : "from equilibrium";
    const band = p.band ? ` (${p.band}${p.band === "approximate" && p.targetPct !== undefined ? `, target ${p.targetPct}%` : ""})` : "";
    // (a best response to an assumed profile is never "solved": this figure is the equilibrium solve under it, on ranges the profile reshaped)
    if (p.source === "node-lock") parts.push(`${p.exploitabilityPct.toFixed(2)}% pot exploitable in the restricted game, each player's best response keeping their own locks${band}`);
    else parts.push(p.source === "best-response" ? `${p.exploitabilityPct.toFixed(2)}% pot from equilibrium in the solve it's laid on${band}` : `${p.exploitabilityPct.toFixed(2)}% pot ${what} in the solved game${band}`);
  }
  if (p.mbbPerHand !== undefined) parts.push(`${p.mbbPerHand.toFixed(2)} mbb/hand from equilibrium (a seat's average)`);
  if (p.iterations !== undefined) parts.push(`${p.iterations} iterations`);
  if (p.partial) parts.push(p.stopped ? "partial, stopped before it finished" : "in progress");
  else if (p.approximate) parts.push("approximate");
  if (p.confidence) parts.push(`${p.confidence} confidence`);
  return parts.join(" · ");
}

/** A PLO4 river's provenance (engine/plo/river/): exact on the tree it's given, so it says that tree, how far the solve got
 * and that nothing before the river is solved; the ranges are the reader's own, no solve's. A solve stopped short of its
 * target is approximate, however close it got. The figure is measured by an exact best response on that tree. */
const sizesWords = (s: { bets: readonly number[]; raises: readonly number[]; raiseCap: number; allIn: boolean }) => {
  const list = (xs: readonly number[]) => xs.map((x) => `${x}%`).join(", ") || "none";
  return `bets ${list(s.bets)} of the pot, raises ${list(s.raises)}, up to ${s.raiseCap} raise${s.raiseCap === 1 ? "" : "s"}${s.allIn ? ", all-in where the limit allows" : ""}`;
};

export function ploRiverProvenance(r: {
  stop: "target" | "time" | "iterations" | "cancelled";
  iterations: number;
  seconds: number;
  exploitabilityPct: number;
  targetPct: number;
  sizes: { bets: readonly number[]; raises: readonly number[]; raiseCap: number; allIn: boolean };
  /** a turn's: its river sizes and the river cards solved */
  turn?: { riverSizes: { bets: readonly number[]; raises: readonly number[]; raiseCap: number; allIn: boolean }; rivers: number };
  now?: number;
}): Provenance {
  const short = r.stop !== "target";
  const label = { time: "the time budget ran out", iterations: "the iteration limit came first", cancelled: "cancelled", target: "" }[r.stop];
  return {
    source: "plo-river",
    approximate: short,
    exploitabilityPct: r.exploitabilityPct,
    targetPct: r.targetPct,
    band: bandOf(r.exploitabilityPct, short),
    iterations: r.iterations,
    seconds: r.seconds,
    view: r.turn
      ? `a turn and its ${r.turn.rivers} river cards from the ranges typed, the turn at ${sizesWords(r.sizes)}, every river at ${sizesWords(r.turn.riverSizes)}, no rake`
      : `from the ranges typed, at ${sizesWords(r.sizes)}, no rake`,
    ...(short ? { approximateLabel: `short of its target: ${label}` } : {}),
    mode: "accurate",
    transport: "worker",
    solverVersion: r.turn ? "Lizard PLO turn and river, discounted CFR in TypeScript" : "Lizard PLO river, discounted CFR in TypeScript",
    partial: false,
    receivedAt: r.now ?? Date.now(),
  };
}

/** The one-size view's badge (ROADMAP Phase 8): every row is a live solve of the street from the decision at Fast, so
 * the badge names how many are in, and the widest distance from equilibrium among them (a tie's tolerance). */
export function oneSizeProvenance(
  rows: readonly { exploitability_pct?: number }[],
  base: Pick<Provenance, "transport" | "solverVersion" | "receivedAt"> | null,
  opts: { total: number; done: boolean; targetPct?: number; seconds?: number },
): Provenance {
  const expl = rows.map((r) => r.exploitability_pct).filter((x): x is number => typeof x === "number");
  const p: Provenance = {
    source: "live",
    approximate: false,
    mode: "fast",
    transport: base?.transport ?? "worker",
    solverVersion: base?.solverVersion ?? "",
    partial: !opts.done,
    receivedAt: base?.receivedAt ?? Date.now(),
    view: `one-size view, ${rows.length} of ${opts.total} solves at Fast${expl.length > 1 ? " (the widest's distance shown)" : ""}`,
  };
  if (expl.length) {
    p.exploitabilityPct = Math.max(...expl);
    p.band = bandOf(p.exploitabilityPct, false);
  }
  if (opts.targetPct !== undefined) p.targetPct = opts.targetPct;
  if (opts.seconds !== undefined) p.seconds = opts.seconds;
  return p;
}
