// The precomputed-library catalog: reads a library's index.json / mw_index.json (format 2 / 1, written by
// solver/scripts/build_flop_library.py and build_mw_library.py) to report which spots and flops are answered
// instantly. Coverage is read at runtime with no-cache, so entries published later (the heads-up builds still
// running) are picked up without a redeploy; anything missing is solved live by the worker. How many flops each
// spot is planned to reach comes from lizard-library.json, which scripts/library/assemble.py writes from the
// solver's SPOT_FLOPS; a library without it (the upstream one) shows counts only.
import { LIBRARY_SOURCES, type LibrarySourceId } from "@/config";
import { libraryStamps, type LibraryStamp } from "./version";

export interface LibrarySpotIndex {
  id: string;
  label: string;
  /** preflop line, e.g. "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c" */
  line: string;
  seats: string[];
  /** the ranges' fingerprints (ranges.json's `fp`) */
  fp?: string[];
  pot: number;
  stack: number;
  /** flop -> sha1(entry)[:10] */
  flops: Record<string, string>;
  /** the flops with a turn file (<flop>.turn.bin): all of them, or these */
  turns?: boolean | string[];
  /** format spots (other depths / heads-up): the game they belong to */
  game?: { players: number; stack: number; ante: number; straddle: boolean };
  tree?: unknown;
  /** sha1(report.json)[:10] */
  report?: string;
}

/** the flops of a spot with a stored turn file */
export const storedTurnFlops = (s: Pick<LibrarySpotIndex, "turns" | "flops">): string[] =>
  s.turns === true ? Object.keys(s.flops) : Array.isArray(s.turns) ? s.turns.filter((f) => Object.hasOwn(s.flops, f)) : [];

/** A spot Practice's drills can deal: two players, with its report and a stored flop. */
export const isDrillable = (s: LibrarySpotIndex) => s.seats.length === 2 && Boolean(s.report) && Object.keys(s.flops ?? {}).length > 0;

export interface LibraryIndex {
  format: number;
  tree: unknown;
  spots: LibrarySpotIndex[];
}

export interface SpotCoverage {
  id: string;
  label: string;
  kind: "srp" | "3bp" | "limped" | "multiway" | "other";
  /** players in the pot at the flop */
  inPot: number;
  /** the game the spot belongs to (table size and depth) */
  tablePlayers: number;
  tableStack: number;
  /** preflop line, as Study's URL takes it */
  line: string;
  flops: number;
  /** the flop count the spot is being built to, when the library says; null when unknown */
  target: number | null;
  storedTurns: boolean;
  game: string;
}

/** lizard-library.json: what a Lizard library publish contained (only the fields read here). */
export interface LibraryPlan {
  spots?: Record<string, { flops: number; target?: number | null }>;
}

export interface LibraryCatalog {
  source: LibrarySourceId;
  base: string;
  available: boolean;
  spots: SpotCoverage[];
  fetchedAt: number;
  error?: string;
}

function kindOf(id: string): SpotCoverage["kind"] {
  if (id.startsWith("srp_")) return "srp";
  if (id.startsWith("3bp_")) return "3bp";
  if (id.startsWith("lp_")) return "limped";
  if (id.startsWith("mw_")) return "multiway";
  return "other";
}

export function gameLabel(s: Pick<LibrarySpotIndex, "game" | "seats">): string {
  const g = s.game;
  if (!g) return "6-max 100bb";
  const players = g.players === 2 ? "Heads-up" : `${g.players}-max`;
  return `${players} ${g.stack}bb${g.ante ? ` ante ${g.ante}` : ""}${g.straddle ? " straddle" : ""}`;
}

export function summarize(index: LibraryIndex, mw?: LibraryIndex | null, plan?: LibraryPlan | null): SpotCoverage[] {
  const rows: SpotCoverage[] = [];
  for (const s of [...index.spots, ...(mw?.spots ?? [])]) {
    const n = Object.keys(s.flops ?? {}).length;
    rows.push({
      id: s.id,
      label: s.label,
      kind: kindOf(s.id),
      inPot: s.seats.length,
      tablePlayers: s.game?.players ?? 6,
      tableStack: s.game?.stack ?? 100,
      line: s.line,
      flops: n,
      target: plan?.spots?.[s.id]?.target ?? null,
      storedTurns: Boolean(s.turns),
      game: gameLabel(s),
    });
  }
  return rows;
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  try {
    const r = await fetchImpl(url, { cache: "no-cache" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** The stamps of a library's stored answers (null where its index can't be read). */
export async function loadStamps(base: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<LibraryStamp | null> {
  const [index, mw] = await Promise.all([getJson<LibraryIndex>(`${base}index.json`, fetchImpl), getJson<LibraryIndex>(`${base}mw_index.json`, fetchImpl)]);
  return index ? libraryStamps(index, mw) : null;
}

export async function loadCatalog(source: LibrarySourceId, fetchImpl: typeof fetch = fetch): Promise<LibraryCatalog> {
  const src = LIBRARY_SOURCES.find((s) => s.id === source) ?? LIBRARY_SOURCES[0];
  const [index, mw, plan] = await Promise.all([
    getJson<LibraryIndex>(`${src.base}index.json`, fetchImpl),
    getJson<LibraryIndex>(`${src.base}mw_index.json`, fetchImpl),
    getJson<LibraryPlan>(`${src.base}lizard-library.json`, fetchImpl),
  ]);
  if (!index) {
    return { source: src.id, base: src.base, available: false, spots: [], fetchedAt: Date.now(), error: "index.json not found" };
  }
  return { source: src.id, base: src.base, available: true, spots: summarize(index, mw, plan), fetchedAt: Date.now() };
}

/** The first library source that is actually published (Lizard's own, else the upstream's). */
export async function resolveLibrarySource(fetchImpl: typeof fetch = fetch): Promise<LibrarySourceId> {
  for (const s of LIBRARY_SOURCES) {
    try {
      const r = await fetchImpl(`${s.base}index.json`, { method: "HEAD", cache: "no-cache" });
      if (r.ok) return s.id;
    } catch {
      /* next */
    }
  }
  return LIBRARY_SOURCES[LIBRARY_SOURCES.length - 1]!.id;
}
