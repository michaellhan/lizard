// Custom flop reports kept in this browser: what's read as sound, the list, a delete and its tombstone, and a backup.
import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_STORES, makeBackup, restoreBackup } from "./backup";
import { db, type FlopReportRecord } from "./db";
import { deleteFlopReport, getFlopReport, listFlopReports, MAX_REPORT_FLOPS, putFlopReport, readFlopReport } from "./flopReports";

const flop = (f: string): FlopReportRecord["done"][number] => ({
  f,
  w: 22100 / 9,
  nodes: { "": { names: ["check", "bet 33%"], freqs: [0.6, 0.4] }, check: { names: ["check", "bet 75%"], freqs: [0.3, 0.7] } },
  bets: { "bet 33%": 1.8 },
  ev: [2.1, 3.4],
  eq: [0.46, 0.54],
  source: "live",
  approximate: false,
  exploitabilityPct: 0.21,
  iterations: 300,
  seconds: 3.2,
});

const report = (over: Partial<FlopReportRecord> = {}): FlopReportRecord => ({
  id: "f1",
  name: "BB vs BTN · 9 flops · Fast",
  spot: "p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac",
  from: "solve",
  mode: "fast",
  size: 9,
  flops: ["9c8d3h", "QcTd7h", "AcTd9h"],
  done: [flop("9c8d3h")],
  left: [{ f: "QcTd7h", why: "answered by rules, not a solve" }],
  seats: ["BB", "BTN"],
  pot: 5.5,
  status: "paused",
  note: "",
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

beforeEach(async () => {
  const d = (await db())!;
  for (const s of BACKUP_STORES) await d.clear(s);
  await d.clear("tombstones");
});

describe("a flop report as stored", () => {
  it("reads a sound one as it is, with no note where none was kept", () => {
    expect(readFlopReport(report())).toEqual(report());
    const noNote: Partial<FlopReportRecord> = report();
    delete noNote.note;
    expect(readFlopReport(noNote)?.note).toBe("");
    expect(readFlopReport(report({ seats: null, done: [], left: [] }))).not.toBeNull();
  });

  it.each([
    ["no name", { name: " " }],
    ["a tier that isn't one", { mode: "slow" }],
    ["a set bigger than any offered", { size: MAX_REPORT_FLOPS + 1 }],
    ["a flop that isn't three cards", { flops: ["9c8d"] }],
    ["the same flop twice in the set", { flops: ["9c8d3h", "9c8d3h"] }],
    ["a flop solved that isn't in the set", { done: [flop("2c2d2h")] }],
    ["a flop both solved and left out", { left: [{ f: "9c8d3h", why: "x" }] }],
    ["a frequency past 1", { done: [{ ...flop("9c8d3h"), nodes: { "": { names: ["check"], freqs: [3] } } }] }],
    ["names and frequencies that don't pair", { done: [{ ...flop("9c8d3h"), nodes: { "": { names: ["check", "bet"], freqs: [1] } } }] }],
    ["no root", { done: [{ ...flop("9c8d3h"), nodes: { check: { names: ["check"], freqs: [1] } } }] }],
    ["a source no report has", { done: [{ ...flop("9c8d3h"), source: "rules" }] }],
    ["an equity past 1", { done: [{ ...flop("9c8d3h"), eq: [1.5, -0.5] }] }],
    ["a status that isn't one", { status: "running" }],
    ["a bad time", { updatedAt: "x" }],
    ["seats that aren't two", { seats: ["BB"] }],
  ])("reads %s as damaged", (_, over) => {
    expect(readFlopReport({ ...report(), ...over })).toBeNull();
  });
});

describe("flop reports kept", () => {
  it("are listed the latest changed first, a damaged one counted and left out", async () => {
    await putFlopReport(report({ id: "a", updatedAt: 5 }));
    await putFlopReport(report({ id: "b", updatedAt: 9 }));
    await (await db())!.put("flopReports", { ...report({ id: "c" }), mode: "slow" } as unknown as FlopReportRecord);
    const { list, damaged } = await listFlopReports();
    expect(list.map((r) => r.id)).toEqual(["b", "a"]);
    expect(damaged).toBe(1);
    expect(await getFlopReport("a")).toEqual(report({ id: "a", updatedAt: 5 }));
    expect(await getFlopReport("c")).toBeNull();
  });

  it("are deleted with a tombstone, so a backup made before doesn't bring one back", async () => {
    await putFlopReport(report());
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    await deleteFlopReport("f1");
    expect(await getFlopReport("f1")).toBeNull();
    expect((await restoreBackup(b)).flopReports).toMatchObject({ added: 0, deleted: 1 });
    expect((await listFlopReports()).list).toEqual([]);
  });

  it("go in a backup and come back from it, a damaged one skipped", async () => {
    await putFlopReport(report());
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    expect(b.counts.flopReports).toBe(1);
    expect(b.stores.flopReports[0]).toMatchObject({ id: "f1", created: 1, updated: 2, data: report() });
    const d = (await db())!;
    await d.clear("flopReports");
    expect((await restoreBackup(b)).flopReports).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
    expect((await listFlopReports()).list).toEqual([report()]);
    // (one further on here stays; one further on in the file replaces it)
    await putFlopReport(report({ done: [flop("9c8d3h"), flop("AcTd9h")], updatedAt: 10 }));
    expect((await restoreBackup(b)).flopReports.kept).toBe(1);
    await d.clear("flopReports");
    b.stores.flopReports[0].data.done[0].nodes[""].freqs = ["a lot"];
    expect((await restoreBackup(b)).flopReports.skipped).toBe(1);
    expect((await listFlopReports()).list).toEqual([]);
  });

  it("restore from a backup made before they were kept", async () => {
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    delete b.stores.flopReports;
    delete b.counts.flopReports;
    expect((await restoreBackup(b)).flopReports).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
  });
});
