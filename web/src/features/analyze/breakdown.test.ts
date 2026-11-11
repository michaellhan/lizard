/// <reference types="node" />
// The breakdowns (breakdown.ts) on the classic fixtures (solver/tests/data/hh): each way of breaking decisions down, its
// counts, its rows' order, what it stands on, and old records that can't say.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { importHand } from "@/hh/replay";
import { recordOf } from "./analyze";
import { BREAKDOWNS, breakdown, cellOf, moveIndex, STACKS, worstFirst, type BreakBy, type BreakContext } from "./breakdown";
import { BASES, isGraded } from "./report";
import { handStats, type HandStats } from "./stats";

const HH = (f: string) => readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", f), "utf8");
const FILES = ["stars_6max_srp.txt", "stars_3bet_pot.txt", "stars_9max_mtt_ante.txt", "gg_limped_multiway.txt"];
const IMP = { id: "i", name: "i", at: 1 };
const RECS = FILES.map((f) => recordOf(HH(f), importHand(HH(f)), IMP));
const [SRP, POT3, MTT, LIMP] = RECS as [HandRecord, HandRecord, HandRecord, HandRecord];
const hands = new Map(RECS.map((h) => [h.id, h]));
const facts = new Map<string, HandStats | null>(RECS.map((h) => [h.id, handStats(importHand(h.text), h.playedFor, h.text)]));
const CTX: BreakContext = { hands, facts };

const dec = (h: HandRecord, street: string, i: number, o: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: `${h.id}|${street}|${i}`,
  handId: h.id,
  street,
  i,
  pos: h.hero,
  action: "x",
  verdict: "Best",
  evLossBb: 0,
  lossPct: 0,
  source: "library",
  label: "Precomputed solution · srp_btn_bb",
  gradedAt: 0,
  ...o,
});
// your moves: the open and three bets; the 3-bet, the flop bet, the call of its raise, the check, the call of the jam;
// the call and the flop's call, the turn bet, the river check; the flop check-raise and the turn bet
const ALL = [
  dec(SRP, "preflop", 3, { source: "charts", potType: "SRP", verdict: "Correct", evLossBb: null, lossPct: null }),
  dec(SRP, "flop", 1, { potType: "SRP" }),
  dec(SRP, "turn", 1, { potType: "SRP", verdict: "Mistake", evLossBb: 1, lossPct: 5 }),
  dec(SRP, "river", 1, { potType: "SRP" }),
  dec(POT3, "preflop", 4, { source: "charts", potType: "3bet pot", verdict: "Correct", evLossBb: null, lossPct: null }),
  dec(POT3, "flop", 0, { potType: "3bet pot" }),
  dec(POT3, "flop", 2, { potType: "3bet pot" }),
  dec(POT3, "turn", 0, { potType: "3bet pot" }),
  dec(POT3, "turn", 2, { potType: "3bet pot", verdict: "Blunder", evLossBb: 3, lossPct: 20 }),
  dec(MTT, "preflop", 5, { source: "charts", verdict: "Mistake", evLossBb: null, lossPct: null }),
  dec(LIMP, "flop", 5),
  dec(LIMP, "turn", 1),
  dec(LIMP, "preflop", 5, { verdict: "Not graded", why: "not kept" }),
];
const rows = (by: BreakBy, ds = ALL, ctx = CTX) => breakdown(ds, by, ctx).rows.map((r) => [r.key, r.graded]);
const left = (by: BreakBy, ds = ALL, ctx = CTX) => breakdown(ds, by, ctx).left.map((l) => [l.why, l.n]);

describe("breakdowns", () => {
  it("offers seat, street, pot type, size faced, size chosen, effective stack and the flop's four textures", () => {
    expect(BREAKDOWNS.map((b) => b.by)).toEqual(["pos", "street", "pot", "faced", "chosen", "stack", "hi", "suits", "pair", "conn"]);
    // the sizes and the stack come from the hand's history, as a decision stores neither
    for (const by of ["faced", "chosen", "stack"]) {
      const b = BREAKDOWNS.find((x) => x.by === by)!;
      expect(b.history).toBe(true);
      expect(b.note).toBeTruthy();
    }
  });

  it("counts every graded decision once in every breakdown: its rows and what's left out add up, and the ungraded stay out", () => {
    const graded = ALL.filter(isGraded).length;
    expect(graded).toBe(12);
    for (const { by } of BREAKDOWNS) {
      const b = breakdown(ALL, by, CTX);
      expect(b.graded).toBe(graded);
      expect(b.rows.reduce((n, r) => n + r.n, 0) + b.left.reduce((n, l) => n + l.n, 0), by).toBe(graded);
      expect(b.rows.every((r) => r.n === r.graded)).toBe(true);
    }
  });

  it("by seat and by street, in table order", () => {
    expect(rows("pos")).toEqual([["CO", 1], ["BTN", 4], ["BB", 7]]);
    expect(rows("street")).toEqual([["preflop", 3], ["flop", 4], ["turn", 4], ["river", 1]]);
    expect(left("pos", [dec(SRP, "flop", 1, { pos: "" })])).toEqual([["kept without a seat", 1]]);
  });

  it("by pot type: the decision's, else its hand's, and neither is said", () => {
    // (the mtt hand's call and the limped pot keep none: their hands say)
    expect(rows("pot")).toEqual([["SRP", 5], ["3bet pot", 5], ["Limped", 2]]);
    const old = dec(POT3, "flop", 0);
    expect(cellOf(old, "pot", CTX)).toEqual({ key: "3bet pot" });
    expect(cellOf(old, "pot", { hands: new Map([[POT3.id, { ...POT3, potType: "" }]]) })).toEqual({ why: "kept without a pot type, its hand has none either" });
    expect(cellOf(old, "pot", { hands: new Map() })).toEqual({ why: "kept without a pot type, its hand has none either" });
  });

  it("by the size faced, read from the history: preflop in big blinds, after the flop in % of the pot", () => {
    const of = (d: DecisionRecord) => cellOf(d, "faced", CTX);
    // a raise to 2.5bb sits in the row that starts there
    expect(of(dec(POT3, "preflop", 4))).toEqual({ key: "Preflop: a raise to 2.5–3.5bb" });
    // $44 into $59: 74.6%
    expect(of(dec(POT3, "flop", 2))).toEqual({ key: "After the flop: a bet of 60–80% of the pot" });
    // $134 into $133: 100.8%
    expect(of(dec(POT3, "turn", 2))).toEqual({ key: "After the flop: a bet of 80–110% of the pot" });
    // $0.20 into $0.40: 50%
    expect(of(dec(LIMP, "flop", 5))).toEqual({ key: "After the flop: a bet of 45–60% of the pot" });
    // nothing to answer
    expect(of(dec(SRP, "preflop", 3))).toEqual({ why: "no bet or raise to answer" });
    expect(of(dec(SRP, "flop", 1))).toEqual({ why: "no bet or raise to answer" });
    expect(left("faced").find((l) => l[0] === "no bet or raise to answer")).toBeTruthy();
    // in the order of the sizes, preflop's first
    const keys = rows("faced").map((r) => r[0] as string);
    expect(keys[0]).toMatch(/^Preflop/);
    expect(keys.at(-1)).toMatch(/^After the flop: a bet of 80/);
  });

  it("by the size chosen: a bet in % of the pot, a raise in multiples, and a call or check has none", () => {
    const of = (d: DecisionRecord) => cellOf(d, "chosen", CTX);
    expect(of(dec(SRP, "preflop", 3))).toEqual({ key: "Preflop: a raise of 2.5–3×" });
    expect(of(dec(POT3, "preflop", 4))).toEqual({ key: "Preflop: a raise of 4–6×" });
    // $1.80 into $5.50: 32.7%
    expect(of(dec(SRP, "flop", 1))).toEqual({ key: "After the flop: a bet of 30–45% of the pot" });
    // to $1.05 over $0.20: 5.25×
    expect(of(dec(LIMP, "flop", 5))).toEqual({ key: "After the flop: a raise of 4–6×" });
    expect(of(dec(POT3, "flop", 2))).toEqual({ why: "a fold, check or call has no size" });
    expect(of(dec(MTT, "river", 1))).toEqual({ why: "a fold, check or call has no size" });
  });

  it("by effective stack, from the history and in the row that starts there", () => {
    expect(cellOf(dec(SRP, "flop", 1), "stack", CTX)).toEqual({ key: "75–125bb" });
    expect(cellOf(dec(MTT, "preflop", 5), "stack", CTX)).toEqual({ key: "75–125bb" });
    const ctx = (eff: number): BreakContext => ({ hands, facts: new Map([[SRP.id, { ...facts.get(SRP.id)!, eff }]]) });
    expect(STACKS.map((s) => (cellOf(dec(SRP, "flop", 1), "stack", ctx(s.max === Infinity ? 500 : s.max - 0.5)) as { key: string }).key)).toEqual(STACKS.map((s) => s.label));
    expect(cellOf(dec(SRP, "flop", 1), "stack", ctx(20))).toEqual({ key: "20–40bb" });
  });

  it("by the flop's texture, leaving out what came before the flop", () => {
    // Qs8d3c: Q high, rainbow, unpaired; Kd9c4h the same but K; Ac9h9d paired; Ts8h2s two-tone
    expect(cellOf(dec(SRP, "turn", 1), "hi", CTX)).toEqual({ key: "Q high" });
    expect(cellOf(dec(POT3, "flop", 0), "hi", CTX)).toEqual({ key: "K high" });
    expect(cellOf(dec(LIMP, "flop", 5), "suits", CTX)).toEqual({ key: "Two-tone" });
    expect(cellOf(dec(MTT, "river", 1), "pair", CTX)).toEqual({ key: "Paired" });
    expect(left("suits")).toEqual([["before the flop, there's no board", 3]]);
    expect(rows("suits")).toEqual([["Rainbow", 7], ["Two-tone", 2]]);
    expect(cellOf(dec(SRP, "flop", 1), "hi", { hands: new Map([[SRP.id, { ...SRP, board: "" }]]) })).toEqual({ why: "its hand keeps no flop" });
    expect(cellOf(dec(SRP, "flop", 1), "hi", { hands: new Map() })).toEqual({ why: "its hand keeps no flop" });
  });

  it("finds an old record's move by its id, and says what it can't place rather than guess", () => {
    const old = { ...dec(SRP, "flop", 1), i: undefined };
    expect(moveIndex(old)).toBe(1);
    expect(moveIndex({ id: "a|flop|x" })).toBeNull();
    expect(cellOf(old, "chosen", CTX)).toEqual({ key: "After the flop: a bet of 30–45% of the pot" });
    expect(cellOf({ ...old, id: "weird" }, "chosen", CTX)).toEqual({ why: "kept without its place in the hand" });
    expect(cellOf(dec(SRP, "flop", 40), "faced", CTX)).toEqual({ why: "its move isn't in the history" });
    // a move that's someone else's isn't yours to size
    expect(cellOf(dec(SRP, "flop", 0), "chosen", CTX)).toEqual({ why: "its move isn't in the history" });
    const stopped: BreakContext = { hands, facts: new Map([[SRP.id, null]]) };
    expect(cellOf(dec(SRP, "flop", 1), "faced", stopped)).toEqual({ why: "its hand's replay stopped short of the history" });
    expect(cellOf(dec(SRP, "flop", 1), "stack", stopped)).toEqual({ why: "its hand's replay stopped short of the history" });
    // a hand no longer read at all, or read after the decision's: the same
    expect(cellOf(dec(SRP, "flop", 1), "faced", { hands })).toEqual({ why: "its hand's replay stopped short of the history" });
  });

  it("keeps on each row what its grades stand on, the most solid first, and never calls a chart solved", () => {
    const pre = breakdown(ALL, "street", CTX).rows;
    expect(pre[0]!.bases).toEqual([{ basis: BASES[0], n: 3 }]);
    expect(BASES[0]).toMatch(/not a solve/);
    expect(pre[1]!.bases).toEqual([{ basis: "Flop library", n: 4 }]);
    const mixed = breakdown(ALL, "pos", CTX).rows.find((r) => r.key === "BTN")!;
    expect(mixed.bases.map((b) => [b.basis, b.n])).toEqual([[BASES[0], 1], ["Flop library", 3]]);
    // and it has the row's tally: 4 graded, 3 by EV, 1bb lost
    expect([mixed.graded, mixed.ev, mixed.lost, mixed.ok]).toEqual([4, 3, 1, 3]);
  });

  it("lists a row's decisions worst first, each once", () => {
    const list = worstFirst(ALL.filter(isGraded));
    expect(list[0]!.evLossBb).toBe(3);
    expect(list[1]!.evLossBb).toBe(1);
    expect(new Set(list.map((d) => d.id)).size).toBe(list.length);
    expect(worstFirst(ALL)).not.toBe(ALL);
  });
});
