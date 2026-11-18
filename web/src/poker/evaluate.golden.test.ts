/// <reference types="node" />
// rank7 against treys, an independent evaluator: 10,000 pairs of hands on one board (random deals, deals rich in
// flushes and straights, and the edge cases: wheels, the board playing, counterfeits, kickers), each with who wins and
// each hand's class as treys has them. The file is made by scripts/poker/make_eval_golden.py, so no Python runs here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cmp, rank7 } from "./evaluate";

const cards = (s: string) => s.match(/../g)!;
// (treys' classes: 0 royal flush, 1 straight flush ... 9 high card; rank7's categories: 8 straight flush ... 0 high card)
const category = (treys: number) => (treys <= 1 ? 8 : 9 - treys);

describe("the hand evaluator against treys", () => {
  it("agrees on every pair of the golden file: who wins and each hand's class", () => {
    const rows = readFileSync(join(process.cwd(), "src", "poker", "evaluate.golden.txt"), "utf8").trim().split("\n");
    expect(rows.length).toBe(10000);
    const wrong: string[] = [];
    for (const row of rows) {
      const [board, a, b, win, ka, kb] = row.split(" ");
      const va = rank7([...cards(a!), ...cards(board!)]);
      const vb = rank7([...cards(b!), ...cards(board!)]);
      if (Math.sign(cmp(va, vb)) !== Number(win) || va[0] !== category(Number(ka)) || vb[0] !== category(Number(kb))) wrong.push(row);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
