// What Lizard changes in solver/gto/static/worker.js as it publishes it. The file in solver/ stays as upstream has it;
// each edit is declared in solver/UPSTREAM.json. Every "from" must appear exactly once, so an upstream change that
// moves one fails the build here rather than publishing a worker with the edit silently missing.
const EDITS = [
  {
    // The classic app on the same origin uses "gto-solver", and the worker evicts any other cached solver.zip when it
    // stores its own, so the two apps would keep evicting each other.
    from: 'caches.open("gto-solver")',
    to: 'caches.open("lizard:solver")',
  },
  {
    // Pyodide from Lizard's own origin (scripts/pyodide/stage.mjs): relative, like the worker's solver.zip, so it
    // follows the worker's URL under any base. importScripts takes no integrity, so a CDN could run anything here,
    // in the origin that holds the user's hand histories.
    from: 'const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";',
    to: 'const PYODIDE = "pyodide/";',
  },
  {
    // (the comment on the numpy prefetch, which said where the files came from)
    from: "the HTTP cache (jsdelivr caches versioned files for a year) rather than",
    to: "the HTTP cache rather than",
  },
];

export function editWorker(source) {
  let out = source;
  for (const { from, to } of EDITS) {
    if (out.split(from).length !== 2) {
      throw new Error(`worker.js: expected exactly one ${from}; the upstream worker changed, update scripts/pyodide/worker-edits.mjs`);
    }
    out = out.replace(from, () => to);
  }
  return out;
}

/** Every third-party host a published worker names, in code or comments: any absolute URL, and the CDN by name. */
export function hostsNamed(worker) {
  const urls = [...worker.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`)]*|(?<![:/\w])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\//gi)].map((m) => m[0]);
  const cdn = [...worker.matchAll(/jsdelivr|unpkg|cdnjs/gi)].map((m) => m[0]);
  return [...urls, ...cdn];
}
