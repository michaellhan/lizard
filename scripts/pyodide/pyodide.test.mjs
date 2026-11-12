// `npm run test:scripts`. No network: downloads go to a fake fetch, on small fake files.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

test("the published worker sends a node lock to engine/, before the advice and inside the cancel's try", () => {
  const worker = editWorker(upstream);
  const body = worker.slice(worker.indexOf('"def answer(st, pl):'), worker.indexOf('"def early(st):'));
  const at = (s) => {
    assert.ok(body.includes(s), `answer() has no ${s}`);
    return body.indexOf(s);
  };
  assert.ok(at("    try:") < at("if st.get('nodelock') and not pl:"));
  assert.ok(at("if st.get('nodelock') and not pl:") < at("from engine.study_lock import answer as locked"));
  assert.ok(at("from engine.study_lock import answer as locked") < at("adv.advise(st)"));
  assert.ok(at("adv.advise(st)") < at("except Cancelled:"));
  assert.match(worker, /py\.globals\.set\("post_partial", \(s\) => postMessage\(\{ id: CUR, partial: JSON\.parse\(s\) \}\)\);/);
});

test("the published worker sends the preflop solve to engine/pf_solve.py, a tournament's to the advice", () => {
  const worker = editWorker(upstream);
  const body = worker.slice(worker.indexOf('"def answer(st, pl):'), worker.indexOf('"def early(st):'));
  const at = (s) => {
    assert.ok(body.includes(s), `answer() has no ${s}`);
    return body.indexOf(s);
  };
  const gate = "if st.get('study') and st.get('preflop_solve') and not pl and not str(st.get('board') or '') and not st.get('payouts') and not st.get('bounties'):";
  assert.ok(at("    try:") < at(gate));
  assert.ok(at(gate) < at("from engine.pf_solve import answer as pf_answer"));
  assert.ok(at("return json.dumps(pf_answer(adv, st))") < at("if st.get('nodelock') and not pl:"));
  assert.ok(at("adv.advise(st)") < at("except Cancelled:"));
});

test("the published worker sends an opponent's move with a read to engine/, and one without it to Advisor.play", () => {
  const worker = editWorker(upstream);
  const body = worker.slice(worker.indexOf('"def answer(st, pl):'), worker.indexOf('"def early(st):'));
  const at = (s) => {
    assert.ok(body.includes(s), `answer() has no ${s}`);
    return body.indexOf(s);
  };
  assert.ok(at("    try:") < at("if pl and st.get('locks'):"));
  assert.ok(at("if pl and st.get('locks'):") < at("from engine.exploit_play import play as read_play"));
  assert.ok(at("read_play(adv, st, pl['seat'], pl['hole'], pl.get('seed'))") < at("adv.play(st, pl['seat']"));
  assert.ok(at("adv.play(st, pl['seat']") < at("except Cancelled:"));
});

test("the published worker imports Lizard's engine patches at start, before the Advisor it patches", () => {
  const worker = editWorker(upstream);
  const line = worker.split("\n").find((l) => l.includes("from gto.advisor import Advisor;"));
  assert.ok(line, "no Advisor import");
  const at = (s) => {
    assert.ok(line.includes(s), `the start-up line has no ${s}`);
    return line.indexOf(s);
  };
  assert.ok(at("sys.path.insert(0, '/app');") < at("import engine.pf_stored;"));
  assert.ok(at("import engine.pf_stored;") < at("import engine.tree_depth;"));
  assert.ok(at("import engine.tree_depth;") < at("from gto.advisor import Advisor;"));
});

test("hostsNamed sees URLs in comments and strings, and leaves the worker's own paths alone", () => {
  assert.deepEqual(hostsNamed("// from https://evil.example/x.js\n"), ["https://evil.example/x.js"]);
  assert.deepEqual(hostsNamed('importScripts("//evil.example/x.js")'), ["//evil.example/"]);
  assert.deepEqual(hostsNamed('fetch("pyodide/numpy.whl"); // a comment.\n// gto/core.wasm'), []);
});

const venv = join(ROOT, ".venv", "bin", "python");
const python = process.env.PYTHON ?? (existsSync(venv) ? venv : "python3");

/** bundle_engine.py on a copy of a small zip and an engine folder of these sources; (sha1, the zip's bytes) */
function appended(sources) {
  const dir = tempDir();
  const zip = join(dir, "solver.zip");
  const made = spawnSync(python, ["-c", `import zipfile\nz=zipfile.ZipFile(${JSON.stringify(zip)},'w');z.writestr(zipfile.ZipInfo('gto/a.py',(2020,1,1,0,0,0)),'x=1\\n');z.close()`]);
  assert.equal(made.status, 0, String(made.stderr));
  const engine = join(dir, "engine");
  mkdirSync(engine);
  for (const [name, text] of Object.entries(sources)) writeFileSync(join(engine, name), text);
  const run = spawnSync(python, [join(ROOT, "scripts", "pyodide", "bundle_engine.py"), zip, engine], { encoding: "utf8" });
  return { status: run.status, err: run.stderr, sha: run.stdout.trim(), bytes: readFileSync(zip) };
}

test("engine/ goes into the bundle the same way twice, and a change in it is a new bundle", () => {
  const sources = { "__init__.py": "", "study_lock.py": "x = 1\n", "nodelock.py": "y = 2\n" };
  const a = appended(sources);
  const b = appended(sources);
  assert.equal(a.status, 0, a.err);
  assert.match(a.sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.sha, createHash("sha1").update(a.bytes).digest("hex"));
  assert.ok(a.bytes.includes("engine/nodelock.py"));
  assert.ok(a.bytes.includes("gto/a.py"));
  assert.notEqual(appended({ ...sources, "nodelock.py": "y = 3\n" }).sha, a.sha);
});

test("an engine folder nothing could import fails the build", () => {
  assert.notEqual(appended({ "study_lock.py": "x = 1\n" }).status, 0);
});

test("the bundle's version is hashed after engine/ goes in", () => {
  const build = readFileSync(join(ROOT, "scripts", "build-solver-assets.mjs"), "utf8");
  const appendAt = build.indexOf('"bundle_engine.py"');
  assert.ok(appendAt > 0);
  assert.ok(build.indexOf('"build_bundle.py"') < appendAt);
  assert.ok(appendAt < build.indexOf('h.update(readFileSync(join(OUT, "solver.zip")))'));
});

test("the pins name one version, one source and full hashes", () => {
  const { files, source, pyodide } = readPins();
  assert.ok(source.includes(`/v${pyodide}/`));
  assert.ok(source.endsWith("/"));
  assert.deepEqual(new Set(files.map((f) => f.name)).size, files.length);
  for (const f of files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
});
