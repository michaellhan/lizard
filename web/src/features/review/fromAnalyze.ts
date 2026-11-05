// What of Analyze comes to the review queue (schedule.ts QUEUE_RULE): a pick missed in a leak drill by itself, a graded
// decision when you add it, as a bulk import can grade hundreds below Correct. Neither from a tournament hand or an
// exploit session, as sessions.ts isEquilibriumHand has it. Such an entry keeps the mix it was graded against, so a retry
// deals the spot from the record and grades it against that same answer: nothing is asked, it stands if the hand is
// deleted, and the provenance is the grade's own, as far as a kept decision says it.
import type { DecisionRecord, HandRecord, MistakeRecord } from "@/data/db";
import { isSource, MISSES } from "@/data/mistakes";
import { canDrill, decisionIndex, gradePick, NEED } from "@/features/analyze/leakDrill";
import { isGraded } from "@/features/analyze/report";
import { studyLinkAt } from "@/features/analyze/analyze";
import { potBefore } from "@/features/analyze/grading";
import { isEquilibriumHand } from "@/features/analyze/sessions";
import { sayMove } from "@/features/practice/practice";
import { describeSetup } from "@/features/solve/setup";
import { fromSearch } from "@/features/study/studyState";
import type { Grade, Verdict } from "@/grading/grade";
import type { ReplayedHand } from "@/hh/replay";
import type { Street } from "@/poker/table";
import type { Provenance } from "@/solver/types";
import { betAmount, gameWords, gradeOf } from "./mistakes";
import { dueAfter } from "./schedule";

/** The provenance a kept decision can tell. It keeps its source, its line in words, its version, its band and confidence,
 * so a badge says what it said; the rest isn't guessed: with a build stamp the backend was the page's solver, without one
 * it isn't known. The line is the one written then. */
export function decisionProvenance(d: Pick<DecisionRecord, "source" | "label" | "version" | "approximate" | "band" | "confidence" | "triageSource" | "gradedAt">): Provenance {
  const build = d.version?.startsWith("build:") ? d.version.slice("build:".length) : "";
  const said = d.confidence && !d.label.includes("confidence");
  return {
    source: isSource(d.source) ? d.source : "unknown",
    approximate: !!d.approximate,
    mode: d.triageSource === "quick" || d.label.includes("(Quick)") ? "quick" : "fast",
    transport: build ? "worker" : "kept",
    solverVersion: build,
    partial: false,
    receivedAt: d.gradedAt,
    keptLabel: said ? `${d.label} · ${d.confidence} confidence` : d.label,
    ...(d.band ? { band: d.band } : {}),
    ...(d.confidence ? { confidence: d.confidence } : {}),
    ...(d.version?.startsWith("library:") ? { libraryVersion: d.version } : {}),
  };
}

/** Why no decision of this hand can go in the queue, in words; null where one can. */
export function handOut(hand: Pick<HandRecord, "tournament" | "importId">, exploits: ReadonlySet<string>): string | null {
  if (isEquilibriumHand(hand, exploits)) return null;
  return hand.tournament !== undefined ? "A tournament hand stays out of the review queue: its chips aren't bb won, and it's graded with no ICM." : "A hand from an exploit session stays out of the review queue: it was graded against a best response to an assumed profile, not an equilibrium.";
}

/** Why this graded decision can't be dealt again, in words; null where it can. */
export function decisionOut(d: DecisionRecord): string | null {
  if (canDrill(d)) return null;
  return d.mix?.length ? "its EVs have no pot kept to measure a pick against" : "no mix was kept with its grade";
}

const entry = (d: DecisionRecord, hand: HandRecord, r: ReplayedHand | null, a: number, g: Grade, verdict: Verdict, from: "analyze" | "leak", sessionId: string, now: number): MistakeRecord | null => {
  const hole = hand.hole.match(/../g) ?? [];
  const street = d.street as Street;
  const i = decisionIndex(d);
  const mix = d.mix ?? [];
  const chose = mix[a]?.[0];
  if (hole.length !== 2 || chose === undefined) return null;
  const link = r ? studyLinkAt(r, street, i, hand.setup) : null;
  const study = link ? link.replace(/^\/study\?/, "") : null;
  const before = r ? r.lines[street].slice(0, i).filter((m) => m.action !== "fold") : [];
  const pot = (d.pot ?? 0) > 0 || !r ? (d.pot ?? 0) : potBefore(r, street, i);
  const rough = new Set(d.roughEvs ?? (d.roughEv && d.matched ? [d.matched] : []));
  return {
    // (the id Practice's own miss at this spot has, and the same line and cards in another hand: one entry a spot)
    id: study ? `hand|${study}|${hand.hero}|${[...hole].sort().join("")}` : `analyze|${d.id}`,
    from,
    sessionId,
    street,
    at: now,
    lastAt: now,
    updatedAt: now,
    times: 1,
    seat: d.pos,
    players: hand.players,
    game: r ? [gameWords(hand.players, Math.round(r.hand.effective * 100) / 100), ...describeSetup(study ? fromSearch(study)?.setup : undefined)].join(" · ") : `${hand.players === 2 ? "HU" : `${hand.players}-max`} ${hand.site}`,
    hole: [hole[0]!, hole[1]!],
    board: (hand.board.match(/../g) ?? []).slice(0, NEED[street]),
    line: r ? (before.length ? before.map((m) => sayMove(m, hand.hero, hand.players)).join(", ") : street === "preflop" ? "folded to you" : "first to act") : (d.situation ?? ""),
    study,
    ask: { via: "kept", hand: hand.id, decision: d.id },
    chose,
    mix: mix.map(([action, freq, ev]) => {
      const amount = betAmount(action, pot);
      return { action, freq, ev, ...(amount !== undefined ? { amount } : {}), ...(rough.has(action) ? { rough: true as const } : {}) };
    }),
    pot,
    grade: { ...gradeOf(g), verdict },
    provenance: decisionProvenance(d),
    step: 0,
    due: dueAfter(now, 0),
    tries: [],
  };
};

/** Why a graded decision that can be dealt again still isn't an entry, in words; null where it is one. */
export function addOut(d: DecisionRecord, hand: Pick<HandRecord, "hole">): string | null {
  if ((hand.hole.match(/../g) ?? []).length !== 2) return "this hand kept no cards of yours to deal it with";
  if (!isGraded(d) || !MISSES.includes(d.verdict as Verdict)) return "it isn't graded below Correct";
  if (!(d.mix ?? []).some(([name]) => name === (d.matched ?? d.action))) return `what you played, ${d.action}, isn't one of the actions in the answer kept with its grade`;
  return null;
}

/** A decision graded below Correct as an entry, with its grade as kept; null where it isn't one or can't be dealt again. */
export function addedMistake(d: DecisionRecord, hand: HandRecord, r: ReplayedHand | null, now: number): MistakeRecord | null {
  if (!isGraded(d) || !MISSES.includes(d.verdict as Verdict) || decisionOut(d)) return null;
  const a = (d.mix ?? []).findIndex(([name]) => name === (d.matched ?? d.action));
  const g = a >= 0 ? gradePick(d, a) : null;
  return g && entry(d, hand, r, a, g, d.verdict as Verdict, "analyze", hand.importId, now);
}

/** A leak drill's pick as an entry; null where it's Best or Correct. */
export function leakMistake(d: DecisionRecord, hand: HandRecord, r: ReplayedHand | null, g: Grade, sessionId: string, now: number): MistakeRecord | null {
  return g.ok ? null : entry(d, hand, r, g.a, g, g.verdict, "leak", sessionId, now);
}
