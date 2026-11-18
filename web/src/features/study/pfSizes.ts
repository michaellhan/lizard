// The preflop solve's raise sizes (ROADMAP Phase 0; classic study.js's game form, PF_FIELDS and SIZE_KEYS): the
// engine's "pf_sizes" (gto/pf_study.py SIZE_KEYS, SIZE_LIMITS; the defaults are gto/pf_game.py Sizes). Only the solve
// takes them: the charts play their own sizes. A size at its default isn't sent, so the stored 6-max games stay the
// ones asked for. In Study's link as pfs=open:2.2,four_x:2.5.
//
// With them, one choice of the game's tree that isn't a size: `limp`, the small blind may complete when it's folded to
// (3 or more players; heads-up it always may), sent apart as "pf_sb_limp" (engine/pf_solve.py Spec.sb_limp; no stored
// game has it) and in the link as pfs=limp.
//
// And the tree builder's options (2026-11-13; engine/pf_solve.py Spec, sent as "pf_tree"): `limps`, any seat may limp
// first in or over-limp (pfs=L); `opens`, a position's own open size (pfs=o.UTG:2.2); `flop3`, up to three see a flop,
// and `cold`, cold calls of a 3bet and cold 4bets, each on up to 6 players and off from 7 by default (pfs=f3:1,cold:0).
// Since 2026-11-17 one more: `five`, the 5bet's rule (pfs=5x:0 for none, 5x:2.2 for a raise to 2.2 times the 4bet; unset,
// the 5bet is all-in; sent as pf_tree "five"). The engine also solves a straddle from another seat than the first
// (pf_tree "straddler", a Mississippi straddle), but this page's table and the charts play the first seat's only, so the
// form doesn't offer it.
// None of these is in a stored game, so each solves in the browser, within the device's memory (pfCap.ts).
import { SEATS } from "@/poker/seats";

export const PF_SIZE_KEYS = ["open", "sb_open", "ip_3bet", "blind_3bet", "four_x"] as const;
export type PfSizeKey = (typeof PF_SIZE_KEYS)[number];
export type PfSizes = Partial<Record<PfSizeKey, number>> & {
  limp?: true;
  /** any seat may limp first in or over-limp */
  limps?: true;
  /** a position's own open size, bb (first in) */
  opens?: Record<string, number>;
  /** up to three see a flop (unset: the table size's default, on up to 6 players) */
  flop3?: boolean;
  /** cold calls of a 3bet and cold 4bets (unset: on up to 6 players) */
  cold?: boolean;
  /** the 5bet: 0 none (facing a 4bet, call or fold), else a raise to this many times the 4bet (unset: all-in) */
  five?: number;
};

/** A sized 5bet's range, times the 4bet (engine/pf_solve.py FIVE_LIMITS). */
export const PF_FIVE = { lo: 1.8, hi: 3.5 };

/** The seats that can open at a table (everyone but the big blind). */
export const openers = (players: number): string[] => (SEATS[players] ?? []).slice(0, -1);

/** The table size's own tree: 3-way flops and cold calls on up to 6 players. */
export const fullTreeAt = (players: number) => players <= 6;

export const PF_SIZE: Record<PfSizeKey, { label: string; word: string; unit: "bb" | "×"; lo: number; hi: number; def: number; hint: string }> = {
  open: { label: "Open", word: "open", unit: "bb", lo: 2, hi: 5, def: 2.5, hint: "A raise first in" },
  sb_open: { label: "SB open", word: "SB open", unit: "bb", lo: 2, hi: 5, def: 3, hint: "The small blind's raise first in" },
  ip_3bet: { label: "3bet", word: "3bet", unit: "×", lo: 2, hi: 5, def: 3, hint: "A 3bet from a seat that isn't a blind, times the open" },
  blind_3bet: { label: "Blind 3bet", word: "blind 3bet", unit: "×", lo: 2.5, hi: 6, def: 4.8, hint: "A 3bet from a blind, times the open" },
  four_x: { label: "4bet", word: "4bet", unit: "×", lo: 1.8, hi: 3.5, def: 2.3, hint: "A 4bet, times the 3bet" },
};

const inRange = (k: PfSizeKey, v: number) => Number.isFinite(v) && v >= PF_SIZE[k].lo && v <= PF_SIZE[k].hi;

/** The sizes that differ from the defaults, rounded as the engine rounds them (0.01); undefined where none do. A
 * size out of its range is left out (pfSizeProblems names it first). With `players`, the tree's options are kept as
 * that table takes them: an open of a seat it hasn't, or a switch at its table size's default, left out. */
export function tidyPfSizes(s: PfSizes | undefined, players?: number): PfSizes | undefined {
  const out: PfSizes = {};
  for (const k of PF_SIZE_KEYS) {
    const v = s?.[k];
    if (v === undefined || !inRange(k, v)) continue;
    const r = Math.round(v * 100) / 100;
    if (Math.abs(r - PF_SIZE[k].def) > 1e-9) out[k] = r;
  }
  if (s?.limp && !s.limps) out.limp = true;
  if (s?.limps && players !== 2) out.limps = true;
  const seats = players ? openers(players) : null;
  const opens = Object.entries(s?.opens ?? {}).filter(([p, v]) => inRange("open", v) && (!seats || seats.includes(p)));
  const sbOf = (p: string) => (players ? p === seats![seats!.length - 1] : p === "SB");
  const kept = opens
    .map(([p, v]) => [p, Math.round(v * 100) / 100] as const)
    .filter(([p, v]) => Math.abs(v - (sbOf(p) ? (out.sb_open ?? PF_SIZE.sb_open.def) : (out.open ?? PF_SIZE.open.def))) > 1e-9);
  if (kept.length) out.opens = Object.fromEntries(kept);
  for (const k of ["flop3", "cold"] as const) if (typeof s?.[k] === "boolean" && (players === undefined || s[k] !== fullTreeAt(players))) out[k] = s[k];
  const five = s?.five;
  if (five === 0) out.five = 0;
  else if (typeof five === "number" && five >= PF_FIVE.lo && five <= PF_FIVE.hi) out.five = Math.round(five * 100) / 100;
  return Object.keys(out).length ? out : undefined;
}

/** What the engine would refuse, in words. */
export const pfSizeProblems = (s: PfSizes): string[] =>
  PF_SIZE_KEYS.flatMap((k) => {
    const v = s[k];
    const { label, lo, hi, unit } = PF_SIZE[k];
    return v === undefined || inRange(k, v) ? [] : [`${label} must be ${lo}–${hi}${unit === "bb" ? "bb" : "×"}`];
  })
    .concat(Object.entries(s.opens ?? {}).flatMap(([p, v]) => (inRange("open", v) ? [] : [`${p}'s open must be ${PF_SIZE.open.lo}–${PF_SIZE.open.hi}bb`])))
    .concat(s.five === undefined || s.five === 0 || (Number.isFinite(s.five) && s.five >= PF_FIVE.lo && s.five <= PF_FIVE.hi) ? [] : [`A 5bet must be ${PF_FIVE.lo}–${PF_FIVE.hi}×`]);

export const encodePfSizes = (s: PfSizes): string =>
  [
    ...PF_SIZE_KEYS.filter((k) => s[k] !== undefined).map((k) => `${k}:${s[k]}`),
    ...(s.limp ? ["limp"] : []),
    ...(s.limps ? ["L"] : []),
    ...Object.entries(s.opens ?? {}).map(([p, v]) => `o.${p}:${v}`),
    ...(s.flop3 !== undefined ? [`f3:${s.flop3 ? 1 : 0}`] : []),
    ...(s.cold !== undefined ? [`cold:${s.cold ? 1 : 0}`] : []),
    ...(s.five !== undefined ? [`5x:${s.five}`] : []),
  ].join(",");

export function parsePfSizes(t: string | null, players?: number): PfSizes | undefined {
  if (!t) return undefined;
  const out: PfSizes = {};
  for (const part of t.split(",")) {
    const [k, v] = part.split(":");
    if (k === "limp") out.limp = true;
    else if (k === "L") out.limps = true;
    else if (k?.startsWith("o.") && k.length > 2) out.opens = { ...out.opens, [k.slice(2).toUpperCase()]: Number(v) };
    else if (k === "f3") out.flop3 = v === "1";
    else if (k === "cold") out.cold = v === "1";
    else if (k === "5x") out.five = Number(v);
    else if ((PF_SIZE_KEYS as readonly string[]).includes(k ?? "")) out[k as PfSizeKey] = Number(v);
  }
  return tidyPfSizes(out, players);
}

/** "open 2.2bb, 4bet 2.5×, SB completes" (the sizes set, the rest at their defaults, and the tree's options where asked) */
export const describePfSizes = (s: PfSizes | undefined): string =>
  [
    ...PF_SIZE_KEYS.filter((k) => s?.[k] !== undefined).map((k) => `${PF_SIZE[k].word} ${s![k]}${PF_SIZE[k].unit}`),
    ...(s?.limp ? ["SB completes"] : []),
    ...(s?.limps ? ["limps"] : []),
    ...Object.entries(s?.opens ?? {}).map(([p, v]) => `${p} opens ${v}bb`),
    ...(s?.flop3 !== undefined ? [s.flop3 ? "3-way flops" : "2 to a flop"] : []),
    ...(s?.cold !== undefined ? [s.cold ? "cold calls" : "no cold calls"] : []),
    ...(s?.five !== undefined ? [s.five === 0 ? "no 5bet" : `5bet ${s.five}×`] : []),
  ].join(", ");

export interface PfTree {
  open_limps?: true;
  opens?: Record<string, number>;
  flop3?: boolean;
  cold?: boolean;
  five?: number | "none";
}

/** The request's fields for them: the sizes as "pf_sizes", the complete apart as "pf_sb_limp", the tree's options as
 * "pf_tree" (engine/pf_solve.py spec_of). */
export function pfSizesRequest(s: PfSizes | undefined): { pf_sizes?: Partial<Record<PfSizeKey, number>>; pf_sb_limp?: true; pf_tree?: PfTree } {
  if (!s) return {};
  const { limp, limps, opens, flop3, cold, five, ...sizes } = s;
  const tree: PfTree = {
    ...(limps ? { open_limps: true as const } : {}),
    ...(opens && Object.keys(opens).length ? { opens } : {}),
    ...(flop3 !== undefined ? { flop3 } : {}),
    ...(cold !== undefined ? { cold } : {}),
    ...(five !== undefined ? { five: five === 0 ? ("none" as const) : five } : {}),
  };
  return {
    ...(Object.keys(sizes).length ? { pf_sizes: sizes } : {}),
    ...(limp ? { pf_sb_limp: true as const } : {}),
    ...(Object.keys(tree).length ? { pf_tree: tree } : {}),
  };
}
