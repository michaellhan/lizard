// The betting tree of a heads-up PLO4 river: who may do what, at the listed sizes. Nothing here works out a limit: every
// node asks the table engine (engine/plo/betting.ts headsUpRiver, poker/table.ts simulate, legal, recordOf), so the
// largest bet, the smallest raise and what an all-in does are the rules the table plays by. What's added is the choice
// of sizes: a size as a percent of the pot, lifted to the smallest legal bet and cut to the largest, and a raise cap.
//
// It's a smaller game than pot-limit poker, which allows every amount to the cent: a solve of this tree is exact for
// this tree only.
//
// Stacks: heads-up, chips one player has over the other can't be won or lost, so the tree is on the shorter stack.
import { legal, recordOf, simulate, type Move } from "@/poker/table";
import { headsUpRiver } from "../betting";

export const OOP = 0;
export const IP = 1;
export type Seat = 0 | 1;
/** the table's seat for each: heads-up the big blind acts first after the flop */
const SEAT = ["BB", "SB"] as const;

export const MAX_BET_SIZES = 3;
export const MAX_RAISE_SIZES = 2;
export const MAX_RAISE_CAP = 3;

export interface RiverSizes {
  /** first bets, % of the pot */
  bets: readonly number[];
  /** raises, % of the pot after the call (100 is the pot-limit raise) */
  raises: readonly number[];
  /** raises allowed after the first bet */
  raiseCap: number;
  /** also offer all-in wherever pot limit allows the whole stack */
  allIn: boolean;
}

export interface RiverAction {
  kind: "check" | "fold" | "call" | "bet" | "raise";
  /** a bet's or raise's total for the street; a call's chips to call */
  amount?: number;
  allIn?: boolean;
  /** x, f, c, b<cents> or r<cents>: a node's path is these joined by dots */
  token: string;
  label: string;
}

interface NodeBase {
  id: number;
  /** "" at the root */
  path: string;
  /** chips each seat has put in on the river, a bet that was never matched left out of a fold's */
  bets: [number, number];
}

export interface ActionNode extends NodeBase {
  kind: "action";
  player: Seat;
  actions: RiverAction[];
  children: number[];
  /** where this node's numbers start in its player's flat arrays, in actions: offset * n + action * n + combo */
  offset: number;
}

export interface FoldNode extends NodeBase {
  kind: "fold";
  folded: Seat;
}

export interface ShowdownNode extends NodeBase {
  kind: "showdown";
}

export type RiverNode = ActionNode | FoldNode | ShowdownNode;

export interface RiverTree {
  pot: number;
  stack: number;
  sizes: RiverSizes;
  /** by id: the root is 0, a parent comes before its children */
  nodes: RiverNode[];
  /** actions over all of a seat's nodes */
  slots: [number, number];
  actionNodes: number;
  /** the longest line, in actions */
  depth: number;
}

const cents = (x: number) => Math.round(x * 100);
const money = (x: number) => String(cents(x) / 100);
const down = (x: number) => Math.floor(x * 100 + 1e-6) / 100;
const EPS = 1e-9;

/** What's wrong with these sizes, or null. */
export function checkSizes(s: RiverSizes): string | null {
  const bad = (xs: readonly number[]) => xs.some((x) => !(x > 0 && x <= 100));
  if (bad(s.bets) || bad(s.raises)) return "Sizes are percents of the pot, above 0, up to 100: pot limit allows no more.";
  if (new Set(s.bets).size !== s.bets.length || new Set(s.raises).size !== s.raises.length) return "A size is listed twice.";
  if (s.bets.length > MAX_BET_SIZES) return `At most ${MAX_BET_SIZES} bet sizes.`;
  if (s.raises.length > MAX_RAISE_SIZES) return `At most ${MAX_RAISE_SIZES} raise sizes.`;
  if (!Number.isInteger(s.raiseCap) || s.raiseCap < 0 || s.raiseCap > MAX_RAISE_CAP) return `The raise cap is a whole number from 0 to ${MAX_RAISE_CAP}.`;
  return null;
}

export function buildTree(pot: number, stack: number, sizes: RiverSizes): RiverTree {
  const { table, lines } = headsUpRiver(pot, stack);
  const nodes: RiverNode[] = [];
  const slots: [number, number] = [0, 0];
  let actionNodes = 0;
  let depth = 0;

  const visit = (moves: Move[], path: string, length: number): number => {
    const id = nodes.length;
    depth = Math.max(depth, length);
    const sim = simulate(table, { ...lines, river: moves }, 5);
    const river = sim.streets.river!;
    const bets: [number, number] = [river.bets[SEAT[OOP]]!, river.bets[SEAT[IP]]!];
    if (sim.handOver) {
      if (sim.active.size === 1) nodes.push({ id, path, bets, kind: "fold", folded: sim.active.has(SEAT[OOP]) ? IP : OOP });
      else nodes.push({ id, path, bets, kind: "showdown" });
      return id;
    }
    const can = legal(table, sim)!;
    const player: Seat = can.toAct === SEAT[OOP] ? OOP : IP;
    const node: ActionNode = { id, path, bets, kind: "action", player, actions: [], children: [], offset: slots[player] };
    nodes.push(node);
    const facing = can.toCall > EPS;

    const offers: { action: RiverAction; move: Move }[] = [];
    const take = (action: RiverAction["kind"], label: string, token: string, amount?: number) => {
      const move = recordOf(table, sim, { action });
      if (typeof move === "string") throw new Error(`the table refused ${action}: ${move}`);
      offers.push({ action: { kind: action, label, token, ...(amount !== undefined ? { amount } : {}) }, move });
    };
    if (facing) {
      take("fold", "Fold", "f");
      take("call", `Call ${money(can.toCall)}`, "c", can.toCall);
    } else take("check", "Check", "x");

    const mayRaise = can.canRaise && (river.nRaises === 0 || river.nRaises <= sizes.raiseCap);
    if (mayRaise) {
      const tos = new Set<number>();
      const listed = facing ? sizes.raises : sizes.bets;
      const base = facing ? sim.pot + can.toCall : sim.pot;
      for (const pct of listed) tos.add(cents(Math.min(Math.max(river.curBet + down((base * pct) / 100), can.minTo), can.maxTo!)));
      // all-in only where the stack is within the limit, so the table allows it: a deep stack has no such size
      if (sizes.allIn && can.allInTo <= can.maxTo! + EPS) tos.add(cents(can.allInTo));
      for (const c of [...tos].sort((a, b) => a - b)) {
        const to = c / 100;
        const kind = facing ? "raise" : "bet";
        const move = recordOf(table, sim, { action: kind, to });
        if (typeof move === "string") throw new Error(`the table refused ${kind} to ${to}: ${move}`);
        const allIn = move.action === "all-in";
        const word = allIn ? "All-in" : facing ? "Raise to" : "Bet";
        offers.push({ action: { kind, amount: to, label: `${word} ${money(to)}`, token: `${facing ? "r" : "b"}${c}`, ...(allIn ? { allIn } : {}) }, move });
      }
    }
    node.actions = offers.map((o) => o.action);
    slots[player] += offers.length;
    actionNodes++;
    for (const o of offers) node.children.push(visit([...moves, o.move], path ? `${path}.${o.action.token}` : o.action.token, length + 1));
    return id;
  };
  visit([], "", 0);
  return { pot, stack, sizes, nodes, slots, actionNodes, depth };
}
