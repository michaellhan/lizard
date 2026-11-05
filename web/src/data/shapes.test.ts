// A restored record is every field a page reads, of the type it reads it as, or it's skipped and counted. These are the
// records that blanked a page for good, and the older backups that must still come back.
import { beforeEach, describe, expect, it } from "vitest";
import { toSession } from "@/features/analyze/leakDrill";
import { prepare } from "@/features/analyze/analyze";
import { describeSetup } from "@/features/solve/setup";
import { describeLine, fromSearch, toSearch } from "@/features/study/studyState";
import { rowOf } from "@/features/history/history";
import { mistake } from "@/test/mistake";
import { BACKUP_FORMAT, BACKUP_SCHEMA, BACKUP_STORES, makeBackup, restoreBackup, restoreSummary, type BackupStore } from "./backup";
import { db, type DecisionRecord, type HandRecord, type SavedRange, type SavedSpot, type SessionRecord } from "./db";
import { listDecisions, listHands } from "./hands";
import { listSpots } from "./saved";
import { readMistake } from "./mistakes";

const AT = 1_750_000_000_000;

const SPOT: SavedSpot = { id: "s1", title: "A spot", line: "p=6&s=100", state: { players: 6 }, tags: ["srp"], note: "", seen: { source: "library", label: "Precomputed" }, createdAt: AT, updatedAt: AT };
const RANGE: SavedRange = { id: "r1", name: "A range", text: "AKs", combos: 4, note: "", createdAt: AT, updatedAt: AT };
const DRILL = { id: "d1", name: "A drill", kind: "library", to: "/practice?tab=drills&spot=x", about: "About", note: "", createdAt: AT, updatedAt: AT };
const SESSION: SessionRecord = { id: "p1", kind: "practice", startedAt: AT, endedAt: AT + 5, decisions: 3, evLossBb: 0.25, meta: { hands: 2, net: -1.5, ok: 2, graded: 3, lossPct: 4, players: 6, stack: 100, seat: "moves", byPot: {}, sources: {}, cells: {} } };
const HAND: HandRecord = {
  id: "PokerStars|1|AhKd",
  site: "PokerStars",
  number: "1",
  played: "2024-05-01 20:00",
  playedAt: AT,
  hero: "BTN",
  players: 6,
  hole: "AhKd",
  board: "2c7dTs",
  bb: "$1",
  potType: "SRP",
  pot: 5.5,
  end: "folded flop",
  decisions: 2,
  playedFor: "preflop",
  revealed: ["flop|1"],
  tournament: "Sunday",
  text: "PokerStars Hand #1",
  tags: ["x"],
  note: "n",
  updatedAt: AT,
  importId: "i",
  importName: "file.txt",
  importedAt: AT,
};
const DECISION: DecisionRecord = {
  id: "PokerStars|1|AhKd|flop|1",
  handId: "PokerStars|1|AhKd",
  street: "flop",
  pos: "BTN",
  i: 1,
  action: "bet 3",
  verdict: "Mistake",
  evLossBb: 0.4,
  lossPct: 7,
  byEv: true,
  situation: "SRP · IP",
  potType: "SRP",
  facing: false,
  ip: true,
  multi: false,
  role: "PFR",
  pot: 5.5,
  matched: "bet 33%",
  freq: 0.5,
  best: "check",
  bestFreq: 0.5,
  mix: [["check", 0.5, 1.2], ["bet 33%", 0.5, null]],
  note: "n",
  why: "w",
  source: "library",
  label: "Precomputed",
  version: "v1",
  approximate: false,
  band: "ok" as never,
  capped: false,
  roughEv: false,
  off: "o",
  flopAggr: false,
  confidence: "high",
  triageSource: "t",
  read: { verdict: "Best", source: "live", label: "Live", version: "v2", confidence: "low", triageSource: "t", evLossBb: null, freq: 0.1, mix: [["check", 1, null]] },
  notChecked: "n",
  gradedAt: AT,
};

const file = (stores: Partial<Record<BackupStore, unknown[]>>) => ({
  format: BACKUP_FORMAT,
  schema: BACKUP_SCHEMA,
  stores: Object.fromEntries(Object.entries(stores).map(([s, rs]) => [s, rs.map((d) => ({ id: (d as { id: unknown }).id, v: 1, created: 1, updated: 2, dev: "x", data: d }))])),
});
const restored = async (store: BackupStore, record: unknown) => (await restoreBackup(file({ [store]: [record] })))[store];

beforeEach(async () => {
  const d = (await db())!;
  for (const s of BACKUP_STORES) await d.clear(s);
});

describe("records that blanked a page", () => {
  it("skips the audit's spot and hand, counts them, and restores what's beside them", async () => {
    const bad: unknown = { ...SPOT, id: "bad", tags: [{ a: 1 }] };
    const hand: unknown = { ...HAND, id: "bad", potType: { a: 1 } };
    const r = await restoreBackup(file({ savedSpots: [bad, SPOT], hands: [hand, HAND] }));
    expect(r.savedSpots).toEqual({ added: 1, updated: 0, kept: 0, skipped: 1 });
    expect(r.hands).toEqual({ added: 1, updated: 0, kept: 0, skipped: 1 });
    expect(restoreSummary(r)).toContain("2 skipped");
    expect((await listSpots()).map((s) => s.id)).toEqual(["s1"]);
    expect((await listHands()).map((h) => h.id)).toEqual([HAND.id]);
  });

  // Each field of a whole record, one at a time, as an object, as the wrong scalar, and missing where it's required.
  const STORES: [BackupStore, Record<string, unknown>, string[]][] = [
    ["savedSpots", { ...SPOT }, ["seen"]],
    ["savedRanges", { ...RANGE }, []],
    ["savedDrills", { ...DRILL }, []],
    ["sessions", { ...SESSION }, ["endedAt"]],
    ["hands", { ...HAND }, ["playedFor", "revealed", "tournament", "tags", "note", "updatedAt"]],
    ["decisions", { ...DECISION }, ["i", "evLossBb", "lossPct", "byEv", "situation", "potType", "facing", "ip", "multi", "role", "pot", "matched", "freq", "best", "bestFreq", "mix", "note", "why", "version", "approximate", "band", "capped", "roughEv", "roughEvs", "off", "flopAggr", "confidence", "triageSource", "read", "notChecked"]],
  ];

  it.each(STORES)("takes a whole %s, and refuses any one field gone wrong", async (store, whole, optional) => {
    expect((await restored(store, whole)).added).toBe(1);
    const d = (await db())!;
    await d.clear(store);
    for (const k of Object.keys(whole)) {
      if (k === "id") continue;
      const objectIsFine = k === "state" || k === "meta" || k === "read";
      const wrong: unknown[] = [...(objectIsFine ? [] : [{ a: 1 }]), [{ a: 1 }], typeof whole[k] === "number" ? "7" : 7];
      if (!optional.includes(k)) wrong.push(undefined);
      for (const w of wrong) {
        const r = await restored(store, { ...whole, [k]: w });
        expect([k, w, r.skipped]).toEqual([k, w, 1]);
      }
    }
  });

  it.each(["hands", "net", "ok", "graded", "lossPct", "players", "stack", "ante", "rake", "best", "acc", "evLossBb", "total"])("refuses a session whose meta.%s can't be a number", async (k) => {
    expect((await restored("sessions", { ...SESSION, meta: { ...SESSION.meta, [k]: { toString: 1, valueOf: 1 } } })).skipped).toBe(1);
    expect((await restored("sessions", { ...SESSION, meta: { ...SESSION.meta, [k]: "1" } })).skipped).toBe(1);
  });

  it.each(["spot", "view", "label", "leak", "line", "source", "actor", "street", "drill", "seat"])("refuses a session whose meta.%s can't be text, or a link", async (k) => {
    expect((await restored("sessions", { ...SESSION, meta: { ...SESSION.meta, [k]: { a: 1 } } })).skipped).toBe(1);
    expect((await restored("sessions", { ...SESSION, meta: { ...SESSION.meta, [k]: "\ud800" } })).skipped).toBe(1);
  });

  it("refuses a leak drill's progress the drill couldn't resume", async () => {
    const leak = (meta: Record<string, unknown>): SessionRecord => ({ ...SESSION, kind: "analysis", meta: { drill: "leak", ...meta } });
    const score = { n: 1, ok: 1, loss: 0, lossPct: 0, ne: 1, streak: 1, best: 1, recent: [1] };
    expect((await restored("sessions", leak({ done: ["a"], score }))).added).toBe(1);
    for (const m of [{ done: [{ a: 1 }], score }, { done: "a", score }, { done: [], score: { ...score, n: { a: 1 } } }, { done: [], score: { ...score, recent: 1 } }, { done: [], score: 1 }])
      expect((await restored("sessions", leak(m))).skipped).toBe(1);
  });

  it("refuses what throws without being an object: cards, seats, times, a link's lone surrogate", async () => {
    for (const x of [{ hole: "AhK" }, { hole: "AxKd" }, { hole: "AhKdQs" }, { board: "2c7" }, { board: "2z7dTs" }, { players: 1 }, { players: 10 }, { players: 2.5 }, { playedAt: 9e15 }, { importedAt: -9e15 }])
      expect((await restored("hands", { ...HAND, ...x })).skipped).toBe(1);
    expect((await restored("savedSpots", { ...SPOT, createdAt: 9e15 })).skipped).toBe(1);
    expect((await restored("sessions", { ...SESSION, startedAt: 9e15 })).skipped).toBe(1);
    expect((await restored("savedRanges", { ...RANGE, id: "a\ud800" })).skipped).toBe(1);
    expect((await restored("decisions", { ...DECISION, street: "showdown" })).skipped).toBe(1);
    expect((await restored("decisions", { ...DECISION, mix: [["check", "0.5", 1]] })).skipped).toBe(1);
    expect((await restored("decisions", { ...DECISION, read: { ...DECISION.read, label: { a: 1 } } })).skipped).toBe(1);
  });

  it("reads a mistake with a card PlayingCard can't draw as damaged", () => {
    expect(readMistake(mistake())).not.toBeNull();
    expect(readMistake({ ...mistake(), hole: ["Ah", "Kx"] })).toBeNull();
    expect(readMistake({ ...mistake(), board: ["2c", "?"] })).toBeNull();
  });
});

describe("older backups still restore", () => {
  it("restores each store's first shape, with none of the fields added since", async () => {
    const spot = { id: "s", title: "t", line: "p=6", state: {}, tags: [], note: "", createdAt: AT, updatedAt: AT };
    const range = { id: "r", name: "n", text: "", combos: 0, note: "", createdAt: AT, updatedAt: AT };
    const session = { id: "o", kind: "drill", startedAt: AT, decisions: 0, evLossBb: 0, meta: {} };
    const hand = { id: "h", site: "s", number: "", played: "", playedAt: 0, hero: "SB", players: 2, hole: "AhKd", board: "", bb: "$1", potType: "SRP", pot: 0, end: "showdown", decisions: 0, text: "x", importId: "i", importName: "", importedAt: AT };
    const decision = { id: "x", handId: "h", street: "preflop", pos: "SB", action: "fold", verdict: "Not graded", evLossBb: null, source: "none", label: "No answer", gradedAt: AT };
    const r = await restoreBackup(file({ savedSpots: [spot], savedRanges: [range], sessions: [session], hands: [hand], decisions: [decision] }));
    for (const s of ["savedSpots", "savedRanges", "sessions", "hands", "decisions"] as const) expect(r[s]).toEqual({ added: 1, updated: 0, kept: 0, skipped: 0 });
    expect((await listDecisions()).map((d) => d.id)).toEqual(["x"]);
  });

  it("restores a tournament's sessions, and refuses a kind nothing writes", async () => {
    const at = (id: string, kind: string) => ({ id, kind, startedAt: AT, decisions: 1, evLossBb: 0.1, meta: {} });
    const r = await restoreBackup(file({ sessions: [at("t", "tournament"), at("c", "tournament-chips"), at("z", "lottery")] }));
    expect(r.sessions).toMatchObject({ added: 2, skipped: 1 });
  });

  it("takes a backup of this version, of records as the app writes them, back whole", async () => {
    const text = "PokerStars Hand #123: Hold'em No Limit ($0.50/$1.00) - 2024/05/01 20:00:00\nTable 'x' 6-max Seat #1 is the button\nSeat 1: me ($100)\nSeat 2: b ($100)\nb: posts big blind $1\n*** HOLE CARDS ***\nDealt to me [Ah Kd]\nme: folds\n";
    const { hands } = await prepare([{ name: "x", text }], { id: "i", name: "x", at: AT });
    expect(hands).toHaveLength(1);
    const d = (await db())!;
    await d.put("hands", hands[0]!);
    await d.put("savedSpots", SPOT);
    await d.put("sessions", toSession({ key: "k" } as never, { startedAt: AT, done: ["a"], score: { n: 1, ok: 1, loss: 0, lossPct: 0, ne: 1, streak: 1, best: 1, recent: [1] } }, 3));
    await d.put("sessions", { id: "b1", kind: "build", startedAt: AT, endedAt: AT, decisions: 1, evLossBb: 0, meta: { line: "l", label: "L", actor: "BB", street: "flop", acc: 0.5, evLossBb: 0.1, evLossPct: 1, comboAcc: null, source: "live", approximate: false } });
    const b = JSON.parse(JSON.stringify(await makeBackup()));
    for (const s of BACKUP_STORES) await d.clear(s);
    const r = await restoreBackup(b);
    for (const s of BACKUP_STORES) expect(r[s].skipped).toBe(0);
    expect(r.hands.added).toBe(1);
    expect(r.sessions.added).toBe(2);
  });
});

describe("a line kept in a record is drawn whatever it says", () => {
  it("never throws on a damaged Study line", () => {
    const real = toSearch(fromSearch("p=6&s=100&pre=BTN%3Ar2.5%2CBB%3Ac&b=Ac7s3d&flop=BB%3Ax%2CBTN%3Ab1.8&ante=0.1&pf=solver&pfs=2.5")!);
    let a = 7;
    const rnd = (n: number) => (a = (a * 48271) % 2147483647) % n;
    const bits = ["=", "&", ":", ",", "%", "%E0", "p", "b", "x", "1e999", "-1", "NaN", "pre", "flop", "ante", "r", "c", "Zz"];
    for (let i = 0; i < 4000; i++) {
      let s = i % 2 ? real : "p=2&b=AcAc&pre=x:y&s=1e999";
      for (let k = rnd(4); k >= 0; k--) {
        const c = rnd(s.length + 1);
        s = s.slice(0, c) + bits[rnd(bits.length)] + s.slice(c + rnd(3));
      }
      const h = fromSearch(s);
      if (h) {
        describeSetup(h.setup);
        describeLine(h);
      }
      rowOf({ id: "x", kind: "build", startedAt: AT, decisions: 1, evLossBb: 0, meta: { line: s, label: s } });
    }
  });
});
