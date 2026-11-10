// Solving a heads-up PLO4 flop exactly: the street solver (../turn/street.ts) on the flop's tree, and at every closing of
// it a turn solve (../turn/solver.ts) for each turn card, each with all its rivers. Every combo and every matchup, no
// bucket and no sample: one DCFR run over the whole game. A turn solve per card and closing, their scratch shared, as
// they're walked one at a time; the rivers' scratch is shared by every river of every turn.
//
// Where the flop closes all-in, each turn card is a showdown over its rivers, each river counting 1/40.
import type { RiverGame } from "../river/game";
import { levelsFor, widestOf } from "../river/solver";
import type { ActionNode, RiverNode, Seat } from "../river/tree";
import { RIVERS_PER_MATCHUP, type TurnGame } from "../turn/game";
import { riverScratch, TurnSolver, turnMemoryBytes, turnWork, type TurnShared } from "../turn/solver";
import { StreetSolver, type NextCard, type StreetNodeReport } from "../turn/street";
import { TURNS_PER_MATCHUP, turnGameAt, type FlopGame, type TurnCard } from "./game";

const terminalsOf = (t: { nodes: RiverNode[]; actionNodes: number }) => t.nodes.length - t.actionNodes;

/** Each turn game a flop solve plays: by closing id, one for each of game.turns (null where the flop closes all-in). */
function turnGames(game: FlopGame): Map<number, TurnGame[] | null> {
  const out = new Map<number, TurnGame[] | null>();
  for (const c of game.closings.values()) out.set(c.id, c.tree ? game.turns.map((t) => turnGameAt(t, c, game.riverSizes)) : null);
  return out;
}

/** The work of an iteration, in combo-terminals (the river's MAX_WORK unit): the flop's terminals and every turn's work. */
export function flopWork(game: FlopGame): number {
  const { sides, tree, turns } = game;
  let work = (sides[0].n + sides[1].n) * terminalsOf(tree);
  for (const games of turnGames(game).values()) {
    if (games) for (const g of games) work += turnWork(g);
    else for (const t of turns) for (const r of t.cards.rivers) work += r.game.sides[0].n + r.game.sides[1].n;
  }
  return work;
}

/** The bytes a flop solve stores and its scratch: a bound on the typed arrays, every turn's included. */
export function flopMemoryBytes(game: FlopGame): number {
  const { sides, tree } = game;
  let bytes = 16 * (sides[0].n * tree.slots[0] + sides[1].n * tree.slots[1]);
  bytes += (tree.depth + 1) * Math.max(sides[0].n, sides[1].n) * (32 + 12 * widestOf(tree)) + 8 * game.setCount;
  for (const t of game.turns) bytes += 8 * t.cards.setCount + (t.cards.sides[0].n + t.cards.sides[1].n) * 80;
  for (const games of turnGames(game).values()) if (games) for (const g of games) bytes += turnMemoryBytes(g);
  return bytes;
}

/** A turn card as the next card of a flop: where the flop closes all-in, a showdown over every river after it. */
function nextOf(t: TurnCard, scratch: { reach: Float64Array; out: Float64Array }): NextCard {
  return {
    back: t.back,
    showdown(hero, reach, val, out) {
      const heroN = t.cards.sides[hero].n;
      out.fill(0, 0, heroN);
      const opp = (1 - hero) as Seat;
      for (const r of t.cards.rivers) {
        const backOpp = r.back[opp];
        const backHero = r.back[hero];
        let any = 0;
        for (let j = 0; j < backOpp.length; j++) any += scratch.reach[j] = reach[backOpp[j]!]!;
        if (any === 0) continue;
        r.terminals.showdown(hero, scratch.reach, val, scratch.out);
        for (let i = 0; i < backHero.length; i++) out[backHero[i]!]! += scratch.out[i]! / RIVERS_PER_MATCHUP;
      }
    },
  };
}

export class FlopSolver extends StreetSolver {
  readonly turnGames: Map<number, TurnGame[] | null>;

  constructor(override readonly game: FlopGame) {
    const games = turnGames(game);
    // the turns' scratch, as big as the biggest turn needs, and the rivers' likewise
    let turnN = 1;
    let turnWidest = 1;
    let turnDepth = 0;
    let riverN = 1;
    let riverWidest = 1;
    let riverDepth = 0;
    for (const t of game.turns) {
      turnN = Math.max(turnN, t.cards.sides[0].n, t.cards.sides[1].n);
      for (const r of t.cards.rivers) riverN = Math.max(riverN, r.game.sides[0].n, r.game.sides[1].n);
    }
    for (const list of games.values())
      for (const g of list ?? []) {
        turnWidest = Math.max(turnWidest, widestOf(g.tree));
        turnDepth = Math.max(turnDepth, g.tree.depth);
        const r = riverScratch(g);
        riverWidest = Math.max(riverWidest, r.widest);
        riverDepth = Math.max(riverDepth, r.depth);
        break; // (every turn card at one closing has the same trees)
      }
    const shared: TurnShared = {
      levels: levelsFor(turnN, turnWidest, turnDepth),
      next: { reach: new Float64Array(riverN), out: new Float64Array(riverN) },
      riverLevels: levelsFor(riverN, riverWidest, riverDepth),
    };
    const subs = new Map<number, TurnSolver[] | null>();
    for (const [id, list] of games) subs.set(id, list ? list.map((g, k) => new TurnSolver(g, { ...shared, terminals: game.turns[k]!.terminals })) : null);
    const scratch = { reach: new Float64Array(riverN), out: new Float64Array(riverN) };
    super(game, game.turns.map((t) => nextOf(t, scratch)), TURNS_PER_MATCHUP, subs);
    this.turnGames = games;
  }

  /** The turn solves after flop closing `closing`, one for each of game.turns; null where it closes all-in. */
  turnSolvers(closing: number): TurnSolver[] | null {
    return (this.subs.get(closing) as TurnSolver[] | null | undefined) ?? null;
  }

  /** Puts a given strategy in place of every turn's average, by flop closing, turn card and node. */
  setTurnAverage(get: (closing: number, card: number, node: ActionNode, seat: Seat) => ArrayLike<number>): void {
    for (const id of this.subs.keys()) this.turnSolvers(id)?.forEach((s, k) => s.setAverage((node, seat) => get(id, this.game.turns[k]!.card, node, seat)));
  }

  /** Puts a given strategy in place of every river's average: by flop closing, turn card, turn closing, river card, node. */
  setRiverAverage(get: (closing: number, turn: number, turnClosing: number, river: number, node: ActionNode, seat: Seat) => ArrayLike<number>): void {
    for (const id of this.subs.keys()) this.turnSolvers(id)?.forEach((s, k) => s.setRiverAverage((tc, river, node, seat) => get(id, this.game.turns[k]!.card, tc, river, node, seat)));
  }

  /** What the flop's line from `closing` leaves each seat on turn card number `k`, by the turn's combos. */
  private entered(closing: number, k: number): [Float64Array, Float64Array] {
    const [a, b] = this.reachAt(closing);
    const t = this.game.turns[k]!;
    return [Float64Array.from(t.back[0], (i) => a[i]!), Float64Array.from(t.back[1], (i) => b[i]!)];
  }

  /** The turn after flop closing `closing` on card `card`, node by node at the average strategies, entered with the
   * flop line's reach; null for an all-in closing or a card with no game. The turn game's combos. */
  turnReport(closing: number, card: number): { nodes: StreetNodeReport[]; game: TurnGame } | null {
    const subs = this.turnSolvers(closing);
    const k = this.game.turns.findIndex((t) => t.card === card);
    if (!subs || k < 0) return null;
    return { nodes: subs[k]!.report(this.entered(closing, k)), game: subs[k]!.game };
  }

  /** The river after a flop closing, a turn card, a closing of that turn and a river card, entered with both lines'
   * reach; null where there's no such river to play. The river game's combos. */
  riverReport(closing: number, turn: number, turnClosing: number, river: number): { nodes: StreetNodeReport[]; game: RiverGame } | null {
    const subs = this.turnSolvers(closing);
    const k = this.game.turns.findIndex((t) => t.card === turn);
    if (!subs || k < 0) return null;
    return subs[k]!.riverReport(turnClosing, river, this.entered(closing, k));
  }
}
