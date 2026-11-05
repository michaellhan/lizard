// What the solver is asked next, and which table is in front. The solver answers one request at a time, so the Room
// keeps one in flight, and this says, from what the tables want, whether that one goes on, whether it stops, and what
// goes out once it's gone (multitable.js:263-276, :316-322, :381-391): what's instant first, then short solves, then a
// look-ahead at the table in front, then long solves, then the other tables' look-aheads. Everything waits on an
// estimate, which only ever orders the queue. Pure: the flight, its promise and the clock stay with the Room.
import type { AdvisorAction, AdvisorState } from "@/solver/protocol";
import type { SolveMode, StopCost, TransportKind } from "@/solver/types";
import type { Need } from "./flow";

/** seconds: an answer under INSTANT goes first; under SHORT it's a quick solve (the classic's) */
export const INSTANT = 0.5;
export const SHORT = 4;

export type Asked = Extract<Need, { key: string }>;

/** A request a table wants. `table`: its place in the Room. */
export interface Job {
  need: Asked;
  table: number;
  /** how long it should take, s */
  est: number;
  /** still dealing a drill's pot: the quick moves of a table nobody is playing yet */
  seeking: boolean;
  /** when it was first wanted, by the Room's clock, so a job isn't overtaken for ever */
  since: number;
  /** a look-ahead: its group, and its line's place among your likeliest (ahead.ts) */
  ahead?: { g: 3 | 5; rank: number };
}

/** The request in flight, as far as a plan reads it. `stopping`: stopped already, and not settled. */
export interface InFlight {
  job: Job;
  stopping: boolean;
}

export interface Plan {
  /** nobody needs the flight now, something instant or short waits behind a long one, or a real request behind a
   * look-ahead that's turned out long */
  stop: boolean;
  /** the job the flight is now, where it's still wanted (a look-ahead your move made real keeps its place as the real one) */
  same: Job | null;
  /** the request to send: only with nothing in flight, as a stopped request stays pending until it settles */
  launch: Job | null;
}

/** A street's solve as the requests on it share it: the street's own actions aren't in it, so a reply on a solved street
 * finds it (the classic reads `speed` off the state; a Lizard state carries none, so the mode is in here). */
export const streetKey = (q: AdvisorState, mode: SolveMode) => {
  const board = q.board ?? "";
  return JSON.stringify([q.hero, board, q.preflop, board.length >= 8 ? q.flop : 0, board.length >= 10 ? q.turn : 0, mode]);
};

/** Practice's quick answers, s. */
const QUICK = { flop: 2, turn: 2, river: 1.4 };

/** The pot was three-way or more as this street began and is down to two on it. The street's solve has nothing to say
 * then, your spot and a reply alike: each is a solve of its own, at the whole budget (advisor.py:5037-5044). */
function wentHeadsUp(q: AdvisorState): boolean {
  const lines = [q.preflop, q.flop, q.turn, q.river];
  const on = (q.board?.length ?? 0) / 2 - 2;
  const folds = (m: AdvisorAction[] = []) => m.filter((a) => a.action === "fold").length;
  const atStart = lines.slice(0, on).reduce((left, m) => left - folds(m), q.players);
  return atStart > 2 && atStart - folds(lines[on]) === 2;
}

/** How long a request takes, roughly (s). `solved`: the street keys its table's hand has had answered. `libFlop`: the
 * library holds this flop on this preflop line (flops.ts), which only ever orders the queue. */
export function estimate(q: AdvisorState, mode: SolveMode, solved: ReadonlySet<string>, transport: TransportKind, libFlop = false): number {
  const cards = (q.board?.length ?? 0) / 2;
  if (cards < 3) return 0.05; // a preflop chart
  if (solved.has(streetKey(q, mode)) && !wentHeadsUp(q)) return 0.2; // the street's solve is in hand (a reply reads it)
  if (cards === 3 && libFlop) return 0.3; // the library's
  const street = cards === 3 ? "flop" : cards === 4 ? "turn" : "river";
  if (mode !== "accurate") return QUICK[street];
  return (transport === "http" ? 30 : 60) * (street === "river" ? 0.4 : 1);
}

/** A request's priority group: 1 instant, 2 a short solve, 3 a look-ahead at the table in front, 4 a long solve, 5 the
 * other tables' look-aheads. A table still dealing a drill's pot is 2, however quick its moves are: it asks seat by seat
 * until its pot comes up, and would hold back everyone else's short solves. */
export const group = (j: Pick<Job, "est" | "seeking" | "ahead">) => (j.ahead ? j.ahead.g : j.seeking ? 2 : j.est < INSTANT ? 1 : j.est < SHORT ? 2 : 4);

const KIND = { you: 0, opp: 1, chart: 1 };

/** By group; then yours before an opponent's (look-aheads: the quickest, then your likeliest line); then the longest
 * wanted; then the table's place. */
export const byPriority = (a: Job, b: Job) =>
  group(a) - group(b) ||
  (a.ahead && b.ahead ? a.est - b.est || a.ahead.rank - b.ahead.rank : KIND[a.need.kind] - KIND[b.need.kind]) ||
  a.since - b.since ||
  a.table - b.table;

/** A table as the queue reads it. `since`: when it started waiting for you, null while it isn't; `over`: its hand has
 * ended. */
export interface Waiter {
  since: number | null;
  over: boolean;
}

/** The tables waiting for you, in the order they started waiting. */
export const queue = (tables: readonly Waiter[]) =>
  tables.flatMap((t, i) => (t.since === null ? [] : [i])).sort((a, b) => tables[a]!.since! - tables[b]!.since! || a - b);

/** The table in front. `focusAt`: when it came forward by itself; `pin`: you picked it; `next`: you've just acted. */
export interface Front {
  focus: number;
  focusAt: number;
  pin: boolean;
  next: boolean;
}

/** Kept while it waits for you, or you picked it; else the first in the queue. Right after you act, the first in the
 * queue, also when the table you acted at is waiting again at once: it waits behind the others (multitable.js:280-286). */
export function refocus(f: Front, tables: readonly Waiter[], now: number): Front {
  const t = tables[f.focus];
  if (t && !f.next && (t.since !== null || (f.pin && !t.over))) return f;
  const first = queue(tables)[0];
  const moved = first !== undefined && first !== f.focus;
  return { focus: moved ? first : f.focus, focusAt: moved ? now : f.focusAt, pin: false, next: false };
}

/** What happens to the flight, from what's wanted. A stop that costs a worker (`kills`) is paid only to get out of a
 * long solve nobody needs: a needed flight runs on, whatever waits behind it, and a short dead one runs out, as a
 * reboot would cost more. `late`: it went out as short and has run past SHORT, as a rare line the estimate can't see
 * coming does, so as a look-ahead it gives way to any real request, not just a short one. */
export function plan(flight: InFlight | null, jobs: readonly Job[], cost: StopCost, late = false): Plan {
  const all = [...jobs].sort(byPriority);
  if (!flight) return { stop: false, same: null, launch: all[0] ?? null };
  if (flight.stopping) return { stop: false, same: null, launch: null };
  const { key } = flight.job.need;
  const same = all.find((j) => j.need.key === key) ?? null;
  if (!same) return { stop: cost === "cheap" || flight.job.est >= SHORT, same, launch: null };
  const best = all.find((j) => j.need.key !== key);
  const yields = (!!best && group(best) <= 2 && group(same) >= 3) || (late && !!same.ahead && all.some((j) => !j.ahead));
  return { stop: yields && cost === "cheap", same, launch: null };
}
