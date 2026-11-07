// The sync service, end to end through its fetch handler, on the real schema: Google is mocked, D1 stood in for by SQLite.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ACCOUNT, MAX_RECORDS, PAGE } from "./records";
import { handle, sweep } from "./index";
import type { Env } from "./env";
import { testDb } from "./sqlite.test-helper";

const ORIGIN = "https://www.michael-han.com";
const NOW = 1_800_000_000_000;
const id = (n: number) => n.toString(16).padStart(64, "0");
let env: Env;
let google: { claims: Record<string, unknown>; raw?: unknown; status: number; down: boolean; asked: URLSearchParams[] };

function call(method: string, path: string, o: { body?: unknown; cookie?: string; origin?: string | null; header?: boolean; now?: number; ip?: string } = {}) {
  const h: Record<string, string> = {};
  if (o.origin !== null) h.origin = o.origin ?? ORIGIN;
  if (o.header !== false) h["x-lizard"] = "1";
  if (o.cookie) h.cookie = o.cookie;
  h["cf-connecting-ip"] = o.ip ?? "1.2.3.4";
  const body = o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
  return handle(new Request(`${ORIGIN}/lizard/api/${path}`, { method, headers: h, body }), env, o.now ?? NOW);
}

const url64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const idToken = (claims: Record<string, unknown>) => `head.${url64(new TextEncoder().encode(JSON.stringify(claims)))}.sig`;

/** To Google: where it sent the browser, and the cookie it holds meanwhile. */
async function toGoogle(now = NOW, ip?: string) {
  const res = await call("GET", "auth/google", { origin: null, now, ip });
  expect(res.status).toBe(302);
  return { to: new URL(res.headers.get("location")!), held: res.headers.getSetCookie()[0]!, cookie: res.headers.getSetCookie()[0]!.split(";")[0]! };
}

/** Back from Google, as a browser holding the cookie comes back. */
const fromGoogle = (query: string, cookie?: string, now = NOW) => call("GET", `auth/google/callback?${query}`, { origin: null, cookie, now });

const cookieNamed = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

async function signIn(account = "1001", now = NOW) {
  google.claims = { ...google.claims, sub: account, exp: Math.floor(now / 1000) + 3600 };
  const { to, cookie } = await toGoogle(now);
  const res = await fromGoogle(`code=the-code&state=${to.searchParams.get("state")}`, cookie, now);
  expect(res.headers.get("location")).toBe(`${ORIGIN}/lizard/settings`);
  return cookieNamed(res, "lizard_session")!.split(";")[0]!;
}

const count = async (t: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

beforeEach(() => {
  google = { claims: { iss: "https://accounts.google.com", aud: "the-client", sub: "1001", exp: Math.floor(NOW / 1000) + 3600 }, status: 200, down: false, asked: [] };
  env = { DB: testDb(), ACCOUNT_HMAC_KEY: "test-hmac", GOOGLE_CLIENT_ID: "the-client", GOOGLE_CLIENT_SECRET: "test-secret", SITE_ORIGIN: ORIGIN };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(url).toBe("https://oauth2.googleapis.com/token");
    if (google.down) throw new Error("no route");
    google.asked.push(new URLSearchParams(init.body as URLSearchParams));
    const claims = google.claims;
    return new Response(JSON.stringify({ id_token: google.raw ?? idToken(claims) }), { status: google.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("signing in", () => {
  it("goes to Google asking only which account this is, holding its proof in a short cookie", async () => {
    const { to, held } = await toGoogle();
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = to.searchParams;
    expect(q.get("scope")).toBe("openid");
    expect(q.get("client_id")).toBe("the-client");
    expect(q.get("redirect_uri")).toBe(`${ORIGIN}/lizard/api/auth/google/callback`);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("state")!.length).toBeGreaterThan(40);
    for (const x of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/lizard/api/auth/google", "Max-Age=600"]) expect(held).toContain(x);
    const [state, verifier] = held.split(";")[0]!.split("=")[1]!.split(".");
    expect(state).toBe(q.get("state"));
    expect(q.get("code_challenge")).toBe(url64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))));
    expect(await count("users")).toBe(0);
  });

  it("spends the code with its proof and the secret, and keeps only hashes", async () => {
    const { to, cookie } = await toGoogle();
    const res = await fromGoogle(`code=the-code&state=${to.searchParams.get("state")}`, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/lizard/settings`);
    const sent = google.asked[0]!;
    expect(sent.get("code")).toBe("the-code");
    expect(sent.get("client_secret")).toBe("test-secret");
    expect(sent.get("code_verifier")).toBe(cookie.split(".")[1]);
    expect(sent.get("redirect_uri")).toBe(`${ORIGIN}/lizard/api/auth/google/callback`);
    expect(cookieNamed(res, "lizard_google")).toContain("Max-Age=0");
    const session = cookieNamed(res, "lizard_session")!;
    const held = JSON.stringify(await env.DB.prepare("SELECT * FROM users").first()) + JSON.stringify(await env.DB.prepare("SELECT * FROM sessions").first());
    expect(held).not.toContain("1001");
    expect(held).not.toContain(session.split(";")[0]!.split("=")[1]);
  });

  it("finds the same account each time, and another Google account finds its own", async () => {
    const c1 = await signIn("1001");
    const c2 = await signIn("1001");
    expect(await count("users")).toBe(1);
    expect(c1).not.toBe(c2);
    await signIn("2002");
    expect(await count("users")).toBe(2);
  });

  it("sets a session cookie scripts and other sites can't reach", async () => {
    const { to, cookie } = await toGoogle();
    const set = cookieNamed(await fromGoogle(`code=c&state=${to.searchParams.get("state")}`, cookie), "lizard_session")!;
    for (const x of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/lizard/api"]) expect(set).toContain(x);
  });

  it("says so when you cancel at Google, and asks Google nothing", async () => {
    const { cookie } = await toGoogle();
    const res = await fromGoogle("error=access_denied", cookie);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/lizard/settings#sync-error=cancelled`);
    expect(cookieNamed(res, "lizard_google")).toContain("Max-Age=0");
    expect(google.asked).toEqual([]);
  });

  it("takes no answer that isn't to this browser's own request", async () => {
    const { to, cookie } = await toGoogle();
    const state = to.searchParams.get("state");
    for (const [query, held] of [
      [`code=c&state=${state}`, undefined],
      ["code=c&state=someone-elses", cookie],
      ["code=c", cookie],
      [`state=${state}`, cookie],
      [`code=c&state=${state}`, "lizard_google=nonsense"],
    ] as const) {
      expect((await fromGoogle(query, held)).headers.get("location")).toBe(`${ORIGIN}/lizard/settings#sync-error=failed`);
    }
    expect(google.asked).toEqual([]);
    expect(await count("sessions")).toBe(0);
  });

  it("takes no answer from Google that doesn't vouch for this client, now", async () => {
    const good = google.claims;
    const failing: (() => void)[] = [
      () => (google.claims = { ...good, aud: "another-client" }),
      () => (google.claims = { ...good, iss: "https://accounts.google.com.evil.example" }),
      () => (google.claims = { ...good, exp: Math.floor(NOW / 1000) - 1 }),
      () => (google.claims = { ...good, sub: "" }),
      () => (google.claims = { ...good, sub: 1001 }),
      () => (google.raw = "not a token"),
      () => (google.raw = 7),
      () => (google.status = 400),
      () => (google.down = true),
    ];
    for (const fail of failing) {
      fail();
      const { to, cookie } = await toGoogle();
      const res = await fromGoogle(`code=c&state=${to.searchParams.get("state")}`, cookie);
      expect(res.headers.get("location")).toBe(`${ORIGIN}/lizard/settings#sync-error=failed`);
      expect(cookieNamed(res, "lizard_session")).toBeUndefined();
      Object.assign(google, { claims: good, raw: undefined, status: 200, down: false });
    }
    expect(await count("users")).toBe(0);
  });

  it("takes Google's other spelling of itself", async () => {
    google.claims = { ...google.claims, iss: "accounts.google.com" };
    expect(await signIn()).toContain("lizard_session=");
  });

  it("limits sign-ins from one address, and the window passes", async () => {
    for (let i = 0; i < 30; i++) await toGoogle(NOW, "9.9.9.9");
    const res = await call("GET", "auth/google", { origin: null, ip: "9.9.9.9" });
    expect(res.headers.get("location")).toBe(`${ORIGIN}/lizard/settings#sync-error=busy`);
    await toGoogle(NOW, "5.6.7.8");
    await toGoogle(NOW + 3_600_001, "9.9.9.9");
  });

  it("goes back to Settings rather than showing a page of code when the database fails", async () => {
    env.DB = { prepare: () => { throw new Error("secret detail"); }, batch: async () => {} };
    expect((await call("GET", "auth/google", { origin: null })).headers.get("location")).toBe(`${ORIGIN}/lizard/settings#sync-error=failed`);
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

  it("says it isn't there until Google's secret is, so no sign-in button shows that can't work", async () => {
    expect((await call("GET", "health")).status).toBe(200);
    env.GOOGLE_CLIENT_SECRET = "";
    expect((await call("GET", "health")).status).toBe(503);
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
    const res = await call("GET", "me", { cookie: "lizard_session=x" });
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
    const a = await signIn("1001"), b = await signIn("2002");
    await put(a, [rec(1, "QUFB", 1), rec(1, "QkJC", 2)]);
    expect((await get(a)).records).toHaveLength(2);
    expect((await get(b)).records).toEqual([]);
    await put(b, [rec(1, "Q0ND", 1)]);
    expect((await get(a)).records.find((r) => r.store === 1)!.body).toBe("QUFB");
  });

  it("refuses what isn't a record, with nothing written", async () => {
    const c = await signIn();
    const cases: unknown[] = [[], "x", [rec(1), { ...rec(2), store: 9 }], [{ ...rec(1), id: "short" }], [{ ...rec(1), body: "" }], [rec(1), rec(1)], Array.from({ length: MAX_RECORDS + 1 }, (_, i) => rec(i)), [{ ...rec(1), body: "A".repeat(700_004) }]];
    for (const bad of cases) expect((await put(c, bad)).status).toBe(400);
    expect((await get(c)).records).toEqual([]);
  });

  it("holds a device's JSON as it came, and counts its size in bytes", async () => {
    const c = await signIn();
    const body = JSON.stringify({ id: "h1", data: { text: 'Seat 1: "Ωmega" (€5)' } });
    expect(await (await put(c, [rec(1, body)])).json()).toEqual({ seq: 1, bytes: new TextEncoder().encode(body).length });
    expect((await get(c)).records[0]!.body).toBe(body);
    expect((await put(c, [rec(2, "€".repeat(240_000))])).status).toBe(400);
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

describe("the account", () => {
  it("says which account it is, the same each time, and a new one after a delete", async () => {
    const c = await signIn();
    const me = async (cookie: string) => (await (await call("GET", "me", { cookie })).json()) as { account: string };
    const { account } = await me(c);
    expect(account).toBeTruthy();
    expect((await me(await signIn())).account).toBe(account);
    await call("DELETE", "account", { cookie: c });
    expect((await me(await signIn())).account).not.toBe(account);
  });

  it("answers nothing to the keys route that's gone", async () => {
    const c = await signIn();
    expect((await call("PUT", "keys", { cookie: c, body: { salt: "c2FsdA==", check: "Y2hlY2s=" } })).status).toBe(404);
  });

  it("deletes an account and everything of it, leaving another's", async () => {
    const a = await signIn("1001"), b = await signIn("2002");
    for (const c of [a, b]) await call("POST", "records", { cookie: c, body: { records: [{ store: 1, id: id(1), body: "QUJD" }] } });
    expect((await call("DELETE", "account", { cookie: a })).status).toBe(200);
    expect(await (await call("GET", "me", { cookie: a })).json()).toEqual({ signedIn: false });
    expect([await count("users"), await count("records"), await count("sessions")]).toEqual([1, 1, 1]);
  });

  it("sweeps out what's expired", async () => {
    await signIn();
    await sweep(env, NOW + 40 * 24 * 3600 * 1000);
    for (const t of ["sessions", "rate"]) expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())!.n).toBe(1);
  });
});
