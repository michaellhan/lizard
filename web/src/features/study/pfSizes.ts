// The preflop solve's raise sizes (ROADMAP Phase 0; classic study.js's game form, PF_FIELDS and SIZE_KEYS): the
// engine's "pf_sizes" (gto/pf_study.py SIZE_KEYS, SIZE_LIMITS; the defaults are gto/pf_game.py Sizes). Only the solve
// takes them: the charts play their own sizes. A size at its default isn't sent, so the stored 6-max games stay the
// ones asked for. In Study's link as pfs=open:2.2,four_x:2.5.

export const PF_SIZE_KEYS = ["open", "sb_open", "ip_3bet", "blind_3bet", "four_x"] as const;
export type PfSizeKey = (typeof PF_SIZE_KEYS)[number];
export type PfSizes = Partial<Record<PfSizeKey, number>>;

export const PF_SIZE: Record<PfSizeKey, { label: string; word: string; unit: "bb" | "×"; lo: number; hi: number; def: number; hint: string }> = {
  open: { label: "Open", word: "open", unit: "bb", lo: 2, hi: 5, def: 2.5, hint: "A raise first in" },
  sb_open: { label: "SB open", word: "SB open", unit: "bb", lo: 2, hi: 5, def: 3, hint: "The small blind's raise first in" },
  ip_3bet: { label: "3bet", word: "3bet", unit: "×", lo: 2, hi: 5, def: 3, hint: "A 3bet from a seat that isn't a blind, times the open" },
  blind_3bet: { label: "Blind 3bet", word: "blind 3bet", unit: "×", lo: 2.5, hi: 6, def: 4.8, hint: "A 3bet from a blind, times the open" },
  four_x: { label: "4bet", word: "4bet", unit: "×", lo: 1.8, hi: 3.5, def: 2.3, hint: "A 4bet, times the 3bet" },
};

const inRange = (k: PfSizeKey, v: number) => Number.isFinite(v) && v >= PF_SIZE[k].lo && v <= PF_SIZE[k].hi;

/** The sizes that differ from the defaults, rounded as the engine rounds them (0.01); undefined where none do. A
 * size out of its range is left out (pfSizeProblems names it first). */
export function tidyPfSizes(s: PfSizes | undefined): PfSizes | undefined {
  const out: PfSizes = {};
  for (const k of PF_SIZE_KEYS) {
    const v = s?.[k];
    if (v === undefined || !inRange(k, v)) continue;
    const r = Math.round(v * 100) / 100;
    if (Math.abs(r - PF_SIZE[k].def) > 1e-9) out[k] = r;
  }
  return Object.keys(out).length ? out : undefined;
}

/** What the engine would refuse, in words. */
export const pfSizeProblems = (s: PfSizes): string[] =>
  PF_SIZE_KEYS.flatMap((k) => {
    const v = s[k];
    const { label, lo, hi, unit } = PF_SIZE[k];
    return v === undefined || inRange(k, v) ? [] : [`${label} must be ${lo}–${hi}${unit === "bb" ? "bb" : "×"}`];
  });

export const encodePfSizes = (s: PfSizes): string =>
  PF_SIZE_KEYS.filter((k) => s[k] !== undefined)
    .map((k) => `${k}:${s[k]}`)
    .join(",");

export function parsePfSizes(t: string | null): PfSizes | undefined {
  if (!t) return undefined;
  const out: PfSizes = {};
  for (const part of t.split(",")) {
    const [k, v] = part.split(":");
    if ((PF_SIZE_KEYS as readonly string[]).includes(k ?? "")) out[k as PfSizeKey] = Number(v);
  }
  return tidyPfSizes(out);
}

/** "open 2.2bb, 4bet 2.5×" (the sizes set; the rest at their defaults) */
export const describePfSizes = (s: PfSizes | undefined): string =>
  PF_SIZE_KEYS.filter((k) => s?.[k] !== undefined)
    .map((k) => `${PF_SIZE[k].word} ${s![k]}${PF_SIZE[k].unit}`)
    .join(", ");
