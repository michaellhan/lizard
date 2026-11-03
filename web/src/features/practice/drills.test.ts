// @vitest-environment node
// Drills (classic drills.test.js): the (flop, node) draws of each drill, hands dealt by range weight (in range, off
// the board), the pot, the node in Study; on entries of the solver snapshot's library (src/test/library.ts).
import { describe, expect, it } from "vitest";
import { hasSnapshot, libFile, libJson, snapshotJson } from "@/test/library";
import { seeded } from "@/poker/table";
import { fromSearch } from "@/features/study/studyState";
import type { LibraryIndex } from "@/library/catalog";
import { COMBOS, decodeEntry, handWeights, nodeAt, type LibraryRanges } from "@/library/entry";
import type { LibraryReport } from "@/library/files";
import { describe as describeProvenance } from "@/solver/provenance";
import {
  candidates,
  DRILL_VIEWS,
  drillActionLabel,
  drillProvenance,
  gradeDrill,
  pick,
  potAt,
  problem,
  situation,
  studyHandOf,
  studyLink,
  texture,
  type DrillProblem,
} from "./drills";

const INDEX = libJson<LibraryIndex>("index.json");
const report = (sid: string) => libJson<LibraryReport>(`${sid}/report.json`);
const ranges = (sid: string) => libJson<LibraryRanges>(`${sid}/ranges.json`);
const load = (sid: string, f: string) => decodeEntry(libFile(`${sid}/${f}.bin`));

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
});
