// The study plan: what you've demonstrated, said as what to do next, in order, each step a link that starts it. Nothing
// here is stored: it's read from the queue, the graded decisions and the sessions kept, by one plain rule (PLAN_RULE),
// so the same data gives the same plan, and it's no coach: it counts where you missed and never says why. A step is done
// only where the data says so (PLAN_DONE), never by a press.
//
// Leaks are the report's own (report.ts readLeaks) over the hands an equilibrium can be read from (sessions.ts
// isEquilibriumHand), and their links carry the `game` filter, so a drill deals the decisions the plan counted. This
// runs once as what's kept is read, over everything: see scale.test.ts at 150,000 decisions.
import type { DecisionRecord, HandRecord, MistakeRecord, SessionRecord } from "@/data/db";
import { PRACTICE_SITE } from "@/data/hands";
import { heldDecisions } from "@/data/mistakes";
import { scenarioWords, type ScenarioSetup } from "@/data/scenarios";
import { GAME_EQUILIBRIUM } from "@/features/analyze/analyze";
import { canDrill, drillSessionId, fromSession, leakDrillLink, leakParam, type LeakRef } from "@/features/analyze/leakDrill";
import { BASES, basisOf, isGraded, isOk, isPfSolve, leakTest, MIN_READ, readLeaks, type Leak } from "@/features/analyze/report";
import { exploitImports, isEquilibriumHand } from "@/features/analyze/sessions";
import { STREET_ORDER } from "@/features/history/progress";
import type { DrillStreet, DrillView } from "@/features/practice/drills";
import { turnViewLabel, viewLabel } from "@/features/practice/drills";
import { linkSetup, setupLink, type LinkSetup, type PlayKind } from "@/features/practice/setupLink";
import { dueQueue, dueWords, isDue, midnight } from "@/features/review/schedule";
import { gameLabel, isDrillable, storedTurnFlops, type LibrarySpotIndex } from "@/library/catalog";
import { SEATS, seatLabel } from "@/poker/seats";
import { sourceLabel } from "@/solver/provenance";

/** The table and depth a generated session is set to: your last Practice session's, so a drill is at the game you play.
 * With none, the game the library's plain spots are; `yours` says which, as the drill says it in words. */
export interface PlanGame {
  players: number;
  stack: number;
  yours: boolean;
}
const NO_GAME: PlanGame = { players: 6, stack: 100, yours: false };
/** the decisions in a generated drill, in sessions started today, that mark it done */
export const DRILL_TARGET = 20;
/** the rows too few to read that are listed before "Show more" */
export const THIN_SHOWN = 6;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pair = ([a, b]: readonly [number, number]) => `${pct(a)} to ${pct(b)}`;
const bbs = (x: number) => `${(Math.round(x * 100) / 100).toFixed(2)}bb`;
const many = (n: number, one: string, more = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : more}`;
const CHARTS = BASES[0]!;


export type PlanHand = Pick<HandRecord, "id" | "site" | "tournament" | "importId">;

export interface PlanInput {
  now: number;
  mistakes: readonly MistakeRecord[];
  /** records of the queue that couldn't be read */
  damaged?: number;
  hands: readonly PlanHand[];
  decisions: readonly DecisionRecord[];
  sessions: readonly SessionRecord[];
}

interface StepBase {
  id: string;
  /** what the step is about */
  what: string;
  /** the link's words */
  title: string;
  to: string;
  done: boolean;
  /** how far it's gone, by what's kept */
  progress: string | null;
  /** its numbers, each saying what produced it */
  says: string[];
}
export interface ReviewStep extends StepBase {
  kind: "reviews";
  due: number;
}
export interface LeakStep extends StepBase {
  kind: "leak";
  leak: LeakRef;
  /** the EV given up over its decisions graded by EV by a solve of the spot, bb; null with none */
  lost: number | null;
  /** the same over those graded by the preflop solve: never added to `lost`, and only looked at after it */
  pfLost: number | null;
  /** its decisions a drill can deal */
  dealt: number;
}
export interface ThinStep extends StepBase {
  kind: "thin";
  leak: LeakRef;
  n: number;
  /** the other way to collect them */
  also: { to: string; label: string };
}
export type DrillTarget = { kind: "setup"; setup: ScenarioSetup; about: string; to: string } | { kind: "library"; spot: string; view: DrillView; street: DrillStreet; about: string; to: string };
export interface DrillStep extends StepBase {
  kind: "drill";
  street: string;
  seat: string;
  misses: number;
  target: DrillTarget;
}
export type PlanStep = ReviewStep | LeakStep | ThinStep | DrillStep;

/** What to do first where there's no step to give, with where it's done. */
export interface PlanFirst {
  text: string;
  links: { to: string; label: string }[];
}

export interface Plan {
  reviews: ReviewStep | null;
  leaks: LeakStep[];
  thin: ThinStep[];
  drill: DrillStep | null;
  /** the first step not done */
  next: PlanStep | null;
  /** with no step at all */
  first: PlanFirst | null;
  /** said where a part has no step */
  notes: { reviews: string; leaks: string; thin: string; drill: string };
  /** what's left out of the leaks, in words; null with nothing */
  apart: string | null;
  damaged: number;
  /** the sessions started today a drill can count, and what picked it (withLibrary reads them again) */
  today: readonly SessionRecord[];
  facts: DrillFacts | null;
  /** the game a generated session is set to */
  game: PlanGame;
}

// ---- reviews

/** The queue's words for what graded a mistake: a chart's by frequency and not a solve. */
const mistakeBasis = (m: MistakeRecord) => (!m.provenance ? "an answer not kept" : m.provenance.source === "charts" ? CHARTS : sourceLabel(m.provenance.source));

/** Keys by count, the most first, in `order` where tied, then by name. */
const ranked = (m: ReadonlyMap<string, number>, order: readonly string[] = []) => {
  const at = (k: string) => (order.indexOf(k) + 1 || order.length + 1);
  return [...m].sort((a, b) => b[1] - a[1] || at(a[0]) - at(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
};
const add = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const basisWords = (m: ReadonlyMap<string, number>) => `Graded against: ${ranked(m, BASES).map(([b, n]) => `${b}, ${n.toLocaleString()}`).join(" · ")}.`;

function reviewStep(mistakes: readonly MistakeRecord[], now: number): ReviewStep | null {
  const queue = dueQueue(mistakes, now);
  const today = midnight(now);
  // (a due review moved on today: a retry before its day moves nothing, and doesn't count)
  const moved = mistakes.flatMap((m) => {
    const t = m.tries.findLast((x) => x.moved && x.at >= today);
    return t ? [t] : [];
  });
  if (!queue.length && !moved.length) return null;
  const byEv = queue.filter((m) => m.grade.byEv).length;
  const bases = new Map<string, number>();
  for (const m of queue) add(bases, mistakeBasis(m));
  const tour = queue.filter((m) => m.tournament).length;
  const exploit = queue.filter((m) => m.exploit).length;
  const says = [
    ...(queue.length
      ? [
          `${many(queue.length, "mistake")} due: ${byEv.toLocaleString()} graded by EV, ${(queue.length - byEv).toLocaleString()} by frequency.`,
          basisWords(bases),
        ]
      : []),
    ...(tour || exploit
      ? [`Includes ${[tour ? `${tour.toLocaleString()} from tournaments` : "", exploit ? `${exploit.toLocaleString()} from exploit sessions` : ""].filter(Boolean).join(" and ")}.`]
      : []),
  ];
  return {
    kind: "reviews",
    id: "reviews",
    what: "Reviews due today",
    title: queue.length ? `Retry ${many(queue.length, "due review")}` : "Open Review",
    to: queue.length ? "/review?retry=next" : "/review",
    done: !queue.length,
    progress: moved.length ? `${many(moved.length, "review")} moved on today, ${moved.filter((t) => t.ok).length.toLocaleString()} at Best or Correct.` : null,
    says,
    due: queue.length,
  };
}

// ---- leaks

/** A row's decisions, gone through once for all the rows together. */
interface RowTally {
  n: number;
  ev: number;
  lost: number;
  /** those graded by the preflop solve, in neither of the two above: never added to them in what's said */
  pfEv: number;
  pfLost: number;
  rough: number;
  bases: Map<string, number>;
  streets: Map<string, number>;
  pots: Map<string, number>;
  /** its decisions a drill can deal, of them those not yet answered, and those the row's read leaves out (a spot's by
   * frequency, which have no EV to read, are dealt like the rest) */
  dealt: number;
  left: number;
  unread: number;
}

function tallyRows(rows: readonly Leak[], ds: readonly DecisionRecord[], sessions: ReadonlyMap<string, SessionRecord>): RowTally[] {
  const tests = rows.map((l) => leakTest(l));
  const answered = rows.map((l) => new Set(fromSession(sessions.get(drillSessionId(l)))?.done));
  const out = rows.map((): RowTally => ({ n: 0, ev: 0, lost: 0, pfEv: 0, pfLost: 0, rough: 0, bases: new Map(), streets: new Map(), pots: new Map(), dealt: 0, left: 0, unread: 0 }));
  for (const d of ds) {
    if (!isGraded(d)) continue;
    const drillable = canDrill(d);
    let basis: string | null = null;
    for (let i = 0; i < rows.length; i++) {
      if (!tests[i]!(d)) continue;
      const t = out[i]!;
      const hasEv = d.evLossBb != null;
      const read = rows[i]!.kind !== "spot" || hasEv;
      if (drillable) {
        t.dealt++;
        if (!answered[i]!.has(d.id)) t.left++;
        if (!read) t.unread++;
      }
      if (!read) continue;
      t.n++;
      if (hasEv && isPfSolve(d)) {
        t.pfEv++;
        t.pfLost += d.evLossBb ?? 0;
      } else if (hasEv) {
        t.ev++;
        t.lost += d.evLossBb ?? 0;
        if (d.roughEv) t.rough++;
      }
      add(t.bases, (basis ??= basisOf(d)));
      add(t.streets, d.street);
      if (d.potType) add(t.pots, d.potType);
    }
  }
  return out;
}

const onlyCharts = (t: RowTally) => t.bases.size === 1 && t.bases.has(CHARTS);

/** What the row reads, its interval and whom it's against. */
function readingOf(l: Leak, t: RowTally): string {
  const n = many(l.n, "decision");
  const who = onlyCharts(t) ? "the preflop charts, by frequency, not a solve" : "what graded each decision";
  if (l.kind === "freq") return `You ${pct(l.you)} (95% range ${pair(l.range)}) against ${who} at ${pct(l.gto)}, over ${n}.`;
  if (l.kind === "pf") return `${pct(l.inMix)} in the mix (95% range ${pair(l.range)}) against ${who}, over ${n}.`;
  return `${bbs(l.avg)} lost per decision (95% range ${bbs(l.range[0])} to ${bbs(l.range[1])}), over ${n} graded by EV.`;
}

function costOf(t: RowTally): string {
  if (!t.ev && !t.pfEv) return `No EV: all ${many(t.n, "decision")} graded by frequency.`;
  const rest = t.n - t.ev - t.pfEv;
  const parts = [t.ev ? `${bbs(t.lost)} of solver EV given up over ${many(t.ev, "decision")} graded by EV` : "", t.pfEv ? `${bbs(t.pfLost)} given up by the preflop solve's EV over ${many(t.pfEv, "decision")}` : ""].filter(Boolean);
  return `${parts.join("; apart from that, ")}${rest ? `; ${rest.toLocaleString()} more by frequency` : ""}.`;
}

/** What it stands on: the grades' bases, and what they're worth where that's less than the rest. */
const standsOn = (l: Leak, t: RowTally) =>
  [basisWords(t.bases), l.low ? `${l.low.toLocaleString()} on a low-confidence read.` : "", t.rough ? `${t.rough.toLocaleString()} with a rough EV.` : "", l.versions ?? ""].filter(Boolean).join(" ");

function leakStep(l: Leak, t: RowTally): LeakStep {
  const leak = { kind: l.kind, key: l.key };
  const answered = t.dealt - t.left;
  return {
    kind: "leak",
    id: `leak|${leakParam(l)}`,
    what: l.key,
    title: `Drill this leak: ${l.key}`,
    to: leakDrillLink(leak, new URLSearchParams({ game: GAME_EQUILIBRIUM })),
    done: t.dealt > 0 && t.left === 0,
    progress: t.dealt ? `${answered.toLocaleString()} of ${many(t.dealt, "decision")} answered in its drill${t.unread ? `, ${t.unread.toLocaleString()} of them by frequency` : ""}.` : "No decision keeps its mix: nothing to deal.",
    says: [readingOf(l, t), costOf(t), standsOn(l, t)],
    leak,
    lost: t.lost > 0 ? Math.round(t.lost * 100) / 100 : null,
    pfLost: t.pfLost > 0 ? Math.round(t.pfLost * 100) / 100 : null,
    dealt: t.dealt,
  };
}

/** The most EV given up to a solve of the spot first, then to the preflop solve, the two never added; with neither, by the
 * report's score; a name settles the rest. */
const byLost = (a: LeakStep & { score: number }, b: LeakStep & { score: number }) =>
  (b.lost ?? -1) - (a.lost ?? -1) || (b.pfLost ?? -1) - (a.pfLost ?? -1) || b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- collecting more hands

/** The last Practice session's table and depth, where a session of hands could be set to them. A session that's another
 * game (a tournament, an exploit, push/fold) or that played no hand says nothing of the game you play. */
export function gameOf(sessions: readonly SessionRecord[]): PlanGame {
  const last = sessions
    .filter((s) => s.kind === "practice" && !s.meta.pushFold && typeof s.meta.hands === "number" && s.meta.hands > 0)
    .reduce<SessionRecord | null>((a, s) => (!a || s.startedAt > a.startedAt ? s : a), null);
  if (!last) return NO_GAME;
  const { players, stack } = last.meta;
  if (typeof players !== "number" || typeof stack !== "number") return NO_GAME;
  const fits = (["full", "preflop", "srp", "3bet"] as const).every((play) => linkSetup({ play, seat: "moves", players, stack }));
  return fits ? { players, stack, yours: true } : NO_GAME;
}

const seatedSetup = (play: PlayKind, seat: string, game: PlanGame): { link: LinkSetup; setup: ScenarioSetup } => {
  // (a seat that isn't at the table sits at the smallest that has it)
  const players = seat === "moves" || SEATS[game.players]!.includes(seat) ? game.players : Number(Object.keys(SEATS).find((p) => SEATS[Number(p)]!.includes(seat)));
  const link = { play, seat, players, stack: game.stack };
  return { link, setup: linkSetup(link)! };
};

const setupTarget = (play: PlayKind, seat: string, game: PlanGame): DrillTarget => {
  const { link, setup } = seatedSetup(play, seat, game);
  return { kind: "setup", setup, about: scenarioWords(setup), to: setupLink(link) };
};

/** Where more of a row can be played: the street and pot most of its decisions are. */
function collectPlay(t: RowTally): PlayKind {
  const street = ranked(t.streets, STREET_ORDER)[0]?.[0];
  if (street === "preflop") return "preflop";
  const pot = ranked(t.pots)[0]?.[0];
  return pot === "SRP" ? "srp" : pot === "3bet pot" ? "3bet" : "full";
}

function thinStep(l: Leak, t: RowTally, game: PlanGame): ThinStep {
  const target = setupTarget(collectPlay(t), "moves", game);
  const short = MIN_READ - l.n;
  return {
    kind: "thin",
    id: `thin|${leakParam(l)}`,
    what: l.key,
    title: `Collect hands: ${l.key}`,
    to: target.to,
    done: false,
    progress: null,
    says: [
      short > 0
        ? `${many(l.n, "graded decision")}, ${short.toLocaleString()} short of ${MIN_READ}.`
        : `${many(l.n, "graded decision")}; its 95% interval still reaches the line.`,
      standsOn(l, t),
      `The link plays ${target.about}.`,
    ],
    leak: { kind: l.kind, key: l.key },
    n: l.n,
    also: { to: "/analyze", label: "Import more hands" },
  };
}

// ---- the drill

const SEAT_ORDER = SEATS[9]!;
const KNOWN_SEAT = new Set(Object.values(SEATS).flat());

interface Miss {
  n: number;
  /** from graded hands, and kept in the queue */
  graded: number;
  kept: number;
  byEv: number;
  bases: Map<string, number>;
}
const noMiss = (): Miss => ({ n: 0, graded: 0, kept: 0, byEv: 0, bases: new Map() });

/** Misses by street, then seat. Practice's own hands are counted by the queue, which keeps them whether or not they're
 * graded here; a hand of theirs that's graded isn't counted again. The other way round for what the queue took from
 * Analyze: its decision is counted here, so those misses of the entry aren't, unless that grade is gone or wasn't a miss.
 * An entry can hold both, as a spot's misses merge: it's read by what it holds, never by how it's asked now. */
function countMisses(ds: readonly DecisionRecord[], hands: ReadonlyMap<string, PlanHand>, mistakes: readonly MistakeRecord[]): Map<string, Map<string, Miss>> {
  const out = new Map<string, Map<string, Miss>>();
  const at = (street: string, seat: string): Miss | null => {
    if (!STREET_ORDER.includes(street as (typeof STREET_ORDER)[number]) || !KNOWN_SEAT.has(seat)) return null;
    const row = out.get(street) ?? new Map<string, Miss>();
    out.set(street, row);
    const m = row.get(seat) ?? noMiss();
    row.set(seat, m);
    return m;
  };
  const counted = new Set<string>();
  for (const d of ds) {
    if (!isGraded(d) || isOk(d) || hands.get(d.handId)?.site === PRACTICE_SITE) continue;
    const m = at(d.street, d.pos);
    if (!m) continue;
    counted.add(d.id);
    m.n++;
    m.graded++;
    if (d.evLossBb != null) m.byEv++;
    add(m.bases, basisOf(d));
  }
  for (const k of mistakes) {
    if (k.tournament || k.exploit) continue;
    let times = k.times;
    for (const [id, n] of Object.entries(heldDecisions(k))) if (counted.has(id)) times -= n;
    if (!times) continue;
    const m = at(k.street, k.seat);
    if (!m) continue;
    m.n += times;
    m.kept += times;
    if (k.grade.byEv) m.byEv += times;
    add(m.bases, mistakeBasis(k), times);
  }
  return out;
}

const STREET_WORD: Record<string, string> = { preflop: "preflop", flop: "the flop", turn: "the turn", river: "the river" };

const drilledToday = (target: DrillTarget, today: readonly SessionRecord[]): number =>
  today.reduce((n, s) => {
    const m = s.meta ?? {};
    const fits =
      target.kind === "library"
        ? s.kind === "drill" && m.spot === target.spot && m.view === target.view && (m.street ?? "flop") === target.street
        : s.kind === "practice" && m.seat === target.setup.opts.seat && (m.pot ?? null) === target.setup.opts.pot && !!m.preflopOnly === target.setup.opts.preflopOnly;
    return n + (fits ? Math.max(0, s.decisions) : 0);
  }, 0);

const answeredBy = (t: DrillTarget, street: string) =>
  t.kind === "library"
    ? "From the flop library, no solve."
    : street === "preflop"
      ? "Graded against the preflop charts (not a solve)."
      : "Each decision shows what answered it.";

interface DrillFacts {
  street: string;
  seat: string;
  seatMiss: Miss;
  streetMisses: number;
  total: number;
}

/** Why the table and depth are what they are, after the settings' words. */
const gameWords = (t: DrillTarget, g: PlanGame) => {
  if (t.kind !== "setup") return "";
  const moved = t.setup.players !== g.players;
  if (g.yours) return moved ? ` Stack from your last Practice session, ${t.setup.players} players.` : " Table and stack from your last Practice session.";
  return moved ? ` 100bb, ${t.setup.players} players.` : " 6-max, 100bb.";
};

function drillStep(f: DrillFacts, target: DrillTarget, today: readonly SessionRecord[], game: PlanGame): DrillStep {
  const { street, seat, seatMiss: m } = f;
  const name = seatLabel(seat, target.kind === "setup" ? target.setup.players : game.players);
  const count = drilledToday(target, today);
  const where = `${STREET_WORD[street]} from ${name}`;
  return {
    kind: "drill",
    id: "drill",
    what: `Practice ${where}`,
    title: `Practice ${where}`,
    to: target.to,
    done: count >= DRILL_TARGET,
    progress: `${Math.min(count, DRILL_TARGET).toLocaleString()} of ${DRILL_TARGET} decisions today.`,
    says: [
      `The most misses are on ${STREET_WORD[street]}: ${f.streetMisses.toLocaleString()} of the ${many(f.total, "miss", "misses")} counted, ${m.n.toLocaleString()} of them from ${name}.`,
      `Those ${m.n.toLocaleString()}: ${m.graded.toLocaleString()} in hands graded in Analyze, ${m.kept.toLocaleString()} kept in the review queue; ${m.byEv.toLocaleString()} by EV, ${(m.n - m.byEv).toLocaleString()} by frequency. ${basisWords(m.bases)}`,
      `Settings: ${target.about}.${gameWords(target, game)} ${answeredBy(target, street)}`,
    ],
    street,
    seat,
    misses: m.n,
    target,
  };
}

function drillFacts(misses: ReadonlyMap<string, ReadonlyMap<string, Miss>>): DrillFacts | null {
  const streets = new Map([...misses].map(([s, row]) => [s, [...row.values()].reduce((n, m) => n + m.n, 0)]));
  const [street, streetMisses] = ranked(streets, STREET_ORDER)[0] ?? [];
  if (!street || !streetMisses) return null;
  const row = misses.get(street)!;
  const [seat] = ranked(new Map([...row].map(([s, m]) => [s, m.n])), SEAT_ORDER)[0]!;
  return { street, seat, seatMiss: row.get(seat)!, streetMisses, total: [...streets.values()].reduce((a, b) => a + b, 0) };
}

/** A session in the seat that missed: preflop only, or a single-raised pot from the flop on. */
const seatTarget = (street: string, seat: string, game: PlanGame) => setupTarget(street === "preflop" ? "preflop" : "srp", seat, game);

/** The library's spot for a seat on a street, out of position or in: a plain game's first where one has it. */
export function librarySpotFor(spots: readonly LibrarySpotIndex[], seat: string, street: string, game: PlanGame = NO_GAME): LibrarySpotIndex | null {
  if (street !== "flop" && street !== "turn") return null;
  const fits = spots.filter((s) => isDrillable(s) && s.seats.includes(seat) && (street === "flop" || storedTurnFlops(s).length > 0));
  if (!game.yours) return fits.find((s) => !s.game) ?? fits[0] ?? null;
  // (the game you play or none: a spot at another table or depth isn't a drill of your game, and a session of hands is)
  return fits.find((s) => (s.game?.players ?? 6) === game.players && (s.game?.stack ?? 100) === game.stack) ?? null;
}

/** The first step left to do (a leak with nothing to deal can't be: it stays listed, and isn't next). */
const nextOf = (p: Pick<Plan, "reviews" | "leaks" | "thin" | "drill">): PlanStep | null => [p.reviews, ...p.leaks, ...p.thin, p.drill].find((s) => s && !s.done && (s.kind !== "leak" || s.dealt > 0)) ?? null;

/** The plan with its drill read from the library, where it holds the street and seat: answered at once and no solve.
 * Without the library, or a spot for the seat, the drill stays a session of hands. */
export function withLibrary(plan: Plan, spots: readonly LibrarySpotIndex[]): Plan {
  const step = plan.drill;
  const spot = step && librarySpotFor(spots, step.seat, step.street, plan.game);
  if (!step || !spot) return plan;
  const street = step.street as DrillStreet;
  const view: DrillView = spot.seats.indexOf(step.seat) === 0 ? "oop" : "ip";
  const q = new URLSearchParams({ tab: "drills", spot: spot.id, view });
  if (street === "turn") q.set("street", "turn");
  const label = street === "turn" ? turnViewLabel(view, spot.seats) : viewLabel(view, spot.seats);
  const target: DrillTarget = { kind: "library", spot: spot.id, view, street, about: `${spot.label}${spot.game ? ` (${gameLabel(spot)})` : ""} · ${label}`, to: `/practice?${q}` };
  const facts = plan.facts;
  const drill = facts ? drillStep(facts, target, plan.today, plan.game) : step;
  const next = { ...plan, drill };
  return { ...next, next: nextOf(next) };
}

// ---- the plan

const apartWords = (tour: number, exploit: number) =>
  tour || exploit
    ? `Left out of the leaks and the misses: ${[tour ? `${many(tour, "graded decision")} in tournament hands` : "", exploit ? `${many(exploit, "graded decision")} in hands from exploit sessions` : ""].filter(Boolean).join(" and ")}.`
    : null;

export function buildPlan({ now, mistakes, damaged = 0, hands, decisions, sessions }: PlanInput): Plan {
  const kept = new Map(hands.map((h) => [h.id, h]));
  const exploits = exploitImports(sessions);
  const ds: DecisionRecord[] = [];
  let [tour, exploit, gradedAll] = [0, 0, 0];
  for (const d of decisions) {
    const h = kept.get(d.handId);
    if (!h) continue;
    if (isEquilibriumHand(h, exploits)) ds.push(d);
    if (!isGraded(d)) continue;
    gradedAll++;
    if (h.tournament !== undefined) tour++;
    else if (exploits.has(h.importId)) exploit++;
  }
  const graded = gradedAll - tour - exploit;

  const game = gameOf(sessions);
  const { leaks: read, thin: few } = readLeaks(ds);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const rows = [...read, ...few];
  const tallies = tallyRows(rows, ds, byId);
  const leaks = read
    .map((l, i) => ({ ...leakStep(l, tallies[i]!), score: l.score }))
    .sort(byLost)
    .map(({ score: _, ...s }) => s);
  const thin = few
    .map((l, i) => thinStep(l, tallies[read.length + i]!, game))
    .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));

  const today = midnight(now);
  const recent = sessions.filter((s) => s.startedAt >= today && (s.kind === "practice" || s.kind === "drill"));
  const facts = drillFacts(countMisses(ds, kept, mistakes));
  const drill = facts && drillStep(facts, seatTarget(facts.street, facts.seat, game), recent, game);
  const reviews = reviewStep(mistakes, now);

  const steps = { reviews, leaks, thin, drill };
  const soon = mistakes.filter((m) => m.due !== null && !isDue(m, now)).sort((a, b) => a.due! - b.due!)[0];
  const notes = {
    reviews: !mistakes.length ? "No mistakes kept yet." : `Nothing is due today.${soon ? ` The next: ${dueWords(soon, now).toLowerCase()}.` : ""}`,
    leaks: !hands.length
      ? "No hands imported."
      : !gradedAll
        ? `${many(hands.length, "hand")} kept, none graded.`
        : !graded
          ? "Every graded decision is from a tournament or exploit session."
          : `No leak in ${many(graded, "graded decision")}.`,
    thin: graded ? "Nothing is waiting on more hands." : "Nothing graded yet.",
    drill: "No missed decision counted yet.",
  };

  const first = ((): PlanFirst | null => {
    if (reviews || leaks.length || thin.length || drill) return null;
    const practice = { to: "/practice", label: "Play hands in Practice" };
    const analyze = { to: "/analyze", label: "Import hands in Analyze" };
    if (!hands.length && mistakes.length) return { text: `Nothing due; ${many(mistakes.length, "mistake")} kept, all from tournament or exploit sessions.`, links: [practice, analyze] };
    if (!hands.length) return { text: "Nothing kept yet. Play hands or import some.", links: [practice, analyze] };
    if (!gradedAll) return { text: `${many(hands.length, "hand")} kept, none graded.`, links: [{ to: "/analyze", label: "Grade your hands in Analyze" }] };
    if (!graded) return { text: "Every graded decision is from a tournament or exploit session, which stay out of leaks.", links: [practice, analyze] };
    return { text: `Nothing to do yet over ${many(graded, "graded decision")}. Play more.`, links: [practice] };
  })();

  return { ...steps, next: nextOf(steps), first, notes, apart: apartWords(tour, exploit), damaged, today: recent, facts, game };
}
