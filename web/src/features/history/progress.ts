// Decisions by street, seat and pot and how they've moved over time, from the sessions kept. A Practice session keeps its
// decisions by street, source and basis (`cells`, history.ts) from 2026-11-05 on; earlier ones have only their totals, and
// are counted apart. Each cell also keeps a seat and a pot from later that day: what's kept before them counts in every
// total and stays out of those two splits, said with a count. A flop drill's decisions are stored and graded by EV and
// a turn drill's by the stored mix, so every drill counts, old ones too. A leak drill
// grades your imported decisions again and keeps no street: those count apart as well. A retry is no session: it's a spot
// you've already missed, so it would only drag the share down, and it stays out of both.
//
// The trend keeps Analyze's rules (analyze/trend.ts): a share of decisions in the mix is mostly noise over a few, so a
// line needs MIN_BLOCKS stretches of BLOCK decisions or more, and with fewer the page says why rather than drawing one.
// Graded by EV and graded by frequency are never added together, as a session's mix of streets would move the line with
// no change in how you play. Whole sessions make a stretch. EV lost isn't drawn: it's what a decision gave up against the
// answer named, so it's neither a result nor a win rate, and one big pot would own a line of it.
import type { SessionRecord } from "@/data/db";
import { cellsFit, isCellCounts, isPotName, isSeatName, POT_NAMES, SEAT_NAMES } from "@/data/shapes";
import { BAR, BLOCK, MIN_BLOCKS, MIN_SHARE, moreForLine, shareZ, type Block, type Change } from "@/features/analyze/trend";
import { wilson } from "@/features/analyze/stats";
import { keptCounts, versionSpan, type VersionSpan } from "@/grading/version";
import type { GradeCell } from "./history";

export { MIN_BLOCKS, BLOCK, MIN_SHARE };

export const STREET_ORDER = ["preflop", "flop", "turn", "river"] as const;

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** Counts by version, as a session keeps them; a damaged one leaves its decisions unknown. */
function readVersions(x: unknown): { versions: Record<string, number> } | object {
  const v = obj(x);
  const ok = v ? Object.entries(v).filter((e): e is [string, number] => num(e[1]) > 0) : [];
  return ok.length ? { versions: Object.fromEntries(ok) } : {};
}

/** A cell read defensively: one whose counts don't stand (`isCellCounts`) isn't one, and it counts nowhere. A seat or a
 * pot that isn't one is read as not kept, and the cell's decisions still count. */
function readCell(x: unknown): GradeCell | null {
  const c = obj(x);
  if (!c || !isCellCounts(c)) return null;
  return {
    street: c.street as string,
    source: c.source as string,
    byEv: c.byEv as boolean,
    n: num(c.n),
    ok: num(c.ok),
    loss: num(c.loss),
    lossPct: num(c.lossPct),
    ...readVersions(c.versions),
    ...(isSeatName(c.seat) ? { seat: c.seat } : {}),
    ...(isPotName(c.pot) ? { pot: c.pot } : {}),
  };
}

/** The cells a session kept (null: none; none either where they add up to more decisions than it graded, as no real
 * session's do). A tournament's and a read's are kept too, read only for their own kind's totals. */
export function keptCells(s: SessionRecord): GradeCell[] | null {
  const kept = obj(s.meta?.cells);
  if (!kept) return null;
  const cells = Object.values(kept).map(readCell).filter((c): c is GradeCell => c !== null);
  return cellsFit(cells.map((c) => c.n), num(s.decisions)) ? cells : [];
}

/** A session's cells: a Practice session's as kept (null: played before they were kept; none where they add up to more
 * decisions than it graded, as no real session's do), a drill's from its totals: a flop drill's the flop library's by EV,
 * a turn drill's the stored turn's by frequency. Any other kind has none. */
export function cellsOf(s: SessionRecord): GradeCell[] | null {
  const m = s.meta ?? {};
  if (s.kind === "practice") return keptCells(s);
  if (s.kind === "drill" && num(s.decisions) > 0) {
    const n = num(s.decisions);
    // (a turn drill's mark: it's graded by the stored mix, with no EV)
    if (m.street === "turn") return [{ street: "turn", source: "library-turn", byEv: false, n, ok: num(m.ok), loss: 0, lossPct: 0, ...readVersions(m.versions) }];
    return [{ street: "flop", source: "library", byEv: true, n, ok: num(m.ok), loss: num(s.evLossBb), lossPct: num(m.lossPct), ...readVersions(m.versions) }];
  }
  return s.kind === "drill" ? [] : null;
}

interface Tally {
  n: number;
  ok: number;
  /** of them graded by EV, and the EV lost over those */
  ne: number;
  loss: number;
  lossPct: number;
  /** how many each source graded */
  sources: Record<string, number>;
}

export interface StreetRow extends Tally {
  street: string;
  /** a street graded both ways has a row a way, so that no Best or Correct share runs across EV and frequency */
  basis?: Basis;
}

export interface StreetTotals {
  rows: StreetRow[];
  /** Practice sessions from before streets were kept, or the part of one that was, and their decisions */
  apartSessions: number;
  apartDecisions: number;
  /** leak drills' decisions: no street kept */
  leakDecisions: number;
}

const addTo = (r: Tally, c: GradeCell) => {
  r.n += c.n;
  r.ok += c.ok;
  if (c.byEv) {
    r.ne += c.n;
    r.loss += c.loss;
    r.lossPct += c.lossPct;
  }
  r.sources[c.source] = (r.sources[c.source] ?? 0) + c.n;
};

const leakCount = (s: SessionRecord) => {
  const score = obj(s.meta?.score);
  return score ? num(score.n) : num(s.decisions);
};

/** Every decision kept by street (only the streets played); those that can't be split, counted apart. */
export function streetTotals(sessions: readonly SessionRecord[]): StreetTotals {
  const by = new Map<string, StreetRow>();
  let apartSessions = 0, apartDecisions = 0, leakDecisions = 0;
  for (const s of sessions) {
    if (s.kind === "analysis") {
      leakDecisions += leakCount(s);
      continue;
    }
    if (s.kind !== "practice" && s.kind !== "drill") continue;
    const cells = cellsOf(s);
    for (const c of cells ?? []) {
      const basis: Basis = c.byEv ? "ev" : "freq";
      const key = `${c.street}|${basis}`;
      const r = by.get(key) ?? { street: c.street, basis, n: 0, ok: 0, ne: 0, loss: 0, lossPct: 0, sources: {} };
      by.set(key, r);
      addTo(r, c);
    }
    const missing = num(s.decisions) - (cells ?? []).reduce((a, c) => a + c.n, 0);
    if (missing > 0) {
      apartSessions++;
      apartDecisions += missing;
    }
  }
  const rows = STREET_ORDER.flatMap((st) => {
    const both = [by.get(`${st}|ev`), by.get(`${st}|freq`)].flatMap((r) => r ?? []);
    return both.length > 1 ? both : both.map(({ basis: _, ...r }) => r);
  });
  return { rows, apartSessions, apartDecisions, leakDecisions };
}

export type SplitBy = "seat" | "pot";

export interface SplitRow extends Tally {
  /** the seat or the pot */
  name: string;
}

export interface SplitTotals {
  by: SplitBy;
  /** a row for each seat or pot with any decision, by basis: graded by EV and by frequency are never one row */
  ev: SplitRow[];
  freq: SplitRow[];
  /** decisions kept with no seat or pot, or none here, and the sessions they're in */
  notKept: number;
  notKeptSessions: number;
  /** leak drills' decisions: no seat or pot kept */
  leakDecisions: number;
}

const SPLIT_ORDER: Record<SplitBy, readonly string[]> = { seat: SEAT_NAMES, pot: POT_NAMES };

/** Every decision kept by seat or by pot, a row a basis; those that can't be split, counted apart. A row adds up what
 * the same cells add up by street, so every decision is either in one row or in `notKept`. Only Practice and drills, as
 * by street: a tournament's or a read's EVs go in no total with an equilibrium's. */
export function splitTotals(sessions: readonly SessionRecord[], by: SplitBy): SplitTotals {
  const rows = new Map<string, SplitRow>();
  let notKept = 0, notKeptSessions = 0, leakDecisions = 0;
  for (const s of sessions) {
    if (s.kind === "analysis") {
      leakDecisions += leakCount(s);
      continue;
    }
    if (s.kind !== "practice" && s.kind !== "drill") continue;
    let split = 0;
    for (const c of cellsOf(s) ?? []) {
      const name = c[by];
      if (!name) continue;
      split += c.n;
      const key = `${c.byEv ? "ev" : "freq"}|${name}`;
      const r = rows.get(key) ?? { name, n: 0, ok: 0, ne: 0, loss: 0, lossPct: 0, sources: {} };
      rows.set(key, r);
      addTo(r, c);
    }
    const missing = num(s.decisions) - split;
    if (missing > 0) {
      notKept += missing;
      notKeptSessions++;
    }
  }
  const of = (b: Basis) => SPLIT_ORDER[by].flatMap((name) => rows.get(`${b}|${name}`) ?? []);
  return { by, ev: of("ev"), freq: of("freq"), notKept, notKeptSessions, leakDecisions };
}

/** A share of decisions: a percent over enough of them, else the plain count. */
export const shareText = (ok: number, n: number) => (!n ? "–" : n < MIN_SHARE ? `${ok} of ${n}` : `${Math.round((ok / n) * 100)}%`);

export type Basis = "ev" | "freq";
export const BASIS_WORDS: Record<Basis, string> = { ev: "Graded by EV", freq: "Graded by frequency (no EV)" };

interface Stretch extends Block {
  /** decisions graded by EV in it, and EV lost in % of the pot over those */
  ne: number;
  lossPct: number;
}

export interface BasisTrend {
  basis: Basis;
  /** decisions, and the sessions they came from */
  n: number;
  sessions: number;
  sources: Record<string, number>;
  /** the stretches, oldest first */
  blocks: Stretch[];
  /** enough to draw */
  line: boolean;
  /** the last stretch against those before it; null: no clear change */
  change: Change | null;
  /** the case against drawing: said on the page */
  why: string | null;
  /** what graded it: the last stretch against those before it where there's a line, else all of it */
  versions: VersionSpan;
}

// (TrendChart prints a day with clockOf, which reads a time as UTC: these are local times, so they're moved to print as such)
const asClock = (t: number) => t - new Date(t).getTimezoneOffset() * 60_000;

/** One basis over the sessions, oldest first, in stretches of at least BLOCK decisions: whole sessions, the remainder
 * going in the last. */
export function basisTrend(sessions: readonly SessionRecord[], basis: Basis): BasisTrend {
  const parts: { at: number; n: number; ok: number; lossPct: number; sources: Record<string, number>; cells: GradeCell[] }[] = [];
  for (const s of [...sessions].sort((a, b) => num(a.startedAt) - num(b.startedAt))) {
    const cs = (cellsOf(s) ?? []).filter((c) => c.byEv === (basis === "ev"));
    if (!cs.length) continue;
    const sources: Record<string, number> = {};
    for (const c of cs) sources[c.source] = (sources[c.source] ?? 0) + c.n;
    parts.push({ at: num(s.startedAt), n: cs.reduce((a, c) => a + c.n, 0), ok: cs.reduce((a, c) => a + c.ok, 0), lossPct: cs.reduce((a, c) => a + c.lossPct, 0), sources, cells: cs });
  }
  const n = parts.reduce((a, p) => a + p.n, 0);
  const sources: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p.sources)) sources[k] = (sources[k] ?? 0) + v;

  const groups: (typeof parts)[] = [];
  let cur: typeof parts = [];
  let size = 0;
  for (const p of parts) {
    cur.push(p);
    size += p.n;
    if (size >= BLOCK) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
  }
  if (cur.length) {
    if (groups.length) groups.at(-1)!.push(...cur);
    else groups.push(cur);
  }
  const blocks = groups.map((g): Stretch => {
    const count = g.reduce((a, p) => a + p.n, 0);
    const ok = g.reduce((a, p) => a + p.ok, 0);
    return { n: count, ok, share: ok / count, range: wilson(ok, count), from: asClock(g[0]!.at), to: asClock(g.at(-1)!.at), ne: basis === "ev" ? count : 0, lossPct: g.reduce((a, p) => a + p.lossPct, 0) };
  });
  const line = blocks.length >= MIN_BLOCKS;
  let change: Change | null = null;
  if (line) {
    const last = blocks.at(-1)!;
    const before = blocks.slice(0, -1);
    const z = shareZ(before.reduce((a, b) => a + b.ok, 0), before.reduce((a, b) => a + b.n, 0), last.ok, last.n);
    change = z == null || Math.abs(z) < BAR ? null : z > 0 ? "Better" : "Worse";
  }
  const why = line
    ? null
    : n < MIN_BLOCKS * BLOCK
      ? `${moreForLine(n).toLocaleString()} more decisions for a line.`
      : `${blocks.length} of ${MIN_BLOCKS} stretches for a line.`;
  const counted = (ps: typeof parts) => {
    const all = new Map<string | null, number>();
    for (const c of ps.flatMap((p) => p.cells)) for (const [v, k] of keptCounts(c.versions, c.n)) all.set(v, (all.get(v) ?? 0) + k);
    return all;
  };
  const versions = line ? versionSpan(counted(groups.slice(0, -1).flat()), counted(groups.at(-1)!)) : versionSpan(counted(parts));
  return { basis, n, sessions: parts.length, sources, blocks, line, change, why, versions };
}

/** Both bases, those with any decision; `why` a basis isn't drawn, in words; what graded each. */
export const trends = (sessions: readonly SessionRecord[]): BasisTrend[] => (["ev", "freq"] as const).map((b) => basisTrend(sessions, b)).filter((t) => t.n > 0);
