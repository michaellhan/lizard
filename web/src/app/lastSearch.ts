// Each page's last address, so a page reached from the bar, its section's tabs or the home page opens as you left it.
// Most pages keep their setup in the URL's search (Study's table and line, Reports' spot and filters, Analyze's filters,
// Practice's Drills tab), which a reload and Back keep; the bar's links were bare paths, so reaching a page from them
// opened its defaults (Study at 6-max, 100bb). Kept in this browser by the page's path, on every change of the search.
export const LAST_SEARCH_KEY = "lizard.lastSearch.v1";

// (one-shot params a page acts on once and takes off the address: a scenario or setup link starts a session, and
// mustn't again from the bar)
// (Practice's are setupLink.ts SETUP_PARAMS, written out so the bar doesn't load Practice's code; a test holds them equal)
export const ONCE: Record<string, readonly string[]> = { practice: ["scenario", "play", "seat", "players", "stack", "hand"] };

function read(): Record<string, string> {
  try {
    const x = JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) ?? "{}") as unknown;
    return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The search to keep for `path` (a route's path, no slashes): "" where it holds nothing to keep. */
export function keptSearch(path: string, search: string): string {
  const q = new URLSearchParams(search);
  // (a setup link is one only with its `play`: without it, Drills' own `hand` filter is kept)
  if (path !== "practice" || q.has("play")) for (const k of ONCE[path] ?? []) q.delete(k);
  else q.delete("scenario");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Note the page at `pathname` (as the router has it) with this search. */
export function rememberSearch(pathname: string, search: string): void {
  const path = pathname.split("/").filter(Boolean).join("/");
  if (!path) return;
  const all = read();
  const s = keptSearch(path, search);
  if ((all[path] ?? "") === s) return;
  if (s) all[path] = s;
  else delete all[path];
  try {
    localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(all));
  } catch {
    // (a browser that won't store it opens pages at their defaults)
  }
}

/** Where a link to the page at `path` goes: the path with its last search. */
export function pageLink(path: string): string {
  const s = read()[path] ?? "";
  return `/${path}${s.startsWith("?") ? s : ""}`;
}
