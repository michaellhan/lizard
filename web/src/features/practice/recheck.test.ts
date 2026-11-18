// A Quick grade asked again at Fast (recheck.ts): which decisions are asked, in what order, the hand as it stood at each,
// and the move graded again against Fast's answer through the one entry point. The Room's side is room.test.ts's.
import { describe, expect, it } from "vitest";
import { DEEP_LOSS } from "@/features/analyze/triage";
import { noLines, type Move } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";
import { adviceState, dealNext, decide, finish, gradeMix, mixOf, practiceBasis, simOf, withVillain, type Decision, type PracticeHand } from "./practice";
import {
  activeAt,
  bounded,
  flagged,
  handAt,
  quickOf,
  RECHECK_DEEP,
  RECHECK_IDLE,
  RECHECK_KEEP,
  RECHECK_WORDS,
  recheckable,
  recheckAsk,
  recheckLine,
  recheckNote,
  recheckQueue,
  recheckWords,
  regraded,
  sameAtFast,
  type Waiting,
} from "./recheck";

const prov = (source: Provenance["source"], mode: Provenance["mode"] = "quick", o: Partial<Provenance> = {}): Provenance => ({ source, approximate: false, mode, transport: "worker", solverVersion: "test", partial: false, receivedAt: 0, ...o });

function fixed(players: number, hero: string, hands: Record<string, string>, board: string): PracticeHand {
  return {
    seed: 0,
    n: 4,
    players,
    stack: 100,
    hero,
    hands: Object.fromEntries(Object.entries(hands).map(([p, c]) => [p, [c.slice(0, 2), c.slice(2, 4)] as [string, string]])),
    board: board.match(/../g)!,
    shown: 0,
    lines: noLines(),
    decisions: [],
    result: null,
  };
}
const play = (h: PracticeHand, ...ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);

// heads-up, the big blind first to act on the flop: Quick says bet, Fast says check
const QUICK_FLOP: AdvisorResponse = {
  street: "flop",
  pot_bb: 5,
  actions: [
    { action: "check", freq: 0.05, ev_bb: 0.5 },
    { action: "bet 33%", freq: 0.95, ev_bb: 2, amount_bb: 1.5 },
  ],
};
const FAST_FLOP: AdvisorResponse = {
  street: "flop",
  pot_bb: 5,
  actions: [
    { action: "check", freq: 0.7, ev_bb: 2.1 },
    { action: "bet 33%", freq: 0.3, ev_bb: 2.08, amount_bb: 1.5 },
  ],
};
const FACING: AdvisorResponse = {
  street: "flop",
  pot_bb: 8,
  actions: [
    { action: "fold", freq: 0.2, ev_bb: 0 },
    { action: "call", freq: 0.7, ev_bb: 1.2 },
    { action: "raise 9", freq: 0.1, ev_bb: 1, amount_bb: 9 },
  ],
};

const ok = <T,>(r: T | { error: string }): T => {
  if (r && typeof r === "object" && "error" in r) throw new Error(String(r.error));
  return r as T;
};

/** The big blind's hand: called the button's open, checked the flop, called its bet, and on to the turn. */
function played() {
  let h = fixed(2, "BB", { SB: "AhKh", BB: "QdQc" }, "Kd7s2c9h3d");
  h = play(h, { pos: "SB", action: "raise", to: 2.5 }, { pos: "BB", action: "call" });
  h = dealNext(h, "flop");
  const at0 = h;
  const d0 = ok(decide(h, QUICK_FLOP, 0, prov("live", "quick", { exploitabilityPct: 0.5, band: "converged" })));
  h = play(d0.hand, { pos: "SB", action: "bet", to: 3 });
  const at1 = h;
  const d1 = ok(decide(h, FACING, 1, prov("live", "quick", { exploitabilityPct: 1, band: "converged" })));
  h = dealNext(d1.hand, "turn");
  return { h, at0, at1, d0: d0.decision, d1: d1.decision };
}

describe("which decisions are re-checked", () => {
  const { at0, d0 } = played();

  it("a Quick grade after the flop that Fast could answer otherwise", () => {
    expect(recheckable(d0, activeAt(at0))).toBe(true);
  });

  it("none Fast answers the same: the charts, the preflop solve, push/fold, the library's own spot, the rules where Fast leaves them too", () => {
    for (const source of ["charts", "preflop-solve", "push-fold"] as const) expect(sameAtFast({ street: "flop", provenance: prov(source) }, 2)).toBe(true);
    expect(sameAtFast({ street: "flop", provenance: prov("library") }, 2)).toBe(true);
    // (a borrowed spot is approximate: Fast can answer it otherwise)
    expect(sameAtFast({ street: "flop", provenance: prov("library", "quick", { approximate: true }) }, 2)).toBe(false);
    expect(sameAtFast({ street: "flop", provenance: prov("rules") }, 4)).toBe(false);
    expect(sameAtFast({ street: "flop", provenance: prov("rules") }, 5)).toBe(true);
    expect(sameAtFast({ street: "river", provenance: prov("rules") }, 5)).toBe(false);
    expect(sameAtFast({ street: "river", provenance: prov("rules") }, 6)).toBe(true);
    expect(sameAtFast({ street: "flop", provenance: prov("live") }, 2)).toBe(false);
    expect(recheckable({ ...d0, provenance: prov("library") }, 2)).toBe(false);
  });

  it("none revealed, off the profile, ungraded, preflop, or answered at Fast or Accurate already", () => {
    expect(recheckable({ ...d0, revealed: true }, 2)).toBe(false);
    expect(recheckable({ ...d0, offProfile: true }, 2)).toBe(false);
    expect(recheckable({ ...d0, grade: null }, 2)).toBe(false);
    expect(recheckable({ ...d0, street: "preflop" }, 2)).toBe(false);
    expect(recheckable({ ...d0, provenance: prov("live", "fast") }, 2)).toBe(false);
    expect(recheckable({ ...d0, provenance: prov("live", "accurate") }, 2)).toBe(false);
    expect(recheckable({ ...d0, provenance: null }, 2)).toBe(false);
  });

  it("none re-checked already, nor one that failed at it (never asked in a loop)", () => {
    expect(recheckable({ ...d0, quick: quickOf(d0)! }, 2)).toBe(false);
    expect(recheckable({ ...d0, recheckFailed: "Stopped twice." }, 2)).toBe(false);
  });
});

describe("flagged first", () => {
  const { d0, d1 } = played();
  const correct: Decision = { ...d1, grade: { ...d1.grade!, ok: true, verdict: "Correct", loss: 0, lossPct: 0 }, provenance: prov("live", "quick", { band: "converged" }) };

  it("flags as Analyze does: below Correct, capped, rough or approximate, leaning on the rules, low confidence, or DEEP_LOSS of the pot", () => {
    expect(RECHECK_DEEP).toBe(DEEP_LOSS);
    expect(d0.grade!.ok).toBe(false);
    expect(flagged(d0)).toBe(true);
    expect(flagged(correct)).toBe(false);
    expect(flagged({ ...correct, grade: { ...correct.grade!, capped: true } })).toBe(true);
    expect(flagged({ ...correct, provenance: prov("live", "quick", { band: "rough" }) })).toBe(true);
    expect(flagged({ ...correct, provenance: prov("live", "quick", { band: "approximate" }) })).toBe(true);
    expect(flagged({ ...correct, provenance: prov("instant", "quick", { approximate: true }) })).toBe(true);
    expect(flagged({ ...correct, provenance: prov("live", "quick", { leansOnRules: true }) })).toBe(true);
    expect(flagged({ ...correct, provenance: prov("live", "quick", { confidence: "low" }) })).toBe(true);
    expect(flagged({ ...correct, grade: { ...correct.grade!, loss: 0.02 * correct.pot } })).toBe(true);
    expect(flagged({ ...correct, grade: { ...correct.grade!, loss: 0.019 * correct.pot } })).toBe(false);
  });

  it("orders hand by hand: the hands with a flagged read first, then the latest hands first, a hand's decisions in street order", () => {
    const w = (n: number, k: number, f: boolean): Waiting & { id: string } => ({ n, k, flagged: f, id: `${n}.${k}${f ? "!" : ""}` });
    const xs = [w(1, 0, false), w(3, 1, false), w(3, 0, false), w(2, 2, true), w(2, 1, true), w(1, 1, true)];
    expect(recheckQueue(xs).map((x) => x.id)).toEqual(["2.1!", "2.2!", "1.0", "1.1!", "3.0", "3.1"]);
    // (a flagged turn never goes before its own flop: Fast's turn reads the flop's solve, which its own re-check runs on)
    expect(recheckQueue([w(7, 1, true), w(7, 0, false)]).map((x) => x.id)).toEqual(["7.0", "7.1!"]);
  });

  it("bounds the backlog, the oldest hands' dropped", () => {
    const xs = Array.from({ length: RECHECK_KEEP + 5 }, (_, n) => ({ n, k: 0, flagged: n === 0 }));
    const kept = bounded(xs);
    expect(kept).toHaveLength(RECHECK_KEEP);
    expect(Math.min(...kept.map((x) => x.n))).toBe(5);
  });
});

describe("the hand at a decision", () => {
  it("is the hand as it stood: the request a re-check sends is the one the table sent", () => {
    const { h, at0, at1 } = played();
    const back0 = handAt(h, 0)!;
    const back1 = handAt(h, 1)!;
    expect(adviceState(back0)).toEqual(adviceState(at0));
    expect(adviceState(back1)).toEqual(adviceState(at1));
    expect(back1.decisions).toHaveLength(1);
    expect(recheckAsk(back1).key).toBe(`recheck|${JSON.stringify(["fast", adviceState(at1)])}`);
  });

  it("is found once the hand has ended too, and not where the move isn't the decision's", () => {
    const { h, at0 } = played();
    const over = { ...h, result: finish(play(h, { pos: "BB", action: "fold" })) };
    expect(adviceState(handAt(over, 0)!)).toEqual(adviceState(at0));
    const off = { ...h, decisions: h.decisions.map((d, i) => (i === 0 ? { ...d, move: { ...d.move, action: "bet" as const, to: 1.5 } } : d)) };
    expect(handAt(off, 0)).toBeNull();
    expect(handAt(h, 7)).toBeNull();
  });
});

describe("graded again at Fast", () => {
  it("grades the same move through decide (gradeAnswer on practiceBasis) against Fast's answer, with its own provenance", () => {
    const { h, d0, at0 } = played();
    const fast = prov("live", "fast", { exploitabilityPct: 0.8, band: "converged" });
    const out = regraded(handAt(h, 0)!, d0, FAST_FLOP, fast);
    if ("why" in out) throw new Error(out.why);
    const now = out.decision;
    const expected = gradeMix(mixOf(FAST_FLOP), 5, 0, practiceBasis(FAST_FLOP, fast, simOf(at0)));
    expect(now.grade).toEqual(expected);
    expect(now.grade?.ok).toBe(true);
    expect(now.provenance).toMatchObject({ mode: "fast", source: "live", band: "converged" });
    expect(now.basis).toEqual(practiceBasis(FAST_FLOP, fast, simOf(at0)));
    expect(now.mix.map((a) => a.ev)).toEqual([2.1, 2.08]);
    expect(now.move).toEqual(d0.move);
    expect(now.study).toBe(d0.study);
    expect(now.quick).toEqual({ verdict: d0.grade!.verdict, ok: false, best: "bet 33%", byEv: true, loss: d0.grade!.loss, lossPct: d0.grade!.lossPct, source: "live" });
    expect(recheckWords(now)).toBe(`Re-checked at Fast: ${d0.grade!.verdict} → ${now.grade!.verdict}`);
  });

  it("finds your move by what it records, and says why where Fast's answer hasn't got it", () => {
    const { h, d1 } = played();
    const at = handAt(h, 1)!;
    const renamed: AdvisorResponse = { ...FACING, actions: FACING.actions!.map((a) => (a.action === "call" ? { ...a, action: "call 3" } : a)) };
    const out = regraded(at, d1, renamed, prov("live", "fast"));
    if ("why" in out) throw new Error(out.why);
    expect(out.decision.chose).toBe("call 3");
    const without: AdvisorResponse = { ...FACING, actions: FACING.actions!.filter((a) => a.action !== "call") };
    expect(regraded(at, d1, without, prov("live", "fast"))).toEqual({ why: "Fast's answer has no call here" });
    expect(regraded(at, d1, { error: "the solver failed" }, prov("live", "fast"))).toEqual({ why: "the solver failed" });
  });

  it("leaves Quick's solve standing where Fast falls back to the betting rules, and takes Fast's rules where Quick's were rules too", () => {
    const { h, d1 } = played();
    const at = handAt(h, 1)!;
    expect(regraded(at, d1, FACING, prov("rules", "fast", { approximate: true }))).toEqual({ why: "Fast's answer here is Heuristic rules (not a solve)" });
    expect(regraded(at, d1, FACING, prov("equity", "fast"))).toEqual({ why: "Fast's answer here is Equity estimate (not a solve)" });
    const rules = { ...d1, provenance: prov("rules", "quick", { approximate: true }) };
    const out = regraded(at, rules, FACING, prov("rules", "fast", { approximate: true }));
    expect("decision" in out && out.decision.quick?.source).toBe("rules");
  });

  it("says a grade that didn't move", () => {
    const { h, d1 } = played();
    const out = regraded(handAt(h, 1)!, d1, FACING, prov("live", "fast"));
    if ("why" in out) throw new Error(out.why);
    expect(recheckWords(out.decision)).toBe("Re-checked at Fast: same grade");
    expect(recheckWords(d1)).toBeNull();
  });
});

describe("what a page says of it", () => {
  const { h, d0 } = played();
  const graded = (quick: Provenance, fast: Provenance) => {
    const out = regraded(handAt(h, 0)!, { ...d0, provenance: quick }, FAST_FLOP, fast);
    if ("why" in out) throw new Error(out.why);
    return out.decision;
  };

  it("names each answer by what it was: a solve as one, the betting rules as not one, and points to Fast's badge, never calling it converged or not", () => {
    const solved = recheckNote(graded(prov("live"), prov("live", "fast", { band: "converged", exploitabilityPct: 0.4 })))!;
    expect(solved).toBe(
      `A Quick solve graded this ${d0.grade!.verdict} (its best: bet 33%); asked again at Fast while the solver was idle, the grade, strategy and EVs here are from the Fast solve, and it's counted that way. Fast's is a short solve too: how close it came to equilibrium is in its badge.`,
    );
    expect(solved).not.toMatch(/converged/);
    const ruled = recheckNote(graded(prov("rules", "quick", { approximate: true }), prov("live", "fast")))!;
    expect(ruled).toMatch(/^Quick's answer, Heuristic rules \(not a solve\), graded this /);
    expect(ruled).not.toMatch(/Quick solve/);
    const both = recheckNote(graded(prov("rules", "quick", { approximate: true }), prov("rules", "fast", { approximate: true })))!;
    expect(both).toMatch(/are from Fast's answer, Heuristic rules \(not a solve\)[,.]/);
    expect(both).not.toMatch(/solve too|Fast solve|Quick solve/);
  });

  it("says one that couldn't be re-checked, without a doubled stop, by what answered it", () => {
    expect(recheckNote({ ...d0, recheckFailed: "Stopped twice." })).toBe("Not re-checked at Fast (Stopped twice): this grade is on a Quick solve.");
    expect(recheckNote({ ...d0, provenance: prov("rules", "quick"), recheckFailed: "no such node" })).toBe("Not re-checked at Fast (no such node): this grade is on Quick's answer, Heuristic rules (not a solve).");
    expect(recheckNote(d0)).toBeNull();
  });

  it("gives the measure only for the reads it was taken on, and when one starts", () => {
    expect(RECHECK_WORDS).toContain("88% of the time where its solve settled, and nearest-flop and earlier-street reads 62%; an unsettled Quick solve and the betting rules weren't measured");
    expect(RECHECK_WORDS).toContain(`at your turn for ${RECHECK_IDLE} seconds`);
    expect(RECHECK_WORDS).not.toMatch(/converged|62% for its other reads/);
  });
});

describe("the status line", () => {
  it("says it's paused where the solver couldn't be reached", () => {
    expect(recheckLine({ on: true, left: 3, done: 1, changed: 1, failed: 0, paused: true })).toBe("Re-checks at Fast paused, the solver couldn't be reached: 3 left · 1 changed");
  });

  it("says what's left and what changed while it runs, and what was done once it's off", () => {
    expect(recheckLine({ on: true, left: 3, done: 2, changed: 1, failed: 0 })).toBe("Re-checking at Fast: 3 left · 1 changed");
    expect(recheckLine({ on: true, left: 0, done: 2, changed: 0, failed: 1 })).toBe("Re-checked at Fast: 2 done · 1 couldn't be graded");
    expect(recheckLine({ on: false, left: 4, done: 0, changed: 0, failed: 0 })).toBeNull();
    expect(recheckLine({ on: true, left: 0, done: 0, changed: 0, failed: 0 })).toBeNull();
  });
});
