// Kept mistakes: what's kept from a graded decision, the like-with-like check, a retry's grade, the words for its cost.
import { describe, expect, it } from "vitest";
import type { Grade } from "@/grading/grade";
import type { DrillProblem } from "@/features/practice/drills";
import { newHand, type Decision } from "@/features/practice/practice";
import type { LibraryReport } from "@/library/files";
import { CHART, chartMistake, DAY_ONE, LIVE, mistake, STORED } from "@/test/mistake";
import { answerChange, costWords, drillMistake, drillMix, handMistake, missedAgain, retried, TRIES_KEPT, withTry, type RetryAnswer } from "./mistakes";

const grade = (x: Partial<Grade>): Grade => ({ a: 0, best: 1, verdict: "Mistake", ok: false, mixed: false, loss: 0.5, lossPct: 8, byEv: true, ...x }) as Grade;
const decision = (g: Grade | null, x: Partial<Decision> = {}): Decision => ({
  street: "flop",
  chose: "check",
  move: { pos: "BTN", action: "check" },
  grade: g,
  mix: mistake().mix,
  pot: 5.5,
  provenance: LIVE,
  study: "p=6&s=100",
  ...x,
});
const answer = (x: Partial<RetryAnswer> = {}): RetryAnswer => ({ mix: mistake().mix, pot: 5.5, provenance: LIVE, ...x });

const REP = { label: "Single raised pot, BTN v BB", seats: ["BB", "BTN"], game: { players: 6 }, pot: 5.5 } as unknown as LibraryReport;
const PROBLEM: DrillProblem = {
  spot: "srp_btn_bb",
  flop: "Ac8c6c",
  path: [],
  player: 0,
  hero: "BB",
  board: ["Ad", "8d", "6d"],
  hand: ["Kh", "Qs"],
  combo: [10, 20],
  perm: [0, 1, 2, 3],
  names: ["check", "bet 33%"],
  freqs: [0.05, 0.95],
  evs: [3, 3.6],
  pot: 5.5,
  bet: 0,
};

describe("a mistake kept from play", () => {
  it("keeps a decision that lost EV, with its spot, its answer's provenance and its grade, due the next day", () => {
    const h = newHand(6, 100, 0, 1);
    const m = handMistake("s1", h, decision(grade({})), DAY_ONE)!;
    expect(m).toMatchObject({ from: "hand", sessionId: "s1", street: "flop", at: DAY_ONE, times: 1, chose: "check", provenance: LIVE, study: "p=6&s=100", step: 0, due: new Date(2026, 10, 3).getTime(), tries: [] });
    expect(m.grade).toMatchObject({ verdict: "Mistake", loss: 0.5, byEv: true });
    expect(m.ask).toMatchObject({ via: "solver" });
  });

  it("keeps nothing of a Best, a Correct or an ungraded decision", () => {
    const h = newHand(6, 100, 0, 1);
    expect(handMistake("s", h, decision(grade({ ok: true, verdict: "Best" })), 1)).toBeNull();
    expect(handMistake("s", h, decision(grade({ ok: true, verdict: "Correct" })), 1)).toBeNull();
    expect(handMistake("s", h, decision(null), 1)).toBeNull();
  });

  it("keeps a frequency grade as one", () => {
    const m = handMistake("s", newHand(6, 100, 0, 1), decision(grade({ byEv: false, loss: 0, lossPct: 0, verdict: "Inaccuracy" }), { street: "preflop", provenance: CHART, mix: chartMistake().mix, chose: "call" }), 1)!;
    expect(m.grade.byEv).toBe(false);
    expect(m.provenance?.source).toBe("charts");
  });

  it("counts the same spot missed again as one record, back at the start of the schedule, with its first day kept", () => {
    const was = mistake({ step: 2, due: 999, times: 2, tries: [] });
    const fresh = mistake({ at: DAY_ONE + 9, lastAt: DAY_ONE + 9, grade: { ...mistake().grade, verdict: "Blunder" } });
    expect(missedAgain(was, fresh)).toMatchObject({ at: DAY_ONE, lastAt: DAY_ONE + 9, times: 3, step: 0, due: fresh.due, grade: { verdict: "Blunder" } });
  });
});

describe("a drill's mistake", () => {
  it("keeps the library entry and the stored answer", () => {
    const g = grade({ a: 0 });
    const m = drillMistake("d1", REP, PROBLEM, g, STORED, "/study?p=6&s=100", "abc", DAY_ONE)!;
    expect(m).toMatchObject({ from: "drill", street: "flop", study: "p=6&s=100", chose: "check", hole: ["Kh", "Qs"], seat: "BB", game: REP.label });
    expect(m.ask).toEqual({ via: "library", spot: "srp_btn_bb", flop: "Ac8c6c", path: [], combo: [10, 20], version: "abc" });
    expect(drillMistake("d1", REP, PROBLEM, grade({ ok: true, verdict: "Best" }), STORED, null, "abc", DAY_ONE)).toBeNull();
    expect(drillMix(PROBLEM)).toEqual([{ action: "check", freq: 0.05, ev: 3 }, { action: "bet 33%", freq: 0.95, ev: 3.6, amount: 1.82 }]);
  });

  it("keeps a turn drill's street, card and line, as a separate spot, with no EV", () => {
    const turn: DrillProblem = { ...PROBLEM, path: ["check", "check"], board: ["Ad", "8d", "6d", "2h"], evs: null, pot: 5.5, turn: { card: "2h", at: ["check"], rangeEvs: null } };
    const g = grade({ byEv: false, loss: 0, lossPct: 0 });
    const m = drillMistake("d1", REP, turn, g, { ...STORED, source: "library-turn", approximate: true }, null, "abc", DAY_ONE)!;
    expect(m.street).toBe("turn");
    expect(m.ask).toMatchObject({ path: ["check", "check"], turn: { card: "2h", at: ["check"] } });
    expect(m.mix.every((a) => a.ev === null)).toBe(true);
    expect(m.id).not.toBe(drillMistake("d1", REP, { ...turn, turn: { ...turn.turn!, card: "3h" } }, g, STORED, null, "abc", DAY_ONE)!.id);
  });
});

describe("whether a retry is like with like", () => {
  it("is, on the same kind of answer", () => {
    expect(answerChange(mistake(), answer())).toEqual([]);
    expect(answerChange(chartMistake(), answer({ provenance: { ...CHART, receivedAt: 99 }, mix: chartMistake().mix }))).toEqual([]);
  });

  it("isn't, a live solve against a precomputed one", () => {
    const [c] = answerChange(mistake({ provenance: STORED }), answer());
    expect(c).toMatch(/first graded against Precomputed solution; the answer now is Live solve/i);
  });

  it("isn't, a chart against a solve", () => {
    expect(answerChange(chartMistake(), answer({ mix: chartMistake().mix }))[0]).toMatch(/charts/i);
  });

  it("isn't, a changed chart build", () => {
    expect(answerChange(chartMistake(), answer({ provenance: { ...CHART, solverVersion: "2.0" }, mix: chartMistake().mix }))).toEqual(["The charts' build has changed (1.0 then, 2.0 now)."]);
  });

  it("isn't, a changed library flop, by its version or its solve's numbers", () => {
    const m = mistake({ provenance: STORED, ask: { via: "library", spot: "srp_btn_bb", flop: "Ac8c6c", path: [], combo: [1, 2], version: "aaa" } });
    expect(answerChange(m, answer({ provenance: STORED, version: "aaa" }))).toEqual([]);
    expect(answerChange(m, answer({ provenance: STORED, version: "bbb" }))[0]).toMatch(/library has changed/);
    expect(answerChange(m, answer({ provenance: { ...STORED, iterations: 900 }, version: "aaa" }))[0]).toMatch(/library has changed/);
  });

  it("isn't, a stored answer at another version, and is where one side has none or only the id for stored turns moved", () => {
    const m = (libraryVersion?: string) => mistake({ provenance: { ...STORED, ...(libraryVersion ? { libraryVersion } : {}) } });
    const now = (libraryVersion?: string) => answer({ provenance: { ...STORED, ...(libraryVersion ? { libraryVersion } : {}) } });
    expect(answerChange(m("library:s:1:Ac8c6c:aa"), now("library:s:2:Ac8c6c:bb"))[0]).toMatch(/library has changed/);
    expect(answerChange(m("library:s:1:Ac8c6c:aa"), now("library:s:1:Ac8c6c:aa"))).toEqual([]);
    expect(answerChange(m(), now("library:s:1:Ac8c6c:aa"))).toEqual([]);
    expect(answerChange(m("library:*:aa"), now("library:*:bb"))).toEqual([]);
  });

  it("isn't, a solve at another mode, or other options, or one with no provenance kept", () => {
    expect(answerChange(mistake(), answer({ provenance: { ...LIVE, mode: "accurate" } }))).toEqual(["It was solved at quick; this time at accurate."]);
    expect(answerChange(mistake(), answer({ mix: [{ action: "check", freq: 1, ev: 4 }] }))).toEqual(["The options aren't the ones you had."]);
    expect(answerChange(mistake({ provenance: null }), answer())).toEqual(["What answered it the first time wasn't kept."]);
  });
});

describe("a retry's version", () => {
  it("is kept with the try, unknown where the answer has none", () => {
    expect(retried(mistake(), answer(), 0, 5).tried.version).toBe("build:1.0");
    expect(retried(mistake(), answer({ provenance: { ...LIVE, transport: "http" } }), 0, 5).tried).not.toHaveProperty("version");
    expect(retried(mistake({ provenance: STORED }), answer({ provenance: { ...STORED, libraryVersion: "library:s:1" } }), 0, 5).tried.version).toBe("library:s:1");
  });
});

describe("a retry", () => {
  it("is graded the way the decision was, by the current answer", () => {
    const r = retried(mistake(), answer(), 1, DAY_ONE + 1);
    expect(r.grade).toMatchObject({ verdict: "Best", ok: true });
    expect(r.change).toEqual([]);
    expect(r.first).toMatchObject({ a: 0, byEv: true }); // (this answer's grade of your first pick)
    expect(r.tried).toMatchObject({ chose: "bet 33%", verdict: "Best", ok: true, byEv: true, source: "live", like: true });
    expect(r.decision.provenance).toBe(LIVE);
  });

  it("stays a frequency grade on a chart, with no EV", () => {
    const m = chartMistake();
    const r = retried(m, answer({ mix: m.mix, provenance: CHART, pot: m.pot }), 1, 2);
    expect(r.grade).toMatchObject({ byEv: false, loss: 0 });
    expect(r.tried).toMatchObject({ byEv: false, loss: 0, source: "charts" });
  });

  it("says when your first pick isn't an option any more", () => {
    expect(retried(mistake(), answer({ mix: [{ action: "fold", freq: 0.2, ev: 0 }, { action: "call", freq: 0.8, ev: 1 }] }), 1, 2).first).toBeNull();
  });

  it("moves the schedule when due, and keeps the last ones", () => {
    const m = mistake();
    const t = retried(m, answer(), 1, m.due!).tried;
    expect(withTry(m, t)).toMatchObject({ step: 1, tries: [{ moved: true }] });
    const early = withTry(m, { ...t, at: m.due! - 1 });
    expect(early).toMatchObject({ step: 0, due: m.due, tries: [{ moved: false }] });
    let x = mistake({ due: null, step: 4 });
    for (let i = 0; i < TRIES_KEPT + 3; i++) x = withTry(x, { ...t, at: i });
    expect(x.tries).toHaveLength(TRIES_KEPT);
    expect(x.tries.at(-1)?.at).toBe(TRIES_KEPT + 2);
  });
});

describe("what a grade cost, in words", () => {
  it("gives EV lost by the answer's EVs", () => {
    expect(costWords(mistake().grade, mistake().mix, "live")).toBe("0.40bb lost · 7.3% pot");
  });

  it("never calls a frequency grade EV lost, and names the chart", () => {
    const m = chartMistake();
    const w = costWords(m.grade, m.mix, "charts");
    expect(w).toBe("by frequency, no EV: the chart plays it 3.0%");
    expect(w).not.toMatch(/\blost\b|\bbb\b|solve/);
  });
});
