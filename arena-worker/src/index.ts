// Lizard's private heads-up tables ("Play a friend", web/src/features/arena/), on Cloudflare Workers with one Durable
// Object per table (table.ts). It sits at /lizard/api/arena on the site's own origin, beside the sync service's
// /lizard/api/* and the explain proxy, so no CORS is opened. Play money only: no accounts, no prizes, no wagering, no
// public queue or matchmaking; a table is reached only by its link, whose id is 128 random bits.
//
//   POST /lizard/api/arena/tables          {stack, clock} -> {id}       (per-address and global limits)
//   GET  /lizard/api/arena/tables/<id>/ws  WebSocket upgrade, to the table's Object (per-address limit)
//   GET  /lizard/api/arena/health          {ok: true}
import { CLOCKS, STACKS, TABLE_ID, type TableRules } from "../../web/src/features/arena/protocol";
import type { Env } from "./env";
import { json, readBody, Refused, refuse } from "./http";
import { limitConnect, limitCreate } from "./limits";
import { cryptoRandom, randomHex, type Random } from "./rng";

export { ArenaTable } from "./table";
export { ArenaLimits } from "./limits";

const BASE = "/lizard/api/arena";
const MAX_BODY = 256;

/** What a test swaps out. */
export interface Deps {
  random?: Random;
}

function origins(env: Env): string[] {
  return [env.SITE_ORIGIN, ...(env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
}

function checkOrigin(req: Request, env: Env) {
  // (a soft signal only: it stops other sites' pages, but anything outside a browser can send this header, or none)
  const origin = req.headers.get("origin");
  if (origin && !origins(env).includes(origin)) throw new Refused(403, "bad_origin");
  if (req.method === "POST" && (!origin || req.headers.get("x-lizard") !== "1")) throw new Refused(403, "bad_origin");
}

export function parseRules(x: unknown): TableRules {
  const o = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
  if (!(STACKS as readonly unknown[]).includes(o.stack) || !(CLOCKS as readonly unknown[]).includes(o.clock)) throw new Refused(400, "bad_rules");
  return { stack: o.stack as number, clock: o.clock as number };
}

async function create(req: Request, env: Env, deps: Deps): Promise<Response> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) throw new Refused(415, "send_json");
  const rules = parseRules(await readBody(req, MAX_BODY));
  await limitCreate(env, req.headers.get("cf-connecting-ip") ?? "unknown");
  const id = randomHex(deps.random ?? cryptoRandom);
  const stub = env.TABLES.get(env.TABLES.idFromName(id));
  const res = await stub.fetch("https://table/init", { method: "POST", body: JSON.stringify(rules) });
  if (res.status !== 201) throw new Refused(500, "failed");
  return json({ id, rules }, 201);
}

async function connect(req: Request, env: Env, id: string): Promise<Response> {
  if (req.method !== "GET") throw new Refused(405, "bad_method");
  // (checked here, before the table's Object is touched: a bad request costs it nothing)
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new Refused(426, "upgrade");
  await limitConnect(env, req.headers.get("cf-connecting-ip") ?? "unknown");
  const stub = env.TABLES.get(env.TABLES.idFromName(id));
  return stub.fetch(new Request("https://table/ws", req));
}

async function route(req: Request, env: Env, deps: Deps): Promise<Response> {
  const path = new URL(req.url).pathname;
  checkOrigin(req, env);
  if (path === `${BASE}/health`) {
    if (req.method !== "GET") throw new Refused(405, "bad_method");
    return json({ ok: true });
  }
  if (path === `${BASE}/tables`) {
    if (req.method !== "POST") throw new Refused(405, "bad_method");
    return create(req, env, deps);
  }
  const m = path.match(/^\/lizard\/api\/arena\/tables\/([^/]+)\/ws$/);
  if (m) {
    if (!TABLE_ID.test(m[1]!)) throw new Refused(404, "no_table");
    return connect(req, env, m[1]!);
  }
  throw new Refused(404, "not_found");
}

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  try {
    return await route(req, env, deps);
  } catch (e) {
    if (e instanceof Refused) return refuse(e);
    return refuse(new Refused(500, "failed"));
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
