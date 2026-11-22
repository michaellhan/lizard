// Your play at each node against the answer's (nodes.ts), and the leaks read at each seat (report.ts readLeaks), on
// decisions made up for them.
import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/data/db";
import { cellDecisions, pfCellTest, PF_FREQS, seatGrid, spotTable } from "./nodes";
import { leakReading, leaks, leakTest, PF_ROW, readLeaks } from "./report";

let k = 0;
const d = (o: Partial<DecisionRecord>): DecisionRecord => ({
  id: `h${k}|preflop|${k}`,
  handId: `h${k++}`,
  street: "preflop",
  pos: "BTN",
  action: "raise to 2.5",
  verdict: "Correct",
  evLossBb: null,
  lossPct: null,
  source: "charts",
  label: "Preflop charts · approximate",
  gradedAt: 0,
  situation: "RFI",
  firstIn: true,
  mix: [["fold", 0.5, null], ["raise", 0.5, null]],
  ...o,
});
const fold = { action: "fold" };

describe("seatGrid", () => {
  it("lays your preflop frequencies out by seat, each against the answer for the same hands, the charts' and the solve's apart", () => {
    const ds = [
      ...Array.from({ length: 12 }, () => d({ pos: "CO" })),
      ...Array.from({ length: 12 }, (_, i) => d({ pos: "BTN", ...(i < 6 ? fold : {}) })),
      d({ pos: "SB", source: "preflop-solve", label: "Preflop solve" }),
    ];
    const g = seatGrid(ds, false);
    expect(g.seats).toEqual(["CO", "BTN"]);
    const open = g.rows.find((r) => r.label === "Open (RFI)")!;
    expect(open.bySeat.CO).toMatchObject({ n: 12, k: 12, you: 1, gto: 0.5, mark: "over" });
    expect(open.bySeat.BTN).toMatchObject({ n: 12, k: 6, you: 0.5, gto: 0.5, mark: null });
    expect(open.all).toMatchObject({ n: 24, k: 18 });
    // (a row neither you nor the answer ever takes isn't drawn: no open-limp here)
    expect(g.rows.some((r) => r.label === "Open limp (RFI)")).toBe(false);
    expect(PF_FREQS.map(([l]) => l)).toContain("Open limp (RFI)");
    expect(seatGrid(ds, true).seats).toEqual(["SB"]);
    expect(ds.filter(pfCellTest("Open (RFI)", false, "CO"))).toHaveLength(12);
    expect(ds.filter(pfCellTest("Open (RFI)", true))).toHaveLength(1);
  });

  it("marks no cell from fewer than ten decisions", () => {
    const g = seatGrid(Array.from({ length: 9 }, () => d({ pos: "CO" })), false);
    expect(g.rows[0]!.bySeat.CO!.mark).toBeNull();
  });
});

describe("spotTable", () => {
  it("gives each spot your fold, check or call and bet or raise against the answer's, and the EV given up", () => {
    const flop = (o: Partial<DecisionRecord>) => d({ street: "flop", situation: "SRP · IP · checked to", source: "library", mix: [["check", 0.6, 2], ["bet 33%", 0.4, 2]], evLossBb: 0, ...o });
    const rows = spotTable([flop({}), flop({ action: "check" }), flop({ evLossBb: 1, past: 0.5, verdict: "Mistake" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "Flop · SRP · IP · checked to", n: 3, fold: null, ev: 3, avg: 0.167 });
    expect(rows[0]!.aggr).toMatchObject({ k: 2 });
    expect(rows[0]!.aggr!.gto).toBeCloseTo(0.4, 12);
    expect(rows[0]!.passive!.gto).toBeCloseTo(0.6, 12);
  });

  it("opens a cell's decisions with your misses first, worst first", () => {
    const ds = [d({}), d({ verdict: "Mistake" }), d({ verdict: "Blunder" })];
    expect(cellDecisions(ds, () => true).map((x) => x.verdict)).toEqual(["Blunder", "Mistake", "Correct"]);
  });
});

describe("leaks at each seat", () => {
  it("finds a leak at the seat it's at, and leaves the row of every seat for it", () => {
    // the cutoff opens everything the charts open half; the button plays the charts' own mix
    const ds = [...Array.from({ length: 40 }, () => d({ pos: "CO" })), ...Array.from({ length: 40 }, (_, i) => d({ pos: "BTN", ...(i % 2 ? fold : {}) }))];
    const L = leaks(ds);
    expect(L.map((l) => l.key)).toEqual(["Open (RFI) · CO"]);
    expect(ds.filter(leakTest(L[0]!))).toHaveLength(40);
    expect(leakReading(L[0]!)).toMatch(/^you 100% \(95% range \d+% to 100%\), the answer 50% for the same hands, over 40 decisions$/);
  });

  it("names a row by itself where one seat is all of it", () => {
    const L = leaks(Array.from({ length: 40 }, () => d({ pos: "CO" })));
    expect(L.map((l) => l.key)).toEqual(["Open (RFI)"]);
  });

  it("reads a preflop situation by how often you're in the mix against the answer's own mix", () => {
    // in the mix half the time where the charts' own mix always is
    const ds = Array.from({ length: 40 }, (_, i) => d({ situation: "vs open", firstIn: true, verdict: i % 2 ? "Mistake" : "Best", mix: [["fold", 1, null], ["call", 0, null]], action: i % 2 ? "call" : "fold" }));
    const pf = leaks(ds).find((l) => l.kind === "pf")!;
    expect(pf).toMatchObject({ key: "vs open", n: 40, inMix: 0.5, expect: 1, way: "freq", against: "the charts" });
    expect(leakReading(pf)).toMatch(/50% in the mix against the charts, by frequency, not a solve .* playing the answer's own mix would be 100%; you fold 50%, the answer 100%/);
  });

  it("reads the preflop solve's rows by its EV, apart, and costs them per 100 hands", () => {
    const ds = Array.from({ length: 40 }, () => d({ source: "preflop-solve", label: "Preflop solve", verdict: "Mistake", evLossBb: 1, past: 0.5, byEv: true }));
    const r = readLeaks(ds);
    const pf = r.leaks.find((l) => l.kind === "pf")!;
    expect(pf).toMatchObject({ key: `RFI${PF_ROW}`, way: "solve", avg: 0.5, cost: 20, bb100: 50 });
    expect(leakReading(pf)).toMatch(/0\.5bb given up per decision past the preflop solve's noise .*50bb per 100 hands by the preflop solve's EV \(a class-level model, kept apart\)/);
    expect(r.tests).toBeGreaterThan(0);
    expect(r.bar).toBeGreaterThan(1.96);
  });

  it("keeps a link to an old row's name working", () => {
    const ds = Array.from({ length: 3 }, () => d({ pos: "CO" }));
    expect(ds.filter(leakTest({ kind: "freq", key: "Open (RFI) · CO" }))).toHaveLength(3);
    expect(ds.filter(leakTest({ kind: "freq", key: "Open (RFI) · BTN" }))).toHaveLength(0);
    expect(ds.filter(leakTest({ kind: "pf", key: "RFI · CO" }))).toHaveLength(3);
    expect(ds.filter(leakTest({ kind: "pf", key: "RFI" }))).toHaveLength(3);
  });
});
