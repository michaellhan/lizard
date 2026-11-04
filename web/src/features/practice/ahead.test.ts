// Asking ahead's pure half (ahead.ts): your likeliest lines (practice.js:236-248), where a line's next request is, as the
// table will ask it, and what goes to the scheduler. When it runs, and how a flight goes, is room.test.ts's.
import { afterEach, describe, expect, it, vi } from "vitest";
import { noLines, type Lines, type Move } from "@/poker/table";
import type { AdvisorResponse, PlayMove } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { aheadJobs, ASK_AHEAD, habit, likely, meterLine, noteBad, readHabits, saveHabits, walk, type AheadContext, type Habits, type Peek } from "./ahead";
import { needOf } from "./flow";
import { dealNext, decide, newHand, simOf, villainMove, withVillain, type HandOptions, type PracticeHand } from "./practice";
import type { Asked } from "./scheduler";

const prov: Provenance = { source: "live", approximate: false, mode: "quick", transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 };
const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const SRP = [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")];
const CHECK = mv("BB", "check");

function spot(seed: number, hero: string, lines: Partial<Lines> = {}, shown = 0, o: HandOptions = {}): PracticeHand {
  return { ...newHand(6, 100, seed, seed, { ...o, seat: hero }), lines: { ...noLines(), ...lines }, shown };
}
const checkedTo = (seed: number) => spot(seed, "BTN", { preflop: SRP, flop: [CHECK] }, 3);
const firstOn = (seed: number) => spot(seed, "BB", { preflop: SRP }, 3);

const MIX: AdvisorResponse = {
  street: "flop",
  pot_bb: 5.5,
  actions: [
    { action: "check", freq: 0.4, ev_bb: 1 },
    { action: "bet 33%", amount_bb: 1.8, freq: 0.6, ev_bb: 1.2 },
  ],
};
const answer = (data: AdvisorResponse = MIX) => ({ data, provenance: prov });
const play = (action: PlayMove["action"], to?: number) => ({ data: { pos: "", action, name: action, freq: 1, ...(to !== undefined ? { to } : {}) } as PlayMove });
/** What a walk sees: nothing in hand. */
const peek = (o: Partial<Peek> = {}): Peek => ({ adv: new Set<string>(), moves: new Map(), bad: new Set<string>(), ...o });

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the default", () => {
  it("is off, until the engine check has measured it", () => {
    expect(ASK_AHEAD).toBe(false);
  });
});

describe("likely", () => {
  const stat = (action: string, freq: number, amount_bb?: number) => ({ action, freq, ...(amount_bb !== undefined ? { amount_bb } : {}) });
  const res = (...actions: ReturnType<typeof stat>[]): AdvisorResponse => ({ street: "flop", actions });
  const lines = (r: AdvisorResponse, facing = false, h: Habits = {}) => likely(r, facing, h).map((l) => l.i);

  it("takes your two likeliest, the likeliest first, each at least 20% likely", () => {
    const r = res(stat("check", 0.25), stat("bet 33%", 0.45, 1.8), stat("bet 75%", 0.3, 4));
    expect(likely(r, false, {})).toEqual([
      { i: 1, p: 0.45 },
      { i: 2, p: 0.3 },
    ]);
    expect(lines(res(stat("check", 0.19), stat("bet 33%", 0.81, 1.8)))).toEqual([1]);
    expect(lines(res(stat("check", 0.2), stat("bet 33%", 0.8, 1.8)))).toEqual([1, 0]);
  });

  it("never plays a fold on, however likely, nor a check facing a bet or a call facing none", () => {
    expect(lines(res(stat("fold", 0.9), stat("call", 0.1)), true)).toEqual([]);
    expect(lines(res(stat("fold", 0.5), stat("call", 0.5)), true)).toEqual([1]);
    expect(lines(res(stat("check", 0.5), stat("call", 0.5)), true)).toEqual([1]);
    expect(lines(res(stat("check", 0.5), stat("call", 0.5)), false)).toEqual([0]);
  });

  it("drops a size the answer doesn't give, and keeps an all-in, which has none", () => {
    expect(lines(res(stat("bet 33%", 0.5), stat("check", 0.5)))).toEqual([1]);
    expect(lines(res(stat("all-in", 0.5), stat("check", 0.5)))).toEqual([0, 1]);
  });

  it("gets nothing from an answer with no actions, or an error", () => {
    expect(likely({ street: "flop" }, false, {})).toEqual([]);
    expect(likely({ street: "flop", error: "no", actions: [stat("check", 1)] }, false, {})).toEqual([]);
  });

  it("goes by the mix alone until you've decided five of that kind of spot", () => {
    const r = res(stat("check", 0.3), stat("bet 33%", 0.7, 1.8));
    const four: Habits = { open: { fold: 0, pass: 4, aggr: 0 } };
    expect(likely(r, false, four)).toEqual([
      { i: 1, p: 0.7 },
      { i: 0, p: 0.3 },
    ]);
  });

  it("blends half and half with what you usually do from the fifth, sharing a kind by the mix", () => {
    const r = res(stat("check", 0.3), stat("bet 33%", 0.42, 1.8), stat("bet 75%", 0.28, 4));
    const got = likely(r, false, { open: { fold: 0, pass: 5, aggr: 0 } });
    // (always a check or call: half its mix plus half of all of it)
    expect(got.map((l) => l.i)).toEqual([0, 1]);
    expect(got[0]!.p).toBeCloseTo(0.5 * 0.3 + 0.5 * 1, 9);
    expect(got[1]!.p).toBeCloseTo(0.5 * 0.42, 9);
    const aggr = likely(r, false, { open: { fold: 0, pass: 1, aggr: 4 } });
    expect(aggr[0]!.i).toBe(1);
    expect(aggr[0]!.p).toBeCloseTo(0.5 * 0.42 + 0.5 * 0.8 * (0.42 / 0.7), 9);
  });

  it("reads the habits of the spot it's at, facing a bet or not", () => {
    const r = res(stat("fold", 0.1), stat("call", 0.3), stat("raise 9", 0.6, 9));
    const h: Habits = { facing: { fold: 0, pass: 10, aggr: 0 }, open: { fold: 0, pass: 0, aggr: 10 } };
    expect(lines(r, true, h)).toEqual([1, 2]);
    expect(lines(r, true, { open: h.open })).toEqual([2, 1]);
  });

  it("gives a kind the answer doesn't have no share, however often you take it", () => {
    const r = res(stat("check", 1));
    expect(likely(r, false, { open: { fold: 0, pass: 0, aggr: 9 } })).toEqual([{ i: 0, p: 0.5 }]);
    // (nor one it gives only at no frequency)
    const never = res(stat("check", 1), stat("bet 33%", 0, 1.8));
    expect(likely(never, false, { open: { fold: 0, pass: 0, aggr: 9 } })).toEqual([{ i: 0, p: 0.5 }]);
  });
});

describe("habits", () => {
  it("count a decision by what it was, facing a bet or not", () => {
    let h: Habits = {};
    h = habit(h, true, "fold");
    h = habit(h, true, "call");
    h = habit(h, false, "check");
    h = habit(h, false, "bet");
    h = habit(h, false, "raise");
    h = habit(h, false, "all-in");
    expect(h).toEqual({ facing: { fold: 1, pass: 1, aggr: 0 }, open: { fold: 0, pass: 1, aggr: 3 } });
  });

  it("leave what they were given as it was", () => {
    const was: Habits = { open: { fold: 0, pass: 1, aggr: 0 } };
    habit(was, false, "check");
    expect(was).toEqual({ open: { fold: 0, pass: 1, aggr: 0 } });
  });

  it("come back from this browser", () => {
    const h: Habits = { facing: { fold: 1, pass: 2, aggr: 3 }, open: { fold: 4, pass: 5, aggr: 6 } };
    saveHabits(h);
    expect(readHabits()).toEqual(h);
  });

  it("start from nothing where what's kept can't be read, a part of it included", () => {
    saveHabits({ facing: { fold: 1, pass: 2, aggr: 3 } });
    expect(readHabits().facing).toEqual({ fold: 1, pass: 2, aggr: 3 });
    const key = localStorage.key(0)!;
    for (const bad of ["{not json", "null", "7", JSON.stringify({ open: { fold: "1", pass: 0, aggr: 0 } }), JSON.stringify({ open: { fold: -1, pass: 0, aggr: 0 } }), JSON.stringify({ open: { pass: 1 } }), '{"open":{"fold":1e999,"pass":0,"aggr":0}}']) {
      localStorage.setItem(key, bad);
      expect(readHabits().open).toBeUndefined();
    }
  });

  it("get by where the browser keeps nothing: a read or a write that throws is a page without them", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readHabits()).toEqual({});
    expect(() => saveHabits({})).not.toThrow();
  });
});

describe("walk", () => {
  const real = (h: PracticeHand) => needOf(h, "quick") as Asked;

  it("asks what the table will: your bet's reply has the key of the real thing, from `decide`", () => {
    const h = checkedTo(1);
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    const need = walk(h, answer(), 1, "quick", peek());
    expect(need).toEqual(real(after.hand));
    expect(need).toMatchObject({ kind: "opp", play: { seat: "BB" }, street: "flop" });
  });

  it("deals the next street as the table will: a check behind asks the turn's first move", () => {
    const h = checkedTo(2);
    const after = decide(h, MIX, 0, prov);
    if ("error" in after) throw new Error(after.error);
    const need = walk(h, answer(), 0, "quick", peek());
    expect(need).toEqual(real(dealNext(after.hand, "turn")));
    expect(need!.state.board).toBe(h.board.slice(0, 4).join(""));
  });

  it("plays a move in hand as the table will, up to your next spot", () => {
    const h = firstOn(3);
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    const reply = real(after.hand);
    const moves = new Map([[reply.key, play("call")]]);
    const need = walk(h, answer(), 1, "quick", peek({ moves }));
    const called = withVillain(after.hand, villainMove(after.hand, moves.get(reply.key)!.data));
    expect(need).toEqual(real(dealNext(called, "turn")));
    expect(need).toMatchObject({ kind: "you", street: "turn" });
  });

  it("keeps the key through what a state carries beyond the moves: the game, the sizes, the mode", () => {
    const h = spot(4, "BB", { preflop: SRP }, 3, { ante: 0.5, straddle: true, rake: 5, rakeCap: 3, sizes: { flop: [50] } });
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    expect(walk(h, answer(), 1, "accurate", peek())).toEqual(needOf(after.hand, "accurate"));
    expect(walk(h, answer(), 1, "accurate", peek())!.key).not.toBe(walk(h, answer(), 1, "quick", peek())!.key);
  });

  it("plays a preflop on seat by seat, on the same keys a table with charts has", () => {
    const h = spot(5, "UTG");
    const chart: AdvisorResponse = { street: "preflop", pot_bb: 1.5, actions: [{ action: "raise 2.5", amount_bb: 2.5, freq: 1 }] };
    const after = decide(h, chart, 0, prov);
    if ("error" in after) throw new Error(after.error);
    const need = walk(h, answer(chart), 0, "quick", peek());
    expect(need).toEqual(needOf(after.hand, "quick", simOf(after.hand), new Map()));
    expect(need).toMatchObject({ kind: "opp", play: { seat: "HJ" } });
  });

  it("stops at a request that failed as a look-ahead, yours or theirs", () => {
    const h = firstOn(6);
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    const reply = real(after.hand);
    expect(walk(h, answer(), 1, "quick", peek({ bad: new Set([reply.key]) }))).toBeNull();
    const moves = new Map([[reply.key, play("call")]]);
    const next = walk(h, answer(), 1, "quick", peek({ moves }))!;
    expect(walk(h, answer(), 1, "quick", peek({ moves, bad: new Set([next.key]) }))).toBeNull();
  });

  it("stops at your next spot where its answer is in hand", () => {
    const h = firstOn(7);
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    const moves = new Map([[real(after.hand).key, play("call")]]);
    const next = walk(h, answer(), 1, "quick", peek({ moves }))!;
    expect(walk(h, answer(), 1, "quick", peek({ moves, adv: new Set([next.key]) }))).toBeNull();
  });

  it("stops where the line ends the hand: their fold, or the river checked down", () => {
    const h = firstOn(8);
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    expect(walk(h, answer(), 1, "quick", peek({ moves: new Map([[real(after.hand).key, play("fold")]]) }))).toBeNull();
    const river = spot(9, "BTN", { preflop: SRP, flop: [CHECK, mv("BTN", "check")], turn: [CHECK, mv("BTN", "check")], river: [CHECK] }, 5);
    expect(walk(river, answer(), 0, "quick", peek())).toBeNull();
  });

  it("stops at a move the table would refuse, rather than walking on a line nobody plays, and at an option the answer hasn't got", () => {
    const h = firstOn(10);
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    expect(walk(h, answer(), 1, "quick", peek({ moves: new Map([[real(after.hand).key, play("check")]]) }))).toBeNull();
    expect(walk(h, answer(), 9, "quick", peek())).toBeNull();
  });

  it("takes nothing: what's in hand is still there, and the hand is as it was", () => {
    const h = firstOn(11);
    const before = JSON.stringify(h);
    const after = decide(h, MIX, 1, prov);
    if ("error" in after) throw new Error(after.error);
    const moves = new Map([[real(after.hand).key, play("call")]]);
    const need = walk(h, answer(), 1, "quick", peek({ moves }));
    expect(walk(h, answer(), 1, "quick", peek({ moves }))).toEqual(need);
    expect(moves.size).toBe(1);
    expect(JSON.stringify(h)).toBe(before);
  });

  it("has nothing to walk from in a hand being dealt its pot: your own preflop there is played for you", () => {
    const seeking = { ...spot(12, "BTN", {}, 0, { pot: "3bet" }), lines: { ...noLines(), preflop: [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold")] } };
    expect(needOf(seeking, "quick")).toMatchObject({ kind: "opp", play: { seat: "BTN" } });
  });
});

describe("aheadJobs", () => {
  const ctx = (o: Partial<AheadContext> = {}): AheadContext => ({ ...peek(), mode: "quick", focus: 0, habits: {}, real: new Set(), est: () => 2, since: () => 1, ...o });
  const waiting = (table: number, hand: PracticeHand, data: AdvisorResponse = MIX) => ({ table, hand, answer: answer(data) as SolveResult });

  it("gives each waiting table its lines, in group 3 at the table in front and 5 at the others, by rank", () => {
    const jobs = aheadJobs([waiting(0, checkedTo(1)), waiting(1, checkedTo(2))], ctx({ focus: 1 }));
    expect(jobs.map((j) => [j.table, j.ahead])).toEqual([
      [0, { g: 5, rank: 0 }],
      [0, { g: 5, rank: 1 }],
      [1, { g: 3, rank: 0 }],
      [1, { g: 3, rank: 1 }],
    ]);
    expect(jobs.every((j) => j.seeking === false && j.since === 1 && j.est === 2)).toBe(true);
    // (the likeliest first: your bet, then your check)
    expect(jobs[0]!.need.state.board).toBe(checkedTo(1).board.slice(0, 3).join(""));
    expect(jobs[1]!.need.state.board).toBe(checkedTo(1).board.slice(0, 4).join(""));
  });

  it("asks ahead only what's short: under 4 s", () => {
    const hands = [waiting(0, checkedTo(1))];
    expect(aheadJobs(hands, ctx({ est: () => 3.99 }))).toHaveLength(2);
    expect(aheadJobs(hands, ctx({ est: () => 4 }))).toEqual([]);
    expect(aheadJobs(hands, ctx({ est: (_, n) => (n.state.board?.length === 6 ? 0.2 : 60) })).map((j) => j.est)).toEqual([0.2]);
  });

  it("marks nothing wanted where it won't be asked", () => {
    const since = vi.fn(() => 1);
    aheadJobs([waiting(0, checkedTo(1))], ctx({ est: () => 60, since }));
    expect(since).not.toHaveBeenCalled();
  });

  it("never doubles what a table wants for real, or another line's request", () => {
    const hand = checkedTo(1);
    const [bet, check] = aheadJobs([waiting(0, hand)], ctx());
    expect(aheadJobs([waiting(0, hand)], ctx({ real: new Set([bet!.need.key]) })).map((j) => j.need.key)).toEqual([check!.need.key]);
    expect(aheadJobs([waiting(0, hand), waiting(1, hand)], ctx())).toHaveLength(2);
  });

  it("reads your habits for which lines they are, from the spot you're at", () => {
    const facing = spot(13, "BTN", { preflop: SRP, flop: [mv("BB", "bet", 3)] }, 3);
    const data: AdvisorResponse = {
      street: "flop",
      pot_bb: 8.5,
      actions: [
        { action: "fold", freq: 0.1, ev_bb: 0 },
        { action: "call", freq: 0.6, ev_bb: 1 },
        { action: "raise 9", amount_bb: 9, freq: 0.3, ev_bb: 1 },
      ],
    };
    const jobs = (habits: Habits) => aheadJobs([waiting(0, facing, data)], ctx({ habits })).map((j) => j.need.state.flop!.at(-1)!.action);
    expect(jobs({})).toEqual(["call", "raise"]);
    expect(jobs({ facing: { fold: 0, pass: 0, aggr: 9 } })).toEqual(["raise", "call"]);
    // (open habits say nothing of a bet you face)
    expect(jobs({ open: { fold: 0, pass: 0, aggr: 9 } })).toEqual(["call", "raise"]);
  });
});

describe("what failed, and the meter", () => {
  it("forgets what failed past 500, so it's all asked again", () => {
    const bad = new Set<string>();
    for (let i = 0; i < 500; i += 1) noteBad(bad, String(i));
    expect(bad.size).toBe(500);
    noteBad(bad, "500");
    expect(bad.size).toBe(0);
  });

  it("says what was used, what it saved and what it cost, in round seconds", () => {
    expect(meterLine({ asked: 52, used: 31, savedS: 43.6, spentS: 95.5 })).toBe("31 of 52 used · about 44 s of waiting saved for 96 s of solver time");
  });
});
