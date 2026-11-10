// A street before the river, solved by the river solver's discounted CFR (../river/solver.ts) on the whole game: the
// street's tree, and where its betting closes, the next street on every card that can come, each card its own sub-solve
// (a river, or a turn with its rivers), walked one at a time with their scratch vectors shared. Every sub-solve is
// discounted on this street's iteration count, so the whole is one DCFR run. The turn (./solver.ts) and the flop
// (../flop/solver.ts) are this with their next street plugged in.
//
// A matchup that can be dealt sees `perMatchup` next cards, each as likely (40 rivers after a turn, 41 turns after a
// flop), so a card's values count 1/perMatchup here. Where the betting closes all-in, every card is a showdown (`NextCard
// .showdown`: a river's, or a turn's every river).
//
// Exploitability is the river's: an exact best response to each side's average, through this street and everything
// after it, the average of what each seat gains, in chips per matchup and as a percent of this street's pot.
import { Terminals, type Side } from "../river/game";
import { levelsFor, widestOf, type Exploitability, type Level } from "../river/solver";
import type { ActionNode, RiverNode, RiverTree, Seat } from "../river/tree";
import { OOP } from "../river/tree";

const ALPHA = 1.5;
const GAMMA = 2;
const TINY = 1e-11;

type How = "solve" | "best" | "average";

/** What a street's leaf needs of the solve after it on one card: as `RiverSolver`'s. */
export interface Sub {
  begin(t: number): void;
  pass(hero: Seat, reach: Float64Array, out: Float64Array): void;
  valueAt(hero: Seat, reach: Float64Array, out: Float64Array, best: boolean): void;
}

/** A card that can come next: its sides' combos as this street's (`back`), and its showdown where this street closes
 * all-in, `val` chips times the reach each hand beats less the reach it loses to, into `out` (the card's combos). */
export interface NextCard {
  back: [Int32Array, Int32Array];
  showdown(hero: Seat, reach: Float64Array, val: number, out: Float64Array): void;
}

export interface StreetGame {
  sides: [Side, Side];
  tree: RiverTree;
  matchups: number;
  setCount: number;
  /** by node id where the betting closes: the next street's pot */
  closings: ReadonlyMap<number, { id: number; pot: number }>;
}

export interface StreetNodeReport {
  id: number;
  path: string;
  player: Seat;
  /** chance of this line, of all the matchups */
  reach: number;
  rangeEv: [number | null, number | null];
  frequency: (number | null)[];
  actionRangeEv: (number | null)[];
  /** the average strategy: action * n + combo */
  strategy: Float32Array;
  weight: Float32Array;
  /** each combo's EV, NaN where it can't meet a hand here */
  ev: Float32Array;
  actionEv: Float32Array;
}

/** Scratch a street's solve can share with others of its kind, walked one at a time. */
export interface StreetShared {
  terminals?: Terminals;
  levels?: Level[];
  /** the leaf's vectors, as long as the widest next card's side */
  next?: { reach: Float64Array; out: Float64Array };
}

export class StreetSolver implements Sub {
  iterations = 0;
  protected readonly regret: [Float32Array, Float32Array];
  protected readonly average: [Float32Array, Float32Array];
  protected readonly levels: Level[];
  protected readonly terminals: Terminals;
  private readonly nextReach: Float64Array;
  private readonly nextOut: Float64Array;
  private readonly half: number;
  private keepGain = 0;
  private keepLoss = 0.5;
  private keepAverage = 0;

  constructor(
    readonly game: StreetGame,
    readonly cards: readonly NextCard[],
    readonly perMatchup: number,
    /** by closing id: a sub-solve for each of `cards` (null for an all-in closing) */
    protected readonly subs: ReadonlyMap<number, readonly Sub[] | null>,
    shared: StreetShared = {},
  ) {
    const { sides, tree } = game;
    this.regret = [new Float32Array(sides[0].n * tree.slots[0]), new Float32Array(sides[1].n * tree.slots[1])];
    this.average = [new Float32Array(sides[0].n * tree.slots[0]), new Float32Array(sides[1].n * tree.slots[1])];
    this.levels = shared.levels ?? levelsFor(Math.max(sides[0].n, sides[1].n), widestOf(tree), tree.depth);
    this.terminals = shared.terminals ?? new Terminals(game);
    this.half = tree.pot / 2;
    let n = 1;
    for (const c of cards) n = Math.max(n, c.back[0].length, c.back[1].length);
    this.nextReach = shared.next?.reach ?? new Float64Array(n);
    this.nextOut = shared.next?.out ?? new Float64Array(n);
  }

  /** Sets the discounts for iteration `t` (1 first) here and in every sub-solve. */
  begin(t: number): void {
    this.iterations = t;
    const last = t - 1;
    const tp = last ** ALPHA;
    this.keepGain = tp / (tp + 1);
    this.keepLoss = 0.5;
    this.keepAverage = (last / t) ** GAMMA;
    for (const subs of this.subs.values()) if (subs) for (const s of subs) s.begin(t);
  }

  /** One pass for each seat. */
  iterate(): void {
    this.begin(this.iterations + 1);
    for (const hero of [0, 1] as const) this.walk(0, hero, this.game.sides[(1 - hero) as Seat].weights, this.levels[0]!.value, 0, "solve");
  }

  /** One seat's pass from the root against the other's reach: its counterfactual values into `out`. */
  pass(hero: Seat, reach: Float64Array, out: Float64Array): void {
    this.walk(0, hero, reach, out, 0, "solve");
  }

  /** hero's values from the root against the other's average, best-responding if `best`, else at its own average. */
  valueAt(hero: Seat, reach: Float64Array, out: Float64Array, best: boolean): void {
    this.walk(0, hero, reach, out, 0, best ? "best" : "average");
  }

  /** The chips each way where this street's betting ends: a fold, or every card after it closes. */
  private leaf(node: Exclude<RiverNode, ActionNode>, hero: Seat, reach: Float64Array, out: Float64Array, how: How): void {
    if (node.kind === "fold") {
      const val = this.half + node.bets[node.folded];
      this.terminals.fold(hero, reach, node.folded === hero ? -val : val, out);
      return;
    }
    const closing = this.game.closings.get(node.id)!;
    const subs = this.subs.get(node.id)!;
    const heroN = this.game.sides[hero].n;
    out.fill(0, 0, heroN);
    const { nextReach: rr, nextOut: ro, perMatchup } = this;
    const opp = (1 - hero) as Seat;
    this.cards.forEach((c, k) => {
      const backOpp = c.back[opp];
      const backHero = c.back[hero];
      let any = 0;
      for (let j = 0; j < backOpp.length; j++) any += rr[j] = reach[backOpp[j]!]!;
      if (any === 0) return;
      if (!subs) c.showdown(hero, rr, closing.pot / 2, ro);
      else if (how === "solve") subs[k]!.pass(hero, rr, ro);
      else subs[k]!.valueAt(hero, rr, ro, how === "best");
      for (let i = 0; i < backHero.length; i++) out[backHero[i]!]! += ro[i]! / perMatchup;
    });
  }

  protected current(node: ActionNode, seat: Seat, to: Float32Array, avg: boolean): void {
    const n = this.game.sides[seat].n;
    const a = node.actions.length;
    const r = avg ? this.average[seat] : this.regret[seat];
    const base = node.offset * n;
    for (let i = 0; i < n; i++) {
      let total = 0;
      for (let k = 0, at = base + i; k < a; k++, at += n) {
        const x = r[at]!;
        if (x > 0) total += x;
      }
      if (total > 0) for (let k = 0, at = base + i; k < a; k++, at += n) to[k * n + i] = r[at]! > 0 ? r[at]! / total : 0;
      else for (let k = 0; k < a; k++) to[k * n + i] = 1 / a;
    }
  }

  /** A pass ("solve"), or hero's values against the other's average, best-responding ("best") or at its own ("average"). */
  private walk(id: number, hero: Seat, reach: Float64Array, out: Float64Array, depth: number, how: How): void {
    const node = this.game.tree.nodes[id]!;
    if (node.kind !== "action") return this.leaf(node, hero, reach, out, how);
    const level = this.levels[depth]!;
    const a = node.actions.length;
    const seat = node.player;
    const n = this.game.sides[seat].n;
    const heroN = this.game.sides[hero].n;
    const sigma = level.sigma;
    this.current(node, seat, sigma, how !== "solve");
    if (seat === hero) {
      for (let k = 0; k < a; k++) this.walk(node.children[k]!, hero, reach, level.values[k]!, depth + 1, how);
      for (let i = 0; i < n; i++) {
        if (how === "best") {
          let top = -Infinity;
          for (let k = 0; k < a; k++) top = Math.max(top, level.values[k]![i]!);
          out[i] = top;
        } else {
          let t = 0;
          for (let k = 0; k < a; k++) t += sigma[k * n + i]! * level.values[k]![i]!;
          out[i] = t;
        }
      }
      if (how !== "solve") return;
      const r = this.regret[seat];
      const { keepGain, keepLoss } = this;
      for (let k = 0; k < a; k++) {
        const v = level.values[k]!;
        const at = (node.offset + k) * n;
        for (let i = 0; i < n; i++) {
          const x = r[at + i]!;
          r[at + i] = x * (x > 0 ? keepGain : keepLoss) + v[i]! - out[i]!;
        }
      }
    } else {
      out.fill(0, 0, heroN);
      const avg = this.average[seat];
      const next = level.reach;
      const child = level.values[0]!;
      const keep = this.keepAverage;
      for (let k = 0; k < a; k++) {
        const row = k * n;
        const at = (node.offset + k) * n;
        let any = 0;
        for (let i = 0; i < n; i++) {
          const here = reach[i]! * sigma[row + i]!;
          next[i] = here;
          any += here;
          if (how === "solve") avg[at + i] = avg[at + i]! * keep + here;
        }
        if (any === 0) continue;
        this.walk(node.children[k]!, hero, next, child, depth + 1, how);
        for (let i = 0; i < heroN; i++) out[i]! += child[i]!;
      }
    }
  }

  /** Puts a given strategy in place of the average, to measure it (`action * n + combo` by node). */
  setAverage(get: (node: ActionNode, seat: Seat) => ArrayLike<number>): void {
    for (const node of this.game.tree.nodes) {
      if (node.kind !== "action") continue;
      this.average[node.player].set(get(node, node.player), node.offset * this.game.sides[node.player].n);
    }
  }

  private rootValue(hero: Seat, out: Float64Array): number {
    const w = this.game.sides[hero].weights;
    let t = 0;
    for (let i = 0; i < w.length; i++) t += w[i]! * out[i]!;
    return t / this.game.matchups;
  }

  /** How far the average strategies are from equilibrium, by an exact best response to each through every card after. */
  measure(): Exploitability {
    const { sides, tree } = this.game;
    const value = (hero: Seat, best: boolean) => {
      const out = this.levels[0]!.value;
      this.walk(0, hero, sides[(1 - hero) as Seat].weights, out, 0, best ? "best" : "average");
      return this.rootValue(hero, out);
    };
    const best: [number, number] = [value(0, true), value(1, true)];
    const here = value(OOP, false);
    const gain: [number, number] = [best[0] - here, best[1] + here];
    const chips = (best[0] + best[1]) / 2;
    return { best, gain, chips, pct: (100 * chips) / tree.pot, value: here };
  }

  /** Each seat's reach where node `id` is reached from `roots` (default: the ranges), at the average strategies. */
  reachAt(id: number, roots?: readonly [Float64Array, Float64Array]): [Float64Array, Float64Array] {
    const { tree, sides } = this.game;
    const reach: [Float64Array, Float64Array] = roots ? [Float64Array.from(roots[0]), Float64Array.from(roots[1])] : [Float64Array.from(sides[0].weights), Float64Array.from(sides[1].weights)];
    const path: [ActionNode, number][] = [];
    const find = (at: number): boolean => {
      if (at === id) return true;
      const node = tree.nodes[at]!;
      if (node.kind !== "action") return false;
      for (let k = 0; k < node.actions.length; k++) {
        path.push([node, k]);
        if (find(node.children[k]!)) return true;
        path.pop();
      }
      return false;
    };
    if (!find(0)) throw new Error(`no node ${id}`);
    for (const [node, k] of path) {
      const n = sides[node.player].n;
      const sigma = new Float32Array(node.actions.length * n);
      this.current(node, node.player, sigma, true);
      const r = reach[node.player];
      for (let i = 0; i < n; i++) r[i]! *= sigma[k * n + i]!;
    }
    return reach;
  }

  /** The average strategies node by node, with reach and EV (EV: chips won from the pot less chips bet from this street
   * on), entered with `roots` (default: the ranges). Costs about a pass. */
  report(roots?: readonly [Float64Array, Float64Array]): StreetNodeReport[] {
    const out = new Map<number, StreetNodeReport>();
    for (const node of this.game.tree.nodes) {
      if (node.kind !== "action") continue;
      const n = this.game.sides[node.player].n;
      const a = node.actions.length;
      out.set(node.id, {
        id: node.id,
        path: node.path,
        player: node.player,
        reach: 0,
        rangeEv: [null, null],
        frequency: new Array<number | null>(a).fill(null),
        actionRangeEv: new Array<number | null>(a).fill(null),
        strategy: new Float32Array(a * n),
        weight: new Float32Array(n),
        ev: new Float32Array(n).fill(NaN),
        actionEv: new Float32Array(a * n).fill(NaN),
      });
    }
    const start = roots ?? [this.game.sides[0].weights, this.game.sides[1].weights];
    for (const hero of [0, 1] as const) {
      const own = Float64Array.from(start[hero]);
      this.record(0, hero, Float64Array.from(start[(1 - hero) as Seat]), own, this.levels[0]!.value, 0, out);
    }
    return [...out.values()];
  }

  private record(id: number, hero: Seat, reach: Float64Array, own: Float64Array, out: Float64Array, depth: number, reports: Map<number, StreetNodeReport>): void {
    const node = this.game.tree.nodes[id]!;
    if (node.kind !== "action") return this.leaf(node, hero, reach, out, "average");
    const level = this.levels[depth]!;
    const report = reports.get(id)!;
    const a = node.actions.length;
    const seat = node.player;
    const n = this.game.sides[seat].n;
    const heroN = this.game.sides[hero].n;
    const sigma = level.sigma;
    this.current(node, seat, sigma, true);
    const meet = level.meet;
    this.terminals.meet(hero, reach, meet);
    const half = this.half;
    const matchups = this.game.matchups;
    let joint = 0;
    if (seat === hero) {
      report.strategy.set(sigma.subarray(0, a * n));
      // (each action's values first, as the scratch above this level is the children's)
      const next = level.own;
      const frequency = new Array<number>(a).fill(0);
      for (let k = 0; k < a; k++) {
        const v = level.values[k]!;
        for (let i = 0; i < n; i++) next[i] = own[i]! * sigma[k * n + i]!;
        this.record(node.children[k]!, hero, reach, next, v, depth + 1, reports);
        let won = 0;
        for (let i = 0; i < n; i++) {
          if (meet[i]! > TINY) report.actionEv[k * n + i] = v[i]! / meet[i]! + half;
          frequency[k]! += next[i]! * Math.max(meet[i]!, 0);
          won += next[i]! * v[i]!;
        }
        if (frequency[k]! > TINY * matchups) report.actionRangeEv[k] = won / frequency[k]! + half;
      }
      for (let i = 0; i < n; i++) {
        let t = 0;
        for (let k = 0; k < a; k++) t += sigma[k * n + i]! * level.values[k]![i]!;
        out[i] = t;
        report.weight[i] = own[i]!;
        if (meet[i]! > TINY) report.ev[i] = t / meet[i]! + half;
        joint += own[i]! * Math.max(meet[i]!, 0);
      }
      if (joint > 0) report.frequency = frequency.map((f) => f / joint);
    } else {
      out.fill(0, 0, heroN);
      for (let i = 0; i < heroN; i++) joint += own[i]! * Math.max(meet[i]!, 0);
      const next = level.reach;
      const child = level.values[0]!;
      for (let k = 0; k < a; k++) {
        for (let i = 0; i < n; i++) next[i] = reach[i]! * sigma[k * n + i]!;
        this.record(node.children[k]!, hero, next, own, child, depth + 1, reports);
        for (let i = 0; i < heroN; i++) out[i]! += child[i]!;
      }
    }
    let total = 0;
    for (let i = 0; i < heroN; i++) total += own[i]! * out[i]!;
    report.reach = joint / matchups;
    report.rangeEv[hero] = joint > TINY * matchups ? total / joint + half : null;
  }
}
