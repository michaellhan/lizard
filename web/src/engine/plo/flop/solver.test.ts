import { describe, expect, it } from "vitest";
import { parseIds } from "../cards";
import { EquityJob } from "../equity";
import { parseRange, type PloRange } from "../ranges";
import { RiverError } from "../river/game";
import { runJob, startJob } from "../river/run";
import type { RiverSizes } from "../river/tree";
import { compileTurn } from "../turn/game";
import { TurnSolver } from "../turn/solver";
import { compileFlop, TURNS_PER_MATCHUP, type FlopGame } from "./game";
import { FlopSolver, flopMemoryBytes, flopWork } from "./solver";

const FLOP = "2c7d9h";
const OOP = "QhTh4c3c,6s5s4h3d,AsAc8s8c";
const IP = "AhAd5c5d,Tc9c8d7h";

const range = (t: string, board: number[]): PloRange => {
  const r = parseRange(t, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};
const NONE: RiverSizes = { bets: [], raises: [], raiseCap: 0, allIn: false };
const POT: RiverSizes = { bets: [100], raises: [], raiseCap: 0, allIn: false };

function flop(oop: string, ip: string, o: { pot?: number; stack?: number; flopSizes?: RiverSizes; turnSizes?: RiverSizes; riverSizes?: RiverSizes } = {}): FlopGame {
  const board = parseIds(FLOP, 3)!;
  return compileFlop({
    board,
    ranges: [range(oop, board), range(ip, board)],
    pot: o.pot ?? 10,
    stacks: [o.stack ?? 50, o.stack ?? 50],
    flopSizes: o.flopSizes ?? NONE,
    turnSizes: o.turnSizes ?? NONE,
    riverSizes: o.riverSizes ?? NONE,
  });
}

function solve(g: FlopGame, target: number, limit = 3000) {
  const s = new FlopSolver(g);
  let m = s.measure();
  while (s.iterations < limit && m.pct > target) {
    for (let i = 0; i < 10; i++) s.iterate();
    m = s.measure();
  }
  return { s, m };
}

function equity(oop: string, ip: string): number {
  const board = parseIds(FLOP, 3)!;
  const job = new EquityJob({ players: [range(oop, board), range(ip, board)], board, mode: "exact" });
  while (!job.step(1e9));
  return job.result().players[0]!.equity;
}

describe("a heads-up PLO flop", () => {
  it("counts each matchup over the 41 turn cards it can see", () => {
    const g = flop(OOP, IP);
    expect(g.turns.length).toBe(49);
    expect(g.turns.reduce((t, x) => t + x.cards.matchups, 0)).toBeCloseTo(TURNS_PER_MATCHUP * g.matchups, 9);
    expect(flopWork(g)).toBeGreaterThan(0);
    expect(flopMemoryBytes(g)).toBeGreaterThan(0);
  });

  it("checked down, is worth each matchup's equity over every turn and river (engine/plo/equity.ts)", () => {
    const g = flop(OOP, IP);
    const m = new FlopSolver(g).measure();
    expect(m.value).toBeCloseTo((2 * equity(OOP, IP) - 1) * 5, 9);
    expect(m.pct).toBeCloseTo(0, 9);
  });

  it("all-in on the flop, is worth the equity over both cards to come", () => {
    // (a pot-sized bet is the whole stack: OOP bets it, IP calls)
    const g = flop("QhTh4c3c", "AsAc8s8c", { stack: 10, flopSizes: { ...POT, allIn: true } });
    expect([...g.closings.values()].some((c) => c.tree === null)).toBe(true);
    const s = new FlopSolver(g);
    s.setAverage((node) => {
      const kinds = node.actions.map((a) => a.kind);
      const want = kinds.includes("call") ? "call" : kinds.includes("bet") ? "bet" : "check";
      return node.actions.map((a) => (a.kind === want ? 1 : 0));
    });
    expect(s.measure().value).toBeCloseTo((2 * equity("QhTh4c3c", "AsAc8s8c") - 1) * 15, 9);
  });

  it("checked through, is worth what the 49 turns solved one by one are worth, matchup for matchup", () => {
    const sizes = { turnSizes: POT, riverSizes: POT };
    const g = flop("QhTh4c3c,6s5s4h3d", "AsAc8s8c", sizes);
    const { m } = solve(g, 0.01);
    expect(m.pct).toBeLessThanOrEqual(0.01);
    const board = parseIds(FLOP, 3)!;
    let total = 0;
    let errs = 0;
    for (let card = 0; card < 52; card++) {
      if (board.includes(card)) continue;
      const four = [...board, card];
      let tg;
      try {
        tg = compileTurn({ board: four, ranges: [range("QhTh4c3c,6s5s4h3d", four), range("AsAc8s8c", four)], pot: 10, stacks: [50, 50], turnSizes: POT, riverSizes: POT });
      } catch (e) {
        if (e instanceof RiverError) continue;
        throw e;
      }
      const ts = new TurnSolver(tg);
      let tm = ts.measure();
      while (tm.pct > 0.005 && ts.iterations < 4000) {
        for (let i = 0; i < 20; i++) ts.iterate();
        tm = ts.measure();
      }
      total += tg.matchups * tm.value;
      errs += tg.matchups * tm.chips;
    }
    const byTurns = total / (TURNS_PER_MATCHUP * g.matchups);
    const slack = m.chips + errs / (TURNS_PER_MATCHUP * g.matchups) + 1e-6;
    expect(Math.abs(m.value - byTurns)).toBeLessThanOrEqual(2 * slack);
  }, 60000);

  it("bets on every street and closes in on equilibrium; its turns and rivers add up to their pots", () => {
    const g = flop(OOP, IP, { stack: 30, flopSizes: { bets: [50], raises: [], raiseCap: 0, allIn: true }, turnSizes: POT, riverSizes: POT });
    const { s, m } = solve(g, 0.1, 2000);
    expect(m.pct).toBeLessThanOrEqual(0.1);
    const root = s.report().find((n) => n.path === "")!;
    expect(root.reach).toBeCloseTo(1, 9);
    expect(root.rangeEv[0]! + root.rangeEv[1]!).toBeCloseTo(10, 6);

    // the turn after a check through, on the king: its two ranges' EVs make the turn's pot of 10
    const closing = [...g.closings.values()].find((c) => c.tree && c.pot === 10)!;
    const king = parseIds("Kd", 1)![0]!;
    const turn = s.turnReport(closing.id, king)!;
    const top = turn.nodes.find((n) => n.path === "")!;
    expect(top.rangeEv[0]! + top.rangeEv[1]!).toBeCloseTo(10, 6);
    // and the river after the turn checks through too, on the four of spades
    const turnClosing = [...turn.game.closings.values()].find((c) => c.tree && c.pot === 10)!;
    const river = s.riverReport(closing.id, king, turnClosing.id, parseIds("4s", 1)![0]!)!;
    const last = river.nodes.find((n) => n.path === "")!;
    expect(last.rangeEv[0]! + last.rangeEv[1]!).toBeCloseTo(10, 6);
    expect(s.turnReport(closing.id, parseIds("2c", 1)![0]!)).toBeNull(); // (on the board)
  }, 60000);

  it("refuses a board that isn't three cards, and sizes that aren't the table's", () => {
    const board = parseIds(FLOP, 3)!;
    const spec = { board, ranges: [range(OOP, board), range(IP, board)] as [PloRange, PloRange], pot: 10, stacks: [50, 50] as [number, number], flopSizes: NONE, turnSizes: NONE, riverSizes: NONE };
    expect(() => compileFlop({ ...spec, board: [...board, 40] })).toThrow(RiverError);
    expect(() => compileFlop({ ...spec, turnSizes: { ...NONE, bets: [150] } })).toThrow("The turn: ");
  });
});

describe("a flop as a job", () => {
  const POT_SIZES = { bets: [100], raises: [], raiseCap: 0, allIn: false };
  const req = { oop: "QhTh4c3c,6s5s4h3d", ip: "AsAc8s8c", board: FLOP, pot: 10, stacks: [50, 50] as [number, number], sizes: POT_SIZES, targetPct: 0.5 };

  it("needs the turn's and river's sizes, then solves the flop and hands back every turn and river after it", async () => {
    expect(() => startJob({ ...req, riverSizes: POT_SIZES })).toThrow("A flop needs the turn's and the river's sizes too.");
    const job = startJob({ ...req, turnSizes: POT_SIZES, riverSizes: POT_SIZES });
    const { result } = await runJob(job, { pause: () => Promise.resolve() });
    expect(result!.street).toBe("flop");
    expect(result!.turns).toBe(job.game.sides[1].n === 1 ? 45 : 49); // (IP's one hand's four cards leave it nothing)
    expect(result!.turnCards).toHaveLength(result!.turns!);
    expect(result!.turnSizes).toEqual(POT_SIZES);
    expect(result!.stop).toBe("target");
    const closings = result!.closings!;
    expect(closings.map((c) => c.line)).toEqual(["OOP Check, IP Check", "OOP Check, IP Bet 10, OOP Call 10", "OOP Bet 10, IP Call 10"]);

    // the turn after a bet and a call, on the king: its pot of 30, its two ranges' EVs adding to it
    const turn = job.riverView({ closing: closings[2]!.id, card: "Kd" })!;
    expect(turn.street).toBe("turn");
    expect(turn.pot).toBe(30);
    const top = turn.nodes[0]!;
    expect(top.rangeEv[0]! + top.rangeEv[1]!).toBeCloseTo(30, 6);
    expect(turn.closings!.map((c) => c.line)).toEqual(["OOP Check, IP Check", "OOP Check, IP Bet 30, OOP Call 30", "OOP Bet 30, IP Call 30"]);
    // and the river after that turn checks through, on the four of spades
    const river = job.riverView({ closing: closings[2]!.id, card: "Kd", turnClosing: turn.closings![0]!.id, river: "4s" })!;
    expect(river.street).toBe("river");
    expect(river).toMatchObject({ card: "4s", turn: "Kd", pot: 30 });
    expect(river.nodes[0]!.rangeEv[0]! + river.nodes[0]!.rangeEv[1]!).toBeCloseTo(30, 6);
    expect(job.riverView({ closing: closings[2]!.id, card: "2c" })).toBeNull(); // (on the board)
  }, 60000);
});
