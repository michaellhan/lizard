// A sync against a stand-in for the service, which keeps only what the real one is given. "Another device" is the same
// account's keys: it seals what it likes into the stand-in, as the server can tell nothing of who wrote a record.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, kvGet, type DecisionRecord, type HandRecord, type SavedSpot } from "@/data/db";
import { deleteSpot } from "@/data/saved";
import { mistake } from "@/test/mistake";
import { SyncFailed, type Outgoing, type RemoteRecord } from "./api";
import { deriveKeys, idHash, newSalt, openRecord, sealRecord, toBase64, type SyncKeys } from "./crypto";
import { forgetState, readSealed, reportWords, SEND, SYNCED, syncOnce } from "./merge";

const server = vi.hoisted(() => ({ rows: [] as RemoteRecord[], seq: 0, pushes: 0, failAfter: Infinity }));
vi.mock("./api", async (real) => ({
  ...(await real<typeof import("./api")>()),
  pull: (since: number) => {
    const all = server.rows.filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    return Promise.resolve({ records: all.slice(0, 200), more: all.length > 200 });
  },
  push: async (records: Outgoing[]) => {
    const { SyncFailed } = await real<typeof import("./api")>();
    if (server.pushes++ >= server.failAfter) throw new SyncFailed("stopped", "network");
    for (const r of records) {
      server.rows = server.rows.filter((x) => !(x.store === r.store && x.id === r.id));
      server.rows.push({ ...r, seq: ++server.seq });
    }
    return { seq: server.seq, bytes: 0 };
  },
}));

const AT = 1_750_000_000_000;
const SALT = toBase64(new Uint8Array(16).fill(3));
const SPOT: SavedSpot = { id: "s1", title: "Kd flop", line: "p=6&s=100", state: { players: 6 }, tags: [], note: "", createdAt: AT, updatedAt: AT };
const HAND = { id: "PokerStars|1|AhKd", site: "PokerStars", number: "1", played: "2024-05-01 20:00", playedAt: AT, hero: "BTN", players: 6, hole: "AhKd", board: "2c7dTs", bb: "$1", potType: "SRP", pot: 5.5, end: "folded flop", decisions: 2, text: "PokerStars Hand #1", importId: "i", importName: "file.txt", importedAt: AT } as HandRecord;

let keys: SyncKeys;
beforeAll(async () => {
  keys = await deriveKeys("correct horse battery", SALT);
}, 60_000);

const stores = ["savedSpots", "savedAnswers", "sessions", "hands", "decisions", "mistakes", "tombstones", "kv"] as const;
beforeEach(async () => {
  const d = (await db())!;
  for (const s of stores) await d.clear(s);
  Object.assign(server, { rows: [], seq: 0, pushes: 0, failAfter: Infinity });
});

/** What another device leaves on the server. */
async function fromElsewhere(store: (typeof SYNCED)[number], value: { id: string; updated: number; data?: unknown; deleted?: true }) {
  const n = SYNCED.indexOf(store) + 1;
  const id = await idHash(keys, n, value.id);
  server.rows = server.rows.filter((x) => !(x.store === n && x.id === id));
  server.rows.push({ store: n, id, seq: ++server.seq, body: await sealRecord(keys, n, id, value) });
}

const here = async () => (await db())!;

describe("a sync", () => {
  it("sends what's kept here sealed, so the server holds no id, name or card", async () => {
    await (await here()).put("savedSpots", SPOT);
    await (await here()).put("hands", HAND);
    const r = await syncOnce(keys, SALT);
    expect(r).toMatchObject({ sent: 2, left: 0, unread: 0 });
    const held = JSON.stringify(server.rows);
    // (what can't turn up by chance in base64: a space, an ampersand, or ten letters)
    for (const secret of ["Kd flop", "PokerStars", "p=6&s=100", "folded flop"]) expect(held).not.toContain(secret);
    expect(await openRecord(keys, 1, server.rows[0]!.id, server.rows[0]!.body)).toEqual({ id: "s1", updated: AT, data: SPOT });
  });

  it("brings everything to a browser that has none of it, and then has nothing left to do", async () => {
    await (await here()).put("savedSpots", SPOT);
    await (await here()).put("mistakes", mistake());
    await syncOnce(keys, SALT);

    const d = await here();
    await d.clear("savedSpots");
    await d.clear("mistakes");
    await forgetState();
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ changed: 2, sent: 0 });
    expect(await d.get("savedSpots", "s1")).toEqual(SPOT);

    // (its own copies were read back and changed nothing: nothing goes out and the sequence holds)
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ read: 0, changed: 0, sent: 0 });
    expect(server.pushes).toBe(1);
  });

  it("doesn't read back what it sent, unless another device wrote in between", async () => {
    await (await here()).put("savedSpots", SPOT);
    await syncOnce(keys, SALT);
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ read: 0, sent: 0 });

    await (await here()).put("mistakes", mistake());
    const late = await idHash(keys, 1, "late");
    const original = server.seq;
    server.seq = original + 1;
    server.rows.push({ store: 1, id: late, seq: server.seq, body: await sealRecord(keys, 1, late, { id: "late", updated: AT, data: { ...SPOT, id: "late" } }) });
    await syncOnce(keys, SALT);
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ sent: 0 });
    expect(await (await here()).get("savedSpots", "late")).toBeDefined();
  });

  it("keeps the later of two copies, whichever side it's on", async () => {
    await (await here()).put("savedSpots", SPOT);
    await syncOnce(keys, SALT);

    const later = { ...SPOT, title: "Renamed elsewhere", updatedAt: AT + 10 };
    await fromElsewhere("savedSpots", { id: "s1", updated: AT + 10, data: later });
    await syncOnce(keys, SALT);
    expect((await (await here()).get("savedSpots", "s1"))?.title).toBe("Renamed elsewhere");

    const mine = { ...SPOT, title: "Renamed here", updatedAt: AT + 20 };
    await (await here()).put("savedSpots", mine);
    await fromElsewhere("savedSpots", { id: "s1", updated: AT + 15, data: { ...SPOT, title: "Older", updatedAt: AT + 15 } });
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ changed: 0, sent: 1 });
    expect((await (await here()).get("savedSpots", "s1"))?.title).toBe("Renamed here");
    expect(await openRecord(keys, 1, server.rows[0]!.id, server.rows[0]!.body)).toMatchObject({ updated: AT + 20 });
  });

  it("takes a record deleted on another device, with what goes with it, and remembers", async () => {
    const d = await here();
    await d.put("savedSpots", SPOT);
    await d.put("savedAnswers", { id: "s1", savedAt: AT } as never);
    await d.put("hands", HAND);
    await d.put("decisions", { id: "g1", handId: HAND.id, gradedAt: AT } as unknown as DecisionRecord);
    await syncOnce(keys, SALT);

    await fromElsewhere("savedSpots", { id: "s1", updated: AT + 5, deleted: true });
    await fromElsewhere("hands", { id: HAND.id, updated: AT + 5, deleted: true });
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ changed: 2, sent: 0 });
    expect(await d.get("savedSpots", "s1")).toBeUndefined();
    expect(await d.get("savedAnswers", "s1")).toBeUndefined();
    expect(await d.get("hands", HAND.id)).toBeUndefined();
    expect(await d.get("decisions", "g1")).toBeUndefined();
    expect((await d.getAll("tombstones")).map((t) => `${t.store}|${t.id}`).sort()).toEqual(["decisions|g1", `hands|${HAND.id}`, "savedAnswers|s1", "savedSpots|s1"]);
  });

  it("lets a copy changed after a deletion stand, and sends it", async () => {
    const d = await here();
    await d.put("savedSpots", { ...SPOT, updatedAt: AT + 9 });
    await fromElsewhere("savedSpots", { id: "s1", updated: AT + 5, deleted: true });
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ changed: 0, sent: 1 });
    expect(await d.get("savedSpots", "s1")).toBeDefined();
    expect(await openRecord(keys, 1, server.rows[0]!.id, server.rows[0]!.body)).toMatchObject({ updated: AT + 9, data: { id: "s1" } });
  });

  it("sends a deletion made here in place of the copy, and an older copy doesn't bring it back", async () => {
    const d = await here();
    await d.put("savedSpots", SPOT);
    await syncOnce(keys, SALT);
    await deleteSpot("s1");
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ sent: 1 });
    expect(server.rows).toHaveLength(1);
    const sealed = readSealed("savedSpots", await openRecord(keys, 1, server.rows[0]!.id, server.rows[0]!.body));
    expect(sealed).toMatchObject({ id: "s1", deleted: true });

    await fromElsewhere("savedSpots", { id: "s1", updated: AT, data: SPOT });
    await syncOnce(keys, SALT);
    expect(await d.get("savedSpots", "s1")).toBeUndefined();
  });

  it("leaves alone and counts what won't open, isn't a record, or is filed under another's name", async () => {
    await (await here()).put("savedSpots", SPOT);
    const other = await deriveKeys("another passphrase here", SALT);
    const hash = await idHash(other, 1, "s1");
    const wrong = await sealRecord(other, 1, hash, { id: "s1", updated: AT + 9, data: { ...SPOT, title: "Bad", updatedAt: AT + 9 } });
    server.rows.push({ store: 1, id: hash, seq: ++server.seq, body: wrong });
    const h1 = await idHash(keys, 1, "x");
    server.rows.push({ store: 1, id: h1, seq: ++server.seq, body: await sealRecord(keys, 1, h1, { id: "x", updated: AT + 9, data: { id: "x", title: 3 } }) });
    const h2 = await idHash(keys, 1, "moved");
    server.rows.push({ store: 1, id: h2, seq: ++server.seq, body: await sealRecord(keys, 1, h2, { id: "s1", updated: AT + 9, data: { ...SPOT, title: "Moved", updatedAt: AT + 9 } }) });
    const r = await syncOnce(keys, SALT);
    expect(r).toMatchObject({ read: 3, unread: 3, changed: 0 });
    expect((await (await here()).get("savedSpots", "s1"))?.title).toBe("Kd flop");
    expect(reportWords(r)).toContain("3 couldn't be opened");
  });

  it("sends in batches the service takes, keeps one too large here, and says so", async () => {
    const d = await here();
    for (let i = 0; i < SEND.records + 5; i++) await d.put("savedSpots", { ...SPOT, id: `s${i}` });
    await d.put("savedSpots", { ...SPOT, id: "big", note: "x".repeat(SEND.record) });
    const r = await syncOnce(keys, SALT);
    expect(r).toMatchObject({ sent: SEND.records + 5, tooLarge: 1, left: 0 });
    expect(server.pushes).toBe(2);
    expect(reportWords(r)).toContain("1 too large to sync");
  });

  it("stopped partway, keeps what went out and sends only the rest next time", async () => {
    const d = await here();
    for (let i = 0; i < SEND.records + 5; i++) await d.put("savedSpots", { ...SPOT, id: `s${i}` });
    server.failAfter = 1;
    await expect(syncOnce(keys, SALT)).rejects.toBeInstanceOf(SyncFailed);
    expect(server.rows).toHaveLength(SEND.records);
    server.failAfter = Infinity;
    await expect(syncOnce(keys, SALT)).resolves.toMatchObject({ sent: 5 });
    expect(server.rows).toHaveLength(SEND.records + 5);
  });

  it("starts over where the synced copy was reset, as what it knew of the old one means nothing", async () => {
    await (await here()).put("savedSpots", SPOT);
    await syncOnce(keys, SALT);
    server.rows = [];
    await expect(syncOnce(keys, newSalt())).resolves.toMatchObject({ sent: 1 });
    expect((await kvGet<{ salt: string }>("syncState"))?.salt).not.toBe(SALT);
  });
});
