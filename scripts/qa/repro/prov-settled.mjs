// Deterministic repro of the sweep's prov.settled (docs/QA.md): a live answer whose ranges come from the rules (an opponent's rare
// line not solved again, the seat's range widened) still gets band "converged" beside its approximate label. Run from the
// repository root: node scripts/qa/repro/prov-settled.mjs
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2] ?? process.cwd();
const req = createRequire(resolve(ROOT, "web/package.json"));
const { createJiti } = await import(pathToFileURL(req.resolve("jiti")).href);
const jiti = createJiti(pathToFileURL(resolve(ROOT, "x.mjs")).href, { alias: { "@": resolve(ROOT, "web/src") }, interopDefault: true });
const P = await jiti.import("@/solver/provenance");
const r = {
  street: "turn",
  solver: { iterations: 400, exploitability_pct: 0.04 },
  off_solution: [{ why: "rare", pos: "BB", action: "raise to 14", street: "turn", share: 5.9, resolved: false }],
  widened: ["BB"],
};
const p = P.provenanceOf(r, { mode: "quick", transport: "worker", solverVersion: "x", partial: false });
console.log(JSON.stringify({ source: p.source, approximate: p.approximate, leansOnRules: p.leansOnRules, band: p.band, rangesOff: p.rangesOff }, null, 1));
console.log("badge:", P.describe(p));
