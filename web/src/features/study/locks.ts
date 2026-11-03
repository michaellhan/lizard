// Node locks (ROADMAP Phase 6): a read on the heads-up opponent after the flop, sent as the engine's "locks"
// ({seat: {key: number}}; gto/exploit.py LOCK_KEYS and parse_locks; the classic page's LOCK_PRESETS, LOCK_INPUTS have
// the same numbers) with one hand's advice, since Study drops locks (advisor.py STUDY_DROPS). The answer is the best
// response to the locked tendency (Advisor._advise_at's exploit branch): each hand's highest-EV action against it, the
// equilibrium's frequency beside each (gto_freq), and the range's best response as its grid. Never an equilibrium
// re-solve: the label says so wherever it shows.
// (no Study state here: provenance.ts reads describeLock)
import type { AdvisorState } from "@/solver/protocol";

export const LOCK_KEYS = {
  fold: [-100, 100],
  bluff: [-100, 100],
  bet: [-100, 100],
  raise: [-100, 100],
  next_fold: [0, 100],
  next_raise: [0, 100],
  next_bet: [0, 100],
} as const;
export type LockKey = keyof typeof LOCK_KEYS;
export type Lock = Partial<Record<LockKey, number>>;

/** The fields, as the classic page's (LOCK_INPUTS, with next_raise), and what each changes (exploit.py's comments). */
export const LOCK_FIELDS: [LockKey, string, string][] = [
  ["fold", "Folds to bets ±", "points more of their range folding facing a first bet (negative: calls more)"],
  ["bluff", "Bluffs ±%", "bets from their weak hands: −100 never, +100 always"],
  ["bet", "Bets ±%", "every hand's betting when they can bet: −50 halves it, +50 bets half their checks"],
  ["raise", "Raises ±%", "raising a bet, likewise (to and from calls)"],
  ["next_fold", "Next: folds %", "% of their range folding at their next decision, facing your bet or raise"],
  ["next_raise", "Next: raises %", "% raising there"],
  ["next_bet", "Next: bets %", "% betting at their next decision when you check"],
];

/** Preflop, the profile keys act on the locked player's chart strategy (exploit.py LOCK_PREFLOP_KEYS, lock_preflop),
 * in their preflop words (LOCK_WORDS_PREFLOP); the street keys and next_* are for after the flop only. */
export const LOCK_FIELDS_PREFLOP: [LockKey, string, string][] = [
  ["fold", "Folds to raises ±", "points more of their range folding facing a raise, their weakest calls first, then their weakest raises (negative: calls more)"],
  ["bluff", "Bluff-raises ±%", "the bluffs among their raises facing a raise (under 45-50% equity when called): −100 none, +100 twice as many"],
  ["bet", "Opens ±%", "their first raise (an open, an iso-raise, the big blind's raise over limps) scaled: −50 opens half as much"],
  ["raise", "Re-raises ±%", "their 3bets, 4bets and 5bets scaled, to and from calls"],
];

/** The engine's presets (exploit.py LOCK_PRESETS; the classic page names them). */
export const LOCK_PRESETS: Record<string, [string, Lock]> = {
  station: ["Calling station", { fold: -20, bluff: -50, raise: -50 }],
  nit: ["Nit", { fold: 15, bluff: -60, bet: -25, raise: -30 }],
  maniac: ["Maniac", { fold: -10, bluff: 50, bet: 30, raise: 60 }],
  overfolder: ["Overfolds to bets", { fold: 15 }],
};

const WORDS: Record<LockKey, (v: number) => string> = {
  fold: (v) => `folds ${signed(v)} pts to bets`,
  bluff: (v) => `bluffs ${signed(v)}%`,
  bet: (v) => `bets ${signed(v)}%`,
  raise: (v) => `raises ${signed(v)}%`,
  next_fold: (v) => `folds ${v}% to your next bet`,
  next_raise: (v) => `raises ${v}% against your next bet`,
  next_bet: (v) => `bets ${v}% when you check`,
};
const WORDS_PREFLOP: Partial<Record<LockKey, (v: number) => string>> = {
  fold: (v) => `folds ${signed(v)} pts to raises`,
  bluff: (v) => `bluff-raises ${signed(v)}%`,
  bet: (v) => `opens ${signed(v)}%`,
  raise: (v) => `re-raises ${signed(v)}%`,
};
const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;

/** "folds +15 pts to bets, bluffs -50%" (exploit.py describe_lock's words; preflop, the keys that act there in theirs:
 * "folds +15 pts to raises, re-raises -30%"). */
export function describeLock(l: Lock, preflop = false): string {
  return (Object.keys(LOCK_KEYS) as LockKey[])
    .filter((k) => l[k] !== undefined && (!preflop || WORDS_PREFLOP[k]))
    .map((k) => (preflop ? WORDS_PREFLOP[k]! : WORDS[k])(l[k]!))
    .join(", ");
}

/** The fields as typed: a lock (zero profile values dropped, as parse_locks drops them; null where nothing is set), or
 * what's wrong. */
export function lockOf(typed: Partial<Record<LockKey, string>>, preflop = false): { lock: Lock | null; problems: string[] } {
  const lock: Lock = {};
  const problems: string[] = [];
  for (const [k, label] of preflop ? LOCK_FIELDS_PREFLOP : LOCK_FIELDS) {
    const t = (typed[k] ?? "").trim();
    if (!t) continue;
    const x = Number(t);
    const [lo, hi] = LOCK_KEYS[k];
    const name = label.replace(/\s*(±%?|%)$/, "");
    if (!Number.isFinite(x)) problems.push(`${name}: a number`);
    else if (x < lo || x > hi) problems.push(`${name} must be ${lo} to ${hi}`);
    else if (x !== 0 || k.startsWith("next_")) lock[k] = x;
  }
  return { lock: Object.keys(lock).length ? lock : null, problems };
}

export const presetOf = (l: Lock): string | null =>
  Object.keys(LOCK_PRESETS).find((k) => JSON.stringify(Object.entries(LOCK_PRESETS[k]![1]).sort()) === JSON.stringify(Object.entries(l).sort())) ?? null;

/** Where a read can be locked: a heads-up node after the flop, solved, with its opponent named (the engine locks
 * heads-up only after the flop), or a preflop node (on the charts). */
export const offersLock = (r: { study?: unknown; street?: string; multiway?: boolean; opponent?: unknown; actor?: string }): boolean =>
  r.study === "node" &&
  Boolean(r.actor) &&
  (r.street === "preflop" || ((r.street === "flop" || r.street === "turn" || r.street === "river") && !r.multiway && typeof r.opponent === "string"));

/** Whom a read can be on: after the flop the opponent; preflop every seat still in but the player to act. */
export function lockSeats(seats: readonly string[], preflop: { pos: string; action: string }[], r: { street?: string; actor?: string; opponent?: unknown }): string[] {
  if (r.street !== "preflop") return typeof r.opponent === "string" ? [r.opponent] : [];
  const out = new Set(preflop.filter((a) => a.action === "fold").map((a) => a.pos));
  return seats.filter((p) => p !== r.actor && !out.has(p));
}

/** One hand's advice at the node: Study's request (studyRequest) out of Study mode, the engine's advise. */
export function handRequest(study: AdvisorState, hero: string, hole: string): AdvisorState {
  const st: AdvisorState = { ...study, hero, hole };
  delete st.study;
  return st;
}

/** The hand's advice against the read or, with none, at equilibrium. */
export function lockRequest(study: AdvisorState, hero: string, hole: string, opponent: string, lock: Lock | null): AdvisorState {
  const st = handRequest(study, hero, hole);
  return lock ? { ...st, locks: { [opponent]: { ...lock } } } : st;
}
