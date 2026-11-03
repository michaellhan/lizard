// A spot of your own (ROADMAP Phase 6): what the Solve page sets up on top of Study's table (players, one stack, the
// line). Each setting is a key the engine already reads (solver/gto/advisor.py, Advisor._advise):
//   stacks    each seat's own stack, bb ({seat: bb}; the others have the table's), _state_stacks
//   sizes     postflop bet sizes per street and raise sizes, % of the pot ({flop|turn|river|raise: [...]}), _custom_sizes
//   rake      a share of the pot taken from pots that see a flop (sent as 0.05 for 5%), with rake_cap in bb
//   ante      each seat's ante, bb; straddle: a 2bb straddle from the first seat (3 or more players)
//   ranges    the ranges entering the flop, PIO style ({seat: "22+,A2s+"}); preflop is still the charts, _custom_ranges
//   payouts, field, bounties: a tournament's (the Tournaments page; features/tournaments/tournament.ts), never raked
// Checked here before any request: the engine checks too, but holds sizes and stacks to wider limits (it allows 5
// sizes a street in Study; the UI allows 3, each multiplies the game tree a browser solves). In Study's URL each
// setting has its own parameter, after the line's, so a link with none reads as before.
import type { AdvisorState } from "@/solver/protocol";
import { parseRange } from "@/features/ranges/rangeText";
import {
  describeTournament,
  tidyTournament,
  tournamentFromParams,
  tournamentProblems,
  tournamentRequest,
  tournamentToParams,
  type TournamentSetup,
} from "@/features/tournaments/tournament";
import { seatsOf } from "@/poker/seats";

/** "33, 75" -> [33, 75] (a word that isn't a number stays, as NaN, for the check to name) */
export const numsOf = (t: string) => t.split(/[\s,;]+/).filter(Boolean).map((x) => Number(x.replace(/%$/, "")));

export const SIZE_STREETS = ["flop", "turn", "river", "raise"] as const;
export type SizeStreet = (typeof SIZE_STREETS)[number];

export const LIMITS = {
  /** sizes a street (each one multiplies the tree) */
  sizes: 3,
  /** a size, % of the pot (the engine's SIZE_PCT) */
  sizePct: [5, 500],
  /** the rake, % of the pot (the engine's cap) */
  rakePct: 25,
  /** a seat's own stack, bb */
  stack: [1, 1000],
  /** each seat's ante, bb */
  ante: 1,
} as const;

export interface SpotSetup {
  /** seats whose stack isn't the table's, bb */
  stacks?: Record<string, number>;
  /** % of the pot */
  sizes?: Partial<Record<SizeStreet, number[]>>;
  /** % of the pot */
  rake?: number;
  /** bb */
  rakeCap?: number;
  /** bb a seat */
  ante?: number;
  straddle?: boolean;
  /** PIO-style range text by seat */
  ranges?: Record<string, string>;
  /** a tournament's prizes left, other tables and bounties (the Tournaments page; features/tournaments) */
  tournament?: TournamentSetup;
}

/** The setup with nothing unset or empty kept (undefined where nothing is set). */
export function tidySetup(s: SpotSetup | undefined): SpotSetup | undefined {
  if (!s) return undefined;
  const out: SpotSetup = {};
  const stacks = Object.entries(s.stacks ?? {}).filter(([, v]) => Number.isFinite(v));
  if (stacks.length) out.stacks = Object.fromEntries(stacks);
  const sizes = SIZE_STREETS.flatMap((k) => (s.sizes?.[k]?.length ? [[k, s.sizes[k]!] as const] : []));
  if (sizes.length) out.sizes = Object.fromEntries(sizes);
  if (s.rake !== undefined && s.rake > 0) {
    out.rake = s.rake;
    if (s.rakeCap !== undefined && s.rakeCap > 0) out.rakeCap = s.rakeCap;
  }
  if (s.ante !== undefined && s.ante > 0) out.ante = s.ante;
  if (s.straddle) out.straddle = true;
  const ranges = Object.entries(s.ranges ?? {}).filter(([, t]) => t.trim());
  if (ranges.length) out.ranges = Object.fromEntries(ranges.map(([p, t]) => [p, t.trim()]));
  const tour = tidyTournament(s.tournament);
  if (tour) out.tournament = tour;
  return Object.keys(out).length ? out : undefined;
}

/** What's wrong with the setup at this table, in words (none: it can be asked). */
export function setupProblems(players: number, s: SpotSetup | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  const seats = seatsOf(players);
  for (const [p, v] of Object.entries(s.stacks ?? {})) {
    if (!seats.includes(p)) out.push(`${p} isn't a seat at this table`);
    else if (!(v >= LIMITS.stack[0] && v <= LIMITS.stack[1])) out.push(`${p}'s stack must be ${LIMITS.stack[0]}–${LIMITS.stack[1]}bb`);
  }
  for (const k of SIZE_STREETS) {
    const xs = s.sizes?.[k] ?? [];
    const what = k === "raise" ? "raise sizes" : `${k} bet sizes`;
    if (new Set(xs).size > LIMITS.sizes) out.push(`at most ${LIMITS.sizes} ${what} (each one multiplies the game tree)`);
    if (xs.some((x) => !(x >= LIMITS.sizePct[0] && x <= LIMITS.sizePct[1]))) out.push(`${what} must be ${LIMITS.sizePct[0]}–${LIMITS.sizePct[1]}% of the pot`);
  }
  if (s.rake !== undefined && !(s.rake >= 0 && s.rake <= LIMITS.rakePct)) out.push(`the rake must be 0–${LIMITS.rakePct}% of the pot`);
  if (s.rakeCap !== undefined && !(s.rakeCap >= 0)) out.push("the rake's cap must be a positive number of big blinds");
  if (s.ante !== undefined && !(s.ante >= 0 && s.ante <= LIMITS.ante)) out.push(`the ante must be 0–${LIMITS.ante}bb a seat`);
  if (s.straddle && players < 3) out.push("a straddle needs 3 or more players");
  for (const [p, text] of Object.entries(s.ranges ?? {})) {
    if (!seats.includes(p)) {
      out.push(`${p} isn't a seat at this table`);
      continue;
    }
    if (!text.trim()) continue;
    const { weights, unknown } = parseRange(text);
    if (unknown.length) out.push(`${p}'s range: can't read ${unknown.slice(0, 3).map((t) => `"${t}"`).join(", ")}${unknown.length > 3 ? "…" : ""}`);
    else if (!Object.values(weights).some((w) => w > 0)) out.push(`${p}'s range is empty`);
  }
  out.push(...tournamentProblems(players, s.tournament));
  if (tidyTournament(s.tournament) && s.rake) out.push("a tournament has no rake");
  return out;
}

/** A game's ante and straddle as a setup (undefined where it has neither), or null where a setup can't hold them (an
 * ante over 1bb a seat): for the Study links from a hand, a library spot or a report. */
export function gameSetup(players: number, ante = 0, straddle = false): SpotSetup | null | undefined {
  const s = tidySetup({ ante, straddle });
  return setupProblems(players, s).length ? null : s;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The engine's keys for the setup at a table of `players`. */
export function setupRequest(s: SpotSetup | undefined, players: number): Partial<AdvisorState> {
  const t = tidySetup(s);
  if (!t) return {};
  return {
    ...(t.stacks ? { stacks: t.stacks } : {}),
    ...(t.sizes ? { sizes: t.sizes } : {}),
    ...(t.rake ? { rake: r3(t.rake / 100), ...(t.rakeCap ? { rake_cap: t.rakeCap } : {}) } : {}),
    ...(t.ante ? { ante: t.ante } : {}),
    ...(t.straddle ? { straddle: true } : {}),
    ...(t.ranges ? { ranges: t.ranges } : {}),
    ...tournamentRequest(t.tournament, players),
  };
}

// ---- in the URL: stacks=BTN:40,BB:120 · sz.flop=33,75 (sz.turn, sz.river, sz.raise) · rake=5 · cap=3 · ante=0.1 ·
// straddle=1 · rg.BB=22+,A2s+
const nums = (v: string) => v.split(",").filter((x) => x.trim()).map(Number);

export function setupToParams(s: SpotSetup | undefined, q: URLSearchParams): void {
  const t = tidySetup(s);
  if (!t) return;
  if (t.stacks) q.set("stacks", Object.entries(t.stacks).map(([p, v]) => `${p}:${v}`).join(","));
  for (const k of SIZE_STREETS) if (t.sizes?.[k]) q.set(`sz.${k}`, t.sizes[k]!.join(","));
  if (t.rake) q.set("rake", String(t.rake));
  if (t.rakeCap) q.set("cap", String(t.rakeCap));
  if (t.ante) q.set("ante", String(t.ante));
  if (t.straddle) q.set("straddle", "1");
  for (const [p, text] of Object.entries(t.ranges ?? {})) q.set(`rg.${p}`, text);
  tournamentToParams(t.tournament, q);
}

export function setupFromParams(q: URLSearchParams): SpotSetup | undefined {
  const s: SpotSetup = {};
  const stacks = q.get("stacks");
  if (stacks)
    s.stacks = Object.fromEntries(
      stacks
        .split(",")
        .map((t) => t.split(":"))
        .filter((kv): kv is [string, string] => kv.length === 2 && !!kv[0])
        .map(([p, v]) => [p, Number(v)]),
    );
  const sizes: Partial<Record<SizeStreet, number[]>> = {};
  for (const k of SIZE_STREETS) {
    const v = q.get(`sz.${k}`);
    if (v) sizes[k] = nums(v);
  }
  if (Object.keys(sizes).length) s.sizes = sizes;
  if (q.has("rake")) s.rake = Number(q.get("rake"));
  if (q.has("cap")) s.rakeCap = Number(q.get("cap"));
  if (q.has("ante")) s.ante = Number(q.get("ante"));
  if (q.get("straddle") === "1") s.straddle = true;
  const ranges: Record<string, string> = {};
  for (const [k, v] of q) if (k.startsWith("rg.") && k.length > 3) ranges[k.slice(3)] = v;
  if (Object.keys(ranges).length) s.ranges = ranges;
  const tour = tournamentFromParams(q);
  if (tour) s.tournament = tour;
  return Object.keys(s).length ? s : undefined;
}

const pcts = (xs: number[]) => xs.map((x) => `${x}%`).join(", ");

/** The setup in a few words each, for Study's line (empty where nothing is set). */
export function describeSetup(s: SpotSetup | undefined): string[] {
  const t = tidySetup(s);
  if (!t) return [];
  const out: string[] = [];
  if (t.stacks) out.push(`stacks ${Object.entries(t.stacks).map(([p, v]) => `${p} ${v}bb`).join(", ")}`);
  for (const k of SIZE_STREETS) if (t.sizes?.[k]) out.push(`${k === "raise" ? "raises" : `${k} bets`} ${pcts(t.sizes[k]!)}`);
  if (t.rake) out.push(`rake ${t.rake}%${t.rakeCap ? `, capped at ${t.rakeCap}bb` : ""}`);
  if (t.ante) out.push(`ante ${t.ante}bb`);
  if (t.straddle) out.push("straddle");
  if (t.ranges) out.push(`${Object.keys(t.ranges).join(", ")} range${Object.keys(t.ranges).length > 1 ? "s" : ""} set`);
  out.push(...describeTournament(t.tournament));
  return out;
}
