import { describe, expect, it } from "vitest";
import { DB_VERSION, MIGRATIONS, openLizardDB } from "./db";

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
