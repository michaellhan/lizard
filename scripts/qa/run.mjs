#!/usr/bin/env node
// The Practice QA sweep, from one command (docs/QA.md):
//   node scripts/qa/run.mjs --quick      about 3-5 minutes: 4 configs, 26 Fast references and 2 Accurate
//   node scripts/qa/run.mjs              the default matrix, about 20 minutes on this Mac (18 measured)
// Options: --seed N (default 1), --hands N (every config), --only TEXT (configs whose name has it), --config NAME (the
// config of exactly that name), --hand N[,M...] (only those hands of each config: each hand deals and draws from its own
// seed, so a hand replays alone; a replay of a summary's example), --out DIR, --explore X (share of your moves taken off
// the mix, default 0.12). Env: QA_LIBRARY (the flop library, read only),
// QA_PYTHON, QA_SLOT (the CPU slot wrapper the advisors run under; empty to run them directly), QA_THREADS (native solver
// threads per advisor, default 2), QA_CACHE_MB (the solve cache, default 150), QA_RSS_CAP_MB (an advisor restarts past
// it, default 900), QA_DROP_PF (0 keeps the stored preflop solves read, as the worker does; default 1 drops them after
// each request). Writes qa-out/<profile>-<time>/{decisions.jsonl,summary.json,summary.md}; exits 1 where a hard
// invariant failed, 2 on a harness error.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
if (flag("--help") || flag("-h")) {
  console.log("usage: node scripts/qa/run.mjs [--quick] [--seed N] [--hands N] [--only TEXT] [--config NAME] [--hand N[,M...]] [--out DIR] [--explore X]\n       node scripts/qa/run.mjs --pf-agree [--only TEXT] [--out DIR]");
  process.exit(0);
}

// (jiti runs the TypeScript with the web app's @/ alias; it comes with the dev tools, eslint and vite)
let createJiti;
try {
  const req = createRequire(resolve(ROOT, "package.json"));
  ({ createJiti } = await import(pathToFileURL(req.resolve("jiti")).href));
} catch (e) {
  console.error(`The sweep needs jiti (installed with the dev dependencies: npm install): ${e}`);
  process.exit(2);
}
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(ROOT, "web/src") }, jsx: true, fsCache: false, moduleCache: true, interopDefault: true });

try {
  if (flag("--pf-agree")) {
    // (the chart against the preflop solve at every hand class of a set of spots: pfagree.ts; about 3 minutes)
    const { pfAgree, pfAgreeMarkdown, PF_SPOTS } = await jiti.import(resolve(HERE, "pfagree.ts"));
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const out = resolve(ROOT, opt("--out", `qa-out/pfagree-${stamp}`));
    const only = opt("--only", "");
    const rows = await pfAgree({ spots: PF_SPOTS.filter((s) => !only || s.name.includes(only)), out, log: (x) => process.stderr.write(x) });
    const { writeFileSync } = await import("node:fs");
    const md = pfAgreeMarkdown(rows);
    writeFileSync(resolve(out, "pfagree.md"), md);
    process.stdout.write(md);
    console.log(`\nWritten to ${out}`);
    process.exit(rows.some((r) => r.hard) ? 1 : 0);
  }
  const { QUICK, MATRIX, REFS } = await jiti.import(resolve(HERE, "matrix.ts"));
  const { sweep } = await jiti.import(resolve(HERE, "sweep.ts"));
  const quick = flag("--quick");
  const only = opt("--only", "");
  const exact = opt("--config", "");
  const hands = opt("--hands", "");
  const hand = opt("--hand", "");
  // (--config looks in both profiles, so a --quick example replays without --quick)
  let configs = exact ? [...MATRIX, ...QUICK].filter((c, i, all) => c.name === exact && all.findIndex((x) => x.name === c.name) === i) : (quick ? QUICK : MATRIX).filter((c) => !only || c.name.includes(only));
  if (hands) configs = configs.map((c) => ({ ...c, hands: Number(hands) }));
  if (!configs.length) throw new Error(`no config matches "${exact || only}"`);
  const onlyHands = hand ? hand.split(",").map((x) => Number(x.trim())) : undefined;
  if (onlyHands && onlyHands.some((x) => !Number.isInteger(x) || x < 0)) throw new Error(`--hand takes hand numbers: "${hand}"`);
  const label = exact || hand ? "replay" : quick ? "quick" : "matrix";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const out = resolve(ROOT, opt("--out", `qa-out/${label}-${stamp}`));
  const s = await sweep({
    configs,
    // (a replay asks every postflop decision of its hands again at Fast, so a Quick-against-Fast example replays too)
    refs: onlyHands ? REFS.replay : quick ? REFS.quick : REFS.full,
    seed: Number(opt("--seed", "1")),
    explore: Number(opt("--explore", "0.12")),
    onlyHands,
    out,
    label,
    log: (x) => process.stderr.write(x),
  });
  const { readFileSync } = await import("node:fs");
  process.stdout.write(readFileSync(resolve(out, "summary.md"), "utf8"));
  console.log(`\nWritten to ${out}`);
  process.exit(s.hard > 0 ? 1 : 0);
} catch (e) {
  console.error(e?.stack ?? String(e));
  process.exit(2);
}
