// Solving a heads-up PLO4 turn exactly, by the river solver's discounted CFR (../river/solver.ts) on the whole game: the
// turn's tree, and at every closing of it a river game for each card that can come, every combo and every matchup, no
// bucket and no sample. A pass walks the turn's tree once for each seat; where the turn's betting closes it walks every
// river's tree too, each river's numbers its own (a river solver per card and closing) and their scratch vectors shared,
// as the rivers are walked one at a time. Every river is discounted on the turn's iteration count, so the whole is one
// DCFR run.
//
// Exploitability is the river's: an exact best response to each side's average, through the turn and every river, the
// average of what each seat gains, in chips per matchup and as a percent of the turn's pot.
import { RiverSolver, levelsFor, widestOf, Level, type Exploitability } from "../river/solver";
import { Terminals } from "../river/game";
import type { ActionNode, RiverNode, Seat } from "../river/tree";
import { OOP } from "../river/tree";
import { other, RIVERS_PER_MATCHUP, riverGame, type TurnGame } from "./game";

const ALPHA = 1.5;
const GAMMA = 2;
const TINY = 1e-11;

type How = "solve" | "best" | "average";

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

export interface TurnNodeReport {
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

export class TurnSolver {
  iterations = 0;
  private readonly regret: [Float32Array, Float32Array];
  private readonly average: [Float32Array, Float32Array];
  private readonly levels: Level[];
  private readonly terminals: Terminals;
  /** by closing id: a solver for each of game.rivers (null for an all-in closing) */
  private readonly subs = new Map<number, RiverSolver[] | null>();
  private readonly riverReach: Float64Array;
  private readonly riverOut: Float64Array;
  private readonly half: number;
  private keepGain = 0;
  private keepLoss = 0.5;
  private keepAverage = 0;

  constructor(readonly game: TurnGame) {
    const { sides, tree, rivers, closings } = game;
    this.regret = [new Float32Array(sides[0].n * tree.slots[0]), new Float32Array(sides[1].n * tree.slots[1])];
    this.average = [new Float32Array(sides[0].n * tree.slots[0]), new Float32Array(sides[1].n * tree.slots[1])];
    this.levels = levelsFor(Math.max(sides[0].n, sides[1].n), widestOf(tree), tree.depth);
    this.terminals = new Terminals(game);
    this.half = tree.pot / 2;
    let n = 1;
    let widest = 1;
    let depth = 0;
    for (const r of rivers) n = Math.max(n, r.game.sides[0].n, r.game.sides[1].n);
    for (const c of closings.values())
      if (c.tree) {
        widest = Math.max(widest, widestOf(c.tree));
        depth = Math.max(depth, c.tree.depth);
      }
    const shared = levelsFor(n, widest, depth);
    for (const c of closings.values()) this.subs.set(c.id, c.tree ? rivers.map((r) => new RiverSolver(riverGame(r, c.tree!), { terminals: r.terminals, levels: shared })) : null);
    this.riverReach = new Float64Array(n);
    this.riverOut = new Float64Array(n);
  }

  /** One pass for each seat. */
  iterate(): void {
    const t = ++this.iterations;
    const last = t - 1;
    const tp = last ** ALPHA;
    this.keepGain = tp / (tp + 1);
    this.keepLoss = 0.5;
    this.keepAverage = (last / t) ** GAMMA;
    for (const subs of this.subs.values()) if (subs) for (const s of subs) s.begin(t);
    for (const hero of [0, 1] as const) this.walk(0, hero, this.game.sides[other(hero)].weights, this.levels[0]!.value, 0, "solve");
  }

  /** The chips each way where the turn's betting ends: a fold, or every river after it closes. */
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
    const { riverReach: rr, riverOut: ro } = this;
    const opp = other(hero);
    this.game.rivers.forEach((r, k) => {
      const backOpp = r.back[opp];
      const backHero = r.back[hero];
      let any = 0;
      for (let j = 0; j < backOpp.length; j++) any += rr[j] = reach[backOpp[j]!]!;
      if (any === 0) return;
      if (!subs) r.terminals.showdown(hero, rr, closing.pot / 2, ro);
      else if (how === "solve") subs[k]!.pass(hero, rr, ro);
      else subs[k]!.valueAt(hero, rr, ro, how === "best");
      for (let i = 0; i < backHero.length; i++) out[backHero[i]!]! += ro[i]! / RIVERS_PER_MATCHUP;
    });
  }

  private current(node: ActionNode, seat: Seat, to: Float32Array, avg: boolean): void {
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

  /** Puts a given turn strategy in place of the average, to measure it (`action * n + combo` by node). */
  setAverage(get: (node: ActionNode, seat: Seat) => ArrayLike<number>): void {
    for (const node of this.game.tree.nodes) {
      if (node.kind !== "action") continue;
      this.average[node.player].set(get(node, node.player), node.offset * this.game.sides[node.player].n);
    }
  }

  /** Puts a given strategy in place of every river's average, by closing, river card and node. */
  setRiverAverage(get: (closing: number, card: number, node: ActionNode, seat: Seat) => ArrayLike<number>): void {
    for (const [id, subs] of this.subs) if (subs) subs.forEach((s, k) => s.setAverage((node, seat) => get(id, this.game.rivers[k]!.card, node, seat)));
  }

  private rootValue(hero: Seat, out: Float64Array): number {
    const w = this.game.sides[hero].weights;
    let t = 0;
    for (let i = 0; i < w.length; i++) t += w[i]! * out[i]!;
    return t / this.game.matchups;
  }

  /** How far the average strategies are from equilibrium, by an exact best response to each through every river. */
  measure(): Exploitability {
    const { sides, tree } = this.game;
    const value = (hero: Seat, best: boolean) => {
      const out = this.levels[0]!.value;
      this.walk(0, hero, sides[other(hero)].weights, out, 0, best ? "best" : "average");
      return this.rootValue(hero, out);
    };
    const best: [number, number] = [value(0, true), value(1, true)];
    const here = value(OOP, false);
    const gain: [number, number] = [best[0] - here, best[1] + here];
    const chips = (best[0] + best[1]) / 2;
    return { best, gain, chips, pct: (100 * chips) / tree.pot, value: here };
  }

  /** The turn's average strategies node by node, with reach and EV (EV: chips won from the pot less chips bet on the turn
   * and river). Costs about a pass. */
  report(): TurnNodeReport[] {
    const out = new Map<number, TurnNodeReport>();
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
    for (const hero of [0, 1] as const) {
      const own = Float64Array.from(this.game.sides[hero].weights);
      this.record(0, hero, this.game.sides[other(hero)].weights, own, this.levels[0]!.value, 0, out);
    }
    return [...out.values()];
  }

  private record(id: number, hero: Seat, reach: Float64Array, own: Float64Array, out: Float64Array, depth: number, reports: Map<number, TurnNodeReport>): void {
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
