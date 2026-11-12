// A session graded by the preflop solve: what it reads of a node the real engine answered (test/fixtures/pf_nodes.json,
// from Advisor.advise on the stored solve, on the worker's own path), where it refuses, and how the grade goes on from
// there. The chart answers here are the engine's for the same spots.
import { describe, expect, it, vi } from "vitest";
import nodes from "@/test/fixtures/pf_nodes.json";
import { keptHand } from "./keep";
import { adviceKey, needOf, pfKey } from "./flow";
import { gradedOn, optionsAt, pfAgain, PF_MODEL, pfRead, pfWords, type HeldAnswer, type PfAsked } from "./pfGrade";
import { dealNext, decide, following, gradeMix, newHand, optionsOf, pfBlocked, pfState, rangeAt, simOf, stateFor, studyOf, withVillain, type PracticeHand } from "./practice";
import { reviewed } from "./review";
import { afterDecision, freshSession, toRecord } from "./session";
import { retrySpot } from "./SessionRetry";
import { addCell, rowOf } from "@/features/history/history";
import { streetTotals } from "@/features/history/progress";
import { answerChange, handMistake, retried, spotKey } from "@/features/review/mistakes";
import { askAgain, askSolver } from "@/features/review/retry";
import { readSetup, scenarioWords } from "@/data/scenarios";
import { SolverClient } from "@/solver/client";
import type { Move } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import { describe as words, provenanceOf } from "@/solver/provenance";
import type { Provenance, SolveRequest, SolveResult, SolverTransport } from "@/solver/types";

const NODES = nodes as unknown as Record<"first" | "opened" | "offSize" | "other" | "unsolved", AdvisorResponse>;
const CHART_P: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "1", partial: false, receivedAt: 0 };
const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "1", partial: false, now: 1 };
const asked = (data: AdvisorResponse): SolveResult => ({ data, provenance: provenanceOf(data, ctx) });

const CHART_FIRST: AdvisorResponse = { street: "preflop", pot_bb: 1.5, actions: [{ action: "raise", freq: 1, amount_bb: 2.5 }, { action: "fold", freq: 0 }] };
const CHART_OPENED: AdvisorResponse = { street: "preflop", pot_bb: 4, actions: [{ action: "fold", freq: 0.1 }, { action: "call", freq: 0.6 }, { action: "raise", freq: 0.3, amount_bb: 7.5 }] };
const CHART_BB: AdvisorResponse = { street: "preflop", pot_bb: 4, actions: [{ action: "raise", freq: 0.2, amount_bb: 10 }, { action: "call", freq: 0.7 }, { action: "fold", freq: 0.1 }] };

/** A hand with your seat and cards set, the line played. */
function spot(hero: string, hole: [string, string], line: Move[], opts = {}): PracticeHand {
  let h: PracticeHand = { ...newHand(6, 100, 0, 7, { pfSolve: true, ...opts }), hero };
  h = { ...h, hands: { ...h.hands, [hero]: hole } };
  for (const m of line) h = withVillain(h, m);
  return h;
}
const OPEN: Move[] = [{ pos: "UTG", action: "raise", to: 2.5 }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "fold" }];
const toBb: Move[] = [...OPEN, { pos: "BTN", action: "fold" }, { pos: "SB", action: "fold" }];

const first = () => spot("UTG", ["7h", "2d"], []);
const btn = () => spot("BTN", ["Ah", "Kd"], OPEN);
const bb = () => spot("BB", ["Ah", "Kd"], toBb);

describe("where it can be set", () => {
  const plain = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };

  it("is the stored games and nothing else", () => {
    expect(pfBlocked(6, 100, plain)).toBeNull();
    expect(pfBlocked(6, 100, { ...plain, preflopOnly: true })).toBeNull();
    expect(pfBlocked(6, 100, { ...plain, rake: 5, rakeCap: 3 })).toBeNull();
    // (Lizard's grid: 2 to 6 players at the stored depths, raked or not)
    for (const [p, s] of [[2, 100], [3, 20], [4, 40], [5, 200], [6, 60], [6, 125]] as const) {
      expect(pfBlocked(p, s, plain)).toBeNull();
      expect(pfBlocked(p, s, { ...plain, rake: 5, rakeCap: 3 })).toBeNull();
    }
    for (const [p, s, o] of [
      [7, 100, plain],
      [9, 100, plain],
      [6, 65, plain],
      [2, 250, plain],
      [6, 12, plain],
      [6, 100, { ...plain, ante: 0.1 }],
      [6, 100, { ...plain, straddle: true }],
      [6, 100, { ...plain, rake: 5, rakeCap: 0 }],
      [6, 100, { ...plain, rake: 4, rakeCap: 3 }],
      [6, 100, { ...plain, carry: true }],
      [6, 100, { ...plain, sizes: { flop: [50] } }],
      [6, 100, { ...plain, pot: "srp" }],
      [6, 100, { ...plain, pot: "lib" }],
      [6, 100, { ...plain, tournament: { model: "chips", stacks: { UTG: 60 } } }],
      [6, 100, { ...plain, tournament: { model: "icm", payouts: [50, 30, 20], stacks: {} } }],
    ] as const) expect(pfBlocked(p, s, o as never)).toMatch(/\w+ \w+/);
  });
  it("is said in words that send you to Study, not into a solve", () => {
    expect(pfBlocked(7, 100, plain)).toMatch(/^The preflop solve is stored for 2 to 6 players only\. This game would need a solve first, and Practice doesn't start one: Study can\.$/);
    expect(pfBlocked(6, 65, plain)).toMatch(/^The preflop solve is stored for stacks of 20, 25, 30, 40, 50, 60, 80, 100, 125, 150 or 200bb only; the nearest is 60bb\. This game would need/);
  });
  it("marks a hand only where the session can have it", () => {
    expect(newHand(6, 100, 0, 7, { pfSolve: true }).pfSolve).toBe(true);
    expect(newHand(6, 100, 0, 7, {}).pfSolve).toBeUndefined();
    expect(newHand(6, 100, 0, 7, { pfSolve: true, pot: "srp" }).pfSolve).toBeUndefined();
    expect(newHand(3, 100, 0, 7, { pfSolve: true }).pfSolve).toBe(true);
    expect(newHand(7, 100, 0, 7, { pfSolve: true }).pfSolve).toBeUndefined();
    expect(newHand(6, 90, 0, 7, { pfSolve: true }).pfSolve).toBeUndefined();
  });
});

describe("what's asked", () => {
  it("asks your preflop of both, under a key that's neither's", () => {
    const h = first();
    const need = needOf(h, "quick");
    if (need.kind !== "you") throw new Error(need.kind);
    expect(need.pf).toEqual({ ...stateFor(h), study: true, preflop_solve: true });
    expect(need.pf).not.toHaveProperty("run");
    expect(need.key).toBe(pfKey("quick", stateFor(h)));
    expect(need.key).not.toBe(adviceKey("quick", stateFor(h)));
  });
  it("asks nothing more of a session without it, or from the flop on", () => {
    const off = { ...first() };
    delete off.pfSolve;
    expect(needOf(off, "quick")).not.toHaveProperty("pf");
    const later = dealNext({ ...first(), lines: { preflop: [...OPEN, { pos: "BTN", action: "call" }, { pos: "SB", action: "fold" }, { pos: "BB", action: "fold" }], flop: [], turn: [], river: [] } }, "flop");
    const need = needOf({ ...later, hero: "UTG" }, "quick");
    expect(need).not.toHaveProperty("pf");
  });
});

describe("a node the solve can answer", () => {
  const read = (h: PracticeHand, chart: AdvisorResponse, node: PfAsked) => {
    const r = pfRead(h, chart, node);
    if ("why" in r) throw new Error(r.why);
    return r;
  };

  it("gives your class's numbers on your options, in your order", () => {
    const { data } = read(btn(), CHART_OPENED, asked(NODES.opened));
    const cell = NODES.opened.grid!.cells.AKo!;
    expect(optionsOf(data).map((a) => a.action)).toEqual(["fold", "call", "raise"]);
    expect(optionsOf(data).map((a) => a.freq)).toEqual([cell.f[2], cell.f[1], cell.f[0]]);
    expect(optionsOf(data).map((a) => a.ev_bb)).toEqual([cell.ev![2], cell.ev![1], cell.ev![0]]);
    expect(optionsOf(data)[2]!.amount_bb).toBe(7.5);
  });
  it("is labelled the preflop solve, the model named, and marked approximate however done the solve is", () => {
    const { provenance } = read(btn(), CHART_OPENED, asked(NODES.opened));
    expect(provenance.source).toBe("preflop-solve");
    expect(provenance.approximate).toBe(true);
    expect(words(provenance)).toContain("Preflop solve (class-level model)");
    expect(words(provenance)).toContain(PF_MODEL);
    expect(words(provenance)).toMatch(/mbb\/hand from equilibrium/);
    expect(words(provenance)).toContain("precomputed");
  });
  it("grades every option by EV, whichever you pick, and the move is the chart's", () => {
    const h = btn();
    const on = gradedOn(h, { data: CHART_OPENED, provenance: CHART_P, pf: asked(NODES.opened) });
    for (const i of [0, 1, 2]) {
      const r = decide(h, on.data, i, on.provenance, undefined, on.pfWhy);
      if ("error" in r) throw new Error(r.error);
      expect(r.decision.grade!.byEv).toBe(true);
      expect(r.decision.provenance!.source).toBe("preflop-solve");
      expect(r.decision.pfWhy).toBeUndefined();
    }
    const raise = decide(h, on.data, 2, on.provenance);
    if ("error" in raise) throw new Error(raise.error);
    expect(raise.decision.move).toEqual({ pos: "BTN", action: "raise", to: 7.5 });
    expect(raise.decision.study).toContain("pf=solver");
  });
  it("prices the EV it says was lost", () => {
    const h = first();
    const on = gradedOn(h, { data: CHART_FIRST, provenance: CHART_P, pf: asked(NODES.first) });
    const r = decide(h, on.data, 0, on.provenance);
    if ("error" in r) throw new Error(r.error);
    const cell = NODES.first.grid!.cells["72o"]!;
    expect(r.decision.grade!.loss).toBeCloseTo(Math.max(...cell.ev!) - cell.ev![0]!, 6);
  });
  it("shows the solve's range after the decision, not the chart's under the solve's name", () => {
    const h = btn();
    const on = gradedOn(h, { data: CHART_OPENED, provenance: CHART_P, pf: asked(NODES.opened) });
    expect(rangeAt(h, on.data, on.provenance)!.grid).toBe(NODES.opened.grid);
  });
  it("gets to the worker and back as a preflop-solve answer on the real client", async () => {
    const sent: unknown[] = [];
    const transport = { kind: "worker", request: async (st: unknown) => (sent.push(st), NODES.opened), stopCost: () => "cheap", onStatus: () => () => {}, status: () => ({ phase: "ready", transport: "worker", crossOriginIsolated: false }), dispose: () => {} } as unknown as SolverTransport;
    const r = await new SolverClient(transport, "v").solve({ state: pfState(btn()), mode: "quick", untimed: true });
    expect(sent[0]).toMatchObject({ study: true, preflop_solve: true, speed: "fast" });
    expect(sent[0]).not.toHaveProperty("run");
    expect(r.provenance.source).toBe("preflop-solve");
    expect(pfRead(btn(), CHART_OPENED, r)).toHaveProperty("data");
  });
});

describe("a node it can't", () => {
  const with_ = (over: Partial<AdvisorResponse>): SolveResult => asked({ ...NODES.opened, ...over });
  const why = (h: PracticeHand, chart: AdvisorResponse, node: PfAsked | undefined) => {
    const r = pfRead(h, chart, node);
    if (!("why" in r)) throw new Error("it answered");
    return r.why;
  };

  it("leaves a blind's chart 3-bet to the chart: 10bb is no 12bb, whichever you pick", () => {
    const h = bb();
    const held: HeldAnswer = { data: CHART_BB, provenance: CHART_P, pf: asked(NODES.offSize) };
    const on = gradedOn(h, held);
    expect(on.pfWhy).toMatch(/raise 10bb, call, fold.*raise 12bb, call, fold/);
    for (const i of [0, 1, 2]) {
      const r = decide(h, on.data, i, on.provenance, undefined, on.pfWhy);
      if ("error" in r) throw new Error(r.error);
      expect(r.decision.grade!.byEv).toBe(false);
      expect(r.decision.provenance).toBe(CHART_P);
      expect(r.decision.pfWhy).toBe(on.pfWhy);
      expect(r.decision.study).not.toContain("pf=solver");
      expect(r.decision.mix.every((a) => a.ev === null)).toBe(true);
    }
  });
  it("won't take a line the engine played at another size", () => {
    const line: Move[] = [...OPEN, { pos: "BTN", action: "raise", to: 9 }];
    const h = spot("SB", ["Ah", "Kd"], line);
    expect(why(h, { ...CHART_OPENED, pot_bb: 13 }, asked(NODES.other))).toMatch(/left the solve's sizes.*played as the solve's size/);
  });
  it("catches an all-in the tree took for its raise, which comes with no note, by the chips", () => {
    expect(why(btn(), CHART_OPENED, with_({ pot_bb: 9 }))).toMatch(/The chips in aren't the solve's: the pot is 4bb here and 9bb/);
    expect(why(btn(), CHART_OPENED, with_({ to_call_bb: 5 }))).toMatch(/The chips in/);
  });
  it("won't grade by a line the solve rarely plays", () => {
    expect(why(btn(), CHART_OPENED, with_({ rough: true }))).toMatch(/rarely plays/);
  });
  it("has no EV for a class it has folded", () => {
    const cells = { ...NODES.opened.grid!.cells };
    delete cells.AKo;
    expect(why(btn(), CHART_OPENED, with_({ grid: { ...NODES.opened.grid!, cells } }))).toMatch(/has folded AKo/);
  });
  it("won't take options of another kind, one more or one less", () => {
    expect(why(btn(), { ...CHART_OPENED, actions: CHART_OPENED.actions!.slice(0, 2) }, asked(NODES.opened))).toMatch(/options aren't yours/);
    expect(why(btn(), { ...CHART_OPENED, actions: [...CHART_OPENED.actions!.slice(0, 2), { action: "all-in", freq: 0.3, amount_bb: 100 }] }, asked(NODES.opened))).toMatch(/options aren't yours/);
  });
  it("says so where the solve wasn't to be had, and starts nothing", () => {
    expect(why(btn(), CHART_OPENED, undefined)).toMatch(/wasn't asked/);
    expect(why(btn(), CHART_OPENED, { failed: "the worker died" })).toMatch(/couldn't be read: the worker died/);
    expect(why(btn(), CHART_OPENED, asked(NODES.unsolved))).toMatch(/no decision here/);
    expect(why(btn(), CHART_OPENED, asked({ error: "UTG can't fold here" }))).toMatch(/tree doesn't hold this line: UTG can't fold here/);
    expect(why(btn(), CHART_OPENED, with_({ actor: "CO" }))).toMatch(/another seat/);
  });
  it("won't call anything but the stored solve the stored solve", () => {
    const st = NODES.opened.pf_solve as object;
    expect(why(btn(), CHART_OPENED, with_({ pf_solve: { ...st, stored: false, cached: true } }))).toMatch(/wasn't the stored/);
    expect(why(btn(), CHART_OPENED, with_({ pf_solve: { ...st, done: false } }))).toMatch(/wasn't the stored/);
  });
  it("is the chart's answer as ever without the option, and from the flop on", () => {
    const h = { ...btn() };
    delete h.pfSolve;
    const held: HeldAnswer = { data: CHART_OPENED, provenance: CHART_P };
    expect(gradedOn(h, held)).toBe(held);
  });
});

describe("at the solve's raise sizes", () => {
  const sized = (hero: string, hole: [string, string], line: Move[]) => spot(hero, hole, line, { pfSizes: true });
  const CHART_SB: AdvisorResponse = { street: "preflop", pot_bb: 11.5, actions: [{ action: "fold", freq: 0.9 }, { action: "call", freq: 0.05 }, { action: "raise", freq: 0.05, amount_bb: 17 }] };
  const threeBet: Move[] = [...OPEN, { pos: "BTN", action: "raise", to: 7.5 }];

  it("comes with the option and only with it, and goes on from hand to hand", () => {
    expect(newHand(6, 100, 0, 7, { pfSizes: true }).pfSizes).toBeUndefined();
    expect(newHand(6, 100, 0, 7, { pfSolve: true }).pfSizes).toBeUndefined();
    expect(sized("BB", ["Ah", "Kd"], toBb).pfSizes).toBe(true);
    expect(following(sized("BB", ["Ah", "Kd"], toBb), 3, { pfSolve: true, pfSizes: true }).pfSizes).toBe(true);
    expect(following(sized("BB", ["Ah", "Kd"], toBb), 3, { pfSolve: true, pfSizes: true, pot: "lib" }).pfSizes).toBeUndefined();
  });
  it("puts the solve's 12bb on a blind's button, and grades the three moves by EV", () => {
    const h = sized("BB", ["Ah", "Kd"], toBb);
    const held: HeldAnswer = { data: CHART_BB, provenance: CHART_P, pf: asked(NODES.offSize) };
    expect(optionsAt(h, held).map((a) => [a.action, a.amount_bb])).toEqual([["raise", 12], ["call", undefined], ["fold", undefined]]);
    const on = gradedOn(h, held);
    expect(on.pfWhy).toBeUndefined();
    expect(on.provenance.source).toBe("preflop-solve");
    for (const i of [0, 1, 2]) {
      const r = decide(h, on.data, i, on.provenance);
      if ("error" in r) throw new Error(r.error);
      expect(r.decision.grade!.byEv).toBe(true);
    }
    const raise = decide(h, on.data, 0, on.provenance);
    if ("error" in raise) throw new Error(raise.error);
    expect(raise.decision.move).toEqual({ pos: "BB", action: "raise", to: 12 });
  });
  it("leaves the chart's 10bb on the button without the second box, as ever", () => {
    const h = bb();
    const held: HeldAnswer = { data: CHART_BB, provenance: CHART_P, pf: asked(NODES.offSize) };
    expect(optionsAt(h, held)[0]!.amount_bb).toBe(10);
    expect(gradedOn(h, held).pfWhy).toMatch(/raise 10bb/);
  });
  it("plays a raise the table's half big blind wouldn't reach at its own size, or it would leave the solve's tree", () => {
    const h = sized("SB", newHand(6, 100, 0, 7).hands.SB!, threeBet);
    const on = gradedOn(h, { data: CHART_SB, provenance: CHART_P, pf: asked({ ...NODES.other, notes: [] }) });
    expect(on.pfWhy).toBeUndefined();
    const r = decide(h, on.data, 2, on.provenance);
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.move).toEqual({ pos: "SB", action: "raise", to: 17.25 });
    expect(r.decision.mix[2]!.amount).toBe(17.25);
    // the table carries on from it, and it's kept to the quarter
    const kept = keptHand(JSON.parse(JSON.stringify(r.hand)));
    expect(kept!.pfSizes).toBe(true);
    expect(kept!.decisions[0]!.move).toEqual({ pos: "SB", action: "raise", to: 17.25 });
    expect(simOf(r.hand).current).toBe("preflop");
  });
  it("rounds nothing it didn't size: a chart's answer at the same table still goes to the half big blind", () => {
    const h = sized("SB", ["Ah", "Kd"], threeBet);
    const r = decide(h, { ...CHART_SB, actions: [{ action: "raise", freq: 1, amount_bb: 17.25 }] }, 0, CHART_P);
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.move.to).not.toBe(17.25);
  });
  it("offers the chart's size, and says why, wherever the solve doesn't grade the spot", () => {
    const h = sized("BB", ["Ah", "Kd"], toBb);
    const cells = Object.fromEntries(Object.entries(NODES.offSize.grid!.cells).filter(([k]) => k !== "AKo"));
    const gone: HeldAnswer = { data: CHART_BB, provenance: CHART_P, pf: asked({ ...NODES.offSize, grid: { ...NODES.offSize.grid!, cells } }) };
    expect(optionsAt(h, gone)[0]!.amount_bb).toBe(10);
    expect(gradedOn(h, gone).pfWhy).toMatch(/\w+ \w+/);
    const none: HeldAnswer = { data: CHART_BB, provenance: CHART_P };
    expect(optionsAt(h, none)[0]!.amount_bb).toBe(10);
    expect(gradedOn(h, none).provenance.source).toBe("charts");
  });
  it("won't line up a different set of moves whatever the sizes", () => {
    const h = sized("BB", ["Ah", "Kd"], toBb);
    const twoRaises: AdvisorResponse = { ...CHART_BB, actions: [...CHART_BB.actions!, { action: "raise", freq: 0, amount_bb: 20 }] };
    expect(gradedOn(h, { data: twoRaises, provenance: CHART_P, pf: asked(NODES.offSize) }).pfWhy).toMatch(/\w+ \w+/);
  });
  it("reads the same on a retry, at the size you had", () => {
    const h = sized("BB", ["Ah", "Kd"], toBb);
    const on = gradedOn(h, { data: CHART_BB, provenance: CHART_P, pf: asked(NODES.offSize) });
    const r = decide(h, on.data, 0, on.provenance);
    if ("error" in r) throw new Error(r.error);
    const again = pfAgain(asked(NODES.offSize), { hero: "BB", hole: "AhKd" }, r.decision.mix, r.decision.pot);
    if ("why" in again) throw new Error(again.why);
    expect(again.provenance.source).toBe("preflop-solve");
    expect(optionsOf(again.data)[0]!.amount_bb).toBe(12);
  });
  it("is kept on a hand and in a session's options, and reads no junk", () => {
    const kept = JSON.parse(JSON.stringify(sized("BB", ["Ah", "Kd"], toBb)));
    expect(keptHand(kept)?.pfSizes).toBe(true);
    expect(keptHand({ ...kept, pfSizes: "yes" })).toBeNull();
  });
});

describe("kept apart", () => {
  const graded = (h: PracticeHand, held: HeldAnswer, i = 1) => {
    const on = gradedOn(h, held);
    const r = decide(h, on.data, i, on.provenance, undefined, on.pfWhy);
    if ("error" in r) throw new Error(r.error);
    return r.decision;
  };
  const solveD = () => graded(btn(), { data: CHART_OPENED, provenance: CHART_P, pf: asked(NODES.opened) });
  const chartD = () => graded(bb(), { data: CHART_BB, provenance: CHART_P, pf: asked(NODES.offSize) });
  const session = () => {
    let s = freshSession(6, 100, { seat: "moves", preflopOnly: true, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, pfSolve: true });
    s = afterDecision(s, btn(), solveD());
    return afterDecision(s, bb(), chartD());
  };

  it("counts each under its own source and basis", () => {
    const s = session();
    expect(s.sources).toEqual({ "preflop-solve": 1, charts: 1 });
    const cells = Object.values(s.cells!);
    expect(cells.map((c) => [c.source, c.byEv]).sort()).toEqual([["charts", false], ["preflop-solve", true]]);
    expect(s.score.ne).toBe(1);
  });
  it("says each with its own share, and the session is marked in History", () => {
    const words = pfWords(session().cells)!;
    expect(words).toMatch(/1 by the preflop solve, by EV/);
    expect(words).toMatch(/1 by the charts, by frequency, no EV/);
    expect(pfWords({})).toBeNull();
    const rec = toRecord(session());
    expect(rec.meta!.pfSolve).toBe(true);
    expect(rowOf(rec).what).toContain("preflop graded by the preflop solve");
  });
  it("gives a street graded both ways a row a way in History, and a street graded one way one row", () => {
    const rows = streetTotals([toRecord(session())]).rows;
    expect(rows.map((r) => [r.street, r.basis, r.n, r.ne])).toEqual([["preflop", "ev", 1, 1], ["preflop", "freq", 1, 0]]);
    let one = freshSession(6, 100);
    one = afterDecision(one, bb(), chartD());
    expect(streetTotals([toRecord(one)]).rows[0]).not.toHaveProperty("basis");
  });
  it("keeps the preflop solve's figures apart from the charts' and a postflop solve's in the session's row", () => {
    const row = rowOf(toRecord(session()));
    expect(row.split.ways.solve?.n).toBe(1);
    expect(row.split.ways.freq?.n).toBe(1);
    const cells = addCell(undefined, "flop", "live", { ok: true, loss: 0, lossPct: 0, byEv: true });
    expect(rowOf({ id: "x", kind: "practice", startedAt: 1, endedAt: 2, decisions: 1, evLossBb: 0, meta: { cells } }).split).toEqual({ ways: { ev: { n: 1, ok: 1, loss: 0, lossPct: 0 } }, apart: 0 });
  });

  it("files a miss by the solve apart from a miss by the chart on the same spot", () => {
    const h = btn();
    const solved = handMistake("s", h, { ...solveD(), grade: { ...solveD().grade!, ok: false } }, 1)!;
    const chart = decide(h, CHART_OPENED, 0, CHART_P);
    if ("error" in chart) throw new Error(chart.error);
    const charted = handMistake("s", h, { ...chart.decision, grade: { ...chart.decision.grade!, ok: false } }, 1)!;
    expect(solved.id).not.toBe(charted.id);
    expect(spotKey(solved)).not.toBe(spotKey(charted));
    expect(solved.provenance!.source).toBe("preflop-solve");
    expect(charted.grade.byEv).toBe(false);
  });

  it("retries a miss by the solve against the solve, like with like", async () => {
    const h = btn();
    const d = solveD();
    const m = handMistake("s", h, { ...d, grade: { ...d.grade!, ok: false } }, 1)!;
    expect(m.ask).toEqual({ via: "solver", state: pfState(h) });
    const solve = vi.fn(async (_: SolveRequest) => asked(NODES.opened));
    const answer = await askAgain(m, async () => ({ solve }));
    expect(solve.mock.calls[0]![0]).toMatchObject({ state: pfState(h), untimed: true });
    expect(answer.provenance.source).toBe("preflop-solve");
    expect(answer.mix.map((a) => a.action)).toEqual(["fold", "call", "raise"]);
    expect(answerChange(m, answer)).toEqual([]);
    const t = retried(m, answer, 2, 5);
    expect(t.grade.byEv).toBe(true);
    expect(t.tried).toMatchObject({ source: "preflop-solve", like: true, byEv: true });
    expect(t.first).toEqual(gradeMix(answer.mix, answer.pot, 1));
  });
  it("says it can't, in words, where the solve won't answer the same way", async () => {
    const h = btn();
    const d = solveD();
    const m = handMistake("s", h, { ...d, grade: { ...d.grade!, ok: false } }, 1)!;
    if (m.ask.via !== "solver") throw new Error(m.ask.via);
    const client = (data: AdvisorResponse) => async () => ({ solve: async () => asked(data) });
    await expect(askSolver(m.ask, m.pot, client({ ...NODES.opened, rough: true }), "quick", undefined, m.mix)).rejects.toThrow(/rarely plays/);
    await expect(askSolver(m.ask, m.pot, client(NODES.unsolved), "quick", undefined, m.mix)).rejects.toThrow(/no decision here/);
    await expect(askSolver(m.ask, m.pot, client({ ...NODES.opened, pot_bb: 9 }), "quick", undefined, m.mix)).rejects.toThrow(/pot here is 9bb now/);
    const other = { ...NODES.opened, actions: NODES.opened.actions!.map((a) => (a.action === "raise" ? { ...a, amount_bb: 9 } : a)) };
    await expect(askSolver(m.ask, m.pot, client(other), "quick", undefined, m.mix)).rejects.toThrow(/aren't the ones you had/);
  });
  it("retries a decision the chart graded against the chart, whatever the session was set to", async () => {
    const h = bb();
    const d = chartD();
    const e = reviewed(h, d, 1);
    expect(e.state).not.toHaveProperty("preflop_solve");
    const spotAsked = retrySpot(e)!;
    const solve = vi.fn(async () => ({ data: CHART_BB, provenance: CHART_P }));
    const answer = await askAgain(spotAsked, async () => ({ solve }));
    expect(answer.provenance.source).toBe("charts");
    expect(answer.mix.every((a) => a.ev === null)).toBe(true);
  });
  it("retries a decision of this session the solve graded, through what the session keeps", () => {
    const e = reviewed(btn(), solveD(), 1);
    expect(e.state).toEqual(pfState(btn()));
  });
  it("names the solve's spot in Study only for a decision it graded", () => {
    expect(studyOf(btn())).not.toContain("pf=solver");
    expect(studyOf(btn(), true)).toContain("pf=solver");
  });
  it("stays kept over a reload, and reads no junk", () => {
    const h = spot("BB", ["2h", "3d"], toBb);
    const dealt = Object.fromEntries(Object.entries(h.hands).filter(([p]) => p !== "BB"));
    const fit = { ...h, hands: { ...dealt, BB: ["2h", "3d"] } as PracticeHand["hands"] };
    const clean = fit.hands.BB!.some((c) => Object.values(dealt).flat().includes(c) || fit.board.includes(c)) ? { ...fit, hands: { ...fit.hands, BB: newHand(6, 100, 0, 7).hands.BB! } } : fit;
    const kept = JSON.parse(JSON.stringify({ ...clean, decisions: [chartD()] }));
    expect(keptHand(kept)).toMatchObject({ pfSolve: true });
    expect(keptHand(kept)!.decisions[0]!.pfWhy).toBe(chartD().pfWhy);
    expect(keptHand({ ...kept, pfSolve: "yes" })).toBeNull();
    expect(keptHand({ ...kept, decisions: [{ ...kept.decisions[0], pfWhy: 3 }] })).toBeNull();
  });
  it("keeps it in a saved setup, and no setup can carry it where there's no stored solve", () => {
    const opts = { pfSolve: true };
    const s = readSetup({ players: 6, stack: 100, opts })!;
    expect(s.opts.pfSolve).toBe(true);
    expect(scenarioWords(s)).toContain("preflop graded by the preflop solve");
    expect(readSetup({ players: 6, stack: 100, opts: {} })!.opts).not.toHaveProperty("pfSolve");
    expect(readSetup({ players: 7, stack: 100, opts })).toBeNull();
    expect(readSetup({ players: 6, stack: 90, opts })).toBeNull();
    expect(readSetup({ players: 6, stack: 100, opts: { pfSolve: true, pot: "srp" } })).toBeNull();
    expect(readSetup({ players: 6, stack: 100, opts: { pfSolve: 1 } })).toBeNull();
  });
});
