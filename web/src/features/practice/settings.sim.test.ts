// Each Practice setting on its own, from the defaults: it changes the hand dealt (newHand) and the request sent to the
// solver (stateFor, pfState), and the session's next hand (following) keeps it.
import { describe, expect, it } from "vitest";
import { classOf } from "@/engine/nlhe/cards";
import { seatsOf } from "@/poker/seats";
import { legal, recordOf } from "@/poker/table";
import { worthPlaying } from "./live";
import { chipsAfter, dealNext, finish, following, newHand, pfState, phaseOf, setupOf, simOf, stateFor, withVillain, type DealOptions, type PracticeHand } from "./practice";

const BASE: DealOptions = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };
type State = ReturnType<typeof stateFor> & { rake?: number; rake_cap?: number; sizes?: unknown; stacks?: Record<string, number> };

/** the hand played with every seat calling or checking to the end (yours too), and your request at each turn */
function playOut(h: PracticeHand): { h: PracticeHand; states: { street: string; st: State }[] } {
  const states: { street: string; st: State }[] = [];
  for (let i = 0; i < 200; i++) {
    const sim = simOf(h);
    const ph = phaseOf(h, sim);
    if (ph.kind === "over") break;
    if (ph.kind === "deal") {
      h = dealNext(h, ph.street);
      continue;
    }
    if (sim.toAct === h.hero) states.push({ street: sim.current!, st: stateFor(h) as State });
    const m = recordOf(setupOf(h), sim, { action: legal(setupOf(h), sim)!.toCall > 0 ? "call" : "check" });
    if (typeof m === "string") throw new Error(m);
    h = withVillain(h, m, sim);
  }
  return { h: { ...h, result: finish(h) }, states };
}

describe("each Practice setting", () => {
  it("players and stack: dealt, asked, kept", () => {
    for (const players of [2, 3, 6, 9])
      for (const stack of [10, 37, 100, 250]) {
        const h = newHand(players, stack, 0, 7, BASE);
        expect(h.players === players && seatsOf(players).every((p) => setupOf(h).stacks[p] === stack), `${players} players, ${stack}bb`).toBe(true);
        expect([stateFor(h).players, stateFor(h).stack]).toEqual([players, stack]);
        const f = following(h, 8, BASE);
        expect([f.players, f.stack]).toEqual([players, stack]);
      }
  });

  it("ante: in the pot and the request; no preflop solve (none stored)", () => {
    const h = newHand(6, 100, 0, 7, { ...BASE, ante: 0.25 });
    expect(simOf(h).pot).toBeCloseTo(1.5 + 6 * 0.25, 9);
    expect(stateFor(h).ante).toBe(0.25);
    expect(h.pfSolve).toBeFalsy();
    expect(newHand(6, 100, 0, 7, { ...BASE, ante: 0.25, pfSolve: true }).pfSolve).toBeFalsy();
  });

  it("straddle: 2bb to call, the seat after it first; asked; none heads-up", () => {
    const h = newHand(6, 100, 0, 7, { ...BASE, straddle: true });
    const s = simOf(h);
    expect([s.cur!.curBet, s.toAct]).toEqual([2, seatsOf(6)[1]]);
    expect(stateFor(h).straddle).toBe(true);
    const hu = newHand(2, 100, 0, 7, { ...BASE, straddle: true });
    expect(hu.straddle).toBeFalsy();
    expect(simOf(hu).cur!.curBet).toBe(1);
  });

  it("rake: asked as the exact fraction, taken at showdown, the chips after short by it", () => {
    const h = newHand(6, 100, 0, 7, { ...BASE, rake: 5, rakeCap: 3 });
    expect(stateFor(h)).toMatchObject({ rake: 0.05, rake_cap: 3 });
    const { h: end } = playOut(h);
    const rake = end.result!.rake ?? 0;
    expect(rake).toBeGreaterThan(0);
    expect(Object.values(chipsAfter(end)).reduce((a, b) => a + b, 0)).toBeCloseTo(600 - rake, 2);
    expect((stateFor(newHand(6, 100, 0, 7, { ...BASE, rake: 4.75 })) as State).rake).toBe(0.0475);
    expect((stateFor(newHand(6, 100, 0, 7, { ...BASE, rake: 3.33 })) as State).rake).toBe(0.0333);
  });

  it("sizes: asked from the flop on, not preflop", () => {
    const { states } = playOut(newHand(3, 100, 0, 7, { ...BASE, sizes: { flop: [33, 75] } as DealOptions["sizes"] }));
    expect(states.find((x) => x.street === "preflop")?.st.sizes).toBeUndefined();
    expect(states.find((x) => x.street !== "preflop")?.st.sizes).toBeTruthy();
  });

  it("carry: the next hand's chips are the last hand's (a seat under a quarter rebuys), asked as each seat's own", () => {
    const h = newHand(6, 100, 0, 7, { ...BASE, carry: true });
    expect(h.stacks).toBeTruthy();
    const { h: end } = playOut(h);
    const chips = chipsAfter(end);
    const next = following(end, 8, { ...BASE, carry: true });
    expect(Object.values(next.stacks!).sort()).toEqual(Object.values(chips).map((x) => (x < 25 ? 100 : x)).sort());
    if (Object.values(next.stacks!).some((v) => v !== 100)) expect((stateFor(next) as State).stacks).toBeTruthy();
    expect(following(end, 8, BASE).stacks).toBeFalsy();
  });

  it("opponents: set on the hand, the equilibrium in a pot drill, More action deals hands worth playing", () => {
    expect(newHand(6, 100, 0, 7, { ...BASE, opponents: "live" }).opponents).toBe("live");
    expect(newHand(6, 100, 0, 7, { ...BASE, opponents: "live", pot: "srp" }).opponents).toBeFalsy();
    let playable = 0;
    for (let s = 0; s < 400; s++) {
      const h = newHand(6, 100, s, 100 + s, { ...BASE, opponents: "loose" });
      if (worthPlaying(classOf(h.hands[h.hero]!.join("")))) playable++;
    }
    expect(playable).toBeGreaterThanOrEqual(390);
  });

  it("preflop solve: on the hand and its request where stored, not elsewhere", () => {
    const h = newHand(6, 100, 0, 7, { ...BASE, pfSolve: true, pfSizes: true });
    expect([!!h.pfSolve, !!h.pfSizes]).toEqual([true, true]);
    const ps = pfState(h) as Record<string, unknown>;
    // (the grade asks the game stored at the charts' own raise sizes: the tree option, not sizes of its own)
    expect([ps.preflop_solve, ps.study, ps.pf_tree, !!ps.pf_sizes]).toEqual([true, true, { sizing: "chart" }, false]);
    for (const [p, s] of [[7, 100], [6, 37], [9, 100]] as const) expect(newHand(p, s, 0, 7, { ...BASE, pfSolve: true }).pfSolve, `${p} players, ${s}bb`).toBeFalsy();
  });

  it("seat: the one chosen, or each seat in turn", () => {
    for (const seat of ["BTN", "BB", "UTG", "SB"]) expect(newHand(6, 100, 3, 7, { ...BASE, seat }).hero).toBe(seat);
    expect(new Set([0, 1, 2, 3, 4, 5].map((n) => newHand(6, 100, n, 7, BASE).hero)).size).toBe(6);
  });

  it("preflop only: the hand stops after the preflop", () => {
    const { h } = playOut(newHand(6, 100, 0, 7, { ...BASE, preflopOnly: true }));
    expect(h.shown === 0 || !!h.result?.cut).toBe(true);
  });
});
