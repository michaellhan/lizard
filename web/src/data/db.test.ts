import { describe, expect, it, vi } from "vitest";
import { mistake } from "@/test/mistake";
import { versionWords } from "@/grading/version";
import { DB_VERSION, deleting, MIGRATIONS, openLizardDB, putSession, recentSessions, type DecisionRecord } from "./db";

let n = 0;
const fresh = () => `lizard-test-${++n}`;

describe("IndexedDB migrations", () => {
  it("has a migration for every version from 1 to the current one", () => {
    for (let v = 1; v <= DB_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf("function");
  });

  it("creates every store on a fresh database", async () => {
    const db = await openLizardDB(DB_VERSION, fresh());
    expect([...db.objectStoreNames].sort()).toEqual(["decisions", "flopReports", "hands", "kv", "mistakes", "savedAnswers", "savedDrills", "savedRanges", "savedReports", "savedScenarios", "savedSpots", "sessions", "tombstones"]);
    expect([...db.transaction("flopReports").store.indexNames]).toEqual(["byUpdated"]);
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

  it("upgrades a version-8 database in place: every kept record as it was, an empty store for answers, and each loads with no tags", async () => {
    const name = fresh();
    const v8 = await openLizardDB(8, name);
    expect([...v8.objectStoreNames]).not.toContain("savedAnswers");
    const spot = { id: "s1", title: "SRP", line: "p=2&s=100", state: {}, tags: ["a"], note: "n", seen: { source: "charts", label: "Preflop charts · approximate" }, createdAt: 1, updatedAt: 2 };
    const range = { id: "r1", name: "UTG open", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 1 };
    const drill = { id: "d1", name: "Flops", kind: "library", to: "/practice?tab=drills", about: "", note: "", createdAt: 1, updatedAt: 2 } as const;
    const report = { id: "p1", name: "All", filters: { site: "PokerStars" }, note: "", createdAt: 1, updatedAt: 2 };
    const scenario = { id: "c1", name: "Nit", players: 6, stack: 100, opts: { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, board: null }, note: "", createdAt: 1, updatedAt: 2 };
    await v8.put("savedSpots", spot);
    await v8.put("savedRanges", range);
    await v8.put("savedDrills", drill);
    await v8.put("savedReports", report);
    await v8.put("savedScenarios", scenario as never);
    await v8.put("kv", "name", "savedSort");
    v8.close();

    const v9 = await openLizardDB(9, name);
    expect(v9.version).toBe(9);
    expect(await v9.count("savedAnswers")).toBe(0);
    expect(await v9.get("savedSpots", "s1")).toEqual(spot);
    expect(await v9.get("savedRanges", "r1")).toEqual(range);
    expect(await v9.get("savedDrills", "d1")).toEqual(drill);
    expect(await v9.get("kv", "savedSort")).toBe("name");
    const [{ readReport }, { readScenario }] = await Promise.all([import("./reports"), import("./scenarios")]);
    expect(readReport(await v9.get("savedReports", "p1"))).toEqual(report);
    expect(readScenario(await v9.get("savedScenarios", "c1"))?.name).toBe("Nit");
    await v9.put("savedAnswers", { id: "s1", line: spot.line, json: "{}", provenance: {} as never, savedAt: 1 });
    expect(await v9.count("savedAnswers")).toBe(1);
    v9.close();
  });

  it("upgrades a version-9 database in place: every record as it was, and an empty store for deletions", async () => {
    const name = fresh();
    const v9 = await openLizardDB(9, name);
    expect([...v9.objectStoreNames]).not.toContain("tombstones");
    const spot = { id: "s1", title: "SRP", line: "p=2&s=100", state: {}, tags: ["a"], note: "n", createdAt: 1, updatedAt: 2 };
    const answer = { id: "s1", line: spot.line, json: "{}", provenance: {} as never, savedAt: 1 };
    await v9.put("savedSpots", spot);
    await v9.put("savedAnswers", answer);
    await v9.put("mistakes", mistake());
    await v9.put("kv", "name", "savedSort");
    v9.close();

    const v10 = await openLizardDB(10, name);
    expect(v10.version).toBe(10);
    expect(await v10.get("savedSpots", "s1")).toEqual(spot);
    expect(await v10.get("savedAnswers", "s1")).toEqual(answer);
    expect(await v10.get("mistakes", mistake().id)).toEqual(mistake());
    expect(await v10.get("kv", "savedSort")).toBe("name");
    expect(await v10.count("tombstones")).toBe(0);
    await v10.put("tombstones", { store: "savedSpots", id: "gone", at: 5 });
    await v10.put("tombstones", { store: "savedSpots", id: "gone", at: 6 });
    await v10.put("tombstones", { store: "savedRanges", id: "gone", at: 7 });
    expect(await v10.get("tombstones", ["savedSpots", "gone"])).toEqual({ store: "savedSpots", id: "gone", at: 6 });
    expect(await v10.count("tombstones")).toBe(2);
    v10.close();
  });

  it("a tab at version 9 steps aside for version 10, and an upgrade it holds up says so until it does", async () => {
    const name = fresh();
    // an older tab, as db() opens: it's told a newer one is waiting, and closes
    let old: Awaited<ReturnType<typeof openLizardDB>> | null = null;
    const stepped = new Promise<void>((resolve) => {
      void openLizardDB(9, name, {
        blocking: () => {
          old?.close();
          resolve();
        },
      }).then((c) => (old = c));
    });
    await vi.waitFor(() => expect(old).not.toBeNull());
    await old!.put("kv", 1, "k");
    const v10 = await openLizardDB(10, name);
    await stepped;
    expect(await v10.get("kv", "k")).toBe(1);
    v10.close();

    // one that doesn't let go: the upgrade waits, says so, and goes on when the tab closes, with nothing lost
    const held = fresh();
    const stuck = await openLizardDB(9, held);
    await stuck.put("kv", 2, "k");
    let blocked = false;
    const waiting = openLizardDB(10, held, { blocked: () => (blocked = true) });
    await vi.waitFor(() => expect(blocked).toBe(true));
    stuck.close();
    const up = await waiting;
    expect(await up.get("kv", "k")).toBe(2);
    up.close();

    // and a tab from before this can't open it again: the browser refuses, which is db()'s "newer"
    const rejected = await openLizardDB(9, held).catch((e: unknown) => e);
    expect((rejected as Error).name).toBe("VersionError");
  });

  it("upgrades a version-10 database in place: every record and deletion as it was, and an empty store for flop reports", async () => {
    const name = fresh();
    const v10 = await openLizardDB(10, name);
    expect([...v10.objectStoreNames]).not.toContain("flopReports");
    const spot = { id: "s1", title: "SRP", line: "p=2&s=100", state: {}, tags: ["a"], note: "n", createdAt: 1, updatedAt: 2 };
    const report = { id: "r1", name: "Leaks", filters: { pos: "BTN" }, note: "", createdAt: 1, updatedAt: 3 };
    await v10.put("savedSpots", spot);
    await v10.put("savedReports", report);
    await v10.put("mistakes", mistake());
    await v10.put("tombstones", { store: "savedRanges", id: "gone", at: 7 });
    await v10.put("kv", "name", "savedSort");
    v10.close();

    const v11 = await openLizardDB(11, name);
    expect(v11.version).toBe(11);
    expect(await v11.get("savedSpots", "s1")).toEqual(spot);
    expect(await v11.get("savedReports", "r1")).toEqual(report);
    expect(await v11.get("mistakes", mistake().id)).toEqual(mistake());
    expect(await v11.get("tombstones", ["savedRanges", "gone"])).toEqual({ store: "savedRanges", id: "gone", at: 7 });
    expect(await v11.get("kv", "savedSort")).toBe("name");
    expect(await v11.count("flopReports")).toBe(0);
    const rec = { id: "f1", name: "BB vs BTN", spot: "p=6&s=100", from: "study" as const, mode: "fast" as const, size: 9, flops: ["Kc7d2h"], done: [], left: [], seats: null, pot: 0, status: "paused" as const, note: "", createdAt: 1, updatedAt: 4 };
    await v11.put("flopReports", rec);
    expect(await v11.getAllFromIndex("flopReports", "byUpdated")).toEqual([rec]);
    v11.close();
  });

  it("opens at version 11", () => {
    expect(DB_VERSION).toBe(11);
  });
});

describe("a delete and its tombstone", () => {
  const spot = (id: string, updatedAt: number) => ({ id, title: id, line: "p=2&s=100", state: {}, tags: [], note: "", createdAt: 1, updatedAt });

  it("stamps a time after the record's last change, however the clock stands, and now where the record says none", async () => {
    const d = await openLizardDB(DB_VERSION, fresh());
    await d.put("savedSpots", spot("ahead", 5000));
    await d.put("savedSpots", spot("behind", 10));
    await d.put("savedSpots", { ...spot("damaged", 10), updatedAt: "soon" as never });
    await deleting(d, ["savedSpots"], async (gone) => {
      await gone("savedSpots", "ahead");
      await gone("savedSpots", "behind");
      await gone("savedSpots", "damaged");
      await gone("savedSpots", "never here");
    }, () => 1000);
    expect(await d.count("savedSpots")).toBe(0);
    const at = Object.fromEntries((await d.getAll("tombstones")).map((t) => [t.id, t.at]));
    expect(at).toEqual({ ahead: 5001, behind: 1000, damaged: 1000, "never here": 1000 });
    d.close();
  });

  it("undoes both where a delete fails: the record stays, with no tombstone", async () => {
    const d = await openLizardDB(DB_VERSION, fresh());
    await d.put("savedSpots", spot("a", 1));
    await d.put("savedSpots", spot("b", 1));
    await expect(
      deleting(d, ["savedSpots"], async (gone) => {
        await gone("savedSpots", "a");
        throw new Error("stopped");
      }),
    ).rejects.toThrow("stopped");
    expect(await d.count("savedSpots")).toBe(2);
    expect(await d.count("tombstones")).toBe(0);
    d.close();
  });

  it("keeps each kind to its bound, the oldest forgotten, without touching another kind's", async () => {
    const d = await openLizardDB(DB_VERSION, fresh());
    await d.put("tombstones", { store: "savedRanges", id: "other", at: 1 });
    for (const [id, t] of [["a", 3], ["b", 1], ["c", 2]] as const) await deleting(d, ["savedSpots"], (gone) => gone("savedSpots", id), () => t, 2);
    expect((await d.getAll("tombstones")).map((t) => `${t.store}/${t.id}`).sort()).toEqual(["savedRanges/other", "savedSpots/a", "savedSpots/c"]);
    d.close();
  });

  it("writes no more than the bound in a bulk delete, and still deletes every record", async () => {
    const d = await openLizardDB(DB_VERSION, fresh());
    for (const id of ["a", "b", "c", "d"]) await d.put("savedSpots", spot(id, 1));
    await deleting(d, ["savedSpots"], async (gone) => {
      for (const id of ["a", "b", "c", "d"]) await gone("savedSpots", id);
    }, Date.now, 2);
    expect(await d.count("savedSpots")).toBe(0);
    expect(await d.count("tombstones")).toBe(2);
    d.close();
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
