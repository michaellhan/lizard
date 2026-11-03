import { describe, expect, it } from "vitest";
import { DB_VERSION, MIGRATIONS, openLizardDB, putSession, recentSessions } from "./db";

let n = 0;
const fresh = () => `lizard-test-${++n}`;

describe("IndexedDB migrations", () => {
  it("has a migration for every version from 1 to the current one", () => {
    for (let v = 1; v <= DB_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf("function");
  });

  it("creates every store on a fresh database", async () => {
    const db = await openLizardDB(DB_VERSION, fresh());
    expect([...db.objectStoreNames].sort()).toEqual(["kv", "savedSpots", "sessions"]);
    expect([...db.transaction("sessions").store.indexNames].sort()).toEqual(["byKind", "byStarted"]);
    db.close();
  });

  it("upgrades a version-1 database in place, keeping its data", async () => {
    const name = fresh();
    const v1 = await openLizardDB(1, name);
    await v1.put("kv", { mode: "accurate" }, "settings.v1");
    await v1.put("savedSpots", { id: "s1", title: "BTN v BB", state: { players: 6 }, tags: [], createdAt: 1, updatedAt: 2 });
    v1.close();
    const v2 = await openLizardDB(DB_VERSION, name);
    expect(await v2.get("kv", "settings.v1")).toEqual({ mode: "accurate" });
    expect((await v2.get("savedSpots", "s1"))?.title).toBe("BTN v BB");
    await v2.put("sessions", { id: "x", kind: "drill", startedAt: 5, decisions: 3, evLossBb: 0.4, meta: {} });
    expect(await v2.countFromIndex("sessions", "byKind", "drill")).toBe(1);
    v2.close();
  });
});

describe("sessions", () => {
  it("keeps one record per session id, the latest of a kind first", async () => {
    await putSession({ id: "a", kind: "practice", startedAt: 1, decisions: 2, evLossBb: 0.1, meta: {} });
    await putSession({ id: "b", kind: "practice", startedAt: 3, decisions: 0, evLossBb: 0, meta: {} });
    await putSession({ id: "a", kind: "practice", startedAt: 1, decisions: 5, evLossBb: 0.3, meta: { hands: 4 } });
    await putSession({ id: "c", kind: "drill", startedAt: 9, decisions: 1, evLossBb: 0, meta: {} });
    const got = await recentSessions("practice");
    expect(got.map((x) => [x.id, x.decisions])).toEqual([
      ["b", 0],
      ["a", 5],
    ]);
    expect(await recentSessions("practice", 1)).toHaveLength(1);
  });
});
