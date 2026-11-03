/// <reference types="node" />
// The all-in EV on the classic fixtures (solver/tests/data/hh): which hands have an all-in, the equity there (exact
// from the flop on, sampled preflop within its precision of the exact enumeration), and its EV.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allInOf, equityVs, shownOf } from "./allin";
import { parseHandHistory } from "./parse";

const HH_DIR = join(process.cwd(), "..", "solver", "tests", "data", "hh");
const HH = (f: string) => readFileSync(join(HH_DIR, f), "utf8");
const at = (f: string) => {
  const t = HH(f);
  return allInOf(parseHandHistory(t), t);
};
// the exact preflop equities, by enumerating all 1,712,304 boards once
const KK_V_AA = 0.18053949532326036;
const JJ_V_AK = 0.5725391052056177;

describe("all-in EV", () => {
  it("finds the heads-up all-ins with cards to come and both hands shown", () => {
    const none = ["888_6max_srp.txt", "gg_limped_multiway.txt", "gg_straddle.txt", "stars_heads_up.txt", "stars_9max_mtt_ante.txt", "stars_zoom_names.txt"];
    for (const f of none) expect(at(f), f).toBeNull();
    // the other player's cards hidden (iPoker's "X X", party's tournament balance lines)
    expect(at("ipoker_3bet_pot.xml")).toBeNull();
    expect(at("party_mtt_bounty_allin.txt")).toBeNull();
  });

  it("an all-in on the flop: every run-out", () => {
    for (const f of ["stars_run_twice.txt", "acr_run_twice.txt"]) {
      const a = at(f)!;
      expect(a, f).toMatchObject({ street: "flop", vs: "CO", cards: ["8h", "8d"], board: ["Kd", "8s", "3s"], exact: true });
      // AsKs against a set: 295 of the 990 run-outs; the pot both boards paid is 198.5bb, 100bb of it yours
      expect(a.equity).toBeCloseTo(295 / 990, 12);
      expect(a.ev).toBeCloseTo((295 / 990) * 198.5 - 100, 3);
    }
  });

  it("an all-in on the turn drawing dead is worth what it lost", () => {
    for (const f of ["stars_3bet_pot.txt", "winamax_3bet_pot.txt"]) expect(at(f), f).toMatchObject({ street: "turn", cards: ["9d", "9h"], equity: 0, exact: true, ev: -100 });
  });

  it("preflop: sampled boards, the same each time, within half a percent of the exact equity", () => {
    for (const f of ["gg_allin_preflop.txt", "party_6max_allin.txt"]) {
      const a = at(f)!;
      expect(a, f).toMatchObject({ street: "preflop", vs: "BTN", cards: ["Ad", "Ah"], board: [], exact: false });
      expect(Math.abs(a.equity - KK_V_AA)).toBeLessThan(0.0055);
      expect(at(f)).toEqual(a);
    }
    for (const f of ["ignition_mtt_allin.txt", "stars_bounty_allin.txt"]) {
      const a = at(f)!;
      expect(a, f).toMatchObject({ street: "preflop", vs: "CO", cards: ["Ac", "Kd"] });
      expect(Math.abs(a.equity - JJ_V_AK)).toBeLessThan(0.0055);
      // the pot collected (25.86bb won by CO, plus your 25bb) at your equity, less your 25bb
      expect(a.ev).toBeCloseTo(a.equity * 50.86 - 25, 3);
    }
  });

  it("reads each site's shown hands", () => {
    const t = HH("ignition_mtt_allin.txt");
    expect(shownOf(parseHandHistory(t), t)).toEqual({ CO: ["Ac", "Kd"], BB: ["Jh", "Js"] });
    const p = HH("party_6max_allin.txt");
    expect(shownOf(parseHandHistory(p), p)).toMatchObject({ BTN: ["Ad", "Ah"], SB: ["Ks", "Kh"] });
    const g = HH("gg_all_cards_shown.txt");
    expect(Object.keys(shownOf(parseHandHistory(g), g)).sort()).toEqual(["BB", "BTN", "CO", "SB"]);
  });

  it("counts a tie as half", () => {
    // (the same hand with no flush for either: a chop on every river)
    expect(equityVs(["As", "Kd"], ["Ac", "Kh"], ["2c", "7d", "9h", "Js"])).toEqual({ equity: 0.5, exact: true });
    expect(equityVs(["As", "Kd"], ["Ah", "Kc"], ["2s", "7s", "9s", "Js", "3c"])).toEqual({ equity: 1, exact: true });
    expect(equityVs(["As", "Kd"], ["Ah", "Kc"], ["2d", "7h", "9c", "Jd", "3c"])).toEqual({ equity: 0.5, exact: true });
  });
});
