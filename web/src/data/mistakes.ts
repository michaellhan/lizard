// Your mistakes kept for review (features/review/): one record a spot, in this browser's IndexedDB (db.ts). A record is
// read through `readMistake`, which either gives a whole one, every field of the type it says, or null: the page draws
// what it's given (a provenance's numbers go through toFixed), so a damaged record is counted and left out, and is never
// drawn or changed. Two tabs can miss or retry at once, so a change reads and writes in one transaction.
import type { Verdict } from "@/grading/grade";
import type { Provenance, ResultSource } from "@/solver/types";
import { db, deleteRecord, type MistakeAsk, type MistakeRecord, type MistakeTry } from "./db";
import { isCard, isWellFormed } from "./shapes";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isCount = (x: unknown): x is number => isNum(x) && Number.isInteger(x) && x >= 0;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStrs = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isOptNum = (x: unknown) => x === undefined || isNum(x);
const isOptStr = (x: unknown) => x === undefined || isStr(x);

const SOURCES: Record<ResultSource, true> = { library: true, "library-turn": true, instant: true, live: true, charts: true, "preflop-solve": true, "push-fold": true, "best-response": true, "node-lock": true, "profile-solve": true, "plo-river": true, rules: true, equity: true, unknown: true };
/** One of the sources a provenance can name. */
export const isSource = (x: string): x is ResultSource => Object.hasOwn(SOURCES, x);
const VERDICTS: readonly string[] = ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"] satisfies Verdict[];
/** the grades kept: the ones that aren't Best or Correct */
export const MISSES: readonly Verdict[] = ["Inaccuracy", "Mistake", "Blunder"];
const isMiss = (x: unknown): x is Verdict => MISSES.includes(x as Verdict);

const isProvenance = (p: unknown): p is Provenance =>
  isObj(p) &&
  isStr(p.source) &&
  Object.hasOwn(SOURCES, p.source) &&
  isBool(p.approximate) &&
  isBool(p.partial) &&
  isStr(p.mode) &&
  isStr(p.transport) &&
  isStr(p.solverVersion) &&
  isNum(p.receivedAt) &&
  [p.exploitabilityPct, p.targetPct, p.iterations, p.seconds, p.mbbPerHand].every(isOptNum) &&
  [p.band, p.librarySpot, p.libraryVersion, p.fallbackReason, p.approximateLabel, p.tournament, p.view, p.lock, p.lockRange, p.exploit, p.sizing, p.confidence, p.evIn, p.keptLabel].every(isOptStr);

const isAsk = (x: unknown): x is MistakeAsk => {
  if (!isObj(x)) return false;
  if (x.via === "solver") return isObj(x.state) && isCount(x.state.players);
  // (`hand` goes in a link)
  if (x.via === "kept") return isWellFormed(x.hand) && !!x.hand && isStr(x.decision) && !!x.decision;
  return x.via === "library" && isStr(x.spot) && isStr(x.flop) && isStrs(x.path) && Array.isArray(x.combo) && x.combo.length === 2 && x.combo.every(isCount) && isOptStr(x.version) && (x.turn === undefined || (isObj(x.turn) && isStr(x.turn.card) && isStrs(x.turn.at)));
};

const isMix = (x: unknown): x is MistakeRecord["mix"] =>
  Array.isArray(x) && x.length > 0 && x.every((m) => isObj(m) && isStr(m.action) && isNum(m.freq) && (m.ev === null || isNum(m.ev)) && isOptNum(m.amount) && (m.rough === undefined || m.rough === true));

const isGrade = (g: unknown, mix: readonly unknown[]): g is MistakeRecord["grade"] =>
  isObj(g) && isCount(g.a) && g.a < mix.length && isCount(g.best) && g.best < mix.length && isMiss(g.verdict) && g.ok === false && isBool(g.mixed) && isNum(g.loss) && isNum(g.lossPct) && isBool(g.byEv) && (g.capped === undefined || isBool(g.capped));

/** The decisions a record says it holds: each named, missed at least once, and no more of them than its misses. */
const isHeld = (x: unknown, times: number) => {
  if (!isObj(x)) return false;
  const counts = Object.entries(x);
  return counts.every(([id, n]) => !!id && isCount(n) && n > 0) && counts.reduce((t, [, n]) => t + (n as number), 0) <= times;
};

const isTry = (t: unknown): t is MistakeTry =>
  isObj(t) && isNum(t.at) && isStr(t.chose) && VERDICTS.includes(t.verdict as string) && isBool(t.ok) && isBool(t.byEv) && isNum(t.loss) && isNum(t.lossPct) && isStr(t.source) && isStr(t.label) && isOptStr(t.version) && isBool(t.like) && isBool(t.moved);

/** A stored or restored record, whole and of the types it says, else null. Nothing here throws. */
export function readMistake(x: unknown): MistakeRecord | null {
  if (!isObj(x)) return null;
  const { id, from, tournament, exploit, sessionId, street, at, lastAt, updatedAt, times, decisions, seat, players, game, hole, board, line, study, ask, chose, mix, pot, grade, provenance, step, due, tries } = x;
  const fits =
    isStr(id) && !!id && (from === "hand" || from === "drill" || from === "analyze" || from === "leak") && (tournament === undefined || tournament === "icm" || tournament === "chips") && (exploit === undefined || isWellFormed(exploit)) && isStr(sessionId) && isStr(street) && isNum(at) && isNum(lastAt) && isNum(updatedAt) && isCount(times) && (decisions === undefined || isHeld(decisions, times as number)) &&
    isStr(seat) && isCount(players) && isStr(game) && isStrs(hole) && hole.length === 2 && hole.every(isCard) && isStrs(board) && board.every(isCard) && isStr(line) && (study === null || isStr(study)) && isAsk(ask) &&
    isStr(chose) && isMix(mix) && isNum(pot) && isGrade(grade, mix) && (provenance === null ? (ask as MistakeAsk).via !== "kept" : isProvenance(provenance)) && isCount(step) && (due === null || isNum(due)) &&
    Array.isArray(tries) && tries.every(isTry);
  return fits ? (x as unknown as MistakeRecord) : null;
}

/** The graded decisions a record holds, each with how many of its `times` came from it. A record from before they were
 * kept holds its `ask`'s, and all its times are that decision's. */
export const heldDecisions = (m: Pick<MistakeRecord, "decisions" | "ask" | "times">): Record<string, number> => m.decisions ?? (m.ask.via === "kept" ? { [m.ask.decision]: m.times } : {});

/** What makes two records one spot though their ids differ; null where a record is only ever its id. It's passed in, as it
 * reads a Study line (review/mistakes.ts spotKey) and this file is in the first download. */
export type SpotKey = (m: MistakeRecord) => string | null;
const noKey: SpotKey = () => null;

/** The record kept for this spot under another id, gone through once as the queue is small. */
function sameSpot(all: readonly unknown[], key: string, keyOf: SpotKey): MistakeRecord | null {
  for (const x of all) {
    const m = readMistake(x);
    if (m && keyOf(m) === key) return m;
  }
  return null;
}

/** A spot's record added, or, the same spot missed again, `merge` of the two. A damaged record there is replaced. The
 * spot's found by id, else by `keyOf`, so a record's id never changes. Whether it was kept: a browser with no database
 * keeps nothing. */
export async function keepMistake(fresh: MistakeRecord, merge: (was: MistakeRecord, fresh: MistakeRecord) => MistakeRecord, keyOf: SpotKey = noKey): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  const tx = d.transaction("mistakes", "readwrite");
  const key = keyOf(fresh);
  const was = readMistake(await tx.store.get(fresh.id)) ?? (key === null ? null : sameSpot(await tx.store.getAll(), key, keyOf));
  await tx.store.put(was ? merge(was, fresh) : fresh);
  await tx.done;
  return true;
}

/** A spot added by hand: one already kept stays as it is, its date with it (adding isn't missing it again). What became of
 * it: "added", "there" where it's kept already, or null where this browser keeps nothing. */
export async function addMistake(fresh: MistakeRecord, keyOf: SpotKey = noKey): Promise<"added" | "there" | null> {
  const d = await db();
  if (!d) return null;
  const tx = d.transaction("mistakes", "readwrite");
  const key = keyOf(fresh);
  const there = readMistake(await tx.store.get(fresh.id)) !== null || (key !== null && sameSpot(await tx.store.getAll(), key, keyOf) !== null);
  if (!there) await tx.store.put(fresh);
  await tx.done;
  return there ? "there" : "added";
}

/** A record taken out of the queue, its retries with it. Whether this browser could: a damaged one goes the same way. */
export const deleteMistake = (id: string): Promise<boolean> => deleteRecord("mistakes", id);

/** Every record, and how many couldn't be read, the latest missed first. */
export async function listMistakes(): Promise<{ list: MistakeRecord[]; damaged: number }> {
  const d = await db();
  if (!d) return { list: [], damaged: 0 };
  const all = await d.getAll("mistakes");
  const list = all.map(readMistake).filter((m): m is MistakeRecord => m !== null);
  return { list: list.sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id)), damaged: all.length - list.length };
}

/** A record changed: the latest as stored, so another tab's retry isn't lost. Undefined where it's gone or damaged. */
export async function changeMistake(id: string, f: (m: MistakeRecord) => MistakeRecord): Promise<MistakeRecord | undefined> {
  const d = await db();
  if (!d) return undefined;
  const tx = d.transaction("mistakes", "readwrite");
  const was = readMistake(await tx.store.get(id));
  const next = was ? f(was) : undefined;
  if (next) await tx.store.put(next);
  await tx.done;
  return next;
}
