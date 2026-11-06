// The encrypted records. The server can't read one, so it can't merge: it's a per-account log, each write taking the next
// sequence number, and a device pulls everything after the last number it saw. A deletion is a record like any other, and
// replaces the copy it deletes. The number is taken inside the write's transaction, so a pull can't step past a write
// that's still landing.
import type { Env } from "./env";
import { json, Refused, readJson } from "./http";
import { LIMITS, spend } from "./limits";

export const STORES = [1, 2, 3, 4];
export const MAX_RECORDS = 100;
/** 512 KB of ciphertext, in base64 */
export const MAX_RECORD = 700_000;
export const MAX_REQUEST = 4 * 1024 * 1024;
export const MAX_ACCOUNT = 250 * 1024 * 1024;
export const PAGE = 200;
const HASH = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

interface Incoming {
  store: number;
  id: string;
  body: string;
}

function readRecords(x: unknown): Incoming[] {
  if (!Array.isArray(x) || !x.length || x.length > MAX_RECORDS) throw new Refused(400, "bad_records");
  let total = 0;
  const seen = new Set<string>();
  for (const r of x as Partial<Incoming>[]) {
    if (!r || !STORES.includes(r.store as number) || typeof r.id !== "string" || !HASH.test(r.id)) throw new Refused(400, "bad_records");
    if (typeof r.body !== "string" || !r.body || r.body.length > MAX_RECORD || !BASE64.test(r.body)) throw new Refused(400, "bad_records");
    total += r.body.length;
    const key = `${r.store}|${r.id}`;
    if (seen.has(key)) throw new Refused(400, "bad_records");
    seen.add(key);
  }
  if (total > MAX_REQUEST) throw new Refused(413, "too_large");
  return x as Incoming[];
}

export async function push(req: Request, env: Env, user: string, now: number) {
  await spend(env.DB, `write:${user}`, LIMITS.writes, now);
  const records = readRecords((await readJson(req)).records);
  const size = records.reduce((a, r) => a + r.body.length, 0);
  const u = await env.DB.prepare("SELECT bytes FROM users WHERE id = ?").bind(user).first<{ bytes: number }>();
  // (counts what these replace as still there: it can refuse a little early, never let an account past)
  if ((u?.bytes ?? 0) + size > MAX_ACCOUNT) throw new Refused(413, "account_full");
  const write = records.flatMap((r) => [
    env.DB.prepare("UPDATE users SET seq = seq + 1, bytes = bytes + ?1 - COALESCE((SELECT size FROM records WHERE user_id = ?2 AND store = ?3 AND id_hash = ?4), 0) WHERE id = ?2").bind(r.body.length, user, r.store, r.id),
    env.DB.prepare(
      `INSERT INTO records (user_id, store, id_hash, seq, size, body)
       VALUES (?1, ?2, ?3, (SELECT seq FROM users WHERE id = ?1), ?4, ?5)
       ON CONFLICT (user_id, store, id_hash) DO UPDATE SET seq = excluded.seq, size = excluded.size, body = excluded.body`,
    ).bind(user, r.store, r.id, r.body.length, r.body),
  ]);
  await env.DB.batch(write);
  const after = await env.DB.prepare("SELECT seq, bytes FROM users WHERE id = ?").bind(user).first<{ seq: number; bytes: number }>();
  return json({ seq: after?.seq ?? 0, bytes: after?.bytes ?? 0 });
}

export async function pull(url: URL, env: Env, user: string) {
  const since = Number(url.searchParams.get("since") ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) throw new Refused(400, "bad_since");
  const { results } = await env.DB.prepare("SELECT store, id_hash AS id, seq, body FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?").bind(user, since, PAGE).all<{ store: number; id: string; seq: number; body: string }>();
  const out: typeof results = [];
  let size = 0;
  for (const r of results) {
    if (out.length && size + r.body.length > MAX_REQUEST) break;
    out.push(r);
    size += r.body.length;
  }
  return json({ records: out, more: out.length < results.length || results.length === PAGE });
}

export async function me(env: Env, user: string | null) {
  if (!user) return json({ signedIn: false });
  const u = await env.DB.prepare("SELECT salt, check_value, seq, bytes FROM users WHERE id = ?").bind(user).first<{ salt: string | null; check_value: string | null; seq: number; bytes: number }>();
  return json({ signedIn: true, salt: u?.salt ?? null, check: u?.check_value ?? null, seq: u?.seq ?? 0, bytes: u?.bytes ?? 0, maxBytes: MAX_ACCOUNT });
}

/** Sets the salt and check value. Replacing them starts a new synced copy, so the old one's records go: nothing could open them. */
export async function setKeys(req: Request, env: Env, user: string) {
  const { salt, check, reset } = await readJson(req);
  if (typeof salt !== "string" || !BASE64.test(salt) || salt.length > 64) throw new Refused(400, "bad_keys");
  if (typeof check !== "string" || !BASE64.test(check) || check.length > 512) throw new Refused(400, "bad_keys");
  if (reset === true) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM records WHERE user_id = ?").bind(user),
      env.DB.prepare("UPDATE users SET salt = ?, check_value = ?, bytes = 0 WHERE id = ?").bind(salt, check, user),
    ]);
    return json({ ok: true });
  }
  const set = await env.DB.prepare("UPDATE users SET salt = ?, check_value = ? WHERE id = ? AND salt IS NULL RETURNING id").bind(salt, check, user).first();
  if (!set) throw new Refused(409, "keys_set");
  return json({ ok: true });
}

export async function deleteAccount(env: Env, user: string) {
  // (each by name, not left to ON DELETE CASCADE: D1's foreign keys aren't something to stake this on)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM records WHERE user_id = ?").bind(user),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user),
  ]);
  return json({ ok: true }, 200, { "set-cookie": "lizard_session=; Path=/lizard/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
}
