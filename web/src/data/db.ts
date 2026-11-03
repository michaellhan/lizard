// Local persistence: one IndexedDB database, versioned, with explicit forward migrations. Everything stays in
// the user's browser (no accounts). Each migration runs once, in order, inside the upgrade transaction; a test
// (db.test.ts) opens every historical version and checks the upgrade path.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";

export const DB_NAME = "lizard";

export interface SavedSpot {
  id: string;
  title: string;
  /** the Study line, as Study's URL search (studyState.ts toSearch): what opens the spot */
  line: string;
  /** the Advisor state the spot reproduces (studyRequest of the line) */
  state: Record<string, unknown>;
  tags: string[];
  note: string;
  /** the answer seen when the spot was saved: its source and its provenance line */
  seen?: { source: string; label: string };
  createdAt: number;
  updatedAt: number;
}

export interface SavedRange {
  id: string;
  name: string;
  /** the range in the common solver text format (features/ranges/rangeText.ts) */
  text: string;
  combos: number;
  note: string;
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
  savedRanges: { key: string; value: SavedRange; indexes: { byUpdated: number } };
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
  3: (db) => {
    const r = db.createObjectStore("savedRanges", { keyPath: "id" });
    r.createIndex("byUpdated", "updatedAt");
  },
};

export const DB_VERSION = Math.max(...Object.keys(MIGRATIONS).map(Number));

/** What an open hears from other tabs: `blocked`, an older tab holds the database open so this upgrade waits;
 * `blocking`, a newer tab wants to upgrade and this connection is in its way. */
export interface OpenHooks {
  blocked?: () => void;
  blocking?: () => void;
  terminated?: () => void;
}

export function openLizardDB(version: number = DB_VERSION, name: string = DB_NAME, hooks: OpenHooks = {}): Promise<IDBPDatabase<LizardDB>> {
  return openDB<LizardDB>(name, version, {
    upgrade(db, oldVersion, newVersion, tx) {
      const target = newVersion ?? version;
      for (let v = oldVersion + 1; v <= target; v++) {
        const m = MIGRATIONS[v];
        if (!m) throw new Error(`no migration to database version ${v}`);
        m(db, tx);
      }
    },
    blocked: hooks.blocked,
    blocking: hooks.blocking,
    terminated: hooks.terminated,
  });
}

/** The shared connection's state, for the notice in the page (app/DbNotice.tsx): "waiting", an older Lizard tab
 * keeps the database at its version so this one's upgrade waits (until that tab closes or reloads); "replaced", a
 * newer Lizard in another tab upgraded the database, so this tab stepped aside and keeps nothing until reloaded. */
export type DbState = "ok" | "waiting" | "replaced";
let state: DbState = "ok";
const listeners = new Set<() => void>();
const setState = (s: DbState) => {
  if (s === state) return;
  state = s;
  for (const f of listeners) f();
};
export const dbState = (): DbState => state;
export function onDbState(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

let dbP: Promise<IDBPDatabase<LizardDB>> | null = null;

/** The app's shared connection (null where IndexedDB is unavailable, e.g. some private modes, or once a newer tab
 * has taken the database over). */
export async function db(): Promise<IDBPDatabase<LizardDB> | null> {
  if (typeof indexedDB === "undefined" || state === "replaced") return null;
  dbP ??= openLizardDB(DB_VERSION, DB_NAME, {
    blocked: () => setState("waiting"),
    // (closed at once so the newer tab's upgrade isn't held up, as this version's own would be by an older tab)
    blocking: () => {
      const p = dbP;
      dbP = null;
      setState("replaced");
      void p?.then((d) => d.close());
    },
    terminated: () => {
      dbP = null;
    },
  });
  try {
    const d = await dbP;
    if (state === "waiting") setState("ok");
    return d;
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
