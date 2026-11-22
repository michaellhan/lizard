// How far a flop solved on a sample of the turn and river cards (../sample.ts) is from the full game. Off by default
// (many minutes of CPU: numbers for docs/ACCURACY.md section 15 and the PLO4 row, not a check). From web/, through slot.sh:
//   SAMPLE_MEASURE=/path/to/out.jsonl npx vitest run src/engine/plo/flop/sample.measure.test.ts
//
// On spots small enough to solve on every card ("gap"):
//  - the full solve, to its target or budget: its exploitability, OOP's value and the flop's first decision;
//  - each sample: its own exploitability (in the sampled game), time and memory; then the measure that matters, its flop
//    strategy put into a full solve and held there while every turn and river is solved under it ("frozen"), and the full
//    game's exploitability of that: what the flop strategy gives away in the real game when every later street is played
//    well. Beside it, how far the flop's first decision moved (half the summed difference in action frequencies, over the
//    combos by their weight) and OOP's value.
// On spots too wide for every card ("wide"): two samples of the same size, picked half a stretch apart, each solved; how
// far apart their first decisions and values are is the noise a sample adds where the full game can't be had.
import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseIds } from "../cards";
import { parseRange, type PloRange } from "../ranges";
import type { RiverSizes } from "../river/tree";
import { compileFlop, type FlopSpec } from "./game";
import { FlopSolver, flopMemoryBytes, flopWork } from "./solver";

const ONE: RiverSizes = { bets: [75], raises: [], raiseCap: 0, allIn: true };
const OUT = process.env.SAMPLE_MEASURE;
const SAMPLES: [number, number][] = JSON.parse(process.env.SAMPLE_SIZES ?? "null") ?? [
  [24, 24],
  [16, 16],
  [12, 12],
  [9, 9],
];
const GAP: { name: string; board: string; oop: string; ip: string }[] = JSON.parse(process.env.SAMPLE_GAP ?? "null") ?? [
  { name: "AAKK v JT98, Js9s4d", board: "Js9s4d", oop: "AAKK", ip: "JT98" },
  { name: "KKxx ds v QJT9, Kh8d3c", board: "Kh8d3c", oop: "KKxxds", ip: "QJT9" },
];
const WIDE: { name: string; board: string; oop: string; ip: string; samples: [number, number] }[] = JSON.parse(process.env.SAMPLE_WIDE ?? "null") ?? [
  { name: "AAxx,KKxx v JT98,T987,9876, Js9s4d", board: "Js9s4d", oop: "AAxx,KKxx", ip: "JT98,T987,9876", samples: [12, 12] },
  { name: "AAxx v KQJT,QJT9,JT98 ds or ss, Ts7h2h", board: "Ts7h2h", oop: "AAxx", ip: "KQJTds,QJT9ds,JT98ds,KQJTss,QJT9ss,JT98ss", samples: [12, 12] },
];
const TARGET = Number(process.env.SAMPLE_TARGET ?? 0.05);
const BUDGET_S = Number(process.env.SAMPLE_BUDGET ?? 240);

const range = (t: string, board: number[]): PloRange => {
  const r = parseRange(t, board);
  if (typeof r === "string") throw new Error(r);
  return r;
};

function specOf(s: { board: string; oop: string; ip: string }): FlopSpec {
  const board = parseIds(s.board, 3)!;
  return { board, ranges: [range(s.oop, board), range(s.ip, board)], pot: 10, stacks: [100, 100], flopSizes: ONE, turnSizes: ONE, riverSizes: ONE };
}

/** Solves to the target or the budget; ms an iteration and the measure. */
function run(solver: FlopSolver, budgetS = BUDGET_S) {
  let solving = 0;
  let m = solver.measure();
  while (solving < budgetS * 1000 && m.pct > TARGET) {
    const at = performance.now();
    for (let i = 0; i < 5; i++) solver.iterate();
    solving += performance.now() - at;
    m = solver.measure();
  }
  return { m, iterations: solver.iterations, msPerIteration: Math.round(solving / Math.max(1, solver.iterations)), seconds: Math.round(solving / 100) / 10 };
}

/** The flop's first decision: each combo's frequencies, and its weight. */
function rootOf(solver: FlopSolver) {
  const report = solver.report().find((n) => n.id === 0)!;
  return { strategy: report.strategy, weight: report.weight, frequency: report.frequency };
}

/** Half the summed difference in frequencies, combo by combo, over the combos by weight. */
function distance(a: ReturnType<typeof rootOf>, b: ReturnType<typeof rootOf>): number {
  const n = a.weight.length;
  const actions = a.strategy.length / n;
  let off = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < actions; k++) d += Math.abs(a.strategy[k * n + i]! - b.strategy[k * n + i]!);
    off += (a.weight[i]! * d) / 2;
    total += a.weight[i]!;
  }
  return off / total;
}

const write = (row: object) => appendFileSync(OUT!, JSON.stringify(row) + "\n");
const mb = () => Math.round(process.memoryUsage().rss / 1e6);

describe.runIf(OUT)("a sample's gap", () => {
  for (const s of GAP)
    it(s.name, { timeout: 6 * 3_600_000 }, () => {
      const spec = specOf(s);
      // each solver lives in a function of its own, so it can be collected before the next is built
      const { fullWork, fr, fullRoot } = (() => {
        const full = new FlopSolver(compileFlop(spec));
        const fullWork = flopWork(full.game);
        const fr = run(full);
        const fullRoot = rootOf(full);
        write({ kind: "full", name: s.name, combos: [full.game.sides[0].n, full.game.sides[1].n], work: fullWork, boundMB: Math.round(flopMemoryBytes(full.game) / 1e6), rssMB: mb(), iterations: fr.iterations, msPerIteration: fr.msPerIteration, seconds: fr.seconds, pct: fr.m.pct, value: fr.m.value, rootFrequency: fullRoot.frequency });
        return { fullWork, fr, fullRoot };
      })();
      for (const [turns, rivers] of SAMPLES) {
        const { work, sr, root, held, error } = (() => {
          const sampled = new FlopSolver(compileFlop({ ...spec, turnSample: turns, riverSample: rivers }));
          const sr = run(sampled);
          // its flop strategy, held in a full solve while every turn and river is solved under it
          const held = new Map<number, Float32Array>();
          for (const n of sampled.report()) held.set(n.id, n.strategy);
          return { work: flopWork(sampled.game), sr, root: rootOf(sampled), held, error: sampled.game.sample!.error };
        })();
        const frozen = new FlopSolver(compileFlop(spec));
        frozen.setAverage((node) => held.get(node.id)!);
        frozen.frozen = true;
        const zr = run(frozen);
        write({
          kind: "sample",
          name: s.name,
          turns,
          rivers,
          work,
          workShare: work / fullWork,
          weightError: error,
          iterations: sr.iterations,
          msPerIteration: sr.msPerIteration,
          seconds: sr.seconds,
          sampledPct: sr.m.pct,
          sampledValue: sr.m.value,
          rootFrequency: root.frequency,
          rootDistance: distance(root, fullRoot),
          frozenIterations: zr.iterations,
          fullGamePct: zr.m.pct,
          fullGameValue: zr.m.value,
          fullSolvePct: fr.m.pct,
          rssMB: mb(),
        });
      }
    });

  for (const s of WIDE)
    it(s.name, { timeout: 6 * 3_600_000 }, () => {
      const spec = specOf(s);
      const full = compileFlop(spec);
      const fullWork = flopWork(full);
      const fullBound = flopMemoryBytes(full);
      const roots: ReturnType<typeof rootOf>[] = [];
      const values: number[] = [];
      for (const phase of [0.5, 0.0]) {
        const solver = new FlopSolver(compileFlop({ ...spec, turnSample: s.samples[0], riverSample: s.samples[1], samplePhase: phase }));
        const r = run(solver);
        roots.push(rootOf(solver));
        values.push(r.m.value);
        write({
          kind: "wide",
          name: s.name,
          phase,
          turns: s.samples[0],
          rivers: s.samples[1],
          combos: [solver.game.sides[0].n, solver.game.sides[1].n],
          fullWork,
          fullBoundMB: Math.round(fullBound / 1e6),
          work: flopWork(solver.game),
          boundMB: Math.round(flopMemoryBytes(solver.game) / 1e6),
          weightError: solver.game.sample!.error,
          iterations: r.iterations,
          msPerIteration: r.msPerIteration,
          seconds: r.seconds,
          sampledPct: r.m.pct,
          value: r.m.value,
          rootFrequency: roots.at(-1)!.frequency,
          rssMB: mb(),
        });
      }
      write({ kind: "wide-noise", name: s.name, rootDistance: distance(roots[0]!, roots[1]!), valueGap: Math.abs(values[0]! - values[1]!) });
    });
});
