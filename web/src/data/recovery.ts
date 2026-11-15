// When the database won't open (db.ts): what can still be read of it, and in what words to say so. A read here goes round
// the app's connection. It opens the database at whatever version it's at, so one this page can't upgrade, or one a later
// Lizard wrote, can still be read; it reads store by store and record by record, so a store that fails costs only what
// came after the failure; and it changes nothing.
import { backupOf, BACKUP_STORES, type Backup, type BackupStore } from "./backup";
import { DB_NAME, type DbFailure, type Tombstone } from "./db";

/** how long a look at a database that won't answer may take */
const SALVAGE_MS = 10_000;

export interface Salvage {
  /** what could be read, as a backup file; null where nothing could */
  backup: Backup | null;
  /** records read */
  read: number;
  /** stores it couldn't finish reading */
  unread: BackupStore[];
}

const NOTHING: Salvage = { backup: null, read: 0, unread: [] };

/** The database as it stands, at its own version; rejects where it's not there. (A versionless open of a database that
 * isn't there makes an empty one at version 1, which the app's migrations would then take as already begun: so it's
 * called off, and nothing is left.) */
function openAsItIs(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(DB_NAME);
    q.onupgradeneeded = () => q.transaction?.abort();
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error ?? new Error("the open failed"));
    q.onblocked = () => reject(new Error("blocked"));
  });
}

/** Each record that can be read in `store`, in `into`, one at a time, until `stopped` says enough. */
function readStore(d: IDBDatabase, store: string, into: unknown[], stopped: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const q = d.transaction(store).objectStore(store).openCursor();
    q.onerror = () => reject(q.error ?? new Error("the read failed"));
    q.onsuccess = () => {
      const c = q.result;
      if (!c || stopped()) return resolve();
      into.push(c.value);
      c.continue();
    };
  });
}

/** A record that can go in a backup at all: restoring takes each on its own merits. */
const isRecord = (x: unknown): x is { id: string } => typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string";

/** A tombstone that names a store a backup carries; the restore checks the rest of it. */
const isGrave = (x: unknown): x is Tombstone => isRecord(x) && BACKUP_STORES.includes((x as { store?: unknown }).store as BackupStore) && typeof (x as { at?: unknown }).at === "number";

/** What's been read so far, as it stands: records by store, and the stores not read to the end. */
interface Reading {
  records: Partial<Record<BackupStore, unknown[]>>;
  /** what had been deleted, so the file keeps it deleted: gone with a database older than v10, which never had the store */
  graves: unknown[];
  unread: Set<BackupStore>;
  stopped: boolean;
  /** lets go of the database, which a read that never ends wouldn't: nothing could delete it while it's held */
  close?: () => void;
}

async function readAll(r: Reading): Promise<void> {
  const d = await openAsItIs();
  r.close = () => d.close();
  try {
    const stores = BACKUP_STORES.filter((s) => d.objectStoreNames.contains(s));
    for (const s of stores) r.unread.add(s);
    for (const s of stores) {
      if (r.stopped) return;
      const into: unknown[] = [];
      r.records[s] = into;
      const whole = await readStore(d, s, into, () => r.stopped).then(
        () => !r.stopped,
        () => false,
      );
      if (whole) r.unread.delete(s);
    }
    if (!r.stopped && d.objectStoreNames.contains("tombstones")) await readStore(d, "tombstones", r.graves, () => r.stopped).catch(() => undefined);
  } finally {
    d.close();
  }
}

const standing = (r: Reading): Salvage => {
  const records = Object.fromEntries(Object.entries(r.records).map(([s, xs]) => [s, xs.filter(isRecord)]));
  const read = Object.values(records).reduce((n, xs) => n + xs.length, 0);
  return { backup: read ? backupOf(records as never, "recovered", Date.now, r.graves.filter(isGrave)) : null, read, unread: [...r.unread] };
};

/** All that can be read of the database. Never rejects. On one that doesn't answer in time it gives what it has, and says
 * which stores it didn't finish. */
export async function salvage(ms = SALVAGE_MS): Promise<Salvage> {
  if (typeof indexedDB === "undefined") return NOTHING;
  const r: Reading = { records: {}, graves: [], unread: new Set(), stopped: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([readAll(r).catch(() => undefined), late]);
    r.stopped = true;
    r.close?.();
    return standing(r);
  } catch {
    return NOTHING;
  } finally {
    clearTimeout(timer);
  }
}

/** What went wrong, in words. */
export const FAILURE_WORDS: Record<DbFailure, string> = {
  unavailable: "This browser isn't letting the page store anything here. A private window can do this, and so can blocking site data. Nothing has been lost by it, and there's nothing here to recover.",
  newer: "The data here was written by a newer Lizard than this page, which is most likely an old copy. Reloading should bring the new page, and your data is untouched.",
  upgrade: "Your data couldn't be brought up to this version of Lizard. The attempt was undone, so it stands as it was.",
  full: "This device or browser has no room left for Lizard's data. Freeing up space and trying again may be all it needs.",
  damaged: "The browser reported an error opening the database, which can mean the files behind it are damaged.",
};

/** What a store's records are, for saying what's there and what would go. */
const WHAT: Record<BackupStore, string> = {
  savedSpots: "saved spot",
  savedAnswers: "saved answer",
  savedRanges: "saved range",
  savedDrills: "saved drill",
  savedScenarios: "saved scenario",
  savedReports: "saved report",
  flopReports: "flop report",
  sessions: "session",
  hands: "imported hand",
  decisions: "graded decision",
  mistakes: "kept mistake",
};

/** "3 saved spots, 12 sessions": what a salvage read. */
export const salvageWords = (s: Salvage): string =>
  s.backup
    ? BACKUP_STORES.filter((k) => s.backup!.counts[k])
        .map((k) => `${s.backup!.counts[k]} ${WHAT[k]}${s.backup!.counts[k] === 1 ? "" : "s"}`)
        .join(", ")
    : "";

/** Everything starting fresh deletes, whatever could be read of it. */
export const WHOLE_LOSS = "every saved spot and answer, range, drill, scenario and report, your session history, the hands imported into Analyze with their tags, notes and grades, the mistakes kept for review with their schedule, and your settings";
