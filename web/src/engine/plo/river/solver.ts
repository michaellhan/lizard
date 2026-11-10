// Solving a heads-up PLO4 river exactly, by discounted CFR (Brown and Sandholm 2019, alpha 1.5, beta 0, gamma 2) on the
// whole game: every combo of both ranges, every matchup that can be dealt, no bucket and no sample. Each pass walks the
// tree once for each seat, carrying a vector of the other seat's reach, so a pass costs what the terminal nodes cost
// (game.ts Terminals). The strategy shown is the average one. How far it is from equilibrium isn't estimated: an exact
// best response is taken to each side's average (`measure`), which costs about one pass.
//
// Exploitability here is the classic app's: the average of what each seat gains by best-responding, in chips per matchup
// dealt, and as a percent of the river's pot (solver/gto/pf_solve.py exploitability).
//
// Memory is what's sized up front (`memoryBytes`): 8 bytes per combo and action of a seat's nodes, a Float32 of regret
// and a Float32 of average strategy, and scratch vectors per level of the tree.
import { SUBSETS } from "./blockers";
import { Terminals, type RiverGame } from "./game";
import type { ActionNode, RiverNode, RiverTree, Seat } from "./tree";
import { OOP } from "./tree";

// the DCFR constants
const ALPHA = 1.5;
const GAMMA = 2;

/** The bytes of a solve: what it stores, its scratch vectors, and what `report` hands back. A bound on the typed arrays. */
export function memoryBytes(game: RiverGame): number {
  const { sides, tree } = game;
  const n = Math.max(sides[0].n, sides[1].n);
  const widest = Math.max(...tree.nodes.map((x) => (x.kind === "action" ? x.actions.length : 0)));
  const actions = sides[0].n * tree.slots[0] + sides[1].n * tree.slots[1];
  let combosAtNodes = 0;
  for (const x of tree.nodes) if (x.kind === "action") combosAtNodes += sides[x.player].n;
  const stored = 8 * actions;
  const reported = 8 * actions + 8 * combosAtNodes;
  const scratch = (tree.depth + 1) * n * (32 + 12 * widest) + 8 * game.setCount + 8 * n;
  const sides_ = (sides[0].n + sides[1].n) * (4 + 8 + 4 + 4 * SUBSETS);
  return stored + reported + scratch + sides_;
}

export interface Exploitability {
  /** each seat's value in chips (zero-sum) when it best-responds */
  best: [number, number];
  /** what each seat gains on the average strategies by best-responding, chips per matchup */
  gain: [number, number];
  /** the average gain, chips per matchup */
  chips: number;
  /** of the pot, percent */
  pct: number;
  /** OOP's value in chips (zero-sum) at the average strategies */
  value: number;
}

export interface NodeReport {
  id: number;
  path: string;
  player: Seat;
  /** chance of this line, of all the matchups */
  reach: number;
  /** each seat's EV in chips over its hands here, null where the line isn't reached */
  rangeEv: [number | null, number | null];
  /** the frequency of each action, over the matchups reaching the node, null where the line isn't reached */
  frequency: (number | null)[];
  /** the acting seat's EV in chips over the hands taking each action, null for an action none takes */
  actionRangeEv: (number | null)[];
  /** the average strategy: action * n + combo */
  strategy: Float32Array;
  /** the seat's combos reaching here, as weights */
  weight: Float32Array;
  /** each combo's EV, NaN where it can't meet a hand here */
  ev: Float32Array;
  /** each combo's EV by action: action * n + combo, NaN likewise */
  actionEv: Float32Array;
  /** each combo's EV by action with its best play after that action, against the other seat's average (a best response
   * below the action, so an action the strategy never takes isn't valued at a strategy never trained there), NaN likewise */
  bestEv: Float32Array;
}

export class RiverSolver {
  iterations = 0;
  private readonly terminals: Terminals;
  private readonly regret: [Float32Array, Float32Array];
  private readonly average: [Float32Array, Float32Array];
  private readonly levels: Level[];
  private readonly half: number;

  /** `shared`: a turn solve's (engine/plo/turn/), whose rivers are solved one at a time: the terminal sums of the river
   * card's sides, and scratch vectors big enough for every river's tree. */
  constructor(
    readonly game: RiverGame,
    shared: { terminals?: Terminals; levels?: Level[] } = {},
  ) {
    const { sides, tree } = game;
    this.terminals = shared.terminals ?? new Terminals(game);
    this.regret = [new Float32Array(sides[0].n * tree.slots[0]), new Float32Array(sides[1].n * tree.slots[1])];
    this.average = [new Float32Array(sides[0].n * tree.slots[0]), new Float32Array(sides[1].n * tree.slots[1])];
    this.levels = shared.levels ?? levelsFor(Math.max(sides[0].n, sides[1].n), widestOf(tree), tree.depth);
    this.half = tree.pot / 2;
  }

  /** Sets the discounts for iteration `t` (1 first) on what was there before it. */
  begin(t: number): void {
    this.iterations = t;
    const last = t - 1;
    const tp = last ** ALPHA;
    this.keepGain = tp / (tp + 1);
    this.keepLoss = 0.5;
    this.keepAverage = (last / t) ** GAMMA;
  }

  /** One seat's pass from the root against the other's reach `reach`: its counterfactual values into `out`. */
  pass(hero: Seat, reach: Float64Array, out: Float64Array): void {
    this.solve(0, hero, reach, out, 0);
  }

  /** hero's values from the root against the other's average, best-responding if `best`, else at its own average. */
  valueAt(hero: Seat, reach: Float64Array, out: Float64Array, best: boolean): void {
    this.respond(0, hero, reach, out, 0, best);
  }

  /** One pass for each seat. */
  iterate(): void {
    this.begin(this.iterations + 1);
    for (const hero of [0, 1] as const) {
      const root = this.game.sides[(1 - hero) as Seat].weights;
      this.solve(0, hero, root, this.levels[0]!.value, 0);
    }
  }

  private keepGain = 0;
  private keepLoss = 0.5;
  private keepAverage = 0;

  /** The chips each way at a terminal node. */
  private terminal(node: Exclude<RiverNode, ActionNode>, hero: Seat, reach: Float64Array, out: Float64Array): void {
    if (node.kind === "fold") {
      const val = this.half + node.bets[node.folded];
      this.terminals.fold(hero, reach, node.folded === hero ? -val : val, out);
    } else this.terminals.showdown(hero, reach, this.half + node.bets[0], out);
  }

  /** The strategy regret matching gives each of `seat`'s combos at a node, into `to`. */
  private current(node: ActionNode, seat: Seat, to: Float32Array): void {
    const n = this.game.sides[seat].n;
    const a = node.actions.length;
    const r = this.regret[seat];
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

  private solve(id: number, hero: Seat, reach: Float64Array, out: Float64Array, depth: number): void {
    const node = this.game.tree.nodes[id]!;
    if (node.kind !== "action") return this.terminal(node, hero, reach, out);
    const level = this.levels[depth]!;
    const a = node.actions.length;
    const seat = node.player;
    const n = this.game.sides[seat].n;
    const heroN = this.game.sides[hero].n;
    const sigma = level.sigma;
    this.current(node, seat, sigma);
    out.fill(0, 0, heroN);
    if (seat === hero) {
      for (let k = 0; k < a; k++) {
        const v = level.values[k]!;
        this.solve(node.children[k]!, hero, reach, v, depth + 1);
        const row = k * n;
        for (let i = 0; i < n; i++) out[i]! += sigma[row + i]! * v[i]!;
      }
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
          avg[at + i] = avg[at + i]! * keep + here;
        }
        if (any === 0) continue;
        this.solve(node.children[k]!, hero, next, child, depth + 1);
        for (let i = 0; i < heroN; i++) out[i]! += child[i]!;
      }
    }
  }

  /** The average strategy of `seat`'s combos at a node, into `to`. A combo that never reached it plays evenly. */
  private averageAt(node: ActionNode, seat: Seat, to: Float32Array): void {
    const n = this.game.sides[seat].n;
    const a = node.actions.length;
    const s = this.average[seat];
    const base = node.offset * n;
    for (let i = 0; i < n; i++) {
      let total = 0;
      for (let k = 0, at = base + i; k < a; k++, at += n) total += s[at]!;
      if (total > 0) for (let k = 0, at = base + i; k < a; k++, at += n) to[k * n + i] = s[at]! / total;
      else for (let k = 0; k < a; k++) to[k * n + i] = 1 / a;
    }
  }

  /** Puts a given strategy in place of the average, to measure it. `get` gives a node's actions by combo as `action * n + combo`. */
  setAverage(get: (node: ActionNode, seat: Seat) => ArrayLike<number>): void {
    for (const node of this.game.tree.nodes) {
      if (node.kind !== "action") continue;
      const seat = node.player;
      this.average[seat].set(get(node, seat), node.offset * this.game.sides[seat].n);
    }
  }

  /** hero's values against the other's average, best-responding if `best`, else playing its own average. */
  private respond(id: number, hero: Seat, reach: Float64Array, out: Float64Array, depth: number, best: boolean): void {
    const node = this.game.tree.nodes[id]!;
    if (node.kind !== "action") return this.terminal(node, hero, reach, out);
    const level = this.levels[depth]!;
    const a = node.actions.length;
    const seat = node.player;
    const n = this.game.sides[seat].n;
    const heroN = this.game.sides[hero].n;
    const sigma = level.sigma;
    this.averageAt(node, seat, sigma);
    if (seat === hero) {
      for (let k = 0; k < a; k++) this.respond(node.children[k]!, hero, reach, level.values[k]!, depth + 1, best);
      for (let i = 0; i < n; i++) {
        if (best) {
          let top = -Infinity;
          for (let k = 0; k < a; k++) top = Math.max(top, level.values[k]![i]!);
          out[i] = top;
        } else {
          let t = 0;
          for (let k = 0; k < a; k++) t += sigma[k * n + i]! * level.values[k]![i]!;
          out[i] = t;
        }
      }
    } else {
      out.fill(0, 0, heroN);
      const next = level.reach;
      const child = level.values[0]!;
      for (let k = 0; k < a; k++) {
        let any = 0;
        for (let i = 0; i < n; i++) {
          const here = reach[i]! * sigma[k * n + i]!;
          next[i] = here;
          any += here;
        }
        if (any === 0) continue;
        this.respond(node.children[k]!, hero, next, child, depth + 1, best);
        for (let i = 0; i < heroN; i++) out[i]! += child[i]!;
      }
    }
  }

  private rootValue(hero: Seat, out: Float64Array): number {
    const w = this.game.sides[hero].weights;
    let t = 0;
    for (let i = 0; i < w.length; i++) t += w[i]! * out[i]!;
    return t / this.game.matchups;
  }

  /** How far the average strategies are from equilibrium, by an exact best response to each. */
  measure(): Exploitability {
    const { sides, tree } = this.game;
    const value = (hero: Seat, best: boolean) => {
      const out = this.levels[0]!.value;
      this.respond(0, hero, sides[(1 - hero) as Seat].weights, out, 0, best);
      return this.rootValue(hero, out);
    };
    const best: [number, number] = [value(0, true), value(1, true)];
    const here = value(OOP, false);
    const gain: [number, number] = [best[0] - here, best[1] + here];
    const chips = (best[0] + best[1]) / 2;
    return { best, gain, chips, pct: (100 * chips) / tree.pot, value: here };
  }

  /** The average strategies node by node, with reach and EV. Costs about a pass, and the result's memory. `roots`: each
   * seat's reach as the river starts, in place of the ranges' weights (a turn's line, engine/plo/turn/). */
  report(roots: readonly [Float64Array, Float64Array] = [this.game.sides[0].weights, this.game.sides[1].weights]): NodeReport[] {
    const { nodes } = this.game.tree;
    const out = new Map<number, NodeReport>();
    for (const node of nodes) {
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
        bestEv: new Float32Array(a * n).fill(NaN),
      });
    }
    const scratch = bestScratch(this.game.tree, Math.max(this.game.sides[0].n, this.game.sides[1].n));
    for (const hero of [0, 1] as const) {
      const own = Float64Array.from(roots[hero]);
      this.record(0, hero, roots[(1 - hero) as Seat], own, this.levels[0]!.value, scratch.top, 0, out, scratch.levels);
    }
    return [...out.values()];
  }

  /** As `respond` at the average, with `own` the hero's reach, writing each node down on the way back; `best` gets hero's
   * values best-responding from here on, in the same walk. */
  private record(id: number, hero: Seat, reach: Float64Array, own: Float64Array, out: Float64Array, best: Float64Array, depth: number, reports: Map<number, NodeReport>, scratch: Float64Array[][]): void {
    const node = this.game.tree.nodes[id]!;
    if (node.kind !== "action") {
      this.terminal(node, hero, reach, out);
      best.set(out.subarray(0, this.game.sides[hero].n));
      return;
    }
    const level = this.levels[depth]!;
    const report = reports.get(id)!;
    const a = node.actions.length;
    const seat = node.player;
    const n = this.game.sides[seat].n;
    const heroN = this.game.sides[hero].n;
    const sigma = level.sigma;
    this.averageAt(node, seat, sigma);
    const meet = level.meet;
    this.terminals.meet(hero, reach, meet);
    const half = this.half;
    let joint = 0;
    if (seat === hero) {
      report.strategy.set(sigma.subarray(0, a * n));
      const next = level.own;
      const frequency = new Array<number>(a).fill(0);
      for (let k = 0; k < a; k++) {
        const v = level.values[k]!;
        const b = scratch[depth]![k]!;
        for (let i = 0; i < n; i++) next[i] = own[i]! * sigma[k * n + i]!;
        this.record(node.children[k]!, hero, reach, next, v, b, depth + 1, reports, scratch);
        let won = 0;
        for (let i = 0; i < n; i++) {
          if (meet[i]! > TINY) {
            report.actionEv[k * n + i] = v[i]! / meet[i]! + half;
            report.bestEv[k * n + i] = b[i]! / meet[i]! + half;
          }
          frequency[k]! += next[i]! * Math.max(meet[i]!, 0);
          won += next[i]! * v[i]!;
        }
        if (frequency[k]! > TINY * this.game.matchups) report.actionRangeEv[k] = won / frequency[k]! + half;
      }
      for (let i = 0; i < n; i++) {
        let t = 0;
        let top = -Infinity;
        for (let k = 0; k < a; k++) {
          t += sigma[k * n + i]! * level.values[k]![i]!;
          top = Math.max(top, scratch[depth]![k]![i]!);
        }
        out[i] = t;
        best[i] = top;
        report.weight[i] = own[i]!;
        if (meet[i]! > TINY) report.ev[i] = t / meet[i]! + half;
        joint += own[i]! * Math.max(meet[i]!, 0);
      }
      if (joint > 0) report.frequency = frequency.map((f) => f / joint);
    } else {
      out.fill(0, 0, heroN);
      best.fill(0, 0, heroN);
      for (let i = 0; i < heroN; i++) joint += own[i]! * Math.max(meet[i]!, 0);
      const next = level.reach;
      const child = level.values[0]!;
      const childBest = scratch[depth]![0]!;
      for (let k = 0; k < a; k++) {
        for (let i = 0; i < n; i++) next[i] = reach[i]! * sigma[k * n + i]!;
        this.record(node.children[k]!, hero, next, own, child, childBest, depth + 1, reports, scratch);
        for (let i = 0; i < heroN; i++) {
          out[i]! += child[i]!;
          best[i]! += childBest[i]!;
        }
      }
    }
    let total = 0;
    for (let i = 0; i < heroN; i++) total += own[i]! * out[i]!;
    report.reach = joint / this.game.matchups;
    report.rangeEv[hero] = joint > TINY * this.game.matchups ? total / joint + half : null;
  }
}

/** A report's buffers for the best-response values beside the average's: one a level and action, and one for the root. */
export function bestScratch(tree: RiverTree, n: number): { top: Float64Array; levels: Float64Array[][] } {
  const widest = widestOf(tree);
  return { top: new Float64Array(n), levels: Array.from({ length: tree.depth + 1 }, () => Array.from({ length: widest }, () => new Float64Array(n))) };
}

/** a reach this small is rounding, not a hand that can be met */
const TINY = 1e-11;

/** The widest node of a tree, in actions. */
export const widestOf = (tree: RiverTree): number => Math.max(1, ...tree.nodes.map((x) => (x.kind === "action" ? x.actions.length : 0)));

/** Scratch vectors for a tree `depth` deep, `widest` actions at most, `n` combos a side at most. */
export const levelsFor = (n: number, widest: number, depth: number): Level[] => Array.from({ length: depth + 1 }, () => new Level(n, widest));

/** A level of the tree's scratch vectors. */
export class Level {
  value: Float64Array;
  reach: Float64Array;
  own: Float64Array;
  meet: Float64Array;
  sigma: Float32Array;
  values: Float64Array[];
  constructor(n: number, widest: number) {
    this.value = new Float64Array(n);
    this.reach = new Float64Array(n);
    this.own = new Float64Array(n);
    this.meet = new Float64Array(n);
    this.sigma = new Float32Array(n * widest);
    this.values = Array.from({ length: widest }, () => new Float64Array(n));
  }
}
