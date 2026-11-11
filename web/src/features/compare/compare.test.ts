// The diff of two Study answers: zero against itself, every action either side offers, per class the change in one
// action's frequency and in its EV, the biggest changes first, noise within the two sides' distance from equilibrium,
// and a warning first whenever the sources differ or either is approximate.
import { describe, expect, it } from "vitest";
import { freshHand, type StudyHand } from "@/features/study/studyState";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";
import { ANY_RAISE, biggest, diffActions, diffClasses, menusOf, menuWords, noiseBb, nodeWarning, sizesOnly, sourceWarning, totalsOf, whatDiffers } from "./compare";

const A: AdvisorResponse = {
  study: "node",
  street: "flop",
  actor: "BB",
  pot_bb: 10,
  range_combos: 400,
  range_ev_bb: 3.2,
  range_eq: 0.48,
  actions: [
    { action: "check", freq: 0.7, combos: 280, ev_bb: 3.0 },
    { action: "bet 33%", freq: 0.3, combos: 120, ev_bb: 3.6 },
  ],
  grid: {
    actions: ["check", "bet 33%"],
    cells: {
      AA: { w: 1, f: [0.2, 0.8], evm: 9 },
      KQs: { w: 1, f: [0.6, 0.4], evm: 4 },
      "72o": { w: 0.5, f: [1, 0], evm: 0.5 },
    },
  },
};
// B: a bigger bet instead of 33%, AA bets more, 72o left the range, T9s joined it
const B: AdvisorResponse = {
  ...A,
  range_combos: 380,
  range_ev_bb: 3.0,
  range_eq: 0.5,
  actions: [
    { action: "check", freq: 0.75, combos: 285, ev_bb: 2.9 },
    { action: "bet 75%", freq: 0.25, combos: 95, ev_bb: 3.4 },
  ],
  grid: {
    actions: ["check", "bet 75%"],
    cells: {
      AA: { w: 1, f: [0.1, 0.9], evm: 9.4 },
      KQs: { w: 1, f: [0.6, 0.4], evm: 3.9 },
      T9s: { w: 1, f: [0.5, 0.5], evm: 2 },
    },
  },
};

const prov = (o: Partial<Provenance>): Provenance => ({
  source: "live",
  approximate: false,
  mode: "fast",
  transport: "worker",
  solverVersion: "t",
  partial: false,
  receivedAt: 0,
  ...o,
});

describe("comparing two answers", () => {
  it("is zero everywhere against itself", () => {
    expect(diffActions(A, A).map((d) => [d.dFreq, d.dEv])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    for (const action of ["check", "bet 33%"]) {
      const d = diffClasses(A, A, action);
      expect(d.every((c) => c.dFreq === 0 && c.dEv === 0)).toBe(true);
      expect(biggest(d)).toEqual([]);
    }
    const t = totalsOf(A, A);
    expect(t.combos[1]! - t.combos[0]!).toBe(0);
  });

  it("lists every action either side offers, one not offered counting as never taken", () => {
    const d = diffActions(A, B);
    expect(d.map((x) => x.action)).toEqual(["check", "bet 33%", "bet 75%"]);
    expect(d[0]!.dFreq).toBeCloseTo(0.05);
    expect(d[0]!.dEv).toBeCloseTo(-0.1);
    expect(d[1]).toMatchObject({ dFreq: -0.3, dEv: null });
    expect(d[2]).toMatchObject({ dFreq: 0.25, dEv: null });
    expect(totalsOf(A, B)).toEqual({ combos: [400, 380], ev: [3.2, 3.0], eq: [0.48, 0.5] });
  });

  it("changes per class: in both ranges a difference, in one only none, biggest first", () => {
    const check = diffClasses(A, B, "check");
    const by = Object.fromEntries(check.map((c) => [c.cls, c]));
    expect(by.AA!.dFreq).toBeCloseTo(-0.1);
    expect(by.AA!.dEv).toBeCloseTo(0.4);
    expect(by.KQs!.dFreq).toBe(0);
    expect(by["72o"]).toMatchObject({ wa: 0.5, wb: 0, fa: 1, fb: null, dFreq: null, evb: null, dEv: null });
    expect(by.T9s).toMatchObject({ wa: 0, wb: 1, fa: null, fb: 0.5, dFreq: null });
    expect(biggest(check).map((c) => c.cls)).toEqual(["AA"]);
    // an action B doesn't offer: every class in both ranges drops to 0
    const small = Object.fromEntries(diffClasses(A, B, "bet 33%").map((c) => [c.cls, c.dFreq]));
    expect(small).toMatchObject({ AA: -0.8, KQs: -0.4 });
    expect(biggest(diffClasses(A, B, "bet 33%"), 1).map((c) => c.cls)).toEqual(["AA"]);
  });

  it("calls an EV difference within both sides' distance from equilibrium noise, where both are measured", () => {
    expect(noiseBb(prov({ exploitabilityPct: 0.3 }), prov({ exploitabilityPct: 0.2 }), 10)).toBeCloseTo(0.05);
    expect(noiseBb(prov({ exploitabilityPct: 0.3 }), prov({ source: "charts" }), 10)).toBeNull();
  });

  it("warns first when the sources differ or either side is approximate", () => {
    expect(sourceWarning(prov({}), prov({}))).toBeNull();
    expect(sourceWarning(prov({ source: "library" }), prov({}))).toBe(
      "Different sources (A: Precomputed solution; B: Live solve): a difference may be the source's.",
    );
    expect(sourceWarning(prov({ source: "charts", approximate: true }), prov({ source: "charts", approximate: true }))).toBe(
      "A and B are approximate (Preflop charts): small differences are noise.",
    );
    expect(sourceWarning(prov({}), prov({ approximate: true }))).toBe("B is approximate (Live solve): small differences are noise.");
    expect(nodeWarning(A, B)).toBeNull();
    expect(nodeWarning(A, { ...B, actor: "BTN", street: "turn" })).toBe(
      "Different spots (A: BB on the flop; B: BTN on the turn): classes compared anyway.",
    );
  });

  it("says how spot B differs from spot A", () => {
    const a: StudyHand = { ...freshHand(6, 100), setup: { rake: 5, rakeCap: 3, stacks: { BB: 120 } } };
    expect(whatDiffers(a, { ...a, stack: 50 })).toEqual(["stack 100bb → 50bb"]);
    expect(whatDiffers(a, { ...a, setup: { stacks: { BB: 120 } } })).toEqual(["B drops: rake 5%, capped at 3bb"]);
    const t: StudyHand = { ...freshHand(6, 25), setup: { tournament: { payouts: [50, 30, 20] } } };
    expect(whatDiffers(t, freshHand(6, 25))).toEqual(["B drops: payouts 50/30/20"]);
    expect(whatDiffers(a, a)).toEqual([]);
  });
});

describe("two size menus", () => {
  it("are two spots that differ in their sizes and nothing else", () => {
    const h: StudyHand = { ...freshHand(2, 100), board: "Ks7d2c", setup: { rake: 5, rakeCap: 3 } };
    const m = (flop: number[]): StudyHand => ({ ...h, setup: { ...h.setup, sizes: { flop } } });
    expect(sizesOnly(h, m([50]))).toBe(true);
    expect(sizesOnly(m([33, 75]), m([50]))).toBe(true);
    expect(sizesOnly(m([50]), m([50]))).toBe(false);
    expect(sizesOnly(h, { ...m([50]), stack: 50 })).toBe(false);
    expect(sizesOnly(h, { ...m([50]), setup: { sizes: { flop: [50] } } })).toBe(false);
  });

  it("are compared as any bet or raise, and by what each is worth to the player to act", () => {
    // AA bets 80% with 33%, 90% with 75%; KQs 40% with either
    const any = diffClasses(A, B, ANY_RAISE);
    expect(any.find((d) => d.cls === "AA")).toMatchObject({ fa: 0.8, fb: 0.9 });
    expect(any.find((d) => d.cls === "AA")!.dFreq).toBeCloseTo(0.1);
    expect(any.find((d) => d.cls === "KQs")!.dFreq).toBeCloseTo(0);
    const m = menusOf(A, B, prov({ exploitabilityPct: 0.3 }), prov({ exploitabilityPct: 0.3 }));
    expect(m.a).toEqual({ sizes: ["bet 33%"], raise: 0.3, ev: 3.2 });
    expect(m.b).toEqual({ sizes: ["bet 75%"], raise: 0.25, ev: 3.0 });
    expect(m.dEv).toBeCloseTo(-0.2);
    expect(m.dPot).toBeCloseTo(-0.02);
    expect(m.dRaise).toBeCloseTo(-0.05);
    // 0.2bb against 0.06bb of noise (0.6% of the 10bb pot); within 4% of it, noise; unmeasured, null
    expect(m.band).toBeCloseTo(0.06);
    expect(m.noise).toBe(false);
    expect(menusOf(A, B, prov({ exploitabilityPct: 2 }), prov({ exploitabilityPct: 2 })).noise).toBe(true);
    expect(menusOf(A, B, prov({}), prov({ exploitabilityPct: 2 })).noise).toBeNull();
    expect(menusOf(A, { ...B, range_ev_bb: undefined }, prov({}), prov({})).dEv).toBeNull();
  });

  it("say which menu is worth more only beyond the two answers' distance from equilibrium, and close to a tie under twice it", () => {
    const at = (pa: number | undefined, pb: number | undefined) => menuWords(menusOf(A, B, prov({ exploitabilityPct: pa }), prov({ exploitabilityPct: pb })), "BB", 10);
    expect(at(0.3, 0.3)).toBe(
      "A's menu is worth 0.20bb more to BB here (2.0% of the 10.0bb pot), beyond noise (0.06bb). B bets or raises 5.0 points less of the range.",
    );
    expect(at(0.7, 0.8)).toBe(
      "A's menu is worth 0.20bb more to BB here (2.0% of the 10.0bb pot), under twice noise (0.15bb): close to a tie. B bets or raises 5.0 points less of the range.",
    );
    expect(at(1, 2)).toBe(
      "B − A: −0.20bb, within noise (0.30bb): no measurable difference. B bets or raises 5.0 points less of the range.",
    );
    expect(at(undefined, 2)).toBe(
      "A's menu is worth 0.20bb more to BB here (2.0% of the 10.0bb pot), noise not measured. B bets or raises 5.0 points less of the range.",
    );
    expect(menuWords(menusOf(A, { ...B, range_ev_bb: undefined }, prov({}), prov({})), "BB", 10)).toBe(
      "No EV on both sides. B bets or raises 5.0 points less of the range.",
    );
  });
});
