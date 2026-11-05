import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { filtersOf, listReports, putReport, readReport, reportLink, reportWords } from "./reports";

const report = { id: "r1", name: "Stars BTN", filters: { site: "PokerStars", pos: "BTN" }, note: "", createdAt: 1, updatedAt: 2 };

beforeEach(async () => {
  await (await db())!.clear("savedReports");
});

describe("saved reports", () => {
  it("keeps only the report filters of a URL, and opens on them again", () => {
    const f = filtersOf(new URLSearchParams("site=PokerStars&hand=abc&pos=BTN&q=a%20b"));
    expect(f).toEqual({ site: "PokerStars", pos: "BTN", q: "a b" });
    expect(filtersOf(new URLSearchParams(reportLink(f).split("?")[1]))).toEqual(f);
    expect(reportLink({})).toBe("/analyze");
  });

  it("says its filters in words, and all hands where there are none", () => {
    expect(reportWords({})).toBe("All hands");
    expect(reportWords({ site: "GGPoker", lost: "1", from: "2024-01-02" })).toBe("GGPoker · from 2024-01-02 · 1bb or more EV lost");
  });

  it.each([
    ["no name", { ...report, name: " " }],
    ["a filter that isn't one", { ...report, filters: { hand: "x" } }],
    ["a date that isn't one", { ...report, filters: { from: "yesterday" } }],
    ["an EV step that isn't one", { ...report, filters: { lost: "3" } }],
    ["filters that aren't an object", { ...report, filters: ["site"] }],
    ["a bad time", { ...report, createdAt: "x" }],
  ])("reads %s as damaged", (_, x) => {
    expect(readReport(x)).toBeNull();
  });

  it("reads an older record with no note", () => {
    expect(readReport({ ...report, note: undefined })?.note).toBe("");
  });

  it("lists the latest changed first, and counts what it can't read", async () => {
    await putReport(report);
    await putReport({ ...report, id: "r2", name: "Later", updatedAt: 9 });
    await putReport({ ...report, id: "r3", filters: { hand: "x" } });
    const { list, damaged } = await listReports();
    expect(list.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(damaged).toBe(1);
  });
});
