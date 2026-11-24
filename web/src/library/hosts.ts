// Where a library file is served from. What GitHub Pages can't hold (900 MiB, 120k files) goes to an R2 bucket a whole
// spot directory ("set") at a time: scripts/library/assemble.py assign_hosts writes hosts.json beside index.json,
// {"format": 1, "hosts": {name: https base}, "sets": {spot id: name}}, and marks each moved spot's index entry `host`.
// The index files themselves (and hosts.json) always come from the library's own base. The solver worker reads the
// same file (scripts/pyodide/worker-edits.mjs).
import { LIBRARY_HOST_ORIGINS } from "@/config";

/** spot id -> the base its files are served from (an https URL ending in "/") */
export type LibraryHosts = ReadonlyMap<string, string>;

export const NO_HOSTS: LibraryHosts = new Map();

/** hosts.json read: each set whose host is an https base on an allowed origin (the page's CSP connect-src lists the
 * same origins, vite.config.ts). A set naming another host, or a file of another format, is left to the library's
 * own base (where it 404s if it moved: an error, never another site's file). */
export function parseHosts(raw: unknown, allowed: readonly string[] = LIBRARY_HOST_ORIGINS): LibraryHosts {
  const out = new Map<string, string>();
  if (!raw || typeof raw !== "object") return out;
  const h = raw as { format?: unknown; hosts?: unknown; sets?: unknown };
  if (h.format !== 1 || !h.hosts || typeof h.hosts !== "object" || !h.sets || typeof h.sets !== "object") return out;
  const hosts = h.hosts as Record<string, unknown>;
  for (const [set, name] of Object.entries(h.sets as Record<string, unknown>)) {
    if (typeof name !== "string" || !Object.hasOwn(hosts, name)) continue;
    const base = hosts[name];
    if (typeof base !== "string" || !/^https:\/\/[^/?#]+\/[^?#]*$/.test(base) || !base.endsWith("/")) continue;
    if (!allowed.includes(new URL(base).origin)) continue;
    out.set(set, base);
  }
  return out;
}

/** a library path's URL: a spot's file from its set's host, everything else (the root files) from `base` */
export function hostedUrl(base: string, hosts: LibraryHosts, path: string): string {
  const i = path.indexOf("/");
  return (i > 0 ? (hosts.get(path.slice(0, i)) ?? base) : base) + path;
}

/** <base>hosts.json, read (none where the library has no file there: everything is served from `base`) */
export async function loadHosts(base: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<LibraryHosts> {
  try {
    const r = await fetchImpl(base + "hosts.json", { cache: "no-cache" });
    return r.ok ? parseHosts(await r.json()) : NO_HOSTS;
  } catch {
    return NO_HOSTS;
  }
}
