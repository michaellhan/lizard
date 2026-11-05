// The report over graded decisions (the classic session.js tally, groupBy, freqs, leaks, report, toCSV / toJSON),
// on decisions made up for it.
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { agreement, basisOf, BASES, COLS, freqs, groupBy, leaks, leakTest, mixByClass, report, rowsOf, spotOf, tally, toCSV, toJSON } from "./report";

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

describe("the versions behind a report", () => {
  const A = "build:aaa/111";
  const B = "build:bbb/222";

  it("says what the grades stand on, and which have none", () => {
    expect(report([open({ version: A }), open({ version: A }), cbet({ version: "library:srp_btn_bb:1111" }), cbet()]).versions).toBe("Graded on solver build aaa/111 (2), library srp_btn_bb 1111 (1). Version unknown for 1.");
    expect(report([open()]).versions).toBe("Version unknown: none of these grades has one.");
    expect(report([d({ verdict: "Not graded", why: "x" })]).versions).toBeNull();
  });

  it("says it on a leak that spans versions, and of that leak's decisions alone", () => {
    const miss = (i: number, version: string) => cbet({ handId: `h${i}`, verdict: "Blunder", evLossBb: 2, lossPct: 30, version });
    const ls = leaks(Array.from({ length: 30 }, (_, i) => miss(i, i % 2 ? "library:srp_btn_bb:1111" : "library:srp_btn_bb:2222")));
    expect(ls.length).toBeGreaterThan(0);
    expect(ls[0]!.versions).toBe("Graded on different versions: library srp_btn_bb 1111 and 2222.");
    const one = leaks(Array.from({ length: 30 }, (_, i) => miss(i, A)));
    expect(one[0]!.versions).toBeNull();
    expect(leaks(Array.from({ length: 30 }, (_, i) => miss(i, i ? A : B)))[0]!.versions).toMatch(/different versions: solver build/);
  });

  it("writes each decision's version in the CSV and the JSON, unknown where it has none, blank where nothing graded it", () => {
    const ds = [open({ version: A }), open(), d({ verdict: "Not graded", why: "x" })];
    const hands = new Map<string, HandRecord>();
    const csv = toCSV(ds, hands).trim().split("\n");
    const at = csv[0]!.split(",").indexOf("graded_version");
    expect(at).toBeGreaterThan(0);
    expect(csv.slice(1).map((l) => l.split(",").at(-1))).toEqual([A, "unknown", ""]);
    expect(COLS).toContain("graded_version");
    const json = JSON.parse(toJSON(ds, hands)) as { summary: { versions: string } };
    expect(json.summary.versions).toMatch(/solver build aaa\/111 \(1\)/);
  });
});

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
      ["spot", "Flop · SRP · IP · checked to"],
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

  it("keeps a pot's flop, turn and river apart, and a link kept from before still opens the flop's", () => {
    const at = (street: string, o: Partial<DecisionRecord> = {}) => cbet({ street, ...o });
    const ds = [...Array.from({ length: 10 }, () => at("flop")), ...Array.from({ length: 10 }, () => at("turn")), ...Array.from({ length: 9 }, () => at("river"))];
    expect(report(ds).bySpot.map((g) => [g.key, g.n])).toEqual([["Flop · SRP · IP · checked to", 10], ["Turn · SRP · IP · checked to", 10], ["River · SRP · IP · checked to", 9]]);
    // (9 rivers: under the threshold, however the others look)
    expect(leaks(ds).filter((l) => l.kind === "spot").map((l) => l.key)).toEqual(["Flop · SRP · IP · checked to", "Turn · SRP · IP · checked to"]);
    expect(ds.filter(leakTest({ kind: "spot", key: "Turn · SRP · IP · checked to" }))).toHaveLength(10);
    expect(ds.filter(leakTest({ kind: "spot", key: "SRP · IP · checked to" })).every((x) => x.street === "flop")).toBe(true);
    expect(spotOf(open())).toBeNull();
  });

  it("the turn and river rows of the frequencies", () => {
    const mix: DecisionRecord["mix"] = [["fold", 0.2, 0], ["check", 0, 0], ["call", 0.5, 1], ["bet 75%", 0.3, 1.1]];
    const ds = [
      d({ street: "turn", role: "PFR", flopAggr: true, facing: false, multi: false, action: "bet 3", mix }),
      d({ street: "turn", role: "PFR", flopAggr: false, facing: false, multi: false, action: "check", mix }),
      d({ street: "turn", facing: true, action: "fold", mix }),
      d({ street: "river", facing: false, action: "check", mix }),
      d({ street: "river", facing: true, action: "call", mix }),
    ];
    expect(freqs(ds).map((f) => [f.label, f.n, f.you, f.gto])).toEqual([
      ["Turn barrel", 1, 1, 0.3],
      ["Turn vs bet: fold", 1, 1, 0.2],
      ["River bet", 1, 0, 0.3],
      ["River vs bet: fold", 1, 0, 0.2],
    ]);
  });

  it("says what the grades stand on, and never adds a low read to a solid one unsaid", () => {
    const quick = (o: Partial<DecisionRecord>) => cbet({ source: "live", street: "turn", confidence: "medium", label: "Quick", ...o });
    const ds = [
      open(),
      cbet(),
      cbet({ approximate: true }),
      cbet({ source: "library-turn", street: "turn", confidence: "medium" }),
      quick({}),
      quick({ confidence: "low", evLossBb: 2 }),
      quick({ confidence: undefined }),
      quick({ confidence: undefined, approximate: true }),
      cbet({ source: "instant", confidence: "low", verdict: "Mistake", evLossBb: null, lossPct: null, bestFreq: 0.9 }),
      d({ source: "push-fold", confidence: "high", evLossBb: null, lossPct: null, bestFreq: 0.9 }),
      d({ source: "rules", verdict: "Not graded", why: "the rules" }),
    ];
    expect(ds.slice(0, 10).map(basisOf)).toEqual([BASES[0], BASES[1], BASES[2], BASES[5], BASES[6], BASES[7], BASES[3], BASES[4], BASES[8], BASES[9]]);
    const rp = report(ds);
    // (the most solid first; the rules, not graded, stand on nothing)
    expect(rp.byBasis.map((g) => [g.key, g.graded])).toEqual(BASES.map((b) => [b, 1]));
    expect(rp.low).toEqual({ n: 2, lost: 2 });
    expect(rp.offChart).toEqual([]);
    expect(rp.offRead.map((x) => x.source)).toEqual(["instant"]);
    const L = leaks([...Array.from({ length: 6 }, () => cbet({ street: "turn", situation: "SRP · IP · checked to", confidence: "low" })), ...Array.from({ length: 6 }, () => cbet({ street: "turn" }))]);
    expect(L.map((l) => [l.kind, l.key, l.low])).toEqual([["spot", "Turn · SRP · IP · checked to", 6]]);
  });

  it("a spot leak counts low reads among the decisions it's built on; a borrowed flop kept before `approximate` stays borrowed", () => {
    const low = cbet({ confidence: "low" });
    const reads = Array.from({ length: 30 }, () => cbet({ confidence: "low", evLossBb: null, lossPct: null, byEv: false, source: "instant" }));
    const ls = leaks([...Array.from({ length: 12 }, () => cbet()), low, ...reads]);
    const spot = ls.find((l) => l.kind === "spot")!;
    expect([spot.n, spot.low]).toEqual([13, 1]);
    expect(basisOf(cbet({ label: "Precomputed solution · srp · another table's spot read as this one" }))).toBe(BASES[2]);
    expect(basisOf(cbet())).toBe(BASES[1]);
  });

  it("counts how a check at Fast agreed with the read, on the one scale", () => {
    const read = (verdict: string) => ({ verdict, source: "live", label: "Quick", confidence: "low" as const, evLossBb: 0 });
    const ds = [
      d({ verdict: "Correct", read: read("Best") }),
      d({ verdict: "Mistake", read: read("Blunder") }),
      d({ verdict: "Inaccuracy", read: read("Best") }),
      d({ verdict: "Best", read: read("Mistake") }),
      d({ verdict: "Best", read: read("Not graded") }),
      d({ verdict: "Best" }),
    ];
    expect(agreement(ds)).toEqual({ n: 4, same: 2, worse: 1, better: 1 });
  });

  it("exports what stands behind each grade", () => {
    const h = new Map<string, HandRecord>();
    const [read, fast] = rowsOf(
      [
        cbet({ source: "live", confidence: "low", triageSource: "quick", street: "turn" }),
        cbet({ source: "live", street: "turn", read: { verdict: "Mistake", source: "live", label: "Quick", confidence: "low", triageSource: "quick", evLossBb: 0.2 } }),
      ],
      h,
    );
    expect([read!.basis, read!.confidence, read!.triage_source, read!.triage_grade]).toEqual([BASES[7], "low", "quick", ""]);
    expect([fast!.basis, fast!.confidence, fast!.triage_source, fast!.triage_grade, fast!.triage_ev_lost_bb]).toEqual([BASES[3], "checked at Fast", "quick", "Mistake", 0.2]);
  });

  it("the export keeps an EV's marks, and the summary's lists say what each loss stands on", () => {
    const h = new Map<string, HandRecord>();
    const quick = cbet({ street: "turn", source: "live", label: "Live solve (Quick)", confidence: "low", verdict: "Inaccuracy", capped: true, roughEv: true, off: "the flop is narrowed by the betting rules, not solved" });
    const [row] = rowsOf([quick], h);
    expect([row!.rough_ev, row!.grade_capped, row!.off_solution]).toEqual([true, true, "the flop is narrowed by the betting rules, not solved"]);
    expect(toCSV([quick], h).split("\n")[0]).toContain("rough_ev,grade_capped,off_solution");
    const out = JSON.parse(toJSON([quick], h, 0)) as { summary: { mistakes: Record<string, unknown>[] } };
    expect(out.summary.mistakes[0]).toMatchObject({ rough_ev: true, grade_capped: true, source: "Live solve (Quick)", basis: BASES[7], confidence: "low" });
  });
});
