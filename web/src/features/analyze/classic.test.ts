// The classic import on a fixture "gto-store" database (the classic store's layout, store.js): read, never written,
// and never created where there's none.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importHand } from "@/hh/replay";
import { prepare } from "./analyze";
import { classicDb } from "@/test/classic";
import { CLASSIC_IMPORT, CLASSIC_SITE, classicHand, classicRecords, readClassicHands, readClassicSpeed, type ClassicRecord } from "./classic";

const HH = readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", "stars_6max_srp.txt"), "utf8");
const AT = Date.UTC(2026, 10, 3, 12);

const acts = (pre: unknown[], flop: unknown[] = [], turn: unknown[] = [], river: unknown[] = []) => ({ preflop: pre, flop, turn, river });
const a = (pos: string, action: string, to?: number) => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const rec = (id: string, data: Record<string, unknown>, extra: Partial<ClassicRecord> = {}): ClassicRecord => ({
  id,
  v: 1,
  created: new Date(2025, 5, 1, 9, 30).getTime(),
  updated: new Date(2025, 5, 1, 9, 30).getTime(),
  dev: "classic-device",
  data,
  ...extra,
} as ClassicRecord);

// a single-raised pot from the button, the big blind folding to a flop bet (graded in the classic app: the grades stay there)
const SRP = rec("4b1c9e2a-0000-4000-8000-000000000001", {
  state: {
    players: 6,
    hero: "BTN",
    stack: 100,
    cards: ["Ah", "Kd", "Qs", "8d", "3c", null, null],
    actions: acts([a("UTG", "fold"), a("HJ", "fold"), a("CO", "fold"), { ...a("BTN", "raise", 2.5), g: { f: 1 } }, a("SB", "fold"), a("BB", "call")], [a("BB", "check"), a("BTN", "bet", 1.8), a("BB", "fold")]),
  },
  source: "table",
  tags: ["srp", " c-bet ", "srp"],
  note: " bet small ",
});
// heads-up for 30bb against your 100: a 3-bet, a jam and a call, the board run out
const SHORT = rec("4b1c9e2a-0000-4000-8000-000000000002", {
  state: {
    players: 2,
    hero: "BB",
    stack: 100,
    stacks: { SB: 30 },
    cards: ["Jc", "Jd", "2h", "7s", "9c", "Kh", "4d"],
    actions: acts([a("SB", "raise", 2.5), a("BB", "raise", 11), a("SB", "all-in"), a("BB", "call")]),
  },
  source: "table",
});
const IMPORTED = rec("4b1c9e2a-0000-4000-8000-000000000003", { state: { players: 6 }, source: "import", site: "PokerStars", hh: HH, tags: ["review"] });
const ANTE = rec("ante", { state: { ...(SRP.data as { state: object }).state, ante: 0.1 } });
const NO_CARDS = rec("nocards", { state: { ...(SRP.data as { state: object }).state, cards: [null, null, null, null, null, null, null] } });
const NO_FLOP = rec("noflop", { state: { ...(SRP.data as { state: object }).state, cards: ["Ah", "Kd", null, null, null, null, null] } });
const GONE = { id: "gone", v: 1, created: 1, updated: 2, dev: "d", deleted: true } as ClassicRecord;
const ALL = [SRP, SHORT, IMPORTED, ANTE, NO_CARDS, NO_FLOP, GONE];

/** Everything in it, and its version (opened at the version it has). */
function dump(name: string): Promise<{ version: number; stores: Record<string, unknown[]> }> {
  return new Promise((resolve) => {
    const q = indexedDB.open(name);
    q.onsuccess = () => {
      const d = q.result;
      const names = [...d.objectStoreNames];
      const t = d.transaction(names, "readonly");
      const reqs = names.map((s) => [s, t.objectStore(s).getAll()] as const);
      t.oncomplete = () => {
        d.close();
        resolve({ version: d.version, stores: Object.fromEntries(reqs.map(([s, r]) => [s, r.result])) });
      };
    };
  });
}

describe("the classic import", () => {
  it("reads the classic hands (not the deleted ones) and leaves the database exactly as it was", async () => {
    await classicDb("gto-store-a", ALL);
    const before = await dump("gto-store-a");
    const got = await readClassicHands(indexedDB, null, "gto-store-a");
    expect(got?.from).toBe("IndexedDB");
    expect(got?.recs.map((r) => r.id)).toEqual(expect.arrayContaining([SRP.id, SHORT.id, IMPORTED.id, "ante", "nocards", "noflop"]));
    expect(got?.recs).toHaveLength(6);
    expect(await dump("gto-store-a")).toEqual(before);
    expect(before.version).toBe(1);
  });

  it("creates nothing where the classic app kept nothing, and reads its localStorage fallback", async () => {
    expect(await readClassicHands(indexedDB, null, "gto-store-none")).toBeNull();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain("gto-store-none");
    const storage = { getItem: (k: string) => (k === "gto-store-none:hands" ? JSON.stringify({ [SRP.id]: SRP, gone: GONE }) : null) };
    expect(await readClassicHands(indexedDB, storage, "gto-store-none")).toEqual({ from: "localStorage", recs: [SRP] });
    expect(await readClassicHands(null, { getItem: () => "{not json" }, "x")).toBeNull();
  });

  it("brings each hand in as Analyze keeps one, with your tags and notes; says why the others stay out", async () => {
    const { hands, skipped } = classicRecords(ALL.filter((r) => !r.deleted), AT);
    expect(skipped).toEqual({ "an ante or a straddle (not imported yet)": 1, "no hole cards": 1, "a street's moves without its cards": 1 });
    expect(hands).toHaveLength(3);
    const [srp, short, imported] = hands;

    expect(srp).toMatchObject({
      site: CLASSIC_SITE,
      hero: "BTN",
      hole: "AhKd",
      board: "Qs8d3c",
      players: 6,
      potType: "SRP",
      played: "2025-06-01 09:30",
      bb: "1bb",
      importId: CLASSIC_IMPORT.id,
      importedAt: AT,
      tags: ["srp", "c-bet"],
      note: "bet small",
    });
    expect(srp!.id).toBe(`${CLASSIC_SITE}|${srp!.number}|AhKd`);
    expect(srp!.number).toMatch(/^C\d+$/);
    expect(srp!.text).toContain("You: raises 1.5 to 2.5\nSB: folds\nBB: calls 1.5\n*** FLOP *** [Qs 8d 3c]\nBB: checks\nYou: bets 1.8\nBB: folds");
    // (the folded seats' cards aren't known: only yours are written)
    expect(srp!.text.match(/\[[^\]]*\]/g)).toEqual(["[Ah Kd]", "[Qs 8d 3c]", "[Qs 8d 3c]"]);

    // each seat's own stack, the run-out written as the table dealt it
    expect(short).toMatchObject({ hero: "BB", players: 2, potType: "4bet+ pot", board: "2h7s9cKh4d" });
    expect(short!.text).toContain("Seat 1: SB (30 in chips)\nSeat 2: You (100 in chips)");
    expect(short!.text).toContain("SB: raises 19 to 30 and is all-in\nYou: calls 19");
    expect(importHand(short!.text).setup.stacks).toEqual({ SB: 30, BB: 100 });

    // a history the classic app imported: the same record as that history imported here, with your tags
    const [direct] = (await prepare([{ name: "pasted", text: HH }], { ...CLASSIC_IMPORT, at: AT })).hands;
    expect(imported).toEqual({ ...direct, tags: ["review"] });
    expect(imported!.site).toBe("PokerStars");

    // imported again: the same hands (a second import adds only what's new)
    expect(classicRecords([SRP, SHORT, IMPORTED], AT + 5).hands.map((h) => h.id)).toEqual(hands.map((h) => h.id));
  });

  it("reads the classic speed, read only, from its kv record or else localStorage", async () => {
    await classicDb("gto-store-speed", []);
    const before = await dump("gto-store-speed");
    // (the fixture's kv: "gto-speed" saved as "accurate")
    expect(await readClassicSpeed(indexedDB, { getItem: () => "quick" }, "gto-store-speed")).toBe("accurate");
    expect(await dump("gto-store-speed")).toEqual(before);
    const ls = (v: string | null) => ({ getItem: (k: string) => (k === "gto-speed" ? v : null) });
    expect(await readClassicSpeed(indexedDB, ls("quick"), "gto-store-nospeed")).toBe("quick");
    expect(await readClassicSpeed(indexedDB, ls("turbo"), "gto-store-nospeed")).toBeNull();
    expect(await readClassicSpeed(indexedDB, ls(null), "gto-store-nospeed")).toBeNull();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain("gto-store-nospeed");
  });

  it("reads a classic table hand only as far as it can", () => {
    const base = (SRP.data as { state: Record<string, unknown> }).state;
    expect(classicHand({ ...base, straddle: true })).toEqual({ skip: "an ante or a straddle (not imported yet)" });
    expect(classicHand({ ...base, payouts: [50, 30, 20] })).toEqual({ skip: "a tournament's prizes or bounties (not imported yet)" });
    expect(classicHand({ ...base, actions: acts([a("UTG", "shove")]) })).toEqual({ skip: "a move it can't read" });
    expect(classicHand({ ...base, actions: acts([a("UTG", "fold"), a("HJ", "raise", 2.5)]) })).toEqual({ skip: "no decision of yours" });
    expect(classicHand({ ...base, cards: ["Ah", "Ah", null, null, null, null, null], actions: acts([a("UTG", "fold")]) })).toEqual({ skip: "a card twice" });
    expect(classicHand({ ...base, players: 11 })).toEqual({ skip: "not a hand" });
    // a turn card without a flop: no board
    const c = classicHand({ ...base, cards: ["Ah", "Kd", null, null, null, "2c", null], actions: acts([a("UTG", "fold"), a("HJ", "fold"), a("CO", "fold"), a("BTN", "fold")]) });
    expect("hand" in c && c.hand.board).toEqual([]);
  });
});
