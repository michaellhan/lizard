#!/usr/bin/env node
// Stage the upstream in-browser solver into web/public/solver/ (generated, gitignored):
//   worker.js   solver/gto/static/worker.js with Lizard's declared edits (pyodide/worker-edits.mjs); its protocol is
//               web/src/solver/protocol.ts
//   solver.zip  every solver/gto/*.py + the wasm cores + treys, from solver/scripts/build_bundle.py (deterministic)
//   pf/*.bin    stored preflop solves the worker reads synchronously (siteFetch "pf/<key>.bin")
//   pyodide/*   the Python runtime and numpy, each checked against its pinned SHA-256 (pyodide/stage.mjs); kept across
//               runs, so only the first needs the network
//   manifest.json  { version, upstream, pyodide, builtAt, files }: version = sha1(worker.js + solver.zip + the pins)[:10],
//               which the worker needs (10 hex digits) to keep its bundle in the Cache API, and which busts caches on
//               every change (its cached bytecode is for one Python).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FILES_JSON, readPins, stagePyodide } from "./pyodide/stage.mjs";
import { editWorker } from "./pyodide/worker-edits.mjs";

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

// (everything but pyodide/, which stagePyodide keeps to exactly the pinned files)
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f !== "pyodide") rmSync(join(OUT, f), { recursive: true, force: true });
mkdirSync(join(OUT, "pf"), { recursive: true });

writeFileSync(join(OUT, "worker.js"), editWorker(readFileSync(join(SOLVER, "gto", "static", "worker.js"), "utf8")));
const pins = readPins();
const staged = await stagePyodide({ pins });
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
h.update(readFileSync(FILES_JSON));
const version = h.digest("hex").slice(0, 10);

const manifest = {
  version,
  upstream: upstream(),
  bundleSha1: bundleSha,
  // served from this origin, from these bytes; the source is only where the build got them
  pyodide: { version: pins.pyodide, path: "pyodide/", downloadedFrom: pins.source, pinned: "scripts/pyodide/files.json" },
  builtAt: new Date().toISOString(),
  files: ["worker.js", "solver.zip", ...pf.map((f) => `pf/${f}`), ...pins.files.map((f) => `pyodide/${f.name}`)],
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`solver assets: version ${version}, upstream ${manifest.upstream.commit.slice(0, 8)}, ${pf.length} preflop files, Pyodide ${pins.pyodide} (${staged.kept.length} verified, ${staged.downloaded.length} downloaded) -> web/public/solver/`);
