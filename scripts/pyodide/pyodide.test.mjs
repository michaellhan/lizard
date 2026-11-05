// `npm run test:scripts`. No network: downloads go to a fake fetch, on small fake files.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkStaged, readPins, sha256, stagePyodide } from "./stage.mjs";
import { editWorker, hostsNamed } from "./worker-edits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = "https://cdn.example/full/";
const A = Buffer.from("the pyodide loader");
const B = Buffer.from("a wheel");
const pinOf = (name, bytes) => ({ name, bytes: bytes.length, sha256: sha256(bytes) });
const pins = { source: SOURCE, files: [pinOf("a.js", A), pinOf("b.whl", B)] };

const dirs = [];
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "lizard-pyodide-"));
  dirs.push(d);
  return d;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** a fetch serving these files by URL, recording what it was asked */
function fakeFetch(files) {
  const asked = [];
  const fn = async (url) => {
    asked.push(url);
    const body = files[url];
    return body ? new Response(body) : new Response("gone", { status: 404 });
  };
  return Object.assign(fn, { asked });
}
const noNetwork = async (url) => assert.fail(`no request expected, asked for ${url}`);

test("good downloads are verified and put in place", async () => {
  const dir = tempDir();
  const fetchFn = fakeFetch({ [`${SOURCE}a.js`]: A, [`${SOURCE}b.whl`]: B });
  const r = await stagePyodide({ pins, dir, fetchFn });
  assert.deepEqual(r, { kept: [], downloaded: ["a.js", "b.whl"], removed: [] });
  assert.deepEqual(readFileSync(join(dir, "a.js")), A);
  assert.deepEqual(readdirSync(dir).sort(), ["a.js", "b.whl"]);
  assert.deepEqual(checkStaged({ pins, dir }), []);
});

test("a download with the wrong hash fails the build and leaves no file", async () => {
  const dir = tempDir();
  const fetchFn = fakeFetch({ [`${SOURCE}a.js`]: A, [`${SOURCE}b.whl`]: Buffer.from("a tampered wheel") });
  await assert.rejects(stagePyodide({ pins, dir, fetchFn }), /b\.whl: SHA-256 .* pinned/);
  assert.deepEqual(readdirSync(dir), ["a.js"]); // (the good one stays; nothing of the bad one, not even a .part)
});

test("same-length bytes with a different hash fail too", async () => {
  const dir = tempDir();
  const fetchFn = fakeFetch({ [`${SOURCE}a.js`]: Buffer.from(A.toString().replace("loader", "LOADER")), [`${SOURCE}b.whl`]: B });
  await assert.rejects(stagePyodide({ pins, dir, fetchFn }), /a\.js: SHA-256/);
  assert.deepEqual(readdirSync(dir), []);
});

test("verified local files need no network", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "a.js"), A);
  writeFileSync(join(dir, "b.whl"), B);
  const r = await stagePyodide({ pins, dir, fetchFn: noNetwork });
  assert.deepEqual(r, { kept: ["a.js", "b.whl"], downloaded: [], removed: [] });
});

test("a damaged local file is replaced by a verified download, never kept", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "a.js"), "edited in place");
  writeFileSync(join(dir, "b.whl"), B);
  const fetchFn = fakeFetch({ [`${SOURCE}a.js`]: A });
  const r = await stagePyodide({ pins, dir, fetchFn });
  assert.deepEqual(r, { kept: ["b.whl"], downloaded: ["a.js"], removed: [] });
  assert.deepEqual(fetchFn.asked, [`${SOURCE}a.js`]);
  assert.deepEqual(readFileSync(join(dir, "a.js")), A);
});

test("a damaged local file with no good download fails, and isn't left to be published", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "a.js"), "edited in place");
  writeFileSync(join(dir, "b.whl"), B);
  await assert.rejects(stagePyodide({ pins, dir, fetchFn: fakeFetch({}) }), /could not download .*a\.js: .*404/);
  assert.equal(existsSync(join(dir, "a.js")), false);
});

test("files that aren't pinned are removed", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "a.js"), A);
  writeFileSync(join(dir, "b.whl"), B);
  writeFileSync(join(dir, "extra.js"), "not pinned");
  writeFileSync(join(dir, "b.whl.part"), "an interrupted run");
  const r = await stagePyodide({ pins, dir, fetchFn: noNetwork });
  assert.deepEqual(r.removed.sort(), ["b.whl.part", "extra.js"]);
  assert.deepEqual(readdirSync(dir).sort(), ["a.js", "b.whl"]);
});

test("a dropped connection is tried again", async () => {
  const dir = tempDir();
  let calls = 0;
  const flaky = async (url) => {
    if (++calls === 1) throw new TypeError("fetch failed");
    return new Response(url.endsWith("a.js") ? A : B);
  };
  const r = await stagePyodide({ pins, dir, fetchFn: flaky });
  assert.deepEqual(r.downloaded, ["a.js", "b.whl"]);
  assert.equal(calls, 3);
});

test("checkStaged names what's wrong with a published folder", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "a.js"), "changed after staging");
  writeFileSync(join(dir, "extra.js"), "x");
  const problems = checkStaged({ pins, dir });
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /extra\.js: not a pinned file/);
  assert.match(problems.join("\n"), /a\.js: SHA-256/);
  assert.match(problems.join("\n"), /b\.whl: missing/);
  assert.deepEqual(checkStaged({ pins, dir: join(dir, "nowhere") }).length, 1);
});

const upstream = readFileSync(join(ROOT, "solver", "gto", "static", "worker.js"), "utf8");

test("the upstream worker names the CDN, so the check below can fail", () => {
  assert.ok(hostsNamed(upstream).includes("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"));
});

test("the worker as Lizard publishes it names no third-party host", () => {
  assert.deepEqual(hostsNamed(editWorker(upstream)), []);
});

test("the published worker takes Pyodide from beside itself, at the pinned version's numpy", () => {
  const worker = editWorker(upstream);
  assert.match(worker, /^const PYODIDE = "pyodide\/";$/m);
  assert.match(worker, /caches\.open\("lizard:solver"\)/);
  const wheels = [...worker.matchAll(/PYODIDE \+ "([^"]+)"/g)].map((m) => m[1]);
  const pinned = readPins().files.map((f) => f.name);
  assert.ok(wheels.length >= 2);
  for (const name of wheels) assert.ok(pinned.includes(name), `${name} is not pinned`);
});

test("an upstream worker that moved an edit fails rather than publishing without it", () => {
  assert.throws(() => editWorker(upstream.replace("const PYODIDE =", "const RUNTIME =")), /expected exactly one/);
});

test("hostsNamed sees URLs in comments and strings, and leaves the worker's own paths alone", () => {
  assert.deepEqual(hostsNamed("// from https://evil.example/x.js\n"), ["https://evil.example/x.js"]);
  assert.deepEqual(hostsNamed('importScripts("//evil.example/x.js")'), ["//evil.example/"]);
  assert.deepEqual(hostsNamed('fetch("pyodide/numpy.whl"); // a comment.\n// gto/core.wasm'), []);
});

test("the pins name one version, one source and full hashes", () => {
  const { files, source, pyodide } = readPins();
  assert.ok(source.includes(`/v${pyodide}/`));
  assert.ok(source.endsWith("/"));
  assert.deepEqual(new Set(files.map((f) => f.name)).size, files.length);
  for (const f of files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
});
