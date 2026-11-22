// The Worker's front door end to end, its Durable Objects on stand-ins (test/fakes.ts): making a table (its rules
// checked, its id 128 random bits), the per-address and global limits, the origin check, and the socket route reaching
// only a table that exists.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env";
import { handle } from "./index";
import { ArenaLimits, ipBucket, LIMITS } from "./limits";
import { ArenaTable } from "./table";
import { FakeState, installWebSocketPair } from "./test/fakes";

const ORIGIN = "https://www.michael-han.com";

class TestTable extends ArenaTable {
  protected override upgraded(): Response {
    return new Response(null, { status: 200, headers: { "x-test-upgraded": "1" } });
  }
}

/** Durable Objects by name, each made once with its own stand-in state. */
function namespace(make: (ctx: FakeState) => { fetch(r: Request): Promise<Response> }) {
  const objects = new Map<string, { fetch(r: Request): Promise<Response> }>();
  const states = new Map<string, FakeState>();
  return {
    states,
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      async fetch(input: Request | string, init?: RequestInit) {
        const name = String(id);
        if (!objects.has(name)) {
          const ctx = new FakeState();
          states.set(name, ctx);
          objects.set(name, make(ctx));
          await ctx.pending;
        }
        return objects.get(name)!.fetch(typeof input === "string" ? new Request(input, init) : input);
      },
    }),
  };
}

let env: Env;
let tables: ReturnType<typeof namespace>;

beforeAll(installWebSocketPair);
beforeEach(() => {
  tables = namespace((ctx) => new TestTable(ctx, env));
  env = {
    TABLES: tables,
    LIMITS: namespace((ctx) => new ArenaLimits(ctx, env)),
    SITE_ORIGIN: ORIGIN,
  };
});

const create = (body: unknown = { stack: 100, clock: 30 }, headers: Record<string, string> = {}, ip = "203.0.113.5") =>
  handle(
    new Request(`${ORIGIN}/lizard/api/arena/tables`, {
      method: "POST",
      headers: { origin: ORIGIN, "x-lizard": "1", "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
const ws = (id: string, headers: Record<string, string> = { upgrade: "websocket" }) =>
  handle(new Request(`${ORIGIN}/lizard/api/arena/tables/${id}/ws`, { headers: { "cf-connecting-ip": "203.0.113.9", ...headers } }), env);

describe("the arena Worker", () => {
  it("makes a table with a 128-bit id, and its socket route reaches it", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    const { id, rules } = (await res.json()) as { id: string; rules: unknown };
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(rules).toEqual({ stack: 100, clock: 30 });
    const r2 = await ws(id);
    expect(r2.headers.get("x-test-upgraded")).toBe("1");
    expect(tables.states.get(id)!.sockets).toHaveLength(1);
    const other = (await (await create()).json()) as { id: string };
    expect(other.id).not.toBe(id);
  });

  it("refuses rules it doesn't offer, a body too big, and anything but JSON", async () => {
    expect((await create({ stack: 101, clock: 30 })).status).toBe(400);
    expect((await create({ stack: 100, clock: 5 })).status).toBe(400);
    expect((await create({ stack: 100, clock: 30, pad: "x".repeat(300) })).status).toBe(413);
    expect((await create({ stack: 100, clock: 30 }, { "content-type": "text/plain" })).status).toBe(415);
  });

  it("refuses another site's page, and a POST without the page's marks", async () => {
    expect((await create(undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await create(undefined, { "x-lizard": "" })).status).toBe(403);
    const id = ((await (await create()).json()) as { id: string }).id;
    expect((await ws(id, { upgrade: "websocket", origin: "https://evil.example" })).status).toBe(403);
    // dev origins only where configured
    env.DEV_ORIGINS = "http://localhost:4176";
    expect((await create(undefined, { origin: "http://localhost:4176" })).status).toBe(201);
  });

  it("limits tables made per address by the hour", async () => {
    for (let i = 0; i < LIMITS.createIpHour.max; i++) expect((await create(undefined, {}, "198.51.100.7")).status).toBe(201);
    const res = await create(undefined, {}, "198.51.100.7");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // another address isn't held up; one IPv6 /64 counts as one address
    expect((await create(undefined, {}, "198.51.100.8")).status).toBe(201);
    expect(ipBucket("2001:db8:1:2:aaaa::1")).toBe(ipBucket("2001:db8:1:2:bbbb::9"));
  });

  it("limits connections per address by the minute", async () => {
    const id = ((await (await create()).json()) as { id: string }).id;
    let refused = 0;
    for (let i = 0; i < LIMITS.connectIpMinute.max + 1; i++) {
      const r = await ws(id);
      if (r.status === 429) refused++;
    }
    // (the table's own cap of four sockets refuses most of these first, as 429 too; the address's limit is the last)
    expect(refused).toBeGreaterThan(0);
    const r = await handle(new Request(`${ORIGIN}/lizard/api/arena/tables/${id}/ws`, { headers: { "cf-connecting-ip": "203.0.113.9", upgrade: "websocket" } }), env);
    expect(((await r.json()) as { error: string; scope?: string }).scope).toBe("ip");
  });

  it("gives an id that isn't one, or a table nobody made, no socket", async () => {
    expect((await ws("not-an-id")).status).toBe(404);
    expect((await ws("0".repeat(32))).status).toBe(404);
    expect((await ws("0".repeat(32), {})).status).toBe(426);
    expect((await handle(new Request(`${ORIGIN}/lizard/api/arena/health`), env)).status).toBe(200);
    expect((await handle(new Request(`${ORIGIN}/lizard/api/arena/elsewhere`), env)).status).toBe(404);
  });
});
