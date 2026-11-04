// Asking ahead: while you decide, the lines you're likeliest to take are played on to the next thing that needs the
// solver, an opponent's reply or your next spot, and that's asked now, so its answer is there if you take the line
// (practice.js:215-248, multitable.js:288-314). It's the identical request: `walk` plays a line with the moves the table
// itself will make, so its key is the one the table will want and the answer grades the same, under its own provenance.
// Nothing else of it reaches a grade, the session or History, and a line that fails says nothing of your table: only
// `walk` reads what failed. The caches are looked at and never taken from, as the table takes a drawn move once. No seed
// is used and nothing is dealt, so a look-ahead leaves every deal as it was. All this is pure but for the habits' reads and
// writes: the Room owns the flights, the caches and when any of it runs, and scheduler.ts says what goes first.
import { kindOf } from "@/components/actions";
import type { AdvisorResponse, PlayMove } from "@/solver/protocol";
import type { SolveMode, SolveResult } from "@/solver/types";
import { moveOf, needOf } from "./flow";
import { dealNext, decide, facingBet, optionsOf, simOf, withVillain, type PracticeHand } from "./practice";
import { SHORT, type Asked, type Job } from "./scheduler";

/** Whether Practice asks ahead until you say (Settings' `askAhead` null). Off until the engine check's four runs have
 * measured what it saves: there's no hit rate yet. */
export const ASK_AHEAD: boolean = false;

/** The lines played on from a spot, how likely each must be, the decisions of a kind before they count, and the steps a
 * line may take to its next request. */
const AHEAD_LINES = 2;
const AHEAD_MIN = 0.2;
const HABIT_MIN = 5;
const WALK_STEPS = 24;
/** the look-aheads' failures held (multitable.js:360) */
const BAD_KEEP = 500;

const HABITS_KEY = "lizard.practiceHabits.v1";

type HabitKind = "fold" | "pass" | "aggr";
type HabitCounts = Record<HabitKind, number>;

/** What you've done, by whether you were facing a bet. */
export interface Habits {
  facing?: HabitCounts;
  open?: HabitCounts;
}

function habitKind(action: string): HabitKind {
  const k = kindOf(action);
  return k === "fold" ? "fold" : k === "check" || k === "call" ? "pass" : "aggr";
}

/** The habits with one more decision: `action` taken, facing a bet or not. */
export function habit(h: Habits, facing: boolean, action: string): Habits {
  const was = h[facing ? "facing" : "open"] ?? { fold: 0, pass: 0, aggr: 0 };
  const k = habitKind(action);
  return { ...h, [facing ? "facing" : "open"]: { ...was, [k]: was[k] + 1 } };
}

const countsOf = (x: unknown): HabitCounts | undefined => {
  const c = x as Partial<HabitCounts> | null | undefined;
  return c && [c.fold, c.pass, c.aggr].every((n) => typeof n === "number" && n >= 0 && n < Infinity) ? (c as HabitCounts) : undefined;
};

/** What this browser has kept: nothing where it keeps nothing, or what's there can't be read. */
export function readHabits(): Habits {
  try {
    const x = JSON.parse(localStorage.getItem(HABITS_KEY) ?? "null") as Habits | null;
    return { facing: countsOf(x?.facing), open: countsOf(x?.open) };
  } catch {
    return {};
  }
}

export function saveHabits(h: Habits): void {
  try {
    localStorage.setItem(HABITS_KEY, JSON.stringify(h));
  } catch {
    // (kept for this page's life)
  }
}

/** A line: the answer's i-th option, and how likely you are to take it. */
export interface Likely {
  i: number;
  p: number;
}

/** Your likeliest options at a spot, first the likeliest: the answer's mix for your hand, blended half and half with what
 * you usually do once you've decided that kind of spot HABIT_MIN times. Up to AHEAD_LINES, each at least AHEAD_MIN likely,
 * and never a fold, which ends your hand, or a size the answer doesn't give. */
export function likely(res: AdvisorResponse, facing: boolean, habits: Habits): Likely[] {
  const actions = optionsOf(res);
  const seen = habits[facing ? "facing" : "open"];
  const n = seen ? seen.fold + seen.pass + seen.aggr : 0;
  const byKind: HabitCounts = { fold: 0, pass: 0, aggr: 0 };
  for (const a of actions) byKind[habitKind(a.action)] += a.freq ?? 0;
  return actions
    .flatMap((a, i) => {
      const kind = kindOf(a.action);
      const k = habitKind(a.action);
      if (kind === "fold" || kind === (facing ? "check" : "call") || (k === "aggr" && kind !== "all-in" && typeof a.amount_bb !== "number")) return [];
      const freq = a.freq ?? 0;
      const p = seen && n >= HABIT_MIN ? 0.5 * freq + 0.5 * (seen[k] / n) * (byKind[k] > 0 ? freq / byKind[k] : 0) : freq;
      return p >= AHEAD_MIN ? [{ i, p }] : [];
    })
    .sort((a, b) => b.p - a.p)
    .slice(0, AHEAD_LINES);
}

/** What a walk sees of the Room's caches, and only sees: `bad`, the look-aheads that failed, which nothing else reads. */
export interface Peek {
  adv: { has(key: string): boolean };
  moves: { get(key: string): Pick<SolveResult<PlayMove>, "data"> | undefined };
  bad: { has(key: string): boolean };
}

/** A look-ahead that failed, for walks to pass over from now on. Past BAD_KEEP they all get another chance. */
export function noteBad(bad: Set<string>, key: string): void {
  bad.add(key);
  if (bad.size > BAD_KEEP) bad.clear();
}

/** Option `i` taken at your spot and the hand played on, the way a table plays it, up to the next request nobody has
 * answered: an opponent's move, or your next spot. Null where the line needs nothing more: its hand ends, your next spot is
 * in hand, that request has failed as a look-ahead, or a move on it couldn't be taken, which stops a table too. */
export function walk(h: PracticeHand, answer: Pick<SolveResult, "data" | "provenance">, i: number, mode: SolveMode, peek: Peek): Asked | null {
  const first = decide(h, answer.data, i, answer.provenance);
  if ("error" in first) return null;
  let at = first.hand;
  for (let n = 0; n < WALK_STEPS; n += 1) {
    const sim = simOf(at);
    const need = needOf(at, mode, sim);
    if (need.kind === "deal") {
      at = dealNext(at, need.street);
    } else if (need.kind === "you") {
      return peek.adv.has(need.key) || peek.bad.has(need.key) ? null : need;
    } else if (need.kind === "opp") {
      const mv = peek.moves.get(need.key)?.data;
      if (!mv) return peek.bad.has(need.key) ? null : need;
      const { move, fallback } = moveOf(at, mv, sim);
      if (fallback) return null;
      at = withVillain(at, move, sim);
    } else return null;
  }
  return null;
}

/** A table waiting for you: your turn, with the answer in hand. */
export interface Waiting {
  table: number;
  hand: PracticeHand;
  answer: SolveResult;
}

export interface AheadContext extends Peek {
  mode: SolveMode;
  focus: number;
  habits: Habits;
  /** the keys the tables want for real: those are asked as what they are, never as a look-ahead */
  real: ReadonlySet<string>;
  /** how long it should take, s; and when it was first wanted */
  est(table: number, need: Asked): number;
  since(key: string): number;
}

/** What's asked ahead, for the tables waiting for you: each likely line's next request that's short, in group 3 at the
 * table in front and 5 at the others (multitable.js:307-314). */
export function aheadJobs(waiting: readonly Waiting[], c: AheadContext): Job[] {
  const out: Job[] = [];
  const keys = new Set(c.real);
  for (const { table, hand, answer } of waiting) {
    const facing = facingBet(simOf(hand), hand.hero);
    likely(answer.data, facing, c.habits).forEach(({ i }, rank) => {
      const need = walk(hand, answer, i, c.mode, c);
      if (!need || keys.has(need.key)) return;
      const est = c.est(table, need);
      if (est >= SHORT) return;
      keys.add(need.key);
      out.push({ need, table, est, seeking: false, since: c.since(need.key), ahead: { g: table === c.focus ? 3 : 5, rank } });
    });
  }
  return out;
}

/** How asking ahead has gone in this browser, measured: the look-aheads that went out, those a table used, the waiting
 * that saved (s) and the solver's time they took (s), stopped ones included. */
export interface AheadMeter {
  asked: number;
  used: number;
  savedS: number;
  spentS: number;
}

export const NO_METER: AheadMeter = { asked: 0, used: 0, savedS: 0, spentS: 0 };

/** "31 of 52 used · about 44 s of waiting saved for 96 s of solver time" */
export const meterLine = (m: AheadMeter) => `${m.used} of ${m.asked} used · about ${Math.round(m.savedS)} s of waiting saved for ${Math.round(m.spentS)} s of solver time`;
