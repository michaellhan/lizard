// @vitest-environment node
// Drills (classic drills.test.js): the (flop, node) draws of each drill, hands dealt by range weight (in range, off
// the board), the pot, the node in Study; on entries of the solver snapshot's library (src/test/library.ts).
import { describe, expect, it } from "vitest";
import { hasSnapshot, libFile, libJson, snapshotFile, snapshotJson } from "@/test/library";
import { seeded } from "@/poker/table";
import { fromSearch } from "@/features/study/studyState";
import type { LibraryIndex } from "@/library/catalog";
import { storedTurnFlops } from "@/library/catalog";
import { cardInt, cardStr, COMBOS, decodeEntry, handWeights, nodeAt, SUITS, type LibraryRanges } from "@/library/entry";
import type { LibraryReport } from "@/library/files";
import { flopName } from "@/library/flops";
import { decodeTurns } from "@/library/turns";
import { describe as describeProvenance } from "@/solver/provenance";
import {
  candidates,
  DRILL_VIEWS,
  drillActionLabel,
  drillProvenance,
  flopDeals,
  gradeDrill,
  holding,
  lineReach,
  pick,
  potAt,
  problem,
  sampleFlops,
  situation,
  studyHandOf,
  studyLink,
  texture,
  TURN_VIEWS,
  turnCandidates,
  turnDeals,
  turnProblem,
  type DrillProblem,
} from "./drills";
import { drawCategory, madeCategory } from "@/features/study/categories";

const INDEX = libJson<LibraryIndex>("index.json");
const report = (sid: string) => libJson<LibraryReport>(`${sid}/report.json`);
const ranges = (sid: string) => libJson<LibraryRanges>(`${sid}/ranges.json`);
const load = (sid: string, f: string) => decodeEntry(libFile(`${sid}/${f}.bin`));
const loadTurns = (sid: string, f: string) => decodeTurns(libFile(`${sid}/${f}.turn.bin`));
const flopOf = (f: string) => [f.slice(0, 2), f.slice(2, 4), f.slice(4, 6)];
/** a shown card back to the stored one */
const unshown = (c: string, perm: readonly number[]) => c[0]! + SUITS[perm.indexOf(SUITS.indexOf(c[1]!))]!;

const REP: LibraryReport = {
  format: 1,
  id: "srp_btn_bb",
  label: "BTN vs BB single-raised pot",
  line: "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c",
  seats: ["BB", "BTN"],
  pot: 5.5,
  stack: 97.5,
  nodes: {
    "": ["check", "bet 33%", "bet 75%"],
    check: ["check", "bet 33%", "bet 75%"],
    "check|bet 33%": ["fold", "call", "raise to 7"],
    "check|bet 75%": ["fold", "call", "raise to 11"],
    "bet 33%": ["fold", "call", "raise to 6"],
    "bet 75%": ["fold", "call", "raise to 13"],
  },
  flops: [
    {
      f: "Ac4d3h",
      w: 100,
      n: {
        "": [0.9, 0.04, 0.06],
        check: [0.5, 0.2, 0.3],
        "check|bet 33%": [0.4, 0.5, 0.1],
        "check|bet 75%": [0.5, 0.4, 0.1],
        "bet 33%": [0.2, 0.7, 0.1],
        "bet 75%": [0.3, 0.6, 0.1],
      },
    },
    { f: "9c8c7c", w: 50, n: { "": [1, 0, 0], check: [0.8, 0.2, 0], "check|bet 33%": [0.3, 0.6, 0.1] } },
    { f: "Kc7d7h", w: 50, n: { "": [1, 0, 0] } },
  ],
};

describe("texture", () => {
  it("high card, suits, pairing and connectedness, the ace playing low too", () => {
    expect(texture("Ac4d3h")).toMatchObject({ hi: "A", suits: "rainbow", pair: "unpaired", conn: "conn" });
    expect(texture("9c8c7c")).toMatchObject({ hi: "9-", suits: "mono", conn: "conn" });
    expect(texture("Kc7d7h")).toMatchObject({ hi: "K", suits: "rainbow", pair: "paired", conn: "dry" });
    expect(texture("Kh9h2c")).toMatchObject({ suits: "twotone", conn: "semi" });
    expect(texture("2c2d2h").pair).toBe("trips");
  });
});

describe("the drills' draws", () => {
  it("stored nodes only, the texture filter, bets by how often they're made", () => {
    expect(candidates(REP, "oop").map((c) => [c.f, c.path, c.w])).toEqual([
      ["Ac4d3h", [], 100],
      ["9c8c7c", [], 50],
      ["Kc7d7h", [], 50],
    ]);
    expect(candidates(REP, "ip").map((c) => c.f)).toEqual(["Ac4d3h", "9c8c7c"]);
    expect(candidates(REP, "oop", { suits: "mono" }).map((c) => c.f)).toEqual(["9c8c7c"]);
    expect(candidates(REP, "oop", { pair: "paired", hi: "K" }).map((c) => c.f)).toEqual(["Kc7d7h"]);
    expect(candidates(REP, "oop", { suits: "mono", pair: "paired" })).toEqual([]);
    // A43: a 33% bet 20% of the time, 75% 30% (the flop's weight split 2:3); 987: only the 33% bet is stored
    const vb = candidates(REP, "vsbet").map((c) => [c.f, c.path.join("|"), Math.round(c.w * 100) / 100]);
    expect(vb).toEqual([
      ["Ac4d3h", "check|bet 33%", 40],
      ["Ac4d3h", "check|bet 75%", 60],
      ["9c8c7c", "check|bet 33%", 50],
    ]);
    // in position facing out of position's first bet: A43's 33% bet made 4% of the time, its 75% 6%
    expect(candidates(REP, "ipvsbet").map((c) => [c.f, c.path.join("|"), Math.round(c.w * 100) / 100])).toEqual([
      ["Ac4d3h", "bet 33%", 40],
      ["Ac4d3h", "bet 75%", 60],
    ]);
    // (the fixture's single-raised pots store no response to a lead; its 3-bet pot stores the c-bet's)
    for (const sp of INDEX.spots)
      for (const v of DRILL_VIEWS) expect(candidates(report(sp.id), v).length > 0, `${sp.id} ${v}`).toBe(v !== "ipvsbet" || sp.id === "3bp_bb_btn");
  });

  it.skipIf(!hasSnapshot)("every spot of the snapshot's whole library has draws for each drill", () => {
    const index = snapshotJson<LibraryIndex>("index.json");
    for (const sp of index.spots)
      for (const v of DRILL_VIEWS) expect(candidates(snapshotJson<LibraryReport>(`${sp.id}/report.json`), v).length, `${sp.id} ${v}`).toBeGreaterThan(0);
  });

  it("picks by weight, never a zero", () => {
    const r = seeded(1);
    const n = [0, 0, 0];
    for (let i = 0; i < 6000; i++) n[pick([1, 0, 2], r)]!++;
    expect(n[1]).toBe(0);
    expect(Math.abs(n[2]! / n[0]! - 2)).toBeLessThan(0.2);
    expect(pick([0, 0], r)).toBe(-1);
  });

  it("deals from the acting player's range at the node, off the board, by weight", async () => {
    const r = seeded(7);
    for (const view of DRILL_VIEWS) {
      const sid = view === "ipvsbet" ? "3bp_bb_btn" : "srp_btn_bb";
      const rep = report(sid);
      const rg = ranges(sid);
      const cs = candidates(rep, view);
      for (let i = 0; i < 4; i++) {
        const c = cs[pick(cs.map((x) => x.w), r)]!;
        const e = await load(sid, c.f);
        const w = handWeights(e, c.path, rg)!;
        const nd = nodeAt(e, c.path)!;
        const counts = new Map<number, number>();
        for (let k = 0; k < 300; k++) {
          const pr = problem(rep, e, c, rg, r)!;
          expect(pr.hero).toBe(rep.seats[nd.player]);
          const ci = COMBOS.findIndex((x) => x[0] === pr.combo[0] && x[1] === pr.combo[1]);
          const j = e.combos[nd.player].indexOf(ci);
          expect(j >= 0 && w[j]! > 0, "in the range at the node").toBe(true);
          // the shown cards: one suit relabelling of the stored flop and the combo, no card twice
          expect(new Set([...pr.hand, ...pr.board]).size).toBe(5);
          const canon = [c.f.slice(0, 2), c.f.slice(2, 4), c.f.slice(4)];
          pr.board.forEach((x, t) => expect(x[0]).toBe(canon[t]![0]));
          expect(pr.freqs).toEqual(nd.strat.map((row) => row[j]));
          expect(pr.evs).toEqual(nd.evs.map((row) => row[j]));
          counts.set(j, (counts.get(j) ?? 0) + 1);
        }
        // the most common hand comes up about as often as its weight says
        const tot = w.reduce((a, b) => a + b, 0);
        const [jt, nt] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
        expect(nt / 300).toBeLessThan((w[jt]! / tot) * 3 + 0.03);
      }
    }
  });
});

describe("a problem's spot", () => {
  const pr: DrillProblem = {
    spot: "srp_btn_bb",
    flop: "QhTh4h",
    path: ["check", "bet 75%"],
    player: 0,
    hero: "BB",
    board: ["Qh", "Th", "4h"],
    hand: ["Kc", "6s"],
    combo: [17, 44],
    perm: [0, 1, 2, 3],
    names: ["fold", "call", "raise to 11"],
    freqs: [0.2, 0.7, 0.1],
    evs: [0, 1.5, 1.2],
    pot: 9.63,
    bet: 4.13,
  };

  it("the pot and the bet faced, the action said, sizes in bb", () => {
    expect(potAt(REP, [])).toEqual({ pot: 5.5, bet: 0 });
    expect(potAt(REP, ["check", "bet 75%"])).toEqual({ pot: 9.63, bet: 4.13 });
    expect(situation(REP, pr)).toBe("BB checks, BTN bets 75% (4.13bb) · pot 9.63bb");
    expect(situation(REP, { path: [], pot: 5.5, bet: 0 })).toBe("BB to act first · pot 5.5bb");
    expect(situation(REP, { path: ["bet 75%"], pot: 9.63, bet: 4.13 })).toBe("BB bets 75% (4.13bb) · pot 9.63bb");
    expect(drillActionLabel(pr, "call")).toBe("call 4.13bb");
    expect(drillActionLabel({ pot: 5.5, bet: 0 }, "bet 33%")).toBe("bet 33% (1.82bb)");
    expect(drillActionLabel(pr, "raise to 11")).toBe("raise to 11");
  });

  it("graded on the one scale, by EV given up", () => {
    expect(gradeDrill(pr, 1)).toMatchObject({ verdict: "Best", byEv: true });
    expect(gradeDrill(pr, 0)).toMatchObject({ verdict: "Correct", loss: 1.5 }); // (played 20%)
    expect(gradeDrill({ ...pr, freqs: [0.05, 0.9, 0.05] }, 0)).toMatchObject({ verdict: "Blunder" }); // 1.5bb of 9.63: 16%
  });

  it("opens in Study at the same node", () => {
    const h = studyHandOf(REP, pr);
    expect(h.flop).toEqual([
      { pos: "BB", action: "check" },
      { pos: "BTN", action: "bet", to: 4.13 },
    ]);
    expect(h.preflop.slice(3)).toEqual([
      { pos: "BTN", action: "raise", to: 2.5 },
      { pos: "SB", action: "fold" },
      { pos: "BB", action: "call" },
    ]);
    expect([h.players, h.stack, h.board]).toEqual([6, 100, "QhTh4h"]);
    expect(studyHandOf(REP, { ...pr, path: ["bet 75%"], player: 1, hero: "BTN" }).flop).toEqual([{ pos: "BB", action: "bet", to: 4.13 }]);
    expect(fromSearch(studyLink(REP, pr)!.slice("/study?".length))).toEqual(h);
    // a spot of another game is played in that game; one Study can't set up has no link
    expect(studyHandOf({ ...REP, game: { players: 2, stack: 100, ante: 0, straddle: false } }, pr).players).toBe(2);
    // (a straddle or an ante comes along as Study's setup; an ante over 1bb Study can't set up)
    expect(fromSearch(studyLink({ ...REP, game: { players: 6, stack: 100, ante: 0, straddle: true } }, pr)!.slice("/study?".length))?.setup).toEqual({ straddle: true });
    expect(studyLink({ ...REP, game: { players: 6, stack: 100, ante: 1.5, straddle: false } }, pr)).toBeNull();
  });

  it("names the stored solve, read from the file", async () => {
    const p = drillProvenance(await load("srp_btn_bb", "Ac4d3h"), "fast");
    expect(describeProvenance(p)).toBe("Precomputed solution · srp_btn_bb · 0.11% pot from equilibrium in the solved game (converged) · 300 iterations");
    expect(p.transport).toBe("file");
  });

  it("carries the stored answer's version where it's given one, a stored turn's too", async () => {
    const e = await load("srp_btn_bb", "Ac4d3h");
    expect(drillProvenance(e, "fast", undefined, "library:srp_btn_bb:1111:Ac4d3h:aa").libraryVersion).toBe("library:srp_btn_bb:1111:Ac4d3h:aa");
    expect(drillProvenance(e, "fast", { names: ["check"], turn: { card: "9s", at: [], rangeEvs: null } }, "library:srp_btn_bb:1111:Ac4d3h:aa")).toMatchObject({ source: "library-turn", libraryVersion: "library:srp_btn_bb:1111:Ac4d3h:aa" });
    expect(drillProvenance(e, "fast")).not.toHaveProperty("libraryVersion");
  });
});

describe("the hand filter on flop drills", () => {
  const rep = report("srp_btn_bb");
  const rg = ranges("srp_btn_bb");

  it("deals only hands of the filter, read the same on the suits shown", async () => {
    const r = seeded(11);
    const e = await load("srp_btn_bb", "Ac4d3h");
    const c = { f: "Ac4d3h", path: [], w: 1 };
    for (let i = 0; i < 200; i++) {
      const pr = problem(rep, e, c, rg, r, "m:top_wk")!;
      const [a, b] = pr.hand.map(cardInt) as [number, number];
      expect(madeCategory([a, b], pr.board.map(cardInt))).toBe("top_wk");
      const fd = problem(rep, e, c, rg, r, "c:sc")!;
      expect(fd.hand[0]![1]).toBe(fd.hand[1]![1]);
    }
  });

  it("deals no hand where the filter leaves none, and no filter deals as before", async () => {
    const e = await load("srp_btn_bb", "Ac4d3h");
    const c = { f: "Ac4d3h", path: [], w: 1 };
    expect(problem(rep, e, c, rg, seeded(1), "m:flush")).toBeNull();
    expect(problem(rep, e, c, rg, seeded(1), "m:quads")).toBeNull();
    expect(problem(rep, e, c, rg, seeded(5), null)).toEqual(problem(rep, e, c, rg, seeded(5)));
  });

  it("narrows the draws to flops that can hold the hands, from the range entering the flop", () => {
    const cs = candidates(rep, "oop");
    expect(holding(cs, rg, 0, "m:flush").map((c) => c.f).sort()).toEqual(["9c8c7c", "Ac8c6c"]);
    expect(holding(cs, rg, 0, "m:top_wk").length).toBeGreaterThan(0);
    expect(holding(cs, rg, 0, "c:pairs")).toEqual(cs);
    // a flop's draw stays with its weight
    expect(holding(cs, rg, 0, "m:flush")[0]!.w).toBe(cs.find((c) => c.f === holding(cs, rg, 0, "m:flush")[0]!.f)!.w);
  });

  it("counts the deals: each hand with weight at the node, and those of the filter", async () => {
    const e = await load("srp_btn_bb", "Ac4d3h");
    const w = handWeights(e, [], rg)!;
    const c = flopDeals(e, [[]], rg, "c:pairs");
    expect(c.deals).toBe(w.filter((x) => x > 0).length);
    const pairs = e.combos[0].filter((ci, j) => w[j]! > 0 && COMBOS[ci]![0] >> 2 === COMBOS[ci]![1] >> 2).length;
    expect(c.match).toBe(pairs);
    expect(c.match).toBeGreaterThan(0);
    expect(flopDeals(e, [[]], rg, "m:flush").match).toBe(0);
  });

  it("a count's sample is spread through the flops, each once", () => {
    const cs = "abcdefghij".split("").flatMap((f) => [{ f, path: [], w: 1 }, { f, path: ["check"], w: 1 }]);
    expect(sampleFlops(cs, 20)).toHaveLength(10);
    expect(sampleFlops(cs, 3)).toEqual(["a", "d", "g"]);
  });
});

describe("turn drills", () => {
  const rep = report("srp_btn_bb");
  const rg = ranges("srp_btn_bb");
  const sp = INDEX.spots.find((s) => s.id === "srp_btn_bb")!;

  it("draws from the flops with a stored turn file, by the texture filter and weight", () => {
    expect(turnCandidates(rep, storedTurnFlops(sp)).map((c) => c.f).sort()).toEqual(Object.keys(sp.flops).sort());
    expect(turnCandidates(rep, ["Ac4d3h", "9c8c7c"], { suits: "mono" }).map((c) => [c.f, c.path, c.w])).toEqual([["9c8c7c", [], rep.flops.find((x) => x.f === "9c8c7c")!.w]]);
    expect(turnCandidates(rep, [])).toEqual([]);
    const threeBet = INDEX.spots.find((s) => s.id === "3bp_bb_btn")!;
    expect(turnCandidates(report("3bp_bb_btn"), storedTurnFlops(threeBet)).map((c) => c.f).sort()).toEqual(["2h2d2c", "3c2d2c"]);
  });

  it("carries a hand's reach through its own flop actions", async () => {
    const e = await load("srp_btn_bb", "Ac4d3h");
    const root = nodeAt(e, [])!;
    const check = nodeAt(e, ["check"])!;
    const oop = lineReach(e, ["check", "check"], 0, rg)!;
    const ip = lineReach(e, ["check", "check"], 1, rg)!;
    e.combos[0].forEach((ci, j) => expect(oop.get(ci)).toBeCloseTo((rg.w[0][ci]! / 10000) * root.strat[0]![j]!, 12));
    e.combos[1].forEach((ci, j) => expect(ip.get(ci)).toBeCloseTo((rg.w[1][ci]! / 10000) * check.strat[check.names.indexOf("check")]![j]!, 12));
    // the bet and the call are each their own: out of position checks and calls, in position only bets
    const line = ["check", "bet 33%", "call"];
    const facing = nodeAt(e, ["check", "bet 33%"])!;
    const called = lineReach(e, line, 0, rg)!;
    e.combos[0].forEach((ci, j) => expect(called.get(ci)).toBeCloseTo((rg.w[0][ci]! / 10000) * root.strat[0]![j]! * facing.strat[facing.names.indexOf("call")]![j]!, 12));
    // a decision the entry doesn't store: the line can't be weighed
    expect(lineReach(e, ["check", "bet 33%", "raise to 99", "call"], 0, rg)).toBeNull();
    expect(lineReach(e, ["check", "bet 50%", "call"], 1, rg)).toBeNull();
    expect(lineReach(e, ["check", "bet 33%", "raise to 7", "call", "check"], 0, rg)).toBeNull();
  });

  it.each([
    ["srp_btn_bb", "Ac4d3h"],
    ["srp_btn_bb", "Ac8c6c"],
    ["srp_btn_bb", "9c8c7c"],
    ["3bp_bb_btn", "3c2d2c"],
  ])("%s %s: a legal spot, whose shown cards map back to the stored ones", async (sid, f) => {
    const r = seeded(21);
    const rp = report(sid);
    const rn = ranges(sid);
    const e = await load(sid, f);
    const t = await loadTurns(sid, f);
    for (const view of TURN_VIEWS)
      for (let i = 0; i < 150; i++) {
        const pr = turnProblem(rp, e, t, view, rn, r)!;
        expect(pr.turn).toBeDefined();
        expect(pr.board).toHaveLength(4);
        expect(new Set([...pr.board, ...pr.hand]).size).toBe(6);
        expect(pr.hero).toBe(rp.seats[view === "ip" ? 1 : 0]);
        // the perm's inverse takes the shown board to the stored flop and turn card, card for card, and your hand to the
        // stored combo the mix is read from
        expect(pr.perm.slice().sort()).toEqual([0, 1, 2, 3]);
        expect(pr.board.map((c) => unshown(c, pr.perm))).toEqual([...flopOf(f), pr.turn!.card]);
        expect(pr.hand.map((c) => unshown(c, pr.perm))).toEqual([cardStr(pr.combo[1]), cardStr(pr.combo[0])]);
        // the library's own canonical naming of the shown flop finds the same stored flop
        expect(flopName(pr.board.slice(0, 3))).toBe(f);
        // the turn card is a class's played card, and the hand is stored there on that line, with that mix
        const k = t.played.indexOf(cardInt(pr.turn!.card));
        expect(k).toBeGreaterThanOrEqual(0);
        const line = t.lines.find((l) => l.path.join("|") === pr.path.join("|"))!;
        const nd = line.nodes.find((n) => n.at.join() === pr.turn!.at.join())!;
        const j = nd.classes[k]!.combos.indexOf(COMBOS.findIndex((x) => x[0] === pr.combo[0] && x[1] === pr.combo[1]));
        expect(j).toBeGreaterThanOrEqual(0);
        expect(pr.freqs).toEqual(nd.classes[k]!.strat.map((row) => row[j]));
        expect(pr.names).toEqual(nd.names);
        expect(pr.pot).toBe(line.pot);
        // no card of the flop or the turn in the hand; the hand reaches the line
        expect(lineReach(e, pr.path, pr.player, rn)!.get(COMBOS.findIndex((x) => x[0] === pr.combo[0] && x[1] === pr.combo[1]))).toBeGreaterThan(0);
        expect(pr.evs).toBeNull();
      }
  });

  it("deals lines and turn cards by how often they come up", async () => {
    const e = await load("srp_btn_bb", "Ac4d3h");
    const t = await loadTurns("srp_btn_bb", "Ac4d3h");
    const r = seeded(4);
    const lines = new Map<string, number>();
    for (let i = 0; i < 1500; i++) {
      const pr = turnProblem(rep, e, t, "oop", rg, r)!;
      const k = pr.path.join("|");
      lines.set(k, (lines.get(k) ?? 0) + 1);
    }
    const a = t.lines[0]!;
    const b = t.lines[1]!;
    const ratio = lines.get(a.path.join("|"))! / lines.get(b.path.join("|"))!;
    expect(Math.abs(ratio / (a.share / b.share) - 1)).toBeLessThan(0.25);
  });

  it("a hand filter reads the turn's board too, and says when there's no such hand", async () => {
    const e = await load("srp_btn_bb", "Ac8c6c");
    const t = await loadTurns("srp_btn_bb", "Ac8c6c");
    const r = seeded(9);
    for (let i = 0; i < 100; i++) {
      const pr = turnProblem(rep, e, t, "oop", rg, r, "m:straight")!;
      const [a, b] = pr.hand.map(cardInt) as [number, number];
      expect(madeCategory([a, b], pr.board.map(cardInt))).toBe("straight");
      const fd = turnProblem(rep, e, t, "ip", rg, r, "d:gutshot")!;
      const [c, d] = fd.hand.map(cardInt) as [number, number];
      expect(drawCategory([c, d], fd.board.map(cardInt))).toBe("gutshot");
    }
    const rainbow = await load("srp_btn_bb", "Ac4d3h");
    const tr = await loadTurns("srp_btn_bb", "Ac4d3h");
    expect(turnProblem(rep, rainbow, tr, "oop", rg, r, "m:flush")).toBeNull();
    const c = turnDeals(rainbow, tr, "oop", rg, "d:fd");
    expect(c.deals).toBeGreaterThan(c.match);
    expect(c.match).toBeGreaterThan(0);
    expect(turnDeals(rainbow, tr, "oop", rg, "m:flush")).toMatchObject({ match: 0 });
  });

  it("is graded on the one scale, by the stored mix alone: no EV is lost or made up", async () => {
    const e = await load("3bp_bb_btn", "3c2d2c");
    const t = await loadTurns("3bp_bb_btn", "3c2d2c");
    const pr = turnProblem(report("3bp_bb_btn"), e, t, "oop", ranges("3bp_bb_btn"), seeded(2))!;
    const g = gradeDrill({ ...pr, names: ["check", "bet 75%"], freqs: [0.95, 0.05] }, 1);
    expect(g).toMatchObject({ byEv: false, loss: 0, lossPct: 0, verdict: "Inaccuracy", best: 0 });
    expect(gradeDrill({ ...pr, names: ["check", "bet 75%"], freqs: [0.95, 0.05] }, 0)).toMatchObject({ verdict: "Best", byEv: false });
    // the file's EVs are the class's, shown beside the mix and never graded on
    expect(pr.evs).toBeNull();
    expect(pr.turn!.rangeEvs).toHaveLength(pr.names.length);
  });

  it("says the flop's line and the turn's, and opens Study at the node", () => {
    const pr: DrillProblem = {
      spot: "srp_btn_bb",
      flop: "Ac4d3h",
      path: ["check", "bet 33%", "raise to 7", "call"],
      player: 1,
      hero: "BTN",
      board: ["Ah", "4c", "3d", "9s"],
      hand: ["Kc", "6s"],
      combo: [17, 44],
      perm: [0, 1, 2, 3],
      names: ["check", "bet 75%"],
      freqs: [0.5, 0.5],
      evs: null,
      pot: 19.5,
      bet: 0,
      turn: { card: "9s", at: ["check"], rangeEvs: null },
    };
    expect(situation(REP, pr)).toBe("On the flop BB checks, BTN bets 33%, BB raises to 7, BTN calls. BB checks the turn · pot 19.5bb");
    expect(situation(REP, { ...pr, path: ["check", "check"], turn: { ...pr.turn!, at: [] }, pot: 5.5 })).toBe("On the flop BB and BTN check. BB to act first on the turn · pot 5.5bb");
    expect(situation(REP, { ...pr, path: ["bet 75%", "call"], turn: { ...pr.turn!, at: [] }, pot: 13.5 })).toBe("On the flop BB bets 75%, BTN calls. BB to act first on the turn · pot 13.5bb");
    expect(drillActionLabel(pr, "bet 75%")).toBe("bet 75% (14.63bb)");
    const h = studyHandOf(REP, pr);
    expect(h.board).toBe("Ah4c3d9s");
    expect(h.flop).toEqual([
      { pos: "BB", action: "check" },
      { pos: "BTN", action: "bet", to: 1.82 },
      { pos: "BB", action: "raise", to: 7 },
      { pos: "BTN", action: "call" },
    ]);
    expect(h.turn).toEqual([{ pos: "BB", action: "check" }]);
    expect(fromSearch(studyLink(REP, pr)!.slice("/study?".length))).toEqual(h);
  });

  it("names the stored turn, not the flop solve's distance from equilibrium, which doesn't describe it", async () => {
    const e = await load("srp_btn_bb", "Ac4d3h");
    const p = drillProvenance(e, "fast", { names: ["check", "bet 75%"], turn: { card: "9s", at: [], rangeEvs: null } });
    expect(describeProvenance(p)).toBe("Stored turn from the flop library · srp_btn_bb · the precomputed flop solve's view of this turn, in 5% steps (one bet size, 75%) · approximate");
    expect(p).toMatchObject({ source: "library-turn", approximate: true, transport: "file" });
    expect(p.exploitabilityPct).toBeUndefined();
    expect(p.iterations).toBeUndefined();
    // (a flop drill's is as it was)
    expect(describeProvenance(drillProvenance(e, "fast", { names: ["check"] }))).toMatch(/^Precomputed solution · srp_btn_bb/);
  });

  it.skipIf(!hasSnapshot)("every flop a spot of the snapshot lists has a turn file that decodes, sampled", async () => {
    const index = snapshotJson<LibraryIndex>("index.json");
    for (const s of index.spots) {
      const flops = storedTurnFlops(s);
      for (const f of flops.filter((_, i) => i % Math.max(1, Math.floor(flops.length / 3)) === 0).slice(0, 3)) {
        const t = await decodeTurns(snapshotFile(`${s.id}/${f}.turn.bin`));
        expect(t.head.board).toBe(f);
        const e = await decodeEntry(snapshotFile(`${s.id}/${f}.bin`));
        const rp = snapshotJson<LibraryReport>(`${s.id}/report.json`);
        const rn = snapshotJson<LibraryRanges>(`${s.id}/ranges.json`);
        for (const v of TURN_VIEWS) expect(turnProblem(rp, e, t, v, rn, seeded(1)), `${s.id} ${f} ${v}`).not.toBeNull();
      }
    }
  });
});
