// Turn and river reports: the classic runouts.test.js cases (what a card does to the board, the rows, filters,
// sorting, averages and groups, the notes, the solve's seconds) and when Study offers one.
import { describe, expect, it } from "vitest";
import {
  average,
  cardClass,
  CLASSES,
  estimate,
  filterRows,
  groups,
  inPot,
  lineLabel,
  mwSeconds,
  noteText,
  offersReport,
  partOf,
  rows,
  sawFlop,
  sortRows,
  type RunoutReport,
} from "./runouts";
import { freshHand, parseLine, type StudyHand } from "./studyState";

const deck = (board: string) => {
  const off = new Set(board.match(/../g));
  const out: string[] = [];
  for (const r of "AKQJT98765432") for (const s of "shdc") if (!off.has(r + s)) out.push(r + s);
  return out;
};
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe("runout reports", () => {
  it("card classes: a flush, a straight, pairing the board, overcards, undercards and bricks", () => {
    // Kd7c2h: rainbow and disconnected
    expect(["As", "Kh", "2s", "Qs", "5s"].map((x) => cardClass("Kd7c2h", x))).toEqual(["over", "pair", "pair", "under", "under"]);
    // 9c6d6c: a club completes the flush (two on board), cards around 9-6 a straight, the low cards bricks
    expect(["Ac", "6h", "8s", "Ts", "5h", "Jh", "3s", "2d"].map((x) => cardClass("9c6d6c", x))).toEqual([
      "flush",
      "pair",
      "straight",
      "straight",
      "straight",
      "over",
      "brick",
      "brick",
    ]);
    // the ace plays low: A on 5-4-x, a wheel's
    expect(cardClass("5d4c9h", "Ah")).toBe("straight");
    expect(cardClass("5d4c9h", "Ks")).toBe("over");
    // the flush before the pair; a river report's board has the turn too
    expect(cardClass("Kd7d2h", "7d")).toBe("flush");
    expect(cardClass("Kd7c2h5s", "4h")).toBe("straight");
    expect(cardClass("Kd7c2h5s", "Th")).toBe("under");
    for (const x of deck("Qh8h4c9d")) expect(CLASSES[cardClass("Qh8h4c9d", x)], x).toBeTruthy();
  });

  // a turn report shaped like Advisor.study's {"runouts": ...} on Kd7c2h: the flop solve's classes (the 7s, the rest),
  // a check by BB then BTN's bets; per card its chance, equities and EVs
  const all = deck("Kd7c2h");
  const sevens = all.filter((c) => c[0] === "7");
  const rest = all.filter((c) => c[0] !== "7");
  const part = (actor: string, f7: number[], fr: number[]) => ({
    actor,
    actions: ["check", "bet 75%"],
    avg: [0.6, 0.4],
    cards: [
      { card: "7d", cards: sevens, f: f7, w: 30 },
      { card: "Qh", cards: rest, f: fr, w: 60 },
    ],
  });
  const RO: RunoutReport = {
    study: "runouts",
    street: "turn",
    first: part("BB", [0.9, 0.1], [1, 0]),
    after_check: part("BTN", [0.8, 0.2], [0.45, 0.55]),
    seats: ["BB", "BTN"],
    pot_bb: 9.5,
    source: "solve",
    cards: all.map((c) => ({ card: c, p: 1 / 49, eq: c[0] === "A" ? [0.4, 0.6] : [0.55, 0.45], ev: c[0] === "A" ? [3.5, 6] : [4.5, 5] })),
    solver: { iterations: 400, exploitability_pct: 0.05, by: "hand buckets" },
  };

  it("rows: each card off the board with its class's mix, its chance, equities and EVs; filters, sorts, groups", () => {
    const rs = rows(RO, "first", "Kd7c2h");
    expect(rs).toHaveLength(49);
    const s7 = rs.find((r) => r.card === "7s")!;
    const ah = rs.find((r) => r.card === "Ah")!;
    expect([s7.cls, s7.f, s7.w, s7.ev]).toEqual(["pair", [0.9, 0.1], 30, [4.5, 5]]);
    expect([ah.cls, ah.f, ah.rank, ah.suit, ah.eq]).toEqual(["over", [1, 0], "A", "h", [0.4, 0.6]]);
    expect(rows(RO, "after", "Kd7c2h").find((r) => r.card === "7s")!.f).toEqual([0.8, 0.2]);
    expect(rows({ ...RO, after_check: null }, "after", "Kd7c2h").find((r) => r.card === "7s")!.f).toEqual([0.9, 0.1]); // (no check to follow)
    expect(filterRows(rs, { cls: "pair" })).toHaveLength(9);
    expect(filterRows(rs, { rank: "A" })).toHaveLength(4);
    expect(sortRows(rs, "card", true).slice(0, 5).map((r) => r.card)).toEqual(["As", "Ah", "Ad", "Ac", "Ks"]);
    expect(sortRows(rs, "a1", true).slice(0, 3).map((r) => r.card)).toEqual(["7s", "7h", "7d"]);
    expect(sortRows(rs, "ev0", false)[0]!.rank).toBe("A");
    const g = groups(rs, "cls");
    expect(g.map((x) => [x.g, x.n])).toEqual([
      ["over", 4],
      ["under", 36],
      ["pair", 9],
    ]);
    // the 7s (w 30) and the K and 2 (w 60): the mix by the range on each
    close(g.find((x) => x.g === "pair")!.f![1]!, (3 * 30 * 0.1) / (3 * 30 + 6 * 60));
    const avg = average(rs);
    close(avg.p, 1);
    close(avg.ev![0]!, (4 * 3.5 + 45 * 4.5) / 49);
    close(avg.eq![1]!, (4 * 0.6 + 45 * 0.45) / 49);
    expect(groups(rs, "suit").map((x) => x.n)).toEqual([13, 12, 12, 12]);
    expect(groups(rs, "rank")[0]!.label).toBe("As");
  });

  it("stored turns: EVs where the file holds them, each action's for the hands that take it; the notes say what's what", () => {
    const ST: RunoutReport = { ...RO, source: "store", cards: RO.cards!.map((c) => ({ ...c, ev: null })), solver: { iterations: 300, exploitability_pct: 0.139, by: "the flop library" } };
    expect(average(rows(ST, "first", "Kd7c2h")).ev).toBeNull();
    expect(noteText(ST)).toMatch(/stored turns hold strategies only, so there are no EVs/);
    expect(noteText(RO)).toMatch(/live solve of the flop .*the turn by hand buckets/);
    expect(noteText({ ...RO, street: "river", solver: { by: "every hand" } })).toMatch(/live solve of the turn/);
    const evPart = (actor: string) => ({
      ...part(actor, [0.9, 0.1], [1, 0]),
      cards: [
        { card: "7d", cards: sevens, f: [0.9, 0.1], w: 30, ev: [4.12, 6.3] },
        { card: "Qh", cards: rest, f: [1, 0], w: 60, ev: [4.4, null] },
      ],
    });
    const SE: RunoutReport = { ...ST, cards: RO.cards, first: evPart("BB"), after_check: evPart("BTN") };
    expect(rows(SE, "first", "Kd7c2h").find((r) => r.card === "Qh")!.fe).toEqual([4.4, null]);
    expect(rows(RO, "first", "Kd7c2h").find((r) => r.card === "Qh")!.fe).toBeNull();
    expect(noteText(SE)).toMatch(/EV in bb: each range's share of the pot \(9.50bb pot\) on the flop solve's strategies, by turn class .*the EV of each action for the hands that take it/);
    expect(noteText(SE)).not.toMatch(/no EVs/);
    expect(lineLabel({ flop: [{ pos: "BB", action: "check" }, { pos: "BTN", action: "bet", to: 7.13 }, { pos: "BB", action: "call" }] })).toBe("check, bet 7.13, call");
  });

  it("a 3-way report: the first decision's strategy only, its note", () => {
    const RO3: RunoutReport = {
      study: "runouts",
      street: "turn",
      multiway: true,
      first: part("SB", [0.7, 0.3], [0.6, 0.4]),
      after_check: null,
      seats: ["SB", "BB", "BTN"],
      pot_bb: 7.5,
      source: "solve",
      cards: all.map((c) => ({ card: c, p: 1 / 49, eq: null, ev: null })),
      solver: { iterations: 270, exploitability_pct: 0.4, by: "hand buckets" },
    };
    expect(partOf(RO3, "after").actor).toBe("SB");
    expect(rows(RO3, "first", "Kd7c2h").find((r) => r.card === "7s")!.f).toEqual([0.7, 0.3]);
    expect(noteText(RO3)).toMatch(
      /^Read off a live 3-way solve of the flop \(270 iterations, 0.4% of the pot from equilibrium\), which plays the turn \(7.50bb pot\) by hand buckets at one bet size.*The first decision's strategy only: no EVs or equities 3-way, nor the decisions after it/,
    );
    expect(noteText({ ...RO3, street: "river", after_check: part("BB", [0.8, 0.2], [0.75, 0.25]) })).toMatch(/Strategies only: no EVs or equities 3-way\. Each card's chance/);
  });

  it("the solve's seconds, as classic measured them: unthreaded, threaded, on the local server", () => {
    expect([estimate("turn", "fast"), estimate("river", "accurate")]).toEqual([2.5, 31]);
    expect(estimate("river", "fast")).toBe(7.5);
    expect([1, 2, 4, 8, 16].map((n) => estimate("river", "accurate", "worker", n))).toEqual([31, 17.6, 10.9, 7.5, 7.5]);
    expect(["turn", "river"].map((st) => estimate(st, "fast", "worker", 8))).toEqual([1.5, 3]);
    expect([estimate("turn", "fast", "http"), estimate("river", "fast", "http")]).toEqual([2.5, 5]);
  });

  it("offered heads-up and 3-way from the flop, not 4+ way; a 3-way solve's seconds", () => {
    const hu: StudyHand = { ...freshHand(6, 100), board: "Kd7c2h", preflop: parseLine("UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"), flop: parseLine("BB:x,BTN:x") };
    expect([sawFlop(hu), inPot(hu), offersReport(hu), mwSeconds(hu, "fast")]).toEqual([2, 2, true, null]);
    const three: StudyHand = { ...hu, preflop: parseLine("UTG:f,HJ:f,CO:f,BTN:r2.5,SB:c,BB:c"), flop: parseLine("SB:x,BB:x,BTN:x") };
    expect([sawFlop(three), inPot(three), offersReport(three), mwSeconds(three, "fast")]).toEqual([3, 3, true, 15]);
    const four: StudyHand = { ...hu, preflop: parseLine("UTG:f,HJ:f,CO:c,BTN:r2.5,SB:c,BB:c,CO:c"), flop: parseLine("SB:x,BB:x,CO:x,BTN:x") };
    expect([sawFlop(four), offersReport(four)]).toEqual([4, false]);
    // 4 saw the flop, one folded since: still not 3-way's solve
    expect(offersReport({ ...four, flop: parseLine("SB:x,BB:x,CO:x,BTN:b4,SB:f,BB:c,CO:c") })).toBe(false);
    expect(offersReport({ ...four, flop: parseLine("SB:x,BB:x,CO:x,BTN:b4,SB:f,BB:f,CO:c") })).toBe(true);
  });
});
