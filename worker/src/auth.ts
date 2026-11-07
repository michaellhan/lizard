// Sign-in with Google, by redirect through this Worker, so no Google script runs on the site and its isolation headers stand.
// It asks only for "openid": Google says which account this is and nothing else, so the service never holds an email or a
// name. An account is found by a keyed hash of Google's id for it, and a session by the hash of its token.
import type { Env } from "./env";
import { json, Refused } from "./http";
import { LIMITS, spend } from "./limits";
import { challenge, hmac, sha256, token } from "./secrets";

const COOKIE = "lizard_session";
const PENDING = "lizard_google";
export const PENDING_S = 600;
export const SESSION_MS = 30 * 24 * 3600 * 1000;
export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const ipOf = (req: Request) => req.headers.get("cf-connecting-ip") ?? "unknown";
const cookieOf = (req: Request, name: string) => req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];

const session = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/lizard/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
// (Lax: Google's redirect back is a navigation from another site, which a Strict cookie wouldn't come with)
const pending = (value: string, maxAge: number) => `${PENDING}=${value}; Path=/lizard/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function go(to: string, ...cookies: string[]) {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}
/** Back to Settings, which says what went wrong: these requests are the browser's own, so a refusal can't be a code. */
const back = (env: Env, why: string | null, ...cookies: string[]) => go(`${env.SITE_ORIGIN}/lizard/settings${why ? `#sync-error=${why}` : ""}`, ...cookies);

const callback = (env: Env) => `${env.SITE_ORIGIN}/lizard/api/auth/google/callback`;

/** Off to Google, holding in a short cookie what proves the answer is to this browser's own request. */
async function start(req: Request, env: Env, now: number) {
  await spend(env.DB, `signin:${await sha256(ipOf(req))}`, LIMITS.signInIp, now);
  const state = token();
  const verifier = token();
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callback(env),
    response_type: "code",
    scope: "openid",
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return go(`${GOOGLE_AUTH}?${q}`, pending(`${state}.${verifier}`, PENDING_S));
}
export const startGoogle = (req: Request, env: Env, now: number) => start(req, env, now).catch((e) => back(env, e instanceof Refused ? "busy" : "failed"));

/** The account Google's answer names, or null. It came straight from Google over TLS, so what's left to check is who it's for and when. */
function accountIn(idToken: unknown, env: Env, now: number): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const part = idToken.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/");
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0)))) as Record<string, unknown>;
    const ok = ISSUERS.includes(claims.iss as string) && claims.aud === env.GOOGLE_CLIENT_ID && typeof claims.exp === "number" && claims.exp * 1000 > now;
    return ok && typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

const clear = pending("", 0);

/** Google's answer: spends the code, and signs in. The first sign-in makes the account. */
async function finish(req: Request, env: Env, now: number) {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back(env, "cancelled", clear);
  const [state, verifier] = (cookieOf(req, PENDING) ?? "").split(".");
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || url.searchParams.get("state") !== state) return back(env, "failed", clear);
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: callback(env),
    }),
  }).catch(() => null);
  const answer = res?.ok ? ((await res.json().catch(() => null)) as { id_token?: unknown } | null) : null;
  const account = accountIn(answer?.id_token, env, now);
  if (!account) return back(env, "failed", clear);

  const hash = await hmac(env.ACCOUNT_HMAC_KEY, `google:${account}`);
  await env.DB.prepare("INSERT INTO users (id, account_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (account_hash) DO NOTHING").bind(crypto.randomUUID(), hash, now).run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE account_hash = ?").bind(hash).first<{ id: string }>();
  const t = token();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(t), user!.id, now + SESSION_MS).run();
  return back(env, null, clear, session(t, SESSION_MS / 1000));
}
export const finishGoogle = (req: Request, env: Env, now: number) => finish(req, env, now).catch(() => back(env, "failed", clear));

/** The signed-in user's id, or null. */
export async function userOf(req: Request, env: Env, now: number) {
  const t = cookieOf(req, COOKIE);
  if (!t) return null;
  const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(await sha256(t), now).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function signOut(req: Request, env: Env) {
  const t = cookieOf(req, COOKIE);
  if (t) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
  return json({ ok: true }, 200, { "set-cookie": session("", 0) });
}
