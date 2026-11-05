import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_FORMAT, BACKUP_STORES, backupFileName, makeBackup, restoreBackup, restoreSummary, type Backup } from "./backup";
import { db, putSession, type DecisionRecord, type HandRecord, type SavedDrill, type SavedRange, type SavedSpot, type SessionRecord } from "./db";
import { addHands, listDecisions, listHands, putDecisions, putHandNotes } from "./hands";
import { chartMistake, mistake } from "@/test/mistake";
import { exploitOf } from "@/features/practice/exploit";
import { keepMistake, listMistakes } from "./mistakes";
import { listReports, putReport } from "./reports";
import { listScenarios, putScenario } from "./scenarios";
import { deleteDrill, drillAt, isDrillLink, listDrills, deleteSpot, listRanges, listSpots, putDrill, putRange, putSpot, readTags, spotAt, spotMatches } from "./saved";

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
    expect(b.counts).toEqual({ savedSpots: 1, savedRanges: 1, savedDrills: 1, savedScenarios: 0, savedReports: 0, sessions: 2, hands: 0, decisions: 0, mistakes: 0 });
    expect(b.stores.savedDrills[0]).toEqual({ id: "k", v: 1, created: 1, updated: 8, dev: b.device, data: drill("k", 8, { note: "every texture" }) });
    expect(b.stores.sessions.find((r) => r.id === "d")).toMatchObject({ id: "d", v: 1, created: 10, updated: 20, dev: b.device });
    expect(b.stores.sessions.find((r) => r.id === "e")).toMatchObject({ created: 30, updated: 30 });
    expect(b.stores.savedSpots[0]).toEqual({ id: "a", v: 1, created: 1, updated: 5, dev: b.device, data: spot("a", 5) });

    const before = { spots: await listSpots(), ranges: await listRanges(), drills: await listDrills(), sessions: (await (await db())!.getAll("sessions")).sort((x, y) => x.id.localeCompare(y.id)) };
    await clearAll();
    expect(await listSpots()).toEqual([]);
    // through the file's text, as a download and an upload would
    const r = await restoreBackup(JSON.parse(JSON.stringify(b)));
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0 });
    expect(r.sessions.added).toBe(2);
    expect(await listSpots()).toEqual(before.spots);
    expect(await listRanges()).toEqual(before.ranges);
    expect(await listDrills()).toEqual(before.drills);
    expect((await (await db())!.getAll("sessions")).sort((x, y) => x.id.localeCompare(y.id))).toEqual(before.sessions);
    expect(restoreSummary(r)).toBe("5 added, 0 updated, 0 kept (as new or newer here)");
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
        // (a drill whose link isn't a drill page's is not restored)
        savedDrills: [
          { id: "j", v: 1, created: 1, updated: 1, dev: "d", data: drill("j", 1, { to: "javascript:alert(1)" }) },
          { id: "g", v: 1, created: 1, updated: 1, dev: "d", data: drill("g", 1) },
        ],
      },
    };
    const r = await restoreBackup(bad);
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 0, skipped: 3 });
    expect(r.sessions.skipped).toBe(1);
    expect(r.savedDrills).toEqual({ added: 1, updated: 0, kept: 0, skipped: 1 });
    expect((await listDrills()).map((d) => d.id)).toEqual(["g"]);
    expect(r.savedRanges).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0 });
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
    expect((await restoreBackup(b)).hands).toEqual({ added: 0, updated: 0, kept: 2, skipped: 0 });
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
    expect(r.mistakes).toEqual({ added: 1, updated: 0, kept: 1, skipped: 2 });
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
    expect((await restoreBackup(b)).savedScenarios).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0 });
    expect((await listScenarios()).list).toEqual([s]);

    await putScenario({ ...s, name: "Newer here", updatedAt: 9 });
    expect((await restoreBackup(b)).savedScenarios).toEqual({ added: 0, updated: 0, kept: 1, skipped: 0 });
    expect((await listScenarios()).list[0]?.name).toBe("Newer here");

    const hurt = (o: Record<string, unknown>, id: string) => ({ ...b.stores.savedScenarios[0], id, data: { ...s, ...o, id } });
    b.stores.savedScenarios = [hurt({ stack: 3 }, "x"), hurt({ opts: { ...s.opts, exploit: { profile: "shark" } } }, "y"), hurt({ opts: { ...s.opts, pot: null } }, "z")];
    expect((await restoreBackup(b)).savedScenarios).toEqual({ added: 0, updated: 0, kept: 0, skipped: 3 });
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
    expect((await restoreBackup(b)).savedReports).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0 });
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
    expect(r.savedScenarios).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0 });
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
    expect(r.mistakes).toEqual({ added: 1, updated: 0, kept: 0, skipped: 4 });
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
    expect(r.mistakes).toEqual({ added: 0, updated: 0, kept: 0, skipped: 0 });
  });

  it("names the file by the day", () => {
    expect(backupFileName(new Date(Date.UTC(2026, 10, 3, 12)))).toBe("lizard-backup-2026-11-03.json");
  });
});
