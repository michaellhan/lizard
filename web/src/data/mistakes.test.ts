// The kept mistakes in IndexedDB: added, merged, changed, and a damaged record left out, never a crash.
import { describe, expect, it } from "vitest";
import { chartMistake, DAY_ONE, LIVE, mistake, STORED } from "@/test/mistake";
import { db } from "./db";
import { addMistake, changeMistake, deleteMistake, keepMistake, listMistakes, readMistake } from "./mistakes";

const wipe = async () => (await db())!.clear("mistakes");

describe("a kept record, read", () => {
  it("takes a version on a try and on a stored answer, an old record with neither, and no version that isn't a string", () => {
    const tried = { at: 1, chose: "check", verdict: "Best", ok: true, byEv: true, loss: 0, lossPct: 0, source: "live", label: "x", like: true, moved: true } as const;
    expect(readMistake(mistake({ tries: [tried] }))).not.toBeNull();
    expect(readMistake(mistake({ tries: [{ ...tried, version: "build:aaa/111" }] }))).not.toBeNull();
    expect(readMistake(mistake({ tries: [{ ...tried, version: 7 as never }] }))).toBeNull();
    expect(readMistake(mistake({ provenance: { ...STORED, libraryVersion: "library:s:1" } }))).not.toBeNull();
    expect(readMistake(mistake({ provenance: { ...STORED, libraryVersion: 7 as never } }))).toBeNull();
  });

  it("takes a whole one, of either kind of answer", () => {
    expect(readMistake(mistake())).toEqual(mistake());
    expect(readMistake(chartMistake())).toEqual(chartMistake());
    expect(readMistake(mistake({ provenance: null, study: null, due: null, step: 4 }))).not.toBeNull();
    const turn = { via: "library", spot: "x", flop: "Ac8c6c", path: [], combo: [1, 2], turn: { card: "2h", at: [] } } as const;
    expect(readMistake(mistake({ ask: { ...turn, path: [], combo: [1, 2], turn: { card: "2h", at: [] } } }))).not.toBeNull();
  });

  it.each([
    ["nothing", null],
    ["a string", "mistake"],
    ["an array", []],
    ["no id", { ...mistake(), id: "" }],
    ["an unknown origin", { ...mistake(), from: "memory" }],
    ["a due that isn't a number", { ...mistake(), due: "soon" }],
    ["an infinite date", { ...mistake(), at: Infinity }],
    ["a Best kept as a mistake", { ...mistake(), grade: { ...mistake().grade, verdict: "Best" } }],
    ["a grade that says it's fine", { ...mistake(), grade: { ...mistake().grade, ok: true } }],
    ["a grade past the mix", { ...mistake(), grade: { ...mistake().grade, a: 7 } }],
    ["an empty mix", { ...mistake(), mix: [] }],
    ["an unknown provenance", { ...mistake(), provenance: { ...mistake().provenance, source: "guess" } }],
    ["a provenance with no mode", { ...mistake(), provenance: { source: "live", approximate: false } }],
    ["no way to ask it", { ...mistake(), ask: { via: "post" } }],
    ["a damaged turn", { ...mistake(), ask: { via: "library", spot: "x", flop: "y", path: [], combo: [1, 2], turn: { card: 3, at: [] } } }],
    ["one hole card", { ...mistake(), hole: ["Ah"] }],
    ["a damaged retry", { ...mistake(), tries: [{ at: 1 }] }],
  ])("refuses %s", (_, x) => {
    expect(readMistake(x)).toBeNull();
  });
});

describe("the mistakes store", () => {
  it("adds a spot, merges the same spot missed again, the latest missed first", async () => {
    await wipe();
    await keepMistake(mistake({ id: "a" }), (_, f) => f);
    await keepMistake(mistake({ id: "b", lastAt: DAY_ONE + 5 }), (_, f) => f);
    await keepMistake(mistake({ id: "a", lastAt: DAY_ONE + 9 }), (w, f) => ({ ...f, times: w.times + 1 }));
    const { list, damaged } = await listMistakes();
    expect(list.map((m) => [m.id, m.times])).toEqual([["a", 2], ["b", 1]]);
    expect(damaged).toBe(0);
  });

  it("leaves out a damaged record and counts it, and replaces one when the spot is missed again", async () => {
    await wipe();
    const d = (await db())!;
    await keepMistake(mistake({ id: "good" }), (_, f) => f);
    await d.put("mistakes", { id: "bad", due: 1, lastAt: 2, street: "flop" } as never);
    const got = await listMistakes();
    expect(got.list.map((m) => m.id)).toEqual(["good"]);
    expect(got.damaged).toBe(1);
    expect(await changeMistake("bad", (m) => m)).toBeUndefined();
    await keepMistake(mistake({ id: "bad" }), (w) => ({ ...w, times: 99 }));
    expect((await listMistakes()).list.find((m) => m.id === "bad")?.times).toBe(1);
  });

  it("changes a record from what's stored now, and says when it's gone", async () => {
    await wipe();
    await keepMistake(mistake({ id: "a", step: 1 }), (_, f) => f);
    expect((await changeMistake("a", (m) => ({ ...m, step: m.step + 1 })))?.step).toBe(2);
    expect((await listMistakes()).list[0]?.step).toBe(2);
    expect(await changeMistake("none", (m) => m)).toBeUndefined();
  });
});

describe("an entry from Analyze", () => {
  const ask = { via: "kept", hand: "h1", decision: "h1|turn|1" } as const;
  const kept = (x = {}) => mistake({ from: "analyze", ask, provenance: { ...LIVE, transport: "kept", keptLabel: "Live solve (Quick)" }, ...x });

  it("reads back whole, from Analyze or a leak drill, a rough action marked", () => {
    expect(readMistake(kept())).toEqual(kept());
    expect(readMistake(kept({ from: "leak" }))).toEqual(kept({ from: "leak" }));
    const rough = kept({ mix: [{ action: "check", freq: 0.1, ev: 4, rough: true }, { action: "bet 33%", freq: 0.9, ev: 4.4, amount: 2 }] });
    expect(readMistake(rough)).toEqual(rough);
  });

  it.each([
    ["a from it doesn't know", { from: "mail" }],
    ["a hand that isn't a string", { ask: { ...ask, hand: 7 } }],
    ["no hand", { ask: { ...ask, hand: "" } }],
    ["a hand that isn't well formed", { ask: { ...ask, hand: "h\ud800" } }],
    ["no decision", { ask: { via: "kept", hand: "h1" } }],
    ["a way it doesn't know", { ask: { ...ask, via: "post" } }],
    ["no provenance: nothing to grade by", { provenance: null }],
    ["a line that isn't a string", { provenance: { ...LIVE, keptLabel: 7 } }],
    ["a mark that isn't one", { mix: [{ action: "check", freq: 1, ev: 1, rough: "yes" }] }],
  ])("refuses %s", (_, x) => {
    expect(readMistake(kept(x))).toBeNull();
  });
});

describe("adding and deleting one", () => {
  it("adds a spot once, and tells which", async () => {
    await wipe();
    expect(await addMistake(mistake({ id: "a" }))).toBe("added");
    expect(await addMistake(mistake({ id: "a", times: 5 }))).toBe("there");
    expect((await listMistakes()).list).toMatchObject([{ id: "a", times: 1 }]);
  });

  it("replaces a damaged record with what's added", async () => {
    await wipe();
    await (await db())!.put("mistakes", { id: "a", due: "soon" } as never);
    expect(await addMistake(mistake({ id: "a" }))).toBe("added");
    expect((await listMistakes()).damaged).toBe(0);
  });

  it("deletes one, the rest stay, and a delete of what's gone is no harm", async () => {
    await wipe();
    await keepMistake(mistake({ id: "a" }), (_, f) => f);
    await keepMistake(mistake({ id: "b" }), (_, f) => f);
    expect(await deleteMistake("a")).toBe(true);
    expect(await deleteMistake("a")).toBe(true);
    expect((await listMistakes()).list.map((m) => m.id)).toEqual(["b"]);
  });
});
