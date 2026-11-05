// When the database won't open (db.ts): what can still be read of it, and in what words to say so. A read here goes round
// the app's connection. It opens the database at whatever version it's at, so one this page can't upgrade, or one a later
// Lizard wrote, can still be read; it reads store by store and record by record, so a store that fails costs only what
// came after the failure; and it changes nothing.
import { backupOf, BACKUP_STORES, type Backup, type BackupStore } from "./backup";
import { DB_NAME, type DbFailure } from "./db";

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

/** Each record that can be read in `store`, in `into`, one at a time. */
function readStore(d: IDBDatabase, store: string, into: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const q = d.transaction(store).objectStore(store).openCursor();
    q.onerror = () => reject(q.error ?? new Error("the read failed"));
    q.onsuccess = () => {
      const c = q.result;
      if (!c) return resolve();
      into.push(c.value);
      c.continue();
    };
  });
}

/** A record that can go in a backup at all: restoring takes each on its own merits. */
const isRecord = (x: unknown): x is { id: string } => typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string";

async function readAll(): Promise<Salvage> {
  const d = await openAsItIs();
  try {
    const records: Partial<Record<BackupStore, unknown[]>> = {};
    const unread: BackupStore[] = [];
    for (const s of BACKUP_STORES) {
      if (!d.objectStoreNames.contains(s)) continue;
      const into: unknown[] = [];
      await readStore(d, s, into).catch(() => unread.push(s));
      records[s] = into.filter(isRecord);
    }
    const read = Object.values(records).reduce((n, r) => n + r.length, 0);
    return { backup: read ? backupOf(records as never, "recovered") : null, read, unread };
  } finally {
    d.close();
  }
}

/** All that can be read of the database. Never rejects, and gives up on one that doesn't answer. */
export async function salvage(ms = SALVAGE_MS): Promise<Salvage> {
  if (typeof indexedDB === "undefined") return NOTHING;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Salvage>((resolve) => {
    timer = setTimeout(() => resolve(NOTHING), ms);
  });
  try {
    return await Promise.race([readAll().catch(() => NOTHING), late]);
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
