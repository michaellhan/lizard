import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_FORMAT, BACKUP_SCHEMA, BACKUP_STORES, backupFileName, itemBackup, makeBackup, restoreBackup, RestoreStopped, restoreSummary, type Backup } from "./backup";
import { MAX_ANSWER_BYTES, answerToKeep, openAnswer, readAnswer } from "./answers";
import { db, putSession, type DecisionRecord, type HandRecord, type SavedDrill, type SavedRange, type SavedSpot, type SessionRecord } from "./db";
import { addHands, clearDecisions, deleteImport, getHand, listDecisions, listHands, putDecisions, putHandNotes } from "./hands";
import { chartMistake, mistake } from "@/test/mistake";
import { exploitOf } from "@/features/practice/exploit";
import { deleteMistake, keepMistake, listMistakes } from "./mistakes";
import { deleteReport, listReports, putReport } from "./reports";
import { deleteScenario, listScenarios, putScenario } from "./scenarios";
import { deleteDrill, deleteRange, drillAt, isDrillLink, listDrills, deleteSpot, listRanges, listSpots, putDrill, putRange, putSpot, readTags, sortSaved, spotAt, spotMatches, textMatches } from "./saved";
import { fromSearch, toSearch } from "@/features/study/studyState";
import { provenanceOf } from "@/solver/provenance";
import { CHART_ANSWER, LIVE_ANSWER } from "@/test/answers";

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
const drill = (id: string, updatedAt: number, extra: Partial<SavedDrill> = {}): SavedDrill => ({
  id,
  name: `drill ${id}`,
  kind: "library",
  to: `/practice?tab=drills&spot=srp_btn_bb&view=vsbet&hi=${id}`,
  about: "BTN vs BB SRP · BB facing a bet",
  note: "",
  createdAt: 1,
  updatedAt,
  ...extra,
});
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
  await d.clear("tombstones");
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

describe("saved drills", () => {
  it("lists the latest changed first, finds a drill by its link, deletes", async () => {
    await putDrill(drill("a", 5));
    await putDrill(drill("b", 9, { kind: "leak", to: "/analyze?drill=pf%3ABTN+RFI&pos=BTN" }));
    expect((await listDrills()).map((d) => d.id)).toEqual(["b", "a"]);
    expect((await drillAt("/analyze?drill=pf%3ABTN+RFI&pos=BTN"))?.id).toBe("b");
    expect(await drillAt("/practice?tab=drills")).toBeUndefined();
    await deleteDrill("b");
    expect((await listDrills()).map((d) => d.id)).toEqual(["a"]);
  });

  it("opens only the drill pages' links", () => {
    expect(isDrillLink("library", "/practice?tab=drills&spot=x")).toBe(true);
    expect(isDrillLink("library", "/practice?tab=drills")).toBe(true);
    expect(isDrillLink("leak", "/analyze?drill=freq%3Ax")).toBe(true);
    for (const [k, to] of [
      ["library", "/analyze?drill=freq%3Ax"],
      ["leak", "/practice?tab=drills"],
      ["library", "javascript:alert(1)"],
      ["library", "https://example.com/practice?tab=drills"],
      ["leak", "/analyze?hand=x"],
      ["library", "/practice?tab=drillsx"],
    ] as const)
      expect(isDrillLink(k, to)).toBe(false);
  });
});

describe("backup and restore", () => {
  it("says what came in where the browser stops a restore partway, with the store it stopped on rolled back", async () => {
    await putSpot(spot("a", 1));
    await putSpot(spot("b", 1));
    const b = await makeBackup();
    const d = await db();
    await d!.clear("savedSpots");
    const real = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a) {
      if ((a[0] as { id?: string }).id === "b") throw new DOMException("full", "QuotaExceededError");
      return real.apply(this, a);
    });
    const stopped = await restoreBackup(b).catch((e: unknown) => e);
    put.mockRestore();
    expect(stopped).toBeInstanceOf(RestoreStopped);
    expect((stopped as RestoreStopped).done.savedSpots.added).toBe(0);
    expect((await restoreBackup(b)).savedSpots.added).toBe(2);
  });

  it("keeps a grade's version, restores a grade from before versions as it is, and skips a damaged one", async () => {
    const base: DecisionRecord = { id: "d|flop|1", handId: "h", street: "flop", pos: "BTN", action: "check", verdict: "Best", evLossBb: 0, source: "library", label: "Precomputed solution", gradedAt: 1 };
    const stamped: DecisionRecord = { ...base, id: "d|flop|2", version: "library:srp_btn_bb:11112222:Ac4d3h:abc", read: { verdict: "Mistake", source: "instant", label: "a read", version: "build:aaa/111", evLossBb: null } };
    await clearAll();
    await putDecisions([base, stamped]);
    const b: Backup = JSON.parse(JSON.stringify(await makeBackup()));
    await clearAll();
    expect((await restoreBackup(b)).decisions).toMatchObject({ added: 2, skipped: 0 });
    const back = await listDecisions();
    expect(back.find((d) => d.id === base.id)).toEqual(base);
    expect(back.find((d) => d.id === base.id)).not.toHaveProperty("version");
    expect(back.find((d) => d.id === stamped.id)).toEqual(stamped);
    expect(b.schema).toBe(1);
    await clearAll();
    const bad = { ...stamped, id: "d|flop|3", version: 7 };
    const hurt: Backup = { ...b, stores: { ...b.stores, decisions: [{ id: bad.id, v: 1, created: 1, updated: 1, dev: "x", data: bad as never }] } };
    expect((await restoreBackup(hurt)).decisions).toMatchObject({ added: 0, skipped: 1 });
    await clearAll();
  });

  it("round-trips every record exactly, in the classic record shape", async () => {
    await putSpot(spot("a", 5));
    await putRange(range("r", 7));
    await putSession(session("d", 10, 20));
    await putSession(session("e", 30));
    await putDrill(drill("k", 8, { note: "every texture" }));
    const b = await makeBackup(() => Date.UTC(2026, 10, 3));
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.exported).toBe("2026-11-03T00:00:00.000Z");
    expect(b.counts).toEqual({ savedSpots: 1, savedAnswers: 0, savedRanges: 1, savedDrills: 1, savedScenarios: 0, savedReports: 0, sessions: 2, hands: 0, decisions: 0, mistakes: 0 });
    expect(b.stores.savedDrills[0]).toEqual({ id: "k", v: 1, created: 1, updated: 8, dev: b.device, data: drill("k", 8, { note: "every texture" }) });
    expect(b.stores.sessions.find((r) => r.id === "d")).toMatchObject({ id: "d", v: 1, created: 10, updated: 20, dev: b.device });
    expect(b.stores.sessions.find((r) => r.id === "e")).toMatchObject({ created: 30, updated: 30 });
    expect(b.stores.savedSpots[0]).toEqual({ id: "a", v: 1, created: 1, updated: 5, dev: b.device, data: spot("a", 5) });

    const before = { spots: await listSpots(), ranges: await listRanges(), drills: await listDrills(), sessions: (await (await db())!.getAll("sessions")).sort((x, y) => x.id.localeCompare(y.id)) };
    await clearAll();
    expect(await listSpots()).toEqual([]);
    // through the file's text, as a download and an upload would
    const r = await restoreBackup(JSON.parse(JSON.stringify(b)));
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
    expect(r.sessions.added).toBe(2);
    expect(await listSpots()).toEqual(before.spots);
    expect(await listRanges()).toEqual(before.ranges);
    expect(await listDrills()).toEqual(before.drills);
    expect((await (await db())!.getAll("sessions")).sort((x, y) => x.id.localeCompare(y.id))).toEqual(before.sessions);
    expect(restoreSummary(r)).toBe("5 added, 0 updated, 0 kept (as new or newer here)");
  });

  it("merges: a newer record here is kept, an older one replaced, a missing one added, what was deleted left out, nothing deleted", async () => {
    await putSpot(spot("a", 5));
    await putSpot(spot("b", 5));
    const old = await makeBackup();
    await putSpot(spot("a", 50, { title: "renamed later" }));
    await putSpot(spot("c", 6));
    await deleteSpot("b");
    const r = await restoreBackup(old);
    expect(r.savedSpots).toEqual({ added: 0, updated: 0, kept: 1, skipped: 0, deleted: 1, stillHere: 0 });
    const got = Object.fromEntries((await listSpots()).map((s) => [s.id, s.title]));
    expect(got).toEqual({ a: "renamed later", c: "spot c" });
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
        // (a drill whose link isn't a drill page's is not restored)
        savedDrills: [
          { id: "j", v: 1, created: 1, updated: 1, dev: "d", data: drill("j", 1, { to: "javascript:alert(1)" }) },
          { id: "g", v: 1, created: 1, updated: 1, dev: "d", data: drill("g", 1) },
        ],
      },
    };
    const r = await restoreBackup(bad);
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 0, skipped: 3, deleted: 0, stillHere: 0 });
    expect(r.sessions.skipped).toBe(1);
    expect(r.savedDrills).toEqual({ added: 1, updated: 0, kept: 0, skipped: 1, deleted: 0, stillHere: 0 });
    expect((await listDrills()).map((d) => d.id)).toEqual(["g"]);
    expect(r.savedRanges).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
    expect(restoreSummary(r)).toMatch(/5 skipped/);
    await expect(restoreBackup({ format: "gto-solver-backup", stores: {} })).rejects.toThrow("That isn't a Lizard backup file.");
    await expect(restoreBackup(null)).rejects.toThrow("That isn't a Lizard backup file.");
    await expect(restoreBackup({ ...b, schema: 2 })).rejects.toThrow(/newer Lizard/);
  });

  it("keeps the imported hands with your tags and notes, and their grades; the later note wins", async () => {
    const hand = (id: string): HandRecord => ({
      id,
      site: "PokerStars",
      number: id,
      played: "2024-03-02 21:14",
      playedAt: 1,
      hero: "BTN",
      players: 6,
      hole: "AhQd",
      board: "Qs8d3c",
      bb: "$1",
      potType: "SRP",
      pot: 5.5,
      end: "won, all folded",
      decisions: 2,
      text: "PokerStars Hand #" + id,
      importId: "imp",
      importName: "Pasted hands",
      importedAt: 100,
    });
    const graded: DecisionRecord = { id: "h1|flop|1", handId: "h1", street: "flop", pos: "BTN", action: "bet 1.8", verdict: "Best", evLossBb: 0, source: "library", label: "Precomputed solution · srp_btn_bb", gradedAt: 200 };
    await addHands([hand("h1"), hand("h2")]);
    await putHandNotes("h1", ["bluff", "review"], "too thin?", 300);
    await putDecisions([graded]);
    const b: Backup = JSON.parse(JSON.stringify(await makeBackup()));
    expect([b.counts.hands, b.counts.decisions]).toEqual([2, 1]);
    expect(b.stores.hands.find((r) => r.id === "h1")).toMatchObject({ created: 100, updated: 300 });

    await clearAll();
    const r = await restoreBackup(b);
    expect([r.hands.added, r.decisions.added]).toEqual([2, 1]);
    expect((await listHands()).find((h) => h.id === "h1")).toMatchObject({ tags: ["bluff", "review"], note: "too thin?", updatedAt: 300 });
    expect(await listDecisions()).toEqual([graded]);
    // a note changed here after the backup stays; one cleared in the backup's copy later replaces this one
    await putHandNotes("h1", ["later"], "", 400);
    expect((await restoreBackup(b)).hands).toEqual({ added: 0, updated: 0, kept: 2, skipped: 0, deleted: 0, stillHere: 0 });
    expect((await listHands()).find((h) => h.id === "h1")?.tags).toEqual(["later"]);
    b.stores.hands.find((x) => x.id === "h1")!.data = { ...hand("h1"), updatedAt: 500 };
    expect((await restoreBackup(b)).hands.updated).toBe(1);
    const h1 = (await listHands()).find((h) => h.id === "h1")!;
    expect([h1.tags, h1.note]).toEqual([undefined, undefined]);
    // a damaged hand is skipped
    b.stores.hands[0]!.data = { ...hand(b.stores.hands[0]!.id), tags: "bluff" as never };
    await clearAll();
    expect((await restoreBackup(b)).hands).toMatchObject({ added: 1, skipped: 1 });
  });

  it("carries the kept mistakes: exactly, the later change winning, a damaged one skipped", async () => {
    const a = mistake({ id: "a", updatedAt: 10 });
    const retried = chartMistake({ id: "b", updatedAt: 20, step: 2, tries: [{ at: 20, chose: "fold", verdict: "Best", ok: true, byEv: false, loss: 0, lossPct: 0, source: "charts", label: "Preflop charts", like: true, moved: true }] });
    await keepMistake(a, (_, f) => f);
    await keepMistake(retried, (_, f) => f);
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    expect(b.counts.mistakes).toBe(2);
    expect(b.stores.mistakes.find((r: { id: string }) => r.id === "a")).toMatchObject({ created: a.at, updated: 10 });

    await (await db())!.clear("mistakes");
    await keepMistake(mistake({ id: "a", updatedAt: 15, times: 7 }), (_, f) => f); // newer here: kept
    const r = await restoreBackup({
      ...b,
      stores: { mistakes: [...b.stores.mistakes, { id: "x", v: 1, created: 1, updated: 1, dev: "d", data: { id: "x", due: "soon" } }, { id: "y", v: 1, created: 1, updated: 1, dev: "d", data: mistake({ id: "z" }) }] },
    });
    expect(r.mistakes).toEqual({ added: 1, updated: 0, kept: 1, skipped: 2, deleted: 0, stillHere: 0 });
    const { list, damaged } = await listMistakes();
    expect(list.find((m) => m.id === "a")?.times).toBe(7);
    expect(list.find((m) => m.id === "b")).toEqual(retried);
    expect(damaged).toBe(0);
  });

  it("carries the saved scenarios: exactly, the later change winning, a damaged one skipped", async () => {
    const SETUP = { seat: "BB", preflopOnly: false, pot: "srp", ante: 0, straddle: false, carry: false, sizes: { flop: [33] }, rake: 5, rakeCap: 3, board: { suits: "mono" }, exploit: exploitOf("nit") } as const;
    const s = { id: "s1", name: "Nits in monotone pots", players: 6, stack: 100, opts: { ...SETUP, sizes: { flop: [33] }, board: { suits: "mono" } as const }, note: "with a rake", createdAt: 1, updatedAt: 2 };
    await putScenario(s);
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    expect(b.counts.savedScenarios).toBe(1);
    expect(b.stores.savedScenarios[0]).toMatchObject({ id: "s1", created: 1, updated: 2, data: s });
    await clearAll();
    expect((await restoreBackup(b)).savedScenarios).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
    expect((await listScenarios()).list).toEqual([s]);

    await putScenario({ ...s, name: "Newer here", updatedAt: 9 });
    expect((await restoreBackup(b)).savedScenarios).toEqual({ added: 0, updated: 0, kept: 1, skipped: 0, deleted: 0, stillHere: 0 });
    expect((await listScenarios()).list[0]?.name).toBe("Newer here");

    const hurt = (o: Record<string, unknown>, id: string) => ({ ...b.stores.savedScenarios[0], id, data: { ...s, ...o, id } });
    b.stores.savedScenarios = [hurt({ stack: 3 }, "x"), hurt({ opts: { ...s.opts, exploit: { profile: "shark" } } }, "y"), hurt({ opts: { ...s.opts, pot: null } }, "z")];
    expect((await restoreBackup(b)).savedScenarios).toEqual({ added: 0, updated: 0, kept: 0, skipped: 3, deleted: 0, stillHere: 0 });
    expect((await listScenarios()).list.map((x) => x.id)).toEqual(["s1"]);
  });

  it("keeps an exploit session, and skips one whose read is damaged", async () => {
    const meta = { hands: 1, exploit: exploitOf("station"), sources: { "best-response": 1 } };
    const x: SessionRecord = { id: "x", kind: "exploit", startedAt: 1, decisions: 1, evLossBb: 1, meta };
    await putSession(x);
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    await clearAll();
    expect((await restoreBackup(b)).sessions.added).toBe(1);
    expect((await (await db())!.getAll("sessions"))[0]).toMatchObject({ kind: "exploit", meta: { exploit: exploitOf("station") } });
    await clearAll();
    b.stores.sessions[0].data.meta.exploit = { profile: 7 };
    expect((await restoreBackup(b)).sessions.skipped).toBe(1);
  });

  it("carries the saved reports, a damaged one skipped", async () => {
    const r = { id: "r1", name: "Stars BTN", filters: { site: "PokerStars", pos: "BTN" }, note: "", createdAt: 1, updatedAt: 2 };
    await putReport(r);
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    expect(b.counts.savedReports).toBe(1);
    await clearAll();
    expect((await restoreBackup(b)).savedReports).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
    expect((await listReports()).list).toEqual([r]);
    await clearAll();
    b.stores.savedReports[0].data.filters = { from: "not a date" };
    expect((await restoreBackup(b)).savedReports.skipped).toBe(1);
    expect((await listReports()).list).toEqual([]);
  });

  it("restores a backup from before scenarios were kept", async () => {
    await putSpot(spot("a", 5));
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    delete b.stores.savedScenarios;
    delete b.counts.savedScenarios;
    await clearAll();
    const r = await restoreBackup(b);
    expect(r.savedSpots.added).toBe(1);
    expect(r.savedScenarios).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
  });

  it("carries an entry from Analyze with what it was graded on, and skips one a hostile file made up", async () => {
    const ask = { via: "kept", hand: "h1", decision: "h1|turn|1" } as const;
    const a = mistake({ id: "a", from: "leak", ask, provenance: { ...mistake().provenance!, transport: "kept", keptLabel: "Live solve (Quick)" } });
    await keepMistake(a, (_, f) => f);
    const b = await makeBackup();
    await (await db())!.clear("mistakes");
    const bad = (id: string, x: object) => ({ id, v: 1, created: 1, updated: 1, dev: "d", data: { ...a, id, ...x } });
    const r = await restoreBackup({
      ...b,
      stores: { mistakes: [...b.stores.mistakes, bad("x", { ask: { ...ask, hand: { a: 1 } } }), bad("y", { provenance: null }), bad("z", { from: "__proto__" }), bad("w", { mix: [{ action: "check", freq: 1, ev: 1, rough: 7 }] })] },
    } as Backup);
    expect(r.mistakes).toEqual({ added: 1, updated: 0, kept: 0, skipped: 4, deleted: 0, stillHere: 0 });
    expect((await listMistakes()).list).toEqual([a]);
  });

  it("restores a backup from before mistakes were kept", async () => {
    await putSpot(spot("a", 5));
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    delete b.stores.mistakes;
    delete b.counts.mistakes;
    await clearAll();
    const r = await restoreBackup(b);
    expect(r.savedSpots.added).toBe(1);
    expect(r.mistakes).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
  });

  it("names the file by the day", () => {
    expect(backupFileName(new Date(Date.UTC(2026, 10, 3, 12)))).toBe("lizard-backup-2026-11-03.json");
  });
});

describe("what was deleted", () => {
  const LINE = toSearch(fromSearch("p=6&s=100")!);
  const CTX = { mode: "fast", transport: "worker", solverVersion: "a/b", partial: false, now: 5 } as const;
  const answer = (id: string) => {
    const k = answerToKeep(id, LINE, { data: CHART_ANSWER, provenance: provenanceOf(CHART_ANSWER, CTX) }, 1000);
    if (!("answer" in k)) throw new Error(k.refused);
    return k.answer;
  };
  const SCENARIO = { id: "c", name: "Nit", players: 6, stack: 100, opts: { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, board: null }, note: "", createdAt: 1, updatedAt: 2 } as const;
  const REPORT = { id: "p", name: "All", filters: {}, note: "", createdAt: 1, updatedAt: 2 };
  const hand = (id: string, importId = "imp", extra: Partial<HandRecord> = {}): HandRecord => ({ id, site: "PokerStars", number: id, played: "", playedAt: 1, hero: "BTN", players: 6, hole: "AhQd", board: "", bb: "$1", potType: "SRP", pot: 5.5, end: "won, all folded", decisions: 1, text: `hand ${id}`, importId, importName: "Pasted", importedAt: 100, ...extra });
  const grade = (handId: string, gradedAt = 1): DecisionRecord => ({ id: `${handId}|flop|1`, handId, street: "flop", pos: "BTN", action: "check", verdict: "Best", evLossBb: 0, source: "library", label: "Precomputed solution", gradedAt });
  const copy = async (): Promise<Backup> => JSON.parse(JSON.stringify(await makeBackup())) as Backup;
  const LATER = Date.now() + 60_000;
  const grave = (id: string, updated = 50, extra: object = {}) => ({ id, v: 1, updated, dev: "other", deleted: true as const, ...extra });
  const graves = async () => (await db())!.getAll("tombstones");

  it("stays deleted through a restore, on every way of deleting, each said in the count", async () => {
    await putSpot(spot("s", 5, { line: LINE }), answer("s"));
    await putRange(range("r", 5));
    await putDrill(drill("j", 5));
    await putScenario(SCENARIO);
    await putReport(REPORT);
    await keepMistake(mistake({ id: "m" }), (_, f) => f);
    await addHands([hand("h1"), hand("h2", "other")]);
    await putDecisions([grade("h1"), grade("h2")]);
    const b = await copy();

    await deleteSpot("s");
    await deleteRange("r");
    await deleteDrill("j");
    await deleteScenario("c");
    await deleteReport("p");
    await deleteMistake("m");
    await deleteImport("imp");
    await clearDecisions();

    const r = await restoreBackup(b);
    for (const s of ["savedSpots", "savedAnswers", "savedRanges", "savedDrills", "savedScenarios", "savedReports", "hands", "decisions", "mistakes"] as const)
      expect(r[s], s).toEqual({ added: 0, updated: 0, kept: s === "hands" ? 1 : 0, skipped: 0, deleted: s === "decisions" ? 2 : 1, stillHere: 0 });
    const d = (await db())!;
    for (const s of ["savedSpots", "savedAnswers", "savedRanges", "savedDrills", "savedScenarios", "savedReports", "decisions", "mistakes"] as const) expect(await d.count(s), s).toBe(0);
    expect((await listHands()).map((h) => h.id)).toEqual(["h2"]);
  });

  it("writes one tombstone a record, naming the store, the id and when", async () => {
    await putSpot(spot("s", 5, { line: LINE }), answer("s"));
    await addHands([hand("h1")]);
    await putDecisions([grade("h1")]);
    const before = Date.now();
    await deleteSpot("s");
    await deleteImport("imp");
    const all = await graves();
    expect(all.map((t) => `${t.store}/${t.id}`).sort()).toEqual(["decisions/h1|flop|1", "hands/h1", "savedAnswers/s", "savedSpots/s"]);
    for (const t of all) expect(t.at).toBeGreaterThanOrEqual(before);
  });

  it("forgetting every grade leaves the hands, and a grade given again stands", async () => {
    await addHands([hand("h1")]);
    await putDecisions([grade("h1", 5)]);
    const b = await copy();
    await clearDecisions();
    expect(await listDecisions()).toEqual([]);
    expect((await listHands()).length).toBe(1);
    expect((await graves()).map((t) => t.store)).toEqual(["decisions"]);
    await putDecisions([grade("h1", LATER)]);
    expect((await restoreBackup(b)).decisions).toMatchObject({ kept: 1, deleted: 0 });
    expect((await listDecisions())[0]?.gradedAt).toBe(LATER);
  });

  it("comes back where the copy changed after the delete", async () => {
    await putSpot(spot("s", 5));
    const b = await copy();
    await deleteSpot("s");
    b.stores.savedSpots[0]!.data = spot("s", LATER, { title: "changed since" });
    b.stores.savedSpots[0]!.updated = LATER;
    expect((await restoreBackup(b)).savedSpots).toMatchObject({ added: 1, deleted: 0 });
    expect((await listSpots())[0]?.title).toBe("changed since");
  });

  it("says nothing against a record made again since: the one here is newer, and is kept", async () => {
    await putSpot(spot("s", 5));
    const b = await copy();
    await deleteSpot("s");
    await putSpot(spot("s", LATER, { title: "made again" }));
    expect((await restoreBackup(b)).savedSpots).toMatchObject({ kept: 1, deleted: 0 });
    expect((await listSpots())[0]?.title).toBe("made again");
  });

  it("isn't undone by a device whose clock ran ahead: a delete is after what it deleted", async () => {
    await putSpot(spot("s", LATER));
    const b = await copy();
    await deleteSpot("s");
    expect((await (await db())!.get("tombstones", ["savedSpots", "s"]))?.at).toBe(LATER + 1);
    expect((await restoreBackup(b)).savedSpots.deleted).toBe(1);
    expect(await listSpots()).toEqual([]);
  });

  it("restores a backup from before tombstones, leaving out only what this browser remembers", async () => {
    await putSpot(spot("a", 5));
    await putSpot(spot("b", 5));
    const b = await copy();
    delete b.tombstones;
    await deleteSpot("a");
    await (await db())!.clear("savedSpots");
    expect((await restoreBackup(b)).savedSpots).toMatchObject({ added: 1, deleted: 1 });
    await clearAll();
    expect((await restoreBackup(b)).savedSpots).toMatchObject({ added: 2, deleted: 0 });
  });

  it("carries tombstones in a backup, in classic's shape and beside the records, at the same schema", async () => {
    await putSpot(spot("s", 5, { line: LINE }), answer("s"));
    await deleteSpot("s");
    const b = await copy();
    expect(b.schema).toBe(1);
    expect(BACKUP_SCHEMA).toBe(1);
    expect(b.stores.savedSpots).toEqual([]);
    expect(Object.keys(b.tombstones!).sort()).toEqual(["savedAnswers", "savedSpots"]);
    const t = b.tombstones!.savedSpots![0]!;
    expect(t).toEqual({ id: "s", v: 1, updated: t.updated, dev: b.device, deleted: true });
  });

  it("travels: deleted on one device, it stays out of a restore on another, from that file and from older ones", async () => {
    await putSpot(spot("x", 5));
    const older = await copy();
    await deleteSpot("x");
    const newer = await copy();
    newer.tombstones!.savedSpots![0]!.dev = "the laptop";
    // another browser, which has neither
    await clearAll();
    expect((await restoreBackup(newer)).savedSpots).toMatchObject({ added: 0, deleted: 0 });
    expect((await restoreBackup(older)).savedSpots).toMatchObject({ added: 0, deleted: 1 });
    expect(await listSpots()).toEqual([]);
    // and on from there, keeping who deleted it
    const onward = await copy();
    expect(onward.tombstones!.savedSpots![0]!.dev).toBe("the laptop");
  });

  it("leaves out a record its own file says was deleted later, and a tombstone can't outlast a later copy", async () => {
    const b = await copy();
    b.stores.savedSpots = [{ id: "old", v: 1, created: 1, updated: 5, dev: "d", data: spot("old", 5) }, { id: "new", v: 1, created: 1, updated: 90, dev: "d", data: spot("new", 90) }];
    b.tombstones = { savedSpots: [grave("old"), grave("new")] };
    expect((await restoreBackup(b)).savedSpots).toMatchObject({ added: 1, deleted: 1 });
    expect((await listSpots()).map((s) => s.id)).toEqual(["new"]);
    // (the one that came in is live here, so no tombstone stands beside it)
    expect((await graves()).map((t) => t.id)).toEqual(["old"]);
  });

  it("never deletes a record kept here, says so, and doesn't mark it for this browser's next backups", async () => {
    await putSpot(spot("here", 5));
    const b = await copy();
    b.stores.savedSpots = [];
    b.tombstones = { savedSpots: [grave("here")] };
    const r = await restoreBackup(b);
    expect(r.savedSpots).toMatchObject({ added: 0, kept: 0, deleted: 0, stillHere: 1 });
    expect(restoreSummary(r)).toBe("0 added, 0 updated, 0 kept (as new or newer here), 1 still here though the file says it was deleted elsewhere, as a restore deletes nothing");
    expect((await listSpots()).map((s) => s.id)).toEqual(["here"]);
    expect(await graves()).toEqual([]);
  });

  it("says how many were left out for being deleted, apart from the damaged", async () => {
    await putSpot(spot("a", 5));
    await putSpot(spot("b", 5));
    const b = await copy();
    b.stores.savedSpots.push({ id: "bad", v: 1, created: 1, updated: 1, dev: "d", data: { id: "bad", title: 3 } as never });
    await deleteSpot("a");
    await deleteSpot("b");
    expect(restoreSummary(await restoreBackup(b))).toBe("0 added, 0 updated, 0 kept (as new or newer here), 2 left out because they were deleted after that copy, 1 skipped (damaged or not Lizard's)");
    await putSpot(spot("c", 5));
    const one = await copy();
    await deleteSpot("c");
    expect(restoreSummary(await restoreBackup(one))).toContain("1 left out because it was deleted after that copy");
  });

  it("counts a tombstone that isn't one as damaged, and takes nothing from it", async () => {
    const now = 1_000_000;
    const bad: unknown[] = [
      "x",
      null,
      { id: "a", updated: 5 },
      grave("", 5),
      grave("\ud800", 5),
      grave("x".repeat(513), 5),
      grave("t", "5" as never),
      grave("t", 0),
      grave("t", -1),
      grave("t", 9e15),
      grave("t", now + 2 * 86_400_000),
      grave("t", 5, { dev: 7 }),
    ];
    const b = await copy();
    b.tombstones = { savedSpots: bad as never, savedRanges: "all" as never };
    const r = await restoreBackup(b, { now: () => now });
    expect(r.savedSpots.skipped).toBe(bad.length);
    expect(r.savedRanges.skipped).toBe(1);
    expect(await graves()).toEqual([]);
    expect(restoreSummary(r)).toContain(`${bad.length + 1} skipped (damaged or not Lizard's)`);
  });

  it("reaches no store but the backup's: settings and any other name are left unread", async () => {
    await (await db())!.put("kv", "name", "savedSort");
    const b = await copy();
    b.tombstones = { kv: [grave("savedSort")], tombstones: [grave("x")], ["__proto__"]: [grave("y")], savedSpots: "nope" } as never;
    await restoreBackup(b);
    expect(await (await db())!.get("kv", "savedSort")).toBe("name");
    expect(await graves()).toEqual([]);
    for (const not of [7, "x", null, []]) await restoreBackup({ ...b, tombstones: not });
    expect(await graves()).toEqual([]);
  });

  it("takes a store's tombstones where the file has no such store, as an older page's or one by hand", async () => {
    const b = await copy();
    expect((await restoreBackup({ format: b.format, schema: 1, stores: {}, tombstones: { hands: [grave("h")] } })).hands).toMatchObject({ added: 0 });
    expect((await graves()).map((t) => t.id)).toEqual(["h"]);
  });

  it("keeps a later deletion of two, here and in a file", async () => {
    const b = await copy();
    b.tombstones = { savedSpots: [grave("x", 30), grave("x", 60), grave("x", 40)] };
    await restoreBackup(b);
    expect((await graves()).map((t) => t.at)).toEqual([60]);
    b.tombstones = { savedSpots: [grave("x", 20)] };
    await restoreBackup(b);
    expect((await graves()).map((t) => t.at)).toEqual([60]);
    b.tombstones = { savedSpots: [grave("x", 70)] };
    await restoreBackup(b);
    expect((await graves()).map((t) => t.at)).toEqual([70]);
  });

  it("can't push out a deletion remembered here: a file only fills what room the bound leaves, its latest first", async () => {
    await putSpot(spot("mine", 5));
    const b = await copy();
    await deleteSpot("mine");
    const flood = await copy();
    flood.tombstones = { savedSpots: [grave("a", 10), grave("b", 30), grave("c", 20)] };
    await restoreBackup(flood, { maxTombstones: 3 });
    const spots = async () => (await graves()).filter((t) => t.store === "savedSpots").map((t) => t.id);
    expect((await spots()).sort()).toEqual(["b", "c", "mine"]);
    expect((await restoreBackup(b, { maxTombstones: 3 })).savedSpots.deleted).toBe(1);
    await restoreBackup({ ...flood, tombstones: { savedSpots: [grave("z", 40)] } }, { maxTombstones: 3 });
    expect(await spots()).not.toContain("z");
  });

  it("takes a file's tombstones with its records or not at all, where the browser stops it", async () => {
    const b = await copy();
    b.stores.savedSpots = [{ id: "a", v: 1, created: 1, updated: 90, dev: "d", data: spot("a", 90) }];
    b.tombstones = { savedSpots: [grave("gone")] };
    const real = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...a) {
      if ((a[0] as { id?: string }).id === "gone") throw new DOMException("full", "QuotaExceededError");
      return real.apply(this, a);
    });
    expect(await restoreBackup(b).catch((e: unknown) => e)).toBeInstanceOf(RestoreStopped);
    put.mockRestore();
    expect(await listSpots()).toEqual([]);
    expect(await graves()).toEqual([]);
  });

  it("leaves a deleted hand's grades out by the hand's tombstone, whose own the bound may have forgotten", async () => {
    await addHands([hand("h1")]);
    await putDecisions([grade("h1", 5)]);
    const b = await copy();
    await deleteImport("imp");
    await (await db())!.delete("tombstones", ["decisions", grade("h1").id]);
    expect((await restoreBackup(b)).decisions).toMatchObject({ added: 0, deleted: 1 });
    // a grade given after it isn't one of those
    b.stores.decisions[0]!.data = grade("h1", LATER);
    expect((await restoreBackup(b)).decisions).toMatchObject({ added: 1, deleted: 0 });
  });

  it("brings a hand back that's imported again, with the note on it, and leaves the grades that went with it", async () => {
    await addHands([hand("h1")]);
    await putDecisions([grade("h1", 5)]);
    const b = await copy();
    await deleteImport("imp");
    await addHands([hand("h1", "again", { importedAt: LATER })]);
    expect((await restoreBackup(b)).hands).toMatchObject({ kept: 1, deleted: 0 });
    expect((await restoreBackup(b)).decisions.deleted).toBe(1);
    const moved = await copy();
    await clearAll();
    const r = await restoreBackup(moved);
    expect(r.hands).toMatchObject({ added: 1, deleted: 0 });
    expect((await getHand("h1"))?.importedAt).toBe(LATER);
  });

  it("isn't undone by one item's file, which names no other deletion", async () => {
    await putRange(range("r", 3));
    await putRange(range("other", 3));
    await deleteRange("other");
    const item = await itemBackup("savedRanges", range("r", 3));
    expect(item.tombstones).toEqual({});
    await deleteRange("r");
    const r = await restoreBackup(JSON.parse(JSON.stringify(item)));
    expect(r.savedRanges).toMatchObject({ added: 0, deleted: 1 });
  });
});

describe("a saved answer", () => {
  const CHART_LINE = toSearch(fromSearch("p=6&s=100")!);
  const TURN_LINE = toSearch(fromSearch("p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c&b=Ac7s3d9h&flop=BB:x,BTN:x")!);
  const CTX = { mode: "fast", transport: "worker", solverVersion: "aaa/111", partial: false, now: 5 } as const;
  const kept = (id: string, line: string, data: typeof CHART_ANSWER) => {
    const k = answerToKeep(id, line, { data, provenance: provenanceOf(data, CTX) }, 1000);
    if (!("answer" in k)) throw new Error(k.refused);
    return k.answer;
  };
  const withAnswer = () => putSpot(spot("s", 9, { line: TURN_LINE }), kept("s", TURN_LINE, LIVE_ANSWER));

  it("goes in with its spot, and a later save takes its place", async () => {
    await withAnswer();
    expect((await openAnswer("s", TURN_LINE))?.result.data).toEqual(LIVE_ANSWER);
    await putSpot(spot("s", 10, { line: TURN_LINE }), { ...kept("s", TURN_LINE, LIVE_ANSWER), savedAt: 2000 });
    expect((await openAnswer("s", TURN_LINE))?.record.savedAt).toBe(2000);
    expect(await (await db())!.count("savedAnswers")).toBe(1);
  });

  it("stays when the spot is edited without one, and goes when the spot does", async () => {
    await withAnswer();
    await putSpot(spot("s", 11, { line: TURN_LINE, title: "Renamed" }));
    expect(await openAnswer("s", TURN_LINE)).not.toBeNull();
    await deleteSpot("s");
    expect(await openAnswer("s", TURN_LINE)).toBeNull();
    expect(await (await db())!.count("savedAnswers")).toBe(0);
  });

  it("answers only its own line", async () => {
    await withAnswer();
    expect(await openAnswer("s", CHART_LINE)).toBeNull();
  });

  it("isn't half stored: a refused answer leaves the spot out too", async () => {
    const bad = { ...kept("s", TURN_LINE, LIVE_ANSWER), id: undefined } as never;
    await expect(putSpot(spot("s", 9, { line: TURN_LINE }), bad)).rejects.toThrow();
    expect(await listSpots()).toEqual([]);
  });

  it("travels in the backup file as text, and survives a restore into an empty browser, marked as restored", async () => {
    await withAnswer();
    const b = await makeBackup();
    expect(b.counts.savedAnswers).toBe(1);
    expect(b.stores.savedAnswers[0]).toMatchObject({ id: "s", created: 1000, updated: 1000 });
    const file = JSON.parse(JSON.stringify(b)) as Backup;
    await clearAll();
    expect((await restoreBackup(file)).savedAnswers).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
    const back = await openAnswer("s", TURN_LINE);
    expect(back?.result.data).toEqual(LIVE_ANSWER);
    expect(back?.result.provenance).toMatchObject({ source: "live", solverVersion: "aaa/111" });
    expect(back?.record.restored).toBe(true);
    expect((await restoreBackup(file)).savedAnswers).toEqual({ added: 0, updated: 0, kept: 1, skipped: 0, deleted: 0, stillHere: 0 });
  });

  it("from a file is said to be, however the file reads, on an answer replaced as on a new one", async () => {
    await withAnswer();
    const b = JSON.parse(JSON.stringify(await makeBackup())) as Backup;
    b.stores.savedAnswers[0]!.data.savedAt = 5000;
    expect((await restoreBackup(b)).savedAnswers.updated).toBe(1);
    expect((await openAnswer("s", TURN_LINE))?.record).toMatchObject({ savedAt: 5000, restored: true });
    expect(b.stores.savedAnswers[0]!.data.restored).toBeUndefined();
  });

  it("a crafted file can't call a chart solved: the record is skipped and counted, and nothing is stored", async () => {
    await putSpot(spot("s", 9, { line: CHART_LINE }), kept("s", CHART_LINE, CHART_ANSWER));
    const b = JSON.parse(JSON.stringify(await makeBackup())) as Backup;
    await clearAll();
    const rec = b.stores.savedAnswers[0]!;
    const hurt = (id: string, json: unknown) => ({ ...rec, id, data: { ...rec.data, id, json: JSON.stringify(json) } });
    b.stores.savedAnswers = [hurt("a", { ...CHART_ANSWER, solver: { iterations: 500, exploitability_pct: 0.1 } }), hurt("b", { ...CHART_ANSWER, precomputed: { spot: "x" } }), hurt("c", { ...CHART_ANSWER, street: "river" }), { ...rec, id: "d", data: { ...rec.data, id: "d", json: " ".repeat(MAX_ANSWER_BYTES + 1) } }];
    expect((await restoreBackup(b)).savedAnswers).toEqual({ added: 0, updated: 0, kept: 0, skipped: 4, deleted: 0, stillHere: 0 });
    expect(await (await db())!.count("savedAnswers")).toBe(0);
    expect((await listSpots()).map((s) => s.id)).toEqual(["s"]);
  });

  it("a provenance edited in a file changes nothing: what's shown comes from the answer", async () => {
    await putSpot(spot("s", 9, { line: CHART_LINE }), kept("s", CHART_LINE, CHART_ANSWER));
    const b = JSON.parse(JSON.stringify(await makeBackup())) as Backup;
    await clearAll();
    b.stores.savedAnswers[0]!.data.provenance = { ...b.stores.savedAnswers[0]!.data.provenance, source: "live", approximate: false, exploitabilityPct: 0.1, keptLabel: "Live solve" };
    await restoreBackup(b);
    const p = (await openAnswer("s", CHART_LINE))!.result.provenance;
    expect(p).toMatchObject({ source: "charts", approximate: true });
    expect(p.exploitabilityPct).toBeUndefined();
  });

  it("a backup made before answers has none, and restores all it has; the record version stands, so an older page reads this one", async () => {
    await putSpot(spot("s", 9));
    const b = JSON.parse(JSON.stringify(await makeBackup())) as { stores: Partial<Backup["stores"]> };
    delete b.stores.savedAnswers;
    await clearAll();
    const r = await restoreBackup(b);
    expect(r.savedSpots.added).toBe(1);
    expect(r.savedAnswers).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0, deleted: 0, stillHere: 0 });
    expect(BACKUP_SCHEMA).toBe(1);
  });
});

describe("one item to a file", () => {
  it("is a backup a restore takes, a spot with its answer, and nothing else", async () => {
    const line = toSearch(fromSearch("p=6&s=100")!);
    const k = answerToKeep("s", line, { data: CHART_ANSWER, provenance: provenanceOf(CHART_ANSWER, { mode: "fast", transport: "worker", solverVersion: "a/b", partial: false, now: 1 }) });
    const s = spot("s", 9, { line });
    await putSpot(s, "answer" in k ? k.answer : undefined);
    await putSpot(spot("other", 9));
    const b = JSON.parse(JSON.stringify(await itemBackup("savedSpots", s))) as Backup;
    expect(b.counts).toMatchObject({ savedSpots: 1, savedAnswers: 1, sessions: 0 });
    expect(b.format).toBe(BACKUP_FORMAT);
    await clearAll();
    const r = await restoreBackup(b);
    expect([r.savedSpots.added, r.savedAnswers.added]).toEqual([1, 1]);
    expect((await listSpots()).map((x) => x.id)).toEqual(["s"]);
    expect((await openAnswer("s", line))?.result.data).toEqual(CHART_ANSWER);
  });

  it("of another kind holds that record alone", async () => {
    const b = await itemBackup("savedRanges", range("r", 3));
    expect(b.stores.savedRanges.map((x) => x.id)).toEqual(["r"]);
    expect(b.stores.savedAnswers).toEqual([]);
    expect(readAnswer(undefined)).toBeNull();
  });
});

describe("the other kinds' tags", () => {
  const TAGS = { tags: ["3bp", "nit"] };
  const SCENARIO = { id: "c", name: "Nit", players: 6, stack: 100, opts: { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, board: null }, note: "", createdAt: 1, updatedAt: 2 } as never;
  const REPORT = { id: "p", name: "All", filters: {}, note: "", createdAt: 1, updatedAt: 2 };

  it("come back through each kind's reader, which rebuilds the record", async () => {
    await putScenario({ ...(SCENARIO as object), ...TAGS } as never);
    await putReport({ ...REPORT, ...TAGS });
    expect((await listScenarios()).list[0]?.tags).toEqual(TAGS.tags);
    expect((await listReports()).list[0]?.tags).toEqual(TAGS.tags);
  });

  it("a record with none reads with none, not an empty list that wasn't saved", async () => {
    await putScenario(SCENARIO);
    await putReport(REPORT);
    expect((await listScenarios()).list[0]).not.toHaveProperty("tags");
    expect((await listReports()).list[0]).not.toHaveProperty("tags");
  });

  it("the Ranges editor saving over a range keeps its tags, knowing nothing of them", async () => {
    await putRange({ ...range("r", 3), ...TAGS });
    await putRange({ ...range("r", 4), text: "33+" });
    expect((await listRanges())[0]).toMatchObject({ text: "33+", tags: TAGS.tags });
    await putRange({ ...range("r", 5), tags: [] });
    expect((await listRanges())[0]?.tags).toEqual([]);
  });

  it("round-trip a backup, and tags that aren't a list of text are skipped", async () => {
    await putRange({ ...range("r", 3), ...TAGS });
    await putDrill(drill("d", 3, TAGS));
    await putReport({ ...REPORT, ...TAGS });
    await putScenario({ ...(SCENARIO as object), ...TAGS } as never);
    const b = JSON.parse(JSON.stringify(await makeBackup())) as Backup;
    await clearAll();
    await restoreBackup(b);
    expect((await listRanges())[0]?.tags).toEqual(TAGS.tags);
    expect((await listDrills())[0]?.tags).toEqual(TAGS.tags);
    expect((await listReports()).list[0]?.tags).toEqual(TAGS.tags);
    expect((await listScenarios()).list[0]?.tags).toEqual(TAGS.tags);
    await clearAll();
    for (const s of ["savedRanges", "savedDrills", "savedReports", "savedScenarios"] as const) (b.stores[s][0]!.data as { tags: unknown }).tags = [{}];
    const r = await restoreBackup(b);
    expect([r.savedRanges.skipped, r.savedDrills.skipped, r.savedReports.skipped, r.savedScenarios.skipped]).toEqual([1, 1, 1, 1]);
  });
});

describe("sorting a list", () => {
  const X = [
    { id: "a", name: "beta", createdAt: 2, updatedAt: 9 },
    { id: "b", name: "Alpha", createdAt: 3, updatedAt: 5 },
    { id: "c", name: "gamma 10", createdAt: 1, updatedAt: 7 },
    { id: "d", name: "gamma 9", createdAt: 4, updatedAt: 6 },
  ];
  const ids = (by: Parameters<typeof sortSaved>[1]) => sortSaved(X, by, (x) => x.name).map((x) => x.id).join("");

  it("reads each order, leaving the list it's given alone", () => {
    expect(ids("changed")).toBe("acdb");
    expect(ids("newest")).toBe("dbac");
    expect(ids("oldest")).toBe("cabd");
    expect(ids("name")).toBe("badc");
    expect(X.map((x) => x.id).join("")).toBe("abcd");
  });

  it("searches any kind's texts as a spot's: every word, ignoring case", () => {
    expect(textMatches(["Flop drill", "3bp"], "3BP flop")).toBe(true);
    expect(textMatches(["Flop drill", "3bp"], "turn")).toBe(false);
    expect(textMatches(["x"], "")).toBe(true);
  });
});
