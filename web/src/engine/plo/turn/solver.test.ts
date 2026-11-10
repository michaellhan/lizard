import { describe, expect, it } from "vitest";
import { parseIds } from "../cards";
import { EquityJob } from "../equity";
import { parseRange, type PloRange } from "../ranges";
import { compileGame, RiverError } from "../river/game";
import { runJob, startJob } from "../river/run";
import { RiverSolver } from "../river/solver";
import type { RiverSizes } from "../river/tree";
import { compileTurn, RIVERS_PER_MATCHUP, type TurnGame } from "./game";
import { TurnSolver, turnMemoryBytes, turnWork } from "./solver";

const TURN = "2c7d9hJs";
const OOP = "QhTh4c3c,6s5s4h3d,AsAc8s8c,KhKcQdJd";
const IP = "AhAd5c5d,Tc9c8d7h,KsQsJcTd";

const range = (t: string, board: number[]): PloRange => {
  const r = parseRange(t, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};
const NONE: RiverSizes = { bets: [], raises: [], raiseCap: 0, allIn: false };
const RIVER: RiverSizes = { bets: [100], raises: [100], raiseCap: 1, allIn: false };

function turn(oop: string, ip: string, o: { pot?: number; stack?: number; turnSizes?: RiverSizes; riverSizes?: RiverSizes } = {}): TurnGame {
  const board = parseIds(TURN, 4)!;
  return compileTurn({
    board,
    ranges: [range(oop, board), range(ip, board)],
    pot: o.pot ?? 10,
    stacks: [o.stack ?? 50, o.stack ?? 50],
    turnSizes: o.turnSizes ?? NONE,
    riverSizes: o.riverSizes ?? RIVER,
  });
}

function solveTurn(g: TurnGame, target: number, limit = 4000) {
  const s = new TurnSolver(g);
  let m = s.measure();
  while (s.iterations < limit && m.pct > target) {
    for (let i = 0; i < 20; i++) s.iterate();
    m = s.measure();
  }
  return { s, m };
}

describe("a heads-up PLO turn", () => {
  it("counts each matchup over the 40 river cards it can see", () => {
    const g = turn(OOP, IP);
    const sum = g.rivers.reduce((t, r) => t + r.game.matchups, 0);
    expect(sum).toBeCloseTo(RIVERS_PER_MATCHUP * g.matchups, 9);
    // (every card not on the board can come; on these ranges each leaves a matchup)
    expect(g.rivers.length).toBe(48);
    expect(turnWork(g)).toBeGreaterThan(0);
    expect(turnMemoryBytes(g)).toBeGreaterThan(0);
  });

  it("checked through, is worth what the 48 rivers solved one by one are worth, matchup for matchup", () => {
    const g = turn(OOP, IP);
    const { m } = solveTurn(g, 0.005);
    expect(m.pct).toBeLessThanOrEqual(0.005);
    const board = parseIds(TURN, 4)!;
    let total = 0;
    let errs = 0;
    for (let card = 0; card < 52; card++) {
      if (board.includes(card)) continue;
      const five = [...board, card];
      let rg;
      try {
        rg = compileGame({ board: five, ranges: [range(OOP, five), range(IP, five)], pot: 10, stacks: [50, 50], sizes: RIVER });
      } catch (e) {
        if (e instanceof RiverError) continue;
        throw e;
      }
      const rs = new RiverSolver(rg);
      let rm = rs.measure();
      while (rm.pct > 0.002 && rs.iterations < 20000) {
        for (let i = 0; i < 25; i++) rs.iterate();
        rm = rs.measure();
      }
      total += rg.matchups * rm.value;
      errs += rg.matchups * rm.chips;
    }
    const byRivers = total / (RIVERS_PER_MATCHUP * g.matchups);
    const slack = m.chips + errs / (RIVERS_PER_MATCHUP * g.matchups) + 1e-6;
    expect(Math.abs(m.value - byRivers)).toBeLessThanOrEqual(2 * slack);
  });

  it("all-in on the turn, is worth each matchup's equity over the river, card for card (engine/plo/equity.ts)", () => {
    // (a pot-sized bet is the whole stack: OOP bets it, IP calls)
    const g = turn("QhTh4c3c", "AsAc8s8c", { stack: 10, turnSizes: { bets: [100], raises: [], raiseCap: 0, allIn: true } });
    const s = new TurnSolver(g);
    s.setAverage((node) => {
      const kinds = node.actions.map((a) => a.kind);
      const want = kinds.includes("call") ? "call" : kinds.includes("bet") ? "bet" : "check";
      return node.actions.map((a) => (a.kind === want ? 1 : 0));
    });
    const board = parseIds(TURN, 4)!;
    const job = new EquityJob({ players: [range("QhTh4c3c", board), range("AsAc8s8c", board)], board, mode: "exact" });
    while (!job.step(1e9));
    const eq = job.result().players[0]!.equity;
    expect(s.measure().value).toBeCloseTo((2 * eq - 1) * 15, 9);
  });

  it("bets and raises on the turn and the river, and closes in on equilibrium", () => {
    const g = turn(OOP, IP, { stack: 20, turnSizes: { bets: [75], raises: [100], raiseCap: 1, allIn: true } });
    expect([...g.closings.values()].some((c) => c.tree === null)).toBe(true);
    const { s, m } = solveTurn(g, 0.05, 3000);
    expect(m.pct).toBeLessThanOrEqual(0.05);
    const nodes = s.report();
    const root = nodes.find((n) => n.path === "")!;
    expect(root.reach).toBeCloseTo(1, 9);
    expect(root.frequency.reduce<number>((t, f) => t + (f ?? 0), 0)).toBeCloseTo(1, 6);
    // (zero-sum: the two seats' EVs at the root make the pot)
    expect(root.rangeEv[0]! + root.rangeEv[1]!).toBeCloseTo(10, 6);
    // each action's EV with best play after it, through every river, is never under its EV played on at the average
    for (const n of nodes)
      n.bestEv.forEach((best, j) => {
        if (!Number.isNaN(best)) expect(best, n.path).toBeGreaterThanOrEqual(n.actionEv[j]! - 1e-4);
      });
  });

  it("refuses a board that isn't four cards, and sizes that aren't the table's", () => {
    const board = parseIds(TURN, 4)!;
    const spec = { board, ranges: [range(OOP, board), range(IP, board)] as [PloRange, PloRange], pot: 10, stacks: [50, 50] as [number, number], turnSizes: NONE, riverSizes: RIVER };
    expect(() => compileTurn({ ...spec, board: board.slice(0, 3) })).toThrow(RiverError);
    expect(() => compileTurn({ ...spec, riverSizes: { ...RIVER, bets: [150] } })).toThrow("The river: ");
  });

  it("runs as a job from a request with a four-card board, and needs the river's sizes", async () => {
    const req = { oop: OOP, ip: IP, board: TURN, pot: 10, stacks: [50, 50] as [number, number], sizes: NONE, targetPct: 0.5 };
    expect(() => startJob(req)).toThrow("A turn needs the river's sizes too.");
    const { result } = await runJob(startJob({ ...req, riverSizes: RIVER }), { pause: () => Promise.resolve() });
    expect(result!.street).toBe("turn");
    expect(result!.rivers).toBe(48);
    expect(result!.riverSizes).toEqual(RIVER);
    expect(result!.stop).toBe("target");
    expect(result!.nodes.map((n) => n.line)).toEqual(["", "OOP Check"]);
  });
});
