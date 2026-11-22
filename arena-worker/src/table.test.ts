// The table's Durable Object on a stand-in runtime (test/fakes.ts): made once, refused for an id nobody made, its state
// stored after every change and picked up by a fresh instance as after hibernation, its alarm on the next deadline or the
// idle check, and forgotten once it expires.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BANK_SECONDS, IDLE_MS, MAX_MESSAGE, type TableView } from "../../web/src/features/arena/protocol";
import { DECK } from "../../web/src/poker/table";
import type { Env } from "./env";
import type { TableState } from "./room";
import { ArenaTable } from "./table";
import { FakeSocket, FakeState, installWebSocketPair, riggedRandom } from "./test/fakes";

const T0 = Date.UTC(2026, 10, 22, 12);
const TOP = ["As", "Ah", "Ks", "Kh", "2c", "7d", "9h", "Jc", "3s"];
const clock = { t: T0 };

class TestTable extends ArenaTable {
  protected override now = () => clock.t;
  protected override random = riggedRandom(TOP, DECK);
  protected override upgraded(): Response {
    // (Node's Response has no 101: the socket is the state's newest)
    return new Response(null, { status: 200, headers: { "x-test-upgraded": "1" } });
  }
}

const env = { SITE_ORIGIN: "https://www.michael-han.com" } as unknown as Env;
let ctx: FakeState;
let table: TestTable;

async function fresh(): Promise<TestTable> {
  const t = new TestTable(ctx, env);
  await ctx.pending;
  return t;
}
const init = () => table.fetch(new Request("https://table/init", { method: "POST", body: JSON.stringify({ stack: 100, clock: 30 }) }));
async function connect(): Promise<FakeSocket> {
  const res = await table.fetch(new Request("https://table/ws", { headers: { upgrade: "websocket" } }));
  expect(res.headers.get("x-test-upgraded")).toBe("1");
  return ctx.sockets.at(-1)!;
}
const say = (ws: FakeSocket, m: unknown) => table.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(m));
const stored = () => ctx.storage.data.get("table") as TableState | undefined;

beforeAll(installWebSocketPair);
beforeEach(async () => {
  clock.t = T0;
  ctx = new FakeState();
  table = await fresh();
});

describe("the table's Durable Object", () => {
  it("is made once, and an id nobody made gets no socket and stores nothing", async () => {
    const res = await table.fetch(new Request("https://table/ws", { headers: { upgrade: "websocket" } }));
    expect(res.status).toBe(404);
    expect(ctx.storage.writes).toBe(0);
    expect(ctx.sockets).toHaveLength(0);
    expect((await init()).status).toBe(201);
    expect(stored()).toMatchObject({ v: 1, createdAt: T0, rules: { stack: 100, clock: 30 } });
    expect(ctx.storage.alarm).toBe(T0 + IDLE_MS);
    expect((await init()).status).toBe(409);
  });

  it("wants a WebSocket upgrade, and holds at most four connections", async () => {
    await init();
    expect((await table.fetch(new Request("https://table/ws"))).status).toBe(426);
    for (let i = 0; i < 4; i++) await connect();
    expect((await table.fetch(new Request("https://table/ws", { headers: { upgrade: "websocket" } }))).status).toBe(429);
  });

  it("stores every change, and a fresh instance (after hibernation) carries on mid-hand with the same sockets", async () => {
    await init();
    const a = await connect();
    const b = await connect();
    await say(a, { t: "join", name: "Ann" });
    await say(b, { t: "join", name: "Bob" });
    expect(stored()!.hand).toMatchObject({ n: 1, hole: { SB: ["As", "Ah"] } });
    // the alarm moved to Ann's deadline
    expect(ctx.storage.alarm).toBe(T0 + 30_000 + BANK_SECONDS * 1000);
    clock.t += 5000;
    await say(a, { t: "act", n: 1, action: "raise", to: 3 });
    // the Object is evicted; a new one wakes on the next message
    table = await fresh();
    await say(b, { t: "act", n: 1, action: "call" });
    expect(stored()!.hand!.shown).toBe(3);
    expect(b.last().hand).toMatchObject({ board: ["2c", "7d", "9h"], cards: ["Ks", "Kh"], theirs: null });
    expect(b.last().hand!.legal).not.toBeNull();
  });

  it("tells the other seat when a page goes, and cuts off one that sends too much", async () => {
    await init();
    const a = await connect();
    const b = await connect();
    await say(a, { t: "join", name: "Ann" });
    await say(b, { t: "join", name: "Bob" });
    a.close(1001, "gone");
    await table.webSocketClose(a as unknown as WebSocket, 1001, "gone");
    expect((b.last() as TableView).seats[0]!.connected).toBe(false);
    await table.webSocketMessage(b as unknown as WebSocket, "y".repeat(MAX_MESSAGE + 1));
    expect(b.closedWith?.code).toBe(4003);
  });

  it("plays a decision out of time on its alarm, and forgets the table once it's idle", async () => {
    await init();
    const a = await connect();
    const b = await connect();
    await say(a, { t: "join", name: "Ann" });
    await say(b, { t: "join", name: "Bob" });
    clock.t = ctx.storage.alarm!;
    await table.alarm();
    // Ann (small blind, facing the big blind) folded by the clock
    expect(stored()!.hand!.result).toMatchObject({ timedOut: 0, winners: [1] });
    expect(ctx.storage.alarm).toBe(T0 + IDLE_MS);
    clock.t = T0 + IDLE_MS;
    await table.alarm();
    expect(ctx.storage.data.size).toBe(0);
    expect(ctx.storage.alarm).toBeNull();
    expect(a.closedWith?.code).toBe(4000);
  });
});
