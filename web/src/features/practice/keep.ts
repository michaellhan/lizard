// What's kept of a session played above one table, so a reload brings it back: one doc under one key in this browser, with
// the session and every table's hand and results, those set aside too. At one table nothing is kept, and a reload starts
// fresh as it always has. A hand's result and the totals it went into are in the one doc, written together or not at all,
// so a reload can't count a hand twice. A doc can outlive the code that wrote it, so it's read like anything else from
// outside: `keptTables` says what can be used, down to what's in each list, as the views draw what they're given and a
// throw there blanks the page on every load, and a hand that won't replay comes back as null, its table's results kept,
// for the Room to deal again. Pure: when the doc is written, and what's done about a lost hand, are the Room's.
import { isCell } from "@/data/shapes";
import { emptyTally, type PotTally } from "@/features/history/history";
import { SIZE_STREETS, type SizeStreet } from "@/features/solve/setup";
import { GRADE_RULES } from "@/grading/grade";
import { SEATS, seatsOf } from "@/poker/seats";
import { DECK, legal, NEED, noLines, recordOf, simulate, STREETS, withMove, type Lines, type Move, type Street } from "@/poker/table";
import { sourceLabel } from "@/solver/provenance";
import type { ResultSource } from "@/solver/types";
import { handWorks, isHandPot, isPotDrill, phaseOf, setupOf, type Decision, type HandResult, type HandTournament, type PracticeHand } from "./practice";
import type { PracticeSession } from "./session";
import { isExploit } from "./exploit";
import { isHandKey } from "./handFilter";
import { isTextureFilter } from "./texture";

export const KEPT_KEY = "practice.tables.v1";
export const MAX_TABLES = 4;

type Sources = PracticeSession["sources"];

/** A table's last finished hand, which outlasts it as the next is dealt (multitable.js:202). */
export interface LastHand {
  n: number;
  seat: string;
  result: HandResult;
}

export interface KeptTable {
  /** null as it's read back: the hand wouldn't replay, and is to be dealt again */
  hand: PracticeHand | null;
  stats: PotTally;
  /** what graded the decisions in `stats` (a doc written before it was kept has none, read as {}) */
  sources?: Sources;
  /** your last decision there (the range it came with isn't kept: a grid each save for one view of one decision) */
  last: Decision | null;
  lastHand: LastHand | null;
}

export interface KeptTables {
  v: 1;
  n: 2 | 3 | 4;
  /** the table in front */
  focus: number;
  session: PracticeSession;
  /** MAX_TABLES places: the tables in play, then any set aside at theirs, null where there's none */
  tables: (KeptTable | null)[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
const isStr = (x: unknown): x is string => typeof x === "string";
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isCountOf = (x: unknown): x is KeptTables["n"] => x === 2 || x === 3 || x === 4;
/** A list of `is` and nothing else (`every` alone steps over a hole in a list, which a view then reads). */
const isList = (x: unknown, is: (y: unknown) => boolean): x is unknown[] => Array.isArray(x) && [...x].every(is);
const isCards = (x: unknown): x is string[] => isList(x, (c) => DECK.includes(c as string));
/** unset, or as `is` says */
const opt = (x: unknown, is: (y: unknown) => boolean) => x === undefined || is(x);

const MOVES: readonly string[] = ["fold", "check", "call", "bet", "raise", "all-in"];
const isMove = (x: unknown): x is Move => isObj(x) && isStr(x.pos) && MOVES.includes(x.action as string) && opt(x.to, isNum);
const isLines = (x: unknown): x is Lines => isObj(x) && STREETS.every((s) => isList(x[s], isMove));

const isResult = (x: unknown): x is HandResult =>
  isObj(x) && isNum(x.net) && isBool(x.folded) && isList(x.winners, isStr) && isStr(x.says) && isObj(x.pays) && Object.values(x.pays).every(isNum) && opt(x.rake, isNum);
const isGrade = (x: unknown) =>
  isObj(x) && isCount(x.a) && isCount(x.best) && GRADE_RULES.some((r) => r.verdict === x.verdict) && isBool(x.ok) && isNum(x.loss) && isNum(x.lossPct) && isBool(x.byEv);
/** A source there are words for: a number shown with one the page can't name has no source. */
const isSource = (x: unknown) => isStr(sourceLabel(x as ResultSource));
const isSources = (x: unknown): x is Sources => isObj(x) && Object.entries(x).every(([k, n]) => isSource(k) && isCount(n));
/** Who answered, and its figures, which the badge prints with `toFixed`. */
const isProvenance = (x: unknown) => isObj(x) && isSource(x.source) && isBool(x.approximate) && [x.exploitabilityPct, x.targetPct, x.iterations, x.seconds, x.mbbPerHand].every((n) => opt(n, isNum));
/** An action of the answer's, as the decision's table draws it. */
const isMix = (x: unknown) => isObj(x) && isStr(x.action) && isNum(x.freq) && (x.ev === null || isNum(x.ev)) && opt(x.amount, isNum);
/** Your own sizes, a list of % of the pot for each street that has them. */
const isSizes = (x: unknown) => isObj(x) && Object.entries(x).every(([k, v]) => SIZE_STREETS.includes(k as SizeStreet) && isList(v, isNum));

/** A tournament's game, as a hand and a session hold it: prizes for prize equity, whose request is built from them. */
const isGame = (x: unknown): x is HandTournament =>
  isObj(x) &&
  (x.model === "chips" || (x.model === "icm" && isList(x.payouts, isNum) && (x.payouts as number[]).length > 1)) &&
  opt(x.payouts, (p) => isList(p, isNum)) &&
  opt(x.field, (f) => isObj(f) && isCount(f.players) && isNum(f.avg));

/** A decision as it was taken. A graded one must say what graded it: no number is shown without its source. One made
 * after Reveal has no grade, and keeps the answer that was seen with that answer's source. */
const isDecision = (x: unknown): x is Decision =>
  isObj(x) &&
  STREETS.includes(x.street as Street) &&
  isStr(x.chose) &&
  isMove(x.move) &&
  isList(x.mix, isMix) &&
  isNum(x.pot) &&
  isStr(x.study) &&
  opt(x.revealed, (r) => r === true) &&
  opt(x.offProfile, (r) => r === true) &&
  opt(x.pfWhy, isStr) &&
  (x.grade === null ? x.provenance === null || ((x.revealed === true || x.offProfile === true) && isProvenance(x.provenance)) : x.revealed === undefined && isGrade(x.grade) && isProvenance(x.provenance));

const isHand = (x: unknown): x is PracticeHand =>
  isObj(x) &&
  isNum(x.seed) &&
  isCount(x.n) &&
  isCount(x.players) &&
  isNum(x.stack) &&
  x.stack > 0 &&
  [0, 3, 4, 5].includes(x.shown as number) &&
  isLines(x.lines) &&
  isList(x.decisions, isDecision) &&
  (x.result === null || isResult(x.result)) &&
  opt(x.ante, isNum) &&
  opt(x.pot, isHandPot) &&
  opt(x.dealtTo, isHandKey) &&
  opt(x.noFit, (n) => n === true) &&
  opt(x.cands, (c) => isList(c, (l) => isList(l, isStr))) &&
  opt(x.tries, isCount) &&
  opt(x.stacks, (s) => isObj(s) && Object.values(s).every(isNum)) &&
  opt(x.rebuys, (r) => isList(r, isStr)) &&
  opt(x.sizes, isSizes) &&
  opt(x.rake, (r) => isObj(r) && isNum(r.pct) && opt(r.cap, isNum)) &&
  opt(x.run, (r) => r === "played" || r === "shown") &&
  opt(x.pushFold, (p) => p === true) &&
  opt(x.tournament, isGame) &&
  opt(x.exploit, isExploit) &&
  opt(x.pfSolve, (p) => p === true) &&
  (x.tournament === undefined || (isObj(x.stacks) && Object.keys(x.stacks).length === x.players)) &&
  opt(x.revealed, (r) => r === true);

/** You at the table, every seat with two cards and five on the board, all from one deck. */
function cardsFit(h: PracticeHand): boolean {
  const seats = seatsOf(h.players);
  if (!seats.includes(h.hero) || Object.keys(h.hands).length !== seats.length || h.board.length !== 5) return false;
  if (!seats.every((p) => isCards(h.hands[p]) && h.hands[p].length === 2)) return false;
  const cards = [...seats.flatMap((p) => h.hands[p]!), ...h.board];
  return new Set(cards).size === cards.length && isCards(cards);
}

/** The lines played again from the first move, each by the seat to act on a street that's open, and taken by the table as
 * the move it is (a size as far as the table rounds it, short of all-in: a minimum raise on carried chips isn't on the half
 * bb and could round up to the all-in it stopped short of, so it's asked for no more than the last half under that, for the
 * clamp to lift it back), and a table that can go on: an unfinished hand with nothing left to happen would wait for ever. */
function replays(h: PracticeHand): boolean {
  const t = setupOf(h);
  let lines = noLines();
  for (const street of STREETS) {
    for (const m of h.lines[street]) {
      if (NEED[street] > h.shown) return false;
      const sim = simulate(t, lines, NEED[street]);
      const size = m.to ?? 0;
      const allInTo = legal(t, sim)?.allInTo ?? 0;
      const r = recordOf(t, sim, { action: m.action, to: Math.min(size, Math.ceil(allInTo * 2) / 2 - 0.5), clamp: true });
      if (sim.current !== street || typeof r === "string" || r.pos !== m.pos || r.action !== m.action || Math.abs((r.to ?? 0) - size) > 0.25 || size >= allInTo) return false;
      lines = withMove(lines, street, m);
    }
  }
  return !!h.result || phaseOf(h).kind !== "over";
}

/** A hand read back, whole and playable, else null. Whatever's wrong with it, nothing here throws. */
export function keptHand(x: unknown): PracticeHand | null {
  try {
    return isHand(x) && cardsFit(x) && replays(x) ? x : null;
  } catch {
    return null;
  }
}

const isTally = (x: unknown): x is PotTally => isObj(x) && [x.hands, x.n, x.ok, x.ne, x.played].every(isCount) && [x.loss, x.lossPct, x.net].every(isNum);
const isLastHand = (x: unknown): x is LastHand => isObj(x) && isCount(x.n) && isStr(x.seat) && isResult(x.result);
const isScore = (x: unknown) => isObj(x) && [x.n, x.ok, x.ne, x.streak, x.best].every(isCount) && isNum(x.loss) && isNum(x.lossPct) && Array.isArray(x.recent);
const isOpts = (x: unknown) =>
  isObj(x) &&
  isStr(x.seat) &&
  isBool(x.preflopOnly) &&
  (x.pot === null || isPotDrill(x.pot)) &&
  isNum(x.ante) &&
  isBool(x.straddle) &&
  isBool(x.carry) &&
  (x.sizes === null || isSizes(x.sizes)) &&
  isNum(x.rake) &&
  isNum(x.rakeCap) &&
  opt(x.board, (b) => b === null || isTextureFilter(b)) &&
  opt(x.hand, (k) => k === null || handWorks(x.pot, k)) &&
  opt(x.pushFold, isBool) &&
  opt(x.tournament, (t) => isGame(t) && isObj(t) && isObj(t.stacks) && Object.values(t.stacks).every(isNum)) &&
  opt(x.exploit, isExploit) &&
  opt(x.pfSolve, isBool);
/** Your spot and its cards, and a decision that was graded: the list draws every entry's grade, and one not graded never goes in. */
const isReviewed = (x: unknown) =>
  isObj(x) && isCount(x.n) && opt(x.table, isCount) && isStr(x.seat) && isCount(x.players) && isCards(x.hole) && x.hole.length === 2 && isCards(x.board) && isStr(x.line) && isDecision(x.d) && x.d.grade !== null && opt(x.state, isObj) && opt(x.dealtTo, isHandKey);

const isCells = (x: unknown) => isObj(x) && Object.values(x).every(isCell);

const isSession = (x: unknown): x is PracticeSession =>
  isObj(x) &&
  isStr(x.id) &&
  isNum(x.startedAt) &&
  isCount(x.players) &&
  !!SEATS[x.players] &&
  isNum(x.stack) &&
  x.stack > 0 &&
  isOpts(x.opts) &&
  [x.dealt, x.tables, x.hands].every(isCount) &&
  isNum(x.net) &&
  isScore(x.score) &&
  isObj(x.byPot) &&
  Object.values(x.byPot).every(isTally) &&
  isSources(x.sources) &&
  opt(x.cells, isCells) &&
  isList(x.review, isReviewed) &&
  opt(x.revealed, isCount);

/** A place in the doc: a hand of another game is as lost as one that won't replay, since the table deals on from it. */
function keptTable(x: unknown, s: PracticeSession): KeptTable | null {
  if (!isObj(x)) return null;
  const hand = keptHand(x.hand);
  return {
    hand: hand?.players === s.players && hand.stack === s.stack ? hand : null,
    stats: isTally(x.stats) ? x.stats : emptyTally(),
    sources: isSources(x.sources) ? x.sources : {},
    last: isDecision(x.last) ? x.last : null,
    lastHand: isLastHand(x.lastHand) ? x.lastHand : null,
  };
}

/** The doc read back, or null where there's nothing to use: no doc, another version, or no session to go on with (a
 * session is all or nothing, as every total is in it). A bad hand doesn't lose the rest. */
export function keptTables(x: unknown): KeptTables | null {
  try {
    if (!isObj(x) || x.v !== 1 || !isCountOf(x.n) || !isSession(x.session) || !Array.isArray(x.tables)) return null;
    const { n, session, tables: raw } = x;
    const tables = Array.from({ length: MAX_TABLES }, (_, i) => keptTable(raw[i], session));
    // (hands are numbered from `dealt`, and a number names one hand: it can't be behind any on the tables)
    const dealt = Math.max(session.dealt, ...tables.map((t) => (t?.hand ? t.hand.n + 1 : 0)));
    return { v: 1, n, focus: isCount(x.focus) && x.focus < n ? x.focus : 0, session: { ...session, dealt }, tables };
  } catch {
    return null;
  }
}

/** Nothing a save would change: what's held is never changed in place, so an object that's the same is the same. */
export const sameKept = (a: KeptTables, b: KeptTables | null | undefined) =>
  !!b &&
  a.n === b.n &&
  a.focus === b.focus &&
  a.session === b.session &&
  a.tables.every((t, i) => {
    const o = b.tables[i];
    return t === o || (!!t && !!o && t.hand === o.hand && t.stats === o.stats && t.sources === o.sources && t.last === o.last && t.lastHand === o.lastHand);
  });
