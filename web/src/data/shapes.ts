// What a record must hold to come in from a backup, store by store: every field a page reads, of the type it reads it
// as, as `readMistake` (mistakes.ts) does for a kept mistake. The pages draw what's stored, so one object where a string
// should be blanks a page on every load (React can't draw it), and a card that isn't one, a time no Date can hold or a
// lone surrogate in a link throws the same way. Nothing here throws, and a real record of any version passes: a field
// added later is optional here too, and the fields every version wrote are required.
import { SEATS } from "@/poker/seats";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isCount = (x: unknown): x is number => isNum(x) && Number.isInteger(x) && x >= 0;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStrs = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isOptNum = (x: unknown) => x === undefined || isNum(x);
const isOptStr = (x: unknown) => x === undefined || isStr(x);
const isOptBool = (x: unknown) => x === undefined || isBool(x);
/** kept as null where it's unknown (JSON writes NaN as null) */
const isNumOrNull = (x: unknown) => x === undefined || x === null || isNum(x);
/** a time a Date can hold: `toISOString` throws past these */
export const isTime = (x: unknown): x is number => isNum(x) && Math.abs(x) <= 8.64e15;
/** `encodeURIComponent` throws on a lone surrogate, and JSON can write one */
export const isWellFormed = (x: unknown): x is string => isStr(x) && !/\p{Cs}/u.test(x);

const CARD = "[2-9TJQKA][shdc]";
const CARD_RE = new RegExp(`^${CARD}$`);
const HOLE_RE = new RegExp(`^(?:${CARD}){2}$`);
const BOARD_RE = new RegExp(`^(?:${CARD})*$`);
/** one card as `PlayingCard` draws it (it throws on any other suit) */
export const isCard = (x: unknown): x is string => isStr(x) && CARD_RE.test(x);
/** two cards as a combo's row writes them */
export const isHole = (x: unknown): x is string => isStr(x) && HOLE_RE.test(x);

export function validSpot(d: Record<string, unknown>): boolean {
  const seen = d.seen === undefined || (isObj(d.seen) && isStr(d.seen.source) && isStr(d.seen.label));
  return isStr(d.title) && isStr(d.line) && isObj(d.state) && isStrs(d.tags) && isStr(d.note) && seen && isTime(d.createdAt) && isTime(d.updatedAt);
}

/** The tags of a kind that had none at first: a record kept before them has none. */
export const isOptTags = (x: unknown): boolean => x === undefined || isStrs(x);

export const validRange = (d: Record<string, unknown>): boolean =>
  isStr(d.name) && isStr(d.text) && isNum(d.combos) && isStr(d.note) && isOptTags(d.tags) && isTime(d.createdAt) && isTime(d.updatedAt);

/** A pot as a decision or a hand is named: History's order. */
export const POT_NAMES: readonly string[] = ["Unopened", "Limped", "SRP", "3bet pot", "4bet+ pot"];
export const isPotName = (x: unknown): x is string => isStr(x) && POT_NAMES.includes(x);
/** A seat at any table, in action order: every table's seats are among the nine-handed one's. */
export const SEAT_NAMES: readonly string[] = SEATS[9]!;
export const isSeatName = (x: unknown): x is string => isStr(x) && SEAT_NAMES.includes(x);

/** What a cell (history.ts `GradeCell`) must hold to be counted: some decisions, on a street, against something, on one
 * basis, no more of them right than there are, and no EV lost below nothing. */
export const isCellCounts = (c: Record<string, unknown>): boolean =>
  ["preflop", "flop", "turn", "river"].includes(c.street as string) &&
  isWellFormed(c.source) &&
  isBool(c.byEv) &&
  isCount(c.n) &&
  c.n > 0 &&
  isCount(c.ok) &&
  c.ok <= c.n &&
  [c.loss, c.lossPct].every((x) => isNum(x) && x >= 0);

/** A whole cell as it's kept; its seat, pot and versions came later, so each may be missing. */
export const isCell = (x: unknown): boolean =>
  isObj(x) &&
  isCellCounts(x) &&
  (x.seat === undefined || isSeatName(x.seat)) &&
  (x.pot === undefined || isPotName(x.pot)) &&
  (x.versions === undefined || (isObj(x.versions) && Object.values(x.versions).every(isCount)));

/** Cells can't hold more decisions than their session graded; they hold fewer where it began before they were kept. */
export const cellsFit = (ns: readonly number[], decisions: number): boolean => ns.reduce((a, n) => a + n, 0) <= decisions;

// A session's `meta` is open: what's read of it, by key. A field read through a guard (byPot, sources, versions) isn't
// here, and cells have their own check below.
const META_NUMBERS = ["hands", "net", "ok", "graded", "lossPct", "players", "stack", "ante", "rake", "rakeCap", "best", "acc", "evLossBb", "evLossPct", "comboAcc", "total", "tables"];
const META_TEXT = ["spot", "view", "label", "leak", "line", "source", "actor", "street", "drill", "seat", "hand"];

const isScore = (x: unknown): boolean =>
  isObj(x) && [x.n, x.ok, x.loss, x.lossPct, x.ne, x.streak, x.best].every(isNum) && Array.isArray(x.recent) && x.recent.every(isNum);

const isSessionCells = (x: unknown, decisions: number): boolean => {
  if (!isObj(x)) return false;
  const cells = Object.values(x);
  return cells.every(isCell) && cellsFit(cells.map((c) => (c as { n: number }).n), decisions);
};

export function validSession(d: Record<string, unknown>): boolean {
  const { meta } = d;
  if (!isObj(meta)) return false;
  return (
    ["practice", "drill", "analysis", "build", "tournament", "tournament-chips", "exploit"].includes(d.kind as string) &&
    isTime(d.startedAt) &&
    (d.endedAt === undefined || d.endedAt === null || isTime(d.endedAt)) &&
    isNum(d.decisions) &&
    isNum(d.evLossBb) &&
    META_NUMBERS.every((k) => isNumOrNull(meta[k])) &&
    META_TEXT.every((k) => meta[k] === undefined || meta[k] === null || isWellFormed(meta[k])) &&
    (meta.done === undefined || isStrs(meta.done)) &&
    (meta.exploit === undefined || (isObj(meta.exploit) && isStr(meta.exploit.profile) && isObj(meta.exploit.lock) && Object.values(meta.exploit.lock).every(isNum))) &&
    (meta.score === undefined || isScore(meta.score)) &&
    (meta.cells === undefined || isSessionCells(meta.cells, d.decisions as number))
  );
}

/** A Practice hand's rake and sizes: they go into its Study links. */
const isHandSetup = (x: unknown): boolean =>
  isObj(x) && isOptNum(x.rake) && isOptNum(x.rakeCap) && (x.sizes === undefined || (isObj(x.sizes) && Object.values(x.sizes).every((v) => Array.isArray(v) && v.every(isNum))));

export function validHand(d: Record<string, unknown>): boolean {
  return (
    [d.site, d.number, d.played, d.hero, d.bb, d.potType, d.end, d.text, d.importId, d.importName].every(isStr) &&
    isStr(d.hole) && HOLE_RE.test(d.hole) &&
    isStr(d.board) && BOARD_RE.test(d.board) &&
    isCount(d.players) && d.players >= 2 && d.players <= 9 &&
    isNum(d.pot) &&
    isCount(d.decisions) &&
    isTime(d.playedAt) &&
    isTime(d.importedAt) &&
    (d.updatedAt === undefined || isTime(d.updatedAt)) &&
    isOptStr(d.tournament) &&
    (d.playedFor === undefined || d.playedFor === "preflop") &&
    (d.revealed === undefined || isStrs(d.revealed)) &&
    (d.setup === undefined || isHandSetup(d.setup)) &&
    (d.tags === undefined || isStrs(d.tags)) &&
    isOptStr(d.note)
  );
}

const isMix = (x: unknown): boolean =>
  x === undefined || (Array.isArray(x) && x.every((m) => Array.isArray(m) && m.length === 3 && isStr(m[0]) && isNum(m[1]) && (m[2] === null || isNum(m[2]))));

const isRead = (r: unknown): boolean =>
  r === undefined ||
  (isObj(r) && isStr(r.verdict) && isStr(r.source) && isStr(r.label) && isOptStr(r.version) && isOptStr(r.confidence) && isOptStr(r.triageSource) && isNumOrNull(r.evLossBb) && isOptNum(r.freq) && isMix(r.mix));

export function validDecision(d: Record<string, unknown>): boolean {
  return (
    [d.handId, d.pos, d.action, d.verdict, d.source, d.label].every(isStr) &&
    ["preflop", "flop", "turn", "river"].includes(d.street as string) &&
    isTime(d.gradedAt) &&
    (d.i === undefined || isCount(d.i)) &&
    isNumOrNull(d.evLossBb) &&
    isNumOrNull(d.lossPct) &&
    isNumOrNull(d.pot) &&
    [d.freq, d.bestFreq].every(isOptNum) &&
    [d.byEv, d.facing, d.ip, d.multi, d.flopAggr, d.ownBet, d.approximate, d.capped, d.roughEv].every(isOptBool) &&
    // (a grade from before versions were kept has none)
    [d.situation, d.potType, d.role, d.matched, d.best, d.note, d.why, d.version, d.band, d.off, d.confidence, d.triageSource, d.notChecked].every(isOptStr) &&
    isMix(d.mix) &&
    (d.roughEvs === undefined || isStrs(d.roughEvs)) &&
    isRead(d.read)
  );
}
