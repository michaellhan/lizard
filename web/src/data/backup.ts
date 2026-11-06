// Backup and restore: everything kept in this browser (saved spots with their answers, saved ranges, saved drills, saved scenarios, session history, the
// mistakes kept for review with their schedule, the hands imported into Analyze with your tags and notes, and their
// grades) in one JSON file.
// Each record is written in the classic app's shape (solver/gto/static/store.js): { id, v, created, updated, dev,
// data }, so a later account sync (ROADMAP Phase 11) can take the same records. Restore merges as classic does: a
// record missing here is added, of two with one id the later `updated` stays, and nothing here is deleted.
// Settings are not in the backup (they're a handful of choices, and restoring them would change this browser's).
//
// What was deleted stays deleted (db.ts Tombstone). A backup carries its tombstones in classic's shape, { id, v, updated,
// dev, deleted: true }, beside its records rather than among them, so an older page leaves them unread and the schema
// stands. A record is left out where a tombstone, here or in the file, is later than its `updated`; one changed after its
// delete comes back, on the same rule a sync's newer-wins will need.
//
// A tombstone in a file never deletes a record kept here, and that's the one place a restore and a sync must differ. A file
// is anything anyone hands you, a restore has always added and never taken away, and the worst a bad file can then do is
// fail to add: a sync's deletions are another matter, as they'd arrive authenticated by the account's key. So a file's
// tombstone blocks a restore of what it names, in this file and any after, where that isn't here; of a record that is
// here it says so and leaves it, as a tombstone beside a live record would drop it from this browser's next backups. It
// names one id of a store a backup carries, so it can't reach settings, and it only takes what room the bound leaves, so it
// can't push out a deletion made here.
import { db, kvGet, kvSet, LAST_CHANGED, MAX_TOMBSTONES, tombstonesOf, type DecisionRecord, type HandRecord, type MistakeRecord, type SavedAnswer, type SavedDrill, type SavedRange, type SavedReport, type SavedScenario, type SavedSpot, type SessionRecord, type Tombstone, type TombstoneStore } from "./db";
import { readMistake } from "./mistakes";
import { isDrillLink, newId } from "./saved";
import { isOptTags, isTime, isWellFormed, validDecision, validHand, validRange, validSession, validSpot, validTombstone } from "./shapes";

export const BACKUP_FORMAT = "lizard-backup";
/** the record shape's version (`v`); a backup of a later schema is refused rather than half read */
export const BACKUP_SCHEMA = 1;

export interface BackupRecord<T> {
  id: string;
  v: number;
  created: number;
  updated: number;
  /** the browser that last wrote it */
  dev: string;
  data: T;
}

interface StoreData {
  savedSpots: SavedSpot;
  savedAnswers: SavedAnswer;
  savedRanges: SavedRange;
  sessions: SessionRecord;
  hands: HandRecord;
  decisions: DecisionRecord;
  savedDrills: SavedDrill;
  savedScenarios: SavedScenario;
  savedReports: SavedReport;
  mistakes: MistakeRecord;
}
export type BackupStore = keyof StoreData;
// (a backup made before hands, drills, scenarios, reports, mistakes or answers were in it has no "hands", "decisions", "savedDrills",
// "savedScenarios", "savedReports", "mistakes" or "savedAnswers": those restore nothing. A store added is no new record
// shape: an older page leaves it unread, and its answers just don't come back there.)
export const BACKUP_STORES: readonly BackupStore[] = ["savedSpots", "savedAnswers", "savedRanges", "savedDrills", "savedScenarios", "savedReports", "sessions", "hands", "decisions", "mistakes"];

/** A deletion in a backup: a classic tombstone, with `updated` the time it was deleted. */
export interface BackupTombstone {
  id: string;
  v: number;
  updated: number;
  /** the browser that deleted it */
  dev: string;
  deleted: true;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schema: number;
  exported: string;
  device: string;
  counts: Record<BackupStore, number>;
  stores: { [S in BackupStore]: BackupRecord<StoreData[S]>[] };
  /** by store; none in a backup from before deletions were remembered, or of one item */
  tombstones?: { [S in BackupStore]?: BackupTombstone[] };
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const obj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** This file is in the first script, as the error page's backup needs it, and a scenario's reader brings Practice's rules
 * with it: so a restore loads it, before its transactions, which an import would end. */
let readScenario: ((x: unknown) => unknown) | undefined;
let readReport: ((x: unknown) => unknown) | undefined;
let readAnswer: ((x: unknown) => unknown) | undefined;

/** Each store's times, what a record must hold to be restored (a damaged or foreign one is skipped), and what's done to
 * one as it comes in. */
const SHAPES: { [S in BackupStore]: { created: (d: StoreData[S]) => number; valid: (d: Record<string, unknown>) => boolean; arrives?: (d: StoreData[S]) => StoreData[S] } } = {
  savedSpots: {
    created: (d) => d.createdAt,
    valid: validSpot,
  },
  savedAnswers: {
    created: (d) => d.savedAt,
    valid: (d) => !!readAnswer?.(d),
    // (nothing can prove a file's answer was solved here, so it says where it came from, whatever the file says)
    arrives: (d) => ({ ...d, restored: true }),
  },
  savedRanges: {
    created: (d) => d.createdAt,
    valid: validRange,
  },
  savedDrills: {
    created: (d) => d.createdAt,
    valid: (d) =>
      isStr(d.name) && (d.kind === "library" || d.kind === "leak") && isStr(d.to) && isDrillLink(d.kind, d.to) && isStr(d.about) && isStr(d.note) && isOptTags(d.tags) &&
      isTime(d.createdAt) && isTime(d.updatedAt),
  },
  savedScenarios: {
    created: (d) => d.createdAt,
    valid: (d) => !!readScenario?.(d),
  },
  savedReports: {
    created: (d) => d.createdAt,
    valid: (d) => !!readReport?.(d),
  },
  sessions: {
    created: (d) => d.startedAt,
    valid: validSession,
  },
  hands: {
    created: (d) => d.importedAt,
    valid: validHand,
  },
  decisions: {
    created: (d) => d.gradedAt,
    valid: validDecision,
  },
  mistakes: {
    created: (d) => d.at,
    valid: (d) => readMistake(d) !== null,
  },
};

/** This browser's id (made once, kept in kv). */
export async function deviceId(): Promise<string> {
  const have = await kvGet<string>("device");
  if (have) return have;
  const id = newId();
  await kvSet("device", id);
  return id;
}

/** These records, by store, as a backup file; a store not named holds none. */
export function backupOf(records: { [S in BackupStore]?: StoreData[S][] }, dev: string, now: () => number = Date.now, graves: readonly Tombstone[] = []): Backup {
  const stores = {} as Backup["stores"];
  const counts = {} as Backup["counts"];
  for (const s of BACKUP_STORES) {
    const all = (records[s] ?? []) as { id: string }[];
    const shape = SHAPES[s] as unknown as { created: (d: unknown) => number };
    const updated = LAST_CHANGED[s] as (d: unknown) => number;
    (stores as Record<string, BackupRecord<unknown>[]>)[s] = all.map((x) => ({ id: x.id, v: BACKUP_SCHEMA, created: shape.created(x), updated: updated(x), dev, data: x }));
    counts[s] = all.length;
  }
  const tombstones: NonNullable<Backup["tombstones"]> = {};
  for (const t of graves) (tombstones[t.store] ??= []).push({ id: t.id, v: BACKUP_SCHEMA, updated: t.at, dev: t.dev ?? dev, deleted: true });
  return { format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, exported: new Date(now()).toISOString(), device: dev, counts, stores, tombstones };
}

/** Whether `data` is a sound record of store `s`: what a restore and a sync both ask of what comes in. */
export const recordValid = (s: BackupStore, data: Record<string, unknown>): boolean => SHAPES[s].valid(data);

/** Everything kept here, as a backup. */
export async function makeBackup(now: () => number = Date.now): Promise<Backup> {
  const d = await db();
  // (with no database a backup would be an empty file that reads as a good one)
  if (!d) throw new Error("This browser's saved data can't be read here.");
  const dev = await deviceId();
  const records: Record<string, unknown[]> = {};
  for (const s of BACKUP_STORES) records[s] = await d.getAll(s);
  // (after the records: a delete between the two then leaves a record with its tombstone, which a restore leaves out, and
  // not a record that seems never to have been deleted)
  return backupOf(records, dev, now, await d.getAll("tombstones"));
}

/** One saved item as a backup file, restored the way a whole backup is: a spot with the answer kept with it. */
export async function itemBackup<S extends "savedSpots" | "savedRanges" | "savedDrills" | "savedScenarios" | "savedReports">(store: S, item: StoreData[S], now: () => number = Date.now): Promise<Backup> {
  const d = await db();
  if (!d) throw new Error("This browser's saved data can't be read here.");
  const answer = store === "savedSpots" ? await d.get("savedAnswers", item.id) : undefined;
  return backupOf({ [store]: [item], ...(answer ? { savedAnswers: [answer] } : {}) }, await deviceId(), now);
}

export interface RestoreCount {
  added: number;
  updated: number;
  /** here already, as new or newer */
  kept: number;
  /** damaged or not Lizard's: a tombstone too */
  skipped: number;
  /** left out: deleted after this copy last changed, as this browser remembers or the file says */
  deleted: number;
  /** kept here, though the file says they were deleted after they last changed: a restore deletes nothing */
  stillHere: number;
}

const noCount = (): RestoreCount => ({ added: 0, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });

/** A store's tombstones in a file, by id, the latest of each, and how many aren't tombstones at all. */
function fileTombstones(tombstones: unknown, s: BackupStore, now: number): { named: Map<string, { at: number; dev?: string }>; bad: number } {
  const named = new Map<string, { at: number; dev?: string }>();
  const list = obj(tombstones) ? tombstones[s] : undefined;
  if (list === undefined) return { named, bad: 0 };
  if (!Array.isArray(list)) return { named, bad: 1 };
  let bad = 0;
  for (const t of list as unknown[]) {
    if (!validTombstone(t, now)) bad++;
    else if (t.updated > (named.get(t.id)?.at ?? -Infinity)) named.set(t.id, { at: t.updated, ...(t.dev ? { dev: t.dev } : {}) });
  }
  return { named, bad };
}

/** A restore that the browser stopped partway: `done` is what's in. Each store is a transaction, so the one that failed
 * took nothing, and running the file again takes what's left. */
export class RestoreStopped extends Error {
  constructor(
    readonly done: Record<BackupStore, RestoreCount>,
    override readonly cause: unknown,
  ) {
    super("The restore stopped partway.");
  }
}

/** What a file says was deleted, remembered here where the record isn't: see the top of this file. It fills the room the
 * bound leaves, the latest first, and never pushes out a deletion remembered here. */
async function remember(s: BackupStore, named: Map<string, { at: number; dev?: string }>, c: RestoreCount, { store, graves, updated, max }: { store: { get: (id: string) => Promise<unknown> }; graves: TombstoneStore; updated: (d: unknown) => number; max: number }): Promise<void> {
  const fresh: Tombstone[] = [];
  for (const [id, t] of named) {
    const here = await store.get(id);
    if (here !== undefined) {
      if (t.at > updated(here)) c.stillHere++;
      continue;
    }
    const was = await graves.get([s, id]);
    if (!was) fresh.push({ store: s, id, ...t });
    else if (t.at > was.at) await graves.put({ store: s, id, ...t });
  }
  const room = max - (await graves.index("byAge").count(tombstonesOf(s)));
  fresh.sort((a, b) => b.at - a.at);
  for (const t of fresh.slice(0, Math.max(room, 0))) await graves.put(t);
}

/** A backup's records merged in, and what it says was deleted remembered: see the top of this file. Throws where the file
 * isn't a Lizard backup this version can read, and RestoreStopped where the browser stops it partway. */
export async function restoreBackup(file: unknown, { now = Date.now, maxTombstones = MAX_TOMBSTONES }: { now?: () => number; maxTombstones?: number } = {}): Promise<Record<BackupStore, RestoreCount>> {
  if (!obj(file) || file.format !== BACKUP_FORMAT || !obj(file.stores)) throw new Error("That isn't a Lizard backup file.");
  if (!isNum(file.schema) || file.schema > BACKUP_SCHEMA)
    throw new Error(`That backup was written by a newer Lizard (record version ${String(file.schema)}); update the page and try again.`);
  const d = await db();
  if (!d) throw new Error("This browser keeps no data here (IndexedDB is unavailable, as in some private modes).");
  readScenario = (await import("./scenarios")).readScenario;
  readReport = (await import("./reports")).readReport;
  readAnswer = (await import("./answers")).readAnswer;
  const out = Object.fromEntries(BACKUP_STORES.map((s) => [s, noCount()])) as Record<BackupStore, RestoreCount>;
  for (const s of BACKUP_STORES) {
    const c = noCount();
    const { named, bad } = fileTombstones(file.tombstones, s, now());
    c.skipped += bad;
    const held = (file.stores as Record<string, unknown>)[s];
    const recs: unknown[] = Array.isArray(held) ? held : [];
    if (!Array.isArray(held) && !named.size) {
      out[s] = c;
      continue;
    }
    const shape = SHAPES[s] as unknown as { valid: (d: Record<string, unknown>) => boolean; arrives?: (d: unknown) => unknown };
    const updated = LAST_CHANGED[s] as (d: unknown) => number;
    // (the record and what's said of its deletion, read and written as one: each store is still a transaction of its own)
    const tx = d.transaction([s, "tombstones"], "readwrite");
    const store = tx.objectStore(s) as unknown as {
      get: (id: string) => Promise<unknown>;
      put: (v: unknown) => Promise<unknown>;
    };
    const graves = tx.objectStore("tombstones") as unknown as TombstoneStore;
    try {
      for (const r of recs) {
        if (!obj(r) || !isWellFormed(r.id) || !r.id || r.deleted || !obj(r.data) || r.data.id !== r.id || !shape.valid(r.data)) {
          c.skipped++;
          continue;
        }
        const here = await store.get(r.id);
        const changed = updated(r.data);
        if (here !== undefined && !(changed > updated(here))) {
          c.kept++;
          continue;
        }
        // (a grade goes with its hand, which comes first in BACKUP_STORES: there are more of them than the bound holds)
        const hand = s === "decisions" ? (await graves.get(["hands", (r.data as unknown as DecisionRecord).handId]))?.at : undefined;
        if (Math.max((await graves.get([s, r.id]))?.at ?? -Infinity, named.get(r.id)?.at ?? -Infinity, hand ?? -Infinity) > changed) {
          c.deleted++;
          continue;
        }
        await store.put(shape.arrives ? shape.arrives(r.data) : r.data);
        if (here === undefined) c.added++;
        else c.updated++;
      }
      await remember(s, named, c, { store, graves, updated, max: maxTombstones });
      await tx.done;
    } catch (e) {
      tx.done.catch(() => undefined);
      try {
        tx.abort();
      } catch {
        // (it's already over)
      }
      throw new RestoreStopped(out, e);
    }
    out[s] = c;
  }
  return out;
}

/** "3 added, 1 updated, 2 kept" over every store, for the page. */
export function restoreSummary(r: Record<BackupStore, RestoreCount>): string {
  const t = noCount();
  for (const s of BACKUP_STORES) for (const k of Object.keys(t) as (keyof RestoreCount)[]) t[k] += r[s][k];
  const parts = [`${t.added} added`, `${t.updated} updated`, `${t.kept} kept (as new or newer here)`];
  if (t.deleted) parts.push(`${t.deleted} left out because ${t.deleted === 1 ? "it was" : "they were"} deleted after that copy`);
  if (t.skipped) parts.push(`${t.skipped} skipped (damaged or not Lizard's)`);
  if (t.stillHere) parts.push(`${t.stillHere} still here though the file says ${t.stillHere === 1 ? "it was" : "they were"} deleted elsewhere, as a restore deletes nothing`);
  return parts.join(", ");
}

/** The file name for a backup made now; `kind` names one that isn't everything. */
export function backupFileName(now: Date = new Date(), kind = "backup"): string {
  return `lizard-${kind}-${now.toISOString().slice(0, 10)}.json`;
}

