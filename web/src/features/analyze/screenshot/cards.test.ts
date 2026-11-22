// @vitest-environment node
// The card reader's floor on the committed synthetic tables (scripts/screenshot/make-fixtures.mjs: drawn by Lizard,
// not taken from a poker room). Held-out tables use fonts and suit shapes the templates weren't made from.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanCards } from "./cards";
import { similarity, toGrid, GRID_H, GRID_W, encodeGrid, decodeGrid } from "./glyph";
import { hueOf } from "./image";
import { readTable } from "./read";
import { FIXTURES, readPng, truthOf } from "./testPng";

const tables = truthOf(FIXTURES);
const reads = tables.map((t) => {
  const img = readPng(join(FIXTURES, t.file));
  const scan = scanCards(img);
  return { t, scan, r: readTable(img, scan, []) };
});
const pairs = (s: string) => s.match(/../g) ?? [];

describe("card reader on the synthetic tables", () => {
  it("has the set it measures", () => {
    expect(tables.length).toBe(12);
    expect(tables.filter((t) => t.heldOut).length).toBe(4);
  });
  it("reads every board", () => {
    for (const { t, r } of reads) expect(r.groups.board.map((c) => c.code).join(""), t.file).toBe(t.board);
  });
  it("reads every hand in the templates' fonts", () => {
    for (const { t, r } of reads.filter((x) => !x.t.heldOut)) expect(r.hero?.cards.map((c) => c.code).join(""), t.file).toBe(t.hero);
  });
  it("reads most hole cards in fonts it wasn't made from", () => {
    const held = reads.filter((x) => x.t.heldOut);
    const right = held.reduce((n, { t, r }) => n + pairs(t.hero).filter((c) => r.hero?.cards.some((h) => h.code === c)).length, 0);
    expect(right).toBeGreaterThanOrEqual(5);
  });
  it("finds the dealer button on every table", () => {
    for (const { t, scan } of reads) expect(scan.dealer, t.file).not.toBeNull();
  });
  it("marks every card it reads wrong to check, not as read", () => {
    for (const { t, r } of reads)
      for (const c of [...(r.hero?.cards ?? []), ...r.groups.board]) if (!(t.hero + t.board).includes(c.code)) expect(c.conf, `${t.file} ${c.code}`).toBeLessThan(0.6);
  });
  // (every style but classic draws a four-colour deck: big-index too)
  it("tells a four-colour deck where a diamond or a club shows (blue or green)", () => {
    for (const { t, scan } of reads) expect(scan.fourColour, t.file).toBe(t.style !== "classic" && /[dc]/.test(pairs(t.hero + t.board).map((c) => c[1]).join("")));
  });
});

describe("glyph grids", () => {
  it("round-trip through their encoding and match themselves", () => {
    const cov = new Float32Array(24 * 32).map((_, i) => ((i % 24) > 8 && (i % 24) < 16 ? 1 : 0));
    const g = toGrid(cov, 24, { x: 0, y: 0, w: 24, h: 32 });
    expect(g).toHaveLength(GRID_W * GRID_H);
    const back = decodeGrid(encodeGrid(g));
    expect(similarity(g, back)).toBeGreaterThan(0.99);
  });
  it("names colours as the suits use them", () => {
    expect(hueOf(200, 20, 40)).toBe("red");
    expect(hueOf(20, 140, 40)).toBe("green");
    expect(hueOf(30, 60, 200)).toBe("blue");
    expect(hueOf(20, 20, 24)).toBe("dark");
    expect(hueOf(240, 240, 236)).toBe("light");
  });
});
