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
import { kindOf } from "@/components/actions";
import { classOf } from "@/engine/nlhe/cards";
import type { Sim } from "@/poker/table";
import type { AdvisorActionStat, AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { bb } from "@/components/actions";
import type { GradeCell } from "@/features/history/history";
import { shareText } from "@/features/history/progress";
import { moveOfOption, optionsOf, simOf, type Decision, type PracticeHand } from "./practice";

/** What the worker answered at the node, or why it didn't. */
export type PfAsked = SolveResult | { failed: string };
/** The chart's answer at your spot, and the solve's where the hand is graded by it. */
export type HeldAnswer = SolveResult & { pf?: PfAsked };

/** What every grade from the solve is labelled with: it's no full solve, and it's said at the table and at a retry alike. */
export const PF_MODEL = "equilibrium of a simplified class-level preflop game, not a full solve";

/** Said with a decision graded by the solve. */
export const PF_GRADED =
  "Graded by EV against the preflop solve, for your hand's class: an equilibrium of a simplified class-level game, not a full solve. Its EVs are against the ranges of its own equilibrium, while the opponents here play the charts, and the two disagree in places, so this says what that model thinks of the move, not what it won or lost at this table.";

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

/** Each of your options' place among the node's actions: null unless they're the same options, kind and size, both ways. */
function lineUp(moves: readonly { action: string; to?: number | null }[], actions: readonly AdvisorActionStat[]): number[] | null {
  if (moves.length !== actions.length) return null;
  const at = moves.map((m) => actions.findIndex((a) => a.action === m.action && (m.action !== "raise" || Math.abs((m.to ?? NaN) - (a.amount_bb ?? NaN)) <= SIZE_EPS)));
  return at.includes(-1) || new Set(at).size !== at.length ? null : at;
}

/** The solve's answer as your options': yours in their order and with their names, its numbers for your class. */
const asOptions = (read: Extract<NodeRead, { node: unknown }>, options: readonly Pick<AdvisorActionStat, "action" | "amount_bb">[], at: readonly number[]): AdvisorResponse => ({
  ...read.node,
  actions: options.map((o, i) => ({ action: o.action, ...(typeof o.amount_bb === "number" ? { amount_bb: o.amount_bb } : {}), freq: read.f[at[i]!]!, ev_bb: read.ev[at[i]!]! })),
});

export type PfRead = { data: AdvisorResponse; provenance: Provenance } | { why: string };

/** The solve's grade at your spot, as an answer `decide` takes, or why it's the chart's. `res`: the chart's answer. */
export function pfRead(h: PracticeHand, res: AdvisorResponse, asked: PfAsked | undefined, sim: Sim = simOf(h)): PfRead {
  const read = readNode(asked, h.hero, h.hands[h.hero]!.join(""));
  if ("why" in read) return read;
  const { node } = read;
  // (an all-in with no size is walked onto the tree's raise with no note: the chips are what tell)
  const toCall = (sim.cur?.curBet ?? 0) - (sim.cur?.bets[h.hero] ?? 0);
  if (Math.abs((node.pot_bb ?? NaN) - sim.pot) > CHIP_EPS || Math.abs((node.to_call_bb ?? NaN) - toCall) > CHIP_EPS) return chart(`The chips in aren't the solve's: the pot is ${sim.pot}bb here and ${node.pot_bb}bb on its tree.`);
  const options = optionsOf(res);
  const moves = options.map((a) => moveOfOption(h, a, sim));
  const table = moves.flatMap((m) => (typeof m === "string" ? [] : [m]));
  const at = table.length === moves.length ? lineUp(table, node.actions ?? []) : null;
  const its = (node.actions ?? []).map((a) => ({ action: a.action, to: a.amount_bb }));
  if (!at) return chart(`The solve's options aren't yours here: you have ${sizes(table)}, and it has ${sizes(its)}.`);
  return { data: asOptions(read, options, at), provenance: read.provenance };
}

/** What a decision at this spot is graded on: the solve's answer where it reads, else the chart's, with why. */
export function gradedOn(h: PracticeHand, held: HeldAnswer, sim: Sim = simOf(h)): Pick<SolveResult, "data" | "provenance"> & { pfWhy?: string } {
  if (!h.pfSolve || sim.current !== "preflop") return held;
  const read = pfRead(h, held.data, held.pf, sim);
  return "why" in read ? { data: held.data, provenance: held.provenance, pfWhy: read.why } : read;
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
  return `Preflop so far: ${a}; ${b}. The two are never added together.`;
}
