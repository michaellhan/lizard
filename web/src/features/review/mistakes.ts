// Your mistakes as they're kept (data/mistakes.ts): a graded decision that wasn't Best or Correct, one record a spot,
// with the spot, the answer's provenance and the grade, and how it's graded when it's asked again. A retry is graded
// exactly as the decision was (practice.ts gradeMix: by EV where the answer has EVs for every action, else by
// frequency), against the answer there is now. If that isn't the kind of answer the first grade stood on, `answerChange`
// says how, and the two grades aren't set side by side. A decision from Analyze (fromAnalyze.ts) is retried against the
// mix kept with it, capped as its grade was, so its answer can't change.
import { bb, pct } from "@/components/actions";
import type { MistakeRecord, MistakeTry } from "@/data/db";
import { heldDecisions } from "@/data/mistakes";
import { describeSetup, setupToParams, tidySetup } from "@/features/solve/setup";
import { describeLine, fromSearch, STREETS } from "@/features/study/studyState";
import { capGrade, whoOf, type Grade } from "@/grading/grade";
import { storedMoved, versionOf } from "@/grading/version";
import { describe as describeProvenance, sourceLabel } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import { situation, type DrillProblem } from "@/features/practice/drills";
import { bestResponse } from "@/features/practice/exploit";
import { askOf, CHIP_MODEL, gradable, gradeMix, type Decision, type PracticeHand } from "@/features/practice/practice";
import { reviewed } from "@/features/practice/review";
import type { LibraryReport } from "@/library/files";
import { seatsOf } from "@/poker/seats";
import { afterRetry, dueAfter } from "./schedule";

/** the retries kept with a mistake */
export const TRIES_KEPT = 20;

export const gameWords = (players: number, stack: number) => `${players === 2 ? "HU" : `${players}-max`} ${stack}bb`;
export const gradeOf = (g: Grade): MistakeRecord["grade"] => ({ a: g.a, best: g.best, verdict: g.verdict, ok: false, mixed: g.mixed, loss: g.loss, lossPct: g.lossPct, byEv: g.byEv, ...(g.capped ? { capped: true } : {}) });

const cents = (x: number) => Math.round(x * 100) / 100;

/** One spot of a cash hand however its Study line was written, or null for a record that's only ever its id: a tournament's
 * or an exploit session's stay apart, as a drill's do, and a line that can't be read says nothing.
 *
 * Practice writes `s` as the table's stack and Analyze as the effective one, which turns on who plays on later, so it's each
 * seat still in at the decision and its chips that count (a folded seat's change nothing); a history writes chips and sizes
 * in cents, so they're compared in cents. The rest of the setup counts as it's written: a history doesn't carry rake or
 * sizes, so an imported hand's key isn't a raked Practice miss's on the same line and cards. */
export function spotKey(m: Pick<MistakeRecord, "from" | "tournament" | "exploit" | "study" | "seat" | "hole">): string | null {
  if (m.from === "drill" || m.tournament || m.exploit || !m.study) return null;
  const h = fromSearch(m.study);
  if (!h || h.setup?.tournament) return null;
  const lines = STREETS.map((s) => h[s]);
  const folded = new Set(lines.flat().filter((a) => a.action === "fold").map((a) => a.pos));
  const chips = seatsOf(h.players).filter((p) => !folded.has(p)).map((p) => `${p}:${cents(h.setup?.stacks?.[p] ?? h.stack)}`);
  const moves = lines.map((line) => line.map((a) => `${a.pos}:${a.action}${a.action === "bet" || a.action === "raise" ? cents(a.to ?? 0) : ""}`).join(","));
  const game = new URLSearchParams();
  const setup = tidySetup(h.setup);
  setupToParams(setup && { ...setup, stacks: {}, ...(setup.ante ? { ante: cents(setup.ante) } : {}) }, game);
  return [h.players, chips.join(","), game.toString(), ...moves, h.pf ?? "", h.board, m.seat, [...m.hole].sort().join("")].join("|");
}

/** Your decision `d` at the hand `h` (as it stood when you decided) as a kept mistake; null where it's Best, Correct or
 * not graded. The spot is the Study line and your cards: the same one missed again is one record. */
export function handMistake(sessionId: string, h: PracticeHand, d: Decision, now: number): MistakeRecord | null {
  const g = d.grade;
  if (!g || g.ok) return null;
  const r = reviewed(h, d, h.n + 1);
  const setup = fromSearch(d.study)?.setup;
  return {
    // (a chip EV tournament's line reads as a cash game's with those stacks: its spot is its own, as its record stays apart,
    // and so is one graded against a read, each read's its own)
    id: `hand|${h.tournament?.model === "chips" ? "chips|" : ""}${h.exploit ? `exploit:${h.exploit.profile}|` : ""}${d.study}|${h.hero}|${[...r.hole].sort().join("")}`,
    from: "hand",
    ...(h.tournament ? { tournament: h.tournament.model } : {}),
    ...(h.exploit ? { exploit: h.exploit.profile } : {}),
    sessionId,
    street: d.street,
    at: now,
    lastAt: now,
    updatedAt: now,
    times: 1,
    seat: r.seat,
    players: r.players,
    game: [gameWords(h.players, h.stack), ...describeSetup(setup)].join(" · "),
    hole: r.hole,
    board: r.board,
    line: r.line,
    study: d.study,
    ask: { via: "solver", state: askOf(h, d) },
    chose: d.chose,
    mix: d.mix,
    pot: d.pot,
    grade: gradeOf(g),
    provenance: d.provenance,
    step: 0,
    due: dueAfter(now, 0),
    tries: [],
  };
}

/** A drill's pick as a kept mistake; null where it's Best or Correct. A drill's hand is the stored one (its suits
 * relabelled for the eye): the spot is the stored flop, node and combo. `study`: the drill's link into Study (studyLink),
 * null for a game Study can't set up; `version`: the entry's, by the library's index. */
export function drillMistake(sessionId: string, rep: LibraryReport, pr: DrillProblem, g: Grade, provenance: Provenance, study: string | null, version: string | undefined, now: number): MistakeRecord | null {
  if (g.ok) return null;
  return {
    id: `drill|${pr.spot}|${pr.flop}|${pr.path.join("/")}|${pr.turn ? `${pr.turn.card}|${pr.turn.at.join("/")}|` : ""}${pr.combo.join(",")}`,
    from: "drill",
    sessionId,
    street: pr.turn ? "turn" : "flop",
    at: now,
    lastAt: now,
    updatedAt: now,
    times: 1,
    seat: pr.hero,
    players: rep.game?.players ?? 6,
    game: rep.label,
    hole: [pr.hand[0]!, pr.hand[1]!],
    board: pr.board,
    line: situation(rep, pr),
    study: study ? study.replace(/^\/study\?/, "") : null,
    ask: { via: "library", spot: pr.spot, flop: pr.flop, path: pr.path, combo: [pr.combo[0], pr.combo[1]], ...(version !== undefined ? { version } : {}), ...(pr.turn ? { turn: { card: pr.turn.card, at: pr.turn.at } } : {}) },
    chose: pr.names[g.a]!,
    mix: drillMix(pr),
    pot: pr.pot,
    grade: gradeOf(g),
    provenance,
    step: 0,
    due: dueAfter(now, 0),
    tries: [],
  };
}

/** A bet's chips: what the drills' labels show, "bet 33%" being 33% of the pot. */
export const betAmount = (name: string, pot: number) => {
  const m = /^bet ([\d.]+)%/.exec(name);
  return m ? Math.round((Number(m[1]) / 100) * pot * 100) / 100 : undefined;
};

/** A drill's stored answer for your hand, as a mix. */
export function drillMix(pr: Pick<DrillProblem, "names" | "freqs" | "evs" | "pot">): MistakeRecord["mix"] {
  return pr.names.map((action, i) => {
    const amount = betAmount(action, pr.pot);
    return { action, freq: pr.freqs[i]!, ev: pr.evs?.[i] ?? null, ...(amount !== undefined ? { amount } : {}) };
  });
}

/** The same spot missed again in play: the newest grade and answer, from the start of the schedule, under the id it's kept
 * by. It holds both records' decisions, and a kept answer never takes the place of a solver's, which can still re-solve. */
export function missedAgain(was: MistakeRecord, fresh: MistakeRecord): MistakeRecord {
  const held = new Map(Object.entries(heldDecisions(was)));
  for (const [id, n] of Object.entries(heldDecisions(fresh))) held.set(id, (held.get(id) ?? 0) + n);
  return {
    ...fresh,
    id: was.id,
    at: was.at,
    times: was.times + 1,
    tries: was.tries,
    ...(was.ask.via === "solver" && fresh.ask.via === "kept" ? { ask: was.ask } : {}),
    ...(held.size ? { decisions: Object.fromEntries(held) } : {}),
  };
}

export interface RetryAnswer {
  mix: MistakeRecord["mix"];
  pot: number;
  provenance: Provenance;
  /** a library entry's version, by the library's index */
  version?: string;
  /** a live drill's answer that leaned on something other than its own solve: it can't condemn a line (capGrade) */
  capped?: boolean;
  /** and what it leaned on, in words */
  off?: string;
}

const namesOf = (mix: MistakeRecord["mix"]) => mix.map((a) => a.action).sort().join("|");
const sameNumber = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined || a === b;

/** How the answer now isn't the kind the mistake was graded on, in words; empty where it is. */
export function answerChange(m: Pick<MistakeRecord, "provenance" | "mix" | "ask">, now: RetryAnswer): string[] {
  const a = m.provenance;
  const b = now.provenance;
  if (!a) return ["What answered it the first time wasn't kept."];
  if (a.source !== b.source) return [`It was first graded against ${sourceLabel(a.source)}; the answer now is ${sourceLabel(b.source)}.`];
  const out: string[] = [];
  if (a.librarySpot !== b.librarySpot) out.push(`The library spot has changed (${a.librarySpot ?? "none"} then, ${b.librarySpot ?? "none"} now).`);
  if (a.source === "library" || a.source === "library-turn") {
    const was = m.ask.via === "library" ? m.ask.version : undefined;
    const version = was !== undefined && now.version !== undefined && was !== now.version;
    if (version || storedMoved(a.libraryVersion, b.libraryVersion) || !sameNumber(a.iterations, b.iterations) || !sameNumber(a.exploitabilityPct, b.exploitabilityPct))
      out.push("The library has changed since: this flop's stored solve isn't the one you were graded on.");
  }
  if (a.solverVersion && b.solverVersion && a.solverVersion !== b.solverVersion)
    out.push(`${a.source === "charts" ? "The charts' build" : "The build behind it"} has changed (${a.solverVersion} then, ${b.solverVersion} now).`);
  if ((a.source === "live" || a.source === "best-response" || a.source === "profile-solve") && a.mode !== b.mode) out.push(`It was solved at ${a.mode}; this time at ${b.mode}.`);
  if (a.approximate !== b.approximate) out.push(a.approximate ? "That answer was labelled approximate; this one isn't." : "This answer is labelled approximate; that one wasn't.");
  if ((a.approximateLabel ?? "") !== (b.approximateLabel ?? "")) out.push("It was read from something else this time.");
  if ((a.view ?? "") !== (b.view ?? "")) out.push(`It came differently then (${a.view ?? "not said"}) and now (${b.view ?? "not said"}).`);
  if (namesOf(m.mix) !== namesOf(now.mix)) out.push("The options aren't the ones you had.");
  return out;
}

export interface Retried {
  decision: Omit<Decision, "move">;
  grade: Grade;
  /** how the answer isn't the first's; empty: like with like */
  change: string[];
  /** your first pick under this answer, where it's still an option */
  first: Grade | null;
  tried: Omit<MistakeTry, "moved">;
  /** what the answer leaned on, in words */
  off?: string;
}

/** What a retry reads of the spot: a kept mistake's, or one of this session's decisions (the Practice page's). */
export type RetrySpot = Pick<MistakeRecord, "ask" | "provenance" | "mix" | "street" | "study" | "chose">;

/** The answer as the spot's game has it: a chip EV tournament's says so, and a fallback's chips aren't graded beside prize
 * equity, as at the table (practice.ts `modelled`, `gradable`), and a locked answer asked again is the best response it was. */
const answerIn = (m: RetrySpot, answer: RetryAnswer): RetryAnswer => {
  // (a profile re-solve asked again comes back as one, its own source; a one-node answer to it is the best response it was)
  const exploited = m.provenance?.source === "best-response" || m.provenance?.source === "profile-solve";
  const read =
    exploited && answer.provenance.source === "profile-solve"
      ? { ...answer.provenance, ...(m.provenance?.exploit ? { exploit: m.provenance.exploit } : {}) }
      : exploited && answer.provenance.lock
        ? bestResponse(answer.provenance, m.provenance?.exploit)
        : null;
  const provenance = read ?? (m.provenance?.tournament === CHIP_MODEL ? { ...answer.provenance, tournament: CHIP_MODEL } : answer.provenance);
  return { ...answer, provenance, mix: gradable(answer.mix, provenance) };
};

/** Your pick (the answer's i-th action) at a retry, graded. */
export function retried(m: RetrySpot, asked: RetryAnswer, i: number, now: number): Retried {
  const answer = answerIn(m, asked);
  const { mix, pot, provenance } = answer;
  const grading = (k: number) => (m.ask.via === "kept" ? capGrade(gradeMix(mix, pot, k), provenance.band) : answer.capped ? capGrade(gradeMix(mix, pot, k), "approximate") : gradeMix(mix, pot, k));
  const g = grading(i);
  const was = mix.findIndex((a) => a.action === m.chose);
  const change = answerChange(m, answer);
  const version = versionOf(provenance);
  return {
    decision: { street: m.street as Decision["street"], chose: mix[i]!.action, grade: g, mix, pot, provenance, study: m.study ?? "" },
    grade: g,
    change,
    first: was >= 0 ? grading(was) : null,
    tried: { at: now, chose: mix[i]!.action, verdict: g.verdict, ok: g.ok, byEv: g.byEv, loss: g.loss, lossPct: g.lossPct, source: provenance.source, label: describeProvenance(provenance), ...(version ? { version } : {}), like: change.length === 0 },
    ...(answer.off ? { off: answer.off } : {}),
  };
}

/** The record after a retry: its try kept, the schedule moved where it was due. */
export function withTry(m: MistakeRecord, t: Omit<MistakeTry, "moved">): MistakeRecord {
  const { step, due, moved } = afterRetry(m, t.ok, t.at);
  return { ...m, step, due, updatedAt: t.at, tries: [...m.tries, { ...t, moved }].slice(-TRIES_KEPT) };
}

/** Said at a retry from the answer kept with a decision. */
export const KEPT_RETRY_WORDS = "Against the answer kept in Analyze; nothing solved.";

/** Where a kept mistake came from, in words; nothing for Practice's own. */
export const ORIGIN_WORDS: Partial<Record<MistakeRecord["from"], string>> = { analyze: "Added from Analyze", leak: "From a leak drill" };

/** What a grade cost, in words: EV by the answer, or, graded by frequency, how often it's played and never an EV. */
export function costWords(g: Pick<Grade, "byEv" | "loss" | "lossPct" | "a" | "best">, mix: MistakeRecord["mix"], source: string | undefined, unit = "bb"): string {
  const rough = mix[g.a]?.rough || mix[g.best]?.rough ? "≈" : "";
  if (g.byEv) return g.loss > 0 ? `${rough}${bb(g.loss)}${unit} lost · ${g.lossPct.toFixed(1)}% pot` : "no EV lost";
  return `by frequency, no EV: ${whoOf(source).replace(/^The /, "the ")} plays it ${pct(mix[g.a]?.freq ?? 0)}`;
}

/** The hand up to the spot, in words, where its line can be read. */
export function spotWords(m: Pick<MistakeRecord, "study" | "line">): string {
  const h = m.study ? fromSearch(m.study) : null;
  return (h ? describeLine(h).join(" · ") : "") || m.line;
}
