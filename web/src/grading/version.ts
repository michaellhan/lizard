// The version of what graded a decision, so a change in the charts or the library isn't read as a change in your play.
// A stamp is a string, kept with the grade:
//   build:<solver build>                     the solver bundle (solverVersionOf: upstream commit/bundle hash), which
//                                            holds the preflop charts: charts, solves and reads at once
//   library:<spot>:<id>[:<flop>:<entry>]     a stored spot (library/version.ts): its solves' ranges and tree, and where
//                                            the answer names its flop, that entry's hash
//   library:*:<id>                           the whole library, for a stored turn: the engine's answer names no spot
//   build:<solver build>+library:...         a read at once (Instant): the build that read it and the library spot it
//                                            read, as either moving changes the answer
// A grade with no stamp was made before stamps were kept, on a local server (whose build the page can't see) or on a
// development build: its version is unknown, and is said so. Nothing here works one out from when a grade was made.
import type { Provenance } from "@/solver/types";

/** The stamp for a grade against this answer; undefined where its version can't be told. */
export function versionOf(p: Provenance | null | undefined): string | undefined {
  if (!p) return undefined;
  if (p.source === "library" || p.source === "library-turn") return p.libraryVersion;
  if (p.transport !== "worker" || !p.solverVersion || p.solverVersion === "dev") return undefined;
  const build = `build:${p.solverVersion}`;
  return p.source === "instant" && p.libraryVersion?.startsWith("library:") ? `${build}+${p.libraryVersion}` : build;
}

/** A stamp's build and library parts (a read at once has both). */
export function stampParts(v: string | null | undefined): { build?: string; library?: string } {
  const out: { build?: string; library?: string } = {};
  for (const x of v?.split("+") ?? []) {
    if (x.startsWith("build:") && x.length > 6) out.build = x.slice(6);
    else if (x.startsWith("library:")) out.library = x;
  }
  return out;
}

/** A library stamp without its flop's entry: what a session's counts keep, as a session holds many flops. */
export const spotVersion = (v: string): string =>
  v
    .split("+")
    .map((x) => (x.startsWith("library:") ? x.split(":").slice(0, 3).join(":") : x))
    .join("+");

interface Part {
  /** what's at a version: the same `key` at two `id`s is a change */
  key: string;
  what: string;
  id: string;
}

/** What a stamp says; null for one this page can't read, which counts as unknown. */
function partsOf(v: string): Part[] | null {
  if (v.includes("+")) {
    const each = v.split("+").map(partsOf);
    return each.length === 2 && each.every(Boolean) ? each.flatMap((x) => x!) : null;
  }
  if (v.startsWith("build:") && v.length > 6) return [{ key: "build", what: "solver build", id: v.slice(6) }];
  const [kind, spot, id, flop, entry] = v.split(":");
  if (kind !== "library" || !spot || !id) return null;
  if (spot === "*") return [{ key: "library", what: "library as a whole", id }];
  const parts = [{ key: `library:${spot}`, what: `library ${spot}`, id }];
  return flop && entry ? [...parts, { key: `entry:${spot}:${flop}`, what: `library ${spot} on ${flop}`, id: entry }] : parts;
}

/** A stamp in words, "unknown" where there's none. */
export function versionWords(v: string | null | undefined): string {
  if (!v || !partsOf(v)) return "unknown";
  // (each part's first: a library stamp's flop entry stays out of the words; a read at once says its build and spot)
  return v
    .split("+")
    .map((x) => partsOf(x)![0]!)
    .map((p) => `${p.what} ${p.id}`)
    .join(" and ");
}

/** How many grades stand on each stamp; null: none, or none that can be read. */
export type VersionCounts = ReadonlyMap<string | null, number>;

export function countVersions(vs: Iterable<string | null | undefined>): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const v of vs) {
    const k = v && partsOf(v) ? v : null;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Counts as a session keeps them (GradeCell `versions`, stamps counted over `n` decisions): the rest are unknown. */
export function keptCounts(kept: Readonly<Record<string, number>> | undefined, n: number): Map<string | null, number> {
  const m = new Map<string | null, number>();
  let known = 0;
  for (const [v, k] of Object.entries(kept ?? {})) {
    if (!partsOf(v)) continue;
    m.set(v, (m.get(v) ?? 0) + k);
    known += k;
  }
  if (n > known) m.set(null, n - known);
  return m;
}

/** Whether a stored answer's own spot or entry stands at another version. The id for stored turns moves whenever a spot
 * joins the library, so it can't say that of one answer. */
export function storedMoved(a: string | undefined, b: string | undefined): boolean {
  return versionSpan(countVersions(a ? [a] : []), countVersions(b ? [b] : [])).changed.some((c) => c.what !== "library as a whole");
}

const total = (c: VersionCounts) => [...c.values()].reduce((a, b) => a + b, 0);

export interface VersionSpan {
  /** what stands at more than one version, and which on each side */
  changed: { what: string; before: string[]; later: string[] }[];
  /** decisions with no version, on each side */
  unknown: [number, number];
  n: [number, number];
}

/** Which versions a comparison spans. One spot on one side alone is no change; the same one at two versions is, wherever
 * they fall. An entry's own change is left out where its whole spot changed. */
export function versionSpan(before: VersionCounts, later: VersionCounts = new Map()): VersionSpan {
  const by = new Map<string, { what: string; ids: [Set<string>, Set<string>] }>();
  ([before, later] as const).forEach((side, k) => {
    for (const v of side.keys())
      for (const p of v ? (partsOf(v) ?? []) : []) {
        const e = by.get(p.key) ?? { what: p.what, ids: [new Set(), new Set()] };
        e.ids[k as 0 | 1].add(p.id);
        by.set(p.key, e);
      }
  });
  const moved = [...by].filter(([, e]) => new Set([...e.ids[0], ...e.ids[1]]).size > 1);
  const spots = new Set(moved.map(([key]) => key));
  const changed = moved
    .filter(([key]) => !key.startsWith("entry:") || !spots.has(`library:${key.split(":")[1]}`))
    .map(([, e]) => ({ what: e.what, before: [...e.ids[0]].sort(), later: [...e.ids[1]].sort() }));
  return { changed, unknown: [before.get(null) ?? 0, later.get(null) ?? 0], n: [total(before), total(later)] };
}

const list = (xs: readonly string[]) => xs.join(" and ") || "none";

/** A comparison's versions in words, for its row; null where they're one and known. */
export function versionNote(s: VersionSpan): string | null {
  const out: string[] = [];
  const [one, ...more] = s.changed;
  if (one && !more.length) {
    const ids = s.n[1] ? `${list(one.before)} before, ${list(one.later)} latest` : list(one.before);
    out.push(`Graded on different versions: ${one.what} ${ids}.`);
  } else if (one) {
    const named = s.changed.slice(0, 3).map((c) => c.what).join(", ");
    out.push(`Graded on different versions of ${s.changed.length} things: ${named}${s.changed.length > 3 ? " and more" : ""}.`);
  }
  const [u, n] = [s.unknown[0] + s.unknown[1], s.n[0] + s.n[1]];
  if (u) {
    const sides = s.n[1] ? ` (${s.unknown[0].toLocaleString()} before, ${s.unknown[1].toLocaleString()} latest)` : "";
    out.push(u === n ? `Version unknown${sides}.` : `Version unknown for ${u.toLocaleString()} of ${n.toLocaleString()}${sides}.`);
  }
  return out.length ? out.join(" ") : null;
}

/** What a set of grades stands on, in a line: each build, the library's spots counted where there are several. */
export function versionSummary(c: VersionCounts): string | null {
  const n = total(c);
  if (!n) return null;
  const u = c.get(null) ?? 0;
  const known = [...c].filter((e): e is [string, number] => e[0] !== null);
  const builds = new Map<string, number>();
  const spots = new Map<string, number>();
  for (const [v, k] of known) {
    const [p] = partsOf(v)!;
    const to = p!.key === "build" ? builds : spots;
    const name = versionWords(v);
    to.set(name, (to.get(name) ?? 0) + k);
  }
  const say = (m: Map<string, number>) => [...m].map(([w, k]) => `${w} (${k.toLocaleString()})`);
  const stored = spots.size > 3 ? [`${spots.size} library versions (${[...spots.values()].reduce((a, b) => a + b, 0).toLocaleString()})`] : say(spots);
  const on = [...say(builds), ...stored];
  if (!on.length) return "Version unknown: none of these grades has one.";
  return `Graded on ${on.join(", ")}.${u ? ` Version unknown for ${u.toLocaleString()}.` : ""}`;
}

/** Why a version can be unknown, for a page that shows one. */
export const VERSION_UNKNOWN = "Unknown: graded before versions were kept, or on a local or dev build.";
