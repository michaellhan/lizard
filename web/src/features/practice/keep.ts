// What's kept of a session played above one table, so a reload brings it back: one doc under one key in this browser, with
// the session and every table's hand and results, those set aside too. At one table nothing is kept, and a reload starts
// fresh as it always has. A hand's result and the totals it went into are in the one doc, written together or not at all,
// so a reload can't count a hand twice. A doc can outlive the code that wrote it, so it's read like anything else from
// outside: `keptTables` says what can be used, and a hand that won't replay comes back as null, its table's results kept,
// for the Room to deal again. Pure: when the doc is written, and what's done about a lost hand, are the Room's.
import { emptyTally, type PotTally } from "@/features/history/history";
import { SEATS, seatsOf } from "@/poker/seats";
import { DECK, NEED, noLines, recordOf, simulate, STREETS, withMove, type Lines, type Move, type Street } from "@/poker/table";
import { isPotDrill, phaseOf, setupOf, type Decision, type HandResult, type PracticeHand } from "./practice";
import type { PracticeSession } from "./session";

export const KEPT_KEY = "practice.tables.v1";
export const MAX_TABLES = 4;

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
/** unset, or as `is` says */
const opt = (x: unknown, is: (y: unknown) => boolean) => x === undefined || is(x);

const MOVES: readonly string[] = ["fold", "check", "call", "bet", "raise", "all-in"];
const isMove = (x: unknown): x is Move => isObj(x) && isStr(x.pos) && MOVES.includes(x.action as string) && opt(x.to, isNum);
const isLines = (x: unknown): x is Lines => isObj(x) && STREETS.every((s) => Array.isArray(x[s]) && x[s].every(isMove));

const isResult = (x: unknown): x is HandResult => isObj(x) && isNum(x.net) && isBool(x.folded) && Array.isArray(x.winners) && isStr(x.says) && isObj(x.pays) && opt(x.rake, isNum);
const isGrade = (x: unknown) => isObj(x) && isCount(x.a) && isCount(x.best) && isStr(x.verdict) && isBool(x.ok) && isNum(x.loss) && isNum(x.lossPct) && isBool(x.byEv);
const isProvenance = (x: unknown) => isObj(x) && isStr(x.source) && isBool(x.approximate);

/** A decision as it was taken. A graded one must say what graded it: no number is shown without its source. */
const isDecision = (x: unknown): x is Decision =>
  isObj(x) &&
  STREETS.includes(x.street as Street) &&
  isStr(x.chose) &&
  isMove(x.move) &&
  Array.isArray(x.mix) &&
  isNum(x.pot) &&
  isStr(x.study) &&
  (x.grade === null ? x.provenance === null : isGrade(x.grade) && isProvenance(x.provenance));

const isHand = (x: unknown): x is PracticeHand =>
  isObj(x) &&
  isNum(x.seed) &&
  isCount(x.n) &&
  isCount(x.players) &&
  isNum(x.stack) &&
  x.stack > 0 &&
  [0, 3, 4, 5].includes(x.shown as number) &&
  isLines(x.lines) &&
  Array.isArray(x.decisions) &&
  x.decisions.every(isDecision) &&
  (x.result === null || isResult(x.result)) &&
  opt(x.ante, isNum) &&
  opt(x.pot, isPotDrill) &&
  opt(x.tries, isCount) &&
  opt(x.stacks, (s) => isObj(s) && Object.values(s).every(isNum)) &&
  opt(x.rebuys, (r) => Array.isArray(r) && r.every(isStr)) &&
  opt(x.sizes, isObj) &&
  opt(x.rake, (r) => isObj(r) && isNum(r.pct)) &&
  opt(x.run, (r) => r === "played" || r === "shown");

/** You at the table, every seat with two cards and five on the board, all from one deck. */
function cardsFit(h: PracticeHand): boolean {
  const seats = seatsOf(h.players);
  if (!seats.includes(h.hero) || Object.keys(h.hands).length !== seats.length || h.board.length !== 5) return false;
  if (!seats.every((p) => Array.isArray(h.hands[p]) && h.hands[p].length === 2)) return false;
  const cards = [...seats.flatMap((p) => h.hands[p]!), ...h.board];
  return new Set(cards).size === cards.length && cards.every((c) => DECK.includes(c));
}

/** The lines played again from the first move, each by the seat to act on a street that's open, and taken by the table as
 * the move it is (a size as far as the table rounds it: a minimum raise on carried chips isn't on the half bb), and a table
 * that can go on: an unfinished hand with nothing left to happen would wait for ever. */
function replays(h: PracticeHand): boolean {
  const t = setupOf(h);
  let lines = noLines();
  for (const street of STREETS) {
    for (const m of h.lines[street]) {
      if (NEED[street] > h.shown) return false;
      const sim = simulate(t, lines, NEED[street]);
      const r = recordOf(t, sim, { action: m.action, to: m.to, clamp: true });
      if (sim.current !== street || typeof r === "string" || r.pos !== m.pos || r.action !== m.action || Math.abs((r.to ?? 0) - (m.to ?? 0)) > 0.25) return false;
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
  (x.sizes === null || isObj(x.sizes)) &&
  isNum(x.rake) &&
  isNum(x.rakeCap);
const isReviewed = (x: unknown) =>
  isObj(x) && isCount(x.n) && opt(x.table, isCount) && isStr(x.seat) && isCount(x.players) && Array.isArray(x.hole) && Array.isArray(x.board) && isStr(x.line) && isDecision(x.d);

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
  isObj(x.sources) &&
  Array.isArray(x.review) &&
  x.review.every(isReviewed);

/** A place in the doc: a hand of another game is as lost as one that won't replay, since the table deals on from it. */
function keptTable(x: unknown, s: PracticeSession): KeptTable | null {
  if (!isObj(x)) return null;
  const hand = keptHand(x.hand);
  return {
    hand: hand?.players === s.players && hand.stack === s.stack ? hand : null,
    stats: isTally(x.stats) ? x.stats : emptyTally(),
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
    return t === o || (!!t && !!o && t.hand === o.hand && t.stats === o.stats && t.last === o.last && t.lastHand === o.lastHand);
  });
