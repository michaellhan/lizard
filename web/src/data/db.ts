// Local persistence: one IndexedDB database, versioned, with explicit forward migrations. Everything stays in
// the user's browser (no accounts). Each migration runs once, in order, inside the upgrade transaction; a test
// (db.test.ts) opens every historical version and checks the upgrade path.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";

export const DB_NAME = "lizard";

export interface SavedSpot {
  id: string;
  title: string;
  /** the Advisor state the spot reproduces */
  state: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  kind: "practice" | "drill" | "analysis" | "build";
  startedAt: number;
  endedAt?: number;
  decisions: number;
  evLossBb: number;
  meta: Record<string, unknown>;
}

export interface LizardDB extends DBSchema {
  /** key/value settings (mirrors the persisted settings store) */
  kv: { key: string; value: unknown };
  savedSpots: { key: string; value: SavedSpot; indexes: { byUpdated: number } };
  sessions: { key: string; value: SessionRecord; indexes: { byStarted: number; byKind: string } };
}

type UpgradeTx = IDBPTransaction<LizardDB, StoreNames<LizardDB>[], "versionchange">;

/** migrations[v] upgrades a database at version v-1 to version v. Never edit a shipped migration; add one. */
export const MIGRATIONS: Record<number, (db: IDBPDatabase<LizardDB>, tx: UpgradeTx) => void> = {
  1: (db) => {
    db.createObjectStore("kv");
    const spots = db.createObjectStore("savedSpots", { keyPath: "id" });
    spots.createIndex("byUpdated", "updatedAt");
  },
  2: (db) => {
    const s = db.createObjectStore("sessions", { keyPath: "id" });
    s.createIndex("byStarted", "startedAt");
    s.createIndex("byKind", "kind");
  },
};

export const DB_VERSION = Math.max(...Object.keys(MIGRATIONS).map(Number));

export function openLizardDB(version: number = DB_VERSION, name: string = DB_NAME): Promise<IDBPDatabase<LizardDB>> {
  return openDB<LizardDB>(name, version, {
    upgrade(db, oldVersion, newVersion, tx) {
      const target = newVersion ?? version;
      for (let v = oldVersion + 1; v <= target; v++) {
        const m = MIGRATIONS[v];
        if (!m) throw new Error(`no migration to database version ${v}`);
        m(db, tx);
      }
    },
  });
}

let dbP: Promise<IDBPDatabase<LizardDB>> | null = null;

/** The app's shared connection (null where IndexedDB is unavailable, e.g. some private modes). */
export async function db(): Promise<IDBPDatabase<LizardDB> | null> {
  if (typeof indexedDB === "undefined") return null;
  dbP ??= openLizardDB();
  try {
    return await dbP;
  } catch {
    dbP = null;
    return null;
  }
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return d ? ((await d.get("kv", key)) as T | undefined) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (d) await d.put("kv", value, key);
}

/** Store a session (Practice, drills, analysis), replacing the one with its id. */
export async function putSession(s: SessionRecord): Promise<void> {
  const d = await db();
  if (d) await d.put("sessions", s);
}

/** The latest sessions of a kind, newest first. */
export async function recentSessions(kind: SessionRecord["kind"], limit = 10): Promise<SessionRecord[]> {
  const d = await db();
  if (!d) return [];
  const all = await d.getAllFromIndex("sessions", "byKind", kind);
  return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}
