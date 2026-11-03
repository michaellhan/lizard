import { describe, expect, it } from "vitest";
import type { LibraryIndex } from "@/library/catalog";
import type { LibraryReport } from "@/library/files";
import { fromSearch } from "@/features/study/studyState";
import { hasSnapshot, libJson, snapshotJson } from "@/test/library";
import {
  ALL_FLOPS,
  average,
  columns,
  coverage,
  eqr,
  filterRows,
  groups,
  nodeOf,
  REPORT_VIEWS,
  reportProvenance,
  rows,
  sortRows,
  studyHandAt,
  studyLink,
  toCsv,
} from "./reports";

// the classic test's report (solver/tests/js/reports.test.js), shaped like flop_library.build_report's
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
  },
  flops: [
    { f: "Ac4d3h", w: 100, ev: [2.1, 3.4], eq: [0.45, 0.55], n: { "": [0.9, 0.05, 0.05], check: [0.5, 0.2, 0.3], "check|bet 33%": [0.4, 0.5, 0.1], "check|bet 75%": [0.5, 0.4, 0.1] } },
    { f: "9c8c7c", w: 50, ev: [2.8, 2.7], eq: [0.52, 0.48], n: { "": [1, 0, 0], check: [0.8, 0.2, 0], "check|bet 33%": [0.3, 0.6, 0.1] } },
    { f: "Kc7d7h", w: 50, ev: [1.9, 3.6], eq: [0.41, 0.59], n: { "": [1, 0, 0] } },
  ],
};
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-12);

describe("flop reports", () => {
  it("each view's rows: its node's frequencies by column, null where the flop doesn't store it", () => {
    expect(columns(REP, "oop")).toEqual(["check", "bet 33%", "bet 75%"]);
    expect(columns(REP, "vsbet")).toEqual(["fold", "call", "raise"]);
    expect(rows(REP, "ip").map((r) => r.freqs)).toEqual([[0.5, 0.2, 0.3], [0.8, 0.2, 0], null]);
    // facing in position's most common bet: 75% on A43 (30% against 20%), 33% on 987
    expect(rows(REP, "vsbet").map((r) => [r.bet, r.freqs])).toEqual([
      ["bet 75%", [0.5, 0.4, 0.1]],
      ["bet 33%", [0.3, 0.6, 0.1]],
      [null, null],
    ]);
    expect(nodeOf(REP, REP.flops[2]!, "ip")).toBeNull();
  });

  it("filters, sorts and averages by weight, as classic", () => {
    const rs = rows(REP, "oop");
    expect(filterRows(rs, { pair: "unpaired" }).map((r) => r.f)).toEqual(["Ac4d3h", "9c8c7c"]);
    expect(filterRows(rs, { suits: "rainbow", hi: "K" }).map((r) => r.f)).toEqual(["Kc7d7h"]);
    expect(sortRows(rs, "flop", true).map((r) => r.f)).toEqual(["Ac4d3h", "Kc7d7h", "9c8c7c"]);
    expect(sortRows(rs, "flop", false).map((r) => r.f)).toEqual(["9c8c7c", "Kc7d7h", "Ac4d3h"]);
    expect(sortRows(rs, "a0", true).map((r) => r.f)).toEqual(["Kc7d7h", "9c8c7c", "Ac4d3h"]); // ties: high flop first
    expect(sortRows(rs, "ev1", true).map((r) => r.f)).toEqual(["Kc7d7h", "Ac4d3h", "9c8c7c"]);
    const a = average(rs);
    expect(a.w).toBe(200);
    close(a.freqs![0]!, (0.9 * 100 + 50 + 50) / 200);
    close(a.ev[0], (2.1 * 100 + 2.8 * 50 + 1.9 * 50) / 200);
    // frequencies average over the flops that store the node only
    close(average(rows(REP, "ip")).freqs![0]!, (0.5 * 100 + 0.8 * 50) / 150);
    expect(groups(rs, "suits").map((x) => [x.g, x.n, x.w])).toEqual([
      ["rainbow", 2, 150],
      ["mono", 1, 50],
    ]);
    expect(average([]).freqs).toBeNull();
  });

  it("EQR: EV over equity times the pot, blank where equity is zero", () => {
    close(eqr(2.1, 0.45, 5.5)!, 2.1 / (0.45 * 5.5));
    expect(eqr(1, 0, 5.5)).toBeNull();
    expect(eqr(NaN, 0.5, 5.5)).toBeNull();
    const rs = rows(REP, "oop");
    // sorting by EQR: in position's, highest first (A43 3.4/(0.55*5.5)=1.124, K77 1.109, 987 1.023)
    expect(sortRows(rs, "eqr1", true, REP.pot).map((r) => r.f)).toEqual(["Ac4d3h", "Kc7d7h", "9c8c7c"]);
  });

  it("covers its stored flops' share of all 22100", () => {
    expect(coverage(REP)).toEqual({ flops: 3, share: 200 / ALL_FLOPS });
  });

  it("opens Study at each view's node, the bet faced at its size", () => {
    expect(studyHandAt(REP, "Ac4d3h", "oop")).toMatchObject({ players: 6, stack: 100, board: "Ac4d3h", flop: [] });
    expect(studyHandAt(REP, "Ac4d3h", "ip")?.flop).toEqual([{ pos: "BB", action: "check" }]);
    expect(studyHandAt(REP, "Ac4d3h", "vsbet")?.flop).toEqual([
      { pos: "BB", action: "check" },
      { pos: "BTN", action: "bet", to: 4.13 },
    ]);
    expect(studyHandAt(REP, "Kc7d7h", "vsbet")).toBeNull();
    expect(studyHandAt(REP, "2c2d2h", "oop")).toBeNull();
    const link = studyLink(REP, "9c8c7c", "vsbet")!;
    const h = fromSearch(link.split("?")[1]!)!;
    expect(h.preflop.map((a) => `${a.pos}:${a.action}`)).toEqual(["UTG:fold", "HJ:fold", "CO:fold", "BTN:raise", "SB:fold", "BB:call"]);
    expect(h.flop).toEqual([
      { pos: "BB", action: "check" },
      { pos: "BTN", action: "bet", to: 1.82 },
    ]);
    // an ante comes along as Study's setup; one over 1bb a seat Study can't set up
    expect(studyLink({ ...REP, game: { players: 6, stack: 40, ante: 0.125, straddle: false } }, "Ac4d3h", "oop")).toBe("/study?p=6&s=40&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac&b=Ac4d3h&ante=0.125");
    expect(studyLink({ ...REP, game: { players: 6, stack: 40, ante: 1.5, straddle: false } }, "Ac4d3h", "oop")).toBeNull();
  });

  it("writes the rows shown as CSV, at the stored precision, with their source", () => {
    const p = reportProvenance(REP, "fast");
    const csv = toCsv(REP, "vsbet", rows(REP, "vsbet"), p).trim().split("\n");
    expect(csv[0]).toBe(
      "flop,weight,share of flops,high card,suits,pairing,connectedness,bet faced,fold,call,raise,BB EV (bb),BTN EV (bb),BB equity,BTN equity,BB EQR,BTN EQR,source",
    );
    expect(csv[1]).toBe(
      "Ac4d3h,100,0.00452,A,rainbow,unpaired,conn,bet 75%,0.500,0.400,0.100,2.10,3.40,0.450,0.550,0.848,1.124,Precomputed solution · srp_btn_bb · flop report over its 3 stored flops",
    );
    // a flop that doesn't store the node: its frequencies left blank, not 0
    expect(csv[3]).toMatch(/^Kc7d7h,50,0\.00226,K,rainbow,paired,dry,,,,,1\.90,3\.60,/);
    expect(p).toMatchObject({ source: "library", approximate: false, transport: "file", librarySpot: "srp_btn_bb" });
  });

  it("every fixture spot's report renders each view, its frequencies summing to 1", () => {
    const index = libJson<LibraryIndex>("index.json");
    for (const sp of index.spots) {
      const rep = libJson<LibraryReport>(`${sp.id}/report.json`);
      expect(rep.flops.map((x) => x.f).sort()).toEqual(Object.keys(sp.flops).sort());
      for (const v of REPORT_VIEWS) {
        const a = average(rows(rep, v));
        expect(Math.abs(a.freqs!.reduce((x, y) => x + y, 0) - 1), `${sp.id} ${v}`).toBeLessThan(0.005);
      }
    }
  });

  it.skipIf(!hasSnapshot)("so does every spot of the snapshot's whole library, and its stored flops open in Study", () => {
    const index = snapshotJson<LibraryIndex>("index.json");
    for (const sp of index.spots) {
      const rep = snapshotJson<LibraryReport>(`${sp.id}/report.json`);
      for (const v of REPORT_VIEWS) {
        const rs = rows(rep, v);
        const a = average(rs);
        expect(Math.abs(a.freqs!.reduce((x, y) => x + y, 0) - 1), `${sp.id} ${v}`).toBeLessThan(0.005);
        const stored = rs.find((r) => r.freqs)!;
        expect(studyHandAt(rep, stored.f, v), `${sp.id} ${v}`).not.toBeNull();
      }
    }
  });
});
