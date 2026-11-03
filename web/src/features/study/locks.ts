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
const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;

/** "folds +15 pts to bets, bluffs -50%" (exploit.py describe_lock's words). */
export function describeLock(l: Lock): string {
  return (Object.keys(LOCK_KEYS) as LockKey[])
    .filter((k) => l[k] !== undefined)
    .map((k) => WORDS[k](l[k]!))
    .join(", ");
}

/** The fields as typed: a lock (zero profile values dropped, as parse_locks drops them; null where nothing is set), or
 * what's wrong. */
export function lockOf(typed: Partial<Record<LockKey, string>>): { lock: Lock | null; problems: string[] } {
  const lock: Lock = {};
  const problems: string[] = [];
  for (const [k, label] of LOCK_FIELDS) {
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

/** Where a read can be locked: a heads-up node after the flop, solved, with its opponent named. */
export const offersLock = (r: { study?: unknown; street?: string; multiway?: boolean; opponent?: unknown; actor?: string }): boolean =>
  r.study === "node" && Boolean(r.street) && r.street !== "preflop" && !r.multiway && typeof r.opponent === "string" && Boolean(r.actor);

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
