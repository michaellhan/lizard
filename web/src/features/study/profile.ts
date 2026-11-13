// A player profile held across the tree (engine/profile_solve.py): every decision of the profiled player's is the
// equilibrium's mix with the profile laid on it by a fixed rule (gto/exploit.py TendencyLock), and the other player is
// re-solved against it, so their answer is the best response to the profile across the tree, not at one node (that's
// LockPanel's read). The profile is kept in Study's link (`prof`), so walking the line keeps it, a saved spot keeps it,
// and a link opens with it.
import type { ProfileSolveBlock } from "@/solver/protocol";
import { LOCK_PRESETS } from "./locks";

/** The engine's profile keys and bounds (gto/exploit.py LOCK_KEYS without next_*, which act at one node only). */
export const PROFILE_KEYS = {
  fold: [-100, 100],
  fold_flop: [-100, 100],
  fold_turn: [-100, 100],
  fold_river: [-100, 100],
  bluff: [-100, 100],
  bet: [-100, 100],
  raise: [-100, 100],
} as const;
export type ProfileKey = keyof typeof PROFILE_KEYS;
export type Profile = Partial<Record<ProfileKey, number>>;

/** The fields and what each changes. */
export const PROFILE_FIELDS: [ProfileKey, string, string][] = [
  ["fold", "Folds to bets ±", "points more of their range folding facing a first bet, every street (negative: calls more)"],
  ["fold_flop", "… on the flop ±", "added to the above on the flop only"],
  ["fold_turn", "… on the turn ±", "added on the turn only"],
  ["fold_river", "… on the river ±", "added on the river only"],
  ["bluff", "Bluffs ±%", "bets from their weak hands: −100 never, +100 always"],
  ["bet", "Bets ±%", "every hand's betting when they can bet: −50 halves it, +50 bets half their checks"],
  ["raise", "Raises ±%", "raising a bet, likewise (to and from calls)"],
];

/** What Study holds: whose profile, its numbers, and over which streets ("street": this street's solve, the ranges
 * entering it the equilibrium's; "hand": every solve of the hand after the flop). */
export interface StudyProfile {
  seat: string;
  adj: Profile;
  streets: "street" | "hand";
}

/** The link parameter. */
export const PROF = "prof";

const more = (verb: string, from: string) => (v: number) => (v < 0 ? `${verb} ${-v}% less` : `${verb} ${v}% of ${from}`);
const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;
const WORDS: Record<ProfileKey, (v: number) => string> = {
  fold: (v) => `folds ${signed(v)} pts to a first bet`,
  fold_flop: (v) => `${signed(v)} pts more on the flop`,
  fold_turn: (v) => `${signed(v)} pts more on the turn`,
  fold_river: (v) => `${signed(v)} pts more on the river`,
  bluff: more("bluffs", "its weak checks"),
  bet: more("bets", "its checks"),
  raise: more("raises", "its calls"),
};

/** "folds +15 pts to a first bet, bluffs 50% less". */
export const describeProfile = (p: Profile): string =>
  (Object.keys(PROFILE_KEYS) as ProfileKey[])
    .filter((k) => p[k] !== undefined)
    .map((k) => WORDS[k](p[k]!))
    .join(", ");

/** The fields as typed: a profile (zeros dropped; null where nothing's set), or what's wrong. */
export function profileOf(typed: Partial<Record<ProfileKey, string>>): { profile: Profile | null; problems: string[] } {
  const profile: Profile = {};
  const problems: string[] = [];
  for (const [k, label] of PROFILE_FIELDS) {
    const t = (typed[k] ?? "").trim();
    if (!t) continue;
    const x = Number(t);
    const [lo, hi] = PROFILE_KEYS[k];
    const name = label.replace(/^…\s*/, "").replace(/\s*(±%?|%)$/, "");
    if (!Number.isFinite(x)) problems.push(`${name}: a number`);
    else if (x < lo || x > hi) problems.push(`${name} must be ${lo} to ${hi}`);
    else if (x !== 0) profile[k] = x;
  }
  return { profile: Object.keys(profile).length ? profile : null, problems };
}

export const toProfileFields = (p: Profile): Partial<Record<ProfileKey, string>> => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));

/** The preset these numbers are, if any. */
export const profilePreset = (p: Profile): string | null =>
  Object.keys(LOCK_PRESETS).find((k) => JSON.stringify(Object.entries(LOCK_PRESETS[k]![1]).sort()) === JSON.stringify(Object.entries(p).sort())) ?? null;

/** The profile as the link holds it: "BTN:fold=-20,bluff=-50" with ";hand" where it's held from the flop. */
export function profileParam(p: StudyProfile): string {
  const nums = (Object.keys(PROFILE_KEYS) as ProfileKey[])
    .filter((k) => p.adj[k] !== undefined)
    .map((k) => `${k}=${p.adj[k]}`)
    .join(",");
  return `${p.seat}:${nums}${p.streets === "hand" ? ";hand" : ""}`;
}

/** The link's profile; null where it's absent or doesn't read as one. */
export function parseProfile(s: string | null | undefined): StudyProfile | null {
  if (!s) return null;
  const m = /^([A-Z0-9+]{2,5}):([^;]*)(?:;(hand|street))?$/.exec(s.trim());
  if (!m) return null;
  const adj: Profile = {};
  for (const part of m[2]!.split(",").filter(Boolean)) {
    const [k, v] = part.split("=");
    if (!k || v === undefined || !Object.hasOwn(PROFILE_KEYS, k)) return null;
    const x = Number(v);
    const [lo, hi] = PROFILE_KEYS[k as ProfileKey];
    if (!Number.isFinite(x) || x < lo || x > hi) return null;
    if (x !== 0) adj[k as ProfileKey] = x;
  }
  if (!Object.keys(adj).length) return null;
  return { seat: m[1]!, adj, streets: m[3] === "hand" ? "hand" : "street" };
}

/** A line's link with the profile kept on it, so a new node keeps it (as `vs`, sideBySideLink.ts keepVs). */
export function keepProfile(search: string, prof: string | null): string {
  if (!prof) return search;
  const q = new URLSearchParams(search);
  q.set(PROF, prof);
  return q.toString();
}

/** Why there's no profile re-solve at this node, in words; null where there can be one. */
export function profileRefusal(r: { street?: string; multiway?: boolean; fallback?: unknown; actor?: string; opponent?: unknown; actions?: unknown[]; players?: unknown }, tournament: boolean): string | null {
  if (r.street === "preflop") return "Profiles are re-solved after the flop: preflop is the charts or a separate solve.";
  if (r.multiway) return "Profile re-solves are heads-up: this pot has more than two players in it.";
  if (tournament) return "Profile re-solves are for cash games: a tournament's payoffs aren't zero-sum, and holding a profile hasn't been checked on them.";
  if (r.fallback) return "No solve answers this node (the betting rules do), so there's no tree to re-solve.";
  if (!r.actor || typeof r.opponent !== "string") return "Nobody acts here.";
  return null;
}

const bb = (x: number) => `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(2)}bb`;

/** The street's values in words: the exploiting player's at equilibrium, their equilibrium strategy against the
 * profile, and the re-solved exploit, all on one tree and one pair of ranges (bb per dealt pair at the street's root). */
export function valueRows(b: ProfileSolveBlock): { label: string; value: string; note?: string }[] {
  const v = b.values;
  const who = b.exploiter;
  return [
    { label: `${who} at equilibrium (both play it)`, value: bb(v.eq) },
    { label: `${who}'s equilibrium strategy against the profile`, value: bb(v.eq_vs_profile), note: `what not adjusting earns: ${bb(v.eq_vs_profile - v.eq)} on equilibrium` },
    { label: `${who}'s re-solved exploit against the profile`, value: bb(v.exploit), note: `${bb(v.exploit - v.eq_vs_profile)} more than not adjusting; a best response to the profile computed apart: ${bb(v.best_response)}` },
    { label: `${b.seat} playing the profile, against the exploit`, value: bb(v.profiled.exploited), note: `at equilibrium: ${bb(v.profiled.eq)}` },
  ];
}

/** How far the re-solve got, in words. */
export function convergenceWords(b: ProfileSolveBlock): string {
  const c = b.convergence;
  const gain = Math.max(c.gain_pct, 0);
  return `${b.exploiter}'s best response still gains ${gain.toFixed(gain < 0.01 ? 4 : 2)}% of the pot against the profile after ${c.iterations} iterations (${c.seconds.toFixed(1)} s): the re-solve is that best response to within this.`;
}

/** The hand classes whose play moved most between the two answers (by the largest change of any action, weighted by
 * the class's weight in the exploit's range), at most `n`. */
export function movedClasses(b: ProfileSolveBlock, n = 8): { cls: string; eq: number[]; ex: number[]; moved: number; evEq: number | null; evEx: number | null }[] {
  const rows = Object.entries(b.classes)
    .filter(([, c]) => c.eq && c.ex)
    .map(([cls, c]) => {
      const moved = Math.max(...c.ex!.map((f, i) => Math.abs(f - (c.eq![i] ?? 0))));
      return { cls, eq: c.eq!, ex: c.ex!, moved, w: Math.max(c.w, c.w_ex), evEq: c.ev_eq, evEx: c.ev_ex };
    })
    .filter((r) => r.moved >= 0.05)
    .sort((a, b) => b.moved * b.w - a.moved * a.w)
    .slice(0, n);
  return rows.map(({ w: _w, ...r }) => r);
}
