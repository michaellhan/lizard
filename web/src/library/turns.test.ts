// @vitest-environment node
// Decoding the library's turn files, on real files of the solver snapshot's library (src/test/library.ts): a format-1
// file (a single-raised pot, strategies only) and a format-2 one (a 3-bet pot, with the class's EVs).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { libFile, libJson } from "@/test/library";
import type { LibraryIndex } from "./catalog";
import { storedTurnFlops } from "./catalog";
import { cardInt, COMBOS, flopCards } from "./entry";
import { LibraryFiles } from "./files";
import { decodeTurns } from "./turns";

const load = (sid: string, f: string) => decodeTurns(libFile(`${sid}/${f}.turn.bin`));
const INDEX = libJson<LibraryIndex>("index.json");
const fetchFixture = (over: (path: string) => Uint8Array | null = () => null) =>
  (async (url: string) => {
    const path = String(url).replace(/^lib\//, "").split("?")[0]!;
    return new Response((over(path) ?? new Uint8Array(libFile(path))) as BodyInit);
  }) as unknown as typeof fetch;

describe("turn files", () => {
  it.each([
    ["srp_btn_bb", "Ac4d3h", 1],
    ["srp_btn_bb", "9c8c7c", 1],
    ["3bp_bb_btn", "3c2d2c", 2],
  ])("%s %s: format %i decodes to the byte", async (sid, f, format) => {
    const t = await load(sid, f); // (parseTurns refuses a body that doesn't end where the header says)
    expect(t.head.format).toBe(format);
    expect(t.head.board).toBe(f);
    expect(t.head.q).toBe(20);
    const flop = flopCards(f).map(cardInt);
    // the classes share out the cards off the flop, each with its played card in it
    const cards = t.head.classes.flatMap(([, cs]) => cs.match(/../g)!.map(cardInt));
    expect(new Set(cards).size).toBe(49);
    expect(cards.some((c) => flop.includes(c))).toBe(false);
    t.head.classes.forEach(([p, cs], k) => {
      expect(cs).toContain(p);
      expect(t.sizes[k]).toBe(cs.length / 2);
    });
    expect(t.lines.length).toBeGreaterThan(0);
    for (const ln of t.lines) {
      expect(ln.pot).toBeGreaterThan(0);
      for (const nd of ln.nodes) {
        expect(nd.at.length ? [["check"], 1] : [[], 0]).toEqual([nd.at, nd.player]);
        expect(nd.classes).toHaveLength(t.played.length);
        nd.classes.forEach((cls, k) => {
          expect(cls.strat).toHaveLength(nd.names.length);
          expect([...cls.combos].sort((a, b) => a - b)).toEqual(cls.combos);
          cls.combos.forEach((ci, j) => {
            const [a, b] = COMBOS[ci]!;
            for (const c of [...flop, t.played[k]!]) expect(a !== c && b !== c, "off the flop and the turn").toBe(true);
            const sum = cls.strat.reduce((s, r) => s + r[j]!, 0);
            expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
            // (5% steps)
            for (const r of cls.strat) expect(Math.abs(r[j]! * 20 - Math.round(r[j]! * 20))).toBeLessThan(1e-9);
          });
        });
        if (format === 1) expect(nd.evs).toBeNull();
        else {
          expect(nd.evs).toHaveLength(t.played.length);
          for (const row of nd.evs!) expect(row).toHaveLength(nd.names.length);
        }
      }
    }
  });

  it("the format-2 EVs are in big blinds, about the size of the pot", async () => {
    const t = await load("3bp_bb_btn", "3c2d2c");
    const evs = t.lines.flatMap((ln) => ln.nodes.flatMap((nd) => nd.evs!.flat().flatMap((x) => (x === null ? [] : [x / ln.pot]))));
    expect(evs.length).toBeGreaterThan(50);
    for (const x of evs) expect(Math.abs(x)).toBeLessThan(5);
  });

  it("names the flops a spot stores turn files for: all, a list, or none", () => {
    const of = (id: string) => INDEX.spots.find((s) => s.id === id)!;
    expect(storedTurnFlops(of("srp_btn_bb"))).toHaveLength(7);
    expect(storedTurnFlops(of("3bp_bb_btn"))).toEqual(["2h2d2c", "3c2d2c"]);
    expect(storedTurnFlops(of("srp_co_bb"))).toEqual([]);
    expect(storedTurnFlops({ turns: true, flops: { Ac4d3h: "x", Kc7d2h: "y" } })).toEqual(["Ac4d3h", "Kc7d2h"]);
    // (a listed flop whose entry isn't in the index isn't drawn)
    expect(storedTurnFlops({ turns: ["Ac4d3h"], flops: { Kc7d2h: "y" } })).toEqual([]);
  });

  it("is the turn file of the entry the index lists: its header names the entry's hash", async () => {
    const sp = INDEX.spots.find((s) => s.id === "srp_btn_bb")!;
    const entry = libFile(`srp_btn_bb/Ac4d3h.bin`);
    const t = await new LibraryFiles("lib/", fetchFixture()).turns(sp, "Ac4d3h");
    expect(t.head.entry).toBe(createHash("sha1").update(entry).digest("hex").slice(0, 12));
    expect(t.head.entry.startsWith(sp.flops.Ac4d3h!)).toBe(true);
    // another entry's file (the index moved on), or another flop's, isn't read
    const moved = { ...sp, flops: { ...sp.flops, Ac4d3h: "0000000000" } };
    await expect(new LibraryFiles("lib/", fetchFixture()).turns(moved, "Ac4d3h")).rejects.toThrow("isn't its entry's");
    const other = new LibraryFiles("lib/", fetchFixture((p) => (p.endsWith("Ac4d3h.turn.bin") ? new Uint8Array(libFile("srp_btn_bb/9c8c7c.turn.bin")) : null)));
    await expect(other.turns(sp, "Ac4d3h")).rejects.toThrow("isn't its entry's");
  });

  it("refuses a file that isn't one, and one whose body doesn't fit", async () => {
    await expect(decodeTurns(new TextEncoder().encode("not a turn file"))).rejects.toThrow("not a turn file");
    await expect(decodeTurns(libFile("srp_btn_bb/Ac4d3h.bin"))).rejects.toThrow("not a turn file");
  });
});
