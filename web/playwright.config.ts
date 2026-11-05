// Browser tests on the built site (ROADMAP Testing; IMPLEMENTATION_PLAN section 5): every route at three widths, and
// the flows a page test can't reach, on the real worker. `npm run test:e2e` needs a build (`npm run build`) first, and
// while the precompute builds run it goes through the slot (CLAUDE.md). One worker: each page boots a solver.
import { defineConfig } from "@playwright/test";

const PORT = 4176;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts", // (not *.spec.ts, which Vitest would take for its own)
  outputDir: "e2e-results",
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: "block", // (vite preview sends the isolation headers public/sw.js adds on GitHub Pages)
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 1024, height: 768 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/lizard/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
