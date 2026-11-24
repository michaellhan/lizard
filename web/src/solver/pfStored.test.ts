// The page's list of stored preflop games against the worker's: engine/pf_solve.py's grid, and a file for every one in
// engine/pf/, so the page never offers a game the worker would answer "pf_unsolved".
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stageAnte } from "@/features/tournaments/tournament";
import { PF_FORCED_BUILT } from "./pfForcedBuilt";
import {
  nearestDepth,
  PF_ANTE_DEPTHS,
  PF_ANTE_PLAYERS,
  PF_ANTE_TOL,
  PF_CHART_PLAYERS,
  PF_DEPTHS,
  PF_DEPTHS_WORDS,
  PF_FORCED_WORDS,
  PF_KEYS,
  PF_MODEL_TAG,
  PF_PLAYERS,
  PF_STRADDLE_DEPTHS,
  PF_STRADDLE_PLAYERS,
  pfChartKey,
  pfForcedOf,
  pfGameKey,
  pfGradeDepths,
  pfGradeSizes,
  pfKey,
  pfStoredAnte,
} from "./pfStored";

const ROOT = resolve(__dirname, "../../..");
const py = readFileSync(resolve(ROOT, "engine/pf_solve.py"), "utf8");
const tuple = (name: string) =>
  py
    .match(new RegExp(`^${name} = \\(([^)]*)\\)`, "m"))![1]!
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);

describe("the stored preflop games", () => {
  it("are engine/pf_solve.py's grid", () => {
    expect(tuple("STORED_PLAYERS")).toEqual([...PF_PLAYERS]);
    expect(tuple("STORED_DEPTHS")).toEqual([...PF_DEPTHS]);
    expect(py).toMatch(/^STORED_RAKES = \(None, \(0\.05, 3\.0\)\)$/m);
    expect(py).toMatch(new RegExp(`^MODEL_TAG = "${PF_MODEL_TAG}"`, "m"));
  });
  it("name their files as engine/pf_solve.Spec.key does", () => {
    expect(pfKey(6, 100, false)).toBe("lz4_6max_100bb");
    expect(pfKey(6, 100, true)).toBe("lz4_6max_100bb_r5c3");
    expect(pfKey(2, 20, false)).toBe("lz4_2max_20bb");
    expect(pfChartKey(6, 100, false)).toBe("lz4_6max_100bb_ch");
    expect(pfChartKey(6, 100, true)).toBe("lz4_6max_100bb_r5c3_ch");
    expect(pfChartKey(2, 20, false)).toBe("lz4_2max_20bb_ch");
    expect(PF_KEYS).toHaveLength((PF_PLAYERS.length + PF_CHART_PLAYERS.length) * PF_DEPTHS.length * 2 + PF_FORCED_BUILT.length);
  });
  it("store the charts' raise sizes beside the tree's, for the table sizes engine/pf_solve.py does", () => {
    expect(py).toMatch(/^def chart_sized\(spec: Spec\) -> Spec:$/m);
    expect(py).toMatch(/k \+= "_ch"/);
    expect(tuple("STORED_CHART_PLAYERS")).toEqual([...PF_CHART_PLAYERS]);
    expect(pfGradeSizes({ players: 6 })).toEqual({ pf_tree: { sizing: "chart" } });
    expect(pfGradeSizes({ players: 2 })).toEqual({ pf_tree: { sizing: "chart" } });
    expect(pfGradeSizes({ players: 7 })).toEqual({});
    expect(pfGradeSizes({ players: 6, payouts: [50, 30, 20] })).toEqual({});
  });
  it("each have a file in engine/pf/, and none is upstream's", () => {
    expect(PF_KEYS.filter((k) => !existsSync(resolve(ROOT, "engine/pf", `${k}.bin`)))).toEqual([]);
    // (one solve of a game: a name in both would fail scripts/build-solver-assets.mjs)
    expect(PF_KEYS.filter((k) => existsSync(resolve(ROOT, "solver/gto/static/pf", `${k}.bin`)))).toEqual([]);
  });
  it("hold the games with an ante or a straddle as engine/pf_solve.py's forced set", () => {
    expect(tuple("STRADDLE_PLAYERS")).toEqual([...PF_STRADDLE_PLAYERS]);
    expect(tuple("STRADDLE_DEPTHS")).toEqual([...PF_STRADDLE_DEPTHS]);
    expect(tuple("ANTE_PLAYERS")).toEqual([...PF_ANTE_PLAYERS]);
    expect(tuple("ANTE_DEPTHS")).toEqual([...PF_ANTE_DEPTHS]);
    expect(py).toMatch(/^STRADDLE_RAKES = STORED_RAKES$/m);
    expect(py).toMatch(/^ANTE_RAKES = \(None,\)$/m);
    expect(py).toContain(`FORCED_WORDS = "${PF_FORCED_WORDS}"`);
    // the ante: a 1bb big-blind ante's share to the cent, as the tournament stages send it
    expect(PF_ANTE_PLAYERS.map(pfStoredAnte)).toEqual([0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.13, 0.11]);
    expect(PF_ANTE_PLAYERS.map(pfStoredAnte)).toEqual(PF_ANTE_PLAYERS.map(stageAnte));
    // Spec.key: the ante, then the straddle, the rake and the charts' sizes
    expect(pfGameKey(6, 100, { forced: "straddle" })).toBe("lz4_6max_100bb_s");
    expect(pfGameKey(6, 100, { forced: "straddle", raked: true, chart: true })).toBe("lz4_6max_100bb_s_r5c3_ch");
    expect(pfGameKey(9, 40, { forced: "ante", chart: true })).toBe("lz4_9max_40bb_a0.11_ch");
    expect(pfGameKey(8, 25, { forced: "ante" })).toBe("lz4_8max_25bb_a0.13");
    expect(pfGameKey(6, 100, { forced: "none", raked: true })).toBe(pfKey(6, 100, true));
  });
  it("offer only the forced games whose files are in engine/pf/, each a game of the set", () => {
    const all = new Set(
      [...PF_STRADDLE_PLAYERS.flatMap((n) => PF_STRADDLE_DEPTHS.flatMap((d) => [false, true].map((r) => ({ n, d, forced: "straddle" as const, raked: r })))),
        ...PF_ANTE_PLAYERS.flatMap((n) => PF_ANTE_DEPTHS.map((d) => ({ n, d, forced: "ante" as const, raked: false })))]
        .flatMap(({ n, d, forced, raked }) => [false, true].map((chart) => pfGameKey(n, d, { forced, raked, chart }))),
    );
    expect(all.size).toBe(240);
    expect(PF_FORCED_BUILT.filter((k) => !all.has(k))).toEqual([]);
    expect(PF_FORCED_BUILT.filter((k) => !existsSync(resolve(ROOT, "engine/pf", `${k}.bin`)))).toEqual([]);
    expect(PF_KEYS).toEqual(expect.arrayContaining([...PF_FORCED_BUILT]));
    // engine/pf_forced_built.py lists the same games
    const builtPy = readFileSync(resolve(ROOT, "engine/pf_forced_built.py"), "utf8");
    expect([...builtPy.matchAll(/^ {4}"([^"]+)": \d+,$/gm)].map((m) => m[1])).toEqual([...PF_FORCED_BUILT]);
    // a depth is offered to the grade only where the game at the charts' sizes is built
    for (const n of PF_STRADDLE_PLAYERS)
      for (const raked of [false, true])
        expect(pfGradeDepths(n, "straddle", raked)).toEqual(PF_STRADDLE_DEPTHS.filter((d) => PF_FORCED_BUILT.includes(pfGameKey(n, d, { forced: "straddle", raked, chart: true }))));
    expect(pfGradeDepths(6, "none", false)).toEqual(PF_DEPTHS);
    expect(pfGradeDepths(7, "none", false)).toEqual([]);
    expect(pfGradeDepths(6, null, false)).toEqual([]);
  });
  it("read a game's forced bets: the table size's stored ante, a straddle, or neither", () => {
    expect(pfForcedOf(6, 0, false)).toBe("none");
    expect(pfForcedOf(2, 0, true)).toBe("none"); // (no straddle heads-up)
    expect(pfForcedOf(6, 0, true)).toBe("straddle");
    expect(pfForcedOf(6, 0.17, false)).toBe("ante");
    expect(pfForcedOf(6, 0.1, false)).toBeNull();
    expect(pfForcedOf(6, 0.17, true)).toBeNull();
    // (a site's averaged big-blind ante, within PF_ANTE_TOL of the stored share)
    expect(pfForcedOf(8, 0.125, false)).toBeNull();
    expect(pfForcedOf(8, 0.125, false, PF_ANTE_TOL)).toBe("ante");
    expect(pfForcedOf(9, 1 / 9, false, PF_ANTE_TOL)).toBe("ante");
    expect(pfForcedOf(6, 1 / 6, false, PF_ANTE_TOL)).toBe("ante");
    expect(pfForcedOf(9, 0.1, false, PF_ANTE_TOL)).toBeNull();
  });
  it("ask every game with an ante or a straddle at the charts' sizes for the grade, at any table size", () => {
    expect(pfGradeSizes({ players: 9, straddle: true })).toEqual({ pf_tree: { sizing: "chart" } });
    expect(pfGradeSizes({ players: 8, ante: 0.13 })).toEqual({ pf_tree: { sizing: "chart" } });
    expect(pfGradeSizes({ players: 8, ante: 0.2 })).toEqual({});
    expect(pfGradeSizes({ players: 6, straddle: true, payouts: [1] })).toEqual({});
  });
  it("are said in words, with the nearest depth to one that isn't", () => {
    expect(PF_DEPTHS_WORDS).toBe("20, 25, 30, 40, 50, 60, 80, 100, 125, 150 or 200bb");
    expect(nearestDepth(90)).toBe(80);
    expect(nearestDepth(250)).toBe(200);
    expect(nearestDepth(12)).toBe(20);
  });
});
