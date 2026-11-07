// Lizard's account sync, on Cloudflare Workers + D1: see docs/SYNC_DESIGN.md. It sits at /lizard/api/ on the site's own
// origin, so no CORS is opened: a request from any other origin is refused, and a write must carry a header that a
// cross-site form can't set. Failures answer with a code, and nothing here logs a request's body.
import { finishGoogle, signOut, startGoogle, userOf } from "./auth";
import type { Env } from "./env";
import { json, Refused, refuse } from "./http";
import { deleteAccount, me, pull, push, setKeys } from "./records";

const BASE = "/lizard/api/";

async function route(req: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;
  const at = `${req.method} ${path}`;
  const origin = req.headers.get("origin");
  if (origin && origin !== env.SITE_ORIGIN) throw new Refused(403, "bad_origin");
  // (the panel shows only once this answers, so nobody meets a sign-in button that can't work)
  if (at === "GET health") return env.GOOGLE_CLIENT_SECRET ? json({ ok: true }) : refuse(503, "not_ready");
  if (req.method !== "GET") {
    if (origin !== env.SITE_ORIGIN || req.headers.get("x-lizard") !== "1") throw new Refused(403, "bad_origin");
  }
  if (at === "GET auth/google") return startGoogle(req, env, now);
  if (at === "GET auth/google/callback") return finishGoogle(req, env, now);
  if (at === "POST auth/signout") return signOut(req, env);
  const user = await userOf(req, env, now);
  if (at === "GET me") return me(env, user);
  if (path === "keys" || path === "records" || path === "account") {
    if (!user) throw new Refused(401, "signed_out");
    if (at === "PUT keys") return setKeys(req, env, user);
    if (at === "GET records") return pull(url, env, user);
    if (at === "POST records") return push(req, env, user, now);
    if (at === "DELETE account") return deleteAccount(env, user);
    throw new Refused(405, "bad_method");
  }
  throw new Refused(404, "not_found");
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  try {
    return await route(req, env, now);
  } catch (e) {
    if (e instanceof Refused) return refuse(e.status, e.code);
    return refuse(500, "failed");
  }
}

/** Clears what's expired: a session past its time already does nothing, this only stops them piling up. */
export async function sweep(env: Env, now: number) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM rate WHERE window_start <= ?").bind(now - 24 * 3600 * 1000),
  ]);
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  scheduled: (_: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(sweep(env, Date.now())),
};
