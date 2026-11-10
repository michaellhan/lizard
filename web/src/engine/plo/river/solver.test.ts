import { describe, expect, it } from "vitest";
import { parseIds } from "../cards";
import { parseRange, type PloRange } from "../ranges";
import { compileGame, RiverError, type RiverGame } from "./game";
import { memoryBytes, RiverSolver, type NodeReport } from "./solver";
import type { RiverSizes } from "./tree";

// the board: a king-high straight (Q T) is the nuts, nothing else near it: no pair, no three of a suit
const BOARD = "2c7d9hJsKd";
const VALUE = "QhTh4c3c";
const AIR = "6s5s4h3d";
const CATCHER = "AsAc8s8c";

const range = (t: string, board: number[]): PloRange => {
  const r = parseRange(t, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};

function game(oop: string, ip: string, opts: { board?: string; pot?: number; stack?: number; sizes?: Partial<RiverSizes> } = {}): RiverGame {
  const board = parseIds(opts.board ?? BOARD, 5)!;
  return compileGame({
    board,
    ranges: [range(oop, board), range(ip, board)],
    pot: opts.pot ?? 10,
    stacks: [opts.stack ?? 100, opts.stack ?? 100],
    sizes: { bets: [100], raises: [], raiseCap: 0, allIn: false, ...opts.sizes },
  });
}

function solve(g: RiverGame, target = 0.002, limit = 20000) {
  const s = new RiverSolver(g);
  let m = s.measure();
  while (s.iterations < limit) {
    for (let i = 0; i < 25; i++) s.iterate();
    m = s.measure();
    if (m.pct <= target) break;
  }
  return { s, m, nodes: s.report() };
}

const at = (nodes: NodeReport[], path: string) => nodes.find((n) => n.path === path)!;
/** a seat's combo by its hand's cards, as the game orders them */
function comboOf(g: RiverGame, seat: 0 | 1, hand: string) {
  const r = parseRange(hand);
  if (typeof r === "string") throw new Error(r);
  return g.sides[seat].hands.indexOf(r.hands[0]!);
}

describe("a polarised river, hand-solved", () => {
  // the bets are one part bluff to (P + B) / B parts in all: bluffs B / (P + 2B) of the bets, called P / (P + B)
  for (const [bet, pot, bluffShare, called, ev] of [
    [100, 10, 1 / 3, 1 / 2, 7.5],
    [50, 10, 1 / 4, 2 / 3, (10 + (2 / 3) * 5) / 2],
  ] as const)
    it(`a ${bet}% pot bet: bluffs ${bluffShare.toFixed(3)} of the bets, called ${called.toFixed(3)}`, () => {
      const g = game(`${VALUE},${AIR}`, CATCHER, { pot, sizes: { bets: [bet] } });
      const { nodes, m } = solve(g);
      const root = at(nodes, "");
      const value = comboOf(g, 0, VALUE);
      const air = comboOf(g, 0, AIR);
      const n = g.sides[0].n;
      const betIt = (i: number) => root.strategy[n + i]!;
      expect(betIt(value)).toBeCloseTo(1, 2);
      // bluffs / (value + bluffs) = share
      expect(betIt(air) / (betIt(air) + betIt(value))).toBeCloseTo(bluffShare, 2);
      expect(at(nodes, `b${(pot * bet)}`).strategy[1]).toBeCloseTo(called, 2);
      expect(root.rangeEv[0]).toBeCloseTo(ev, 2);
      expect(root.rangeEv[1]).toBeCloseTo(pot - ev, 2);
      expect(m.value + pot / 2).toBeCloseTo(ev, 2);
    });

  it("value's EV by combo: a bet called half the time, 15 for pot-size; air's nothing", () => {
    const g = game(`${VALUE},${AIR}`, CATCHER);
    const root = at(solve(g).nodes, "");
    expect(root.ev[comboOf(g, 0, VALUE)]).toBeCloseTo(15, 2);
    expect(root.ev[comboOf(g, 0, AIR)]).toBeCloseTo(0, 2);
  });
});

describe("blockers change the answer, hand-solved", () => {
  // one catcher holds the value hand's 4c, so it can only ever be up against air. Three matchups, not four. It calls
  // everything; the other catcher calls so that air's bet breaks even, y = 1/3, and air bets so it's indifferent, x = 1/3
  const g = game(`${VALUE},${AIR}`, "AsAc8s4c,AdAh8d8h", { sizes: { bets: [50] } });
  const { nodes } = solve(g);
  it("has three matchups", () => expect(g.matchups).toBeCloseTo(3, 9));
  it("calls with the blocker every time, and a third with the other", () => {
    const facing = at(nodes, "b500");
    const n = g.sides[1].n;
    const blocker = comboOf(g, 1, "AsAc8s4c");
    const other = comboOf(g, 1, "AdAh8d8h");
    expect(facing.strategy[n + blocker]).toBeCloseTo(1, 2);
    expect(facing.strategy[n + other]).toBeCloseTo(1 / 3, 2);
  });
  it("bluffs a third", () => {
    expect(at(nodes, "").strategy[g.sides[0].n + comboOf(g, 0, AIR)]).toBeCloseTo(1 / 3, 2);
  });
  it("the value hand earns 35/3, over the one matchup it has", () => {
    expect(at(nodes, "").ev[comboOf(g, 0, VALUE)]).toBeCloseTo(35 / 3, 2);
    expect(at(nodes, "").rangeEv[0]).toBeCloseTo(35 / 9, 2);
  });
});

describe("total block", () => {
  it("drops a hand that can meet nothing, and says how many", () => {
    // the first hand holds both of the other's aces... and the catcher is the only hand there is
    const g = game(`${VALUE},AsAc4d5d`, CATCHER);
    expect(g.unmatched).toEqual([1, 0]);
    expect(g.sides[0].n).toBe(1);
    expect(g.matchups).toBe(1);
    // value against a catcher that knows it: it never pays, and value wins what's in the pot
    expect(solve(g).nodes[0]!.rangeEv[0]).toBeCloseTo(10, 2);
  });

  it("refuses when no matchup can be dealt", () => {
    expect(() => game("AsAc4d5d,AsAh4d5d", "As3c4h5h,As3d4h5h")).toThrow(RiverError);
  });

  it("says when a range is all on the board", () => {
    expect(() => game("2c3c4c5c", CATCHER)).toThrow(/OOP range has no hand left/);
  });

  it("refuses a board that isn't one", () => {
    const board = parseIds("2c7d9hJs")!;
    expect(() => compileGame({ board, ranges: [range(VALUE, board), range(CATCHER, board)], pot: 10, stacks: [10, 10], sizes: { bets: [100], raises: [], raiseCap: 0, allIn: false } })).toThrow(/five different/);
  });
});

describe("zero sum, every node", () => {
  const g = game("AAK9@30,KQJTds,Q9T8@10", "JJT8,T987@20,AQJ9@15", { board: "Qs9s4d2h7c", pot: 20, stack: 60, sizes: { bets: [50, 100], raises: [100], raiseCap: 2, allIn: true } });
  const { s, m, nodes } = solve(g, 0.2, 400);
  it("the two seats' range EVs add to the pot", () => {
    for (const n of nodes) {
      if (n.rangeEv[0] === null || n.rangeEv[1] === null) continue;
      expect(n.rangeEv[0] + n.rangeEv[1], n.path).toBeCloseTo(20, 6);
    }
  });
  it("the root's EV is the value the measure gives", () => {
    expect(nodes[0]!.rangeEv[0]! - 10).toBeCloseTo(m.value, 6);
    expect(nodes[0]!.reach).toBeCloseTo(1, 9);
  });
  it("a best response never loses to the average", () => {
    expect(m.gain[0]).toBeGreaterThanOrEqual(-1e-9);
    expect(m.gain[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(m.chips).toBeCloseTo((m.gain[0] + m.gain[1]) / 2, 9);
    expect(-m.best[1]).toBeLessThanOrEqual(m.value + 1e-9);
    expect(m.value).toBeLessThanOrEqual(m.best[0] + 1e-9);
  });
  it("a node's frequencies add to one, and each child's reach is its share", () => {
    for (const n of nodes) {
      if (n.reach === 0) continue;
      expect(n.frequency.reduce<number>((t, f) => t + f!, 0), n.path).toBeCloseTo(1, 6);
      const node = g.tree.nodes[n.id]!;
      if (node.kind !== "action") continue;
      node.children.forEach((c, k) => {
        const child = nodes.find((x) => x.id === c);
        if (child) expect(child.reach, child.path).toBeCloseTo(n.reach * n.frequency[k]!, 5);
      });
    }
  });
  it("a combo's EV is the mix of its actions' EVs", () => {
    const root = nodes[0]!;
    const n = g.sides[0].n;
    for (let i = 0; i < n; i += 37) {
      let t = 0;
      for (let k = 0; k < g.tree.nodes[0]!.path.length + (g.tree.nodes[0] as { actions: unknown[] }).actions.length; k++) t += root.strategy[k * n + i]! * root.actionEv[k * n + i]!;
      expect(t).toBeCloseTo(root.ev[i]!, 3);
    }
  });
  it("each action's EV with best play after it: never under its EV played on at the average, the same where nothing is left to decide", () => {
    let checked = 0;
    for (const n of nodes) {
      const node = g.tree.nodes[n.id]!;
      if (node.kind !== "action") continue;
      const size = n.weight.length;
      const last = node.children.every((c) => g.tree.nodes[c]!.kind !== "action");
      for (let k = 0; k < node.actions.length; k++)
        for (let i = 0; i < size; i++) {
          const avg = n.actionEv[k * size + i]!;
          const best = n.bestEv[k * size + i]!;
          expect(Number.isNaN(avg)).toBe(Number.isNaN(best));
          if (Number.isNaN(avg)) continue;
          expect(best, n.path).toBeGreaterThanOrEqual(avg - 1e-4);
          if (last) expect(best, n.path).toBeCloseTo(avg, 4);
          checked++;
        }
    }
    expect(checked).toBeGreaterThan(1000);
  });
  it("the solver's own memory bound covers what it holds", () => {
    const held = g.sides[0].n * g.tree.slots[0] * 8 + g.sides[1].n * g.tree.slots[1] * 8;
    expect(memoryBytes(g)).toBeGreaterThan(held);
    expect(s.iterations).toBeGreaterThan(0);
  });
});

describe("exploitability", () => {
  const spot = () => game("AAK9@30,KQJTds,Q9T8@10", "JJT8,T987@20,AQJ9@15", { board: "Qs9s4d2h7c", pot: 20, stack: 60, sizes: { bets: [50, 100], raises: [100], raiseCap: 2, allIn: true } });
  it("falls under the target, from a long way over it", () => {
    const s = new RiverSolver(spot());
    const first = s.measure().pct;
    expect(first).toBeGreaterThan(5);
    let m = first;
    while (s.iterations < 2000 && m > 0.1) {
      for (let i = 0; i < 20; i++) s.iterate();
      m = s.measure().pct;
    }
    expect(m).toBeLessThanOrEqual(0.1);
  });

  it("is exact on a known strategy, worked by hand", () => {
    // OOP checks everything and calls any bet; IP always folds to a bet and checks back when checked to
    const g = game(`${VALUE},${AIR}`, CATCHER);
    const s = new RiverSolver(g);
    s.setAverage((node, seat) => {
      const n = g.sides[seat].n;
      const a = node.actions.length;
      const out = new Float64Array(a * n);
      if (node.path === "") out.fill(1, 0, n);
      else if (node.path === "x") out.fill(1, 0, n);
      else if (node.path === "b1000") out.fill(1, 0, n);
      else if (node.path === "x.b1000") out.fill(1, n, 2 * n);
      return out;
    });
    const m = s.measure();
    // checked down, each seat wins one matchup of two: the value in the zero-sum form is nothing
    expect(m.value).toBeCloseTo(0, 9);
    // OOP's best response bets both hands and IP folds them: 10 from both matchups, 5 over its half of the pot
    expect(m.best[0]).toBeCloseTo(5, 9);
    // IP's best response has nothing better: a bet is called by air, which it beats, and by value, which beats it
    expect(m.best[1]).toBeCloseTo(0, 9);
  });
});
