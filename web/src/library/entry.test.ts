// @vitest-environment node
// Decoding the library's entries, on entries of the solver snapshot's library (src/test/library.ts; classic
// drills.test.js).
import { describe, expect, it } from "vitest";
import { libFile, libJson } from "@/test/library";
import type { LibraryIndex } from "./catalog";
import { COMBOS, cardInt, decodeEntry, handWeights, nodeAt, SUITS, type LibraryRanges } from "./entry";

const INDEX = libJson<LibraryIndex>("index.json");
const ranges = (sid: string) => libJson<LibraryRanges>(`${sid}/ranges.json`);
const load = (sid: string, f: string) => decodeEntry(libFile(`${sid}/${f}.bin`));

describe("library entries", () => {
  it("each stored node's strategy, weighted by the range there, gives the solve's frequencies", async () => {
    for (const sp of INDEX.spots.slice(0, 3)) {
      const rg = ranges(sp.id);
      for (const f of Object.keys(sp.flops).slice(0, 3)) {
        const e = await load(sp.id, f);
        expect(e.head.board).toBe(f);
        for (const nd of e.nodes) {
          expect(nd.strat).toHaveLength(nd.names.length);
          const w = handWeights(e, nd.path, rg)!;
          const tot = w.reduce((a, b) => a + b, 0);
          // (facing a bet after checking, the weights carry the hand's stored check frequency, in 1% steps: where
          // the range seldom checks, that rounding moves the facing range's frequencies a few points)
          const tol = nd.path.length > 1 ? (nd.combos < 5 ? 1 : 0.06) : 0.01;
          nd.names.forEach((n, a) => {
            const fq = nd.strat[a]!.reduce((s, x, j) => s + x * w[j]!, 0) / tot;
            expect(Math.abs(fq - nd.freqs[n]!), `${sp.id} ${f} ${nd.path.join("|")} ${n}`).toBeLessThan(tol);
          });
          for (let j = 0; j < w.length; j++) expect(Math.abs(nd.strat.reduce((s, r) => s + r[j]!, 0) - 1)).toBeLessThan(1e-9);
          if (nd.fold0) expect(nd.evs[0]!.every((x) => x === 0)).toBe(true);
        }
      }
    }
  });

  it("format 2: a value per suit class (two-tone: the two suits off the flop swap), the ranges' combos, the EV step", async () => {
    const sid = "srp_btn_bb";
    const rg = ranges(sid);
    const sp = INDEX.spots.find((s) => s.id === sid)!;
    expect(INDEX.format).toBe(2);
    const f = Object.keys(sp.flops).find((x) => x[1] === x[3] && x[3] !== x[5] && new Set([x[0], x[2], x[4]]).size === 3)!;
    const e = await load(sid, f);
    const board = new Set([f.slice(0, 2), f.slice(2, 4), f.slice(4, 6)].map(cardInt));
    expect(e.head.ev).toEqual([Math.round(sp.pot * 0.01 * 1e4) / 1e4, 32, 1.04]);
    // the flop's suits: one twice, one once; the two left swap
    const fs = [f[1]!, f[3]!, f[5]!].map((x) => SUITS.indexOf(x));
    const off = [0, 1, 2, 3].filter((x) => !fs.includes(x));
    const swap = (c: number) => ((c & 3) === off[0] ? c - off[0]! + off[1]! : (c & 3) === off[1] ? c - off[1]! + off[0]! : c);
    for (const p of [0, 1] as const) {
      const want = COMBOS.flatMap(([a, b], i) => (rg.w[p][i]! > 0 && !board.has(a) && !board.has(b) ? [i] : []));
      expect(e.combos[p]).toEqual(want);
    }
    let pairs = 0;
    for (const nd of e.nodes) {
      const pos = new Map(e.combos[nd.player].map((c, j) => [c, j]));
      e.combos[nd.player].forEach((ci, j) => {
        const [a, b] = COMBOS[ci]!.map(swap) as [number, number];
        const k = pos.get(COMBOS.findIndex(([x, y]) => x === Math.min(a, b) && y === Math.max(a, b)))!;
        expect(k).toBeDefined();
        if (k !== j) pairs++;
        for (const r of nd.strat) expect(r[k]).toBe(r[j]);
        for (const r of nd.evs) expect(r[k]).toBe(r[j]);
      });
    }
    expect(pairs).toBeGreaterThan(500);
  });

  it("weights a node's hands by the range entering the flop, none touching the board, times the hand's own line", async () => {
    const sid = "srp_btn_bb";
    const rg = ranges(sid);
    const e = await load(sid, "Ac4d3h");
    const board = ["Ac", "4d", "3h"].map(cardInt);
    for (const p of [[], ["check"], ["check", "bet 33%"]]) {
      const nd = nodeAt(e, p)!;
      const w = handWeights(e, p, rg)!;
      e.combos[nd.player].forEach((ci, j) => {
        if (COMBOS[ci]!.some((x) => board.includes(x))) expect(w[j]).toBe(0);
      });
    }
    const w0 = handWeights(e, [], rg)!;
    const w2 = handWeights(e, ["check", "bet 33%"], rg)!;
    const root = nodeAt(e, [])!;
    w2.forEach((x, j) => expect(Math.abs(x - w0[j]! * root.strat[0]![j]!)).toBeLessThan(1e-12));
    expect(handWeights(e, ["bet 75%", "raise to 99"], rg)).toBeNull();
  });

  it("refuses a file that isn't an entry", async () => {
    await expect(decodeEntry(new TextEncoder().encode("not an entry"))).rejects.toThrow("not a flop library entry");
  });
});
