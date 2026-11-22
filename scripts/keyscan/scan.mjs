// The build's secret check (docs/ROADMAP.md Phase 12): nothing published may hold anything shaped like an API key, or the
// marks of a page calling Anthropic straight from the browser (its key header, the classic app's stored key). AI
// explanations go through Lizard's proxy (explain-worker/), whose key is a Worker secret and never in the site.
// postbuild.mjs runs scanDir on web/dist and refuses to publish on a match.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

/** What a key, or a direct browser call to Anthropic, looks like. */
export const PATTERNS = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: "OpenAI-style secret key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "the classic app's stored Anthropic key", re: /gto-anthropic-key/ },
  { name: "a direct browser call to Anthropic", re: /anthropic-dangerous-direct-browser-access/i },
];

/** The text files a page can load. Binaries (wasm, images, fonts, the library's packed files) can't carry a usable key. */
const TEXT = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".json", ".map", ".txt", ".webmanifest", ".svg", ".xml", ".py"]);
const MAX_FILE = 32 * 1024 * 1024;

/** Each pattern `text` matches, by name. */
export const keysIn = (text) => PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);

/** Every match under `dir`, as "path: what". */
export function scanDir(dir) {
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (TEXT.has(extname(name).toLowerCase()) && s.size <= MAX_FILE) for (const what of keysIn(readFileSync(p, "utf8"))) found.push(`${relative(dir, p)}: ${what}`);
    }
  };
  walk(dir);
  return found;
}
