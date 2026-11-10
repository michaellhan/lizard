// The page's list of stored preflop games against the worker's: engine/pf_stored.py's grid, upstream's two, and a file
// for every one, so the page never offers a game the worker would answer "pf_unsolved".
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nearestDepth, PF_DEPTHS, PF_DEPTHS_WORDS, PF_KEYS, PF_PLAYERS, pfKey } from "./pfStored";

const ROOT = resolve(__dirname, "../../..");
const py = readFileSync(resolve(ROOT, "engine/pf_stored.py"), "utf8");
const tuple = (name: string) =>
  py
    .match(new RegExp(`^${name} = \\(([^)]*)\\)`, "m"))![1]!
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);

describe("the stored preflop games", () => {
  it("are engine/pf_stored.py's grid", () => {
    expect(tuple("PLAYERS")).toEqual([...PF_PLAYERS]);
    expect(tuple("DEPTHS")).toEqual([...PF_DEPTHS]);
    expect(py).toMatch(/^RAKES = \(None, \(0\.05, 3\.0\)\)$/m);
  });
  it("name their files as pf_study.Spec.key does", () => {
    expect(pfKey(6, 100, false)).toBe("6max_100bb");
    expect(pfKey(6, 100, true)).toBe("6max_100bb_r5c3");
    expect(pfKey(2, 20, false)).toBe("2max_20bb");
    expect(PF_KEYS).toHaveLength(PF_PLAYERS.length * PF_DEPTHS.length * 2);
  });
  it("each have a file: upstream's two in solver/, the rest in engine/pf/", () => {
    const missing = PF_KEYS.filter((k) => !existsSync(resolve(ROOT, "engine/pf", `${k}.bin`)) && !existsSync(resolve(ROOT, "solver/gto/static/pf", `${k}.bin`)));
    expect(missing).toEqual([]);
    // (one solve of a game: a name in both would fail scripts/build-solver-assets.mjs)
    expect(PF_KEYS.filter((k) => existsSync(resolve(ROOT, "engine/pf", `${k}.bin`)) && existsSync(resolve(ROOT, "solver/gto/static/pf", `${k}.bin`)))).toEqual([]);
  });
  it("are said in words, with the nearest depth to one that isn't", () => {
    expect(PF_DEPTHS_WORDS).toBe("20, 25, 30, 40, 50, 60, 80, 100, 125, 150 or 200bb");
    expect(nearestDepth(90)).toBe(80);
    expect(nearestDepth(250)).toBe(200);
    expect(nearestDepth(12)).toBe(20);
  });
});
