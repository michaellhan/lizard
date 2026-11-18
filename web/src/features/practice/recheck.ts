// A Quick grade asked again at Fast while the solver is idle. Practice plays at Quick unless the setting is Accurate (room.ts
// `mode`: a Fast setting plays Quick's budgets after the flop), and a Quick read gets the same grade as Fast's about 88% of
// the time where it settled and 62% for the other reads (advisor.py triage; docs/ACCURACY.md). So, as Analyze does for a
// session's flagged reads (features/analyze/triage.ts), the Room asks this session's Quick-graded decisions again at Fast
// once nothing else wants the solver, and the move you made is graded again against Fast's answer by the one entry point
// every Practice grade goes through (practice.ts decide, gradeAnswer on practiceBasis), with the Fast answer's own
// provenance (mode "fast", its band and caps: its band says how close it came, nothing here says more). Fast's grade then stands in Quick's place
// everywhere, and the decision keeps what Quick said (`quick`), so a page can say it was re-checked. Pure: the backlog,
// the flight and the totals are the Room's and session.ts's.
import { NEED, type Lines } from "@/poker/table";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { sourceLabel } from "@/solver/provenance";
import type { Provenance, ResultSource } from "@/solver/types";
import { adviceKey } from "./flow";
import { adviceState, decide, moveOfOption, optionsOf, simOf, type Decision, type PracticeHand, type QuickRead } from "./practice";

/** The most decisions waiting to be re-checked: past it the oldest hands' go unchecked (a session's backlog, never more). */
export const RECHECK_KEEP = 60;

/** EV given up, as a share of the pot, that flags a read for Fast first: Analyze's DEEP_LOSS (triage.ts), not imported, so
 * Practice doesn't pull in Analyze's bundle (a test holds the two equal). */
export const RECHECK_DEEP = 0.02;

/** What Quick said of a decision, kept as it's re-checked; null where it wasn't graded. */
export function quickOf(d: Pick<Decision, "grade" | "mix" | "provenance">): QuickRead | null {
  const g = d.grade;
  if (!g) return null;
  return {
    verdict: g.verdict,
    ok: g.ok,
    best: d.mix[g.best]?.action ?? "",
    byEv: g.byEv,
    loss: g.loss,
    lossPct: g.lossPct,
    source: d.provenance?.source ?? "unknown",
    ...(g.capped ? { capped: true as const } : {}),
  };
}

/** The players in at a decision: who hasn't folded as it was made. */
export const activeAt = (at: PracticeHand) => simOf(at).active.size;

/** Fast answers it the same, so there's nothing to check: the charts, the stored preflop solve, the push/fold model, the
 * library's own spot (a borrowed one is approximate, and Fast can answer it otherwise), and the betting rules where Fast
 * leaves the spot to them too (five or more in before the river, six or more on it: Fast solves four-way flops and turns,
 * and the N-player river up to five, advisor.py _multiway_solve and the worker's mw_nway_max). `active`: the players in. */
export function sameAtFast(d: Pick<Decision, "provenance" | "street">, active: number): boolean {
  const p = d.provenance;
  if (!p) return true;
  if (p.source === "charts" || p.source === "preflop-solve" || p.source === "push-fold") return true;
  if (p.source === "library") return !p.approximate;
  if (p.source === "rules") return active >= (d.street === "river" ? 6 : 5);
  return false;
}

/** A decision worth asking again at Fast: graded at Quick after the flop, not after Reveal nor off a read's profile, not
 * re-checked already nor failed at it, and one Fast could answer otherwise. `active`: the players in as it was made. */
export function recheckable(d: Decision, active: number): boolean {
  const p = d.provenance;
  return !!d.grade && !d.revealed && !d.offProfile && !d.quick && d.recheckFailed === undefined && d.street !== "preflop" && p?.mode === "quick" && !p.partial && !sameAtFast(d, active);
}

/** A read Fast should check first, as Analyze flags one (triage.ts `flagged`): graded below Correct or stopped at
 * Inaccuracy, an answer that's rough, approximate or leans on the betting rules, a read of low confidence, or EV given up
 * of RECHECK_DEEP of the pot or more. */
export function flagged(d: Pick<Decision, "grade" | "provenance" | "pot">): boolean {
  const g = d.grade;
  const p = d.provenance;
  if (!g) return false;
  if (!g.ok || g.capped) return true;
  if (p && (p.approximate || p.band === "rough" || p.band === "approximate" || p.leansOnRules || p.confidence === "low")) return true;
  return d.pot > 0 && g.loss >= RECHECK_DEEP * d.pot;
}

/** A decision as the backlog orders it: its hand's number, its place in the hand, and whether it's flagged. */
export interface Waiting {
  n: number;
  k: number;
  flagged: boolean;
}

/** The backlog's order, hand by hand, as Analyze checks a hand's decisions in the order played (triage.ts deepenPlan: its
 * flop's solve narrows the turn, so the turn asked first would read a flop less solved than Fast's and get another
 * answer): the hands with a flagged read first, then the others, each the latest hands first, and a hand's decisions in
 * the order they were made, which is street order. */
export function recheckQueue<T extends Waiting>(xs: readonly T[]): T[] {
  const hot = new Set(xs.filter((x) => x.flagged).map((x) => x.n));
  return [...xs].sort((a, b) => Number(hot.has(b.n)) - Number(hot.has(a.n)) || b.n - a.n || a.k - b.k);
}

/** seconds you've been at your turn, its answer in hand, before a re-check starts while you think: one that runs is
 * stopped by your move, and what your move asks waits for that stop (about 0.1 s on the worker), so a quick move
 * shouldn't pay it. Between hands one starts at once. */
export const RECHECK_IDLE = 5;

/** The backlog bounded to RECHECK_KEEP: the latest hands' kept, the oldest dropped. */
export function bounded<T extends Waiting>(xs: readonly T[], keep = RECHECK_KEEP): T[] {
  return xs.length <= keep ? [...xs] : [...xs].sort((a, b) => b.n - a.n || a.k - b.k).slice(0, keep);
}

/** The hand as it stood at its k-th decision, from the hand as it is now: the lines cut at that move of yours (your moves
 * on a street after the flop are your decisions there, in order), the board out to its street, nothing after it. Null
 * where that move isn't the decision's: a hand that doesn't line up is never graded. */
export function handAt(h: PracticeHand, k: number): PracticeHand | null {
  const d = h.decisions[k];
  if (!d || d.street === "preflop") return null;
  const s = d.street;
  const j = h.decisions.slice(0, k).filter((x) => x.street === s).length;
  const line = h.lines[s];
  let seen = -1;
  const cut = line.findIndex((m) => m.pos === h.hero && ++seen === j);
  const m = line[cut];
  if (!m || m.action !== d.move.action || Math.abs((m.to ?? 0) - (d.move.to ?? 0)) > 1e-9) return null;
  const lines: Lines = { ...h.lines, [s]: line.slice(0, cut) };
  for (const x of ["flop", "turn", "river"] as const) if (NEED[x] > NEED[s]) lines[x] = [];
  const at: PracticeHand = { ...h, lines, shown: NEED[s], decisions: h.decisions.slice(0, k), result: null };
  delete at.run;
  delete at.revealed;
  return at;
}

/** What a re-check asks: your spot's request as the table sent it, at Fast, under a key of its own (no table's key is
 * one, so no table takes it for its answer, nor a re-check for a table's). */
export function recheckAsk(at: PracticeHand): { state: AdvisorState; key: string } {
  const state = adviceState(at);
  return { state, key: `recheck|${adviceKey("fast", state)}` };
}

/** What answers without solving: the betting rules, an equity estimate, or nothing said. */
const FALLBACKS: ReadonlySet<ResultSource> = new Set(["rules", "equity", "unknown"]);

/** What solves the spot as it's asked, Quick's budget or Fast's: a live solve, and a solve against a read or a lock. */
const SOLVES: ReadonlySet<ResultSource> = new Set(["live", "best-response", "profile-solve", "node-lock", "plo-river"]);

const sameMove = (a: { action: string; to?: number }, b: { action: string; to?: number }) => a.action === b.action && Math.abs((a.to ?? 0) - (b.to ?? 0)) < 1e-6;

/** Your move graded again against Fast's answer at the hand `at` as it stood when you made it, through `decide` (so
 * gradeAnswer, on practiceBasis built from Fast's answer and provenance), Quick's grade kept in `quick`. Your move is the
 * one Fast's options record the same (by its name first), or there's nothing to grade, and why, in words. */
export function regraded(at: PracticeHand, d: Decision, res: AdvisorResponse, provenance: Provenance | null): { decision: Decision } | { why: string } {
  const quick = quickOf(d);
  if (!quick) return { why: "it wasn't graded" };
  if (res.error) return { why: res.error };
  // (Fast falling back to the betting rules where Quick's answer wasn't theirs: no better an answer, so Quick's stands)
  const to = provenance?.source ?? "unknown";
  if (FALLBACKS.has(to) && !FALLBACKS.has(quick.source)) return { why: `Fast's answer here is ${sourceLabel(to)}` };
  const sim = simOf(at);
  const opts = optionsOf(res);
  const records = (i: number) => {
    const m = moveOfOption(at, opts[i]!, sim);
    return typeof m !== "string" && sameMove(m, d.move);
  };
  let i = opts.findIndex((a, j) => a.action === d.chose && records(j));
  if (i < 0) i = opts.findIndex((_, j) => records(j));
  if (i < 0) return { why: opts.length ? `Fast's answer has no ${d.chose} here` : "Fast's answer has no actions here" };
  const r = decide(at, res, i, provenance, sim);
  if ("error" in r) return { why: r.error };
  if (!r.decision.grade) return { why: "Fast's answer can't grade it (no best response to the read here)" };
  return { decision: { ...r.decision, move: d.move, study: d.study, quick } };
}

/** What a page says of a decision re-checked at Fast: "Re-checked at Fast: Mistake → Correct", or the same grade. Null
 * where it wasn't. */
export function recheckWords(d: Pick<Decision, "grade" | "quick">): string | null {
  if (!d.quick || !d.grade) return null;
  return d.quick.verdict === d.grade.verdict ? "Re-checked at Fast: same grade" : `Re-checked at Fast: ${d.quick.verdict} → ${d.grade.verdict}`;
}

/** Whether a re-check changed the verdict. */
export const recheckChanged = (d: Pick<Decision, "grade" | "quick">) => !!d.quick && !!d.grade && d.quick.verdict !== d.grade.verdict;

/** An answer of `mode`'s in words for a re-check's sentence: a solve's as one ("a Quick solve"), anything else as what it
 * is ("Quick's answer, Heuristic rules (not a solve)"), so the betting rules are never called a solve. */
export function answerWords(mode: "Quick" | "Fast", source: ResultSource | undefined): string {
  const s = source ?? "unknown";
  return SOLVES.has(s) ? `${mode === "Quick" ? "a" : "the"} ${mode} solve` : `${mode}'s answer, ${sourceLabel(s)}`;
}

const noDot = (s: string) => s.replace(/\.+$/, "");

/** What a decision's re-check says beside its grade, in sentences built from what answered each time (Quick's source,
 * kept in `quick`, and Fast's, the decision's provenance); for one that couldn't be re-checked, why, and that the grade is
 * Quick's. Null where neither. Fast's band is the answer's own measure (the badge), so this never says how settled it is:
 * where Fast solved, it says Fast's is a short solve too and points to the badge. */
export function recheckNote(d: Pick<Decision, "grade" | "quick" | "recheckFailed" | "chose" | "provenance">): string | null {
  if (!d.grade) return null;
  if (!d.quick) return d.recheckFailed !== undefined ? `Not re-checked at Fast (${noDot(d.recheckFailed)}): this grade is on ${answerWords("Quick", d.provenance?.source)}.` : null;
  const q = d.quick;
  const to = d.provenance?.source;
  const said = answerWords("Quick", q.source);
  const by = SOLVES.has(q.source) ? `A${said.slice(1)}` : `${said},`;
  const best = q.best && q.best !== d.chose ? ` (its best: ${q.best})` : "";
  const same = q.verdict === d.grade.verdict ? ", which gave the same grade" : "";
  const short = to && SOLVES.has(to) ? " Fast's is a short solve too: how close it came to equilibrium is in its badge." : "";
  return `${by} graded this ${q.verdict}${best}; asked again at Fast while the solver was idle, the grade, strategy and EVs here are from ${answerWords("Fast", to)}${same}, and it's counted that way.${short}`;
}

/** What re-checking is, in words, beside the session's totals. The measure is the Advisor's (advisor.py triage, 1,000
 * hands against Fast): said for the reads it was taken on, and not for the ones it wasn't. */
export const RECHECK_WORDS =
  `Decisions graded at Quick are asked again at Fast while the solver is idle: between hands, or once you've been at your turn for ${RECHECK_IDLE} seconds. Measured against Fast, Quick gave the same grade about 88% of the time where its solve settled, and nearest-flop and earlier-street reads 62%; an unsettled Quick solve and the betting rules weren't measured. A re-checked grade, its EVs and its place in these totals are Fast's answer's, whose badge says how close to equilibrium it came. Anything the tables need stops a re-check, and waits the moment the stop takes.`;

/** The Room's re-checks as a page says them: on, how many wait, how many were done this session and of them how many
 * changed the verdict, and how many Fast couldn't grade. */
export interface RecheckStatus {
  on: boolean;
  left: number;
  done: number;
  changed: number;
  failed: number;
  /** the solver couldn't be reached: what waits goes once a table's request has an answer again */
  paused?: true;
}

export const NO_RECHECK: RecheckStatus = { on: false, left: 0, done: 0, changed: 0, failed: 0 };

/** The status in a line, "Re-checking at Fast: 3 left · 1 changed"; null where there's nothing to say. */
export function recheckLine(s: RecheckStatus): string | null {
  if (!s.on && !s.done && !s.failed) return null;
  const tail = [s.changed ? `${s.changed} changed` : "", s.failed ? `${s.failed} couldn't be graded` : ""].filter(Boolean);
  if (s.left > 0 && s.on && s.paused) return [`Re-checks at Fast paused, the solver couldn't be reached: ${s.left} left`, ...tail].join(" · ");
  if (s.left > 0 && s.on) return [`Re-checking at Fast: ${s.left} left`, ...tail].join(" · ");
  if (s.done || s.failed) return [`Re-checked at Fast: ${s.done} done`, ...tail].join(" · ");
  return null;
}
