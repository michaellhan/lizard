// Sign-in by a link in an email. Only hashes are kept: of the address, of the link's token and of the session's. Opening
// the link only loads the page, which then spends the token, so a mail scanner fetching links can't.
import type { Env } from "./env";
import { json, Refused, readJson } from "./http";
import { LIMITS, spend } from "./limits";
import { hmac, sha256, token } from "./secrets";

const COOKIE = "lizard_session";
export const TOKEN_MS = 15 * 60 * 1000;
export const SESSION_MS = 30 * 24 * 3600 * 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const emailHash = (env: Env, email: string) => hmac(env.EMAIL_HMAC_KEY, email.trim().toLowerCase());
const ipOf = (req: Request) => req.headers.get("cf-connecting-ip") ?? "unknown";

const cookie = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/lizard/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function mail(env: Env, to: string, link: string) {
  const text = `Open this link to sign in to Lizard's sync. It works once, for 15 minutes.\n\n${link}\n\nIf you didn't ask for this, ignore it: nothing happens.`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject: "Sign in to Lizard", text }),
  });
  if (!res.ok) throw new Refused(502, "mail_failed");
}

/** Mails a link. The answer is the same for an address with an account as for one without: none is looked up. */
export async function start(req: Request, env: Env, now: number) {
  const { email } = await readJson(req);
  if (typeof email !== "string" || !EMAIL.test(email.trim())) throw new Refused(400, "bad_email");
  const hash = await emailHash(env, email);
  await spend(env.DB, `ip:${await sha256(ipOf(req))}`, LIMITS.mailIp, now);
  await spend(env.DB, `mail:${hash}`, LIMITS.mailAddress, now);
  const t = token();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email_hash, expires_at) VALUES (?, ?, ?)").bind(await sha256(t), hash, now + TOKEN_MS).run();
  // (in the fragment: it reaches no server's log and no Referer)
  await mail(env, email.trim(), `${env.SITE_ORIGIN}/lizard/settings#sync-token=${t}`);
  return json({ ok: true });
}

/** Spends a link's token, once, and signs in; the first sign-in makes the account. */
export async function finish(req: Request, env: Env, now: number) {
  await spend(env.DB, `finish:${await sha256(ipOf(req))}`, LIMITS.finishIp, now);
  const { token: t } = await readJson(req);
  if (typeof t !== "string" || t.length > 100) throw new Refused(400, "bad_token");
  const row = await env.DB.prepare("DELETE FROM login_tokens WHERE token_hash = ? AND expires_at > ? RETURNING email_hash").bind(await sha256(t), now).first<{ email_hash: string }>();
  if (!row) throw new Refused(401, "bad_token");
  await env.DB.prepare("INSERT INTO users (id, email_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (email_hash) DO NOTHING").bind(crypto.randomUUID(), row.email_hash, now).run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE email_hash = ?").bind(row.email_hash).first<{ id: string }>();
  const session = token();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(session), user!.id, now + SESSION_MS).run();
  return json({ ok: true }, 200, { "set-cookie": cookie(session, SESSION_MS / 1000) });
}

const sessionToken = (req: Request) => req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];

/** The signed-in user's id, or null. */
export async function userOf(req: Request, env: Env, now: number) {
  const t = sessionToken(req);
  if (!t) return null;
  const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(await sha256(t), now).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function signOut(req: Request, env: Env) {
  const t = sessionToken(req);
  if (t) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
  return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
}
