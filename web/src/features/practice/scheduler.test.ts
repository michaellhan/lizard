// What goes to the solver next, and which table is in front (scheduler.ts): the estimates, the groups and their order,
// the queue, the front, and what happens to the flight. The Room's side of each is room.test.ts's.
import { describe, expect, it } from "vitest";
import type { AdvisorState } from "@/solver/protocol";
import { byPriority, estimate, group, plan, queue, refocus, SHORT, streetKey, type Front, type Job, type Waiter } from "./scheduler";

const state = (o: Partial<AdvisorState> = {}): AdvisorState => ({ players: 6, hero: "BTN", board: "", preflop: [], flop: [], turn: [], river: [], ...o });
const FLOP = "Kd7s2c";
const TURN = `${FLOP}9h`;
const RIVER = `${TURN}3d`;

const job = (key: string, o: Partial<Omit<Job, "need">> & { kind?: "you" | "opp" } = {}): Job => {
  const { kind = "you", ...rest } = o;
  return { table: 0, est: 2, seeking: false, since: 0, ...rest, need: { kind, key, state: state(), street: "flop" } };
};
const NO_SOLVES = new Set<string>();
const keys = (jobs: Job[]) => [...jobs].sort(byPriority).map((j) => j.need.key);

describe("a chart job", () => {
  const chart = (o: Partial<Job> = {}): Job => ({ table: 0, est: 0.05, seeking: true, since: 0, ...o, need: { kind: "chart", key: "chart|x", ck: "x", state: state(), street: "preflop" } });

  it("goes as any of a table's dealing does: group 2, behind your spot, level with an opponent's", () => {
    expect(group(chart())).toBe(2);
    const you = job("you", { est: 2 });
    const opp = job("opp", { kind: "opp", est: 2, since: 1 });
    expect([chart({ since: 2 }), opp, you].sort(byPriority).map((j) => j.need.key)).toEqual(["you", "opp", "chart|x"]);
    expect([opp, chart({ since: 0 })].sort(byPriority).map((j) => j.need.key)).toEqual(["chart|x", "opp"]);
  });
});

describe("estimate", () => {
  it("keeps the classic's seconds, by street and mode", () => {
    expect(estimate(state(), "quick", NO_SOLVES, "worker")).toBe(0.05);
    expect(estimate(state(), "accurate", NO_SOLVES, "worker")).toBe(0.05);
    const table: [string, number, number, number][] = [
      [FLOP, 2, 60, 30],
      [TURN, 2, 60, 30],
      [RIVER, 1.4, 24, 12],
    ];
    for (const [board, quick, worker, server] of table) {
      expect(estimate(state({ board }), "quick", NO_SOLVES, "worker")).toBe(quick);
      expect(estimate(state({ board }), "accurate", NO_SOLVES, "worker")).toBe(worker);
      expect(estimate(state({ board }), "accurate", NO_SOLVES, "http")).toBe(server);
    }
  });

  it("calls a flop the library holds on this line instant, once solved quicker still, and no other street", () => {
    const q = state({ board: FLOP });
    expect(estimate(q, "accurate", NO_SOLVES, "worker", true)).toBe(0.3);
    expect(estimate(q, "quick", NO_SOLVES, "worker", true)).toBe(0.3);
    expect(estimate(q, "accurate", new Set([streetKey(q, "accurate")]), "worker", true)).toBe(0.2);
    expect(estimate(state({ board: TURN }), "quick", NO_SOLVES, "worker", true)).toBe(2);
    expect(estimate(state(), "quick", NO_SOLVES, "worker", true)).toBe(0.05);
    expect(group({ est: estimate(q, "accurate", NO_SOLVES, "worker", true), seeking: false })).toBe(1);
  });

  it("calls a street solved this hand instant, at the mode it was solved at", () => {
    const q = state({ board: FLOP });
    const solved = new Set([streetKey(q, "accurate")]);
    expect(estimate(q, "accurate", solved, "worker")).toBe(0.2);
    expect(estimate(q, "quick", solved, "worker")).toBe(2);
  });
});

describe("streetKey", () => {
  const preflop = [{ pos: "BTN", action: "raise", to: 2.5 }];
  const check = { pos: "BB", action: "check" };

  it("is one key for every request on a street, whatever was done on it", () => {
    expect(streetKey(state({ board: FLOP, preflop, flop: [check] }), "quick")).toBe(streetKey(state({ board: FLOP, preflop }), "quick"));
    expect(streetKey(state({ board: TURN, turn: [check] }), "quick")).toBe(streetKey(state({ board: TURN }), "quick"));
  });

  it("differs by what the street's solve rests on: the seat, the cards, the line to it, the streets before, the mode", () => {
    const base = state({ board: TURN, preflop, flop: [check] });
    const key = streetKey(base, "quick");
    expect(streetKey({ ...base, hero: "BB" }, "quick")).not.toBe(key);
    expect(streetKey({ ...base, board: `${FLOP}8h` }, "quick")).not.toBe(key);
    expect(streetKey({ ...base, preflop: [] }, "quick")).not.toBe(key);
    expect(streetKey({ ...base, flop: [] }, "quick")).not.toBe(key);
    expect(streetKey(base, "accurate")).not.toBe(key);
    // (the river rests on the turn's actions too)
    expect(streetKey(state({ board: RIVER, turn: [check] }), "quick")).not.toBe(streetKey(state({ board: RIVER }), "quick"));
  });
});

describe("group", () => {
  it("puts a job in its group by how long it takes, the edges in the slower one", () => {
    const rows: [number, number][] = [
      [0.05, 1],
      [0.49, 1],
      [0.5, 2],
      [2, 2],
      [3.99, 2],
      [SHORT, 4],
      [60, 4],
    ];
    for (const [est, g] of rows) expect(group({ est, seeking: false })).toBe(g);
  });

  it("holds a table still dealing its pot in group 2, however quick its moves or long its solve", () => {
    expect(group({ est: 0.05, seeking: true })).toBe(2);
    expect(group({ est: 60, seeking: true })).toBe(2);
  });

  it("takes a look-ahead's group as given, over all of that", () => {
    expect(group({ est: 0.05, seeking: false, ahead: { g: 3, rank: 0 } })).toBe(3);
    expect(group({ est: 2, seeking: true, ahead: { g: 5, rank: 0 } })).toBe(5);
  });
});

describe("byPriority", () => {
  it("goes by group first", () => {
    expect(keys([job("long", { est: 60 }), job("short"), job("instant", { est: 0.05 })])).toEqual(["instant", "short", "long"]);
  });

  it("then yours before an opponent's, then the longest wanted, then the table's place", () => {
    expect(keys([job("opp", { kind: "opp", since: 1 }), job("you", { since: 2 })])).toEqual(["you", "opp"]);
    expect(keys([job("new", { since: 2 }), job("old", { since: 1 })])).toEqual(["old", "new"]);
    expect(keys([job("right", { table: 2 }), job("left", { table: 1 })])).toEqual(["left", "right"]);
  });

  it("lets a seeking table's next move fall behind the short solves that waited", () => {
    const short = job("short", { kind: "opp", since: 5 });
    expect(keys([job("seek", { kind: "opp", est: 0.05, seeking: true, since: 9 }), short])).toEqual(["short", "seek"]);
    expect(keys([job("seek", { est: 0.05, seeking: true, kind: "opp", since: 1 }), job("you", { since: 9 })])).toEqual(["you", "seek"]);
  });

  it("orders look-aheads by the quickest, then your likeliest line, then age, kinds aside", () => {
    const ahead = (g: 3 | 5, rank: number) => ({ ahead: { g, rank } });
    expect(keys([job("slow", { est: 2, ...ahead(3, 0) }), job("quick", { est: 0.2, kind: "opp", ...ahead(3, 1) })])).toEqual(["quick", "slow"]);
    expect(keys([job("second", ahead(3, 1)), job("first", { kind: "opp", ...ahead(3, 0) })])).toEqual(["first", "second"]);
    expect(keys([job("later", { since: 2, ...ahead(3, 0) }), job("earlier", { since: 1, ...ahead(3, 0) })])).toEqual(["earlier", "later"]);
  });

  it("puts the groups in the classic's order, a look-ahead at the front ahead of a long solve", () => {
    expect(keys([job("others", { ahead: { g: 5, rank: 0 } }), job("long", { est: 60 }), job("front", { ahead: { g: 3, rank: 0 } }), job("short"), job("instant", { est: 0.05 })])).toEqual([
      "instant",
      "short",
      "front",
      "long",
      "others",
    ]);
  });
});

describe("queue", () => {
  const w = (since: number | null, over = false): Waiter => ({ since, over });

  it("holds the tables waiting, in the order they started", () => {
    expect(queue([w(4), w(2), w(1)])).toEqual([2, 1, 0]);
    expect(queue([w(null), w(2), w(null)])).toEqual([1]);
    expect(queue([])).toEqual([]);
  });

  it("goes by table where they started together", () => {
    expect(queue([w(3), w(3), w(1)])).toEqual([2, 0, 1]);
  });
});

describe("refocus", () => {
  const w = (since: number | null, over = false): Waiter => ({ since, over });
  const at = (focus: number, o: Partial<Front> = {}): Front => ({ focus, focusAt: -Infinity, pin: false, next: false, ...o });

  it("keeps a front that's waiting, whoever has waited longer", () => {
    const f = at(1);
    expect(refocus(f, [w(1), w(2)], 10)).toBe(f);
  });

  it("brings the longest waiting forward where the front isn't waiting, and notes when", () => {
    expect(refocus(at(0), [w(null), w(5), w(3)], 10)).toEqual({ focus: 2, focusAt: 10, pin: false, next: false });
  });

  it("stays put, and sets no time, with nobody waiting", () => {
    expect(refocus(at(1, { focusAt: 7 }), [w(null), w(null)], 10)).toEqual(at(1, { focusAt: 7 }));
  });

  it("right after you act, the first in the queue, even where the table you acted at waits again at once", () => {
    expect(refocus(at(0, { next: true }), [w(5), w(3)], 10)).toEqual({ focus: 1, focusAt: 10, pin: false, next: false });
    // (it's the first: it stays, and that's no change of table to guard)
    expect(refocus(at(0, { next: true, focusAt: 2 }), [w(3), w(5)], 10)).toEqual({ focus: 0, focusAt: 2, pin: false, next: false });
  });

  it("holds a pick that isn't waiting until its hand ends", () => {
    const f = at(1, { pin: true });
    expect(refocus(f, [w(1), w(null)], 10)).toBe(f);
    expect(refocus(f, [w(1), w(null, true)], 10)).toEqual({ focus: 0, focusAt: 10, pin: false, next: false });
  });

  it("lets a pick go with nothing else to show, as it does when you act", () => {
    expect(refocus(at(1, { pin: true }), [w(null), w(null, true)], 10)).toEqual(at(1));
    expect(refocus(at(1, { pin: true, next: true }), [w(2), w(null)], 10)).toEqual({ focus: 0, focusAt: 10, pin: false, next: false });
  });

  it("finds a front for a table that's gone", () => {
    expect(refocus(at(3), [w(null), w(2)], 10)).toEqual({ focus: 1, focusAt: 10, pin: false, next: false });
  });
});

describe("plan", () => {
  const flying = (o: Partial<Job> = {}, stopping = false) => ({ job: job("a", o), stopping });
  const long = { est: 60 };

  it("sends the first job by priority, only with nothing in flight", () => {
    expect(plan(null, [], "cheap")).toEqual({ stop: false, same: null, launch: null });
    expect(plan(null, [job("long", long), job("instant", { est: 0.05 })], "cheap").launch?.need.key).toBe("instant");
    expect(plan(flying(), [job("b")], "kills").launch).toBeNull();
    expect(plan(flying({}, true), [job("b")], "cheap").launch).toBeNull();
  });

  it("leaves what it's given as it was", () => {
    const jobs = [job("long", long), job("instant", { est: 0.05 })];
    plan(null, jobs, "cheap");
    expect(jobs.map((j) => j.need.key)).toEqual(["long", "instant"]);
  });

  it("goes on with a flight still wanted, as the job it is now", () => {
    const now = job("a", { table: 1 });
    expect(plan(flying(), [now], "cheap")).toEqual({ stop: false, same: now, launch: null });
  });

  it("promotes a look-ahead your move made real: it stays in flight, and yields no more", () => {
    const real = job("a");
    const p = plan(flying({ ahead: { g: 3, rank: 0 } }), [real, job("b")], "cheap");
    expect(p.same).toBe(real);
    expect(p.stop).toBe(false);
  });

  it("stops a flight nobody needs, once, and waits for it to settle", () => {
    expect(plan(flying(), [], "cheap")).toEqual({ stop: true, same: null, launch: null });
    expect(plan(flying(), [job("b")], "cheap")).toEqual({ stop: true, same: null, launch: null });
    expect(plan(flying({}, true), [job("b")], "cheap")).toEqual({ stop: false, same: null, launch: null });
    expect(plan(flying({}, true), [job("a")], "cheap")).toEqual({ stop: false, same: null, launch: null });
  });

  it("stops a long solve for what's instant or short behind it (multitable.test.js:170), and only then", () => {
    expect(plan(flying(long), [job("a", long), job("b", { est: 0.05 })], "cheap").stop).toBe(true);
    expect(plan(flying(long), [job("a", long), job("b")], "cheap").stop).toBe(true);
    // (another long one, or nothing, behind it)
    expect(plan(flying(long), [job("a", long), job("b", long)], "cheap").stop).toBe(false);
    expect(plan(flying(long), [job("a", long)], "cheap").stop).toBe(false);
  });

  it("never stops a short solve for anything, an instant answer included", () => {
    expect(plan(flying(), [job("a"), job("b", { est: 0.05 })], "cheap").stop).toBe(false);
  });

  it("stops a look-ahead at the front for groups 1 and 2, not for what's behind it", () => {
    const ahead = { ahead: { g: 3, rank: 0 } as const };
    expect(plan(flying(ahead), [job("a", ahead), job("b")], "cheap").stop).toBe(true);
    expect(plan(flying(ahead), [job("a", ahead), job("b", long)], "cheap").stop).toBe(false);
    expect(plan(flying(ahead), [job("a", ahead), job("b", { ahead: { g: 5, rank: 0 } })], "cheap").stop).toBe(false);
  });

  it("yields to another table's job of the same key by that key's own place", () => {
    // (the same request at two tables isn't something waiting behind the flight)
    expect(plan(flying(long), [job("a", long), job("a", { ...long, table: 1 })], "cheap").stop).toBe(false);
  });

  it("stops a long solve for nothing slower than a short one, not for a look-ahead at the table in front", () => {
    expect(plan(flying(long), [job("a", long), job("b", { ahead: { g: 3, rank: 0 } })], "cheap").stop).toBe(false);
    expect(plan(flying({ ahead: { g: 5, rank: 0 } }), [job("a", { ahead: { g: 5, rank: 0 } }), job("b", long)], "cheap").stop).toBe(false);
  });

  describe("where a stop kills the worker", () => {
    it("never stops a needed flight, whatever waits behind it", () => {
      expect(plan(flying(long), [job("a", long), job("b", { est: 0.05 })], "kills")).toMatchObject({ stop: false, same: { need: { key: "a" } } });
    });

    it("lets a dead short solve run out: a reboot would cost more", () => {
      expect(plan(flying({ est: 2 }), [job("b")], "kills").stop).toBe(false);
      expect(plan(flying({ est: 3.99 }), [], "kills").stop).toBe(false);
    });

    it("stops a dead long one, from SHORT up", () => {
      expect(plan(flying({ est: SHORT }), [job("b")], "kills").stop).toBe(true);
      expect(plan(flying(long), [], "kills").stop).toBe(true);
    });

    it("sends nothing past a flight it won't stop", () => {
      expect(plan(flying(), [job("b")], "kills").launch).toBeNull();
    });
  });
});
