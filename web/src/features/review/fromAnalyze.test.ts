/// <reference types="node" />
// What comes to the review queue from Analyze: the entry a graded decision or a leak drill's pick makes, the rule for
// what's kept out, and a retry dealt from what the decision kept, with no solve.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type DecisionRecord, type HandRecord } from "@/data/db";
import { addMistake, keepMistake, listMistakes, readMistake } from "@/data/mistakes";
import { recordOf } from "@/features/analyze/analyze";
import { decisionId } from "@/features/analyze/grading";
import { gradePick } from "@/features/analyze/leakDrill";
import { importHand } from "@/hh/replay";
import { CAPPED_WORDS } from "@/grading/grade";
import { describe as sayProvenance } from "@/solver/provenance";
import { addedMistake, decisionOut, decisionProvenance, handOut, leakMistake } from "./fromAnalyze";
import { KEPT_RETRY_WORDS, answerChange, missedAgain, ORIGIN_WORDS, retried, withTry } from "./mistakes";
import { askAgain, keptAnswer } from "./retry";
import { dueAfter, QUEUE_RULE, REVIEW_DAYS, ADD_RULE } from "./schedule";

const text = readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", "stars_6max_srp.txt"), "utf8");
const r = importHand(text);
const hand: HandRecord = { ...recordOf(text, r, { id: "i1", name: "Hands", at: 1 }), id: "h1" };
const NOW = new Date(2026, 10, 5, 12).getTime();
const NEXT = dueAfter(NOW, 0);

const turn = (x: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: decisionId("h1", "turn", 1),
  handId: "h1",
  street: "turn",
  i: 1,
  pos: "BTN",
  action: "bet 3",
  matched: "bet 33%",
  verdict: "Mistake",
  evLossBb: 0.5,
  lossPct: 5.5,
  byEv: true,
  pot: 9.1,
  mix: [["check", 0.7, 3], ["bet 33%", 0.05, 2.5], ["bet 75%", 0.25, 2.9]],
  source: "live",
  label: "Live solve (Quick) · 0.80% pot from equilibrium in the solved game (converged) · 300 iterations · medium confidence",
  band: "converged",
  confidence: "medium",
  triageSource: "quick",
  version: "build:abc/123",
  gradedAt: 7,
  ...x,
});
const chartPre = (x: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: decisionId("h1", "preflop", 3),
  handId: "h1",
  street: "preflop",
  i: 3,
  pos: "BTN",
  action: "fold",
  matched: "fold",
  verdict: "Mistake",
  evLossBb: null,
  lossPct: null,
  mix: [["fold", 0.02, null], ["raise", 0.98, null]],
  source: "charts",
  label: "Preflop charts · approximate",
  approximate: true,
  gradedAt: 7,
  ...x,
});

beforeEach(async () => {
  await (await db())!.clear("mistakes");
});

describe("what's kept out", () => {
  it("says the rule on the page, and keeps tournaments and exploit sessions out, in words", () => {
    expect(QUEUE_RULE).toMatch(/every pick below Correct in a leak drill/);
    expect(QUEUE_RULE).toMatch(/only when you press Add to review/);
    expect(QUEUE_RULE).toMatch(/tournament hands and hands from exploit sessions stay out/);
    expect(ADD_RULE).toMatch(/Add to review keeps the one you choose/);
    expect(handOut(hand, new Set())).toBeNull();
    expect(handOut({ ...hand, tournament: "T" }, new Set())).toMatch(/A tournament hand stays out/);
    expect(handOut(hand, new Set(["i1"]))).toMatch(/A hand from an exploit session stays out/);
  });

  it("won't add what wasn't missed, or what can't be dealt again, and says why", () => {
    expect(addedMistake(turn({ verdict: "Correct" }), hand, r, NOW)).toBeNull();
    expect(addedMistake(turn({ verdict: "Not graded" }), hand, r, NOW)).toBeNull();
    expect(addedMistake(turn({ mix: undefined }), hand, r, NOW)).toBeNull();
    expect(decisionOut(turn({ mix: undefined }))).toBe("no mix was kept with its grade");
    expect(addedMistake(turn({ pot: 0 }), hand, r, NOW)).toBeNull();
    expect(decisionOut(turn({ pot: 0 }))).toBe("its EVs have no pot kept to measure a pick against");
    expect(decisionOut(turn())).toBeNull();
  });
});

describe("an entry from a graded decision", () => {
  it("keeps the mix, the pot, the grade as it stands and the first day of the schedule, and reads back whole", () => {
    const m = addedMistake(turn(), hand, r, NOW)!;
    expect(m).toMatchObject({ from: "analyze", street: "turn", seat: "BTN", chose: "bet 33%", pot: 9.1, step: 0, due: NEXT, times: 1, tries: [], ask: { via: "kept", hand: "h1", decision: turn().id } });
    expect(m.mix.map((a) => [a.action, a.freq, a.ev])).toEqual([["check", 0.7, 3], ["bet 33%", 0.05, 2.5], ["bet 75%", 0.25, 2.9]]);
    expect(m.grade).toMatchObject({ verdict: "Mistake", byEv: true, ok: false, a: 1, best: 0 });
    expect(m.board).toEqual((hand.board.match(/../g) ?? []).slice(0, 4));
    expect(m.study).toContain("p=");
    expect(readMistake(m)).toEqual(m);
    expect(ORIGIN_WORDS.analyze).toBe("Added from Analyze");
  });

  it("is a frequency entry from the charts, and never says solved", () => {
    const m = addedMistake(chartPre(), hand, r, NOW)!;
    expect(m.street).toBe("preflop");
    expect(m.grade.byEv).toBe(false);
    expect(m.provenance).toMatchObject({ source: "charts", approximate: true });
    expect(sayProvenance(m.provenance!)).toBe("Preflop charts · approximate");
    expect(readMistake(m)).toEqual(m);
  });

  it("has one entry a spot: the id Practice's has, and the same spot in another hand is the same", () => {
    const a = addedMistake(turn(), hand, r, NOW)!;
    expect(a.id).toMatch(/^hand\|p=/);
    expect(a.id.endsWith(`|${hand.hero}|${[...(hand.hole.match(/../g) ?? [])].sort().join("")}`)).toBe(true);
    const b = addedMistake(turn({ id: "other|turn|1", handId: "h2" }), { ...hand, id: "h2" }, r, NOW)!;
    expect(b.id).toBe(a.id);
  });

  it("stands with no hand to read: its own id, and what the decision says of the spot", () => {
    const m = addedMistake(turn(), hand, null, NOW)!;
    expect(m.id).toBe(`analyze|${turn().id}`);
    expect(m.study).toBeNull();
    expect(readMistake(m)).toEqual(m);
  });

  it("marks a rough EV action by action, an old grade's on the action played", () => {
    expect(addedMistake(turn({ roughEvs: ["bet 75%"] }), hand, r, NOW)!.mix.map((a) => a.rough)).toEqual([undefined, undefined, true]);
    expect(addedMistake(turn({ roughEv: true }), hand, r, NOW)!.mix.map((a) => a.rough)).toEqual([undefined, true, undefined]);
  });

  it("adds once: a second press leaves the entry, its step and tries, alone", async () => {
    const m = addedMistake(turn(), hand, r, NOW)!;
    expect(await addMistake(m)).toBe("added");
    await keepMistake({ ...m, step: 2 }, (_, f) => f);
    expect(await addMistake({ ...m, times: 9 })).toBe("there");
    const { list: mistakes } = await listMistakes();
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0]).toMatchObject({ step: 2, times: 1 });
  });
});

describe("the provenance a decision keeps", () => {
  it("is the grade's own: source, line, band, confidence and build, and a transport not guessed", () => {
    expect(decisionProvenance(turn())).toMatchObject({ source: "live", mode: "quick", band: "converged", confidence: "medium", transport: "worker", solverVersion: "abc/123" });
    expect(sayProvenance(decisionProvenance(turn()))).toBe(turn().label);
    const old = decisionProvenance(turn({ version: undefined, confidence: undefined, triageSource: undefined, label: "Live solve · 0.80%" }));
    expect(old).toMatchObject({ transport: "kept", solverVersion: "", mode: "fast" });
    expect(decisionProvenance(turn({ source: "made-up" }))).toMatchObject({ source: "unknown" });
    expect(decisionProvenance(turn({ source: "library", version: "library:srp:1", label: "Precomputed solution · srp_btn_bb" }))).toMatchObject({ source: "library", libraryVersion: "library:srp:1" });
    // a confidence the line doesn't say is added to it
    expect(sayProvenance(decisionProvenance(turn({ label: "A stored turn" })))).toBe("A stored turn · medium confidence");
  });
});

describe("a pick missed in a leak drill", () => {
  const pick = (d: DecisionRecord, a: number) => gradePick(d, a)!;

  it("is an entry by itself, with the pick and its grade; Best or Correct isn't", () => {
    const d = turn({ verdict: "Best", matched: "check" });
    const m = leakMistake(d, hand, r, pick(d, 1), "leak-drill|x", NOW)!;
    expect(m).toMatchObject({ from: "leak", sessionId: "leak-drill|x", chose: "bet 33%", street: "turn", due: NEXT, step: 0 });
    expect(m.grade.ok).toBe(false);
    expect(readMistake(m)).toEqual(m);
    expect(ORIGIN_WORDS.leak).toBe("From a leak drill");
    expect(leakMistake(d, hand, r, pick(d, 0), "s", NOW)).toBeNull();
  });

  it("merges into the spot's entry and starts the schedule over", async () => {
    const d = turn();
    const first = leakMistake(d, hand, r, pick(d, 1), "s", NOW)!;
    await keepMistake({ ...first, step: 3, due: NOW + 9 }, missedAgain);
    const worse = turn({ mix: [["check", 0.9, 3], ["bet 33%", 0.05, 2.5], ["bet 75%", 0.05, 2.9]] });
    await keepMistake(leakMistake(worse, hand, r, pick(worse, 2), "s", NOW + 5)!, missedAgain);
    const { list: mistakes } = await listMistakes();
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0]).toMatchObject({ times: 2, step: 0, chose: "bet 75%" });
  });
});

describe("a retry of an entry from Analyze", () => {
  it("reads the answer in the record and asks no solver, graded on the same answer", async () => {
    const m = addedMistake(turn(), hand, r, NOW)!;
    const getClient = vi.fn();
    const answer = await askAgain(m, getClient);
    expect(getClient).not.toHaveBeenCalled();
    expect(answer).toEqual({ mix: m.mix, pot: 9.1, provenance: m.provenance });
    expect(answerChange(m, answer)).toEqual([]);
    const t = retried(m, answer, 0, NOW + 86_400_000 * 2);
    expect(t.tried.like).toBe(true);
    expect(t.grade).toMatchObject({ verdict: "Best", byEv: true });
    expect(t.tried.source).toBe("live");
    expect(KEPT_RETRY_WORDS).toMatch(/nothing solved/);
  });

  it("grades by frequency where the mix has no EVs, and never as a solve", async () => {
    const m = addedMistake(chartPre(), hand, r, NOW)!;
    const t = retried(m, await askAgain(m, vi.fn()), 0, NOW);
    expect(t.grade).toMatchObject({ byEv: false, verdict: "Mistake" });
    expect(t.grade.ok).toBe(false);
    expect(t.tried.source).toBe("charts");
  });

  it("holds a rough solve's retry at an Inaccuracy, as the first grade was", async () => {
    const d = turn({ band: "rough", verdict: "Inaccuracy", capped: true, label: "Live solve · rough", mix: [["check", 0.95, 9], ["bet 33%", 0.05, 1]] });
    const m = addedMistake(d, hand, r, NOW)!;
    const t = retried(m, keptAnswer(m), 1, NOW);
    expect(t.grade).toMatchObject({ verdict: "Inaccuracy", capped: true });
    expect(CAPPED_WORDS).toMatch(/stops at Inaccuracy/);
  });

  it("moves the schedule as any retry does, and a miss goes back", () => {
    const m = addedMistake(turn(), hand, r, NOW)!;
    const later = NEXT! + 3_600_000;
    const good = withTry(m, retried(m, keptAnswer(m), 0, later).tried);
    expect(good).toMatchObject({ step: 1, due: dueAfter(later, 1) });
    expect(REVIEW_DAYS[1]).toBe(3);
    const bad = withTry(good, retried(good, keptAnswer(good), 1, good.due! + 1).tried);
    expect(bad.step).toBe(0);
  });

  it("says so where what answered it wasn't kept", async () => {
    const m = addedMistake(turn(), hand, r, NOW)!;
    await expect(askAgain({ ...m, provenance: null }, vi.fn())).rejects.toThrow("wasn't kept");
  });
});
