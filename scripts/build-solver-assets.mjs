#!/usr/bin/env node
// Stage the upstream in-browser solver into web/public/solver/ (generated, gitignored):
//   worker.js   solver/gto/static/worker.js with its cache renamed (below); its protocol is web/src/solver/protocol.ts
//   solver.zip  every solver/gto/*.py + the wasm cores + treys, from solver/scripts/build_bundle.py (deterministic)
//   pf/*.bin    stored preflop solves the worker reads synchronously (siteFetch "pf/<key>.bin")
//   manifest.json  { version, upstream, builtAt, files }: version = sha1(worker.js + solver.zip)[:10], which the worker
//               needs (10 hex digits) to keep its bundle in the Cache API, and which busts caches on every change.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOLVER = join(ROOT, "solver");
const OUT = join(ROOT, "web", "public", "solver");

function python() {
  const venv = join(ROOT, ".venv", "bin", "python");
  if (process.env.PYTHON) return process.env.PYTHON;
  return existsSync(venv) ? venv : "python3";
}

function upstream() {
  // solver/UPSTREAM.json records which gto-solver commit the snapshot is
  const p = join(SOLVER, "UPSTREAM.json");
  if (!existsSync(p)) return { repo: "michaellhan/gto-solver", commit: "unknown", date: "" };
  const u = JSON.parse(readFileSync(p, "utf8"));
  return { repo: u.repo, commit: u.commit, date: u.date };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "pf"), { recursive: true });

// One build-time edit: the worker's Cache API name. The classic app on the same origin uses "gto-solver", and the
// worker evicts any other cached solver.zip when it stores its own, so the two apps would keep evicting each other.
const WORKER_SRC = readFileSync(join(SOLVER, "gto", "static", "worker.js"), "utf8");
const CACHE_OPEN = 'caches.open("gto-solver")';
if (WORKER_SRC.split(CACHE_OPEN).length !== 2) {
  throw new Error(`worker.js: expected exactly one ${CACHE_OPEN}; the upstream worker changed, update this edit`);
}
writeFileSync(join(OUT, "worker.js"), WORKER_SRC.replace(CACHE_OPEN, 'caches.open("lizard:solver")'));
const bundleSha = execFileSync(python(), [join(SOLVER, "scripts", "build_bundle.py"), join(OUT, "solver.zip")], {
  cwd: SOLVER,
  env: { ...process.env, PYTHONPATH: SOLVER },
  encoding: "utf8",
}).trim();

const pfDir = join(SOLVER, "gto", "static", "pf");
const pf = readdirSync(pfDir).filter((f) => f.endsWith(".bin"));
for (const f of pf) cpSync(join(pfDir, f), join(OUT, "pf", f));

const h = createHash("sha1");
h.update(readFileSync(join(OUT, "worker.js")));
h.update(readFileSync(join(OUT, "solver.zip")));
const version = h.digest("hex").slice(0, 10);

const manifest = {
  version,
  upstream: upstream(),
  bundleSha1: bundleSha,
  builtAt: new Date().toISOString(),
  files: ["worker.js", "solver.zip", ...pf.map((f) => `pf/${f}`)],
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`solver assets: version ${version}, upstream ${manifest.upstream.commit.slice(0, 8)}, ${pf.length} preflop files -> web/public/solver/`);
