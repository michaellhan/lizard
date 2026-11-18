// The page's list of built tournament spots (pfIcmBuilt.json, written by scripts/pf_icm/build_stored.py index) against the
// worker's: every spot listed has its manifest entry on the same game and class equity table, its file and its KEYS line,
// and every manifest entry built on them is listed. A spot not listed is refused (pfIcmStage), so a stale file never
// grades a hand.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PF_ICM_BUILD, PF_ICM_PRESETS, PF_ICM_STORED } from "./pfIcmStored";

const ROOT = resolve(__dirname, "../../../..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "engine/pf_icm/stages.json"), "utf8")) as { name: string; key: string; model?: string; equity?: string; mbb: number }[];

describe("the built tournament spots", () => {
  it("are each in the manifest on the listed game and equity table, with its file and KEYS line", () => {
    const py = readFileSync(resolve(ROOT, "engine/pf_icm_stored.py"), "utf8");
    expect(PF_ICM_STORED).toHaveLength(PF_ICM_BUILD.built.length);
    for (const p of PF_ICM_STORED) {
      const e = manifest.find((x) => x.name === p.name);
      expect(e, p.name).toBeTruthy();
      expect([e!.model, e!.equity], p.name).toEqual([PF_ICM_BUILD.model, PF_ICM_BUILD.equity]);
      expect(existsSync(resolve(ROOT, "engine/pf_icm", `${e!.key}.bin`)), p.name).toBe(true);
      expect(py).toContain(`'${e!.key}': '${e!.name}'`);
      expect(e!.mbb, p.name).toBeLessThan(2.5);
    }
  });

  it("are every manifest entry built on the current game and equity table", () => {
    const current = manifest.filter((e) => e.model === PF_ICM_BUILD.model && e.equity === PF_ICM_BUILD.equity && existsSync(resolve(ROOT, "engine/pf_icm", `${e.key}.bin`)));
    expect(current.map((e) => e.name).sort()).toEqual(PF_ICM_STORED.map((p) => p.name).sort());
    expect(PF_ICM_BUILD.built.every((i) => i >= 0 && i < PF_ICM_PRESETS.length)).toBe(true);
  });

  it("are tagged with the game the engine builds now", () => {
    const calib = readFileSync(resolve(ROOT, "engine/pf_icm_calib.py"), "utf8");
    expect(calib).toContain(`MODEL_TAG = "${PF_ICM_BUILD.model}"`);
  });
});
