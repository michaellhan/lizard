// Solving a heads-up PLO4 turn exactly, by the river solver's discounted CFR (../river/solver.ts) on the whole game: the
// turn's tree, and at every closing of it a river game for each card that can come, every combo and every matchup, no
// bucket and no sample. A pass walks the turn's tree once for each seat; where the turn's betting closes it walks every
// river's tree too, each river's numbers its own (a river solver per card and closing) and their scratch vectors shared,
// as the rivers are walked one at a time. Every river is discounted on the turn's iteration count, so the whole is one
// DCFR run.
//
// Exploitability is the river's: an exact best response to each side's average, through the turn and every river, the
// average of what each seat gains, in chips per matchup and as a percent of the turn's pot.
import { RiverSolver, levelsFor, widestOf, type Level } from "../river/solver";
import type { RiverGame } from "../river/game";
import type { ActionNode, RiverNode, Seat } from "../river/tree";
import { RIVERS_PER_MATCHUP, riverGame, type River, type TurnGame } from "./game";
import { StreetSolver, type NextCard, type StreetNodeReport, type StreetShared } from "./street";

/** The bytes a turn solve stores and its scratch, a bound on the typed arrays (the river's `memoryBytes`, over every river). */
export function turnMemoryBytes(game: TurnGame): number {
  const { sides, tree, rivers, closings } = game;
  let bytes = 16 * (sides[0].n * tree.slots[0] + sides[1].n * tree.slots[1]);
  bytes += (tree.depth + 1) * Math.max(sides[0].n, sides[1].n) * (32 + 12 * widestOf(tree)) + 8 * game.setCount;
  let n = 0;
  let widest = 1;
  let depth = 0;
  for (const r of rivers) {
    const [a, b] = r.game.sides;
    n = Math.max(n, a.n, b.n);
    bytes += 8 * r.game.setCount + (a.n + b.n) * (4 + 8 + 4 + 4 * 15 + 4) + 8 * Math.max(a.n, b.n);
    for (const c of closings.values()) if (c.tree) bytes += 8 * (a.n * c.tree.slots[0] + b.n * c.tree.slots[1]);
  }
  for (const c of closings.values())
    if (c.tree) {
      widest = Math.max(widest, widestOf(c.tree));
      depth = Math.max(depth, c.tree.depth);
    }
  bytes += (depth + 1) * n * (32 + 12 * widest) + 16 * n;
  return bytes;
}

/** The work of an iteration, in combo-terminals: what each pass costs (the river's MAX_WORK unit). */
export function turnWork(game: TurnGame): number {
  const { sides, tree, rivers, closings } = game;
  const terminals = (t: { nodes: RiverNode[]; actionNodes: number }) => t.nodes.length - t.actionNodes;
  let work = (sides[0].n + sides[1].n) * terminals(tree);
  for (const c of closings.values()) for (const r of rivers) work += (r.game.sides[0].n + r.game.sides[1].n) * (c.tree ? terminals(c.tree) : 1);
  return work;
}

export type TurnNodeReport = StreetNodeReport;

/** A river card as the next card of a turn. */
const nextOf = (r: River): NextCard => ({ back: r.back, showdown: (hero, reach, val, out) => r.terminals.showdown(hero, reach, val, out) });

/** The widest river side, tree and depth of a turn's rivers: what their shared scratch must hold. */
export function riverScratch(game: Pick<TurnGame, "rivers" | "closings">): { n: number; widest: number; depth: number } {
  let n = 1;
  let widest = 1;
  let depth = 0;
  for (const r of game.rivers) n = Math.max(n, r.game.sides[0].n, r.game.sides[1].n);
  for (const c of game.closings.values())
    if (c.tree) {
      widest = Math.max(widest, widestOf(c.tree));
      depth = Math.max(depth, c.tree.depth);
    }
  return { n, widest, depth };
}

/** Scratch turns can share with each other (a flop's, walked one at a time): the turn's own, and the rivers'. */
export interface TurnShared extends StreetShared {
  riverLevels?: Level[];
}

export class TurnSolver extends StreetSolver {
  constructor(
    override readonly game: TurnGame,
    shared: TurnShared = {},
  ) {
    const { n, widest, depth } = riverScratch(game);
    const riverLevels = shared.riverLevels ?? levelsFor(n, widest, depth);
    const subs = new Map<number, RiverSolver[] | null>();
    for (const c of game.closings.values()) subs.set(c.id, c.tree ? game.rivers.map((r) => new RiverSolver(riverGame(r, c.tree!), { terminals: r.terminals, levels: riverLevels })) : null);
    super(game, game.rivers.map(nextOf), RIVERS_PER_MATCHUP, subs, shared);
  }

  private riverSubs(closing: number): RiverSolver[] | null {
    return (this.subs.get(closing) as RiverSolver[] | null | undefined) ?? null;
  }

  /** Puts a given strategy in place of every river's average, by closing, river card and node. */
  setRiverAverage(get: (closing: number, card: number, node: ActionNode, seat: Seat) => ArrayLike<number>): void {
    for (const id of this.subs.keys()) this.riverSubs(id)?.forEach((s, k) => s.setAverage((node, seat) => get(id, this.game.rivers[k]!.card, node, seat)));
  }

  /** The river after turn closing `closing` on card `card`, node by node at the average strategies, entered with the
   * turn line's reach from `roots` (default: the ranges); null for an all-in closing (no decisions) or a card with no
   * game. The river game's combos. */
  riverReport(closing: number, card: number, roots?: readonly [Float64Array, Float64Array]): { nodes: TurnNodeReport[]; game: RiverGame } | null {
    const subs = this.riverSubs(closing);
    const k = this.game.rivers.findIndex((r) => r.card === card);
    if (!subs || k < 0) return null;
    const r = this.game.rivers[k]!;
    const [a, b] = this.reachAt(closing, roots);
    const entered: [Float64Array, Float64Array] = [Float64Array.from(r.back[0], (i) => a[i]!), Float64Array.from(r.back[1], (i) => b[i]!)];
    return { nodes: subs[k]!.report(entered), game: subs[k]!.game };
  }
}
