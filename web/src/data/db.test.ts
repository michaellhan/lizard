import { describe, expect, it } from "vitest";
import { mistake } from "@/test/mistake";
import { DB_VERSION, MIGRATIONS, openLizardDB, putSession, recentSessions } from "./db";

let n = 0;
const fresh = () => `lizard-test-${++n}`;

describe("IndexedDB migrations", () => {
  it("has a migration for every version from 1 to the current one", () => {
    for (let v = 1; v <= DB_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf("function");
  });

  it("creates every store on a fresh database", async () => {
    const db = await openLizardDB(DB_VERSION, fresh());
    expect([...db.objectStoreNames].sort()).toEqual(["decisions", "hands", "kv", "mistakes", "savedDrills", "savedRanges", "savedSpots", "sessions"]);
    expect([...db.transaction("sessions").store.indexNames].sort()).toEqual(["byKind", "byStarted"]);
    expect([...db.transaction("savedRanges").store.indexNames]).toEqual(["byUpdated"]);
    expect([...db.transaction("hands").store.indexNames].sort()).toEqual(["byHero", "byImport", "byPlayed", "byPotType", "bySite"]);
    expect([...db.transaction("decisions").store.indexNames].sort()).toEqual(["byHand", "byPos", "byStreet", "byVerdict"]);
    expect([...db.transaction("mistakes").store.indexNames].sort()).toEqual(["byDue", "byLast", "byStreet"]);
    db.close();
  });

  it("upgrades a version-1 database in place, keeping its data", async () => {
    const name = fresh();
    const v1 = await openLizardDB(1, name);
    await v1.put("kv", { mode: "accurate" }, "settings.v1");
    await v1.put("savedSpots", { id: "s1", title: "BTN v BB", line: "p=6&s=100", state: { players: 6 }, tags: [], note: "", createdAt: 1, updatedAt: 2 });
    v1.close();
    const v2 = await openLizardDB(DB_VERSION, name);
    expect(await v2.get("kv", "settings.v1")).toEqual({ mode: "accurate" });
    expect((await v2.get("savedSpots", "s1"))?.title).toBe("BTN v BB");
    await v2.put("sessions", { id: "x", kind: "drill", startedAt: 5, decisions: 3, evLossBb: 0.4, meta: {} });
    expect(await v2.countFromIndex("sessions", "byKind", "drill")).toBe(1);
    v2.close();
  });

  it("upgrades a version-2 database in place, keeping its data", async () => {
    const name = fresh();
    const v2 = await openLizardDB(2, name);
    await v2.put("sessions", { id: "x", kind: "practice", startedAt: 5, decisions: 3, evLossBb: 0.4, meta: { hands: 2 } });
    await v2.put("savedSpots", { id: "s1", title: "SRP", line: "p=2&s=100", state: {}, tags: ["a"], note: "n", createdAt: 1, updatedAt: 2 });
    v2.close();
    const v3 = await openLizardDB(DB_VERSION, name);
    expect(await v3.get("sessions", "x")).toEqual({ id: "x", kind: "practice", startedAt: 5, decisions: 3, evLossBb: 0.4, meta: { hands: 2 } });
    expect((await v3.get("savedSpots", "s1"))?.tags).toEqual(["a"]);
    await v3.put("savedRanges", { id: "r1", name: "UTG open", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 1 });
    expect(await v3.count("savedRanges")).toBe(1);
    v3.close();
  });

  it("upgrades a version-3 database in place, keeping its data", async () => {
    const name = fresh();
    const v3 = await openLizardDB(3, name);
    await v3.put("savedRanges", { id: "r1", name: "UTG open", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 1 });
    await v3.put("kv", 2, "k");
    v3.close();
    const v4 = await openLizardDB(4, name);
    expect((await v4.get("savedRanges", "r1"))?.text).toBe("22+");
    expect(await v4.get("kv", "k")).toBe(2);
    expect([await v4.count("hands"), await v4.count("decisions")]).toEqual([0, 0]);
    v4.close();
  });

  it("upgrades a version-4 database in place, keeping its data", async () => {
    const name = fresh();
    const v4 = await openLizardDB(4, name);
    await v4.put("decisions", { id: "h|0", handId: "h", street: "preflop", verdict: "best", source: "charts", label: "Preflop charts", gradedAt: 1 } as never);
    v4.close();
    const v5 = await openLizardDB(DB_VERSION, name);
    expect((await v5.get("decisions", "h|0"))?.verdict).toBe("best");
    expect(await v5.count("savedDrills")).toBe(0);
    v5.close();
  });

  it("upgrades a version-5 database in place, keeping its data and giving the mistakes an empty store", async () => {
    const name = fresh();
    const v5 = await openLizardDB(5, name);
    expect([...v5.objectStoreNames]).not.toContain("mistakes");
    const old = { id: "x", kind: "practice", startedAt: 5, decisions: 3, evLossBb: 0.4, meta: { hands: 2 } } as const;
    await v5.put("sessions", old);
    await v5.put("savedDrills", { id: "d1", name: "Flops", to: "/practice?tab=drills", note: "", createdAt: 1, updatedAt: 2 } as never);
    v5.close();
    const v6 = await openLizardDB(DB_VERSION, name);
    expect(await v6.get("sessions", "x")).toEqual(old);
    expect((await v6.get("savedDrills", "d1"))?.name).toBe("Flops");
    expect(await v6.count("mistakes")).toBe(0);
    await v6.put("mistakes", mistake());
    expect(await v6.countFromIndex("mistakes", "byStreet", "flop")).toBe(1);
    v6.close();
  });

  it("opens at version 6", () => {
    expect(DB_VERSION).toBe(6);
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
