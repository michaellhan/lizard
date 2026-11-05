// After `vite build`: make every app route loadable as a deep link on GitHub Pages, which serves files and has no
// rewrites. Each route gets its own <route>/index.html (a 200 response), and 404.html catches anything else
// (React Router then renders the not-found page). .nojekyll stops Pages from dropping underscore-prefixed files.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStaged } from "./pyodide/stage.mjs";
import { hostsNamed } from "./pyodide/worker-edits.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "web", "dist");
const index = join(dist, "index.html");
if (!existsSync(index)) {
  console.error("postbuild: web/dist/index.html missing; run the web build first");
  process.exit(1);
}

// What's about to be published runs nothing from anywhere else: the worker names no other host, and the Pyodide beside
// it is the pinned bytes. Checked here on web/dist, after everything that copies or edits these files.
const solverDist = join(dist, "solver");
const unpublishable = [
  ...hostsNamed(readFileSync(join(solverDist, "worker.js"), "utf8")).map((h) => `worker.js names ${h}`),
  ...checkStaged({ dir: join(solverDist, "pyodide") }),
];
if (unpublishable.length) {
  console.error(`postbuild: not publishing web/dist/solver:\n  ${unpublishable.join("\n  ")}`);
  process.exit(1);
}

// the route table is the source of truth; read its paths without compiling TypeScript
const routesTs = readFileSync(join(root, "web", "src", "app", "routes.ts"), "utf8");
const paths = [...routesTs.matchAll(/\{\s*path:\s*"([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
if (paths.length < 3) {
  console.error(`postbuild: found only ${paths.length} routes in routes.ts; the pattern needs updating`);
  process.exit(1);
}

const reserved = ["assets", "solver"]; // top-level asset folders (Vite's, and the solver bundle's)
const clash = paths.filter((p) => reserved.includes(p.split("/")[0]));
if (clash.length) {
  console.error(`postbuild: route(s) ${clash.join(", ")} would shadow an asset folder; rename the route`);
  process.exit(1);
}

for (const p of paths) {
  const dir = join(dist, p);
  mkdirSync(dir, { recursive: true });
  copyFileSync(index, join(dir, "index.html"));
}
copyFileSync(index, join(dist, "404.html"));
writeFileSync(join(dist, ".nojekyll"), "");
console.log(`postbuild: ${paths.length} route pages + 404.html (${paths.join(", ")})`);
