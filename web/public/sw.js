// Lizard's service worker: makes its pages cross-origin isolated, which the solver's threads need
// (SharedArrayBuffer: the worker's core-mt.wasm and its helpers) and which takes two response headers GitHub Pages
// can't send. It adds them to this app's own navigations and worker scripts as they come from the network; every
// other request goes to the network untouched (Pyodide from jsdelivr and the same-origin library are COEP-safe).
// Adapted from gto-solver's gto/static/sw.js. Its scope is the folder it is served from (/lizard/).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.mode !== "navigate" && r.destination !== "worker") return;
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r).then((res) => {
      if (res.status === 0) return res; // (an opaque redirect: as it came)
      const h = new Headers(res.headers);
      h.set("Cross-Origin-Opener-Policy", "same-origin");
      h.set("Cross-Origin-Embedder-Policy", "require-corp");
      if (r.mode === "navigate") {
        // (what a <meta> policy can't say: no framing by other sites)
        h.set("Content-Security-Policy", "frame-ancestors 'self'");
        h.set("X-Content-Type-Options", "nosniff");
      }
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }),
  );
});
