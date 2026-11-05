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
import { BASES, basisOf, isGraded, isOk, LEAK_RULE, leakTest, MIN_READ, readLeaks, type Leak } from "@/features/analyze/report";
import { exploitImports, isEquilibriumHand } from "@/features/analyze/sessions";
import { STREET_ORDER } from "@/features/history/progress";
import type { DrillStreet, DrillView } from "@/features/practice/drills";
import { turnViewLabel, viewLabel } from "@/features/practice/drills";
import { linkSetup, setupLink, type LinkSetup, type PlayKind } from "@/features/practice/setupLink";
import { dueQueue, dueWords, isDue, midnight, REVIEW_DAYS } from "@/features/review/schedule";
import { gameLabel, isDrillable, storedTurnFlops, type LibrarySpotIndex } from "@/library/catalog";
import { SEATS, seatLabel } from "@/poker/seats";
import { sourceLabel } from "@/solver/provenance";

/** the table and depth a generated session is set to */
const TABLE = 6;
const STACK = 100;
/** the decisions in a generated drill, in sessions started today, that mark it done */
export const DRILL_TARGET = 20;
/** the rows too few to read that are listed before "Show more" */
export const THIN_SHOWN = 6;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pair = ([a, b]: readonly [number, number]) => `${pct(a)} to ${pct(b)}`;
const bbs = (x: number) => `${(Math.round(x * 100) / 100).toFixed(2)}bb`;
const many = (n: number, one: string, more = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : more}`;
const CHARTS = BASES[0]!;

export const PLAN_RULE: readonly string[] = [
  "Reviews due today, from the review queue: the longest overdue first, then the worst grades.",
  "The leaks that pass the read rule, the most EV given up first. A leak graded by frequency has no EV to weigh, so those come after, by the report's score: how far off, by the square root of the decisions.",
  "The rows too few to read, the most decisions first, as the nearest to being read: places to collect more hands, not leaks.",
  `One Practice drill, on the street with the most decisions missed and from the seat with the most missed on it. Misses are counted, not weighed: a miss by frequency counts as one by EV, and it's a count, so what you play most can top it. A missed decision is one graded below Correct in hands you imported, or a cash mistake kept in the review queue, as many times as it was missed. An entry added from Analyze or a leak drill isn't counted again where its own decision already is.`,
];

export const PLAN_SCOPE = `This is a rule, not a coach: it counts what's kept in this browser, the same way every time, and can't say why you miss a spot. Tournament hands and exploit sessions stay out of the leaks and the count of misses: a tournament's EVs aren't bb won, and an exploit session answers an assumed profile, never an equilibrium. EV given up is solver EV over graded decisions, not what you won or lost at the table.`;

export const PLAN_DONE = `A step is marked done only by what's kept: reviews when none is left due and one has moved on today, a leak when every decision of it that can be dealt has been answered in its drill, and the Practice drill at ${DRILL_TARGET} decisions in sessions started today. Rows too few to read have no mark: each leaves the plan when its decisions can be read.`;

export { LEAK_RULE };

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
  /** the EV given up over its decisions graded by EV, bb; null with none graded by EV */
  lost: number | null;
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
  const held = queue.filter((m) => m.ask.via === "kept").length;
  const retry = !held ? "A retry is graded against the answer there is now." : held === queue.length ? "A retry is graded against the answer kept with its decision, nothing solved." : `A retry is graded against the answer there is now, or, for the ${held.toLocaleString()} from Analyze or a leak drill, against the answer kept with its decision.`;
  const bases = new Map<string, number>();
  for (const m of queue) add(bases, mistakeBasis(m));
  const tour = queue.filter((m) => m.tournament).length;
  const exploit = queue.filter((m) => m.exploit).length;
  const says = [
    ...(queue.length
      ? [
          `${many(queue.length, "mistake")} due from the review queue (${REVIEW_DAYS.join(", ")} days apart): ${byEv.toLocaleString()} first graded by EV, ${(queue.length - byEv).toLocaleString()} by frequency with no EV. ${retry}`,
          basisWords(bases),
        ]
      : []),
    ...(tour || exploit
      ? [`The queue is dates and takes every kind: ${[tour ? `${tour.toLocaleString()} from tournament sessions` : "", exploit ? `${exploit.toLocaleString()} from exploit sessions` : ""].filter(Boolean).join(" and ")} are in this count, and their grades stay in their own lists in Review.`]
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
  const out = rows.map((): RowTally => ({ n: 0, ev: 0, lost: 0, rough: 0, bases: new Map(), streets: new Map(), pots: new Map(), dealt: 0, left: 0, unread: 0 }));
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
      if (hasEv) {
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
  if (!t.ev) return `No EV to weigh: all ${many(t.n, "decision")} graded by frequency, so it's ranked after the leaks with an EV.`;
  const rest = t.n - t.ev;
  return `${bbs(t.lost)} of solver EV given up over ${many(t.ev, "decision")} graded by EV${rest ? `; the other ${rest.toLocaleString()} were graded by frequency and count none` : ""}.`;
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
    progress: t.dealt ? `${answered.toLocaleString()} of ${many(t.dealt, "decision")} answered in its drill${t.unread ? `, ${t.unread.toLocaleString()} of them graded by frequency and dealt though the read above can't use them` : ""}.` : "None of its decisions keeps its mix, so its drill has nothing to deal.",
    says: [readingOf(l, t), costOf(t), standsOn(l, t)],
    leak,
    lost: t.ev && t.lost > 0 ? Math.round(t.lost * 100) / 100 : null,
    dealt: t.dealt,
  };
}

/** The most EV given up first; with none, by the report's score; a name settles the rest. */
const byLost = (a: LeakStep & { score: number }, b: LeakStep & { score: number }) =>
  (b.lost ?? -1) - (a.lost ?? -1) || b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- collecting more hands

const seatedSetup = (play: PlayKind, seat: string): { link: LinkSetup; setup: ScenarioSetup } => {
  // (a seat that isn't at the table generated sits at the smallest that has it)
  const players = seat === "moves" || SEATS[TABLE]!.includes(seat) ? TABLE : Number(Object.keys(SEATS).find((p) => SEATS[Number(p)]!.includes(seat)));
  const link = { play, seat, players, stack: STACK };
  return { link, setup: linkSetup(link)! };
};

const setupTarget = (play: PlayKind, seat: string): DrillTarget => {
  const { link, setup } = seatedSetup(play, seat);
  return { kind: "setup", setup, about: scenarioWords(setup), to: setupLink(link) };
};

/** Where more of a row can be played: the street and pot most of its decisions are. */
function collectPlay(t: RowTally): PlayKind {
  const street = ranked(t.streets, STREET_ORDER)[0]?.[0];
  if (street === "preflop") return "preflop";
  const pot = ranked(t.pots)[0]?.[0];
  return pot === "SRP" ? "srp" : pot === "3bet pot" ? "3bet" : "full";
}

function thinStep(l: Leak, t: RowTally): ThinStep {
  const target = setupTarget(collectPlay(t), "moves");
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
        ? `Too few to read, and not a leak: ${many(l.n, "graded decision")}, ${short.toLocaleString()} short of the ${MIN_READ} it takes.`
        : `Too few to read, and not a leak: ${many(l.n, "graded decision")}, and its 95% interval still reaches the leak's line.`,
      standsOn(l, t),
      `The link plays ${target.about}. A hand there counts here once it's kept and graded in Analyze.`,
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
    ? "Dealt from the flop library, each answered at once with no solve."
    : street === "preflop"
      ? "Each decision is graded against the preflop charts, by frequency, not a solve."
      : "These are hands in that pot, and each decision shows what answered it as you play.";

interface DrillFacts {
  street: string;
  seat: string;
  seatMiss: Miss;
  streetMisses: number;
  total: number;
}

function drillStep(f: DrillFacts, target: DrillTarget, today: readonly SessionRecord[]): DrillStep {
  const { street, seat, seatMiss: m } = f;
  const name = seatLabel(seat, TABLE);
  const count = drilledToday(target, today);
  const where = `${STREET_WORD[street]} from ${name}`;
  return {
    kind: "drill",
    id: "drill",
    what: `Practice ${where}`,
    title: `Practice ${where}`,
    to: target.to,
    done: count >= DRILL_TARGET,
    progress: `${Math.min(count, DRILL_TARGET).toLocaleString()} of ${DRILL_TARGET} decisions in this drill in sessions started today.`,
    says: [
      `The most misses are on ${STREET_WORD[street]}: ${f.streetMisses.toLocaleString()} of the ${many(f.total, "miss", "misses")} counted, ${m.n.toLocaleString()} of them from ${name}.`,
      `Those ${m.n.toLocaleString()}: ${m.graded.toLocaleString()} in hands graded in Analyze, ${m.kept.toLocaleString()} kept in the review queue; ${m.byEv.toLocaleString()} by EV, ${(m.n - m.byEv).toLocaleString()} by frequency. ${basisWords(m.bases)}`,
      `Settings: ${target.about}. ${answeredBy(target, street)}`,
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
const seatTarget = (street: string, seat: string) => setupTarget(street === "preflop" ? "preflop" : "srp", seat);

/** The library's spot for a seat on a street, out of position or in: a plain game's first where one has it. */
export function librarySpotFor(spots: readonly LibrarySpotIndex[], seat: string, street: string): LibrarySpotIndex | null {
  if (street !== "flop" && street !== "turn") return null;
  const fits = spots.filter((s) => isDrillable(s) && s.seats.includes(seat) && (street === "flop" || storedTurnFlops(s).length > 0));
  return fits.find((s) => !s.game) ?? fits[0] ?? null;
}

/** The first step left to do (a leak with nothing to deal can't be: it stays listed, and isn't next). */
const nextOf = (p: Pick<Plan, "reviews" | "leaks" | "thin" | "drill">): PlanStep | null => [p.reviews, ...p.leaks, ...p.thin, p.drill].find((s) => s && !s.done && (s.kind !== "leak" || s.dealt > 0)) ?? null;

/** The plan with its drill read from the library, where it holds the street and seat: answered at once and no solve.
 * Without the library, or a spot for the seat, the drill stays a session of hands. */
export function withLibrary(plan: Plan, spots: readonly LibrarySpotIndex[]): Plan {
  const step = plan.drill;
  const spot = step && librarySpotFor(spots, step.seat, step.street);
  if (!step || !spot) return plan;
  const street = step.street as DrillStreet;
  const view: DrillView = spot.seats.indexOf(step.seat) === 0 ? "oop" : "ip";
  const q = new URLSearchParams({ tab: "drills", spot: spot.id, view });
  if (street === "turn") q.set("street", "turn");
  const label = street === "turn" ? turnViewLabel(view, spot.seats) : viewLabel(view, spot.seats);
  const target: DrillTarget = { kind: "library", spot: spot.id, view, street, about: `${spot.label}${spot.game ? ` (${gameLabel(spot)})` : ""} · ${label}`, to: `/practice?${q}` };
  const facts = plan.facts;
  const drill = facts ? drillStep(facts, target, plan.today) : step;
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

  const { leaks: read, thin: few } = readLeaks(ds);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const rows = [...read, ...few];
  const tallies = tallyRows(rows, ds, byId);
  const leaks = read
    .map((l, i) => ({ ...leakStep(l, tallies[i]!), score: l.score }))
    .sort(byLost)
    .map(({ score: _, ...s }) => s);
  const thin = few
    .map((l, i) => thinStep(l, tallies[read.length + i]!))
    .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));

  const today = midnight(now);
  const recent = sessions.filter((s) => s.startedAt >= today && (s.kind === "practice" || s.kind === "drill"));
  const facts = drillFacts(countMisses(ds, kept, mistakes));
  const drill = facts && drillStep(facts, seatTarget(facts.street, facts.seat), recent);
  const reviews = reviewStep(mistakes, now);

  const steps = { reviews, leaks, thin, drill };
  const soon = mistakes.filter((m) => m.due !== null && !isDue(m, now)).sort((a, b) => a.due! - b.due!)[0];
  const notes = {
    reviews: !mistakes.length ? "No mistake kept yet, so nothing can come due." : `Nothing is due today.${soon ? ` The next: ${dueWords(soon, now).toLowerCase()}.` : ""}`,
    leaks: !hands.length
      ? "No hands imported, so there's no leak to read."
      : !gradedAll
        ? `${many(hands.length, "hand")} kept and none graded: leaks are read from graded decisions.`
        : !graded
          ? "No graded decision left to read a leak from: every one is in a tournament hand or an exploit session."
          : `No leak passes the read rule over your ${many(graded, "graded decision")}.`,
    thin: graded ? "Nothing is waiting on more hands." : "Nothing to collect yet: this needs graded decisions.",
    drill: "No missed decision counted yet.",
  };

  const first = ((): PlanFirst | null => {
    if (reviews || leaks.length || thin.length || drill) return null;
    const practice = { to: "/practice", label: "Play hands in Practice" };
    const analyze = { to: "/analyze", label: "Import hands in Analyze" };
    if (!hands.length && mistakes.length) return { text: `Nothing is due, and what's kept here (${many(mistakes.length, "mistake")}) is from tournament or exploit sessions, which stay out of the leaks. Play hands in Practice, or import cash hands in Analyze, to read one.`, links: [practice, analyze] };
    if (!hands.length) return { text: "Nothing is kept in this browser to make a plan from. Start with either: a hand played in Practice is graded as you go, and anything below Correct comes to Review; hands you import in Analyze are graded there, and leaks are read from them.", links: [practice, analyze] };
    if (!gradedAll) return { text: `You have ${many(hands.length, "hand")} kept and none graded. Grade them in Analyze: the charts and the flop library answer most of them with no solve.`, links: [{ to: "/analyze", label: "Grade your hands in Analyze" }] };
    if (!graded) return { text: "Every graded decision kept here is in a tournament hand or an exploit session, and those stay out of the leaks. Play hands in Practice, or import cash hands in Analyze, to read one.", links: [practice, analyze] };
    return { text: `Your ${many(graded, "graded decision")} leave no step to take: nothing due, no leak to read, and no miss counted. Play more, and this fills in.`, links: [practice] };
  })();

  return { ...steps, next: nextOf(steps), first, notes, apart: apartWords(tour, exploit), damaged, today: recent, facts };
}
