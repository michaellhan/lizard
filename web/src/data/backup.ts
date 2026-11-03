// Backup and restore: everything kept in this browser (saved spots, saved ranges, saved drills, session history, the
// hands imported into Analyze with your tags and notes, and their grades) in one JSON file.
// Each record is written in the classic app's shape (solver/gto/static/store.js): { id, v, created, updated, dev,
// data }, so a later account sync (ROADMAP Phase 11) can take the same records. Restore merges as classic does: a
// record missing here is added, of two with one id the later `updated` stays, and nothing here is deleted.
// Settings are not in the backup (they're a handful of choices, and restoring them would change this browser's).
import { db, kvGet, kvSet, type DecisionRecord, type HandRecord, type SavedDrill, type SavedRange, type SavedSpot, type SessionRecord } from "./db";
import { isDrillLink, newId } from "./saved";

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
  savedRanges: SavedRange;
  sessions: SessionRecord;
  hands: HandRecord;
  decisions: DecisionRecord;
  savedDrills: SavedDrill;
}
export type BackupStore = keyof StoreData;
// (a backup made before hands or drills were in it has no "hands", "decisions" or "savedDrills": those restore nothing)
export const BACKUP_STORES: readonly BackupStore[] = ["savedSpots", "savedRanges", "savedDrills", "sessions", "hands", "decisions"];

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

/** Each store's times, and what a record must hold to be restored (a damaged or foreign one is skipped). */
const SHAPES: { [S in BackupStore]: { created: (d: StoreData[S]) => number; updated: (d: StoreData[S]) => number; valid: (d: Record<string, unknown>) => boolean } } = {
  savedSpots: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: (d) => isStr(d.title) && isStr(d.line) && obj(d.state) && Array.isArray(d.tags) && isStr(d.note) && isNum(d.createdAt) && isNum(d.updatedAt),
  },
  savedRanges: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: (d) => isStr(d.name) && isStr(d.text) && isNum(d.combos) && isStr(d.note) && isNum(d.createdAt) && isNum(d.updatedAt),
  },
  savedDrills: {
    created: (d) => d.createdAt,
    updated: (d) => d.updatedAt,
    valid: (d) =>
      isStr(d.name) && (d.kind === "library" || d.kind === "leak") && isStr(d.to) && isDrillLink(d.kind, d.to) && isStr(d.about) && isStr(d.note) &&
      isNum(d.createdAt) && isNum(d.updatedAt),
  },
  sessions: {
    created: (d) => d.startedAt,
    updated: (d) => d.endedAt ?? d.startedAt,
    valid: (d) =>
      ["practice", "drill", "analysis", "build"].includes(d.kind as string) && isNum(d.startedAt) && isNum(d.decisions) && isNum(d.evLossBb) && obj(d.meta),
  },
  hands: {
    created: (d) => d.importedAt,
    updated: (d) => d.updatedAt ?? d.importedAt,
    valid: (d) =>
      isStr(d.site) && isStr(d.hero) && isStr(d.hole) && isStr(d.board) && isStr(d.text) && isStr(d.importId) && isNum(d.importedAt) && isNum(d.playedAt) && isStr(d.played) &&
      (d.tags === undefined || (Array.isArray(d.tags) && d.tags.every(isStr))) && (d.note === undefined || isStr(d.note)),
  },
  decisions: {
    created: (d) => d.gradedAt,
    updated: (d) => d.gradedAt,
    valid: (d) => isStr(d.handId) && isStr(d.street) && isStr(d.verdict) && isStr(d.source) && isStr(d.label) && isNum(d.gradedAt),
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

/** Everything kept here, as a backup. */
export async function makeBackup(now: () => number = Date.now): Promise<Backup> {
  const d = await db();
  const dev = await deviceId();
  const stores = {} as Backup["stores"];
  const counts = {} as Backup["counts"];
  for (const s of BACKUP_STORES) {
    const all = (d ? await d.getAll(s) : []) as StoreData[typeof s][];
    const shape = SHAPES[s] as (typeof SHAPES)[BackupStore];
    (stores as Record<string, BackupRecord<unknown>[]>)[s] = all.map((x) => ({
      id: x.id,
      v: BACKUP_SCHEMA,
      created: (shape.created as (d: unknown) => number)(x),
      updated: (shape.updated as (d: unknown) => number)(x),
      dev,
      data: x,
    }));
    counts[s] = all.length;
  }
  return { format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, exported: new Date(now()).toISOString(), device: dev, counts, stores };
}

export interface RestoreCount {
  added: number;
  updated: number;
  /** here already, as new or newer */
  kept: number;
  /** damaged or not Lizard's */
  skipped: number;
}

/** A backup's records merged in. Throws where the file isn't a Lizard backup this version can read. */
export async function restoreBackup(file: unknown): Promise<Record<BackupStore, RestoreCount>> {
  if (!obj(file) || file.format !== BACKUP_FORMAT || !obj(file.stores)) throw new Error("That isn't a Lizard backup file.");
  if (!isNum(file.schema) || file.schema > BACKUP_SCHEMA)
    throw new Error(`That backup was written by a newer Lizard (record version ${String(file.schema)}); update the page and try again.`);
  const d = await db();
  if (!d) throw new Error("This browser keeps no data here (IndexedDB is unavailable, as in some private modes).");
  const out = {} as Record<BackupStore, RestoreCount>;
  for (const s of BACKUP_STORES) {
    const c: RestoreCount = { added: 0, updated: 0, kept: 0, skipped: 0 };
    out[s] = c;
    const recs = (file.stores as Record<string, unknown>)[s];
    if (!Array.isArray(recs)) continue;
    const shape = SHAPES[s] as unknown as { updated: (d: unknown) => number; valid: (d: Record<string, unknown>) => boolean };
    const tx = d.transaction(s, "readwrite");
    const store = tx.objectStore(s) as unknown as {
      get: (id: string) => Promise<unknown>;
      put: (v: unknown) => Promise<unknown>;
    };
    for (const r of recs) {
      if (!obj(r) || !isStr(r.id) || !r.id || r.deleted || !obj(r.data) || r.data.id !== r.id || !shape.valid(r.data)) {
        c.skipped++;
        continue;
      }
      const here = await store.get(r.id);
      if (here === undefined) {
        await store.put(r.data);
        c.added++;
      } else if (shape.updated(r.data) > shape.updated(here)) {
        await store.put(r.data);
        c.updated++;
      } else c.kept++;
    }
    await tx.done;
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

/** The file name for a backup made now. */
export function backupFileName(now: Date = new Date()): string {
  return `lizard-backup-${now.toISOString().slice(0, 10)}.json`;
}

