// What can be read of a database that won't open. These open one the app's connection never touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKUP_FORMAT } from "./backup";
import { DB_NAME, DB_VERSION, openLizardDB, type SavedSpot } from "./db";
import { FAILURE_WORDS, salvage, salvageWords } from "./recovery";

const SPOT: SavedSpot = { id: "s", title: "t", line: "p=6&s=100", state: {}, tags: [], note: "", createdAt: 1, updatedAt: 1 };

const wipe = () =>
  new Promise<void>((resolve, reject) => {
    const q = indexedDB.deleteDatabase(DB_NAME);
    q.onsuccess = () => resolve();
    q.onerror = () => reject(q.error);
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("salvage", () => {
  it("reads a database at an older version, as it stands, without upgrading it", async () => {
    await wipe();
    const v4 = await openLizardDB(4);
    await v4.put("savedSpots", SPOT);
    await v4.put("savedRanges", { id: "r", name: "n", text: "", combos: 0, note: "", createdAt: 1, updatedAt: 1 });
    v4.close();
    const s = await salvage();
    expect(s.read).toBe(2);
    expect(s.unread).toEqual([]);
    expect(s.backup).toMatchObject({ format: BACKUP_FORMAT, counts: { savedSpots: 1, savedRanges: 1, savedDrills: 0 } });
    expect(s.backup!.stores.savedSpots[0]).toMatchObject({ id: "s", dev: "recovered", data: SPOT });
    expect(salvageWords(s)).toBe("1 saved spot, 1 saved range");
    const v = await new Promise<number>((resolve) => {
      const q = indexedDB.open(DB_NAME);
      q.onsuccess = () => {
        resolve(q.result.version);
        q.result.close();
      };
    });
    expect(v).toBe(4);
  });

  it("reads one a later Lizard wrote", async () => {
    await wipe();
    const later = await new Promise<IDBDatabase>((resolve) => {
      const q = indexedDB.open(DB_NAME, DB_VERSION + 5);
      q.onupgradeneeded = () => q.result.createObjectStore("savedSpots", { keyPath: "id" }).put(SPOT);
      q.onsuccess = () => resolve(q.result);
    });
    later.close();
    expect((await salvage()).read).toBe(1);
  });

  it("makes a file a restore takes", async () => {
    await wipe();
    const d = await openLizardDB(DB_VERSION);
    await d.put("savedSpots", SPOT);
    d.close();
    const { backup } = await salvage();
    await wipe();
    // (the app's own connection, new here and closed after: the others open and close their own)
    vi.resetModules();
    const [{ restoreBackup }, { listSpots }, { db }] = await Promise.all([import("./backup"), import("./saved"), import("./db")]);
    const r = await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(r.savedSpots.added).toBe(1);
    expect((await listSpots()).map((x) => x.id)).toEqual(["s"]);
    (await db())!.close();
  });

  it("leaves nothing behind where there's no database: an empty one would pass for migrations already begun", async () => {
    await wipe();
    expect(await salvage()).toEqual({ backup: null, read: 0, unread: [] });
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(DB_NAME);
  });

  it("says nothing can be read where the open fails, and gives up on one that doesn't answer", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("no", "UnknownError");
    });
    expect((await salvage()).backup).toBeNull();
    vi.mocked(indexedDB.open).mockImplementation(() => ({}) as IDBOpenDBRequest);
    expect((await salvage(5)).backup).toBeNull();
  });

  it("keeps what came before a store that fails, and names the store", async () => {
    await wipe();
    const d = await openLizardDB(DB_VERSION);
    await d.put("savedSpots", SPOT);
    await d.put("savedRanges", { id: "r", name: "n", text: "", combos: 0, note: "", createdAt: 1, updatedAt: 1 });
    d.close();
    const real = IDBObjectStore.prototype.openCursor;
    vi.spyOn(IDBObjectStore.prototype, "openCursor").mockImplementation(function (this: IDBObjectStore, ...a) {
      if (this.name === "savedRanges") throw new DOMException("bad", "UnknownError");
      return real.apply(this, a);
    });
    const s = await salvage();
    expect(s.read).toBe(1);
    expect(s.unread).toEqual(["savedRanges"]);
    expect(s.backup!.counts.savedSpots).toBe(1);
  });

  it("keeps what it read of a store that stops answering, and says the rest wasn't read", async () => {
    await wipe();
    const d = await openLizardDB(DB_VERSION);
    await d.put("savedSpots", SPOT);
    await d.put("savedRanges", { id: "r", name: "n", text: "", combos: 0, note: "", createdAt: 1, updatedAt: 1 });
    d.close();
    const real = IDBObjectStore.prototype.openCursor;
    // (a cursor that's never answered, in a store that has records)
    vi.spyOn(IDBObjectStore.prototype, "openCursor").mockImplementation(function (this: IDBObjectStore, ...a) {
      return this.name === "savedRanges" ? ({} as IDBRequest<IDBCursorWithValue | null>) : real.apply(this, a);
    });
    const s = await salvage(200);
    expect(s.read).toBe(1);
    expect(s.backup!.counts.savedSpots).toBe(1);
    expect(s.unread).toContain("savedRanges");
    expect(s.unread).not.toContain("savedSpots");
  });

  it("drops what can't be a record, keeping the rest", async () => {
    await wipe();
    const d = await openLizardDB(DB_VERSION);
    await d.put("savedSpots", SPOT);
    await d.put("savedRanges", { id: 7 } as never).catch(() => {});
    d.close();
    expect((await salvage()).read).toBe(1);
  });
});

describe("the words", () => {
  it("has some for every way an open fails", () => {
    expect(Object.keys(FAILURE_WORDS).sort()).toEqual(["damaged", "full", "newer", "unavailable", "upgrade"]);
  });
});
