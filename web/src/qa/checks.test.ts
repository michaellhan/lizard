// The QA sweep's checkers (checks.ts, summary.ts) on small hand-made fixtures, so CI holds the checker to its word without
// a solver: clean hands, answers and grades pass with no violation, and each kind of broken one is caught by its check.
// A broken grade comes from the grader swapped out for this file (gradeMix below): the page's own grader keeps its
// promises, so only a stand-in can show the checker would see it break them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveOf } from "@/features/practice/flow";
import type { OppMove } from "@/features/practice/live";
import { decide, dealNext, finish, following, newHand, phaseOf, setupOf, simOf, withVillain, type Decision, type PracticeHand, type SessionOptions } from "@/features/practice/practice";
import type { AnswerBasis, Grade } from "@/grading/grade";
import { legal, noLines, seeded, simulate, type Lines, type Move, type Sim } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";
import {
  checkDecided,
  checkGrades,
  checkHand,
  checkPot,
  checkPreflop,
  checkProvenance,
  compareRef,
  illegal,
  isNuts,
  ledger,
  markersOf,
  oppFlags,
  sameAction,
  topFreq,
  type Violation,
} from "./checks";
import { markdown, spotOf, summarize, type HeroRecord, type QaRecord } from "./summary";

// the grader checks.ts calls, with a stand-in for a test that needs a broken one
const stand = vi.hoisted(() => ({ grade: null as null | ((mix: Decision["mix"], pot: number, i: number, basis: AnswerBasis) => Grade) }));
vi.mock("@/features/practice/practice", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/practice/practice")>();
  return { ...real, gradeMix: (mix: Decision["mix"], pot: number, i: number, basis: AnswerBasis) => (stand.grade ? stand.grade(mix, pot, i, basis) : real.gradeMix(mix, pot, i, basis)) };
});
afterEach(() => {
  stand.grade = null;
});

const checksOf = (vs: readonly Violation[]) => vs.map((x) => `${x.severity} ${x.check}`).sort();
const res = (x: Record<string, unknown>) => x as unknown as AdvisorResponse;
const prov = (x: Partial<Provenance> & Pick<Provenance, "source">): Provenance => ({ approximate: false, ...x }) as Provenance;

// ---- the table and the records

/** A heads-up hand played to its end on given lines: your SB's royal flush, the BB folding the river. */
function scripted(lines: Partial<Lines>, over: Partial<PracticeHand> = {}): PracticeHand {
  const h: PracticeHand = {
    ...newHand(2, 100, 0, 3, {}),
    hero: "SB",
    hands: { SB: ["As", "Ks"], BB: ["7c", "2d"] },
    board: ["Qs", "Js", "Ts", "4d", "3h"],
    shown: 5,
    lines: { ...noLines(), ...lines },
    ...over,
  };
  return { ...h, result: finish(h) };
}
const M = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const FULL: Partial<Lines> = {
  preflop: [M("SB", "raise", 2.5), M("BB", "call")],
  flop: [M("BB", "check"), M("SB", "bet", 2.5), M("BB", "call")],
  turn: [M("BB", "check"), M("SB", "check")],
  river: [M("BB", "check"), M("SB", "bet", 10), M("BB", "fold")],
};

describe("the table and the records", () => {
  it("passes a hand played by the rules, its chips and its history", () => {
    const h = scripted(FULL);
    expect(h.result?.net).toBe(5);
    expect(checkHand(h)).toEqual([]);
  });

  it("works out each seat's chips in from the lines alone, a bet nobody called given back", () => {
    const h = scripted(FULL);
    const sim = simOf(h);
    expect(ledger({ players: 2, stacks: { SB: 100, BB: 100 } }, h.lines, (s) => !!sim.streets[s]?.closed)).toEqual({ SB: 5, BB: 5 });
    // (antes and a blind the stack can't cover)
    expect(ledger({ players: 2, stacks: { SB: 0.3, BB: 100 }, ante: 0.1 }, noLines(), () => false)).toEqual({ SB: 0.3, BB: 1.1 });
  });

  it("says why a move couldn't have been recorded where it was", () => {
    const t = { players: 6, stacks: Object.fromEntries(["UTG", "HJ", "CO", "BTN", "SB", "BB"].map((p) => [p, 100])) };
    const sim = simulate(t, noLines(), 0);
    expect(illegal(t, sim, "preflop", M("UTG", "raise", 2.5))).toBeNull();
    expect(illegal(t, sim, "preflop", M("UTG", "call"))).toBeNull();
    expect(illegal(t, sim, "preflop", M("UTG", "fold"))).toBeNull();
    expect(illegal(t, sim, "preflop", M("HJ", "fold"))).toMatch(/UTG is to act/);
    expect(illegal(t, sim, "preflop", M("UTG", "check"))).toMatch(/check facing 1bb/);
    expect(illegal(t, sim, "preflop", M("UTG", "bet", 2.5))).toMatch(/records a raise/);
    expect(illegal(t, sim, "preflop", M("UTG", "raise", 1.5))).toMatch(/under the smallest raise/);
    expect(illegal(t, sim, "preflop", M("UTG", "raise", 100))).toMatch(/records all-in/);
    expect(illegal(t, sim, "preflop", M("UTG", "raise"))).toMatch(/no size/);
    expect(illegal(t, sim, "flop", M("UTG", "check"))).toMatch(/not the flop/);
  });

  it("catches an illegal move on the lines", () => {
    const bad = scripted({ ...FULL, river: [M("BB", "check"), M("SB", "bet", 10), M("BB", "check")] });
    expect(checksOf(checkHand(bad))).toContain("hard table.legal");
  });

  it("catches a pot paid out that isn't the pot put in, and a result the history doesn't give back", () => {
    const h = scripted(FULL);
    expect(checksOf(checkHand({ ...h, result: { ...h.result!, pays: { SB: 12 } } }))).toContain("hard table.chips");
    expect(checksOf(checkHand({ ...h, result: { ...h.result!, net: 4 } }))).toContain("hard records.result");
  });

  it("passes seeded sessions played through the page's own flow: antes, a straddle, short stacks, the rake", () => {
    const rnd = seeded(11);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const found: string[] = [];
    let hands = 0;
    // (records.sim.test.ts's made-up opponents and answers)
    const opp = (sim: Sim, seat: string): OppMove => {
      const cur = sim.cur!;
      const toCall = cur.curBet - cur.bets[seat]!;
      const r = rnd();
      const raiseTo = sim.current === "preflop" ? (cur.nRaises ? cur.curBet * 3 : 2.5) : Math.round((cur.curBet * 2.5 + sim.pot * 0.5) * 100) / 100;
      const betTo = Math.round(sim.pot * 0.75 * 100) / 100;
      const actions = (toCall > 0 ? [{ action: "fold" }, { action: "call" }, { action: `raise ${raiseTo}`, amount_bb: raiseTo }] : [{ action: "check" }, { action: "bet 75%", amount_bb: betTo }]) as OppMove["actions"];
      if (toCall > 0) return r < 0.25 ? { action: "fold", actions } : r < 0.85 ? { action: "call", actions } : r < 0.95 ? { action: "raise", to: raiseTo, actions } : { action: "all-in", actions };
      return r < 0.6 ? { action: "check", actions } : r < 0.95 ? { action: "bet", to: betTo, actions } : { action: "all-in", actions };
    };
    const answerAt = (h: PracticeHand, sim: Sim): AdvisorResponse => {
      const lg = legal(setupOf(h), sim)!;
      const acts: Record<string, unknown>[] = [];
      if (lg.toCall > 0) acts.push({ action: "fold", freq: 0.2, ev_bb: 0 });
      acts.push({ action: lg.toCall > 0 ? "call" : "check", freq: 0.6, ev_bb: 0.1 });
      if (lg.canRaise) acts.push({ action: "all-in", freq: 0.2, ev_bb: -1 });
      return res({ actions: acts, pot_bb: Math.round(sim.pot * 100) / 100 });
    };
    for (let sn = 0; sn < 40; sn++) {
      const players = 2 + Math.floor(rnd() * 8);
      const opts: SessionOptions = {
        seat: "moves",
        preflopOnly: false,
        pot: null,
        ante: rnd() < 0.3 ? pick([0.1, 0.12, 0.5]) : 0,
        straddle: players >= 3 && rnd() < 0.2,
        carry: rnd() < 0.5,
        sizes: null,
        rake: rnd() < 0.3 ? 5 : 0,
        rakeCap: rnd() < 0.5 ? 3 : 0,
        opponents: "gto",
      };
      let h = newHand(players, pick([10, 20, 100]), 0, 500 + sn, opts);
      for (let hn = 0; hn < 3; hn++) {
        for (let step = 0; step < 300; step++) {
          const sim = simOf(h);
          const ph = phaseOf(h, sim);
          if (ph.kind === "over") {
            if (!h.result) h = { ...h, result: finish(h, sim) };
            break;
          }
          if (ph.kind === "deal") h = dealNext(h, ph.street);
          else if (ph.kind === "hero") {
            const a = answerAt(h, sim);
            const r = decide(h, a, Math.floor(rnd() * a.actions!.length), null, sim);
            if ("error" in r) throw new Error(r.error);
            h = r.hand;
          } else if (ph.kind === "villain" || ph.kind === "auto") h = withVillain(h, moveOf(h, opp(sim, ph.seat), sim).move, sim);
        }
        hands++;
        for (const x of checkHand(h)) found.push(`session ${sn} hand ${hn}: ${x.check}: ${x.detail} ${JSON.stringify(h.lines)}`);
        h = following(h, 500 + sn * 10 + hn + 1, opts);
      }
    }
    expect(found.slice(0, 5)).toEqual([]);
    expect(hands).toBe(120);
  });
});

// ---- provenance honesty

describe("provenance honesty", () => {
  const flop = { asked: "advice", street: "flop" } as const;
  const river = { asked: "advice", street: "river" } as const;
  const UNSETTLED = "BB: the solve that narrows ranges is 39.3% of the pot from equilibrium (10 iterations), so ranges follow it 0%";

  it("reads what an answer's ranges stand on", () => {
    expect(markersOf(res({}))).toEqual({ rules: false, unsettled: false, rare: false, rareUnresolved: false, widened: false, built: false, borrowed: false, leans: false });
    const m = markersOf(res({ notes: [UNSETTLED], off_solution: [{ why: "rare", resolved: true }] }));
    expect(m).toMatchObject({ unsettled: true, rare: true, rareUnresolved: false, leans: true });
    expect(markersOf(res({ notes: ["BB: ranges narrowed by simple betting rules (the flop's solve failed)"] }))).toMatchObject({ rules: true, leans: true });
    expect(markersOf(res({ precomputed: { spot: "x", borrowed: { spot: "y", built: true } } }))).toMatchObject({ borrowed: true, built: true, leans: false });
    expect(markersOf(res({ ranges_built: ["BB"], widened: ["SB"] }))).toMatchObject({ built: true, widened: true, leans: true });
  });

  it("passes a library flop with its own converged band", () => {
    const p = prov({ source: "library", band: "converged", exploitabilityPct: 0.09, librarySpot: "srp_btn_bb" });
    expect(checkProvenance(res({ street: "flop", actions: [] }), p, { source: "library" }, flop)).toEqual([]);
  });

  it("fails a converged band on ranges from an unsettled narrowing (the --quick run's river)", () => {
    const p = prov({ source: "live", approximate: true, approximateLabel: "the turn's narrowing solve stopped 39.3% of the pot from equilibrium", band: "converged", exploitabilityPct: 0.09, iterations: 200 });
    expect(checksOf(checkProvenance(res({ street: "river", notes: [UNSETTLED] }), p, { source: "live", leans: true }, river))).toEqual(["hard prov.settled"]);
    // (and a basis that doesn't lean where the ranges do)
    expect(checksOf(checkProvenance(res({ street: "river", notes: [UNSETTLED] }), p, { source: "live" }, river))).toEqual(["hard prov.lean", "hard prov.settled"]);
  });

  it("fails ranges from the rules shown as no approximation, and another spot's numbers shown as this one's", () => {
    const rules = res({ street: "turn", off_solution: [{ why: "rules", street: "flop" }] });
    expect(checksOf(checkProvenance(rules, prov({ source: "live", band: "rough", exploitabilityPct: 3, iterations: 50 }), { leans: true }, { asked: "advice", street: "turn" }))).toEqual(["hard prov.honesty"]);
    const borrowed = res({ street: "flop", precomputed: { spot: "x", borrowed: { spot: "y" } } });
    const p = prov({ source: "library", approximate: true, approximateLabel: "another table's spot", band: "converged", exploitabilityPct: 0.2 });
    expect(checksOf(checkProvenance(borrowed, p, null, flop))).toEqual(["hard prov.band", "hard prov.band", "hard prov.settled"]);
  });

  it("fails an approximate answer that doesn't say why, and a chart not marked approximate", () => {
    expect(checksOf(checkProvenance(res({ street: "flop" }), prov({ source: "live", approximate: true, band: "rough", iterations: 9 }), null, flop))).toEqual(["hard prov.label"]);
    expect(checksOf(checkProvenance(res({ street: "preflop" }), prov({ source: "charts" }), null, { asked: "advice", street: "preflop" }))).toEqual(["hard prov.label"]);
    expect(checkProvenance(res({ street: "preflop" }), prov({ source: "charts", approximate: true }), null, { asked: "advice", street: "preflop" })).toEqual([]);
  });

  it("fails a source that isn't what answered", () => {
    const pre = { asked: "advice", street: "preflop" } as const;
    expect(checksOf(checkProvenance(res({}), prov({ source: "unknown" }), null, flop))).toEqual(["hard prov.source"]);
    expect(checksOf(checkProvenance(res({}), prov({ source: "charts", approximate: true }), null, { asked: "pf", street: "preflop" }))).toEqual(["hard prov.source"]);
    expect(checksOf(checkProvenance(res({}), prov({ source: "live", approximate: true, approximateLabel: "x", iterations: 5 }), null, pre))).toEqual(["hard prov.source"]);
    expect(checksOf(checkProvenance(res({ street: "flop" }), prov({ source: "push-fold", approximate: true }), null, flop))).toEqual(["hard prov.source"]);
    expect(checksOf(checkProvenance(res({ street: "turn" }), prov({ source: "library", band: "converged", exploitabilityPct: 0.1 }), null, flop))).toEqual(["hard prov.source", "soft prov.source"]);
  });

  it("measures a converged band after an opponent's rare line solved again as soft", () => {
    const p = prov({ source: "live", band: "converged", exploitabilityPct: 0.1, iterations: 300 });
    expect(checksOf(checkProvenance(res({ street: "turn", off_solution: [{ why: "rare", resolved: true }] }), p, null, { asked: "advice", street: "turn" }))).toEqual(["soft prov.settled"]);
  });

  it("measures the answer's pot and price against the table's", () => {
    const t = { players: 2, stacks: { SB: 100, BB: 100 } };
    const sim = simulate(t, noLines(), 0);
    expect(checkPot(res({ pot_bb: 1.5, to_call_bb: 0.5 }), t, sim, "SB")).toEqual([]);
    expect(checksOf(checkPot(res({ pot_bb: 2, to_call_bb: 1 }), t, sim, "SB"))).toEqual(["soft table.answer-pot", "soft table.answer-pot"]);
  });
});

// ---- grade sanity

describe("grade sanity", () => {
  const basis: AnswerBasis = { source: "library", band: "converged", exploitabilityPct: 0.1 };
  const MIXED: Decision["mix"] = [
    { action: "check", freq: 0.7, ev: 1.0 },
    { action: "bet 33%", freq: 0.3, ev: 0.98, amount: 3.3 },
    { action: "bet 75%", freq: 0, ev: 0.5, amount: 7.5 },
    { action: "all-in", freq: 0, ev: -2 },
  ];

  it("passes the page's grades of every action at a node, leaning or not", () => {
    const { grades, violations } = checkGrades(MIXED, 10, basis);
    expect(violations).toEqual([]);
    expect(grades.map((g) => g.verdict)).toEqual(["Best", "Correct", "Mistake", "Blunder"]);
    expect(checkGrades(MIXED, 10, { ...basis, source: "live", leans: true }).violations).toEqual([]);
    // (a chart's frequencies, no EVs)
    expect(checkGrades([{ action: "raise 2.5", freq: 0.9, ev: null }, { action: "fold", freq: 0.1, ev: null }], 1.5, { source: "charts" }).violations).toEqual([]);
  });

  const real = async () => (await vi.importActual<typeof import("@/features/practice/practice")>("@/features/practice/practice")).gradeMix;

  it("catches a mixed action condemned, the top EV not Best, and a verdict that improves with the loss", async () => {
    const g = await real();
    stand.grade = (mix, pot, i, b) => {
      const x = g(mix, pot, i, b);
      if (i === 1) return { ...x, verdict: "Mistake", ok: false };
      if (i === 0) return { ...x, verdict: "Correct" };
      if (i === 3) return { ...x, verdict: "Inaccuracy" };
      return x;
    };
    const got = checksOf(checkGrades(MIXED, 10, basis).violations);
    expect(got).toContain("hard grade.mix");
    expect(got).toContain("hard grade.top");
    expect(got).toContain("hard grade.monotone");
  });

  it("catches a loss that isn't the named top EV's less the action's, a cap with no reason, NaN, and a best never played", async () => {
    const g = await real();
    stand.grade = (mix, pot, i, b) => {
      const x = g(mix, pot, i, b);
      if (i === 2) return { ...x, loss: 0.4, capped: true };
      if (i === 3) return { ...x, lossPct: Number.NaN, clearWhy: "a clear blunder", verdict: "Mistake" };
      return x;
    };
    const got = checksOf(checkGrades(MIXED, 10, basis).violations);
    expect(got).toEqual(expect.arrayContaining(["hard grade.words", "hard grade.cap", "hard grade.nan"]));
    stand.grade = (mix, pot, i, b) => ({ ...g(mix, pot, i, b), best: 3 });
    expect(checksOf(checkGrades(MIXED, 10, basis).violations)).toContain("hard grade.best");
  });

  it("holds the kept grade to the same action graded again", async () => {
    const g = (await real())(MIXED, 10, 2, basis);
    expect(checkDecided({ grade: g, chose: "bet 75%" }, g)).toEqual([]);
    expect(checksOf(checkDecided({ grade: g, chose: "bet 75%" }, { ...g, verdict: "Blunder" }))).toEqual(["hard grade.decided"]);
  });
});

// ---- preflop

describe("preflop", () => {
  const chart = res({ actions: [{ action: "raise 2.5", freq: 0.9, amount_bb: 2.5 }, { action: "fold", freq: 0.1 }] });
  const solve: AnswerBasis = { source: "preflop-solve" };

  it("passes a solve that agrees with the chart, and a chart's own most played move", () => {
    const mix = [{ action: "raise 2.5", freq: 0.85, ev: 0.5, amount: 2.5 }, { action: "fold", freq: 0.15, ev: 0 }];
    expect(checkPreflop({ chart, graded: { mix, pot: 1.5, basis: solve, source: "preflop-solve" } })).toEqual([]);
    const byChart = [{ action: "raise 2.5", freq: 0.9, ev: null }, { action: "fold", freq: 0.1, ev: null }];
    expect(checkPreflop({ chart, graded: { mix: byChart, pot: 1.5, basis: { source: "charts" }, source: "charts" } })).toEqual([]);
  });

  it("fails the chart's most played move condemned by the solve", () => {
    const mix = [{ action: "raise 2.5", freq: 0, ev: -3, amount: 2.5 }, { action: "fold", freq: 1, ev: 0 }];
    const got = checkPreflop({ chart, graded: { mix, pot: 1.5, basis: solve, source: "preflop-solve" } });
    expect(checksOf(got)).toEqual(["hard pf.follow"]);
    expect(got[0]!.detail).toMatch(/chart's most played move, raise 2.5/);
    // (not where your options are the solve's own)
    expect(checkPreflop({ chart, graded: { mix, pot: 1.5, basis: solve, source: "preflop-solve" }, ownOptions: true })).toEqual([]);
  });

  it("fails a node graded by EV with a move the solve never trained", () => {
    const node = res({ actions: [{ action: "fold", freq: 0.5 }, { action: "call", freq: 0.5 }, { action: "raise 9", freq: 0, amount_bb: 9 }], grid: { actions: ["fold", "call", "raise 9"], cells: { AA: { ev: [0, 3, -2] } } } });
    const mix = [{ action: "fold", freq: 0.5, ev: 0 }, { action: "call", freq: 0.5, ev: 0 }, { action: "raise 9", freq: 0, ev: -2, amount: 9 }];
    expect(checksOf(checkPreflop({ chart, pf: node, graded: { mix, pot: 1.5, basis: solve, source: "preflop-solve" }, ownOptions: true }))).toEqual(["hard pf.untrained"]);
  });

  it("matches an action across answers by name, kind and size", () => {
    const mix = [{ action: "fold", freq: 0, ev: 0 }, { action: "raise 2.2", freq: 1, ev: 1, amount: 2.2 }, { action: "raise 3", freq: 0, ev: 1, amount: 3 }];
    expect(sameAction(mix, "fold", undefined)).toBe(0);
    expect(sameAction(mix, "raise 2.25", 2.25)).toBe(1);
    expect(sameAction(mix, "raise 4", 4)).toBe(-1);
    expect(sameAction(mix, "call", undefined)).toBe(-1);
    expect(topFreq([0.2, 0.5, 0.5])).toBe(1);
    expect(topFreq([])).toBe(-1);
  });
});

// ---- opponents

describe("opponents", () => {
  it("knows the nuts", () => {
    expect(isNuts(["As", "Ks"], ["Qs", "Js", "Ts", "4d", "3h"])).toBe(true);
    expect(isNuts(["Ah", "Ad"], ["Qs", "Js", "Ts", "4d", "3h"])).toBe(false);
  });

  // a limped heads-up hand checked to the river, where the BB bets the pot
  const limped = (hands: PracticeHand["hands"], board: string[]): PracticeHand => ({
    ...newHand(2, 100, 0, 3, {}),
    hero: "BB",
    hands,
    board,
    shown: 5,
    lines: { preflop: [M("SB", "call"), M("BB", "check")], flop: [M("BB", "check"), M("SB", "check")], turn: [M("BB", "check"), M("SB", "check")], river: [M("BB", "bet", 2)] },
  });

  it("flags a call with nothing facing a pot-size bet, a river fold of the nuts, and a fold where checking was free", () => {
    const air = limped({ SB: ["7c", "2d"], BB: ["As", "Ks"] }, ["Qh", "Jd", "9c", "4s", "3h"]);
    const sim = simOf(air);
    expect(oppFlags(air, sim, "SB", M("SB", "call"))).toEqual({ freeFold: false, riverNutFold: false, nothingPot: { called: true } });
    expect(oppFlags(air, sim, "SB", M("SB", "fold")).nothingPot).toEqual({ called: false });
    const nuts = limped({ SB: ["As", "Ks"], BB: ["7c", "2d"] }, ["Qs", "Js", "Ts", "4d", "3h"]);
    expect(oppFlags(nuts, simOf(nuts), "SB", M("SB", "fold"))).toMatchObject({ riverNutFold: true, nothingPot: null });
    const free = { ...air, shown: 3, lines: { ...air.lines, turn: [], river: [], flop: [] } };
    expect(oppFlags(free, simOf(free), "BB", M("BB", "fold")).freeFold).toBe(true);
  });
});

// ---- Quick against a reference

describe("Quick against a reference", () => {
  const basis: AnswerBasis = { source: "live", band: "good", exploitabilityPct: 0.5 };
  const quick: Decision["mix"] = [{ action: "check", freq: 0, ev: 0.2 }, { action: "bet 50%", freq: 1, ev: 1, amount: 5 }];
  const ref: Decision["mix"] = [{ action: "check", freq: 1, ev: 1 }, { action: "bet 66%", freq: 0, ev: 0.4, amount: 5 }];

  it("grades the same action on both and says which way they differ", async () => {
    const g = (await vi.importActual<typeof import("@/features/practice/practice")>("@/features/practice/practice")).gradeMix;
    const qCheck = g(quick, 10, 0, basis);
    const c = compareRef("check", { mix: quick, grade: qCheck }, { mix: ref, pot: 10, basis });
    expect(c).toMatchObject({ action: "check", quick: qCheck.verdict, ref: "Best", condemns: true, passes: false, agree: false, quickEv: 0.2, refEv: 1 });
    // (the bet: the one bet in the reference's mix)
    const qBet = g(quick, 10, 1, basis);
    expect(compareRef("bet 50%", { mix: quick, grade: qBet }, { mix: ref, pot: 10, basis })).toMatchObject({ quick: "Best", passes: true, condemns: false });
    expect(compareRef("all-in", { mix: quick, grade: qBet }, { mix: ref, pot: 10, basis })).toBeNull();
  });
});

// ---- the summary

describe("the summary", () => {
  const table = { players: 6, stack: 100, opponents: "gto" as const, pot: "srp" };
  const hero = (over: Partial<HeroRecord>): HeroRecord => ({
    t: "hero",
    config: "6max-100bb-gto-srp",
    seed: 7,
    hand: 0,
    violations: [],
    table,
    street: "flop",
    seat: "BTN",
    line: "BTN AsKd on 2h7c9d",
    spot: "flop hu srp",
    mode: "quick",
    secs: 1,
    source: "library",
    graded: "library",
    approximate: false,
    chose: "check",
    verdict: "Best",
    ...over,
  });

  it("names a decision's spot by street, players in and pot", () => {
    const lines = { ...noLines(), preflop: [M("BTN", "raise", 2.5), M("BB", "call")] };
    expect(spotOf({ lines }, { current: "flop", active: new Set(["BTN", "BB"]) })).toBe("flop hu srp");
    expect(spotOf({ lines: { ...lines, preflop: [...lines.preflop, M("BB", "raise", 11)] } }, { current: "turn", active: new Set(["BTN", "BB", "CO"]) })).toBe("turn 3way 3bet");
    expect(spotOf({ lines: noLines() }, { current: "preflop", active: new Set() })).toBe("preflop");
  });

  it("tallies the checks, the coverage, the references, the opponents and the time", () => {
    const recs: QaRecord[] = [
      hero({ secs: 2 }),
      hero({ secs: 20, source: "live", graded: "live", verdict: "Mistake", violations: [{ check: "prov.settled", severity: "hard", detail: "a converged band" }] }),
      // (a raked table: counted in the coverage, left out of the library's share, which is for the games it was built for)
      hero({ secs: 1, source: "live", graded: "live", table: { ...table, plain: false } }),
      hero({ street: "preflop", spot: "preflop", source: "charts", graded: "preflop-solve", pfWhy: "the solve's node has 2 moves", secs: 0.4 }),
      { t: "opp", config: "6max-100bb-live-any", seed: 1, hand: 0, violations: [], table: { ...table, opponents: "live" }, street: "river", seat: "BB", line: "", secs: 0.1, action: "call", flags: { freeFold: false, riverNutFold: false, nothingPot: { called: true } } },
      { t: "hand", config: "6max-100bb-gto-srp", seed: 7, hand: 0, violations: [{ check: "drill.spent", severity: "soft", detail: "x" }], table, net: 1, folded: false, shown: 5, decisions: 2, tries: 1 },
      { t: "ref", config: "6max-100bb-gto-srp", seed: 7, hand: 0, violations: [], table, street: "flop", line: "", spot: "flop hu srp", mode: "fast", secs: 3, source: "library", quickSource: "library", cmp: { action: "check", quick: "Best", ref: "Best", agree: true, condemns: false, passes: false, quickFreq: 1, refFreq: 1, quickEv: 1, refEv: 1 } },
      { t: "config", config: "6max-100bb-gto-srp", hands: 1, heroDecisions: 3, oppMoves: 1, secs: 30, rssPeak: 400, restarts: 0, violations: [] },
      { t: "config", config: "(reference advisor)", hands: 0, heroDecisions: 0, oppMoves: 0, secs: 0, rssPeak: 600, restarts: 0, violations: [] },
    ];
    const s = summarize(recs, 42);
    expect(s).toMatchObject({ configs: 1, hands: 1, heroDecisions: 4, graded: 4, oppMoves: 1, refs: 1, secs: 42, hard: 1, soft: 1 });
    expect(s.checks.map((c) => `${c.severity} ${c.check} ${c.count}`)).toEqual(["hard prov.settled 1", "soft drill.spent 1"]);
    expect(s.checks[0]!.examples[0]).toMatchObject({ config: "6max-100bb-gto-srp", seed: 7, street: "flop", source: "live", verdict: "Mistake" });
    expect(s.coverage.find((c) => c.spot === "flop hu srp")).toEqual({ spot: "flop hu srp", n: 3, sources: { library: 1, live: 2 } });
    expect(s.coverageAlerts[0]).toMatchObject({ n: 2, share: 0.5, ok: true });
    expect(s.coverageAlerts[1]).toMatchObject({ n: 0, share: null, ok: null });
    expect(s.preflop).toEqual({ solve: 1, charts: 0, other: 0, pfWhy: { "the solve's node has # moves": 1 } });
    expect(s.quickVsRef).toEqual([{ mode: "fast", n: 1, compared: 1, agree: 1, condemns: 0, passes: 0 }]);
    expect(s.opponents).toEqual([{ opponents: "live", moves: 1, freeFolds: 0, riverNutFolds: 0, nothingPotSpots: 1, nothingPotCalls: 1 }]);
    expect(s.perf.find((p) => p.mode === "quick" && p.street === "flop")).toMatchObject({ n: 3, p50: 2, max: 20, over15: 1 });
    const md = markdown(s, "QA test");
    expect(md).toMatch(/^# QA test/);
    expect(md).toContain("**Hard violations: 1.**");
    expect(md).toContain("| prov.settled | hard | 1 |");
    expect(md).toContain("| fast | 1 | 1 | 1/1 (100.0%) |");
  });
});
