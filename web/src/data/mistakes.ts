// Your mistakes kept for review (features/review/): one record a spot, in this browser's IndexedDB (db.ts). A record is
// read through `readMistake`, which either gives a whole one, every field of the type it says, or null: the page draws
// what it's given (a provenance's numbers go through toFixed), so a damaged record is counted and left out, and is never
// drawn or changed. Two tabs can miss or retry at once, so a change reads and writes in one transaction.
import type { Verdict } from "@/grading/grade";
import type { Provenance, ResultSource } from "@/solver/types";
import { db, type MistakeAsk, type MistakeRecord, type MistakeTry } from "./db";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isCount = (x: unknown): x is number => isNum(x) && Number.isInteger(x) && x >= 0;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStrs = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isOptNum = (x: unknown) => x === undefined || isNum(x);
const isOptStr = (x: unknown) => x === undefined || isStr(x);

const SOURCES: Record<ResultSource, true> = { library: true, "library-turn": true, instant: true, live: true, charts: true, "preflop-solve": true, rules: true, equity: true, unknown: true };
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
  [p.band, p.librarySpot, p.fallbackReason, p.approximateLabel, p.tournament, p.view, p.lock, p.sizing, p.confidence].every(isOptStr);

const isAsk = (x: unknown): x is MistakeAsk => {
  if (!isObj(x)) return false;
  if (x.via === "solver") return isObj(x.state) && isCount(x.state.players);
  return x.via === "library" && isStr(x.spot) && isStr(x.flop) && isStrs(x.path) && Array.isArray(x.combo) && x.combo.length === 2 && x.combo.every(isCount) && isOptStr(x.version) && (x.turn === undefined || (isObj(x.turn) && isStr(x.turn.card) && isStrs(x.turn.at)));
};

const isMix = (x: unknown): x is MistakeRecord["mix"] =>
  Array.isArray(x) && x.length > 0 && x.every((m) => isObj(m) && isStr(m.action) && isNum(m.freq) && (m.ev === null || isNum(m.ev)) && isOptNum(m.amount));

const isGrade = (g: unknown, mix: readonly unknown[]): g is MistakeRecord["grade"] =>
  isObj(g) && isCount(g.a) && g.a < mix.length && isCount(g.best) && g.best < mix.length && isMiss(g.verdict) && g.ok === false && isBool(g.mixed) && isNum(g.loss) && isNum(g.lossPct) && isBool(g.byEv);

const isTry = (t: unknown): t is MistakeTry =>
  isObj(t) && isNum(t.at) && isStr(t.chose) && VERDICTS.includes(t.verdict as string) && isBool(t.ok) && isBool(t.byEv) && isNum(t.loss) && isNum(t.lossPct) && isStr(t.source) && isStr(t.label) && isBool(t.like) && isBool(t.moved);

/** A stored or restored record, whole and of the types it says, else null. Nothing here throws. */
export function readMistake(x: unknown): MistakeRecord | null {
  if (!isObj(x)) return null;
  const { id, from, sessionId, street, at, lastAt, updatedAt, times, seat, players, game, hole, board, line, study, ask, chose, mix, pot, grade, provenance, step, due, tries } = x;
  const fits =
    isStr(id) && !!id && (from === "hand" || from === "drill") && isStr(sessionId) && isStr(street) && isNum(at) && isNum(lastAt) && isNum(updatedAt) && isCount(times) &&
    isStr(seat) && isCount(players) && isStr(game) && isStrs(hole) && hole.length === 2 && isStrs(board) && isStr(line) && (study === null || isStr(study)) && isAsk(ask) &&
    isStr(chose) && isMix(mix) && isNum(pot) && isGrade(grade, mix) && (provenance === null || isProvenance(provenance)) && isCount(step) && (due === null || isNum(due)) &&
    Array.isArray(tries) && tries.every(isTry);
  return fits ? (x as unknown as MistakeRecord) : null;
}

/** A spot's record added, or, the same spot missed again, `merge` of the two. A damaged record there is replaced. */
export async function keepMistake(fresh: MistakeRecord, merge: (was: MistakeRecord, fresh: MistakeRecord) => MistakeRecord): Promise<void> {
  const d = await db();
  if (!d) return;
  const tx = d.transaction("mistakes", "readwrite");
  const was = readMistake(await tx.store.get(fresh.id));
  await tx.store.put(was ? merge(was, fresh) : fresh);
  await tx.done;
}

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
