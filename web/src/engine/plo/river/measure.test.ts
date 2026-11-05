// What a solve costs, on real spots: seconds, memory and how far it got. Off by default (it's minutes of CPU, and numbers
// for docs/FEATURE_MATRIX.md, not a check). From web/, through slot.sh:
//   RIVER_MEASURE=/path/to/out.jsonl npx vitest run src/engine/plo/river/measure.test.ts
import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseIds } from "../cards";
import { parseRange, rangeSize, type PloRange } from "../ranges";
import { compileGame } from "./game";
import { memoryBytes, RiverSolver } from "./solver";

const SPOTS: { name: string; board: string; oop: string; ip: string; pot?: number; stack?: number; bets?: number[]; raises?: number[]; cap?: number; budget?: number }[] = JSON.parse(process.env.RIVER_SPOTS ?? "null") ?? [
  { name: "AAxx v KKxx, dry", board: "Qs7d2c9h3s", oop: "AAxx", ip: "KKxx" },
  { name: "double pair rundown v suited", board: "Js9s4d2h7c", oop: "AAxx,KKxx,QQxx", ip: "JT98,JT97,T987" },
];

const range = (t: string, board: number[]): PloRange => {
  const r = parseRange(t, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe.runIf(process.env.RIVER_MEASURE)("measure", () => {
  for (const s of SPOTS)
    it(s.name, { timeout: 3_600_000 }, () => {
      const board = parseIds(s.board, 5)!;
      const t0 = performance.now();
      const ranges = [range(s.oop, board), range(s.ip, board)] as const;
      const t1 = performance.now();
      const game = compileGame({ board, ranges, pot: s.pot ?? 20, stacks: [s.stack ?? 100, s.stack ?? 100], sizes: { bets: s.bets ?? [50, 100], raises: s.raises ?? [100], raiseCap: s.cap ?? 2, allIn: true } });
      const t2 = performance.now();
      const solver = new RiverSolver(game);
      const budget = (s.budget ?? 60) * 1000;
      const log: string[] = [];
      let next = 8;
      let at = performance.now();
      let solving = 0;
      for (;;) {
        solver.iterate();
        const now = performance.now();
        solving += now - at;
        at = now;
        const end = solving > budget;
        if (solver.iterations >= next || end) {
          const m = solver.measure();
          log.push(`${solver.iterations}:${m.pct.toFixed(3)}%@${(solving / 1000).toFixed(1)}s`);
          next = Math.ceil(solver.iterations * 1.5);
          at = performance.now();
          if (end || m.pct < 0.05) break;
        }
      }
      const t3 = performance.now();
      const nodes = solver.report();
      const t4 = performance.now();
      appendFileSync(
        process.env.RIVER_MEASURE!,
        JSON.stringify({
          name: s.name,
          combos: [rangeSize(ranges[0]), rangeSize(ranges[1])],
          played: [game.sides[0].n, game.sides[1].n],
          treeNodes: game.tree.nodes.length,
          terminals: game.tree.nodes.length - game.tree.actionNodes,
          actionNodes: game.tree.actionNodes,
          slots: game.tree.slots,
          sets: game.setCount,
          parseMs: Math.round(t1 - t0),
          compileMs: Math.round(t2 - t1),
          msPerIteration: +(solving / solver.iterations).toFixed(2),
          reportMs: Math.round(t4 - t3),
          nodes: nodes.length,
          memoryMB: +(memoryBytes(game) / 1e6).toFixed(1),
          arrayBuffersMB: Math.round(process.memoryUsage().arrayBuffers / 1e6),
          rssMB: Math.round(process.memoryUsage().rss / 1e6),
          log,
        }) + "\n",
      );
    });
});
