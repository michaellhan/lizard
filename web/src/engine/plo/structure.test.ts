import { describe, expect, it } from "vitest";
import { parseIds } from "./cards";
import { handIndex, NUM_HANDS, sortHand } from "./combos";
import { cellCounts, cellLabel, PLO_STRUCTURE_GRID, STRUCTURE_ROWS, structureCells, structureOf, SUIT_COLUMNS } from "./structure";

const at = (text: string) => {
  const s = structureOf(parseIds(text, 4)!);
  return `${STRUCTURE_ROWS[s.row]} / ${SUIT_COLUMNS[s.col]}`;
};
const idx = (text: string) => handIndex(sortHand(parseIds(text, 4)!));

describe("PLO hand structure", () => {
  it("puts hands where a player would", () => {
    expect(at("AsAhKsKh")).toBe("Two pair / Double-suited");
    expect(at("AsAhJsTc")).toBe("AA / Single-suited");
    expect(at("KsKdQh2c")).toBe("KK / Rainbow");
    expect(at("JsJh5d4c")).toBe("JJ–TT / Rainbow");
    expect(at("7s7h6d5c")).toBe("99–66 / Rainbow");
    expect(at("JsTs9h8h")).toBe("Rundown / Double-suited");
    expect(at("As2s3h4d")).toBe("Rundown / Single-suited"); // the ace low
    expect(at("JsTs9h7h")).toBe("One gap / Double-suited");
    expect(at("AsKsQhTd")).toBe("One gap / Single-suited");
    expect(at("JsTs8h6h")).toBe("Two gaps / Double-suited");
    expect(at("AsJsTh9d")).toBe("Two gaps / Single-suited");
    expect(at("AsTs9h8d")).toBe("Three connected / Single-suited");
    expect(at("AsKs7h2d")).toBe("Ace and three / Single-suited");
    expect(at("Ks9s5h2d")).toBe("Other / Single-suited");
    expect(at("AsAhAdKc")).toBe("Trips or quads / Rainbow");
    expect(at("AsKsQsJs")).toBe("Rundown / Four of a suit");
    expect(at("AsKsQs2h")).toBe("Three connected / Three of a suit");
  });

  it("counts every hand once, the columns and rows to their combinatorics", () => {
    const c = cellCounts();
    expect(c.reduce((t, n) => t + n, 0)).toBe(NUM_HANDS);
    const col = (k: number) => STRUCTURE_ROWS.reduce((t, _, r) => t + c[r * SUIT_COLUMNS.length + k]!, 0);
    const row = (r: number) => SUIT_COLUMNS.reduce((t, _, k) => t + c[r * SUIT_COLUMNS.length + k]!, 0);
    expect(col(0)).toBe(6 * 78 * 78); // two suits, two ranks each
    expect(col(2)).toBe(13 ** 4);
    expect(col(3)).toBe(4 * 286 * 39);
    expect(col(4)).toBe(4 * 715);
    expect(col(1)).toBe(4 * 78 * 3 * 169);
    expect(row(0)).toBe(13 * 4 * 48 + 13);
    expect(row(1)).toBe(78 * 36);
    expect(row(2)).toBe(6 * (1128 - 72));
    expect(row(8)).toBe(11 * 256); // AKQJ down to 5432, and A234
    // paired hands can't be four of a suit
    for (let r = 0; r <= 7; r++) expect(c[r * SUIT_COLUMNS.length + 4]).toBe(0);
  });

  it("lays a range and a strategy over the grid by weight", () => {
    const hands = Int32Array.from(["AsAhKsKh", "AdAcKdKc", "JsTs9h8h", "Ks9s5h2d"].map(idx));
    const weight = [1, 1, 2, 0];
    // two actions: the aces always the first, the rundown half and half
    const strategy = Float32Array.from([1, 1, 0.5, 0, 0, 0, 0.5, 1]);
    const ev = Float32Array.from([10, 12, 3, Number.NaN]);
    const cells = structureCells(hands, weight, { actions: 2, strategy, ev });
    expect(cells.map((x) => cellLabel(x.row, x.col))).toEqual(["Two pair ds", "Rundown ds"]);
    const [aces, run] = cells;
    expect(aces!.share).toBeCloseTo(0.5);
    expect(aces!.members).toEqual([0, 1]);
    expect(aces!.frequency).toEqual([1, 0]);
    expect(aces!.ev).toBeCloseTo(11);
    expect(run!.frequency).toEqual([0.5, 0.5]);
    expect(run!.ev).toBeCloseTo(3);
    expect(structureCells(hands, weight)[0]!.frequency).toEqual([]);
  });

  it("serves as the registry's class grid", () => {
    const g = PLO_STRUCTURE_GRID;
    expect(g.rows * g.cols).toBe(STRUCTURE_ROWS.length * SUIT_COLUMNS.length);
    expect(g.classOf("JhTh9c8c")).toBe("Rundown ds");
    expect(g.combos("Rundown ds")).toBe(g.expand("Rundown ds").length);
    expect(g.expand("Rundown ds")).toContain("8c9cThJh");
    expect(() => g.classOf("AsKs")).toThrow();
  });
});
