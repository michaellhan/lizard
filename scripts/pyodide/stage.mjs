#!/usr/bin/env node
// Serves Pyodide from Lizard's own origin: puts exactly the files in files.json into web/public/solver/pyodide/
// (generated, gitignored), each checked against its pinned SHA-256. A file already there and matching is kept, so a
// build needs no network once they're in place; one that's missing or wrong comes from jsDelivr, and nothing is written
// until its bytes match. Any other file in the folder is removed: what gets published is what's pinned, no more.
//
// To move to another Pyodide: change "pyodide" and "source" in files.json, then take the names, sizes and hashes from
// a fresh download (the wheel's hash is also in that version's pyodide-lock.json), and check the worker's numpy name.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FILES_JSON = join(HERE, "files.json");
export const PYODIDE_DIR = join(HERE, "..", "..", "web", "public", "solver", "pyodide");

const ATTEMPTS = 3;

export const readPins = (path = FILES_JSON) => JSON.parse(readFileSync(path, "utf8"));

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** what's wrong with these bytes for this pin, or null where they're the pinned file */
export function mismatch(bytes, pin) {
  const got = sha256(bytes);
  return got === pin.sha256 ? null : `${pin.name}: SHA-256 ${got} (${bytes.length} bytes), pinned ${pin.sha256} (${pin.bytes} bytes)`;
}

async function download(url, fetchFn) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastError = e; // (a dropped connection; wrong bytes aren't retried, they fail the build in stagePyodide)
    }
  }
  throw new Error(`could not download ${url}: ${lastError.message}`);
}

/**
 * Makes `dir` hold exactly the pinned files. Throws, leaving no unverified file in `dir`, on a download that fails or
 * doesn't match its pin.
 * @returns {{kept: string[], downloaded: string[], removed: string[]}}
 */
export async function stagePyodide({ pins = readPins(), dir = PYODIDE_DIR, fetchFn = fetch } = {}) {
  mkdirSync(dir, { recursive: true });
  const names = new Set(pins.files.map((f) => f.name));
  const removed = readdirSync(dir).filter((f) => !names.has(f));
  for (const f of removed) rmSync(join(dir, f), { recursive: true, force: true });

  const kept = [], downloaded = [];
  for (const pin of pins.files) {
    const path = join(dir, pin.name);
    if (existsSync(path)) {
      if (!mismatch(readFileSync(path), pin)) {
        kept.push(pin.name);
        continue;
      }
      rmSync(path);
    }
    const bytes = await download(pins.source + pin.name, fetchFn);
    const wrong = mismatch(bytes, pin);
    if (wrong) throw new Error(`downloaded file doesn't match its pin (scripts/pyodide/files.json): ${wrong}`);
    writeFileSync(`${path}.part`, bytes);
    renameSync(`${path}.part`, path);
    downloaded.push(pin.name);
  }
  return { kept, downloaded, removed };
}

/** Re-reads `dir` (web/dist/solver/pyodide after a build, say): the problems found, none where it's exactly the pins. */
export function checkStaged({ pins = readPins(), dir = PYODIDE_DIR } = {}) {
  if (!existsSync(dir)) return [`${dir} is missing`];
  const names = new Set(pins.files.map((f) => f.name));
  const problems = readdirSync(dir).filter((f) => !names.has(f)).map((f) => `${f}: not a pinned file`);
  for (const pin of pins.files) {
    const path = join(dir, pin.name);
    const wrong = existsSync(path) ? mismatch(readFileSync(path), pin) : `${pin.name}: missing`;
    if (wrong) problems.push(wrong);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { kept, downloaded, removed } = await stagePyodide();
  console.log(`pyodide: ${kept.length} verified in place, ${downloaded.length} downloaded and verified, ${removed.length} removed`);
}
