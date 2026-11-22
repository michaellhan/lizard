// Lizard's AI explanations proxy, on Cloudflare Workers + D1 (docs/ROADMAP.md Phase 12). It sits at /lizard/api/explain on
// the site's own origin, beside the sync service's /lizard/api/*, so no CORS is opened. A page sends one decision as checked
// numbers (schema.ts); the server writes the prompt (prompt.ts) and asks Claude Haiku 5.5 with the owner's key, a Worker
// secret. Until that secret exists every request is answered "not_configured". Spend is capped at $20 a month (budget.ts),
// with per-IP and global rate limits in front (limits.ts). Nothing here logs or stores a request's body or the answer.
import Anthropic from "@anthropic-ai/sdk";
import { costNano, hasRoom, monthOf, RESERVE_NANO, reserve, settle, untilNextMonth } from "./budget";
import type { Env } from "./env";
import { json, readBody, Refused, refuse } from "./http";
import { limit, sweepRate } from "./limits";
import { MAX_TOKENS, MODEL, SYSTEM, userMessage } from "./prompt";
import { MAX_BODY, parseRequest } from "./schema";

const BASE = "/lizard/api/explain";

/** What a test swaps out: the clock and the HTTP client the SDK calls Anthropic with. */
export interface Deps {
  now?: number;
  fetch?: typeof fetch;
}

function checkOrigin(req: Request, env: Env) {
  // (a soft signal only: it stops other sites' pages, but anything outside a browser can send this header)
  const origin = req.headers.get("origin");
  if (origin && origin !== env.SITE_ORIGIN) throw new Refused(403, "bad_origin");
  if (req.method !== "GET" && (origin !== env.SITE_ORIGIN || req.headers.get("x-lizard") !== "1")) throw new Refused(403, "bad_origin");
}

/** The page asks this before it offers the button: ready, not configured, or this month's budget used. It costs nothing. */
async function health(env: Env, now: number): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) throw new Refused(503, "not_configured");
  if (!(await hasRoom(env.DB, monthOf(now)))) throw new Refused(503, "over_budget", { retryAfter: untilNextMonth(now) });
  return json({ ok: true, model: MODEL });
}

async function explain(req: Request, env: Env, deps: Deps, now: number): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) throw new Refused(503, "not_configured");
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) throw new Refused(415, "send_json");
  const request = parseRequest(await readBody(req, MAX_BODY));
  await limit(env.DB, req.headers.get("cf-connecting-ip") ?? "unknown", now);
  const month = monthOf(now);
  if (!(await reserve(env.DB, month, RESERVE_NANO))) throw new Refused(503, "over_budget", { retryAfter: untilNextMonth(now) });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 25_000, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: userMessage(request) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionError) {
      // (it may have reached Anthropic and been billed: the reserve stays spent, so the cap stays a hard one)
      throw new Refused(502, "upstream_unreachable", { retryAfter: 30 });
    }
    // an HTTP error answer: nothing was generated, so nothing is billed and the reserve goes back
    await settle(env.DB, month, -RESERVE_NANO);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new Refused(503, "not_configured");
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) throw new Refused(503, "upstream_busy", { retryAfter: 30 });
    throw new Refused(502, "upstream_failed");
  }
  const cost = costNano(message.usage.input_tokens, message.usage.output_tokens);
  await settle(env.DB, month, cost - RESERVE_NANO);
  if (message.stop_reason === "refusal") throw new Refused(502, "refused");
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Refused(502, "no_answer");
  return json({ text, model: MODEL, cut: message.stop_reason === "max_tokens" });
}

async function route(req: Request, env: Env, deps: Deps, now: number): Promise<Response> {
  const path = new URL(req.url).pathname;
  checkOrigin(req, env);
  if (path === `${BASE}/health`) {
    if (req.method !== "GET") throw new Refused(405, "bad_method");
    return health(env, now);
  }
  if (path === BASE) {
    if (req.method !== "POST") throw new Refused(405, "bad_method");
    return explain(req, env, deps, now);
  }
  throw new Refused(404, "not_found");
}

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  try {
    return await route(req, env, deps, deps.now ?? Date.now());
  } catch (e) {
    if (e instanceof Refused) return refuse(e);
    return refuse(new Refused(500, "failed"));
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  scheduled: (_: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(sweepRate(env.DB, Date.now())),
};
