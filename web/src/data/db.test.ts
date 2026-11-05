import { describe, expect, it } from "vitest";
import { mistake } from "@/test/mistake";
import { versionWords } from "@/grading/version";
import { DB_VERSION, MIGRATIONS, openLizardDB, putSession, recentSessions, type DecisionRecord } from "./db";

let n = 0;
const fresh = () => `lizard-test-${++n}`;

describe("IndexedDB migrations", () => {
  it("has a migration for every version from 1 to the current one", () => {
    for (let v = 1; v <= DB_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf("function");
  });

  it("creates every store on a fresh database", async () => {
    const db = await openLizardDB(DB_VERSION, fresh());
    expect([...db.objectStoreNames].sort()).toEqual(["decisions", "hands", "kv", "mistakes", "savedDrills", "savedRanges", "savedReports", "savedScenarios", "savedSpots", "sessions"]);
    expect([...db.transaction("sessions").store.indexNames].sort()).toEqual(["byKind", "byStarted"]);
    expect([...db.transaction("savedRanges").store.indexNames]).toEqual(["byUpdated"]);
    expect([...db.transaction("savedScenarios").store.indexNames]).toEqual(["byUpdated"]);
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

  it("reads a version-6 grade kept before versions were, as it was, with no migration: a stamp is a field with no index", async () => {
    const db6 = await openLizardDB(6, fresh());
    const old: DecisionRecord = { id: "h|flop|1", handId: "h", street: "flop", pos: "BTN", action: "check", verdict: "Best", evLossBb: 0, source: "library", label: "Precomputed solution · srp_btn_bb", gradedAt: 1 };
    await db6.put("decisions", old);
    await db6.put("decisions", { ...old, id: "h|flop|2", version: "build:aaa/111" });
    const got = await db6.get("decisions", old.id);
    expect(got).toEqual(old);
    expect(versionWords(got?.version)).toBe("unknown");
    expect(versionWords((await db6.get("decisions", "h|flop|2"))?.version)).toBe("solver build aaa/111");
    db6.close();
  });

  it("upgrades a version-6 database in place, keeping its data and giving the scenarios an empty store", async () => {
    const name = fresh();
    const v6 = await openLizardDB(6, name);
    expect([...v6.objectStoreNames]).not.toContain("savedScenarios");
    await v6.put("mistakes", mistake());
    await v6.put("sessions", { id: "x", kind: "practice", startedAt: 5, decisions: 3, evLossBb: 0.4, meta: { hands: 2 } });
    await v6.put("savedDrills", { id: "d1", name: "Flops", kind: "library", to: "/practice?tab=drills", about: "", note: "", createdAt: 1, updatedAt: 2 });
    v6.close();
    const v7 = await openLizardDB(DB_VERSION, name);
    expect(await v7.get("mistakes", mistake().id)).toEqual(mistake());
    expect((await v7.get("sessions", "x"))?.meta).toEqual({ hands: 2 });
    expect((await v7.get("savedDrills", "d1"))?.name).toBe("Flops");
    expect(await v7.count("savedScenarios")).toBe(0);
    const s = { id: "s1", name: "Nit, 3-bet pots", players: 6, stack: 100, opts: { seat: "moves", preflopOnly: false, pot: "3bet", ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 } as const, note: "", createdAt: 1, updatedAt: 2 };
    await v7.put("savedScenarios", s);
    expect(await v7.getAllFromIndex("savedScenarios", "byUpdated")).toEqual([s]);
    v7.close();
  });

  it("upgrades a version-7 database in place, keeping its scenarios and giving the reports an empty store", async () => {
    const name = fresh();
    const v7 = await openLizardDB(7, name);
    expect([...v7.objectStoreNames]).not.toContain("savedReports");
    await v7.put("savedDrills", { id: "d1", name: "Flops", kind: "library", to: "/practice?tab=drills", about: "", note: "", createdAt: 1, updatedAt: 2 });
    v7.close();
    const v8 = await openLizardDB(DB_VERSION, name);
    expect((await v8.get("savedDrills", "d1"))?.name).toBe("Flops");
    expect(await v8.count("savedReports")).toBe(0);
    v8.close();
  });

  it("opens at version 8", () => {
    expect(DB_VERSION).toBe(8);
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

describe("a tournament session", () => {
  it("needs no version change: its kinds are values of the indexed kind, and its fields are the meta's", async () => {
    const d = await openLizardDB(DB_VERSION, fresh());
    const base = { startedAt: 1, decisions: 1, evLossBb: 0.5 };
    await d.put("sessions", { ...base, id: "a", kind: "tournament", meta: { tournament: { model: "icm", payouts: [50, 30, 20], stacks: { BTN: 8 } } } });
    await d.put("sessions", { ...base, id: "b", kind: "tournament-chips", meta: { tournament: { model: "chips", stacks: { BTN: 8 } } } });
    await d.put("sessions", { ...base, id: "c", kind: "practice", meta: { pushFold: true } });
    expect((await d.getAllFromIndex("sessions", "byKind", "tournament")).map((s) => s.id)).toEqual(["a"]);
    expect((await d.getAllFromIndex("sessions", "byKind", "tournament-chips")).map((s) => s.id)).toEqual(["b"]);
    expect((await d.get("sessions", "a"))?.meta).toEqual({ tournament: { model: "icm", payouts: [50, 30, 20], stacks: { BTN: 8 } } });
    d.close();
  });
});
