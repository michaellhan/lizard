// The Room (room.ts) on a fake client and a fake clock, at one table: what the page's effect loop used to do, and the
// rules that keep one request in flight. A stop here settles as the worker's does, about 0.1 s later, as a cancel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putSession } from "@/data/db";
import { addHands } from "@/data/hands";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import { SolverError, type PlayRequest, type Provenance, type SolveMode, type SolveRequest, type SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { DRILL_TRIES, newHand, optionsOf, type HandOptions } from "./practice";
import { Room, type RoomClient, type RoomOptions } from "./room";
import { plan, type Job } from "./scheduler";

vi.mock("@/data/db", async (orig) => ({ ...(await orig<typeof import("@/data/db")>()), putSession: vi.fn(async () => {}) }));
vi.mock("@/data/hands", async (orig) => ({ ...(await orig<typeof import("@/data/hands")>()), addHands: vi.fn(async () => ({ added: 1, existing: 0 })) }));

const OPTS: Required<HandOptions> = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };

const prov = (source: Provenance["source"]): Provenance => ({ source, approximate: source === "charts", mode: "quick", transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 });

const CHART: AdvisorResponse = {
  street: "preflop",
  pot_bb: 1.5,
  actions: [
    { action: "fold", freq: 0.1 },
    { action: "call", freq: 0.2 },
    { action: "raise 2.5", freq: 0.7, amount_bb: 2.5 },
  ],
};
const FLOP: AdvisorResponse = {
  street: "flop",
  pot_bb: 5,
  actions: [
    { action: "check", freq: 0.4, ev_bb: 2 },
    { action: "bet 33%", freq: 0.6, ev_bb: 2.2, amount_bb: 1.5 },
  ],
};

const move = (action: PlayMove["action"], to?: number): PlayMove => ({ pos: "", action, name: action, freq: 1, ...(to !== undefined ? { to } : {}) });

interface Asked {
  state: AdvisorState;
  play?: PlayRequest;
  mode?: SolveMode;
  signal?: AbortSignal;
  answer: (data: AdvisorResponse) => void;
  reject: (e: unknown) => void;
}

/** A solver that answers when told. `deaf`: a stop comes too late, and the request goes on to its answer. */
function fakeClient({ deaf = false } = {}) {
  const asked: Asked[] = [];
  const prefetched: AdvisorState[] = [];
  const ask = <T,>(req: Omit<Asked, "answer" | "reject">, source: Provenance["source"]) =>
    new Promise<SolveResult<T>>((resolve, reject) => {
      let settled = false;
      const a: Asked = {
        ...req,
        answer: (data) => {
          settled = true;
          resolve({ data: data as T, provenance: prov(source) });
        },
        reject: (e) => {
          settled = true;
          reject(e);
        },
      };
      asked.push(a);
      if (deaf) return;
      req.signal?.addEventListener("abort", () => {
        setTimeout(() => {
          if (!settled) a.reject(new SolverError("cancelled", "cancelled"));
        }, 100);
      });
    });
  const client: RoomClient = {
    solve: (req: SolveRequest) => ask<AdvisorResponse>({ state: req.state, mode: req.mode, signal: req.signal }, req.state.board ? "live" : "charts"),
    play: (state, play, opts) => ask<PlayMove>({ state, play, mode: opts?.mode, signal: opts?.signal }, "live"),
    prefetch: (state) => prefetched.push(state),
  };
  return { client, asked, prefetched };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const table = (room: Room) => room.snapshot().tables[0]!;

/** A Room writing nothing, on a clean clock; `players`, a session of that many begun before it starts (heads-up, you
 * act first; none, the 6-max hand it was built with: UTG acts first). */
function setup(o: RoomOptions & { players?: number; opts?: Required<HandOptions>; start?: boolean; deaf?: boolean } = {}) {
  const fake = fakeClient({ deaf: o.deaf });
  const room = new Room({ pace: 450, now: () => Date.now(), persist: false, seedOf: (n) => n + 1, ...o });
  const getSolver = vi.fn(async () => fake.client);
  room.setSolver(getSolver);
  if (o.players) room.startSession(o.players, 100, o.opts ?? OPTS);
  if (o.start !== false) room.start();
  rooms.push(room);
  return { room, getSolver, ...fake };
}
let rooms: Room[] = [];

/** Heads-up, to the flop with the big blind to act: your raise, its call, the card. */
async function toFlop(room: Room, asked: Asked[]) {
  await flush();
  asked.at(-1)!.answer(CHART);
  await flush();
  room.choose(2);
  await flush();
  asked.at(-1)!.answer(move("call"));
  await pass(0);
  await pass(1000);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(putSession).mockClear();
  vi.mocked(addHands).mockClear();
});

afterEach(() => {
  for (const r of rooms) r.stop();
  rooms = [];
  vi.useRealTimers();
  useSettings.setState({ mode: "fast", keepHands: false });
});

describe("Room at one table", () => {
  it("asks your spot, and grades your move against the whole answer, its provenance with it", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ mode: "quick", state: { hero: "SB" } });
    expect(asked[0]!.play).toBeUndefined();
    expect(table(room).answer).toBeNull();

    asked[0]!.answer(CHART);
    await flush();
    expect(optionsOf(table(room).answer?.data).map((a) => a.action)).toEqual(["fold", "call", "raise 2.5"]);
    room.choose(2);
    expect(table(room).last).toMatchObject({ chose: "raise 2.5", provenance: { source: "charts" } });
    expect(table(room).answer).toBeNull();
    expect(room.snapshot().session.score.n).toBe(1);
    expect(room.snapshot().session.review[0]).toMatchObject({ n: 1 });
  });

  it("takes no option until the answer's in hand, and says when the answer refuses one", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    room.choose(2);
    expect(table(room).last).toBeNull();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(7);
    expect(table(room).error).toBe("That action isn't in the answer.");
    expect(table(room).last).toBeNull();
    room.choose(2);
    expect(table(room).error).toBeNull();
  });

  it("leaves the hand alone when a late answer lands after New session", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    room.startSession(2, 100, OPTS);
    const dealt = table(room).hand;
    expect(asked[0]!.signal!.aborted).toBe(true);
    await flush();
    // (a stop too late: nothing else goes until it settles)
    expect(asked).toHaveLength(1);

    asked[0]!.answer(CHART);
    await flush();
    expect(table(room).hand).toBe(dealt);
    expect(table(room).answer).toBeNull();
    expect(asked).toHaveLength(2);
    expect(asked[1]!.state.hole).not.toBe(asked[0]!.state.hole);
  });

  it("leaves the hand alone when a late move lands after New session", async () => {
    const { room, asked } = setup({ deaf: true });
    await flush();
    expect(asked[0]!.play?.seat).toBe("UTG");
    room.startSession(6, 100, OPTS);
    asked[0]!.answer(move("raise", 2.5));
    await pass(1000);
    expect(table(room).hand.lines.preflop).toEqual([]);
  });

  it("keeps a whole answer that beat its stop, by key: back at that mode it needs no request", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    useSettings.setState({ mode: "accurate" });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    expect(asked).toHaveLength(2);
    expect(asked[1]!.mode).toBe("accurate");
    asked[1]!.answer(CHART);
    await flush();
    useSettings.setState({ mode: "fast" });
    await flush();
    expect(table(room).answer).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("holds the flight until a stopped request settles", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    room.startSession(2, 100, OPTS);
    await pass(99);
    expect(asked).toHaveLength(1);
    await pass(1);
    expect(asked).toHaveLength(2);
    expect(asked[1]!.signal!.aborted).toBe(false);
  });

  it("caches nothing from a cancel: a spot stopped and needed again is asked again", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    useSettings.setState({ mode: "accurate" });
    await pass(50);
    useSettings.setState({ mode: "fast" });
    await pass(50);
    expect(asked).toHaveLength(2);
    expect(asked[1]!.mode).toBe("quick");
    expect(asked[1]!.state).toEqual(asked[0]!.state);
    expect(table(room).answer).toBeNull();
    expect(table(room).failed).toBeNull();
  });

  it("reads a {cancelled} answer as a cancel, not an answer", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer({ cancelled: true });
    await flush();
    expect(table(room).answer).toBeNull();
    expect(table(room).failed).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("asks once more where a cancel came from nobody here, then says so rather than go round for ever", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.reject(new SolverError("cancelled", "solver disposed"));
    await flush();
    expect(asked).toHaveLength(2);
    expect(table(room).failed).toBeNull();
    asked[1]!.reject(new SolverError("cancelled", "solver disposed"));
    await flush();
    expect(asked).toHaveLength(2);
    expect(table(room).failed).toBe("Stopped.");
    room.retry();
    await flush();
    expect(asked).toHaveLength(3);
  });
});

describe("Room caches", () => {
  it("holds 400 answers, the oldest going first", async () => {
    // 401 deals with cards of their own (preflop, your cards are the key), then the newest and the oldest again
    const byCards = new Map<string, number>();
    for (let seed = 1; byCards.size < 401; seed += 1) {
      const cards = newHand(2, 100, 0, seed).hands.SB!.join("");
      if (!byCards.has(cards)) byCards.set(cards, seed);
    }
    const deals = [...byCards.values()];
    const seeds = [0, ...deals, deals[400]!, deals[0]!];
    const { room, asked } = setup({ seedOf: (n) => seeds[n]!, start: false });
    room.startSession(2, 100, OPTS);
    room.start();
    for (let i = 0; i < 401; i += 1) {
      await flush();
      asked.at(-1)!.answer(CHART);
      await flush();
      if (i < 400) room.startSession(2, 100, OPTS);
    }
    expect(asked).toHaveLength(401);
    room.startSession(2, 100, OPTS);
    await flush();
    expect(asked).toHaveLength(401);
    expect(table(room).answer).not.toBeNull();
    room.startSession(2, 100, OPTS);
    await flush();
    expect(asked).toHaveLength(402);
  });
});

describe("Room failures", () => {
  it("fails visibly on an advice {error}, which draws no options and isn't kept", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer({ error: "no such node" });
    await pass(5000);
    expect(table(room).failed).toBe("no such node");
    expect(table(room).answer).toBeNull();
    // (it waits for you: not asked again by itself)
    expect(asked).toHaveLength(1);
  });

  it("fails visibly on a move {error}: no check or call played in its place", async () => {
    const { room, asked } = setup();
    await flush();
    expect(asked[0]!.play?.seat).toBe("UTG");
    asked[0]!.answer({ error: "no such node" });
    await pass(5000);
    expect(table(room).failed).toBe("no such node");
    expect(table(room).hand.lines.preflop).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("fails visibly on a move the table can't take", async () => {
    const { room, asked } = setup();
    await flush();
    asked[0]!.answer(move("check"));
    await pass(1000);
    expect(table(room).failed).toMatch(/can't check/);
    expect(table(room).hand.lines.preflop).toEqual([]);
  });

  it("fails on a rejected request, by its message", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.reject(new Error("the solve failed"));
    await flush();
    expect(table(room).failed).toBe("the solve failed");
  });

  it("fails where the solver can't be had", async () => {
    const { room } = setup({ players: 2 });
    room.setSolver(async () => {
      throw new Error("no worker here");
    });
    await flush();
    expect(table(room).failed).toBe("no worker here");
  });

  it("says nothing on a new hand of a failure from the last one", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    room.startSession(2, 100, OPTS);
    asked[0]!.answer({ error: "no such node" });
    await flush();
    expect(table(room).failed).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("clears the failure on Retry, and asks again", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer({ error: "no such node" });
    await flush();
    room.retry();
    expect(table(room).failed).toBeNull();
    await flush();
    expect(asked).toHaveLength(2);
    asked[1]!.answer(CHART);
    await flush();
    expect(table(room).answer).not.toBeNull();
  });

  it("offers Play on for an opponent's failure: a check or call in the hand's line, never your decision", async () => {
    const { room, asked } = setup();
    await flush();
    asked[0]!.answer({ error: "no such node" });
    await flush();
    // (your own moves can't reach its seat)
    room.ungraded({ action: "fold" });
    expect(table(room).hand.lines.preflop).toEqual([]);
    expect(table(room).hand.decisions).toEqual([]);
    expect(table(room).last).toBeNull();

    room.playOn();
    expect(table(room).hand.lines.preflop).toEqual([{ pos: "UTG", action: "call" }]);
    expect(table(room).hand.decisions).toEqual([]);
    expect(table(room).last).toBeNull();
    expect(table(room).failed).toBeNull();
    await flush();
    expect(asked[1]!.play?.seat).toBe("HJ");
    expect(room.snapshot().session.score.n).toBe(0);
  });

  it("gives Play on nothing to do at your own spot, and takes your own moves there, ungraded", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer({ error: "no such node" });
    await flush();
    room.playOn();
    expect(table(room).hand.lines.preflop).toEqual([]);
    expect(table(room).failed).toBe("no such node");

    room.ungraded({ action: "fold" });
    expect(table(room).hand.lines.preflop).toEqual([{ pos: "SB", action: "fold" }]);
    expect(table(room).last).toMatchObject({ chose: "fold", grade: null, provenance: null });
    expect(table(room).hand.result?.folded).toBe(true);
    expect(room.snapshot().session.score.n).toBe(0);
    expect(room.snapshot().session.hands).toBe(1);
  });

  it("takes no ungraded move until your spot has failed", async () => {
    const { room } = setup({ players: 2 });
    await flush();
    room.ungraded({ action: "fold" });
    expect(table(room).hand.lines.preflop).toEqual([]);
  });
});

describe("Room modes", () => {
  it("asks again on a mode flip", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    expect(table(room).answer).not.toBeNull();
    useSettings.setState({ mode: "accurate" });
    await flush();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatchObject({ mode: "accurate", state: asked[0]!.state });
    expect(table(room).answer).toBeNull();

    // (the first answer's still in hand)
    asked[1]!.answer(CHART);
    await flush();
    useSettings.setState({ mode: "fast" });
    await flush();
    expect(asked).toHaveLength(2);
    expect(table(room).answer).not.toBeNull();
  });

  it("stops what the old mode asked, once it isn't needed", async () => {
    const { asked } = setup({ players: 2 });
    await flush();
    useSettings.setState({ mode: "accurate" });
    await flush();
    expect(asked[0]!.signal!.aborted).toBe(true);
    await pass(100);
    expect(asked[1]!.mode).toBe("accurate");
  });

  it("asks a failed spot again on a mode flip, either way", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer({ error: "no such node" });
    await flush();
    useSettings.setState({ mode: "accurate" });
    await flush();
    expect(table(room).failed).toBeNull();
    asked[1]!.answer({ error: "no such node" });
    await flush();
    useSettings.setState({ mode: "fast" });
    await flush();
    expect(asked).toHaveLength(3);
    expect(table(room).failed).toBeNull();
  });

  it("plays the mode it's given over Settings'", async () => {
    const { asked } = setup({ players: 2, mode: "fast" });
    useSettings.setState({ mode: "accurate" });
    await flush();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.mode).toBe("fast");
  });
});

describe("Room lifecycle", () => {
  it("launches once over start, stop, start", async () => {
    const { room, asked } = setup({ players: 2, start: false, persist: true, readKept: async () => undefined });
    room.start();
    room.stop();
    room.start();
    await pass(2000);
    expect(asked).toHaveLength(1);
  });

  it("launches once over start, stop, start with nothing to read first", async () => {
    const { room, asked } = setup({ players: 2, start: false });
    room.start();
    room.stop();
    room.start();
    await pass(2000);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.signal!.aborted).toBe(false);
  });

  it("launches once over two pumps: the flight is set before the first await", async () => {
    const { room, asked, getSolver } = setup({ players: 2 });
    room.pump();
    room.pump();
    // (nothing has settled yet, and the client hasn't been asked for twice)
    expect(getSolver).toHaveBeenCalledTimes(1);
    await flush();
    room.pump();
    await flush();
    expect(getSolver).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(1);
  });

  it("stops the flight on leaving, and sends nothing after, whatever comes in", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    room.stop();
    expect(asked[0]!.signal!.aborted).toBe(true);
    await pass(5000);
    room.pump();
    await pass(5000);
    expect(asked).toHaveLength(1);
  });

  it("sends nothing until the kept doc is read, and the hand shows meanwhile", async () => {
    let read = () => {};
    const { room, asked } = setup({ persist: true, readKept: () => new Promise<void>((r) => (read = r)) });
    expect(table(room).hand.players).toBe(6);
    await pass(500);
    expect(asked).toHaveLength(0);
    read();
    await flush();
    expect(asked).toHaveLength(1);
  });

  it("still deals at one table when the kept doc's read never settles", async () => {
    const { room, asked } = setup({ persist: true, readKept: () => new Promise(() => {}) });
    await pass(999);
    expect(asked).toHaveLength(0);
    await pass(1);
    expect(asked).toHaveLength(1);
    asked[0]!.answer(move("fold"));
    await pass(450);
    expect(table(room).hand.lines.preflop).toEqual([{ pos: "UTG", action: "fold" }]);
  });

  it("goes on when the read fails", async () => {
    const { asked } = setup({ persist: true, readKept: async () => Promise.reject(new Error("no database")) });
    await flush();
    expect(asked).toHaveLength(1);
  });

  it("lets a New session during the read win: asked at once, the read ignored", async () => {
    let read = () => {};
    const { room, asked } = setup({ persist: true, readKept: () => new Promise<void>((r) => (read = r)) });
    room.startSession(2, 100, OPTS);
    await flush();
    expect(asked).toHaveLength(1);
    const dealt = table(room).hand;
    read();
    await pass(2000);
    expect(asked).toHaveLength(1);
    expect(table(room).hand).toBe(dealt);
  });

  it("forgets a read from before a stop: only the last start's lets it go", async () => {
    const reads: (() => void)[] = [];
    const { room, asked } = setup({ persist: true, readKept: () => new Promise<void>((r) => reads.push(r)) });
    room.stop();
    room.start();
    expect(reads).toHaveLength(2);
    reads[0]!();
    await pass(500);
    expect(asked).toHaveLength(0);
    reads[1]!();
    await flush();
    expect(asked).toHaveLength(1);
  });

  it("forgets a read that settles while stopped: the next start reads again", async () => {
    const reads: (() => void)[] = [];
    const { room, asked } = setup({ persist: true, readKept: () => new Promise<void>((r) => reads.push(r)) });
    room.stop();
    reads[0]!();
    await pass(2000);
    room.start();
    await flush();
    expect(asked).toHaveLength(0);
    reads[1]!();
    await flush();
    expect(asked).toHaveLength(1);
  });

  it("uses a new getSolver on the next launch, and lets the old flight go at once", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    const next = fakeClient();
    room.setSolver(async () => next.client);
    await flush();
    expect(asked[0]!.signal!.aborted).toBe(true);
    expect(next.asked).toHaveLength(1);

    // an HTTP request outlives its client's dispose: its late answer is dropped
    asked[0]!.answer(CHART);
    await flush();
    expect(table(room).answer).toBeNull();
    next.asked[0]!.answer(CHART);
    await flush();
    expect(table(room).answer).not.toBeNull();
    expect(next.asked).toHaveLength(1);
  });

  it("drops what the last client answered once a new one is in use", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    const next = fakeClient();
    room.setSolver(async () => next.client);
    // (a flip sends the next launch, which finds the new client)
    useSettings.setState({ mode: "accurate" });
    await flush();
    expect(next.asked).toHaveLength(1);
    next.asked[0]!.answer(CHART);
    await flush();
    useSettings.setState({ mode: "fast" });
    await flush();
    expect(next.asked).toHaveLength(2);
    expect(table(room).answer).toBeNull();
  });

  it("goes on with the hand on another tab", async () => {
    const { room, asked } = setup();
    room.setActive(false);
    await flush();
    asked[0]!.answer(move("fold"));
    await pass(450);
    expect(table(room).hand.lines.preflop).toHaveLength(1);
    room.setActive(true);
    expect(table(room).hand.lines.preflop).toHaveLength(1);
  });

  it("tells each listener, gives the same snapshot until something changes, and stops telling once told to", async () => {
    const { room, asked } = setup({ players: 2 });
    const heard = vi.fn();
    const off = room.subscribe(heard);
    await flush();
    const snap = room.snapshot();
    expect(room.snapshot()).toBe(snap);
    asked[0]!.answer(CHART);
    await flush();
    expect(heard).toHaveBeenCalled();
    expect(room.snapshot()).not.toBe(snap);
    off();
    heard.mockClear();
    room.choose(2);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("Room pace", () => {
  it("holds a cached move until the pace has run", async () => {
    const { room, asked } = setup();
    await flush();
    asked[0]!.answer(move("fold"));
    await pass(449);
    expect(table(room).hand.lines.preflop).toEqual([]);
    await pass(1);
    expect(table(room).hand.lines.preflop).toEqual([{ pos: "UTG", action: "fold" }]);
  });

  it("asks at once, and takes a slow answer as it comes", async () => {
    const { room, asked } = setup();
    await flush();
    await pass(2000);
    asked[0]!.answer(move("fold"));
    await flush();
    expect(table(room).hand.lines.preflop).toHaveLength(1);
    // (and the next asked straight away, its pace from there)
    expect(asked).toHaveLength(2);
    asked[1]!.answer(move("fold"));
    await pass(449);
    expect(table(room).hand.lines.preflop).toHaveLength(1);
    await pass(1);
    expect(table(room).hand.lines.preflop).toHaveLength(2);
  });

  it("gives a card the pace too", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(2);
    await flush();
    await pass(450);
    asked[1]!.answer(move("call"));
    await flush();
    expect(table(room).hand.shown).toBe(0);
    await pass(449);
    expect(table(room).hand.shown).toBe(0);
    await pass(1);
    expect(table(room).hand.shown).toBe(3);
  });

  it("starts the pace again on Try again", async () => {
    const { room, asked } = setup();
    await flush();
    asked[0]!.answer({ error: "no such node" });
    await pass(1000);
    room.retry();
    await flush();
    asked[1]!.answer(move("fold"));
    await pass(449);
    expect(table(room).hand.lines.preflop).toEqual([]);
    await pass(1);
    expect(table(room).hand.lines.preflop).toHaveLength(1);
  });

  it("drops the pace's timer with the hand it was for", async () => {
    const { room, asked } = setup();
    await flush();
    asked[0]!.answer(move("fold"));
    await pass(100);
    room.startSession(2, 100, OPTS);
    await pass(1000);
    expect(table(room).hand.lines.preflop).toEqual([]);
    expect(table(room).hand.players).toBe(2);
  });
});

describe("Room hands", () => {
  it("deals a drill again with no wait, not counted, under its number", async () => {
    const { room, asked } = setup({ players: 2, opts: { ...OPTS, pot: "srp" } });
    await flush();
    expect(asked[0]!.play?.seat).toBe("SB");
    const first = table(room).hand;
    // (a limp and a raise-less line, off course as the flop comes: here your fold is off course at once)
    asked[0]!.answer(move("fold"));
    await flush();
    const again = table(room).hand;
    expect(again.seed).not.toBe(first.seed);
    expect(again).toMatchObject({ n: first.n, tries: 1, lines: { preflop: [] } });
    expect(room.snapshot().session).toMatchObject({ dealt: 1, hands: 0 });
    expect(asked).toHaveLength(2);
    // (its own preflop goes by at once too)
    asked[1]!.answer(move("raise", 2.5));
    await flush();
    expect(table(room).hand.lines.preflop).toEqual([{ pos: "SB", action: "raise", to: 2.5 }]);
  });

  it("stops a drill after its deals, and Try again deals afresh", async () => {
    const { room, asked } = setup({ players: 2, opts: { ...OPTS, pot: "srp" } });
    for (let i = 0; i < DRILL_TRIES; i += 1) {
      await flush();
      asked.at(-1)!.answer(move("fold"));
    }
    await pass(2000);
    expect(table(room).error).toBe(`No single-raised pot in ${DRILL_TRIES} deals.`);
    expect(table(room).failed).toBeNull();
    expect(asked).toHaveLength(DRILL_TRIES);

    room.retry();
    expect(table(room).error).toBeNull();
    expect(table(room).hand.tries).toBe(1);
    await flush();
    expect(asked).toHaveLength(DRILL_TRIES + 1);
  });

  it("runs a hand out from each seat's own view, your fold as it was", async () => {
    const { room, asked } = setup({ players: 3, pace: 0 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    const result = table(room).hand.result!;
    expect(result.folded).toBe(true);
    expect(asked).toHaveLength(1);

    room.runOut();
    await flush();
    expect(asked[1]).toMatchObject({ play: { seat: "SB" }, state: { hero: "SB" } });
    asked[1]!.answer(move("call"));
    await flush();
    expect(asked[2]).toMatchObject({ play: { seat: "BB" }, state: { hero: "BB" } });
    expect(table(room).hand.result).toBe(result);
    expect(room.snapshot().session.hands).toBe(1);

    // asked for once
    room.runOut();
    await flush();
    expect(asked).toHaveLength(3);
  });

  it("carries chips to the next hand, and Reset stacks starts every seat again", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, opts: { ...OPTS, carry: true } });
    await toFlop(room, asked);
    expect(table(room).hand.shown).toBe(3);
    asked.at(-1)!.answer(move("check"));
    await flush();
    asked.at(-1)!.answer(FLOP);
    await flush();
    room.choose(1);
    await flush();
    asked.at(-1)!.answer(move("fold"));
    await flush();
    expect(table(room).hand.result?.net).toBe(2.5);

    room.nextHand();
    expect(table(room).hand).toMatchObject({ n: 1, hero: "BB", stacks: { SB: 97.5, BB: 102.5 } });
    expect(room.snapshot().session).toMatchObject({ dealt: 2, hands: 1, net: 2.5 });
    await flush();
    expect(asked.at(-1)!.state).toMatchObject({ stacks: { SB: 97.5, BB: 102.5 } });

    // (play it to its end: a fold of yours, and the reset)
    asked.at(-1)!.answer(move("call"));
    await flush();
    expect(table(room).hand.hero).toBe("BB");
    asked.at(-1)!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    expect(table(room).hand.result).not.toBeNull();
    room.nextHand(true);
    expect(table(room).hand).toMatchObject({ n: 2, stacks: { SB: 100, BB: 100 } });
  });

  it("deals no next hand while this one's under way", async () => {
    const { room } = setup({ players: 2 });
    const dealt = table(room).hand;
    room.nextHand();
    expect(table(room).hand).toBe(dealt);
    expect(room.snapshot().session.dealt).toBe(1);
  });

  it("keeps History's record on a graded decision and at a hand's end, and not for a deal", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, persist: true, readKept: async () => undefined });
    await flush();
    expect(putSession).not.toHaveBeenCalled();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    // (your fold: one decision and the hand's end, one write)
    expect(putSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(putSession).mock.calls[0]![0]).toMatchObject({ decisions: 1, meta: { hands: 1 } });
    room.nextHand();
    await flush();
    expect(putSession).toHaveBeenCalledTimes(1);
  });

  it("keeps a hand in Analyze when asked, and every hand once set to", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, persist: true, readKept: async () => undefined });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    expect(addHands).not.toHaveBeenCalled();
    room.keep();
    expect(room.snapshot().kept).toMatchObject({ st: "saving" });
    await flush();
    expect(room.snapshot().kept).toMatchObject({ st: "kept", had: false });

    useSettings.setState({ keepHands: true });
    room.nextHand();
    await flush();
    asked.at(-1)!.answer(move("fold"));
    await flush();
    expect(table(room).hand.result).not.toBeNull();
    expect(addHands).toHaveBeenCalledTimes(2);
  });

  it("says where a hand couldn't be kept", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, persist: true, readKept: async () => undefined });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    vi.mocked(addHands).mockResolvedValueOnce(null);
    room.keep();
    await flush();
    expect(room.snapshot().kept).toMatchObject({ st: "error", message: "this browser keeps nothing here (a private window?)" });
    vi.mocked(addHands).mockRejectedValueOnce(new Error("quota"));
    room.keep();
    await flush();
    expect(room.snapshot().kept).toMatchObject({ st: "error", message: "quota" });
  });

  it("writes nothing with persist off: no record, no hand, no read", async () => {
    const readKept = vi.fn(async () => undefined);
    useSettings.setState({ keepHands: true });
    const { room, asked } = setup({ players: 2, pace: 0, readKept });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    room.keep();
    await flush();
    expect(readKept).not.toHaveBeenCalled();
    expect(putSession).not.toHaveBeenCalled();
    expect(addHands).not.toHaveBeenCalled();
    expect(room.snapshot().kept).toBeNull();
  });

  it("tells the client once a flop: the board cut to it, the streets after preflop emptied", async () => {
    const { room, asked, prefetched } = setup({ players: 2, pace: 0 });
    await toFlop(room, asked);
    expect(prefetched).toHaveLength(1);
    const dealt = table(room).hand;
    // (the preflop line stays: it names the library's spot, index.html:1137)
    expect(prefetched[0]).toMatchObject({ board: dealt.board.slice(0, 3).join(""), flop: [], turn: [], river: [], preflop: [{ pos: "SB", action: "raise", to: 2.5 }, { pos: "BB", action: "call" }] });

    // the turn: the same flop, not told again
    asked.at(-1)!.answer(move("check"));
    await flush();
    asked.at(-1)!.answer(FLOP);
    await flush();
    room.choose(0);
    await flush();
    expect(table(room).hand.shown).toBe(4);
    expect(prefetched).toHaveLength(1);
  });
});

describe("plan", () => {
  const job = (key: string): Job => ({ table: 0, need: { kind: "you", key, state: { players: 2 } as AdvisorState, street: "preflop" } });

  it("sends the next job only with nothing in flight", () => {
    expect(plan(null, [])).toEqual({ stop: false, launch: null });
    expect(plan(null, [job("a")]).launch?.need.key).toBe("a");
    expect(plan({ key: "a", stopping: false }, [job("a")])).toEqual({ stop: false, launch: null });
  });

  it("stops a flight nobody needs, once, and waits for it to settle", () => {
    expect(plan({ key: "a", stopping: false }, [])).toEqual({ stop: true, launch: null });
    expect(plan({ key: "a", stopping: false }, [job("b")])).toEqual({ stop: true, launch: null });
    expect(plan({ key: "a", stopping: true }, [job("b")])).toEqual({ stop: false, launch: null });
  });
});
