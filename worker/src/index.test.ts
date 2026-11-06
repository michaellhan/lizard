// The sync service, end to end through its fetch handler, on the real schema: Resend is mocked, D1 stood in for by SQLite.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ACCOUNT, MAX_RECORDS, PAGE } from "./records";
import { TOKEN_MS } from "./auth";
import { handle, sweep } from "./index";
import type { Env } from "./env";
import { testDb } from "./sqlite.test-helper";

const ORIGIN = "https://www.michael-han.com";
const NOW = 1_800_000_000_000;
const id = (n: number) => n.toString(16).padStart(64, "0");
let env: Env;
let sent: { to: string; text: string; auth: string }[];
let mailOk: boolean;

function call(method: string, path: string, o: { body?: unknown; cookie?: string; origin?: string | null; header?: boolean; now?: number; ip?: string } = {}) {
  const h: Record<string, string> = {};
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.header !== false) h["x-lizard"] = "1";
  if (o.cookie) h.cookie = o.cookie;
  h["cf-connecting-ip"] = o.ip ?? "1.2.3.4";
  const body = o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
  return handle(new Request(`${ORIGIN}/lizard/api/${path}`, { method, headers: h, body }), env, o.now ?? NOW);
}

const tokenIn = (text: string) => text.match(/#sync-token=([\w-]+)/)![1]!;

async function signIn(email = "a@example.com", now = NOW) {
  await call("POST", "auth/start", { body: { email }, now });
  const res = await call("POST", "auth/finish", { body: { token: tokenIn(sent.at(-1)!.text) }, now });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeEach(() => {
  sent = [];
  mailOk = true;
  env = { DB: testDb(), EMAIL_HMAC_KEY: "test-hmac", RESEND_API_KEY: "test-resend", SITE_ORIGIN: ORIGIN, MAIL_FROM: "Lizard <l@example.com>" };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.resend.com/emails");
    const b = JSON.parse(init.body as string);
    sent.push({ to: b.to, text: b.text, auth: (init.headers as Record<string, string>).authorization! });
    return new Response("{}", { status: mailOk ? 200 : 500 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("signing in", () => {
  it("mails a link holding the token in its fragment, and keeps only hashes", async () => {
    const res = await call("POST", "auth/start", { body: { email: " A@Example.com " } });
    expect(await res.json()).toEqual({ ok: true });
    expect(sent[0]!.to).toBe("A@Example.com");
    expect(sent[0]!.auth).toBe("Bearer test-resend");
    expect(sent[0]!.text).toContain(`${ORIGIN}/lizard/settings#sync-token=`);
    const t = tokenIn(sent[0]!.text);
    const row = await env.DB.prepare("SELECT * FROM login_tokens").first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(t);
    expect(JSON.stringify(row).toLowerCase()).not.toContain("example");
  });

  it("makes no account until the link is used, and an address finds the same one in any case", async () => {
    await call("POST", "auth/start", { body: { email: "a@example.com" } });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n).toBe(0);
    const c1 = await signIn("a@example.com");
    const c2 = await signIn("A@EXAMPLE.COM");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n).toBe(1);
    const row = await env.DB.prepare("SELECT * FROM users").first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain("example");
    expect(c1).not.toBe(c2);
  });

  it("sets a session cookie scripts and other sites can't reach", async () => {
    await call("POST", "auth/start", { body: { email: "a@example.com" } });
    const res = await call("POST", "auth/finish", { body: { token: tokenIn(sent[0]!.text) } });
    const set = res.headers.get("set-cookie")!;
    for (const x of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/lizard/api"]) expect(set).toContain(x);
  });

  it("spends a token once, and refuses an expired or made-up one", async () => {
    await call("POST", "auth/start", { body: { email: "a@example.com" } });
    const t = tokenIn(sent[0]!.text);
    expect((await call("POST", "auth/finish", { body: { token: "nonsense" } })).status).toBe(401);
    expect((await call("POST", "auth/finish", { body: { token: t }, now: NOW + TOKEN_MS } )).status).toBe(401);
    expect((await call("POST", "auth/finish", { body: { token: t } })).status).toBe(200);
    expect((await call("POST", "auth/finish", { body: { token: t } })).status).toBe(401);
  });

  it("refuses a bad address and says plainly when the mail didn't go", async () => {
    expect((await call("POST", "auth/start", { body: { email: "nope" } })).status).toBe(400);
    expect((await call("POST", "auth/start", { body: { email: ["a@b.co"] } })).status).toBe(400);
    expect((await call("POST", "auth/start", { body: "{not json" })).status).toBe(400);
    mailOk = false;
    expect((await call("POST", "auth/start", { body: { email: "a@example.com" } })).status).toBe(502);
  });

  it("limits mail to an address and from an address, and the window passes", async () => {
    for (let i = 0; i < 5; i++) expect((await call("POST", "auth/start", { body: { email: "a@example.com" } })).status).toBe(200);
    expect((await call("POST", "auth/start", { body: { email: "a@example.com" } })).status).toBe(429);
    expect(sent).toHaveLength(5);
    expect((await call("POST", "auth/start", { body: { email: "a@example.com" }, now: NOW + 3_600_001 })).status).toBe(200);
    for (let i = 0; i < 20; i++) expect((await call("POST", "auth/start", { body: { email: `u${i}@example.com` }, ip: "9.9.9.9" })).status).toBe(200);
    expect((await call("POST", "auth/start", { body: { email: "z@example.com" }, ip: "9.9.9.9" })).status).toBe(429);
    expect((await call("POST", "auth/start", { body: { email: "z@example.com" }, ip: "5.6.7.8" })).status).toBe(200);
  });

  it("limits tries at a token from one address", async () => {
    for (let i = 0; i < 30; i++) expect((await call("POST", "auth/finish", { body: { token: "x" } })).status).toBe(401);
    expect((await call("POST", "auth/finish", { body: { token: "x" } })).status).toBe(429);
  });

  it("signs out, and an expired session is signed out", async () => {
    const c = await signIn();
    expect(await (await call("GET", "me", { cookie: c })).json()).toMatchObject({ signedIn: true });
    expect(await (await call("GET", "me", { cookie: c, now: NOW + 31 * 24 * 3600 * 1000 })).json()).toEqual({ signedIn: false });
    await call("POST", "auth/signout", { cookie: c });
    expect(await (await call("GET", "me", { cookie: c })).json()).toEqual({ signedIn: false });
  });
});

describe("the origin", () => {
  it("refuses another site's request, and a write with no header or no origin", async () => {
    const c = await signIn();
    expect((await call("GET", "me", { cookie: c, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "records", { cookie: c, body: {}, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "records", { cookie: c, body: {}, header: false })).status).toBe(403);
    expect((await call("POST", "records", { cookie: c, body: {}, origin: null })).status).toBe(403);
    expect((await call("DELETE", "account", { cookie: c, origin: "https://www.michael-han.com.evil.example" })).status).toBe(403);
  });

  it("opens no CORS and caches nothing", async () => {
    const res = await call("GET", "health", { origin: null });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a path it doesn't know, and gives no detail of a failure", async () => {
    expect((await call("GET", "nope")).status).toBe(404);
    expect((await call("GET", "account", { cookie: await signIn() })).status).toBe(405);
    env.DB = { prepare: () => { throw new Error("secret detail"); }, batch: async () => {} };
    const res = await call("POST", "auth/start", { body: { email: "a@example.com" } });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"failed"}');
  });
});

describe("records", () => {
  const rec = (n: number, body = "QUJD", store = 1) => ({ store, id: id(n), body });
  const put = (c: string, records: unknown, now = NOW) => call("POST", "records", { cookie: c, body: { records }, now });
  const get = async (c: string, since = 0) => (await (await call("GET", `records?since=${since}`, { cookie: c })).json()) as { records: { store: number; id: string; seq: number; body: string }[]; more: boolean };

  it("asks for a session", async () => {
    expect((await call("GET", "records")).status).toBe(401);
    expect((await call("POST", "records", { body: { records: [rec(1)] } })).status).toBe(401);
    expect((await call("PUT", "keys", { body: {} })).status).toBe(401);
    expect((await call("DELETE", "account")).status).toBe(401);
  });

  it("gives each write the next number, and a pull what's after the number it saw", async () => {
    const c = await signIn();
    expect(await (await put(c, [rec(1), rec(2)])).json()).toEqual({ seq: 2, bytes: 8 });
    const first = await get(c);
    expect(first.records.map((r) => r.seq)).toEqual([1, 2]);
    await put(c, [rec(3)]);
    expect((await get(c, 2)).records.map((r) => [r.seq, r.id])).toEqual([[3, id(3)]]);
  });

  it("replaces a record, moves it to the end, and counts its size once", async () => {
    const c = await signIn();
    await put(c, [rec(1), rec(2)]);
    expect(await (await put(c, [rec(1, "QUJDREVG")])).json()).toEqual({ seq: 3, bytes: 12 });
    const { records } = await get(c);
    expect(records.map((r) => [r.id, r.seq, r.body])).toEqual([[id(2), 2, "QUJD"], [id(1), 3, "QUJDREVG"]]);
  });

  it("keeps the same id in two stores apart, and one account from another", async () => {
    const a = await signIn("a@example.com"), b = await signIn("b@example.com");
    await put(a, [rec(1, "QUFB", 1), rec(1, "QkJC", 2)]);
    expect((await get(a)).records).toHaveLength(2);
    expect((await get(b)).records).toEqual([]);
    await put(b, [rec(1, "Q0ND", 1)]);
    expect((await get(a)).records.find((r) => r.store === 1)!.body).toBe("QUFB");
  });

  it("refuses what isn't a record, with nothing written", async () => {
    const c = await signIn();
    const cases: unknown[] = [[], "x", [rec(1), { ...rec(2), store: 9 }], [{ ...rec(1), id: "short" }], [{ ...rec(1), body: "<b>" }], [{ ...rec(1), body: "" }], [rec(1), rec(1)], Array.from({ length: MAX_RECORDS + 1 }, (_, i) => rec(i)), [{ ...rec(1), body: "A".repeat(700_004) }]];
    for (const bad of cases) expect((await put(c, bad)).status).toBe(400);
    expect((await get(c)).records).toEqual([]);
  });

  it("refuses a request or an account too large", async () => {
    const c = await signIn();
    const big = Array.from({ length: 7 }, (_, i) => rec(i, "A".repeat(696_000)));
    expect((await put(c, big)).status).toBe(413);
    await env.DB.prepare("UPDATE users SET bytes = ?").bind(MAX_ACCOUNT - 2).run();
    expect((await put(c, [rec(1)])).status).toBe(413);
  });

  it("limits writes to a minute's", async () => {
    const c = await signIn();
    for (let i = 0; i < 60; i++) expect((await put(c, [rec(i)])).status).toBe(200);
    expect((await put(c, [rec(99)])).status).toBe(429);
    expect((await put(c, [rec(99)], NOW + 60_001)).status).toBe(200);
  });

  it("pages a long pull, stepping past nothing", async () => {
    const c = await signIn();
    for (let i = 0; i < 3; i++) await put(c, Array.from({ length: 100 }, (_, j) => rec(i * 100 + j)));
    const one = await get(c);
    expect(one.records).toHaveLength(PAGE);
    expect(one.more).toBe(true);
    const two = await get(c, one.records.at(-1)!.seq);
    expect(two.records).toHaveLength(100);
    expect(two.more).toBe(false);
  });

  it("rolls a whole write back if any of it fails", async () => {
    const c = await signIn();
    await put(c, [rec(1)]);
    const real = env.DB.batch.bind(env.DB);
    env.DB.batch = (stmts) => real([...stmts, env.DB.prepare("INSERT INTO nowhere VALUES (1)")]);
    expect((await put(c, [rec(2)])).status).toBe(500);
    env.DB.batch = real;
    expect((await get(c)).records).toHaveLength(1);
    expect(await (await call("GET", "me", { cookie: c })).json()).toMatchObject({ seq: 1, bytes: 4 });
  });
});

describe("keys and the account", () => {
  const keys = (c: string, salt: string, reset?: boolean) => call("PUT", "keys", { cookie: c, body: { salt, check: "Y2hlY2s=", ...(reset ? { reset } : {}) } });

  it("sets the salt once, and only a reset replaces it, taking the old records", async () => {
    const c = await signIn();
    expect(await (await call("GET", "me", { cookie: c })).json()).toMatchObject({ salt: null, check: null });
    expect((await keys(c, "c2FsdA==")).status).toBe(200);
    expect((await keys(c, "b3RoZXI=")).status).toBe(409);
    expect(await (await call("GET", "me", { cookie: c })).json()).toMatchObject({ salt: "c2FsdA==", check: "Y2hlY2s=" });
    await call("POST", "records", { cookie: c, body: { records: [{ store: 1, id: id(1), body: "QUJD" }] } });
    expect((await keys(c, "b3RoZXI=", true)).status).toBe(200);
    expect(await (await call("GET", "me", { cookie: c })).json()).toMatchObject({ salt: "b3RoZXI=", bytes: 0 });
    expect((await (await call("GET", "records", { cookie: c })).json() as { records: unknown[] }).records).toEqual([]);
  });

  it("refuses keys that aren't", async () => {
    const c = await signIn();
    expect((await call("PUT", "keys", { cookie: c, body: { salt: 1, check: "x" } })).status).toBe(400);
    expect((await call("PUT", "keys", { cookie: c, body: { salt: "<x>", check: "eA==" } })).status).toBe(400);
  });

  it("deletes an account and everything of it, leaving another's", async () => {
    const a = await signIn("a@example.com"), b = await signIn("b@example.com");
    for (const c of [a, b]) await call("POST", "records", { cookie: c, body: { records: [{ store: 1, id: id(1), body: "QUJD" }] } });
    expect((await call("DELETE", "account", { cookie: a })).status).toBe(200);
    expect(await (await call("GET", "me", { cookie: a })).json()).toEqual({ signedIn: false });
    const count = async (t: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
    expect([await count("users"), await count("records"), await count("sessions")]).toEqual([1, 1, 1]);
  });

  it("sweeps out what's expired", async () => {
    await signIn();
    await call("POST", "auth/start", { body: { email: "b@example.com" } });
    await sweep(env, NOW + 40 * 24 * 3600 * 1000);
    for (const t of ["login_tokens", "sessions", "rate"]) expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n).toBe(1);
  });
});
