// Backup and restore: everything kept in this browser (saved spots with their answers, saved ranges, saved drills, saved scenarios, session history, the
// mistakes kept for review with their schedule, the hands imported into Analyze with your tags and notes, and their
// grades) in one JSON file.
// Each record is written in the classic app's shape (solver/gto/static/store.js): { id, v, created, updated, dev,
// data }, so a later account sync (ROADMAP Phase 11) can take the same records. Restore merges as classic does: a
// record missing here is added, of two with one id the later `updated` stays, and nothing here is deleted.
// Settings are not in the backup (they're a handful of choices, and restoring them would change this browser's).
import { db, kvGet, kvSet, type DecisionRecord, type HandRecord, type MistakeRecord, type SavedAnswer, type SavedDrill, type SavedRange, type SavedReport, type SavedScenario, type SavedSpot, type SessionRecord } from "./db";
import { readMistake } from "./mistakes";
import { isDrillLink, newId } from "./saved";
import { isOptTags, isTime, isWellFormed, validDecision, validHand, validRange, validSession, validSpot } from "./shapes";

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

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schema: number;
  exported: string;
  device: string;
  counts: Record<BackupStore, number>;
  stores: { [S in BackupStore]: BackupRecord<StoreData[S]>[] };
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
const SHAPES: { [S in BackupStore]: { created: (d: StoreData[S]) => number; updated: (d: StoreData[S]) => number; valid: (d: Record<string, unknown>) => boolean; arrives?: (d: StoreData[S]) => StoreData[S] } } = {
  savedSpots: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: validSpot,
  },
  savedAnswers: {
    created: (d) => d.savedAt,
    updated: (d) => d.savedAt,
    valid: (d) => !!readAnswer?.(d),
    // (nothing can prove a file's answer was solved here, so it says where it came from, whatever the file says)
    arrives: (d) => ({ ...d, restored: true }),
  },
  savedRanges: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: validRange,
  },
  savedDrills: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: (d) =>
      isStr(d.name) && (d.kind === "library" || d.kind === "leak") && isStr(d.to) && isDrillLink(d.kind, d.to) && isStr(d.about) && isStr(d.note) && isOptTags(d.tags) &&
      isTime(d.createdAt) && isTime(d.updatedAt),
  },
  savedScenarios: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: (d) => !!readScenario?.(d),
  },
  savedReports: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: (d) => !!readReport?.(d),
  },
  sessions: {
    created: (d) => d.startedAt,
    updated: (d) => d.endedAt ?? d.startedAt,
    valid: validSession,
  },
  hands: {
    created: (d) => d.importedAt,
    updated: (d) => d.updatedAt ?? d.importedAt,
    valid: validHand,
  },
  decisions: {
    created: (d) => d.gradedAt,
    updated: (d) => d.gradedAt,
    valid: validDecision,
  },
  mistakes: {
    created: (d) => d.at,
    updated: (d) => d.updatedAt,
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
export function backupOf(records: { [S in BackupStore]?: StoreData[S][] }, dev: string, now: () => number = Date.now): Backup {
  const stores = {} as Backup["stores"];
  const counts = {} as Backup["counts"];
  for (const s of BACKUP_STORES) {
    const all = (records[s] ?? []) as { id: string }[];
    const shape = SHAPES[s] as unknown as { created: (d: unknown) => number; updated: (d: unknown) => number };
    (stores as Record<string, BackupRecord<unknown>[]>)[s] = all.map((x) => ({ id: x.id, v: BACKUP_SCHEMA, created: shape.created(x), updated: shape.updated(x), dev, data: x }));
    counts[s] = all.length;
  }
  return { format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, exported: new Date(now()).toISOString(), device: dev, counts, stores };
}

/** Everything kept here, as a backup. */
export async function makeBackup(now: () => number = Date.now): Promise<Backup> {
  const d = await db();
  // (with no database a backup would be an empty file that reads as a good one)
  if (!d) throw new Error("This browser's saved data can't be read here.");
  const dev = await deviceId();
  const records: Record<string, unknown[]> = {};
  for (const s of BACKUP_STORES) records[s] = await d.getAll(s);
  return backupOf(records, dev, now);
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
  /** damaged or not Lizard's */
  skipped: number;
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

/** A backup's records merged in. Throws where the file isn't a Lizard backup this version can read, and RestoreStopped
 * where the browser stops it partway. */
export async function restoreBackup(file: unknown): Promise<Record<BackupStore, RestoreCount>> {
  if (!obj(file) || file.format !== BACKUP_FORMAT || !obj(file.stores)) throw new Error("That isn't a Lizard backup file.");
  if (!isNum(file.schema) || file.schema > BACKUP_SCHEMA)
    throw new Error(`That backup was written by a newer Lizard (record version ${String(file.schema)}); update the page and try again.`);
  const d = await db();
  if (!d) throw new Error("This browser keeps no data here (IndexedDB is unavailable, as in some private modes).");
  readScenario = (await import("./scenarios")).readScenario;
  readReport = (await import("./reports")).readReport;
  readAnswer = (await import("./answers")).readAnswer;
  const out = Object.fromEntries(BACKUP_STORES.map((s) => [s, { added: 0, updated: 0, kept: 0, skipped: 0 }])) as Record<BackupStore, RestoreCount>;
  for (const s of BACKUP_STORES) {
    const c: RestoreCount = { added: 0, updated: 0, kept: 0, skipped: 0 };
    const recs = (file.stores as Record<string, unknown>)[s];
    if (!Array.isArray(recs)) continue;
    const shape = SHAPES[s] as unknown as { updated: (d: unknown) => number; valid: (d: Record<string, unknown>) => boolean; arrives?: (d: unknown) => unknown };
    const tx = d.transaction(s, "readwrite");
    const store = tx.objectStore(s) as unknown as {
      get: (id: string) => Promise<unknown>;
      put: (v: unknown) => Promise<unknown>;
    };
    try {
      for (const r of recs) {
        if (!obj(r) || !isWellFormed(r.id) || !r.id || r.deleted || !obj(r.data) || r.data.id !== r.id || !shape.valid(r.data)) {
          c.skipped++;
          continue;
        }
        const here = await store.get(r.id);
        const data = shape.arrives ? shape.arrives(r.data) : r.data;
        if (here === undefined) {
          await store.put(data);
          c.added++;
        } else if (shape.updated(r.data) > shape.updated(here)) {
          await store.put(data);
          c.updated++;
        } else c.kept++;
      }
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
  const t = { added: 0, updated: 0, kept: 0, skipped: 0 };
  for (const s of BACKUP_STORES) for (const k of Object.keys(t) as (keyof RestoreCount)[]) t[k] += r[s][k];
  const parts = [`${t.added} added`, `${t.updated} updated`, `${t.kept} kept (as new or newer here)`];
  if (t.skipped) parts.push(`${t.skipped} skipped (damaged or not Lizard's)`);
  return parts.join(", ");
}

/** The file name for a backup made now; `kind` names one that isn't everything. */
export function backupFileName(now: Date = new Date(), kind = "backup"): string {
  return `lizard-${kind}-${now.toISOString().slice(0, 10)}.json`;
}

