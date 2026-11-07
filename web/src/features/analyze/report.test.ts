// The report over graded decisions (the classic session.js tally, groupBy, freqs, leaks, report, toCSV / toJSON),
// on decisions made up for it.
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { agreement, basisOf, BASES, COLS, freqs, groupBy, isPfSolve, leakIsRead, leaks, leakTest, lostByKind, meanRange, MIN_READ, mixByClass, PF_ROW, readLeaks, report, rowsOf, spotOf, tally, toCSV, toJSON, type Leak } from "./report";
import { wilson } from "./stats";

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

describe("the preflop solve and the charts in one report", () => {
  const solved = (o: Partial<DecisionRecord> = {}) =>
    open({ source: "preflop-solve", label: "Preflop solve (class-level model)", mix: [["fold", 0.8, 0], ["raise", 0.2, 0.5]], verdict: "Mistake", evLossBb: 0.5, lossPct: 12, byEv: true, freq: 0.8, matched: "fold", ...o });

  it("never calls the solve's grade a chart's or a full solve", () => {
    expect(basisOf(solved())).toBe("Preflop solve (class-level model, by EV, not a full solve)");
    expect(basisOf(open())).toBe(BASES[0]);
    expect(BASES[10]).toMatch(/not a full solve/);
    expect(isPfSolve(open())).toBe(false);
  });
  it("keeps each situation's rows apart, and says the EV lost to the solve on its own", () => {
    const r = report([open(), open(), solved(), solved({ evLossBb: 0.25 })]);
    expect(r.byPf.map((g) => [g.key, g.graded])).toEqual([["RFI", 2]]);
    expect(r.byPfSolve.map((g) => [g.key, g.graded])).toEqual([["RFI", 2]]);
    expect(r.pfEv).toEqual({ n: 2, lost: 0.75 });
    expect(report([open()]).pfEv).toEqual({ n: 0, lost: 0 });
    expect(r.byBasis.map((g) => [g.key, g.graded])).toEqual([[BASES[0], 2], [BASES[10], 2]]);
  });
  it("gives a frequency a row by each answer, never one row of both", () => {
    const rows = freqs([open(), open(), solved()]);
    const labels = rows.map((x) => x.label);
    expect(labels.filter((l) => l.endsWith(PF_ROW))).toHaveLength(labels.length / 2);
    for (const row of rows) expect(row.n).toBe(row.label.endsWith(PF_ROW) ? 1 : 2);
  });
  it("finds a leak against each on its own, and a leak's decisions are its own", () => {
    const miss = (o: Partial<DecisionRecord> = {}) => open({ verdict: "Mistake", ...o });
    const ds = [...Array.from({ length: 30 }, (_, i) => solved({ handId: `h${i}` })), ...Array.from({ length: 30 }, (_, i) => miss({ handId: `c${i}` }))];
    const ls = leaks(ds).filter((l) => l.kind === "pf");
    expect(ls.map((l) => l.key).sort()).toEqual(["RFI", `RFI${PF_ROW}`]);
    for (const l of ls) {
      const its = ds.filter(leakTest(l));
      expect(its).toHaveLength(30);
      expect(its.every((x) => isPfSolve(x) === l.key.endsWith(PF_ROW))).toBe(true);
    }
  });
  it("says in the CSV why the chart graded a decision in a stored game", () => {
    const csv = toCSV([open({ pfWhy: "why it's the chart" })], new Map());
    expect(csv).toContain("why it's the chart");
  });
});

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

describe("a row graded more than one way", () => {
  const solved = (o: Partial<DecisionRecord> = {}) => open({ source: "preflop-solve", label: "Preflop solve (class-level model)", verdict: "Mistake", evLossBb: 0.5, lossPct: 10, ...o });

  it("never adds the preflop solve's EV lost to a spot's", () => {
    const t = tally([solved(), solved({ evLossBb: 0.25, lossPct: 5 }), cbet({ evLossBb: 2, lossPct: 40 })]);
    expect([t.ev, t.lost, t.avg, t.avgPct]).toEqual([1, 2, 2, 40]);
    expect([t.pfEv, t.pfLost, t.pfAvg, t.pfAvgPct]).toEqual([2, 0.75, 0.375, 7.5]);
  });

  it("keeps a figure a way, each its own share, only where there's more than one", () => {
    const [row] = groupBy([solved(), open({ verdict: "Correct" }), cbet({ evLossBb: 2, lossPct: 40 }), cbet({ verdict: "Best", evLossBb: 0, lossPct: 0 }), d({ verdict: "Not graded", why: "no" })], (x) => x.pos);
    expect(Object.keys(row!.ways!).sort()).toEqual(["ev", "freq", "solve"]);
    expect(row!.ways!.ev).toMatchObject({ graded: 2, ok: 1, ev: 2, lost: 2, avg: 1, pfEv: 0 });
    expect(row!.ways!.solve).toMatchObject({ graded: 1, ok: 0, ev: 0, lost: 0, pfEv: 1, pfLost: 0.5, pfAvg: 0.5 });
    expect(row!.ways!.freq).toMatchObject({ graded: 1, ok: 1, ev: 0, pfEv: 0 });
    // (a decision not graded goes in no way's count)
    expect(row!.n).toBe(5);
    expect(row!.graded).toBe(4);
  });

  it("has no ways on a row graded one way, whatever answered it", () => {
    expect(groupBy([open(), open()], (x) => x.pos)[0]!.ways).toBeUndefined();
    expect(groupBy([solved(), solved()], (x) => x.pos)[0]!.ways).toBeUndefined();
    expect(groupBy([cbet(), cbet({ source: "live" })], (x) => x.pos)[0]!.ways).toBeUndefined();
  });

  it("orders rows with no order of their own by a spot's EV first, then the preflop solve's, never the sum", () => {
    const rows = groupBy([solved({ pos: "BB", evLossBb: 9 }), cbet({ pos: "SB", evLossBb: 1 }), solved({ pos: "CO", evLossBb: 3 })], (x) => x.pos);
    expect(rows.map((r) => r.key)).toEqual(["SB", "BB", "CO"]);
  });

  it("exports the two apart, and says what graded preflop without calling the charts a solve", () => {
    const hands = new Map([["h1", { id: "h1", board: "" } as HandRecord]]);
    const j = JSON.parse(toJSON([solved(), cbet({ evLossBb: 2, lossPct: 40 })], hands, 0)) as { summary: { ev: number; lost: number; pfEv: number; pfLost: number }; graded_against: string };
    expect(j.summary).toMatchObject({ ev: 1, lost: 2, pfEv: 1, pfLost: 0.5 });
    expect(j.graded_against).toMatch(/preflop solve by EV .*a class-level model/);
    expect(j.graded_against).toMatch(/charts, by frequency \(not a solve\)/);
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
    // 30 opens all raised where the charts raise half: a frequency leak; 30 c-bets losing 0.6bb each: a spot leak
    const ds = [...Array.from({ length: 30 }, () => open()), ...Array.from({ length: 30 }, () => cbet())];
    const f = freqs(ds);
    expect(f.map((x) => [x.label, x.n, x.you, Math.round(x.gto * 1e9) / 1e9])).toEqual([["Open (RFI)", 30, 1, 0.5], ["Flop c-bet", 30, 1, 0.4]]);
    const L = leaks(ds);
    expect(L.map((l) => [l.kind, l.key])).toEqual([
      ["freq", "Flop c-bet"],
      ["freq", "Open (RFI)"],
      ["spot", "Flop · SRP · IP · checked to"],
    ]);
    expect(ds.filter(leakTest(L[2]!))).toHaveLength(30);
    // under 80% in the mix over 30 preflop decisions: a preflop leak
    const bad = Array.from({ length: 30 }, (_, j) => open({ verdict: j < 20 ? "Mistake" : "Best" }));
    expect(leaks(bad).find((l) => l.kind === "pf")).toMatchObject({ key: "RFI", n: 30 });
    // fewer decisions: none
    expect(leaks(ds.slice(0, 29))).toEqual([]);
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
    const ds = [...Array.from({ length: 30 }, () => at("flop")), ...Array.from({ length: 30 }, () => at("turn")), ...Array.from({ length: 29 }, () => at("river"))];
    expect(report(ds).bySpot.map((g) => [g.key, g.n])).toEqual([["Flop · SRP · IP · checked to", 30], ["Turn · SRP · IP · checked to", 30], ["River · SRP · IP · checked to", 29]]);
    // (29 rivers: under the threshold, however the others look)
    expect(leaks(ds).filter((l) => l.kind === "spot").map((l) => l.key)).toEqual(["Flop · SRP · IP · checked to", "Turn · SRP · IP · checked to"]);
    expect(ds.filter(leakTest({ kind: "spot", key: "Turn · SRP · IP · checked to" }))).toHaveLength(30);
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
      ["River vs bet: call (bluff-catching)", 1, 1, 0.5],
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
      d({ source: "preflop-solve", verdict: "Inaccuracy", evLossBb: 0.1, lossPct: 2, byEv: true }),
      d({ source: "rules", verdict: "Not graded", why: "the rules" }),
    ];
    expect(ds.slice(0, 11).map(basisOf)).toEqual([BASES[0], BASES[1], BASES[2], BASES[5], BASES[6], BASES[7], BASES[3], BASES[4], BASES[8], BASES[9], BASES[10]]);
    const rp = report(ds);
    // (the most solid first; the rules, not graded, stand on nothing)
    expect(rp.byBasis.map((g) => [g.key, g.graded])).toEqual(BASES.map((b) => [b, 1]));
    expect(rp.low).toEqual({ n: 2, lost: 2 });
    expect(rp.offChart).toEqual([]);
    expect(rp.offRead.map((x) => x.source)).toEqual(["instant"]);
    const L = leaks([...Array.from({ length: 15 }, () => cbet({ street: "turn", situation: "SRP · IP · checked to", confidence: "low" })), ...Array.from({ length: 15 }, () => cbet({ street: "turn" }))]);
    expect(L.map((l) => [l.kind, l.key, l.low])).toEqual([["spot", "Turn · SRP · IP · checked to", 15]]);
  });

  it("a spot leak counts low reads among the decisions it's built on; a borrowed flop kept before `approximate` stays borrowed", () => {
    const low = cbet({ confidence: "low" });
    const reads = Array.from({ length: 30 }, () => cbet({ confidence: "low", evLossBb: null, lossPct: null, byEv: false, source: "instant" }));
    const ls = leaks([...Array.from({ length: 29 }, () => cbet()), low, ...reads]);
    const spot = ls.find((l) => l.kind === "spot")!;
    expect([spot.n, spot.low]).toEqual([30, 1]);
    expect(basisOf(cbet({ label: "Precomputed solution · srp · another table's spot read as this one" }))).toBe(BASES[2]);
    expect(basisOf(cbet())).toBe(BASES[1]);
  });

  it("doesn't mark a leak from a sample too small to read: under 30, or with its interval across the line", () => {
    expect(MIN_READ).toBe(30);
    // ten opens all raised against a 50% answer: 100% looks far off, the sample can't say so
    const ten = readLeaks(Array.from({ length: 10 }, () => open()));
    expect(ten.leaks).toEqual([]);
    expect(ten.thin.map((l) => [l.kind, l.key, l.n])).toEqual([["freq", "Open (RFI)", 10]]);
    // under ten: too few even to mention
    expect(readLeaks(Array.from({ length: 9 }, () => open()))).toEqual({ leaks: [], thin: [] });
    // over the count, but the answer's 50% is inside your 95% range: 19 raises of 30 is 63%, range 46% to 78%
    const near = readLeaks(Array.from({ length: 30 }, (_, j) => open(j < 19 ? {} : { action: "fold", matched: "fold" })));
    const row = near.thin.find((l) => l.kind === "freq");
    expect(row).toMatchObject({ key: "Open (RFI)", n: 30 });
    expect(row!.range).toEqual(wilson(19, 30));
    expect(near.leaks.filter((l) => l.kind === "freq")).toEqual([]);
    // 21 of 30 in the mix is 70%, under the 80% line, but its range reaches past it
    const pf = readLeaks(Array.from({ length: 30 }, (_, j) => open({ situation: "vs open", verdict: j < 21 ? "Best" : "Mistake" })));
    expect(pf.thin.find((l) => l.kind === "pf")).toMatchObject({ key: "vs open", n: 30, inMix: 0.7 });
    expect(pf.leaks.filter((l) => l.kind === "pf")).toEqual([]);
    // a spot that loses 0.5bb a decision on average from one big miss: its range crosses nothing lost
    const spike = readLeaks(Array.from({ length: 30 }, (_, j) => cbet({ evLossBb: j ? 0 : 15, verdict: j ? "Best" : "Blunder" })));
    expect(spike.thin.find((l) => l.kind === "spot")).toMatchObject({ n: 30, avg: 0.5 });
    expect(spike.leaks.filter((l) => l.kind === "spot")).toEqual([]);
  });

  it("reads each kind of leak by its own rule", () => {
    const base = { key: "x", score: 1, low: 0, versions: null };
    const freq: Leak = { ...base, kind: "freq", n: 30, you: 1, gto: 0.5, range: [0.8, 1] };
    expect(leakIsRead(freq)).toBe(true);
    expect(leakIsRead({ ...freq, n: 29 })).toBe(false);
    expect(leakIsRead({ ...freq, gto: 0.85 })).toBe(false);
    expect(leakIsRead({ ...freq, gto: 0.5, range: [0.1, 0.35] })).toBe(true);
    // (past the answer, but not all of it 10 points past)
    expect(leakIsRead({ ...freq, n: 400, you: 0.6025, gto: 0.5, range: [0.554, 0.649] })).toBe(false);
    const pf: Leak = { ...base, kind: "pf", n: 40, inMix: 0.5, range: [0.4, 0.79] };
    expect(leakIsRead(pf)).toBe(true);
    expect(leakIsRead({ ...pf, range: [0.4, 0.8] })).toBe(false);
    const spot: Leak = { ...base, kind: "spot", n: 40, avg: 1, lost: 40, range: [0.6, 1.4] };
    expect(leakIsRead(spot)).toBe(true);
    // (clear of nothing, but astride the half a big blind)
    expect(leakIsRead({ ...spot, avg: 0.55, range: [0.15, 0.95] })).toBe(false);
  });

  it("doesn't call a raise of your own flop bet a c-bet", () => {
    const facing = (o: Partial<DecisionRecord>) =>
      d({ street: "flop", role: "caller", facing: true, multi: false, mix: [["fold", 1, null]], matched: "fold", action: "fold", ...o });
    const count = (o: Partial<DecisionRecord>) => freqs([facing(o)]).find((f) => f.label === "Flop vs c-bet: fold")?.n ?? 0;
    expect(count({})).toBe(1);
    expect(count({ ownBet: true })).toBe(0);
  });

  it("works the range on a mean by hand, and has none from one number", () => {
    expect(meanRange([])).toBeNull();
    expect(meanRange([1])).toBeNull();
    // 0, 2: mean 1, s = sqrt(2), se = 1, half = 1.96
    const [lo, hi] = meanRange([0, 2])!;
    expect(lo).toBeCloseTo(-0.96, 9);
    expect(hi).toBeCloseTo(2.96, 9);
    expect(meanRange([0.6, 0.6, 0.6])![0]).toBeCloseTo(0.6, 6);
  });

  it("keeps the count and the range on every frequency, and says in the export what's too few to read", () => {
    const f = freqs([open(), open({ action: "fold", matched: "fold" })]).find((x) => x.label === "Open (RFI)")!;
    expect([f.k, f.n, f.you]).toEqual([1, 2, 0.5]);
    expect(f.range).toEqual(wilson(1, 2));
    const out = JSON.parse(toJSON(Array.from({ length: 10 }, () => open()), new Map(), 0)) as { summary: { freqs: { label: string; k: number; n: number; range: number[] }[]; tooFewToRead: { key: string }[]; leaks: unknown[] } };
    expect(out.summary.freqs[0]).toMatchObject({ k: 10, n: 10 });
    expect(out.summary.tooFewToRead.map((l) => l.key)).toEqual(["Open (RFI)"]);
    expect(out.summary.leaks).toEqual([]);
  });

  it("3-bets, squeezes, the flop's check-raise and a river call have rows of their own, with their own chances", () => {
    const mix: DecisionRecord["mix"] = [["fold", 0.25, null], ["call", 0.5, null], ["raise", 0.25, null]];
    const ds = [
      d({ situation: "vs open", action: "raise to 9", mix }),
      d({ situation: "vs open", action: "call", mix }),
      d({ situation: "vs open + call", pos: "BTN", action: "raise to 12", mix }),
      d({ situation: "BB defence", pos: "BB", action: "call", mix }),
      d({ street: "flop", ip: false, facing: true, multi: false, action: "raise to 8", mix }),
      d({ street: "flop", ip: true, facing: true, multi: false, action: "raise to 8", mix }),
      d({ street: "river", facing: true, action: "call", mix }),
      d({ street: "river", facing: true, action: "fold", mix }),
    ];
    const at = (label: string) => freqs(ds).find((f) => f.label === label);
    expect(at("3-bet (any seat)")).toMatchObject({ n: 4, k: 2, gto: 0.25 });
    // (a decision says "BB defence" in the blinds with or without a caller, so the blinds count under the 3-bet row)
    expect(at("Squeeze (not from the blinds)")).toMatchObject({ n: 1, k: 1 });
    expect(at("Flop out of position vs bet: raise")).toMatchObject({ n: 1, k: 1, gto: 0.25 });
    expect(at("River vs bet: call (bluff-catching)")).toMatchObject({ n: 2, k: 1, gto: 0.5 });
  });

  it("keeps solver EV lost by kind of game and in no one total, in hands still kept", () => {
    const cash = { id: "h1", site: "PokerStars" } as HandRecord;
    const mtt = { id: "h2", site: "PokerStars", tournament: "Sunday 50" } as HandRecord;
    const hands = new Map([[cash.id, cash], [mtt.id, mtt]]);
    const out = lostByKind([cbet({ handId: "h1" }), cbet({ handId: "h1" }), open({ handId: "h1" }), cbet({ handId: "h2", evLossBb: 2 }), cbet({ handId: "gone" }), d({ handId: "h1", verdict: "Not graded", why: "x" })], hands);
    expect(out.map((k) => [k.kind, k.graded, k.ev, k.lost])).toEqual([["cash", 3, 2, 1.2], ["tour", 1, 1, 2]]);
    expect(Object.keys(out[0]!).sort()).toEqual(["ev", "graded", "kind", "lost", "pfEv", "pfLost"]);
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

  it("keeps the preflop solve's EV out of the spot's, in the totals and by kind", () => {
    const h = new Map([["h1", { id: "h1", tournament: undefined } as unknown as HandRecord]]);
    const pf = open({ handId: "h1", source: "preflop-solve", byEv: true, verdict: "Mistake", evLossBb: 0.5, lossPct: 10 });
    const spot = cbet({ handId: "h1", evLossBb: 2, lossPct: 40 });
    const r = report([pf, spot]);
    expect(r.spotEv).toEqual({ n: 1, lost: 2, avgPct: 40 });
    expect(r.pfEv).toEqual({ n: 1, lost: 0.5 });
    expect(lostByKind([pf, spot], h)[0]).toMatchObject({ ev: 1, lost: 2, pfEv: 1, pfLost: 0.5 });
  });
});
