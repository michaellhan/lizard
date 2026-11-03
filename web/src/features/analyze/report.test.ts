// The report over graded decisions (the classic session.js tally, groupBy, freqs, leaks, report, toCSV / toJSON),
// on decisions made up for it.
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { COLS, freqs, groupBy, leaks, leakTest, mixByClass, report, tally, toCSV, toJSON } from "./report";

let k = 0;
const d = (o: Partial<DecisionRecord>): DecisionRecord => ({
  id: `h${k}|preflop|${k++}`,
  handId: "h1",
  street: "preflop",
  pos: "BTN",
  action: "raise to 2.5",
  verdict: "Best",
  evLossBb: null,
  lossPct: null,
  source: "charts",
  label: "Preflop charts · approximate",
  gradedAt: 0,
  ...o,
});
// an open the charts play half the time, and a flop c-bet the library plays 40% of the time losing 0.6bb
const open = (o: Partial<DecisionRecord> = {}) => d({ situation: "RFI", mix: [["fold", 0.5, null], ["raise", 0.5, null]], matched: "raise", freq: 0.5, best: "fold", bestFreq: 0.5, verdict: "Correct", ...o });
const cbet = (o: Partial<DecisionRecord> = {}) =>
  d({ street: "flop", action: "bet 1.8", situation: "SRP · IP · checked to", role: "PFR", facing: false, multi: false, ip: true, mix: [["check", 0.6, 3.1], ["bet 33%", 0.4, 2.5]], verdict: "Mistake", evLossBb: 0.6, lossPct: 10.9, pot: 5.5, source: "library", label: "Precomputed solution · srp_btn_bb", ...o });

describe("report", () => {
  it("tallies the grades, the EV lost by EV only, and groups in order", () => {
    const ds = [open(), open({ verdict: "Mistake", action: "call", freq: 0 }), cbet(), cbet({ verdict: "Best", evLossBb: 0, lossPct: 0 }), d({ verdict: "Not graded", why: "not a flop-library spot", street: "flop" })];
    const t = tally(ds);
    expect([t.n, t.graded, t.ok, t.ev, t.lost, t.avg, t.avgPct]).toEqual([5, 4, 2, 2, 0.6, 0.3, 5.5]);
    expect(t.by).toEqual({ Best: 1, Correct: 1, Inaccuracy: 0, Mistake: 2, Blunder: 0 });
    expect(groupBy(ds, (x) => x.street, ["preflop", "flop"]).map((g) => [g.key, g.n])).toEqual([["preflop", 2], ["flop", 3]]);
    const rp = report(ds);
    expect(rp.mistakes.map((x) => x.evLossBb)).toEqual([0.6]);
    expect(rp.offChart.map((x) => x.action)).toEqual(["call"]);
    expect(rp.notGraded).toEqual([{ why: "not a flop-library spot", n: 1 }]);
    expect(rp.hands).toBe(1);
  });

  it("compares your frequencies with the answer's, and finds leaks past their thresholds", () => {
    expect(mixByClass(cbet())).toEqual({ fold: 0, passive: 0.6, aggr: 0.4 });
    // 15 opens all raised where the charts raise half: a frequency leak; 15 c-bets losing 0.6bb each: a spot leak
    const ds = [...Array.from({ length: 15 }, () => open()), ...Array.from({ length: 15 }, () => cbet())];
    const f = freqs(ds);
    expect(f.map((x) => [x.label, x.n, x.you, Math.round(x.gto * 1e9) / 1e9])).toEqual([["Open (RFI)", 15, 1, 0.5], ["Flop c-bet", 15, 1, 0.4]]);
    const L = leaks(ds);
    expect(L.map((l) => [l.kind, l.key])).toEqual([
      ["freq", "Flop c-bet"],
      ["freq", "Open (RFI)"],
      ["spot", "SRP · IP · checked to"],
    ]);
    expect(ds.filter(leakTest(L[2]!))).toHaveLength(15);
    // under 80% in the mix over 15 preflop decisions: a preflop leak
    const bad = Array.from({ length: 15 }, (_, j) => open({ verdict: j < 10 ? "Mistake" : "Best" }));
    expect(leaks(bad).find((l) => l.kind === "pf")).toMatchObject({ key: "RFI", n: 15 });
    // fewer decisions: none
    expect(leaks(ds.slice(0, 14))).toEqual([]);
  });

  it("exports each decision as a row, and the report as JSON", () => {
    const hands = new Map([["h1", { id: "h1", number: "249012345678", site: "PokerStars", played: "2024-03-02 21:14", hole: "AhQd", board: "Qs8d3c7h2s" } as HandRecord]]);
    const csv = toCSV([cbet({ note: 'your bet, graded as "bet 33%", sized' })], hands).trim().split("\n");
    expect(csv[0]).toBe(COLS.join(","));
    const row = csv[1]!;
    expect(row.startsWith("249012345678,h1,PokerStars,2024-03-02 21:14,BTN,AhQd,flop,Qs8d3c,SRP · IP · checked to,bet 1.8,")).toBe(true);
    expect(row).toContain(',0.6,10.9,Mistake,EV,Precomputed solution · srp_btn_bb,5.5,false,true,"your bet, graded as ""bet 33%"", sized",,');
    const j = JSON.parse(toJSON([open(), cbet()], hands, 0)) as { exported: string; summary: { graded: number }; decisions: unknown[]; graded_against: string };
    expect([j.exported, j.summary.graded, j.decisions.length]).toEqual(["1970-01-01T00:00:00.000Z", 2, 2]);
    expect(j.graded_against).toMatch(/not a solve/);
  });
});
