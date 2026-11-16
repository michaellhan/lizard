/// <reference types="vitest/config" />
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Lizard is served from a sub-path of www.michael-han.com (GitHub Pages project site). Every asset URL,
// the router's basename, the service worker's scope and the solver worker's URL derive from this base.
const BASE = process.env.LIZARD_BASE ?? "/lizard/";

// Content-Security-Policy for the built pages (not dev: Vite's dev client injects inline scripts). Everything is
// same-origin except the optional local Python solver, and the solver worker's Pyodide is same-origin too
// (solver/pyodide/, scripts/pyodide/stage.mjs). This policy doesn't reach that worker, whose script has its own (none):
// a <meta> tag binds only its page. frame-ancestors can't be set by <meta>; public/sw.js sends it as a header.
// PostHog pageviews (index.html's /ph.js, michael-han.com's shared analytics script) load PostHog's script from
// us-assets.i.posthog.com and send to us.i.posthog.com: those two hosts only.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://us-assets.i.posthog.com",
  "worker-src 'self' blob:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* https://us.i.posthog.com https://us-assets.i.posthog.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function csp(): Plugin {
  return {
    name: "lizard-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// The dev server's solver files (public/solver/, from scripts/build-solver-assets.mjs). They're built at start, as the
// root `npm run dev` does (well under a second), so a dev server started in web/ alone never serves files from before
// the engine's last change. A missing one is a 404 here as on the site: Vite's fallback would answer it with the app's
// page, which the worker read as the file (a stored preflop solve "isn't this tree's").
function solverFiles(): Plugin {
  const pub = fileURLToPath(new URL("./public/", import.meta.url));
  const pf = fileURLToPath(new URL("../engine/pf/", import.meta.url));
  return {
    name: "lizard-solver-files",
    apply: "serve",
    configureServer(server) {
      // (not under Vitest, which starts a Vite server of its own and serves no solver files)
      if (process.env.VITEST) return;
      try {
        execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/build-solver-assets.mjs", import.meta.url))], { stdio: "pipe", timeout: 120_000 });
      } catch (e) {
        server.config.logger.warn(`lizard: building the solver files failed (${e instanceof Error ? e.message.split("\n")[0] : e})`);
      }
      try {
        const stale = readdirSync(pf).filter((f) => f.endsWith(".bin") && (!existsSync(`${pub}solver/pf/${f}`) || statSync(`${pub}solver/pf/${f}`).size !== statSync(pf + f).size));
        if (stale.length) server.config.logger.warn(`lizard: ${stale.length} stored preflop solves in engine/pf/ aren't in web/public/solver/pf/ as they are (e.g. ${stale[0]}): run \`npm run solver:assets\` at the repo root`);
      } catch {
        // (no engine/pf/ beside this checkout: nothing to compare)
      }
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? "").split("?")[0]!);
        if (!path.startsWith(`${BASE}solver/`) || existsSync(pub + path.slice(BASE.length))) return next();
        res.statusCode = 404;
        res.end("Not found");
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss(), csp(), solverFiles()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    // (none: a map would publish the app's source, and the repo is private)
    sourcemap: false,
    target: "es2022",
  },
  server: {
    // The solver's threaded wasm core needs SharedArrayBuffer, i.e. a cross-origin isolated page. In production
    // public/sw.js adds these headers (GitHub Pages cannot); the dev server sends them directly.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      // The precomputed library is served from the same origin in production (/gto-solver-library/); in dev it
      // is proxied so requests stay same-origin and COEP-compatible.
      "/gto-solver-library": {
        target: "https://www.michael-han.com",
        changeOrigin: true,
      },
      "/lizard-library": {
        target: "https://www.michael-han.com",
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Twenty seconds, with five for a screen to appear in setup.ts: on a machine busy with builds a page's long test
    // took 7 s and a screen over the 1 s default. Only a failing test waits this long.
    testTimeout: 20_000,
  },
});
