// The hand-history parser's golden files (web/src/hh/golden/): what the classic importer
// (solver/gto/static/hh.js parseHandHistory) makes of every fixture in solver/tests/data/hh and of the synthetic
// sessions the classic analyzer tests use (solver/tests/js/hh_synth.js). Run once from the repository root, after
// the snapshot's hh.js changes: node scripts/hh/make_golden.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..", "..");
const { parseHandHistory, splitHands } = require(join(root, "solver", "gto", "static", "hh.js"));
const { synthSession } = require(join(root, "solver", "tests", "js", "hh_synth.js"));
const dir = join(root, "solver", "tests", "data", "hh");
const out = join(root, "web", "src", "hh", "golden");
mkdirSync(out, { recursive: true });

const parsed = (text) => {
  try {
    return { hand: parseHandHistory(text) };
  } catch (e) {
    return { error: e.message };
  }
};
for (const f of readdirSync(dir).sort()) {
  const name = f.replace(/\.\w+$/, "");
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ fixture: f, ...parsed(readFileSync(join(dir, f), "utf8")) }, null, 1) + "\n");
}
// the sessions as the analyzer imports them: one text per hand
for (const [n, seed] of [[60, 3], [50, 11]]) {
  const hands = splitHands(synthSession(n, seed)).map(parsed);
  writeFileSync(join(out, `synth_${n}_${seed}.json`), "[\n" + hands.map((h) => JSON.stringify(h)).join(",\n") + "\n]\n");
}
