/// <reference types="vitest/config" />
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
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:*",
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

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss(), csp()],
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
