import { describe, expect, it } from "vitest";
import { describeEquity, EquityError, EquityJob, EXACT_LIMIT, MAX_TABLES, POT_UNITS, type EquityResult, type EquitySpec } from "./equity";
import { cardId, parseIds } from "./cards";
import { handAt, handIndex, NUM_HANDS, sortHand } from "./combos";
import { parseRange, type PloRange } from "./ranges";
import reference from "./vectors/equity.json";
import cited from "./vectors/equity_cited.json";
import preflop from "./vectors/equity_preflop.json";

const hand = (text: string): PloRange => ({ hands: Int32Array.of(handIndex(sortHand(parseIds(text, 4)!))), weights: Float32Array.of(1) });
const range = (text: string): PloRange => {
  const r = parseRange(text);
  if (typeof r === "string") throw new Error(r);
  return r;
};
const finish = (spec: EquitySpec, slice = 1 << 20): EquityResult => {
  const job = new EquityJob(spec);
  while (!job.step(slice));
  return job.result();
};
const exact = (players: string[], board: string, extra: Partial<EquitySpec> = {}) => finish({ players: players.map(hand), board: parseIds(board)!, mode: "exact", ...extra });

describe("exact, against scripts/engine/plo_reference.py", () => {
  it("river, turn and flop: 192 spots of 2 to 6 hands, with dead cards, every count the same", () => {
    expect(reference.units).toBe(POT_UNITS);
    expect(reference.vectors.length).toBeGreaterThanOrEqual(190);
    for (const v of reference.vectors) {
      const r = exact(v.players, v.board, { dead: parseIds(v.dead)! });
      expect({ who: v.players.join(" ") + "/" + v.board, boards: r.runouts, wins: r.counts.wins, ties: r.counts.ties, shares: r.counts.units }).toEqual({
        who: v.players.join(" ") + "/" + v.board,
        boards: v.boards,
        wins: v.wins,
        ties: v.ties,
        shares: v.shares,
      });
    }
  });

  it("the same with each hand's sixty worked out, no tables", () => {
    for (const v of reference.vectors.filter((_, i) => i % 9 === 0)) {
      const r = exact(v.players, v.board, { dead: parseIds(v.dead)!, tables: false });
      expect(r.counts.units).toEqual(v.shares);
    }
  });

  it("preflop, every board: two heads-up and one three-way, the counts the same", () => {
    expect(preflop.vectors.length).toBeGreaterThanOrEqual(3);
    for (const v of preflop.vectors) {
      const r = exact(v.players, "");
      expect([r.runouts, r.counts.wins, r.counts.ties, r.counts.units]).toEqual([v.boards, v.wins, v.ties, v.shares]);
      expect(r.runouts).toBe(v.players.length === 2 ? 1_086_008 : 658_008);
    }
  });

  it("ranges against ranges: every matchup weighted by the product of the weights", () => {
    for (const v of reference.rangeVectors) {
      const players = v.ranges.map((seat) => {
        const entries = seat.map(([h, w]) => [handIndex(sortHand(parseIds(h as string, 4)!)), w as number] as const).sort((a, b) => a[0] - b[0]);
        return { hands: Int32Array.from(entries, (e) => e[0]), weights: Float32Array.from(entries, (e) => e[1]) };
      });
      const r = finish({ players, board: parseIds(v.board)!, mode: "exact" });
      expect(r.matchups).toBe(v.matchups);
      r.players.forEach((p, i) => expect(p.equity).toBeCloseTo(v.equity[i]!, 11));
    }
  });
});

describe("cases worked by hand", () => {
  it("two aces and two queens are the only outs: one spade in the hand makes no flush on a three-spade board", () => {
    // 40 rivers. AAQQ needs an ace or a queen to pass the deuces' set. A spade does nothing for it: As is its only one.
    const r = exact(["AsAhQcQd", "2h2d5c6c"], "2s7s9sKd");
    expect(r.counts.wins).toEqual([4, 36]);
    expect(r.players[0]!.equity).toBeCloseTo(4 / 40, 12);
  });

  it("one out: the last king, against aces", () => {
    // kings' set behind aces' set, 40 rivers. The case king makes quads; a seven pairs the board for both, aces still ahead
    const r = exact(["KsKc9h4h", "AsAc6s5s"], "Ah7d2cKd");
    expect(r.counts.wins).toEqual([1, 39]);
  });

  it("runner-runner: quad kings lose to one board in 820, the jack and ten of spades", () => {
    const r = exact(["Kc2d3h4c", "AsQs9d9c"], "KsKhKd");
    expect(r.runouts).toBe(820);
    expect(r.counts.wins).toEqual([819, 1]);
  });

  it("two broadways tie on all 40 rivers, the straight needing a card of the board's in the hand", () => {
    const r = exact(["AdTh3c4c", "AhTd5c6c"], "TsJsQdKc");
    expect(r.runouts).toBe(40);
    expect(r.counts.ties).toEqual([40, 40]);
    expect(r.players.map((p) => p.equity)).toEqual([0.5, 0.5]);
  });

  it("is a dead heat by symmetry: swapping spades with diamonds and hearts with clubs swaps the two hands", () => {
    const r = exact(["AsAhKsKh", "AdAcKdKc"], "");
    expect(r.counts.units[0]).toBe(r.counts.units[1]);
    expect(r.players[0]!.equity).toBe(0.5);
    expect(r.runouts).toBe(1_086_008);
  });

  it("gives exactly the pot: shares sum to 1 three-way, with a three-way tie counted a third each", () => {
    // each holds an ace and a ten, and plays the same broadway off the board's K Q J
    const t = exact(["AsTc2d3h", "AhTd2c3d", "AdTh2h3c"], "KsQsJd5h5c");
    expect(t.counts.ties).toEqual([1, 1, 1]);
    expect(t.players.map((p) => p.equity)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("a river is one board", () => {
    const r = exact(["Js9s8c7h", "AcAd8d7d"], "AsKsQs2s3d");
    expect(r.runouts).toBe(1);
    expect(r.counts.wins).toEqual([1, 0]); // a flush over a set of aces, by the two spades
  });
});

describe("third-party figures", () => {
  // Source: PokerStrategy.com, "PLO for Beginners (2) - Preflop Play",
  // https://www.pokerstrategy.com/strategy/omaha-poker/plo-for-beginners-preflop-play/ (read 2026-11-05). It doesn't name
  // its tool. These are its figures as printed, not ours; our Monte Carlo is held to them within its printed digit and
  // 4 standard errors, and where the reference could count the case exactly, the count stands beside the figure.
  const near = (ours: { equity: number; stderr: number }, pct: number, slack: number) =>
    expect(Math.abs(ours.equity * 100 - pct)).toBeLessThan(slack + 4 * ours.stderr * 100);

  it('printed: "AA**" 65.5% against a random hand, 65.17% wins and 0.33% in splits, 6,961 combos against 270,725', () => {
    const aces = range("AAxx");
    expect(aces.hands.length).toBe(6961);
    const any = range("random");
    expect(any.hands.length).toBe(NUM_HANDS);
    const r = finish({ players: [aces, any], board: [], mode: "montecarlo", runs: 300_000, seed: 65 });
    near(r.players[0]!, 65.5, 0.05);
    near(r.players[1]!, 34.5, 0.05);
    expect(Math.abs(r.players[0]!.win * 100 - 65.17)).toBeLessThan(0.005 + 4 * r.players[0]!.stderr * 100);
    expect(Math.abs((r.players[0]!.tie * 100) / 2 - 0.33)).toBeLessThan(0.05); // its split column is a tie's half
  });

  it('printed: Jc9c8d7d on KdQdTh has 27.75% against "AJxx"; counted exactly, 27.694%', () => {
    const { hands, matchups, halves } = cited.AJxx;
    const truth = halves / 2 / matchups;
    expect(hands).toBe(9610);
    expect(truth * 100).toBeCloseTo(27.694, 3);
    // the printed figure is 0.056 above the count: about one standard error of a 500,000 run simulation, which is the
    // likeliest reading, but the page doesn't say. It's not a figure this file can make exact.
    expect(Math.abs(truth * 100 - 27.75)).toBeLessThan(0.1);
    const r = finish({ players: [hand("Jc9c8d7d"), range("AJxx")], board: parseIds("KdQdTh")!, mode: "montecarlo", runs: 300_000, seed: 2775 });
    const p = r.players[0]!;
    expect(Math.abs(p.equity - truth)).toBeLessThan(4 * p.stderr);
  });

  it('printed: 0.00% against "AdJd**", drawing dead: the reference finds no share in any of its 740,460 matchups', () => {
    expect([cited.AdJdxx.hands, cited.AdJdxx.matchups, cited.AdJdxx.halves]).toEqual([903, 740460, 0]);
    const entries: number[] = [];
    for (let i = 0; i < NUM_HANDS; i++) {
      const h = handAt(i);
      if (h.includes(cardId("Ad")) && h.includes(cardId("Jd"))) entries.push(i);
    }
    const villain: PloRange = { hands: Int32Array.from(entries), weights: new Float32Array(entries.length).fill(1) };
    const r = finish({ players: [hand("Jc9c8d7d"), villain], board: parseIds("KdQdTh")!, mode: "montecarlo", runs: 100_000, seed: 0 });
    expect(r.players[0]!.equity).toBe(0);
  });
});

describe("Monte Carlo", () => {
  const spot = () => ({ players: ["AsAhKsKh", "JdTd9c8c"].map(hand), board: [], mode: "montecarlo" as const, runs: 40_000, seed: 7 });

  it("gives the same numbers from a seed, however it's sliced", () => {
    const a = finish(spot(), 1 << 20);
    const b = finish(spot(), 977);
    expect(b.players).toEqual(a.players);
    expect(b.runouts).toBe(40_000);
    expect(finish({ ...spot(), seed: 8 }).players).not.toEqual(a.players);
  });

  it("gives the same numbers from a seed with tables or without", () => {
    const a = finish(spot());
    const b = finish({ ...spot(), tables: false, runs: 40_000 });
    expect(b.players).toEqual(a.players);
  });

  it("lands within its standard error of the exact count: 3 in 4 within one, every one within four", () => {
    const v = preflop.vectors[0]!;
    const truth = v.shares[0]! / (v.boards * POT_UNITS);
    let within = 0;
    const seeds = 40;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = finish({ players: v.players.map(hand), board: [], mode: "montecarlo", runs: 20_000, seed });
      const p = r.players[0]!;
      const z = Math.abs(p.equity - truth) / p.stderr;
      expect(z).toBeLessThan(4);
      if (z < 1) within++;
      expect(p.stderr).toBeCloseTo(Math.sqrt((truth * (1 - truth)) / 20_000), 4);
    }
    expect(within / seeds).toBeGreaterThan(0.5); // (68% in theory)
    expect(within / seeds).toBeLessThan(0.9);
  });

  it("agrees with the exact count across a whole range, weights and all, collisions thrown out", () => {
    const players = [range("AsAhKsKh@50,AdAcKdKc,AsAdQsQd"), range("JsTs9h8h,JdTd9c8c@25")];
    const board = parseIds("2c7h9d")!;
    const e = finish({ players, board, mode: "exact" });
    const m = finish({ players, board, mode: "montecarlo", runs: 200_000, seed: 3 });
    expect(Math.abs(m.players[0]!.equity - e.players[0]!.equity)).toBeLessThan(4 * m.players[0]!.stderr);
  });

  it("rejects a matchup with a card in common, not a hand: the weights of those that fit are what count", () => {
    // Against the one hand holding As, seat 1 can only be the other: redrawing just the seat that clashed would weight
    // the matchups differently from counting those that can happen, which this holds the draws to
    const seat1 = range("AsKsQsJs@50,AdKdQdJd@50");
    const seat2 = range("As2c3c4c");
    expect(finish({ players: [seat1, seat2], board: parseIds("5h6h7h")!, mode: "exact" }).matchups).toBe(1);
    const players = [seat1, range("AsTc9c8c,KhTd9d8d")];
    const m = finish({ players, board: parseIds("2h7d9s")!, mode: "montecarlo", runs: 100_000, seed: 2 });
    const e = finish({ players, board: parseIds("2h7d9s")!, mode: "exact" });
    expect(e.matchups).toBe(3);
    expect(m.players[0]!.stderr).toBeGreaterThan(0);
    expect(Math.abs(m.players[0]!.equity - e.players[0]!.equity)).toBeLessThan(4 * m.players[0]!.stderr);
    expect(m.rejected).toBeGreaterThan(10_000);
  });

  it("reports win and tie apart from equity", () => {
    const r = finish({ players: ["AdTh3c4c", "AhTd5c6c"].map(hand), board: parseIds("TsJsQdKc")!, mode: "montecarlo", runs: 1000 });
    expect(r.players[0]).toMatchObject({ equity: 0.5, win: 0, tie: 1, stderr: 0 });
  });
});

describe("choosing and refusing", () => {
  it("counts two hands in full from any street, and goes to Monte Carlo when a range makes that too much", () => {
    expect(new EquityJob({ players: ["AsAhKsKh", "JdTd9c8c"].map(hand), board: [] }).method).toBe("exact");
    const big = new EquityJob({ players: [hand("AsAhKsKh"), range("JTxx")], board: [] });
    expect(big.method).toBe("montecarlo");
    expect(big.seed).toBe(1);
    expect(MAX_TABLES).toBeGreaterThan(0);
  });

  it("refuses an exact count that's out of reach, and says so", () => {
    expect(() => new EquityJob({ players: [hand("AsAhKsKh"), range("JTxx")], board: [], mode: "exact" })).toThrow(/Too much to count/);
    expect(EXACT_LIMIT).toBeLessThan(1e10);
  });

  it("refuses a bad spot", () => {
    const two = ["AsAhKsKh", "JdTd9c8c"].map(hand);
    const fails = (s: Partial<EquitySpec>) => () => new EquityJob({ players: two, board: [], ...s });
    expect(fails({ players: [two[0]!] })).toThrow(/2 to 9/);
    expect(fails({ board: [1, 2] })).toThrow(EquityError);
    expect(fails({ board: parseIds("AsKd2c")! })).toThrow(/Player 1 has no hand/);
    expect(fails({ board: parseIds("2c2d2h")!, dead: parseIds("2h")! })).toThrow(/twice/);
    expect(fails({ players: ["AsAhKsKh", "AsTd9c8c"].map(hand) })).toThrow(/same card/);
    expect(fails({ mode: "montecarlo", runs: 0 })).toThrow(/at least one/);
  });

  it("says when no matchup can happen", () => {
    // three seats, two aces of spades and hearts among them
    const seat = range("AsKsQsJs,AhKhQhJh");
    const job = new EquityJob({ players: [seat, range("As2c3c4c,Ah2d3d4d"), range("As5c6c7c,Ah5d6d7d")], board: parseIds("9c9d9h")!, mode: "exact" });
    expect(() => job.step(1 << 20)).toThrow(/card in common/);
    const mc = new EquityJob({ players: [seat, range("As2c3c4c,Ah2d3d4d"), range("As5c6c7c,Ah5d6d7d")], board: parseIds("9c9d9h")!, mode: "montecarlo", runs: 10 });
    expect(() => mc.step(10)).toThrow(/hardly ever/);
  });
});

describe("the label", () => {
  it("says what produced the numbers, unfinished work included", () => {
    expect(describeEquity(exact(["AsAhKsKh", "JdTd9c8c"], "2c7h9d"))).toBe("Exact: every board counted, 820 boards.");
    const job = new EquityJob({ players: ["AsAhKsKh", "JdTd9c8c"].map(hand), board: [], mode: "exact" });
    job.step(100); // (the first bite goes on the hands' tables)
    job.step(100);
    expect(describeEquity(job.result())).toBe("Exact count unfinished, 100 boards so far: not a result yet.");
    const mc = new EquityJob({ players: ["AsAhKsKh", "JdTd9c8c"].map(hand), board: [], mode: "montecarlo", runs: 2000, seed: 4 });
    mc.step(500);
    expect(describeEquity(mc.result())).toBe("Monte Carlo: 500 random runouts, stopped at 500 of 2,000, seed 4; ± is one standard error.");
    mc.step(5000);
    expect(describeEquity(mc.result())).toBe("Monte Carlo: 2,000 random runouts, seed 4; ± is one standard error.");
    const r = finish({ players: [range("AsAhKsKh,AdAcKdKc"), hand("JsTs9h8h")], board: parseIds("2c7h9d")!, mode: "exact" });
    expect(describeEquity(r)).toBe("Exact: every board counted, 1,640 boards across 2 matchups, weighted.");
  });
});
