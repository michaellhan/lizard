import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_FORMAT, BACKUP_STORES, backupFileName, makeBackup, restoreBackup, restoreSummary, type Backup } from "./backup";
import { db, putSession, type SavedRange, type SavedSpot, type SessionRecord } from "./db";
import { deleteSpot, listRanges, listSpots, putRange, putSpot, readTags, spotAt, spotMatches } from "./saved";

const spot = (id: string, updatedAt: number, extra: Partial<SavedSpot> = {}): SavedSpot => ({
  id,
  title: `spot ${id}`,
  line: `p=6&s=100&pre=BTN:r2.5,BB:c&b=Ac7s3d&id=${id}`,
  state: { players: 6, stack: 100 },
  tags: ["srp"],
  note: "",
  seen: { source: "library", label: "Precomputed solution · srp_btn_bb" },
  createdAt: 1,
  updatedAt,
  ...extra,
});
const range = (id: string, updatedAt: number): SavedRange => ({ id, name: `range ${id}`, text: "22+,AKs", combos: 82, note: "", createdAt: 1, updatedAt });
const session = (id: string, startedAt: number, endedAt?: number): SessionRecord => ({
  id,
  kind: "drill",
  startedAt,
  endedAt,
  decisions: 3,
  evLossBb: 0.25,
  meta: { spot: "srp_btn_bb" },
});

async function clearAll() {
  const d = (await db())!;
  for (const s of BACKUP_STORES) await d.clear(s);
}

beforeEach(clearAll);

describe("saved spots and ranges", () => {
  it("lists the latest changed first, finds a spot by its line, deletes", async () => {
    await putSpot(spot("a", 5));
    await putSpot(spot("b", 9));
    expect((await listSpots()).map((s) => s.id)).toEqual(["b", "a"]);
    expect((await spotAt(spot("a", 5).line))?.id).toBe("a");
    await deleteSpot("b");
    expect((await listSpots()).map((s) => s.id)).toEqual(["a"]);
    await putRange(range("r", 3));
    expect((await listRanges())[0]?.name).toBe("range r");
  });

  it("reads tags and searches every word over title, tags, note and line", () => {
    expect(readTags(" srp, btn ,, srp,3bet ")).toEqual(["srp", "btn", "3bet"]);
    const s = spot("a", 1, { title: "Ace-high c-bet", tags: ["dry"], note: "check back more" });
    expect(spotMatches(s, "ace DRY")).toBe(true);
    expect(spotMatches(s, "back", "BTN raise 2.5")).toBe(true);
    expect(spotMatches(s, "btn", "BTN raise 2.5")).toBe(true);
    expect(spotMatches(s, "wet")).toBe(false);
    expect(spotMatches(s, "")).toBe(true);
  });
});

describe("backup and restore", () => {
  it("round-trips every record exactly, in the classic record shape", async () => {
    await putSpot(spot("a", 5));
    await putRange(range("r", 7));
    await putSession(session("d", 10, 20));
    await putSession(session("e", 30));
    const b = await makeBackup(() => Date.UTC(2026, 10, 3));
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.exported).toBe("2026-11-03T00:00:00.000Z");
    expect(b.counts).toEqual({ savedSpots: 1, savedRanges: 1, sessions: 2 });
    expect(b.stores.sessions.find((r) => r.id === "d")).toMatchObject({ id: "d", v: 1, created: 10, updated: 20, dev: b.device });
    expect(b.stores.sessions.find((r) => r.id === "e")).toMatchObject({ created: 30, updated: 30 });
    expect(b.stores.savedSpots[0]).toEqual({ id: "a", v: 1, created: 1, updated: 5, dev: b.device, data: spot("a", 5) });

    const before = { spots: await listSpots(), ranges: await listRanges(), sessions: (await (await db())!.getAll("sessions")).sort((x, y) => x.id.localeCompare(y.id)) };
    await clearAll();
    expect(await listSpots()).toEqual([]);
    // through the file's text, as a download and an upload would
    const r = await restoreBackup(JSON.parse(JSON.stringify(b)));
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0 });
    expect(r.sessions.added).toBe(2);
    expect(await listSpots()).toEqual(before.spots);
    expect(await listRanges()).toEqual(before.ranges);
    expect((await (await db())!.getAll("sessions")).sort((x, y) => x.id.localeCompare(y.id))).toEqual(before.sessions);
    expect(restoreSummary(r)).toBe("4 added, 0 updated, 0 kept (as new or newer here)");
  });

  it("merges: a newer record here is kept, an older one replaced, a missing one added, nothing deleted", async () => {
    await putSpot(spot("a", 5));
    await putSpot(spot("b", 5));
    const old = await makeBackup();
    await putSpot(spot("a", 50, { title: "renamed later" }));
    await putSpot(spot("c", 6));
    await deleteSpot("b");
    const r = await restoreBackup(old);
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 1, skipped: 0 });
    const got = Object.fromEntries((await listSpots()).map((s) => [s.id, s.title]));
    expect(got).toEqual({ a: "renamed later", b: "spot b", c: "spot c" });
    // and a newer backup's record replaces an older one here
    const newer: Backup = JSON.parse(JSON.stringify(await makeBackup()));
    newer.stores.savedSpots.find((x) => x.id === "c")!.data = spot("c", 99, { title: "from the other device" });
    await putSpot(spot("c", 7));
    expect((await restoreBackup(newer)).savedSpots.updated).toBe(1);
    expect((await listSpots()).find((s) => s.id === "c")?.title).toBe("from the other device");
  });

  it("skips damaged records and refuses what isn't a Lizard backup it can read", async () => {
    const b = await makeBackup();
    const bad = {
      ...b,
      stores: {
        savedSpots: [
          { id: "x", v: 1, created: 1, updated: 1, dev: "d", data: { id: "x", title: 3 } },
          { id: "y", v: 1, created: 1, updated: 1, dev: "d", data: spot("z", 1) },
          { id: "w", v: 1, created: 1, updated: 1, dev: "d", deleted: true, data: spot("w", 1) },
          { id: "ok", v: 1, created: 1, updated: 1, dev: "d", data: spot("ok", 1) },
        ],
        sessions: [{ id: "s", v: 1, created: 1, updated: 1, dev: "d", data: { ...session("s", 1), kind: "poker" } }],
      },
    };
    const r = await restoreBackup(bad);
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 0, skipped: 3 });
    expect(r.sessions.skipped).toBe(1);
    expect(r.savedRanges).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0 });
    expect(restoreSummary(r)).toMatch(/4 skipped/);
    await expect(restoreBackup({ format: "gto-solver-backup", stores: {} })).rejects.toThrow("That isn't a Lizard backup file.");
    await expect(restoreBackup(null)).rejects.toThrow("That isn't a Lizard backup file.");
    await expect(restoreBackup({ ...b, schema: 2 })).rejects.toThrow(/newer Lizard/);
  });

  it("names the file by the day", () => {
    expect(backupFileName(new Date(Date.UTC(2026, 10, 3, 12)))).toBe("lizard-backup-2026-11-03.json");
  });
});
