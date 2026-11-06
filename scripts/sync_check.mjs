// Account sync in two real browsers, against the Worker's real code on the real schema. SQLite stands in for D1 and a list
// for Resend, as neither is reachable from here; everything else is real: WebCrypto, keys kept in IndexedDB, the cookie, the
// service worker's reload on a link opened on a new device, and two browsers converging. It's run by hand, as the site is
// built without sync until the service is deployed:
//
//   node --experimental-transform-types --no-warnings scripts/sync_check.mjs
//
// The build and the browsers come to more than a minute of CPU: route it through slot.sh while the builds run.
import { execFileSync } from "node:child_process";
import { readFile, stat, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, registerHooks } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const require = createRequire(join(WEB, "package.json"));
const { chromium } = require("@playwright/test");

const PORT = 4188;
const ORIGIN = `http://localhost:${PORT}`;
const work = await mkdtemp(join(tmpdir(), "lizard-sync-"));
const dist = join(work, "dist");

console.log("building the site with sync in");
execFileSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], { cwd: WEB, env: { ...process.env, VITE_SYNC: "on" }, stdio: "ignore" });

// (the Worker's source as it stands: Node runs the TypeScript, given the extensions its imports leave off)
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith(".") && !extname(spec) ? `${spec}.ts` : spec, ctx) });
globalThis.__dirname = join(ROOT, "worker/src");
const load = (file) => import(pathToFileURL(join(ROOT, file)).href);
const { handle } = await load("worker/src/index.ts");
const { testDb } = await load("worker/src/sqlite.test-helper.ts");

const mail = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.resend.com/emails") return realFetch(url, init);
  mail.push(JSON.parse(init.body).text);
  return new Response("{}", { status: 200 });
};
const env = { DB: testDb(), EMAIL_HMAC_KEY: "check-only", RESEND_API_KEY: "check-only", SITE_ORIGIN: ORIGIN, MAIL_FROM: "Lizard <l@example.com>" };

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".webmanifest": "application/json" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname.startsWith("/lizard/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    headers.set("cf-connecting-ip", "127.0.0.1");
    const out = await handle(new Request(url, { method: req.method, headers, body: req.method === "GET" ? undefined : body }), env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  let file = join(dist, url.pathname.replace(/^\/lizard\/?/, ""));
  const isFile = await stat(file).then((s) => s.isFile(), () => false);
  if (!isFile) file = join(dist, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(PORT, "localhost", r));

const browser = await chromium.launch();
const failures = [];
const check = (name, ok, more = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${more ? ` (${more})` : ""}`);
  if (!ok) failures.push(name);
};

const PHRASE = "a long enough phrase";
const EMAIL = "someone@example.com";
const settings = `${ORIGIN}/lizard/settings`;

/** A sign-in from a mailed link, as a browser that's never been here opens it. */
async function signIn(page) {
  await page.goto(settings);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("a link is on its way").waitFor();
  return mail.at(-1).match(/https?:\S+/)[0];
}

const saved = (page, title) => page.getByRole("listitem", { name: title });

/** Sync now, waiting for the words of this run: the line from the last one may already be up. */
const syncNow = async (page, words) => {
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.getByText(words).waitFor();
};

const spot = (id, title) => ({ id, title, line: "p=6&s=100", state: {}, tags: [], note: "", createdAt: Date.now(), updatedAt: Date.now() });
const seed = (page, record) =>
  page.evaluate(
    (r) =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open("lizard");
        q.onerror = () => reject(new Error("open"));
        q.onsuccess = () => {
          const tx = q.result.transaction("savedSpots", "readwrite");
          tx.objectStore("savedSpots").put(r);
          tx.oncomplete = () => (q.result.close(), resolve());
        };
      }),
    record,
  );

const rows = () => env.DB.prepare("SELECT body, id_hash, store FROM records").all().then((r) => r.results);

try {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) p.setDefaultTimeout(30_000);
  const errors = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(String(e)));

  const link = await signIn(a);
  check("the mail carries the token in the fragment", link.startsWith(`${settings}#sync-token=`));
  await a.goto(link);
  await a.getByLabel(/^Passphrase/).fill(PHRASE);
  await a.getByLabel("The same again").fill(PHRASE);
  check("the token has left the address", new URL(a.url()).hash === "");
  await a.getByRole("button", { name: "Start syncing" }).click();
  await a.getByText(/Last synced at/).waitFor();
  check("a passphrase chosen, and a first sync", true);

  await seed(a, spot("sync-check-1", "Sealed flop"));
  await syncNow(a, /, 1 sent/);
  const held = await rows();
  check("one record reached the server", held.length === 1, `${held.length}`);
  check("the server holds no name or id", !JSON.stringify(held).includes("Sealed flop") && !JSON.stringify(held).includes("sync-check-1"));

  // a browser that's never been here, opening the link straight off: the service worker's reload comes with it
  const link2 = await (async () => {
    const other = await (await browser.newContext()).newPage();
    const l = await signIn(other);
    await other.context().close();
    return l;
  })();
  await b.goto(link2);
  await b.getByLabel("Passphrase", { exact: true }).fill("not the right phrase at all");
  await b.getByRole("button", { name: "Unlock" }).click();
  await b.getByText("isn't the passphrase").waitFor();
  check("a new device signs in from the link through the first-visit reload, and a wrong passphrase opens nothing", true);
  await b.getByLabel("Passphrase", { exact: true }).fill(PHRASE);
  await b.getByRole("button", { name: "Unlock" }).click();
  await b.getByText(/1 changed here/).waitFor();
  await b.goto(`${ORIGIN}/lizard/saved`);
  await saved(b, "Sealed flop").waitFor();
  check("the second device has the spot", true);

  await saved(b, "Sealed flop").getByRole("button", { name: "Delete", exact: true }).click();
  await saved(b, "Sealed flop").getByRole("button", { name: "Delete spot", exact: true }).click();
  await saved(b, "Sealed flop").waitFor({ state: "hidden" });
  await b.goto(settings);
  await b.getByLabel("Passphrase", { exact: true }).fill(PHRASE);
  await b.getByRole("button", { name: "Unlock" }).click();
  await b.getByText(/1 sent/).waitFor();
  await syncNow(a, /1 changed here/);
  await a.goto(`${ORIGIN}/lizard/saved`);
  await a.getByRole("button", { name: "Download backup" }).waitFor();
  check("the deletion reached the first device", (await saved(a, "Sealed flop").count()) === 0);

  await a.goto(settings);
  await a.getByLabel("Passphrase", { exact: true }).fill(PHRASE);
  await a.getByRole("checkbox", { name: "Stay unlocked on this device" }).check();
  await a.getByRole("button", { name: "Unlock" }).click();
  await a.getByRole("button", { name: "Sync now" }).waitFor();
  await a.goto(`${ORIGIN}/lizard/`);
  await a.reload();
  await a.goto(settings);
  await a.getByRole("button", { name: "Sync now" }).waitFor();
  check("stay unlocked holds through a reload: the keys are kept in IndexedDB unextractable", true);
  const extractable = await a.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open("lizard");
        q.onerror = () => reject(new Error("open"));
        q.onsuccess = () => {
          const g = q.result.transaction("kv").objectStore("kv").get("syncKeys");
          g.onsuccess = () => (q.result.close(), resolve(g.result ? g.result.keys.seal.extractable : "none"));
        };
      }),
  );
  check("the kept key can't be read out", extractable === false, String(extractable));

  await a.getByRole("button", { name: "Delete my account" }).click();
  await a.getByRole("button", { name: "Delete the account and the synced copy" }).click();
  await a.getByLabel("Email").waitFor();
  check("deleting the account leaves the server with nothing", (await rows()).length === 0);
  check("nothing threw in either page", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  failures.push(String(e));
  console.log(`FAIL ${String(e).slice(0, 600)}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exit(failures.length ? 1 : 0);
