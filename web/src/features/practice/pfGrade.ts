// A preflop decision graded by the stored preflop solve (solver/gto/pf_study.py), a session's choice, in place of the
// charts' frequency grade. The solve is an equilibrium of a simplified game: 169 hand classes and one size at each raise.
// Your buttons stay the chart's and the opponents go on playing the charts, so turning this on changes no move, only the
// grade; and the opponents leave the solve's tree (the blinds' chart 3-bets to 10bb, the solve's to 12bb).
//
// So whether a decision is graded by EV is settled at the spot, before you choose, and never by what you chose: `pfRead`
// answers only where the solve's node is this very spot, the same chips in and the same options at the same sizes, with a
// class of yours still in its range. Anywhere else the decision keeps the chart's frequency grade under the chart's own
// label, and `pfWhy` says why in words. A size is never mapped onto the solve's: an EV of raising to 12bb isn't one of
// raising to 10bb. docs/ACCURACY.md has how often each happens, by scripts/pf_practice_coverage.py.
//
// A session can go the other way (`pfSizes`, its own tick box): at a spot the solve would grade but for your raise's size,
// the button is offered at the solve's size, so it's the move that changes, not the EV. The opponents still play the charts,
// and that raise is no longer the chart's, so the hand leaves the flop library, whose lines are kept by size.
//
// Analyze asks the same of a kept hand (`pfReadAt`), so a decision has one grade. A site's hand had no buttons, so what can
// be asked of it is the move it made (`pfPlayed`).
import { kindOf } from "@/components/actions";
import { classOf } from "@/engine/nlhe/cards";
import { behind, recordOf, type Move, type Sim, type TableSetup } from "@/poker/table";
import type { AdvisorActionStat, AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { bb } from "@/components/actions";
import type { GradeCell } from "@/features/history/history";
import { shareText } from "@/features/history/progress";
import { optionsOf, setupOf, simOf, type Decision, type PracticeHand } from "./practice";

/** What the worker answered at the node, or why it didn't. */
export type PfAsked = SolveResult | { failed: string };
/** The chart's answer at your spot, and the solve's where the hand is graded by it. */
export type HeldAnswer = SolveResult & { pf?: PfAsked };

/** What every grade from the solve is labelled with: it's no full solve, and it's said at the table and at a retry alike. */
export const PF_MODEL = "equilibrium of a simplified class-level preflop game, not a full solve";

/** the size the engine calls one (pf_study.Solve.walk), and a chip's width in the pot */
const SIZE_EPS = 0.051;
const CHIP_EPS = 0.011;

const chart = (why: string) => ({ why });
const sizes = (xs: readonly { action: string; to?: number | null }[]) => xs.map((x) => (typeof x.to === "number" ? `${x.action} ${x.to}bb` : x.action)).join(", ");

type NodeRead = { node: AdvisorResponse; provenance: Provenance; f: number[]; ev: number[] } | { why: string };

/** The solve's answer for this class at the node asked, or why there's none to grade by. Nothing here reads the table. */
function readNode(asked: PfAsked | undefined, seat: string, hole: string): NodeRead {
  if (!asked) return chart("The preflop solve wasn't asked here.");
  if ("failed" in asked) return chart(`The preflop solve couldn't be read: ${asked.failed}.`);
  const { data: node, provenance } = asked;
  if (node.error) return chart(`The solve's tree doesn't hold this line: ${node.error}`);
  if (node.study !== "node" || provenance.source !== "preflop-solve") return chart("The preflop solve has no decision here.");
  const st = node.pf_solve as { stored?: unknown; done?: unknown } | undefined;
  if (st?.stored !== true || st.done !== true) return chart("The answer wasn't the stored preflop solve.");
  if (node.actor !== seat) return chart("The solve's tree has another seat to act here.");
  const moved = node.notes?.find((n) => n.includes("played as the solve's size"));
  if (moved) return chart(`The line has left the solve's sizes: ${moved}.`);
  if (node.rough) return chart("This is a line the solve rarely plays, so its EVs here are rough.");
  const cell = node.grid?.cells[classOf(hole)];
  if (!cell) return chart(`The solve has folded ${classOf(hole)} from this seat by here, so it holds no EV for it.`);
  const { f, ev } = cell;
  if (!ev || ev.some((x) => typeof x !== "number")) return chart("The solve holds no EV for your hand's class here.");
  return { node, provenance: { ...provenance, approximate: true, approximateLabel: PF_MODEL }, f, ev };
}

/** Each of your options' place among the node's actions: null unless they're the same options, kind and size, both ways
 * (`anySize`: kind only, where your raise is about to take the node's size). */
function lineUp(moves: readonly { action: string; to?: number | null }[], actions: readonly AdvisorActionStat[], anySize = false): number[] | null {
  if (moves.length !== actions.length) return null;
  const at = moves.map((m) => actions.findIndex((a) => a.action === m.action && (anySize || m.action !== "raise" || Math.abs((m.to ?? NaN) - (a.amount_bb ?? NaN)) <= SIZE_EPS)));
  return at.includes(-1) || new Set(at).size !== at.length ? null : at;
}

/** The solve's answer as your options': yours in their order and with their names, its numbers for your class. */
const asOptions = (read: Extract<NodeRead, { node: unknown }>, options: readonly Pick<AdvisorActionStat, "action" | "amount_bb">[], at: readonly number[]): AdvisorResponse => ({
  ...read.node,
  actions: options.map((o, i) => ({ action: o.action, ...(typeof o.amount_bb === "number" ? { amount_bb: o.amount_bb } : {}), freq: read.f[at[i]!]!, ev_bb: read.ev[at[i]!]! })),
});

export type PfRead = { data: AdvisorResponse; provenance: Provenance } | { why: string };

/** A decision as the solve's read needs it, from a hand at the table or kept. `ownSizes`: the session's `pfSizes`. */
export interface PfSpot {
  hero: string;
  hole: string;
  sim: Sim;
  table: TableSetup;
  ownSizes?: boolean;
  /** the session's `pfOptions`: where the solve reads the spot, your options are the solve's own */
  ownOptions?: boolean;
}

/** The chips in aren't the tree's, in words; null where they are. An all-in with no size is walked onto the tree's raise
 * with no note: the chips are what tell. A tournament's tree plays a jam no one still in can call to the deepest of them
 * (`uncalled_bb`, off the table's pot), and a call for more than you have is your all-in, on the table as on the tree. */
function chipsOff({ sim, hero, table }: PfSpot, node: AdvisorResponse): string | null {
  const toCall = Math.min((sim.cur?.curBet ?? 0) - (sim.cur?.bets[hero] ?? 0), behind(table, sim, hero));
  const pot = sim.pot - (typeof node.uncalled_bb === "number" ? node.uncalled_bb : 0);
  if (Math.abs((node.pot_bb ?? NaN) - pot) <= CHIP_EPS && Math.abs((node.to_call_bb ?? NaN) - toCall) <= CHIP_EPS) return null;
  return `The chips in aren't the solve's: the pot is ${sim.pot}bb here and ${node.pot_bb}bb on its tree.`;
}

/** The solve's grade at a spot, as an answer `decide` takes, or why it's the chart's. `res`: the chart's answer. */
export function pfReadAt(spot: PfSpot, res: AdvisorResponse, asked: PfAsked | undefined): PfRead {
  const read = readNode(asked, spot.hero, spot.hole);
  if ("why" in read) return read;
  const { node } = read;
  const off = chipsOff(spot, node);
  if (off) return chart(off);
  if (spot.ownOptions) {
    const acts = node.actions ?? [];
    return { data: asOptions(read, acts, acts.map((_, i) => i)), provenance: read.provenance };
  }
  const options = optionsOf(res);
  const moves = options.map((a) => recordOf(spot.table, spot.sim, { action: kindOf(a.action), to: typeof a.amount_bb === "number" ? a.amount_bb : undefined, clamp: true }));
  const table = moves.flatMap((m) => (typeof m === "string" ? [] : [m]));
  const whole = table.length === moves.length;
  const at = whole ? lineUp(table, node.actions ?? []) : null;
  if (at) return { data: asOptions(read, options, at), provenance: read.provenance };
  const own = whole && spot.ownSizes ? lineUp(table, node.actions ?? [], true) : null;
  if (own) return { data: asOptions(read, options.map((o, i) => (kindOf(o.action) === "raise" ? { ...o, amount_bb: node.actions![own[i]!]!.amount_bb } : o)), own), provenance: read.provenance };
  const its = (node.actions ?? []).map((a) => ({ action: a.action, to: a.amount_bb }));
  return chart(`The solve's options aren't yours here: you have ${sizes(table)}, and it has ${sizes(its)}.`);
}

/** A hand at the table's spot (`pfReadAt`). */
export function pfRead(h: PracticeHand, res: AdvisorResponse, asked: PfAsked | undefined, sim: Sim = simOf(h)): PfRead {
  return pfReadAt({ hero: h.hero, hole: h.hands[h.hero]!.join(""), sim, table: setupOf(h), ownSizes: h.pfSizes, ownOptions: h.pfOptions }, res, asked);
}

/** A site's hand: no buttons were offered, so there are no options to line up, and what the solve can say of it is the move
 * made. It reads where the node is this spot and holds that move, a raise at its own size: an EV of a raise to 12bb isn't one
 * of a raise to 11bb. So here, unlike the table, the size you raised to can leave a decision with the chart. */
export function pfPlayed(spot: PfSpot, m: Move, asked: PfAsked | undefined): PfRead {
  const read = readNode(asked, spot.hero, spot.hole);
  if ("why" in read) return read;
  const { node } = read;
  const off = chipsOff(spot, node);
  if (off) return chart(off);
  const actions = node.actions ?? [];
  if (!lineUp([m], actions.filter((a) => a.action === m.action))) return chart(`The solve has no such move here: you played ${sizes([m])}, and it has ${sizes(actions.map((a) => ({ action: a.action, to: a.amount_bb })))}.`);
  return { data: asOptions(read, actions, actions.map((_, i) => i)), provenance: read.provenance };
}

/** What a decision at this spot is graded on: the solve's answer where it reads, else the chart's, with why. */
export function gradedOn(h: PracticeHand, held: HeldAnswer, sim: Sim = simOf(h)): Pick<SolveResult, "data" | "provenance"> & { pfWhy?: string } {
  if (!h.pfSolve || sim.current !== "preflop") return held;
  const read = pfRead(h, held.data, held.pf, sim);
  return "why" in read ? { data: held.data, provenance: held.provenance, pfWhy: read.why } : read;
}

/** Your options at a spot: the answer's, at the solve's sizes where the session offers them, or the solve's own in a stored
 * tournament preset (`pfOptions`). */
export function optionsAt(h: PracticeHand, held: HeldAnswer | null | undefined, sim: Sim = simOf(h)): AdvisorActionStat[] {
  return held ? optionsOf(h.pfSizes || h.pfOptions ? gradedOn(h, held, sim).data : held.data) : [];
}

/** A retry of a decision graded by the solve: the same read, of the answer asked now, against the options and pot kept with
 * the decision. Anything it can't answer the same way it refuses, in words: a retry never falls back to the charts, as the
 * first grade was the solve's. */
export function pfAgain(asked: SolveResult, state: Pick<AdvisorState, "hero" | "hole">, kept: Decision["mix"] | undefined, pot: number): PfRead {
  const read = readNode(asked, state.hero ?? "", state.hole ?? "");
  if ("why" in read) return read;
  const options = (kept ?? read.node.actions ?? []).map((a) => ("amount_bb" in a ? a : { action: a.action, ...(a.amount !== undefined ? { amount_bb: a.amount } : {}) }));
  if (Math.abs((read.node.pot_bb ?? NaN) - pot) > CHIP_EPS) return chart(`The solve's pot here is ${read.node.pot_bb}bb now, and it was ${pot}bb.`);
  const at = lineUp(options.map((o) => ({ action: kindOf(o.action), to: o.amount_bb })), read.node.actions ?? []);
  return at ? { data: asOptions(read, options, at), provenance: read.provenance } : chart("The solve's options here aren't the ones you had.");
}

/** A session's preflop decisions by what graded them, in words, each basis on its own: null with none graded. */
export function pfWords(cells: Record<string, GradeCell> | undefined): string | null {
  const pre = Object.values(cells ?? {}).filter((c) => c.street === "preflop");
  const add = (cs: GradeCell[]) => cs.reduce((a, c) => ({ n: a.n + c.n, ok: a.ok + c.ok, loss: a.loss + c.loss }), { n: 0, ok: 0, loss: 0 });
  const solve = add(pre.filter((c) => c.byEv)), charts = add(pre.filter((c) => !c.byEv));
  if (!solve.n && !charts.n) return null;
  const a = `${solve.n} by the preflop solve, by EV${solve.n ? ` (${shareText(solve.ok, solve.n)} Best or Correct, ${bb(solve.loss / solve.n)}bb lost a decision)` : ""}`;
  const b = `${charts.n} by the charts, by frequency, no EV${charts.n ? ` (${shareText(charts.ok, charts.n)} Best or Correct)` : ""}`;
  return `Preflop so far: ${a}; ${b}.`;
}
