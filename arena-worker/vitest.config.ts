// The Worker's tests run on Node: "cloudflare:workers" is a stand-in (src/test/cloudflare-workers.ts) and the Durable
// Objects get a stand-in state, storage and sockets (src/test/fakes.ts). "@/" is web/src, for the shared rules and
// Analyze's importer, which the history test reads its histories back with.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("../web/src/", import.meta.url)),
      "cloudflare:workers": fileURLToPath(new URL("./src/test/cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
