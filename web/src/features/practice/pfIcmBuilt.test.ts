// The page's list of built tournament spots (pfIcmBuilt.json, written by scripts/pf_icm/build_stored.py index) against the
// worker's: every spot listed has its manifest entry on the same flop model (pf_icm.FLOP_MODEL_TAG, which names the class
// equity table and the calibration), its file and its KEYS line, and every manifest entry built on it is listed. A spot not listed is refused (pfIcmStage), so a stale file never
// grades a hand.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PF_ICM_BUILD, PF_ICM_PRESETS, PF_ICM_STORED } from "./pfIcmStored";

const ROOT = resolve(__dirname, "../../../..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "engine/pf_icm/stages.json"), "utf8")) as { name: string; key: string; set: string; model?: string; mbb: number }[];

describe("the built tournament spots", () => {
  it("are each in the manifest on the listed flop model, with its file and KEYS line", () => {
    const py = readFileSync(resolve(ROOT, "engine/pf_icm_stored.py"), "utf8");
    expect(PF_ICM_STORED).toHaveLength(PF_ICM_BUILD.built.length);
    for (const p of PF_ICM_STORED) {
      const e = manifest.find((x) => x.name === p.name);
      expect(e, p.name).toBeTruthy();
      expect(e!.model, p.name).toBe(PF_ICM_BUILD.model);
      expect(existsSync(resolve(ROOT, "engine/pf_icm", `${e!.key}.bin`)), p.name).toBe(true);
      expect(py).toContain(`'${e!.key}': '${e!.name}'`);
      // (the 3-way pot's floor, docs/ACCURACY.md 20.3 and 20.7: under 4 mbb in prize equity; in chips and with bounties a
      // short big blind's side pots raise it to 14.5, a hundredth of a bb a hand, inside grading's noise of 5% of the pot)
      expect(e!.mbb, p.name).toBeLessThan(e!.set === "chips" || e!.set === "bounty" ? 15 : 4);
    }
  });

  it("are every manifest entry built on the current flop model", () => {
    const current = manifest.filter((e) => e.model === PF_ICM_BUILD.model && existsSync(resolve(ROOT, "engine/pf_icm", `${e.key}.bin`)));
    expect(current.map((e) => e.name).sort()).toEqual(PF_ICM_STORED.map((p) => p.name).sort());
    expect(PF_ICM_BUILD.built.every((i) => i >= 0 && i < PF_ICM_PRESETS.length)).toBe(true);
  });

  it("are tagged with the flop model the engine builds on now", () => {
    const icm = readFileSync(resolve(ROOT, "engine/pf_icm.py"), "utf8");
    expect(icm).toContain(`FLOP_MODEL_TAG = "${PF_ICM_BUILD.model}" if model_digest() == MODEL_DIGEST`);
  });
});
