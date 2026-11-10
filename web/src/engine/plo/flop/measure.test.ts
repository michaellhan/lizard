// What a flop solve costs, on real spots: units of work, compile time, ms an iteration, memory and how far it got. Off by
// default (minutes of CPU, numbers for run.ts MAX_FLOP_WORK and docs/FEATURE_MATRIX.md, not a check). From web/, through
// slot.sh:
//   FLOP_MEASURE=/path/to/out.jsonl npx vitest run src/engine/plo/flop/measure.test.ts
import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseIds } from "../cards";
import { parseRange, type PloRange } from "../ranges";
import type { RiverSizes } from "../river/tree";
import { compileFlop } from "./game";
import { FlopSolver, flopMemoryBytes, flopWork } from "./solver";

const ONE: RiverSizes = { bets: [75], raises: [], raiseCap: 0, allIn: true };
const SPOTS: { name: string; board: string; oop: string; ip: string; budget?: number }[] = JSON.parse(process.env.FLOP_SPOTS ?? "null") ?? [
  { name: "AAxx double-suited v JT98", board: "Js9s4d", oop: "AAxxds", ip: "JT98" },
  { name: "AAKK v rundowns", board: "Js9s4d", oop: "AAKK", ip: "JT98,T987" },
];

const range = (t: string, board: number[]): PloRange => {
  const r = parseRange(t, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe.runIf(process.env.FLOP_MEASURE)("measure", () => {
  for (const s of SPOTS)
    it(s.name, { timeout: 3_600_000 }, () => {
      const board = parseIds(s.board, 3)!;
      const t0 = performance.now();
      const game = compileFlop({ board, ranges: [range(s.oop, board), range(s.ip, board)], pot: 10, stacks: [100, 100], flopSizes: ONE, turnSizes: ONE, riverSizes: ONE });
      const t1 = performance.now();
      const work = flopWork(game);
      const solver = new FlopSolver(game);
      const t2 = performance.now();
      const budget = (s.budget ?? 60) * 1000;
      let solving = 0;
      let pct = Infinity;
      while (solving < budget && pct > 0.1) {
        const at = performance.now();
        for (let i = 0; i < 5; i++) solver.iterate();
        solving += performance.now() - at;
        pct = solver.measure().pct;
      }
      const row = {
        name: s.name,
        combos: [game.sides[0].n, game.sides[1].n],
        turns: game.turns.length,
        work,
        compileMs: Math.round(t1 - t0),
        setupMs: Math.round(t2 - t1),
        iterations: solver.iterations,
        msPerIteration: Math.round(solving / solver.iterations),
        nsPerUnit: Math.round((solving / solver.iterations / work) * 1e6),
        pct,
        boundMB: Math.round(flopMemoryBytes(game) / 1e6),
        rssMB: Math.round(process.memoryUsage().rss / 1e6),
      };
      appendFileSync(process.env.FLOP_MEASURE!, JSON.stringify(row) + "\n");
    });
});
