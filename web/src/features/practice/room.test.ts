// The Room (room.ts) on a fake client and a fake clock: at one table, what the page's effect loop used to do and the rules
// that keep one request in flight; at several, what goes first, which table is in front and what each hand is dealt by. A
// stop here settles as the worker's does, about 0.1 s later, as a cancel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putSession } from "@/data/db";
import { keepMistake } from "@/data/mistakes";
import { spotKey } from "@/features/review/mistakes";
import { addHands } from "@/data/hands";
import { SolverClient } from "@/solver/client";
import type { AdvisorResponse, AdvisorState, PlayMove, WorkerInbound, WorkerOutbound } from "@/solver/protocol";
import { useRuntime } from "@/solver/runtime";
import { SolverError, type PlayRequest, type Provenance, type SolveMode, type SolveRequest, type SolveResult, type StopCost, type TransportKind } from "@/solver/types";
import { WorkerTransport } from "@/solver/worker-transport";
import { useSettings } from "@/state/settings";
import type { Lines, Move } from "@/poker/table";
import { noLines } from "@/poker/table";
import index from "@/library/fixtures/srp_btn_bb.flops.json";
import { candsFor, flopName, heldSpots, instantSpots } from "@/library/flops";
import { ASK_AHEAD, readHabits, saveHabits } from "./ahead";
import { practiceNumber } from "./history";
import { DRILL_TRIES, newHand, optionsOf, type HandOptions, type PracticeHand } from "./practice";
import { flopsNote, Room, seatOf, seatsFor, spotOf, type RoomClient, type RoomFlops, type RoomOptions, type Spot } from "./room";
import { keyOf } from "./session";

vi.mock("@/data/db", async (orig) => ({ ...(await orig<typeof import("@/data/db")>()), putSession: vi.fn(async () => {}) }));
vi.mock("@/data/mistakes", async (orig) => ({ ...(await orig<typeof import("@/data/mistakes")>()), keepMistake: vi.fn(async () => {}) }));
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

/** A solver that answers when told. `deaf`: a stop comes too late, and the request goes on to its answer. `stop`: what a
 * stop costs (null: it doesn't say, as PracticePage.test.tsx's stub doesn't). `preflop`: what answers before the flop. */
function fakeClient({ deaf = false, stop = "cheap" as StopCost | null, transport = "worker" as TransportKind, preflop = "charts" as Provenance["source"] } = {}) {
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
    solve: (req: SolveRequest) => ask<AdvisorResponse>({ state: req.state, mode: req.mode, signal: req.signal }, req.state.board ? "live" : preflop),
    play: (state, play, opts) => ask<PlayMove>({ state, play, mode: opts?.mode, signal: opts?.signal }, "live"),
    prefetch: (state) => prefetched.push(state),
    transport: { kind: transport },
    ...(stop ? { stopCost: () => stop } : {}),
  };
  return { client, asked, prefetched };
}

/** Stands in for the Pyodide worker, under the real client and transport: takes what it's sent, and says only what it's
 * told to, so unprompted it gives no answer and no pong. */
class FakeWorker {
  posted: WorkerInbound[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerOutbound>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(m: WorkerInbound) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: WorkerOutbound) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerOutbound>);
  }
  get asks() {
    return this.posted.filter((m): m is Extract<WorkerInbound, { state: unknown }> => "state" in m);
  }
  /** the flops it has been told */
  get told() {
    return this.posted.filter((m) => "prefetch" in m);
  }
  /** Up and answering the last request. */
  answer(result: unknown) {
    this.reply({ status: "Solving…" });
    this.reply({ id: this.asks.at(-1)!.id, result: result as AdvisorResponse });
  }
}

/** The real client and transport on fake workers, on a page that can share a stop flag. */
function realClient() {
  const workers: FakeWorker[] = [];
  const client = new SolverClient(
    new WorkerTransport({
      assetBase: "/s/",
      version: "v",
      libraryBase: "/l/",
      crossOriginIsolated: true,
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
    }),
    "test",
  );
  return { client, workers };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const table = (room: Room) => room.snapshot().tables[0]!;

/** A Room writing nothing, on a clean clock; `players`, a session of that many begun before it starts (heads-up, you
 * act first; none, the 6-max hand it was built with: UTG acts first). */
function setup(o: RoomOptions & { players?: number; opts?: Required<HandOptions>; start?: boolean; deaf?: boolean; stop?: StopCost | null; transport?: TransportKind; preflop?: Provenance["source"] } = {}) {
  const fake = fakeClient({ deaf: o.deaf, stop: o.stop === undefined ? "cheap" : o.stop, transport: o.transport, preflop: o.preflop });
  const room = new Room({ pace: 450, now: () => Date.now(), persist: false, seedOf: (n) => n + 1, readIndex: async () => null, ...o });
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
  // (what these tests deal by: Instant flops, which is what's dealt unless you choose, has its own below)
  useSettings.setState({ practiceSpot: "any" });
});

afterEach(() => {
  for (const r of rooms) r.stop();
  rooms = [];
  vi.useRealTimers();
  // (asking ahead is off here but where a test turns it on: most of these count what the solver is asked)
  useSettings.setState({ mode: "fast", keepHands: false, practiceSpot: null, practiceSeat: "random", askAhead: false });
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

describe("Room's Reveal", () => {
  it("shows the answer it already holds: no request, and the decision after it counts for nothing but the count", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    room.reveal(); // (no answer in hand: nothing to show)
    expect(table(room).hand.revealed).toBeUndefined();
    asked[0]!.answer(CHART);
    await flush();
    const before = room.snapshot().session;
    room.reveal();
    await flush();
    await pass(5000);
    expect(table(room).hand.revealed).toBe(true);
    expect(asked).toHaveLength(1); // no request beyond the decision's own
    expect(room.snapshot().session).toBe(before);

    room.choose(2);
    const { session } = room.snapshot();
    expect(table(room).last).toMatchObject({ grade: null, revealed: true, chose: "raise 2.5", provenance: { source: "charts" } });
    expect(table(room).hand.revealed).toBeUndefined();
    expect(session).toMatchObject({ revealed: 1, review: [], score: { n: 0 }, sources: before.sources });
  });

  it("grades the next decision of the hand as usual", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked.at(-1)!.answer(CHART);
    await flush();
    room.reveal();
    room.choose(2);
    await flush();
    asked.at(-1)!.answer(move("call"));
    await pass(0);
    await pass(1000);
    await flush();
    asked.at(-1)!.answer(move("check"));
    await pass(1000);
    asked.at(-1)!.answer(FLOP);
    await flush();
    room.choose(0);
    expect(table(room).last).toMatchObject({ chose: "check", grade: { verdict: expect.any(String) } });
    expect(table(room).last).not.toHaveProperty("revealed");
    expect(room.snapshot().session).toMatchObject({ revealed: 1, score: { n: 1 } });
  });

  it("stays ungraded over a change of mode: the flag is the hand's, whichever answer you then pick from", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked.at(-1)!.answer(CHART);
    await flush();
    room.reveal();
    useSettings.setState({ mode: "accurate" });
    await flush();
    expect(table(room).hand.revealed).toBe(true);
    if (table(room).answer === null) {
      asked.at(-1)!.answer(CHART);
      await flush();
    }
    room.choose(2);
    expect(table(room).last).toMatchObject({ grade: null, revealed: true });
    expect(room.snapshot().session.score.n).toBe(0);
  });

  it("is off above one table", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked.at(-1)!.answer(CHART);
    await flush();
    room.setTables(2);
    await flush();
    room.reveal();
    expect(room.snapshot().tables.every((t) => !t.hand.revealed)).toBe(true);
  });
});

describe("Room's retry", () => {
  const ask = (state: AdvisorState) => ({ state, mode: "quick" as const });

  it("answers from what's held, without asking; and asks where nothing's held, in turn", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(2);
    await flush();
    const e = room.snapshot().session.review[0]!;
    expect(e.state).toMatchObject({ hero: "SB" });
    const n = asked.length;
    const retry = await room.retryClient();
    await expect(retry.solve(ask(e.state!))).resolves.toMatchObject({ data: CHART, provenance: { source: "charts" } });
    expect(asked).toHaveLength(n);

    const other = { ...e.state!, hero: "BB" };
    const answer = retry.solve(ask(other));
    await flush();
    expect(asked).toHaveLength(n + 1);
    asked.at(-1)!.answer(FLOP);
    await expect(answer).resolves.toMatchObject({ data: FLOP });
  });

  it("changes no score", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(2);
    const before = room.snapshot().session;
    const retry = await room.retryClient();
    await retry.solve(ask(before.review[0]!.state!));
    expect(room.snapshot().session).toBe(before);
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

  it("asks a spot again in a new session, though the same cards come up: a failure stays with its session", async () => {
    const { room, asked } = setup({ players: 2, seedOf: () => 7 });
    await flush();
    asked[0]!.reject(new SolverError("unreachable", "could not reach the solver"));
    await flush();
    expect(table(room).failed).toBe("could not reach the solver");

    room.startSession(2, 100, OPTS);
    await flush();
    expect(asked).toHaveLength(2);
    expect(asked[1]!.state).toEqual(asked[0]!.state);
    expect(table(room).failed).toBeNull();
  });

  it("stores no failure from a request it had stopped: a rejection, and the spot wanted again is asked again", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    useSettings.setState({ mode: "accurate" });
    useSettings.setState({ mode: "fast" });
    await flush();
    expect(asked[0]!.signal!.aborted).toBe(true);
    expect(asked).toHaveLength(1);

    // (an HTTP solve goes on past a stop, and can end in a 500 rather than a cancel)
    asked[0]!.reject(new SolverError("solver-error", "HTTP 500"));
    await flush();
    expect(table(room).failed).toBeNull();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatchObject({ mode: "quick", state: asked[0]!.state });
    asked[1]!.answer(CHART);
    await flush();
    expect(table(room).answer).not.toBeNull();
  });

  it("stores no failure from a request it had stopped: an {error}, and the spot wanted again is asked again", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    useSettings.setState({ mode: "accurate" });
    useSettings.setState({ mode: "fast" });
    await flush();
    asked[0]!.answer({ error: "no such node" });
    await flush();
    expect(table(room).failed).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("keeps the failure of the request asked again: only a stopped one is passed over", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    useSettings.setState({ mode: "accurate" });
    useSettings.setState({ mode: "fast" });
    await flush();
    asked[0]!.reject(new SolverError("solver-error", "HTTP 500"));
    await flush();
    asked[1]!.reject(new SolverError("solver-error", "HTTP 500"));
    await flush();
    expect(table(room).failed).toBe("HTTP 500");
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

describe("Room restarts", () => {
  const stuck = () => new SolverError("stuck", "The solver stopped answering; it restarts on the next request.");

  it("asks a stuck job again where it's still wanted, and counts the restart: no failure, nothing cached", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    // (stopped, then wanted again: the flight is held until it settles)
    useSettings.setState({ mode: "accurate" });
    useSettings.setState({ mode: "fast" });
    await flush();
    expect(asked[0]!.signal!.aborted).toBe(true);
    expect(asked).toHaveLength(1);
    expect(room.snapshot().restarts).toBe(0);

    asked[0]!.reject(stuck());
    await flush();
    expect(room.snapshot().restarts).toBe(1);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatchObject({ mode: "quick", state: asked[0]!.state });
    expect(asked[1]!.signal!.aborted).toBe(false);
    expect(table(room).failed).toBeNull();
    expect(table(room).answer).toBeNull();

    asked[1]!.answer(CHART);
    await flush();
    expect(table(room).answer).not.toBeNull();
    expect(room.snapshot().restarts).toBe(1);
  });

  it("goes on to what's wanted now where nobody wants the stuck job", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    room.startSession(2, 100, OPTS);
    await flush();
    expect(asked).toHaveLength(1);
    asked[0]!.reject(stuck());
    await flush();
    expect(room.snapshot().restarts).toBe(1);
    expect(asked).toHaveLength(2);
    expect(asked[1]!.state.hole).not.toBe(asked[0]!.state.hole);
    expect(table(room).failed).toBeNull();
  });

  it("counts one on leaving, and sends nothing after it", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    room.stop();
    asked[0]!.reject(stuck());
    await pass(5000);
    expect(room.snapshot().restarts).toBe(1);
    expect(asked).toHaveLength(1);
  });

  it("keeps counting through a New session, and tells the views", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    for (const i of [0, 1]) {
      await flush();
      room.startSession(2, 100, OPTS);
      const heard = vi.fn();
      const off = room.subscribe(heard);
      asked[i]!.reject(stuck());
      await flush();
      expect(heard).toHaveBeenCalled();
      off();
    }
    expect(room.snapshot().restarts).toBe(2);
  });

  it("counts a late stuck from nothing it has let go of", async () => {
    const { room, asked } = setup({ deaf: true, players: 2 });
    await flush();
    const next = fakeClient();
    room.setSolver(async () => next.client);
    await flush();
    asked[0]!.reject(stuck());
    await flush();
    // (a snapshot taken after it, or this reads the last one)
    room.pump();
    expect(room.snapshot().restarts).toBe(0);
    expect(next.asked).toHaveLength(1);
    expect(next.asked[0]!.signal!.aborted).toBe(false);
  });

  it("counts no restart for a stop that's answered", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    room.startSession(2, 100, OPTS);
    await pass(100);
    expect(asked[0]!.signal!.aborted).toBe(true);
    expect(asked).toHaveLength(2);
    expect(room.snapshot().restarts).toBe(0);
  });

  it("doesn't go round for ever on a stuck nobody here asked for", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.reject(stuck());
    await flush();
    expect(asked).toHaveLength(2);
    expect(table(room).failed).toBeNull();
    asked[1]!.reject(stuck());
    await flush();
    expect(asked).toHaveLength(2);
    expect(table(room).failed).toBe("Stopped.");
    expect(room.snapshot().restarts).toBe(2);
  });

  it("restarts for real, through the client and the transport: the spot goes to a new worker", async () => {
    const { client, workers } = realClient();

    const { room } = setup({ players: 2, start: false });
    room.setSolver(async () => client);
    room.start();
    await flush();
    const w = workers[0]!;
    w.reply({ status: "Solving…" });
    expect(w.asks).toHaveLength(1);

    useSettings.setState({ mode: "accurate" });
    useSettings.setState({ mode: "fast" });
    await pass(14_999);
    expect(w.terminated).toBe(false);
    expect(room.snapshot().restarts).toBe(0);
    await pass(1);
    expect(w.terminated).toBe(true);
    expect(room.snapshot().restarts).toBe(1);
    expect(table(room).failed).toBeNull();

    expect(workers).toHaveLength(2);
    expect(workers[1]!.asks).toHaveLength(1);
    expect(workers[1]!.asks[0]!.state).toEqual(w.asks[0]!.state);
    workers[1]!.answer(CHART);
    await flush();
    expect(optionsOf(table(room).answer?.data).map((a) => a.action)).toEqual(["fold", "call", "raise 2.5"]);
  });

  it("gets the flop to a new worker, once: what the last one fetched ahead went with it", async () => {
    const { client, workers } = realClient();
    const { room } = setup({ players: 2, start: false, pace: 0 });
    room.setSolver(async () => client);
    room.start();
    await flush();
    const w = workers[0]!;
    w.answer(CHART);
    await flush();
    room.choose(2);
    await flush();
    w.answer(move("call"));
    await pass(1000);
    expect(table(room).hand.shown).toBe(3);
    expect(w.told).toHaveLength(1);

    // the big blind's flop move stopped and wanted again, and the worker silent
    useSettings.setState({ mode: "accurate" });
    useSettings.setState({ mode: "fast" });
    await pass(15_000);
    expect(room.snapshot().restarts).toBe(1);
    const next = workers[1]!;
    expect(next.told).toEqual(w.told);

    // (the turn is the same flop: not told again)
    next.answer(move("check"));
    await flush();
    next.answer(FLOP);
    await flush();
    room.choose(0);
    await flush();
    expect(table(room).hand.shown).toBe(4);
    expect(next.told).toHaveLength(1);
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

  it("says a session is under way once there's something to lose, not for a hand only dealt", async () => {
    const { room, asked } = setup({ players: 2 });
    expect(room.snapshot()).toMatchObject({ holding: false, underWay: false });
    await toFlop(room, asked);
    expect(room.snapshot().underWay).toBe(true);
    // (a session begun in its place has nothing to lose yet)
    room.startSession(2, 100, OPTS);
    expect(room.snapshot().underWay).toBe(false);
  });

  it("counts a kept session it hasn't read yet as under way, and holds until it knows", async () => {
    let read = () => {};
    const { room } = setup({ persist: true, readKept: () => new Promise<void>((r) => (read = r)) });
    expect(room.snapshot().holding).toBe(true);
    await pass(1000);
    expect(room.snapshot()).toMatchObject({ holding: false, underWay: true });
    read();
    await flush();
    expect(room.snapshot().underWay).toBe(false);
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

  it("stops at once where a hand filter can't be met, in words, and asks nothing", async () => {
    const { room, asked } = setup({ players: 2, opts: { ...OPTS, pot: "srp", hand: "m:flush", board: { suits: "rainbow" } } as typeof OPTS });
    await flush();
    expect(table(room).error).toBe("No Flush came up in 200,000 draws of a flop and your cards: pick other hands or widen the flop.");
    expect(table(room).failed).toBeNull();
    expect(asked).toHaveLength(0);
    expect(room.snapshot().session).toMatchObject({ hands: 0 });
    // (Try again searches once more, and says so again)
    room.retry();
    await flush();
    expect(table(room).error).toContain("No Flush came up");
    expect(asked).toHaveLength(0);
  });

  it("names the hand filter when the deals run out, and deals to it each time", async () => {
    const { room, asked } = setup({ players: 2, opts: { ...OPTS, pot: "srp", hand: "c:pairs" } as typeof OPTS });
    for (let i = 0; i < DRILL_TRIES; i += 1) {
      await flush();
      const [a, b] = table(room).hand.hands[table(room).hand.hero]!;
      expect(a![0]).toBe(b![0]);
      asked.at(-1)!.answer(move("fold"));
    }
    await pass(2000);
    expect(table(room).error).toBe(`No single-raised pot with Pocket pairs in ${DRILL_TRIES} deals: try another seat or other hands.`);
    expect(asked).toHaveLength(DRILL_TRIES);
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

  it("keeps a decision that wasn't Best or Correct for review, as graded, and none with persist off", async () => {
    vi.mocked(keepMistake).mockClear();
    const RARE: AdvisorResponse = { ...CHART, actions: [{ action: "fold", freq: 0.01 }, { action: "call", freq: 0.04 }, { action: "raise 2.5", freq: 0.95, amount_bb: 2.5 }] };
    const off = setup({ players: 2, pace: 0 });
    await flush();
    off.asked[0]!.answer(RARE);
    await flush();
    off.room.choose(0);
    await flush();
    expect(keepMistake).not.toHaveBeenCalled();

    const { room, asked } = setup({ players: 2, pace: 0, persist: true, readKept: async () => undefined });
    await flush();
    asked[0]!.answer(RARE);
    await flush();
    room.choose(0);
    await flush();
    expect(keepMistake).toHaveBeenCalledTimes(1);
    const [m, merge, keyOf] = vi.mocked(keepMistake).mock.calls[0]!;
    expect(keyOf).toBe(spotKey);
    expect(m).toMatchObject({ from: "hand", street: "preflop", chose: "fold", step: 0, grade: { byEv: false, loss: 0 }, ask: { via: "solver" } });
    expect(m.provenance?.source).toBeTruthy();
    expect(merge(m, m)).toMatchObject({ times: 2 });
  });

  it("keeps nothing of a decision that was Best or Correct", async () => {
    vi.mocked(keepMistake).mockClear();
    const { room, asked } = setup({ players: 2, pace: 0, persist: true, readKept: async () => undefined });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(2);
    await flush();
    expect(keepMistake).not.toHaveBeenCalled();
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

  it("tells a new client the flop on the table", async () => {
    const { room, asked, prefetched } = setup({ players: 2, pace: 0 });
    await toFlop(room, asked);
    const next = fakeClient();
    room.setSolver(async () => next.client);
    await flush();
    expect(next.asked).toHaveLength(1);
    expect(next.prefetched).toEqual(prefetched);
  });
});

describe("Room on the app's runtime", () => {
  afterEach(() => {
    useRuntime.getState().client?.dispose();
    useRuntime.setState({ client: null, key: "" });
    vi.unstubAllGlobals();
  });

  /** As a page's first launch runs, with the default settings still in hand, an "auto" library's HEAD held open. */
  function firstLoad() {
    const workers: FakeWorker[] = [];
    const heads: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      "Worker",
      class extends FakeWorker {
        constructor() {
          super();
          workers.push(this);
        }
      },
    );
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
      init?.method === "HEAD" ? new Promise<Response>((res) => heads.push(res)) : Promise.resolve(new Response("{}", { status: 404 })),
    );
    const solverAt = (librarySource: string) => () => useRuntime.getState().ensure({ transport: "worker", localSolverUrl: "http://x", librarySource });
    return { workers, heads, solverAt };
  }

  it("boots one worker where a saved library comes in while the first launch waits on the default's", async () => {
    const { workers, heads, solverAt } = firstLoad();
    const { room } = setup({ players: 2, start: false });
    room.setSolver(solverAt("auto"));
    room.start();
    await flush();
    room.setSolver(solverAt("lizard-library"));
    await flush();
    expect(workers).toHaveLength(1);

    // the older ensure's HEAD comes back last
    heads[0]!(new Response("", { status: 200 }));
    await flush();
    expect(useRuntime.getState().key).toBe("worker|http://x|lizard-library");

    // the next launch finds the client it was using, on the same worker
    const w = workers[0]!;
    w.answer(CHART);
    await flush();
    expect(table(room).answer).not.toBeNull();
    room.choose(2);
    await flush();
    expect(workers).toHaveLength(1);
    expect(w.terminated).toBe(false);
    expect(w.asks).toHaveLength(2);
  });
});

// ---- several tables

const FOLD_ONLY: AdvisorResponse = { street: "preflop", actions: [{ action: "fold", freq: 1 }] };
const FACING: AdvisorResponse = {
  street: "flop",
  pot_bb: 8.5,
  actions: [
    { action: "fold", freq: 0.3, ev_bb: 0 },
    { action: "call", freq: 0.7, ev_bb: 0.4 },
  ],
};

const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
/** Folded to the button, who opens; the big blind calls. */
const SRP = [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")];
const CHECK = mv("BB", "check");

/** A hand at a spot: your seat, the line to it, the cards out. `seed` is its cards and its number. */
function spot(seed: number, hero: string, lines: Partial<Lines> = {}, shown = 0): PracticeHand {
  return { ...newHand(6, 100, seed, seed, { seat: hero }), lines: { ...noLines(), ...lines }, shown };
}
/** BB's move on the flop first, then yours. */
const flopOpp = (seed: number) => spot(seed, "BTN", { preflop: SRP }, 3);
/** Your flop spot, BB having checked. */
const flopYou = (seed: number) => spot(seed, "BTN", { preflop: SRP, flop: [CHECK] }, 3);
/** Your flop spot, BB having bet. */
const betYou = (seed: number) => spot(seed, "BTN", { preflop: SRP, flop: [mv("BB", "bet", 3)] }, 3);
/** Your turn spot: long at Accurate. */
const turnYou = (seed: number) => spot(seed, "BTN", { preflop: SRP, flop: [CHECK, mv("BTN", "check")], turn: [CHECK] }, 4);
const preflop = (seed: number) => spot(seed, "UTG");

const at = (room: Room, i: number) => room.snapshot().tables[i]!;
/** Whose request it is: the table whose hand holds its cards. */
const tableOf = (room: Room, a: Asked) => room.snapshot().tables.findIndex((t) => t.hand.hands[t.hand.hero]!.join("") === a.state.hole);
/** A dock's button: the table in front's i-th option. */
const press = (room: Room, table: number, i: number) => room.choose(table, at(room, table).turnKey ?? "", i);
const several = (hands: PracticeHand[], o: Parameters<typeof setup>[0] = {}) => setup({ hands, pace: 0, pause: 0, guard: 0, ...o });
/** What's asked, in turn, answered: table by table as `answers` run out. */
async function answer(asked: Asked[], from: number, ...answers: AdvisorResponse[]) {
  for (let i = 0; i < answers.length; i += 1) {
    await flush();
    asked[from + i]!.answer(answers[i]!);
  }
  await flush();
}

describe("Room at several tables", () => {
  it("brings the table that needs you forward, queues the others as they started waiting; S skips, a pick holds (multitable.test.js:105)", async () => {
    const { room, asked } = several([flopOpp(1), flopYou(2), preflop(3)]);
    await flush();
    expect(asked).toHaveLength(1);

    // what's instant first, table 3's preflop; then your spot at table 2 before table 1's opponent
    expect(tableOf(room, asked[0]!)).toBe(2);
    expect(asked[0]!.state.board).toBe("");
    await pass(100);
    asked[0]!.answer(CHART);
    await flush();
    expect(room.snapshot().focus).toBe(2);
    expect(asked).toHaveLength(2);
    expect(tableOf(room, asked[1]!)).toBe(1);
    expect(asked[1]!.play).toBeUndefined();
    await pass(100);
    asked[1]!.answer(FLOP);
    await flush();
    expect(tableOf(room, asked[2]!)).toBe(0);
    expect(asked[2]!.play?.seat).toBe("BB");
    asked[2]!.answer(move("check"));
    await flush();
    expect(tableOf(room, asked[3]!)).toBe(0);
    expect(asked[3]!.play).toBeUndefined();
    await pass(100);
    asked[3]!.answer(FLOP);
    await flush();

    // table 3 has waited longest, then table 2, then table 1; the front stays while it waits for you
    expect(room.snapshot()).toMatchObject({ focus: 2, queue: [2, 1, 0] });

    // you act there: the next in the queue comes forward
    press(room, 2, 1);
    expect(room.snapshot()).toMatchObject({ focus: 1, queue: [1, 0] });
    expect(at(room, 2).hand.decisions).toHaveLength(1);

    // S: the next waiting, this one to the back
    room.skip();
    expect(room.snapshot()).toMatchObject({ focus: 0, queue: [0, 1] });

    // a pick, of a table not waiting: it stays until you act or pick another
    room.pick(2);
    expect(room.snapshot().focus).toBe(2);
    room.pump();
    expect(room.snapshot()).toMatchObject({ focus: 2, queue: [0, 1] });
    room.choose(2, "not your turn at this table", 0);
    expect(at(room, 2).hand.decisions).toHaveLength(1);
  });

  it("keeps each decision's cell under its own table's seat, and the pot before your move", async () => {
    const one = setup({ players: 2 });
    await flush();
    one.asked[0]!.answer(CHART);
    await flush();
    one.room.choose(2);
    expect(Object.values(one.room.snapshot().session.cells!)).toEqual([expect.objectContaining({ street: "preflop", seat: "SB", pot: "Unopened", n: 1 })]);

    const { room, asked } = several([flopYou(1), preflop(2)]);
    await answer(asked, 0, CHART, FLOP);
    press(room, room.snapshot().focus, 0);
    press(room, room.snapshot().focus, 0);
    expect(Object.values(room.snapshot().session.cells!).map((c) => [c.street, c.seat, c.pot, c.n])).toEqual([
      ["preflop", "UTG", "Unopened", 1],
      ["flop", "BTN", "SRP", 1],
    ]);
  });

  it("marks a decision with the table it was made at, and its hand's own number", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)]);
    await answer(asked, 0, FLOP, FLOP);
    press(room, 0, 0);
    room.skip();
    press(room, 1, 0);
    expect(room.snapshot().session.review.map((e) => [e.table, e.n])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("holds your input a moment after the table in front changes by itself (multitable.test.js:153)", async () => {
    const { room, asked } = several([preflop(1), preflop(2)], { guard: 350, pause: 10_000 });
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    expect(room.snapshot()).toMatchObject({ focus: 0, queue: [0, 1] });
    await pass(1000);

    press(room, 0, 0);
    expect(room.snapshot().focus).toBe(1);
    expect(room.snapshot().guarded).toBe(true);
    press(room, 1, 0);
    expect(at(room, 1).hand.result).toBeNull();
    await pass(349);
    press(room, 1, 0);
    expect(at(room, 1).hand.result).toBeNull();
    await pass(1);
    press(room, 1, 0);
    expect(at(room, 1).hand.result).not.toBeNull();
  });

  it("tells the views as the guard ends, as dimmed buttons have no other event to wait for", async () => {
    const { room, asked } = several([preflop(1), preflop(2)], { guard: 350, pause: 10_000 });
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    await pass(1000);
    press(room, 0, 0);
    expect(room.snapshot().guarded).toBe(true);
    const heard = vi.fn();
    room.subscribe(heard);
    await pass(349);
    expect(heard).not.toHaveBeenCalled();
    await pass(1);
    expect(heard).toHaveBeenCalled();
    expect(room.snapshot().guarded).toBe(false);
  });

  it("guards a press against an instant answer at the same table, though the front didn't change", async () => {
    const { room, asked } = several([flopYou(1), preflop(2)], { guard: 350 });
    // (table 2 sits out, so table 1 stays in front)
    await answer(asked, 0, { error: "no such node" }, FLOP);
    expect(room.snapshot().focus).toBe(0);
    await pass(350);

    // your check, the turn, BB's check, and your turn spot's answer at once
    press(room, 0, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(1);
    await answer(asked, 2, move("check"), FLOP);
    expect(at(room, 0).answer).not.toBeNull();
    press(room, 0, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(1);
    expect(room.snapshot().guarded).toBe(true);
    await pass(349);
    press(room, 0, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(1);
    await pass(1);
    press(room, 0, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(2);
  });

  it("sends the table in front behind the rest on S, though they came in the same moment", async () => {
    const { room, asked } = several([preflop(1), preflop(2)]);
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    expect(room.snapshot()).toMatchObject({ focus: 0, queue: [0, 1] });
    room.skip();
    expect(room.snapshot()).toMatchObject({ focus: 1, queue: [1, 0] });
  });

  it("holds nothing by a pick of the table already in front", async () => {
    const { room, asked } = several([flopYou(1), preflop(2)]);
    await flush();
    room.pick(0);
    asked[0]!.answer(FOLD_ONLY);
    await flush();
    expect(room.snapshot().focus).toBe(1);
  });

  it("sets no guard by S, nor by S again back to where you were", async () => {
    const { room, asked } = several([preflop(1), preflop(2)], { guard: 350, pause: 10_000 });
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    await pass(1000);
    room.skip();
    expect(room.snapshot()).toMatchObject({ focus: 1, guarded: false });
    room.skip();
    expect(room.snapshot()).toMatchObject({ focus: 0, guarded: false });
    press(room, 0, 0);
    expect(at(room, 0).hand.result).not.toBeNull();
  });

  it("shows no guard once the table in front has stopped waiting", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)], { guard: 350 });
    await answer(asked, 0, FLOP);
    expect(room.snapshot().guarded).toBe(true);
    useSettings.setState({ mode: "accurate" });
    expect(room.snapshot().guarded).toBe(false);
  });

  it("holds nothing by S: the table it brought forward goes back in the queue like any", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)]);
    await answer(asked, 0, FLOP, FLOP);
    room.skip();
    expect(room.snapshot().focus).toBe(1);

    // both spots wanted again, table 1's answered first
    useSettings.setState({ mode: "accurate" });
    await flush();
    expect(tableOf(room, asked[2]!)).toBe(0);
    asked[2]!.answer(FLOP);
    await flush();
    expect(room.snapshot()).toMatchObject({ focus: 0, queue: [0] });
  });

  it("sets no guard by a pick, but a pick can't get in front of an answer just in", async () => {
    const { room, asked } = several([flopYou(1), preflop(2)], { guard: 350, pause: 10_000 });
    await answer(asked, 0, FOLD_ONLY);
    await pass(1000);
    asked[1]!.answer(FLOP);
    await flush();
    expect(room.snapshot()).toMatchObject({ focus: 1, queue: [1, 0] });

    room.pick(0);
    expect(room.snapshot()).toMatchObject({ focus: 0, guarded: true });
    press(room, 0, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(0);
    await pass(350);
    room.pick(1);
    expect(room.snapshot()).toMatchObject({ focus: 1, guarded: false });
    press(room, 1, 0);
    expect(at(room, 1).hand.result).not.toBeNull();
  });

  it("has no guard at one table", async () => {
    const { room, asked } = setup({ players: 2, guard: 350 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    expect(room.snapshot().guarded).toBe(false);
    room.choose(2);
    expect(table(room).last).not.toBeNull();
  });

  it("ignores a press from a spot that has gone, or a table that isn't in front", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)]);
    await answer(asked, 0, FLOP, FLOP);
    expect(room.snapshot().focus).toBe(0);
    const stale = at(room, 0).turnKey!;
    const other = at(room, 1).turnKey!;

    // table 2 waits, but it isn't in front
    room.choose(1, other, 0);
    expect(at(room, 1).hand.decisions).toHaveLength(0);
    // nor is table 2's key table 1's
    room.choose(0, other, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(0);
    // table 9 isn't there at all
    room.choose(9, stale, 0);

    room.choose(0, stale, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(1);
    room.skip();
    room.pick(0);
    await answer(asked, 2, move("check"), FLOP);
    expect(at(room, 0).answer).not.toBeNull();
    room.choose(0, stale, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(1);
    press(room, 0, 0);
    expect(at(room, 0).hand.decisions).toHaveLength(2);
  });

  it("answers what's instant first, and a long solve gives way to it, to be asked again (multitable.test.js:170)", async () => {
    useSettings.setState({ mode: "accurate" });
    const { room, asked } = several([turnYou(1), preflop(2)], { seat: "UTG" });
    await flush();
    expect(asked).toHaveLength(1);
    expect(tableOf(room, asked[0]!)).toBe(1);
    asked[0]!.answer(FOLD_ONLY);
    await flush();
    expect(asked).toHaveLength(2);
    const long = asked[1]!;
    expect(tableOf(room, long)).toBe(0);
    expect(long.state.board).toHaveLength(8);

    // you fold at table 2: its next hand's preflop is instant, so the turn's solve stops for it
    press(room, 1, 0);
    await flush();
    expect(long.signal!.aborted).toBe(true);
    expect(room.metrics().stops).toBe(1);
    expect(asked).toHaveLength(2);
    await pass(100);
    expect(asked).toHaveLength(3);
    expect(tableOf(room, asked[2]!)).toBe(1);
    expect(asked[2]!.state.board).toBe("");

    // once table 2 waits for you again, the turn is asked again
    asked[2]!.answer(FOLD_ONLY);
    await flush();
    expect(asked).toHaveLength(4);
    expect(tableOf(room, asked[3]!)).toBe(0);
    expect(asked[3]!.state).toEqual(long.state);
  });

  it("stops nothing needed where a stop kills the worker: what's instant waits for the long solve (multitable.test.js:170)", async () => {
    useSettings.setState({ mode: "accurate" });
    const { room, asked } = several([turnYou(1), preflop(2)], { seat: "UTG", stop: "kills" });
    await answer(asked, 0, FOLD_ONLY);
    const long = asked[1]!;
    press(room, 1, 0);
    await pass(1000);
    expect(long.signal!.aborted).toBe(false);
    expect(room.metrics().stops).toBe(0);
    expect(asked).toHaveLength(2);

    long.answer(FLOP);
    await flush();
    expect(at(room, 0).answer).not.toBeNull();
    expect(asked).toHaveLength(3);
    expect(tableOf(room, asked[2]!)).toBe(1);
  });

  it("stops a dead long solve where a stop kills the worker", async () => {
    useSettings.setState({ mode: "accurate" });
    const { room, asked } = several([preflop(1), turnYou(2)], { stop: "kills" });
    await answer(asked, 0, FOLD_ONLY);
    const long = asked[1]!;
    expect(tableOf(room, long)).toBe(1);
    room.setTables(1);
    await flush();
    expect(long.signal!.aborted).toBe(true);
  });

  it("lets a dead short solve run out where a stop kills the worker, its answer kept", async () => {
    const { room, asked } = several([preflop(1), flopYou(2)], { stop: "kills" });
    await answer(asked, 0, FOLD_ONLY);
    const short = asked[1]!;
    room.setTables(1);
    await pass(1000);
    expect(short.signal!.aborted).toBe(false);
    expect(asked).toHaveLength(2);

    short.answer(FLOP);
    await flush();
    room.setTables(2);
    await flush();
    expect(at(room, 1).answer).not.toBeNull();
  });

  it("reads a client that doesn't say what a stop costs as one that kills", async () => {
    const { asked } = setup({ players: 2, stop: null });
    await flush();
    useSettings.setState({ mode: "accurate" });
    await pass(1000);
    expect(asked[0]!.signal!.aborted).toBe(false);
    expect(asked).toHaveLength(1);
  });

  it("aborts on leaving, whatever a stop costs", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)], { stop: "kills" });
    await flush();
    room.stop();
    expect(asked[0]!.signal!.aborted).toBe(true);
  });

  it("drops a request not sent yet, whatever a stop would cost: there's nothing to kill", async () => {
    const { room, asked, client } = setup({ players: 2, start: false, stop: "kills" });
    const waiting: ((c: RoomClient) => void)[] = [];
    room.setSolver(() => new Promise((res) => waiting.push(res)));
    room.start();
    room.startSession(2, 100, OPTS);
    const dealt = table(room).hand;
    waiting[0]!(client);
    await flush();
    expect(asked).toHaveLength(0);
    waiting[1]!(client);
    await flush();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.state.hole).toBe(dealt.hands[dealt.hero]!.join(""));
  });

  it("counts a hand that ends at a table, there and in the session, and deals it again (multitable.test.js:268)", async () => {
    const facing = (seed: number) => spot(seed, "BTN", { preflop: SRP, flop: [mv("BB", "bet", 3)] }, 3);
    const { room, asked } = several([facing(1), facing(2)]);
    await answer(asked, 0, FACING, FACING);
    const dealt = at(room, 0).hand;
    press(room, 0, 0);
    expect(room.snapshot().session.hands).toBe(1);
    expect(at(room, 0).stats).toMatchObject({ hands: 1, n: 1, net: -2.5 });
    expect(at(room, 1).stats).toMatchObject({ hands: 0 });
    expect(at(room, 0).hand).not.toBe(dealt);
    expect(at(room, 0).hand.result).toBeNull();
  });

  it("counts no net for a preflop-only session's table, as there's no hand to the end", async () => {
    const { room, asked } = setup({ players: 6, tables: 2, seat: "SB", opts: { ...OPTS, preflopOnly: true }, pace: 0, pause: 100_000, guard: 0 });
    // (folded round to you at both)
    for (let i = 0; i < 10; i += 1) {
      await flush();
      const a = asked.at(-1)!;
      a.answer(a.play ? move("fold") : CHART);
    }
    await flush();
    press(room, 0, 0);
    expect(at(room, 0).hand.result?.net).toBe(-0.5);
    expect(at(room, 0).stats).toMatchObject({ hands: 1, net: 0 });
  });

  it("stops a table's request when the table goes (multitable.test.js:268)", async () => {
    const { room, asked } = several([preflop(1), preflop(2), flopYou(3)]);
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    expect(tableOf(room, asked[2]!)).toBe(2);
    room.setTables(2);
    await flush();
    expect(room.snapshot().tables).toHaveLength(2);
    expect(asked[2]!.signal!.aborted).toBe(true);
  });

  it("measures each decision's wait, from your turn to its buttons (multitable.test.js:464)", async () => {
    const { room, asked } = several([preflop(1), preflop(2)]);
    await flush();
    await pass(500);
    asked[0]!.answer(FOLD_ONLY);
    await flush();
    await pass(700);
    asked[1]!.answer(FOLD_ONLY);
    await flush();
    const m = room.metrics();
    expect(m.decisions).toBe(2);
    expect(m.waits).toEqual([
      { s: 0.5, street: "preflop", table: 1 },
      { s: 1.2, street: "preflop", table: 2 },
    ]);
    expect(m.median).toBe(1.2);
  });

  it("measures each request, as it was expected and as it went", async () => {
    const { room, asked } = several([preflop(1), flopYou(2)]);
    await flush();
    await pass(30);
    asked[0]!.answer(FOLD_ONLY);
    await flush();
    await pass(1900);
    asked[1]!.answer({ error: "no such node" });
    await flush();
    // (a failure isn't a solve)
    expect(room.metrics().solves).toEqual([{ s: 0.03, est: 0.05, kind: "you", street: "preflop" }]);
  });

  it("keeps a late error off the table's new hand", async () => {
    const { room, asked } = several([preflop(1), preflop(2)], { stop: "kills" });
    await flush();
    room.startSession(6, 100, OPTS);
    await flush();
    expect(asked[0]!.signal!.aborted).toBe(false);
    asked[0]!.answer({ error: "no such node" });
    await flush();
    expect(at(room, 0).failed).toBeNull();
    expect(at(room, 1).failed).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("numbers every hand on its own, though two tables hold the same cards", async () => {
    const { room } = setup({ players: 6, tables: 4, seat: "UTG", seedOf: () => 7, pace: 0, pause: 0, guard: 0 });
    const { session: s, tables } = room.snapshot();
    const hands = tables.map((t) => t.hand);
    expect(new Set(hands.map((h) => h.hands[h.hero]!.join(""))).size).toBe(1);
    expect(hands.map((h) => h.n)).toEqual([0, 1, 2, 3]);
    expect(new Set(hands.map((h) => keyOf(s, h))).size).toBe(4);
    expect(new Set(hands.map((h) => practiceNumber(h, s.startedAt))).size).toBe(4);
    expect(s.dealt).toBe(4);
  });

  it("asks one request for two tables at one spot", async () => {
    const { room, asked } = several([{ ...preflop(1), n: 1 }, { ...preflop(1), n: 2 }], { seat: "UTG" });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    // the same advice: both wait, on one answer
    expect(asked).toHaveLength(1);
    expect(room.snapshot().queue).toEqual([0, 1]);
  });

  it("asks an opponent's move once for each table it's drawn at", async () => {
    const twin = flopOpp(1);
    const { room, asked } = several([twin, { ...twin, n: 9 }]);
    await flush();
    asked[0]!.answer(move("check"));
    await flush();
    expect(at(room, 0).hand.lines.flop).toEqual([CHECK]);
    expect(at(room, 1).hand.lines.flop).toEqual([]);
    // (your spot at table 1 is the same street again, nearly instant; table 2's BB comes after it)
    expect(asked).toHaveLength(2);
    asked[1]!.answer(FLOP);
    await flush();
    expect(asked).toHaveLength(3);
    expect(asked[2]!.play?.seat).toBe("BB");
    expect(asked[2]!.state).toEqual(asked[0]!.state);

    // (the street is in hand at the table that asked it: to the other it's a solve like any)
    asked[2]!.answer(move("check"));
    await flush();
    expect(room.metrics().solves.at(-1)?.est).toBe(2);
  });

  it("takes a spot answered and wanted again as newly wanted, behind what has waited", async () => {
    const twin = spot(1, "BTN");
    const { room, asked } = several([twin, { ...twin, n: 9 }, spot(2, "BTN")]);
    await flush();
    await pass(10);
    asked[0]!.answer(move("fold"));
    await flush();
    expect(asked[1]!.state.hole).toBe(at(room, 2).hand.hands.BTN!.join(""));
  });

  it("can't let a table dealing a drill's pot starve a short solve", async () => {
    // (an ante: in the game the charts are, its moves would be drawn, not asked)
    const { room, asked } = several([{ ...spot(1, "BTN"), pot: "srp", ante: 0.1 }, flopOpp(2)]);
    await flush();
    expect(tableOf(room, asked[0]!)).toBe(0);
    await pass(10);
    asked[0]!.answer(move("fold"));
    await flush();
    // its next seat, wanted later, behind table 2's: though a preflop move on its own would be instant
    expect(at(room, 0).hand.lines.preflop).toHaveLength(1);
    expect(tableOf(room, asked[1]!)).toBe(1);
    expect(asked[1]!.play?.seat).toBe("BB");
  });

  it("calls a street answered at a table nearly instant, there, ahead of others' older short solves", async () => {
    const { room, asked } = several([spot(1, "BB", { preflop: SRP }, 3), flopOpp(2), flopOpp(3)]);
    // your flop spot, then table 2's BB
    await answer(asked, 0, FLOP);
    press(room, 0, 0);
    await flush();
    expect(tableOf(room, asked[1]!)).toBe(1);
    await pass(10);
    asked[1]!.answer({ error: "no such node" });
    await flush();
    // BTN's reply at table 1, a move on an answered street, before table 3's BB, wanted first
    expect(tableOf(room, asked[2]!)).toBe(0);
    expect(asked[2]!.play?.seat).toBe("BTN");
    expect(asked[2]!.state.flop).toEqual([CHECK]);
    asked[2]!.answer(move("check"));
    await flush();
    expect(room.metrics().solves.map((m) => m.est)).toEqual([2, 0.2]);
  });

  it("forgets the streets answered at each deal, though the same cards come up", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, seedOf: () => 7, opts: { ...OPTS, seat: "SB" } });
    await toFlop(room, asked);
    asked.at(-1)!.answer(move("check"));
    await flush();
    asked.at(-1)!.answer(FACING);
    await flush();
    expect(room.metrics().solves.at(-1)).toMatchObject({ est: 0.2, street: "flop" });
    room.choose(0);
    await flush();
    room.nextHand();
    await flush();
    room.choose(2);
    await flush();
    asked.at(-1)!.answer(move("call"));
    await pass(1000);
    expect(table(room).hand.shown).toBe(3);
    asked.at(-1)!.answer(move("check"));
    await flush();
    expect(room.metrics().solves.at(-1)).toMatchObject({ est: 2, street: "flop" });
  });

  it("forgets the streets answered with a new client, which has solved none of them", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2), flopYou(3)]);
    await answer(asked, 0, FLOP, FLOP);
    expect(room.metrics().solves.at(-1)).toMatchObject({ est: 2 });
    const next = fakeClient();
    room.setSolver(async () => next.client);
    await answer(next.asked, 0, FLOP, FLOP);
    expect(room.metrics().solves.at(-1)).toMatchObject({ est: 2 });
  });

  it("forgets them for a table set aside as well", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)]);
    await answer(asked, 0, FLOP, FLOP);
    room.setTables(1);
    const next = fakeClient();
    room.setSolver(async () => next.client);
    room.choose(0);
    await answer(next.asked, 0, FLOP);
    room.setTables(2);
    await answer(next.asked, 1, FLOP);
    expect(room.metrics().solves.at(-1)).toMatchObject({ est: 2 });
  });

  it("expects a long solve by what's solving it", async () => {
    useSettings.setState({ mode: "accurate" });
    for (const [transport, est] of [
      ["worker", 60],
      ["http", 30],
    ] as const) {
      const { room, asked } = several([turnYou(1), turnYou(2)], { transport });
      // (the first goes out before the client is known; the second reads it)
      await answer(asked, 0, FLOP, FLOP);
      expect(room.metrics().solves.map((m) => m.est)).toEqual([60, est]);
    }
  });

  it("has the flight take its job as it's wanted now, by what's now known of it", async () => {
    useSettings.setState({ mode: "accurate" });
    const { room, asked } = several([turnYou(1), turnYou(2)], { transport: "http" });
    await flush();
    room.pump();
    asked[0]!.answer(FLOP);
    await flush();
    expect(room.metrics().solves.at(-1)?.est).toBe(30);
  });

  it("doesn't go round for ever on cancels nobody here asked for, tables taking turns", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)]);
    const gone = new SolverError("cancelled", "solver disposed");
    await pass(10);
    asked[0]!.reject(gone);
    await pass(10);
    // (asked again, behind the other table's, wanted first)
    expect(tableOf(room, asked[1]!)).toBe(1);
    asked[1]!.reject(gone);
    await pass(10);
    expect(tableOf(room, asked[2]!)).toBe(0);
    asked[2]!.reject(gone);
    await pass(10);
    asked[3]!.reject(gone);
    await flush();
    expect(asked).toHaveLength(4);
    expect(at(room, 0).failed).toBe("Stopped.");
    expect(at(room, 1).failed).toBe("Stopped.");
  });

  it("holds no cancel against a spot once any answer has come", async () => {
    const twin = flopOpp(1);
    const { room, asked } = several([twin, { ...twin, n: 9 }]);
    const gone = new SolverError("cancelled", "solver disposed");
    await flush();
    asked[0]!.reject(gone);
    await flush();
    asked[1]!.answer(move("check"));
    await answer(asked, 2, FLOP);
    // (the move's used up, so the other table asks that spot once more)
    expect(asked[3]!.state).toEqual(asked[0]!.state);
    asked[3]!.reject(gone);
    await flush();
    expect(at(room, 1).failed).toBeNull();
    expect(asked).toHaveLength(5);
  });

  it("starts a new session with no cancels held against it", async () => {
    const { room, asked } = setup({ players: 2, seedOf: () => 7 });
    const gone = new SolverError("cancelled", "solver disposed");
    await flush();
    asked[0]!.reject(gone);
    await flush();
    room.startSession(2, 100, OPTS);
    await flush();
    asked[1]!.reject(gone);
    await flush();
    expect(table(room).failed).toBeNull();
    expect(asked).toHaveLength(3);
  });

  it("never brings a failed table forward by itself", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2)]);
    await answer(asked, 0, { error: "no such node" });
    expect(room.snapshot()).toMatchObject({ focus: 0, queue: [] });
    asked[1]!.answer(FLOP);
    await flush();
    expect(room.snapshot()).toMatchObject({ focus: 1, queue: [1] });
    expect(at(room, 0).failed).toBe("no such node");
  });

  it("asks a table's failed spot again by that table, leaving the others alone", async () => {
    const { room, asked } = several([preflop(1), flopOpp(2)]);
    await answer(asked, 0, FOLD_ONLY, { error: "no such node" });
    expect(room.snapshot().focus).toBe(0);
    expect(at(room, 1).failed).toBe("no such node");
    room.retry(1);
    expect(at(room, 1).failed).toBeNull();
    await flush();
    expect(asked).toHaveLength(3);
    expect(tableOf(room, asked[2]!)).toBe(1);
    // and a table that isn't there
    room.retry(7);
  });

  it("plays on, and takes your own moves, at the table it's told", async () => {
    const { room, asked } = several([preflop(1), flopOpp(2), flopYou(3)]);
    await answer(asked, 0, FOLD_ONLY, { error: "no such node" }, { error: "no such node" });
    room.playOn(1);
    expect(at(room, 1).hand.lines.flop).toEqual([CHECK]);
    room.ungraded({ action: "check" }, 2);
    expect(at(room, 2).hand.decisions).toHaveLength(1);
    // (its answers fail again at no table here)
    room.playOn(5);
    room.ungraded({ action: "check" }, 5);
  });

  it("holds a pick while its hand goes on, and lets it go when you act or it ends", async () => {
    const { room, asked } = several([preflop(1), flopOpp(2)]);
    await answer(asked, 0, FOLD_ONLY);
    expect(room.snapshot().focus).toBe(0);
    // table 2's BB in flight: it isn't waiting for you, and it's picked
    room.pick(1);
    await flush();
    expect(room.snapshot()).toMatchObject({ focus: 1, queue: [0] });

    // it's your turn there, and the answer in: you act, and table 1 comes forward
    await answer(asked, 1, move("check"), FLOP);
    expect(room.snapshot()).toMatchObject({ focus: 1, queue: [0, 1] });
    press(room, 1, 0);
    expect(room.snapshot().focus).toBe(0);
  });

  it("brings the next forward after you act, also where the table you acted at waits again at once", async () => {
    // (you close the preflop from the big blind and act first on the flop; its twin has had that answer)
    const twin = spot(1, "BB", { preflop: SRP.slice(0, 5) });
    const { room, asked } = several([twin, { ...twin, n: 9 }, preflop(3)]);
    await answer(asked, 0, CHART, CHART);
    room.skip();
    press(room, 1, 1);
    await answer(asked, 2, FLOP);
    expect(at(room, 1).hand.shown).toBe(3);
    expect(room.snapshot().focus).toBe(2);
    room.pick(0);
    await pass(10);

    press(room, 0, 1);
    expect(at(room, 0).hand.shown).toBe(3);
    expect(at(room, 0).answer).not.toBeNull();
    expect(room.snapshot()).toMatchObject({ focus: 1, queue: [1, 2, 0] });
  });

  it("lets a pick go when you move there without an answer, or play on", async () => {
    const own = several([flopYou(1), preflop(2)]);
    await answer(own.asked, 0, FOLD_ONLY, { error: "no such node" });
    own.room.pick(0);
    own.room.ungraded({ action: "check" }, 0);
    expect(at(own.room, 0).hand.decisions).toHaveLength(1);
    expect(own.room.snapshot().focus).toBe(1);

    const opp = several([flopOpp(1), preflop(2)]);
    await answer(opp.asked, 0, FOLD_ONLY, { error: "no such node" });
    opp.room.pick(0);
    opp.room.playOn(0);
    expect(at(opp.room, 0).hand.lines.flop).toEqual([CHECK]);
    expect(opp.room.snapshot().focus).toBe(1);
  });

  it("finds a new front when the one in front is set aside", async () => {
    const { room } = several([preflop(1), preflop(2), preflop(3)]);
    room.pick(2);
    room.setTables(2);
    expect(room.snapshot().focus).toBe(0);
    room.pick(1);
    room.setTables(1);
    expect(room.snapshot().focus).toBe(0);
  });

  it("deals nothing new on a pick or S with nobody else waiting", async () => {
    const { room, asked } = several([preflop(1), preflop(2)]);
    await answer(asked, 0, FOLD_ONLY);
    room.skip();
    room.pick(0);
    room.pick(9);
    expect(room.snapshot().focus).toBe(0);
  });

  it("restarts every table on a New session: numbers, results and what was set aside", async () => {
    const { room, asked } = several([preflop(1), preflop(2), preflop(3)], { pause: 100_000 });
    await answer(asked, 0, FOLD_ONLY);
    press(room, 0, 0);
    expect(at(room, 0).stats.hands).toBe(1);
    room.pick(1);
    room.setTables(2);

    room.startSession(6, 100, OPTS);
    const { session, tables, focus } = room.snapshot();
    expect(tables.map((t) => t.hand.n)).toEqual([0, 1]);
    expect(tables.map((t) => t.stats.hands)).toEqual([0, 0]);
    expect(tables.map((t) => t.last)).toEqual([null, null]);
    expect(session).toMatchObject({ dealt: 2, hands: 0, tables: 2 });
    expect(focus).toBe(0);

    // (table 3, as it was, went with the last session)
    room.setTables(3);
    expect(at(room, 2).hand.n).toBe(2);
    expect(room.snapshot().session.dealt).toBe(3);
  });
});

describe("Room changing the number of tables", () => {
  it("makes your hand Table 1, mid-street, and deals the others: the request it wanted goes on", async () => {
    const { room, asked } = setup({ players: 6, pace: 0, pause: 0, guard: 0 });
    await flush();
    const hand = table(room).hand;
    room.setTables(4);
    await flush();
    const { tables, session } = room.snapshot();
    expect(tables).toHaveLength(4);
    expect(tables[0]!.hand).toBe(hand);
    expect(asked[0]!.signal!.aborted).toBe(false);
    expect(session).toMatchObject({ dealt: 4, tables: 4, hands: 0 });
    expect(tables.map((t) => t.hand.n)).toEqual([0, 1, 2, 3]);
  });

  it("clamps the count, and does nothing for the count it has", async () => {
    const { room } = setup({ pace: 0, pause: 0, guard: 0 });
    room.setTables(9);
    expect(room.snapshot().tables).toHaveLength(4);
    const { session } = room.snapshot();
    room.setTables(4);
    expect(room.snapshot().session).toBe(session);
    room.setTables(0);
    expect(room.snapshot().tables).toHaveLength(1);
  });

  it("deals above one table by Spots and Seat with no chips carried, the setup itself untouched", async () => {
    const opts = { ...OPTS, carry: true, ante: 0.5 };
    const { room } = setup({ players: 6, opts, tables: 2, spot: "any", seat: "BB", start: false, pace: 0, pause: 0, guard: 0 });
    const other = at(room, 1).hand;
    expect(other).toMatchObject({ hero: "BB", ante: 0.5 });
    expect(other).not.toHaveProperty("pot");
    expect(other).not.toHaveProperty("stacks");
    expect(room.snapshot().session.opts).toBe(opts);
  });

  it("applies Spots and Seat from each table's next hand, and redeals nothing", async () => {
    useSettings.setState({ practiceSeat: "UTG" });
    const { room } = setup({ tables: 2, pace: 0, pause: 0, guard: 0 });
    const hands = room.snapshot().tables.map((t) => t.hand);
    useSettings.setState({ practiceSpot: "srp", practiceSeat: "BB" });
    expect(room.snapshot().tables.map((t) => t.hand)).toEqual(hands);
    room.setTables(3);
    expect(at(room, 2).hand).toMatchObject({ pot: "srp", hero: "BB" });
    expect(hands[0]).not.toHaveProperty("pot");

    useSettings.setState({ practiceSpot: "any" });
    room.setTables(4);
    expect(at(room, 3).hand).not.toHaveProperty("pot");
  });

  it("deals one table by the session's board filter, and more than one by Spots alone", async () => {
    useSettings.setState({ practiceSpot: "srp", practiceSeat: "UTG" });
    const { room } = setup({ pace: 0, pause: 0, guard: 0 });
    const opts = { ...room.snapshot().session.opts, pot: "srp" as const, board: { pair: "trips" } };
    room.startSession(6, 100, opts);
    expect(new Set(at(room, 0).hand.board.slice(0, 3).map((c) => c[0])).size).toBe(1);
    room.setTables(4);
    // (three flops all trips by chance: a one in 50 million)
    expect([1, 2, 3].every((i) => new Set(at(room, i).hand.board.slice(0, 3).map((c) => c[0])).size === 1)).toBe(false);
    expect(room.snapshot().session.opts.board).toEqual({ pair: "trips" });
  });

  it("deals one table by the session's hand filter, and more than one by Spots alone", async () => {
    useSettings.setState({ practiceSpot: "srp", practiceSeat: "UTG" });
    const { room } = setup({ pace: 0, pause: 0, guard: 0 });
    room.startSession(6, 100, { ...room.snapshot().session.opts, pot: "srp" as const, hand: "m:quads" });
    expect(at(room, 0).hand.dealtTo).toBe("m:quads");
    room.setTables(4);
    expect([1, 2, 3].map((i) => at(room, i).hand.dealtTo)).toEqual([undefined, undefined, undefined]);
    expect(room.snapshot().session.opts.hand).toBe("m:quads");
  });

  it("reads a saved seat that isn't at this game, or a spot it can't use, as what's left", async () => {
    useSettings.setState({ practiceSpot: "bvb", practiceSeat: "BTN" });
    const { room } = setup({ tables: 2, pace: 0, pause: 0, guard: 0 });
    // (blind vs blind has no button: the seat reads random, and the table deals a blind)
    expect(["SB", "BB"]).toContain(at(room, 1).hand.hero);
    expect(at(room, 1).hand).toMatchObject({ pot: "bvb" });

    useSettings.setState({ practiceSpot: "gone" as Spot, practiceSeat: "D9" });
    room.setTables(3);
    expect(at(room, 2).hand).not.toHaveProperty("pot");
  });

  it("tallies what graded a table's hands as each ends, beside its stats", async () => {
    const { room, asked } = several([betYou(1), betYou(2)], { pause: 1e6 });
    await answer(asked, 0, FACING, FACING);
    const first = room.snapshot().focus;
    const other = 1 - first;
    // your call: a decision graded, the hand going on, so the table's tally waits for it as its stats do
    press(room, first, 1);
    await flush();
    expect(at(room, first).hand.decisions).toHaveLength(1);
    expect(at(room, first).sources).toEqual({});
    expect(at(room, first).stats.n).toBe(0);

    press(room, other, 0);
    await flush();
    expect(at(room, other).hand.result).toBeTruthy();
    expect(at(room, other).sources).toEqual({ live: 1 });
    expect(at(room, other).stats.n).toBe(1);
    expect(at(room, first).sources).toEqual({});
  });

  it("counts no source for a move nothing graded", async () => {
    const { room, asked } = several([betYou(1), betYou(2)], { pause: 1e6 });
    await answer(asked, 0, { error: "no such node" }, FACING);
    const failed = room.snapshot().tables.findIndex((t) => t.failed);
    room.ungraded({ action: "fold" }, failed);
    await flush();
    expect(at(room, failed).hand.result).toBeTruthy();
    expect(at(room, failed).stats.hands).toBe(1);
    expect(at(room, failed).sources).toEqual({});
  });

  it("holds on to the last hand to finish anywhere for K, once its table has dealt the next (`ended`)", async () => {
    const { room, asked } = several([betYou(1), betYou(2)], { pause: 1e6 });
    expect(room.snapshot().ended).toBeNull();
    await answer(asked, 0, FACING, FACING);
    const first = room.snapshot().focus;
    press(room, first, 0);
    await flush();
    const done = at(room, first).hand;
    expect(done.result).toBeTruthy();
    expect(room.snapshot().ended).toEqual({ table: first, hand: done });

    room.dealFinished();
    expect(at(room, first).hand).not.toBe(done);
    expect(room.snapshot().ended).toEqual({ table: first, hand: done });

    // the other's fold is the last to finish now
    press(room, 1 - first, 0);
    await flush();
    expect(room.snapshot().ended!.table).toBe(1 - first);
  });

  it("forgets a finished hand set aside with its table, and a New session forgets them all", async () => {
    const { room, asked } = several([betYou(1), betYou(2)], { pause: 1e6 });
    await answer(asked, 0, FACING, FACING);
    const top = 1;
    room.pick(top);
    press(room, top, 0);
    await flush();
    expect(room.snapshot().ended).toMatchObject({ table: top });
    room.setTables(1);
    expect(room.snapshot().ended).toBeNull();

    const { room: other, asked: more } = several([betYou(3), betYou(4)], { pause: 1e6 });
    await answer(more, 0, FACING, FACING);
    const front = other.snapshot().focus;
    press(other, front, 0);
    await flush();
    expect(other.snapshot().ended).not.toBeNull();
    other.startSession(6, 100, OPTS);
    expect(other.snapshot().ended).toBeNull();
  });

  it("deals a saved seat this game doesn't have as the Random the row shows, not one that moves", async () => {
    useSettings.setState({ practiceSeat: "UTG" });
    const { room } = setup({ players: 2, tables: 4, seedOf: () => 1, pace: 0, pause: 0, guard: 0 });
    expect(new Set(room.snapshot().tables.map((t) => t.hand.hero)).size).toBe(1);
  });

  it("marks a drill's deals used up on its table, nothing asked there until Try again deals afresh", async () => {
    const { room, asked } = several([preflop(1), { ...spot(2, "BTN"), pot: "srp" }], { spot: "srp", seat: "BTN" });
    for (let i = 0; i < 8 * DRILL_TRIES && !at(room, 1).spent; i += 1) {
      await flush();
      const a = asked.at(-1)!;
      a.answer(a.play ? move("fold") : CHART);
      await flush();
    }
    expect(at(room, 1)).toMatchObject({ spent: true, error: `No single-raised pot in ${DRILL_TRIES} deals.` });
    const n = asked.length;
    await pass(5000);
    expect(asked).toHaveLength(n);

    room.retry(1);
    expect(at(room, 1)).toMatchObject({ spent: false, error: null });
    await flush();
    expect(asked.length).toBeGreaterThan(n);
  });

  it("says what a stop costs on the client in use: not known until there's one, kills where it can't say", async () => {
    const { room } = several([flopYou(1), flopYou(2)], { stop: "kills", start: false });
    expect(room.snapshot().stopCost).toBeNull();
    room.start();
    await flush();
    expect(room.snapshot().stopCost).toBe("kills");

    const { room: cheap } = several([flopYou(1), flopYou(2)]);
    await flush();
    expect(cheap.snapshot().stopCost).toBe("cheap");

    const { room: silent } = several([flopYou(1), flopYou(2)], { stop: null });
    await flush();
    expect(silent.snapshot().stopCost).toBe("kills");
  });

  it("reads Settings' Spots and Seat as what can be played", () => {
    expect(spotOf(null, false, true)).toBe("lib");
    expect(spotOf("lib", false, true)).toBe("lib");
    expect(spotOf(null, false, false)).toBe("any");
    expect(spotOf("lib", false, false)).toBe("any");
    expect(spotOf(null, true, true)).toBe("any");
    expect(spotOf("lib", true, true)).toBe("any");
    expect(spotOf("gone", false, true)).toBe("any");
    expect(spotOf("any", false, true)).toBe("any");
    expect(spotOf("srp", false, false)).toBe("srp");
    expect(spotOf("srp", true, true)).toBe("any");
    expect(seatsFor(6, "bvb")).toEqual(["SB", "BB"]);
    expect(seatsFor(2, "any")).toEqual(["SB", "BB"]);
    expect(seatsFor(6, "srp")).toContain("UTG");
    expect(seatOf("BB", 6, "bvb")).toBe("BB");
    expect(seatOf("BTN", 6, "bvb")).toBe("random");
    expect(seatOf("BTN", 6, "any")).toBe("BTN");
    expect(seatOf("UTG", 2, "any")).toBe("random");
    expect(seatOf("random", 6, "any")).toBe("random");
  });

  it("carries no chips from hand to hand above one table, in a session that carries them", async () => {
    const { room, asked } = setup({ players: 2, tables: 2, seat: "moves", opts: { ...OPTS, carry: true }, pace: 0, pause: 0, guard: 0 });
    // (at table 2 you're the big blind, and the small blind folds)
    await answer(asked, 0, CHART, move("fold"));
    expect(room.snapshot().session.hands).toBe(1);
    expect(at(room, 1).hand.n).toBe(2);
    expect(at(room, 1).hand).not.toHaveProperty("stacks");
  });

  it("keeps a preflop-only session on Any hand above one table, as a drill would stop it counting net", async () => {
    const { room } = setup({ players: 6, opts: { ...OPTS, preflopOnly: true }, tables: 2, spot: "srp", pace: 0, pause: 0, guard: 0 });
    expect(at(room, 1).hand).toMatchObject({ preflopOnly: true });
    expect(at(room, 1).hand).not.toHaveProperty("pot");
  });

  it("deals a drill again by what the tables deal now", async () => {
    const { room, asked } = several([{ ...spot(1, "BTN"), pot: "srp", ante: 0.1 }, preflop(2)], { spot: "any", seat: "UTG" });
    // (a raise and a raise: off a single-raised pot)
    await answer(asked, 0, FOLD_ONLY, move("raise", 2.5), move("raise", 8));
    expect(at(room, 0).hand).toMatchObject({ hero: "UTG", n: 1, tries: 1 });
    expect(at(room, 0).hand).not.toHaveProperty("pot");
  });

  it("goes back to the setup at one table", async () => {
    const opts = { ...OPTS, seat: "UTG", pot: "srp" as const };
    const { room, asked } = setup({ players: 6, opts, pace: 0, pause: 0, guard: 0, seat: "BB" });
    await flush();
    room.setTables(2);
    expect(at(room, 1).hand).toMatchObject({ hero: "BB" });
    expect(at(room, 1).hand).not.toHaveProperty("pot");
    room.setTables(1);

    // a drill's preflop is played for you: this fold is off it, so it's dealt again, by the setup
    asked[0]!.answer(move("fold"));
    await flush();
    expect(table(room).hand).toMatchObject({ hero: "UTG", pot: "srp", tries: 1 });
  });

  it("sets tables aside as they are and takes them up again, nothing dealt for them", async () => {
    const { room, asked } = several([preflop(1), preflop(2), preflop(3), preflop(4)], { pause: 100_000 });
    await answer(asked, 0, FOLD_ONLY);
    press(room, 0, 0);
    room.pick(3);
    await flush();
    const set = [2, 3].map((i) => at(room, i).hand);
    const { dealt } = room.snapshot().session;
    expect(at(room, 0).stats.hands).toBe(1);

    room.setTables(1);
    expect(room.snapshot().tables).toHaveLength(1);
    expect(at(room, 0).stats.hands).toBe(1);
    room.setTables(4);
    expect(room.snapshot().tables.slice(2).map((t) => t.hand)).toEqual(set);
    expect(room.snapshot().session.dealt).toBe(dealt);
  });

  it("puts a table taken up again at the back of the queue", async () => {
    const { room, asked } = several([flopYou(1), flopYou(2), preflop(3)]);
    await answer(asked, 0, FOLD_ONLY);
    await pass(10);
    await answer(asked, 1, FLOP, FLOP);
    expect(room.snapshot().queue).toEqual([2, 0, 1]);
    room.setTables(2);
    room.setTables(3);
    expect(room.snapshot().queue).toEqual([0, 1, 2]);
  });

  it("gives a finished table its pause again when it's taken up, and leaves no timer on one set aside", async () => {
    const { room, asked } = several([preflop(1), preflop(2)], { pause: 1600 });
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    room.skip();
    press(room, 1, 0);
    const done = at(room, 1).hand;
    expect(done.result).not.toBeNull();
    room.setTables(1);
    expect(vi.getTimerCount()).toBe(0);
    await pass(5000);
    room.setTables(2);
    await pass(1599);
    expect(at(room, 1).hand).toBe(done);
    await pass(1);
    expect(at(room, 1).hand).not.toBe(done);
  });

  it("keeps a set-aside table's result, and tells a client its flop again", async () => {
    const { room, asked, prefetched } = several([preflop(1), flopYou(2)], { pause: 100_000 });
    await answer(asked, 0, FOLD_ONLY, FLOP);
    expect(prefetched).toHaveLength(1);
    room.pick(1);
    press(room, 1, 0);
    room.setTables(1);
    const h = table(room).hand;
    room.setTables(2);
    expect(at(room, 0).hand).toBe(h);
    expect(at(room, 1).hand.decisions).toHaveLength(1);
    expect(prefetched).toHaveLength(2);
  });

  it("stops the guard and the pause with the Room", async () => {
    const { room, asked } = several([preflop(1), preflop(2)], { guard: 350, pause: 1600 });
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    await pass(1000);
    press(room, 0, 0);
    const heard = vi.fn();
    room.subscribe(heard);
    const dealt = room.snapshot().session.dealt;
    room.stop();
    await pass(5000);
    expect(heard).not.toHaveBeenCalled();
    expect(room.snapshot().session.dealt).toBe(dealt);
  });

  it("deals a finished table again after the pause, on its own, and every one at once when told", async () => {
    const { room, asked } = several([preflop(5), preflop(6)], { pause: 1600 });
    await answer(asked, 0, FOLD_ONLY, FOLD_ONLY);
    press(room, 0, 0);
    room.pick(1);
    const done = at(room, 0).hand;
    expect(done.result).not.toBeNull();
    await pass(1599);
    expect(at(room, 0).hand).toBe(done);
    await pass(1);
    expect(at(room, 0).hand).not.toBe(done);
    expect(at(room, 0).hand.result).toBeNull();

    press(room, 1, 0);
    const over = at(room, 1).hand;
    expect(over.result).not.toBeNull();
    room.dealFinished();
    expect(at(room, 1).hand).not.toBe(over);
    expect(at(room, 1).hand.result).toBeNull();
    expect(room.snapshot().session).toMatchObject({ dealt: 4, hands: 2 });
    // (numbered across the tables, not from each table's last)
    expect(room.snapshot().tables.map((t) => t.hand.n)).toEqual([2, 3]);
  });

  it("deals nothing by itself at one table, and nothing by dealFinished: Next hand is yours", async () => {
    const { room, asked } = setup({ players: 2, pause: 0, pace: 0 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    await pass(5000);
    const over = table(room).hand;
    expect(over.result).not.toBeNull();
    room.dealFinished();
    expect(table(room).hand).toBe(over);
  });

  it("asks nothing for a finished table waiting on its pause, a run-out's included", async () => {
    const { room, asked } = setup({ players: 3, pace: 0, pause: 100_000, guard: 0 });
    room.startSession(3, 100, OPTS);
    await flush();
    asked.at(-1)!.answer(CHART);
    await flush();
    room.choose(0);
    room.runOut();
    expect(table(room).hand.run).toBe("played");
    room.setTables(2);
    await flush();
    // (the others' run-out isn't asked for: what's asked is table 2's)
    expect(asked.filter((a) => a.state.hero === table(room).hand.hero && a.play)).toHaveLength(0);
    expect(tableOf(room, asked.at(-1)!)).toBe(1);
  });

  it("has no pace above one table", async () => {
    const { room, asked } = several([flopOpp(1), flopOpp(2)], { pace: 450 });
    await flush();
    asked[0]!.answer(move("check"));
    await flush();
    expect(at(room, 0).hand.lines.flop).toEqual([CHECK]);
    asked[1]!.answer(FLOP);
    await flush();
    press(room, 0, 0);
    expect(at(room, 0).hand.shown).toBe(4);
  });

  it("has no Run it out above one table", async () => {
    const { room, asked } = several([preflop(1), preflop(2)], { pause: 100_000 });
    await answer(asked, 0, FOLD_ONLY);
    press(room, 0, 0);
    room.runOut();
    expect(at(room, 0).hand.run).toBeUndefined();
  });

  it("says in History that a session went to four tables, also once it's back at one", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, persist: true, readKept: async () => undefined, opts: { ...OPTS, seat: "SB", carry: false, pot: null } });
    await flush();
    room.setTables(4);
    room.setTables(1);
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    const { meta } = vi.mocked(putSession).mock.calls.at(-1)![0];
    expect(meta).toMatchObject({ tables: 4 });
    expect(meta).not.toHaveProperty("seat");
    expect(vi.mocked(putSession).mock.calls).toHaveLength(1);
  });

  it("marks no table in a one-table session's review", async () => {
    const { room, asked } = setup({ players: 2 });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    expect(room.snapshot().session.review[0]).not.toHaveProperty("table");
  });

  it("starts every stack afresh back at one table with chips carried, that hand only", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, pause: 100_000, guard: 0, opts: { ...OPTS, carry: true } });
    await toFlop(room, asked);
    asked.at(-1)!.answer(move("check"));
    await flush();
    asked.at(-1)!.answer(FLOP);
    await flush();
    room.choose(1);
    await flush();
    asked.at(-1)!.answer(move("fold"));
    await flush();
    expect(table(room).hand.result?.net).toBe(2.5);

    room.setTables(2);
    room.setTables(1);
    await pass(100);
    room.nextHand();
    const fresh = table(room).hand;
    expect(fresh.stacks).toEqual({ SB: 100, BB: 100 });

    // from there chips carry again
    await flush();
    const waiting = asked.at(-1)!;
    if (fresh.hero === "BB") {
      waiting.answer(move("call"));
      await flush();
    }
    asked.at(-1)!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    room.nextHand();
    expect(table(room).hand.stacks).not.toEqual({ SB: 100, BB: 100 });
  });

  it("forgets a reset of stacks at a New session, which starts them anyway", async () => {
    const opts = { ...OPTS, carry: true };
    const { room, asked } = setup({ players: 2, pace: 0, pause: 100_000, guard: 0, opts });
    await flush();
    room.setTables(2);
    room.setTables(1);
    room.startSession(2, 100, opts);
    await pass(200);
    asked.at(-1)!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    room.nextHand();
    expect(table(room).hand.stacks).not.toEqual({ SB: 100, BB: 100 });
  });

  it("leaves a carried session's stacks alone where tables never went above one", async () => {
    const { room, asked } = setup({ players: 2, pace: 0, opts: { ...OPTS, carry: true } });
    await flush();
    asked[0]!.answer(CHART);
    await flush();
    room.choose(0);
    await flush();
    room.nextHand();
    expect(table(room).hand.stacks).not.toEqual({ SB: 100, BB: 100 });
  });
});

describe("Room telling flops", () => {
  it("tells each table's flop once, the turn at one table not telling its flop again though another's came between", async () => {
    const { room, asked, prefetched } = several([flopYou(1), flopYou(2)]);
    await answer(asked, 0, FLOP, FLOP);
    expect(prefetched.map((f) => f.board)).toEqual([at(room, 0).hand.board, at(room, 1).hand.board].map((b) => b.slice(0, 3).join("")));

    // table 1's turn
    press(room, 0, 0);
    await flush();
    expect(at(room, 0).hand.shown).toBe(4);
    expect(prefetched).toHaveLength(2);
  });

  it("tells a table's flop as it comes out", async () => {
    const { room, asked, prefetched } = several([spot(1, "BB", { preflop: SRP.slice(0, 5) }), preflop(2)]);
    await answer(asked, 0, CHART, FOLD_ONLY);
    expect(prefetched).toHaveLength(0);
    // (you've the big blind: your call closes the preflop)
    press(room, 0, 1);
    await flush();
    expect(at(room, 0).hand.shown).toBe(3);
    expect(prefetched).toHaveLength(1);
  });

  it("tells a new client every flop on the board", async () => {
    const { room, asked, prefetched } = several([flopYou(1), flopYou(2), preflop(3)]);
    await answer(asked, 0, CHART, FLOP, FLOP);
    expect(prefetched).toHaveLength(2);
    const next = fakeClient();
    room.setSolver(async () => next.client);
    room.pick(1);
    press(room, 1, 0);
    await flush();
    expect(next.asked).toHaveLength(1);
    expect(next.prefetched.map((f) => f.board)).toEqual(prefetched.map((f) => f.board));
  });
});

// Study's preflop answer at a node (Advisor._study_preflop): whoever is next on the BTN-vs-BB line, every hand class playing
// the line's move there (multitable.test.js:476). `drop`: classes left out.
const RK = "AKQJT98765432";
const CLASSES = [...RK].flatMap((a, i) => [...RK].map((b, j) => (i === j ? a + b : i < j ? `${a}${b}s` : `${b}${a}o`)));
describe("Asking ahead", () => {
  const MIX: AdvisorResponse = {
    street: "flop",
    pot_bb: 5.5,
    actions: [
      { action: "check", freq: 0.5, ev_bb: 1 },
      { action: "bet 50%", amount_bb: 3, freq: 0.5, ev_bb: 1 },
    ],
  };
  const FACE: AdvisorResponse = {
    street: "flop",
    pot_bb: 8.5,
    actions: [
      { action: "fold", freq: 0.3, ev_bb: 0 },
      { action: "call", freq: 0.4, ev_bb: 0.2 },
      { action: "raise 9", amount_bb: 9, freq: 0.3, ev_bb: 0.2 },
    ],
  };
  /** Your flop spot, first to act. */
  const bbFlop = (seed: number) => spot(seed, "BB", { preflop: SRP }, 3);
  /** Your turn spot, first to act. */
  const bbTurn = (seed: number) => spot(seed, "BB", { preflop: SRP, flop: [CHECK, mv("BTN", "check")] }, 4);
  /** One line to look ahead on. */
  const ONLY_CHECK: AdvisorResponse = { street: "flop", pot_bb: 5.5, actions: [{ action: "check", freq: 1, ev_bb: 1 }] };
  const ahead = (hands: PracticeHand[], o: Parameters<typeof setup>[0] = {}) => several(hands, { askAhead: true, ...o });
  /** A table at your flop spot, BB having checked, with what's asked ahead in the air: BB's reply to your bet. */
  async function inTheAir(o: Parameters<typeof setup>[0] = {}) {
    const r = ahead([flopYou(1)], o);
    await flush();
    r.asked[0]!.answer(FLOP);
    await flush();
    return { ...r, look: r.asked[1]! };
  }
  const CHECKS = 0;
  const BETS = 1;
  const meter = (room: Room) => room.snapshot().ahead.meter;
  const sameAsk = (a: Asked, b: Asked) => expect([a.state, a.play, a.mode]).toEqual([b.state, b.play, b.mode]);
  const show = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    localStorage.clear();
  });

  describe("what goes first", () => {
    it("the other tables' requests, then the look-aheads at the table in front, then the others', and what it asked is there as you move (multitable.test.js:218)", async () => {
      const { room, asked } = ahead([bbFlop(1), bbTurn(2)]);
      const reply = (a: Asked) => (a.state.flop?.at(-1)?.action === "bet" ? move("call") : move("check"));
      await flush();
      expect(asked).toHaveLength(1);
      expect(tableOf(room, asked[0]!)).toBe(0);
      asked[0]!.answer(MIX);
      await flush();
      expect(room.snapshot().focus).toBe(0);
      // table 2's own spot before table 1's look-ahead
      expect(asked).toHaveLength(2);
      expect(tableOf(room, asked[1]!)).toBe(1);
      expect(asked[1]!.play).toBeUndefined();
      expect(asked[1]!.state.flop).toEqual([CHECK, mv("BTN", "check")]);
      asked[1]!.answer(MIX);
      await flush();

      // both wait for you: the table in front's first: BTN's reply to each of your likeliest moves, the flop being solved
      // there, then your turn spot after each
      const seen: Asked[] = [];
      let last = asked.at(-1)!;
      for (let i = 0; i < 8 && tableOf(room, last) === 0; i += 1) {
        seen.push(last);
        last.answer(last.play ? reply(last) : MIX);
        await flush();
        last = asked.at(-1)!;
      }
      expect(seen.slice(0, 2).map((a) => a.play?.seat)).toEqual(["BTN", "BTN"]);
      expect(seen.slice(0, 2).map((a) => a.state.flop![0]!.action).sort()).toEqual(["bet", "check"]);
      const turn = at(room, 0).hand.board.slice(0, 4).join("");
      expect(seen.slice(2).map((a) => [!!a.play, a.state.board])).toEqual([
        [false, turn],
        [false, turn],
      ]);
      // then table 2's: BTN's reply on the turn
      expect(tableOf(room, last)).toBe(1);
      expect(last.play?.seat).toBe("BTN");
      expect(last.state.turn).toHaveLength(1);

      // either line you take at table 1, BTN's reply and your next spot are in hand: no request, your turn at once
      const before = asked.length;
      await pass(5);
      press(room, 0, BETS);
      await flush();
      expect(at(room, 0).hand.lines.flop.map((m) => `${m.pos} ${m.action}`)).toEqual(["BB bet", "BTN call"]);
      expect(at(room, 0).hand.shown).toBe(4);
      expect(at(room, 0).answer).not.toBeNull();
      expect(asked).toHaveLength(before);
      // (table 2 has waited longer: it comes forward, table 1 behind it)
      expect(room.snapshot()).toMatchObject({ focus: 1, queue: [1, 0] });
    });

    it("gives way to a real request that's instant or short, stopping, and goes out again after it", async () => {
      const { room, asked } = ahead([flopYou(1), flopYou(2)]);
      await answer(asked, 0, FLOP, FLOP);
      const look = asked[2]!;
      expect(tableOf(room, look)).toBe(0);
      expect(look.play?.seat).toBe("BB");

      // your bet at table 2: its BB has to answer, and table 1's look-ahead is still wanted
      room.pick(1);
      press(room, 1, BETS);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      expect(asked).toHaveLength(3);
      await pass(100);
      expect(asked).toHaveLength(4);
      expect(tableOf(room, asked[3]!)).toBe(1);
      expect(asked[3]!.play?.seat).toBe("BB");
      expect(at(room, 0).failed).toBeNull();

      // (table 2's hand goes on, and comes first until it waits for you)
      for (let i = 0; i < 8 && tableOf(room, asked.at(-1)!) === 1; i += 1) {
        const a = asked.at(-1)!;
        a.answer(a.play ? move(a.state.board!.length === 6 ? "call" : "check") : FLOP);
        await flush();
      }
      sameAsk(asked.at(-1)!, look);
    });

    it("goes ahead of a long solve at the table in front, and behind one where it isn't", async () => {
      const first = ahead([flopYou(1), turnYou(2)], { mode: "accurate" });
      await flush();
      expect(tableOf(first.room, first.asked[0]!)).toBe(0);
      first.asked[0]!.answer(FLOP);
      await flush();
      expect(tableOf(first.room, first.asked[1]!)).toBe(0);
      expect(first.asked[1]!.play?.seat).toBe("BB");

      const behind = ahead([flopYou(1), turnYou(2)], { mode: "accurate" });
      await flush();
      behind.room.pick(1);
      await flush();
      expect(tableOf(behind.room, behind.asked[0]!)).toBe(0);
      behind.asked[0]!.answer(FLOP);
      await flush();
      expect(tableOf(behind.room, behind.asked[1]!)).toBe(1);
      expect(behind.asked[1]!.play).toBeUndefined();
    });

    it("never doubles what a table wants for real: it goes out as what it is, and its failure marks that table", async () => {
      const further = spot(1, "BTN", { preflop: SRP, flop: [CHECK, mv("BTN", "bet", 1.5)] }, 3);
      const { room, asked } = ahead([flopYou(1), further], { mode: "accurate" });
      await flush();
      asked[0]!.answer(FLOP);
      await flush();
      expect(asked[1]!.play?.seat).toBe("BB");
      expect(meter(room).asked).toBe(0);
      asked[1]!.answer({ error: "no such node" });
      await flush();
      expect(at(room, 1).failed).toBe("no such node");
    });

    it("is stopped when its table's hand ends, you having folded instead (multitable.test.js:262)", async () => {
      const { room, asked } = ahead([betYou(1), betYou(2)]);
      await answer(asked, 0, FACE, FACE);
      const look = asked.at(-1)!;
      expect(tableOf(room, look)).toBe(0);
      press(room, 0, 0);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      expect(room.snapshot().session.hands).toBe(1);
    });
  });

  describe("when it runs", () => {
    it("stops as the page is hidden and starts again as it's shown", async () => {
      const { asked, look } = await inTheAir();
      expect(look.play?.seat).toBe("BB");
      show("hidden");
      expect(look.signal!.aborted).toBe(true);
      await pass(100);
      expect(asked).toHaveLength(2);

      show("visible");
      await flush();
      expect(asked).toHaveLength(3);
      sameAsk(asked[2]!, look);
      expect(asked[2]!.signal!.aborted).toBe(false);
    });

    it("asks your own spot all the same while the page is hidden", async () => {
      show("hidden");
      const { room, asked } = ahead([flopYou(1)]);
      await flush();
      expect(asked).toHaveLength(1);
      asked[0]!.answer(FLOP);
      await flush();
      expect(table(room).answer).not.toBeNull();
      expect(asked).toHaveLength(1);
    });

    it("stops as you leave the tab and starts again as you're back", async () => {
      const { room, asked, look } = await inTheAir();
      room.setActive(false);
      expect(look.signal!.aborted).toBe(true);
      await pass(100);
      expect(asked).toHaveLength(2);
      room.setActive(true);
      await flush();
      expect(asked).toHaveLength(3);
      sameAsk(asked[2]!, look);
    });

    it("tells nobody of a tab that hasn't changed", async () => {
      const { room } = ahead([flopYou(1)]);
      await flush();
      const told = vi.fn();
      room.subscribe(told);
      room.setActive(true);
      expect(told).not.toHaveBeenCalled();
    });

    it("listens to the page only while the Room runs", async () => {
      const { room } = ahead([flopYou(1)]);
      await flush();
      const told = vi.fn();
      room.subscribe(told);
      show("hidden");
      expect(told).toHaveBeenCalledTimes(1);
      room.stop();
      told.mockClear();
      show("visible");
      expect(told).not.toHaveBeenCalled();
    });

    it.each<[string, StopCost | null]>([
      ["a stop would cost the worker", "kills"],
      ["it can't say what a stop costs", null],
    ])("asks nothing ahead where %s", async (_, stop) => {
      const { room, asked } = ahead([flopYou(1), flopYou(2)], { stop });
      await answer(asked, 0, FLOP, FLOP);
      await pass(1000);
      expect(room.snapshot().tables.every((t) => t.answer)).toBe(true);
      expect(asked).toHaveLength(2);
      expect(meter(room).asked).toBe(0);
    });

    it("asks only what's short: at Accurate a reply on a solved street, and not the next street's", async () => {
      const bets = ahead([flopYou(1)], { mode: "accurate" });
      await flush();
      bets.asked[0]!.answer(FLOP);
      await flush();
      expect(bets.asked).toHaveLength(2);
      expect(bets.asked[1]).toMatchObject({ mode: "accurate", play: { seat: "BB" } });

      // (the turn's solve is est 60)
      const checks = ahead([flopYou(1)], { mode: "accurate" });
      await flush();
      checks.asked[0]!.answer({ street: "flop", pot_bb: 5, actions: [{ action: "check", freq: 1, ev_bb: 1 }] });
      await flush();
      expect(checks.asked).toHaveLength(1);
    });

    it("goes by Settings, whose null is the measured default, while the option says otherwise over them", async () => {
      const runs = async (o: Parameters<typeof setup>[0]) => {
        const { room, asked } = several([flopYou(1)], o);
        await flush();
        asked[0]!.answer(FLOP);
        await flush();
        expect(room.snapshot().ahead.on).toBe(asked.length > 1);
        return asked.length > 1;
      };
      useSettings.setState({ askAhead: null });
      expect(await runs({})).toBe(ASK_AHEAD);
      expect(await runs({ askAhead: true })).toBe(true);
      useSettings.setState({ askAhead: true });
      expect(await runs({})).toBe(true);
      expect(await runs({ askAhead: false })).toBe(false);
      useSettings.setState({ askAhead: false });
      expect(await runs({})).toBe(false);
      expect(await runs({ askAhead: true })).toBe(true);
    });

    it("follows the setting as you change it", async () => {
      const { room, asked } = several([flopYou(1)]);
      await flush();
      asked[0]!.answer(FLOP);
      await flush();
      expect(asked).toHaveLength(1);
      useSettings.setState({ askAhead: true });
      await flush();
      expect(asked).toHaveLength(2);
      useSettings.setState({ askAhead: false });
      expect(asked[1]!.signal!.aborted).toBe(true);
      await pass(100);
      expect(asked).toHaveLength(2);
      expect(room.snapshot().ahead.on).toBe(false);
    });
  });

  describe("a look-ahead your move makes real", () => {
    it("stays in the air as the real request, asked once", async () => {
      const { room, asked, look } = await inTheAir();
      press(room, 0, BETS);
      await flush();
      expect(asked).toHaveLength(2);
      expect(look.signal!.aborted).toBe(false);
      look.answer(move("call"));
      await flush();
      expect(table(room).hand.lines.flop.map((m) => m.action)).toEqual(["check", "bet", "call"]);
      expect(asked.filter((a) => a.play?.seat === "BB" && a.state.board!.length === 6)).toHaveLength(1);
    });

    it("isn't stopped for a real short request, being one", async () => {
      const { room, asked } = ahead([flopYou(1), flopYou(2)]);
      await answer(asked, 0, FLOP, FLOP);
      const look = asked[2]!;
      press(room, 0, BETS);
      press(room, 1, BETS);
      await flush();
      expect(look.signal!.aborted).toBe(false);
    });

    it("marks its table if it fails, as a real request", async () => {
      const { room, look } = await inTheAir();
      press(room, 0, BETS);
      await flush();
      look.answer({ error: "no such node" });
      await flush();
      expect(table(room).failed).toBe("no such node");
    });

    it("your own next spot too: its answer arrives as an answer does, with its provenance", async () => {
      const { room, asked } = ahead([bbFlop(1)]);
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse);
      const look = asked[3]!;
      expect(look.play).toBeUndefined();
      expect(look.state.board).toHaveLength(8);
      press(room, 0, CHECKS);
      await flush();
      expect(table(room).hand.shown).toBe(4);
      expect(table(room).answer).toBeNull();
      expect(look.signal!.aborted).toBe(false);
      expect(asked).toHaveLength(4);
      look.answer(MIX);
      await flush();
      expect(table(room).answer).toMatchObject({ provenance: { source: "live" } });
      expect(asked).toHaveLength(5);
    });

    it("isn't stopped over the pace at one table: a table held up by it still wants what comes after, and it's asked once", async () => {
      const { room, asked } = ahead([bbFlop(1)], { pace: 450 });
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse);
      const look = asked[3]!;
      expect(look.state.board).toHaveLength(8);
      await pass(1000);
      press(room, 0, CHECKS);
      await flush();
      expect(look.signal!.aborted).toBe(false);
      // (the reply, then the card)
      await pass(900);
      expect(table(room).hand.shown).toBe(4);
      expect(look.signal!.aborted).toBe(false);
      expect(room.metrics().stops).toBe(0);
      expect(asked).toHaveLength(4);
      look.answer(MIX);
      await flush();
      expect(table(room).answer).toMatchObject({ provenance: { source: "live" } });
      expect(asked.filter((a) => a.state.board!.length === 8 && !a.play)).toHaveLength(1);
      // (the check's reply and the spot, of the three asked; the bet's reply is the one not used)
      expect(meter(room)).toMatchObject({ used: 2 });
    });

    it("asks the line's next request over the pace, as what it is: no guess is left in it", async () => {
      const { room, asked } = ahead([bbFlop(1)], { pace: 450 });
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse);
      const dead = asked[3]!;
      press(room, 0, BETS);
      await flush();
      expect(dead.signal!.aborted).toBe(true);
      await pass(100);
      expect(table(room).hand.shown).toBe(3);
      const next = asked[4]!;
      expect(next.play).toBeUndefined();
      expect(next.state.board).toHaveLength(8);
      expect(next.state.flop!.map((m) => m.action)).toEqual(["bet", "call"]);
      expect(meter(room).asked).toBe(3);
    });

    it("asks over the pace what a look-ahead failed on, which only a look-ahead passes over", async () => {
      const { room, asked } = ahead([bbFlop(1)], { pace: 450 });
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse, { error: "no such node" });
      const bad = asked[3]!;
      press(room, 0, CHECKS);
      await flush();
      await pass(200);
      expect(table(room).hand.shown).toBe(3);
      expect(table(room).failed).toBeNull();
      sameAsk(asked.at(-1)!, bad);
      expect(asked.at(-1)).not.toBe(bad);
    });

    it.each([
      [false, "cheap"],
      [true, "kills"],
    ] as const)("leaves a table to ask on arriving where nothing runs ahead (asking ahead %s, a stop that %s)", async (askAhead, stop) => {
      const { room, asked } = setup({ hands: [bbFlop(1)], pace: 450, pause: 0, guard: 0, askAhead, stop });
      await answer(asked, 0, MIX);
      press(room, 0, CHECKS);
      await flush();
      await answer(asked, 1, move("check") as AdvisorResponse);
      await pass(899);
      expect(table(room).hand.shown).toBe(3);
      expect(asked).toHaveLength(2);
      await pass(1);
      expect(table(room).hand.shown).toBe(4);
      expect(asked).toHaveLength(3);
    });
  });

  describe("one that turns out long", () => {
    const THREE = [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "call"), mv("BB", "call")];

    it("isn't asked where the pot went heads-up on this street, as nothing in hand answers that (advisor.py:5037)", async () => {
      const { asked } = ahead([bbFlop(1), spot(2, "SB", { preflop: THREE }, 3)], { mode: "accurate" });
      await flush();
      const threeWay = (a: Asked) => a.state.preflop!.some((m) => m.pos === "SB" && m.action === "call");
      for (let i = 0; i < 20 && asked[i]; i += 1) {
        const a = asked[i]!;
        a.answer(!a.play ? MIX : (move(threeWay(a) ? "fold" : "check") as AdvisorResponse));
        await flush();
      }
      // (your check at the three-way table, and the big blind's fold to it: BTN is next, heads-up on a street begun three-way)
      expect(asked.some((a) => threeWay(a) && a.play?.seat === "BB")).toBe(true);
      expect(asked.filter((a) => threeWay(a) && a.state.flop!.some((m) => m.action === "fold"))).toEqual([]);
    });

    it("gives way to any real request once past SHORT, and isn't asked ahead again, or it'd go straight back in front", async () => {
      const { room, asked } = ahead([bbFlop(1), bbFlop(2)], { mode: "accurate" });
      await answer(asked, 0, ONLY_CHECK);
      const look = asked[1]!;
      expect(look.play?.seat).toBe("BTN");
      expect(asked).toHaveLength(2);
      await pass(3999);
      expect(look.signal!.aborted).toBe(false);
      await pass(1);
      expect(look.signal!.aborted).toBe(true);
      await pass(100);
      expect(asked).toHaveLength(3);
      expect(asked[2]!.play).toBeUndefined();
      expect(tableOf(room, asked[2]!)).toBe(1);
      expect(meter(room)).toEqual({ asked: 1, used: 0, savedS: 0, spentS: 4.1 });
      expect(table(room).failed).toBeNull();
    });

    it("is still asked for real where your move takes the table there", async () => {
      const { room, asked } = ahead([bbFlop(1), bbFlop(2)], { mode: "accurate" });
      await answer(asked, 0, ONLY_CHECK);
      await pass(4100);
      press(room, 0, CHECKS);
      await flush();
      asked[2]!.answer(MIX);
      await flush();
      expect(asked.filter((a) => a.play?.seat === "BTN")).toHaveLength(2);
    });

    it("runs on where nothing real waits", async () => {
      const { look } = await inTheAir({ mode: "accurate" });
      await pass(60_000);
      expect(look.signal!.aborted).toBe(false);
    });

    it("keeps one timer for it, and leaves none behind as the Room stops", async () => {
      const { room } = await inTheAir();
      room.pump();
      room.pump();
      expect(vi.getTimerCount()).toBe(1);
      room.stop();
      await pass(100);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps none for a real request", async () => {
      const { room } = several([flopYou(1)]);
      await flush();
      room.pump();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("after a stop that ended the worker", () => {
    const stuck = () => new SolverError("stuck", "The solver stopped answering; it restarts on the next request.");
    /** Your flop bet with a look-ahead on your check in the air, which doesn't hear the stop. */
    async function ended(o: Parameters<typeof setup>[0] = {}) {
      useSettings.setState({ askAhead: null });
      const r = several([bbFlop(1)], { deaf: true, ...o });
      await flush();
      r.asked[0]!.answer(MIX);
      await flush();
      const look = r.asked[1]!;
      expect(look.play?.seat).toBe("BTN");
      press(r.room, 0, BETS);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      expect(r.asked).toHaveLength(2);
      look.reject(stuck());
      await flush();
      expect(r.room.snapshot().restarts).toBe(1);
      return r;
    }

    it("takes the street's solve as gone with it: the new worker doesn't hold it", async () => {
      const { room, asked } = await ended();
      expect(asked).toHaveLength(3);
      asked[2]!.answer(move("call"));
      await flush();
      expect(room.metrics().solves.at(-1)).toMatchObject({ kind: "opp", street: "flop", est: 2 });
    });

    it("takes it as gone where every stop ends the worker too, though nothing's wrong, so that's no restart", async () => {
      useSettings.setState({ mode: "accurate" });
      const { room, asked } = several([bbFlop(1), turnYou(2)], { stop: "kills", deaf: true });
      await flush();
      asked[0]!.answer(MIX);
      await flush();
      // (Table 2's long solve, dead once it's set aside: the worker ended, its request goes as cancelled)
      const long = asked[1]!;
      room.setTables(1);
      await flush();
      expect(long.signal!.aborted).toBe(true);
      long.reject(new SolverError("cancelled", "cancelled"));
      await flush();
      expect(room.snapshot().restarts).toBe(0);

      press(room, 0, CHECKS);
      await flush();
      const reply = asked.at(-1)!;
      expect(reply.play?.seat).toBe("BTN");
      // (a whole solve on the new worker, so it's worth the stop that a New session makes of it)
      room.startSession(6, 100, OPTS);
      await flush();
      expect(reply.signal!.aborted).toBe(true);
    });

    it("keeps it where a stop leaves the worker up", async () => {
      useSettings.setState({ mode: "accurate" });
      const { room, asked } = several([bbFlop(1), turnYou(2)], { deaf: true, askAhead: false });
      await flush();
      asked[0]!.answer(MIX);
      await flush();
      const long = asked[1]!;
      room.setTables(1);
      await flush();
      expect(long.signal!.aborted).toBe(true);
      long.reject(new SolverError("cancelled", "cancelled"));
      await flush();
      press(room, 0, CHECKS);
      await flush();
      asked.at(-1)!.answer(move("check"));
      await flush();
      expect(room.metrics().solves.at(-1)).toMatchObject({ kind: "opp", street: "flop", est: 0.2 });
    });

    it("keeps it where the stop came before the worker was reached, as that ended nothing", async () => {
      useSettings.setState({ mode: "accurate" });
      const { room, asked, getSolver, client } = several([bbFlop(1), turnYou(2)], { stop: "kills", deaf: true });
      await flush();
      // (Table 2's solve, stopped on its way to the client)
      let reach = (_: RoomClient) => {};
      getSolver.mockImplementationOnce(() => new Promise<RoomClient>((go) => (reach = go)));
      asked[0]!.answer(MIX);
      await flush();
      room.setTables(1);
      await flush();
      reach(client);
      await flush();
      expect(asked).toHaveLength(1);
      press(room, 0, CHECKS);
      await flush();
      asked.at(-1)!.answer(move("check"));
      await flush();
      expect(room.metrics().solves.at(-1)).toMatchObject({ kind: "opp", street: "flop", est: 0.2 });
    });

    it("asks nothing ahead again, with the box at its default, for the page's life", async () => {
      const { room, asked } = await ended();
      asked[2]!.answer(move("call"));
      await flush();
      expect(asked).toHaveLength(4);
      expect(table(room).hand.shown).toBe(4);
      asked[3]!.answer(MIX);
      await flush();
      expect(table(room).answer).not.toBeNull();
      expect(asked).toHaveLength(4);
      expect(meter(room).asked).toBe(1);
      // (nor a New session's hands: it's the page's solver that didn't answer)
      room.startSession(6, 100, OPTS);
      await flush();
      await pass(1000);
      expect(meter(room).asked).toBe(1);
    });

    it("doesn't ask what comes after a pace either", async () => {
      useSettings.setState({ askAhead: null });
      const { room, asked } = await ended({ hands: [bbFlop(1)], pace: 450 });
      asked[2]!.answer(move("call"));
      await flush();
      await pass(449);
      expect(table(room).hand.shown).toBe(3);
      expect(asked).toHaveLength(3);
    });
  });

  describe("the meter", () => {
    it("leaves out a preflop look-ahead, as it's a chart read: a run of them would read as solves hit", async () => {
      const { room, asked } = ahead([spot(1, "UTG")]);
      await flush();
      asked[0]!.answer(CHART);
      await flush();
      const look = asked[1]!;
      expect(look.play?.seat).toBe("HJ");
      expect(look.state.board).toBeFalsy();
      await pass(1000);
      look.answer(move("fold"));
      await flush();
      press(room, 0, 2);
      await flush();
      expect(meter(room)).toEqual({ asked: 0, used: 0, savedS: 0, spentS: 0 });
    });

    it("starts at nothing, and stays there where nothing has been asked", async () => {
      const { room, asked } = several([flopYou(1)]);
      await flush();
      asked[0]!.answer(FLOP);
      await flush();
      expect(meter(room)).toEqual({ asked: 0, used: 0, savedS: 0, spentS: 0 });
    });

    it("counts what a stopped look-ahead cost, as it settles", async () => {
      const { room, look } = await inTheAir();
      expect(meter(room)).toMatchObject({ asked: 1, spentS: 0 });
      await pass(1000);
      press(room, 0, CHECKS);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      expect(meter(room).spentS).toBe(0);
      await pass(100);
      expect(meter(room)).toEqual({ asked: 1, used: 0, savedS: 0, spentS: 1.1 });
    });

    it("counts an answer as what it cost, and what it saved only as a table takes it", async () => {
      const { room, look } = await inTheAir();
      await pass(3000);
      look.answer(move("fold"));
      await flush();
      expect(meter(room)).toEqual({ asked: 2, used: 0, savedS: 0, spentS: 3 });
      expect(room.metrics().solves.at(-1)).toMatchObject({ ahead: true, s: 3 });
      await pass(5000);
      press(room, 0, BETS);
      await flush();
      expect(meter(room)).toMatchObject({ used: 1, savedS: 3 });
    });

    it("counts each answer taken as used once, a held one as it's taken and one in the air as it answers", async () => {
      const { room, asked, look } = await inTheAir();
      await pass(3000);
      look.answer(move("call"));
      await flush();
      await pass(5000);
      // (the line you take has its next in the air)
      press(room, 0, BETS);
      await flush();
      expect(meter(room)).toEqual({ asked: 2, used: 1, savedS: 3, spentS: 8 });
      await pass(2000);
      asked.at(-1)!.answer(move("check"));
      await flush();
      expect(meter(room)).toEqual({ asked: 2, used: 2, savedS: 8, spentS: 8 });
    });

    it("counts your next spot taken from the look-ahead that asked it, once, however long you've looked at it", async () => {
      const { room, asked } = ahead([bbFlop(1)]);
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse);
      await pass(2000);
      asked[3]!.answer(MIX);
      await flush();
      press(room, 0, CHECKS);
      await flush();
      expect(table(room).answer).not.toBeNull();
      // (the reply and the spot)
      expect(meter(room)).toMatchObject({ used: 2, savedS: 2 });
      await pass(1000);
      room.pump();
      expect(meter(room).used).toBe(2);
    });

    it("counts a look-ahead made real as the head start it was, and the rest as a wait like any other", async () => {
      const { room, look } = await inTheAir();
      await pass(2000);
      press(room, 0, BETS);
      await flush();
      expect(meter(room)).toEqual({ asked: 1, used: 0, savedS: 0, spentS: 2 });
      await pass(3000);
      look.answer(move("call"));
      await flush();
      expect(meter(room)).toEqual({ asked: 1, used: 1, savedS: 2, spentS: 2 });
      expect(room.metrics().solves.at(-1)).toMatchObject({ s: 5 });
      expect(room.metrics().solves.at(-1)).not.toHaveProperty("ahead");
    });

    it("counts a look-ahead made real that then fails as nothing used", async () => {
      const { room, look } = await inTheAir();
      await pass(1000);
      press(room, 0, BETS);
      await flush();
      look.answer({ error: "no such node" });
      await flush();
      expect(table(room).failed).toBe("no such node");
      expect(meter(room)).toEqual({ asked: 1, used: 0, savedS: 0, spentS: 1 });
    });

    it("counts a look-ahead made real that a new session stops as nothing used", async () => {
      const { room, look } = await inTheAir();
      await pass(1000);
      press(room, 0, BETS);
      await flush();
      room.startSession(6, 100, OPTS);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      await pass(100);
      look.answer(move("call"));
      await flush();
      expect(meter(room)).toEqual({ asked: 1, used: 0, savedS: 0, spentS: 1 });
    });

    it("counts one made real before it reached the solver as a real request", async () => {
      const { room, asked, getSolver, client } = ahead([flopYou(1)]);
      await flush();
      getSolver.mockImplementation(() => new Promise((r) => setTimeout(() => r(client), 1000)));
      asked[0]!.answer(FLOP);
      await flush();
      press(room, 0, BETS);
      await flush();
      await pass(1000);
      asked[1]!.answer(move("call"));
      await flush();
      expect(table(room).hand.lines.flop.at(-1)).toMatchObject({ pos: "BB", action: "call" });
      expect(meter(room)).toMatchObject({ used: 0, savedS: 0 });
    });

    it("saves nothing on a reply the pace would have covered anyway", async () => {
      const { room, look } = await inTheAir({ pace: 450 });
      await pass(300);
      look.answer(move("call"));
      await flush();
      press(room, 0, BETS);
      await flush();
      await pass(450);
      expect(table(room).hand.lines.flop.at(-1)).toMatchObject({ pos: "BB", action: "call" });
      expect(meter(room)).toMatchObject({ used: 1, savedS: 0 });
    });

    it("saves what a reply took past the pace, and all of a spot held as you arrive", async () => {
      const { room, asked } = ahead([bbFlop(1)], { pace: 450 });
      await answer(asked, 0, MIX);
      await pass(2000);
      asked[1]!.answer(move("check") as AdvisorResponse);
      await flush();
      asked[2]!.answer(move("call") as AdvisorResponse);
      await flush();
      await pass(3000);
      asked[3]!.answer(MIX);
      await flush();
      await pass(100);
      press(room, 0, CHECKS);
      await flush();
      await pass(450);
      expect(meter(room).savedS).toBeCloseTo(1.55);
      await pass(450);
      expect(table(room).answer).not.toBeNull();
      expect(meter(room).savedS).toBeCloseTo(4.55);
    });

    it("saves nothing at a table that isn't in front, nothing else waiting or not", async () => {
      const { room, asked } = ahead([flopYou(1), flopYou(2)]);
      await answer(asked, 0, FLOP, FLOP);
      const look = asked[2]!;
      await pass(2000);
      press(room, 0, BETS);
      await flush();
      press(room, 1, BETS);
      await flush();
      expect(room.snapshot().focus).toBe(1);
      await pass(1000);
      look.answer(move("call"));
      await flush();
      expect(meter(room)).toMatchObject({ used: 1, savedS: 0 });
    });

    it("saves the wait at a table that comes forward as its answer does", async () => {
      const { room, asked } = ahead([bbFlop(1), flopYou(2)]);
      await answer(asked, 0, MIX, FLOP, move("check") as AdvisorResponse, move("call") as AdvisorResponse);
      const look = asked[4]!;
      expect(look.state.board).toHaveLength(8);
      await pass(2000);
      press(room, 0, CHECKS);
      await flush();
      press(room, 1, BETS);
      await flush();
      expect(room.snapshot().focus).toBe(1);
      await pass(1000);
      look.answer(MIX);
      await flush();
      expect(room.snapshot().focus).toBe(0);
      expect(meter(room).savedS).toBe(2);
    });

    it("saves nothing where another table's waiting for you, whichever you're looking at", async () => {
      const { room, asked } = ahead([flopYou(1), flopYou(2)]);
      await answer(asked, 0, FLOP, FLOP);
      const look = asked[2]!;
      await pass(2000);
      press(room, 0, BETS);
      await flush();
      room.pick(0);
      expect(room.snapshot().focus).toBe(0);
      await pass(1000);
      look.answer(move("call"));
      await flush();
      expect(meter(room)).toMatchObject({ used: 1, savedS: 0 });
    });

    it("counts nothing for a move the table refused, asked again for real", async () => {
      const { room, asked, look } = await inTheAir();
      // (a check, facing your bet)
      look.answer(move("check"));
      await flush();
      await pass(100);
      press(room, 0, BETS);
      await flush();
      expect(table(room).failed).toBeTruthy();
      room.retry();
      await flush();
      await pass(100);
      const real = asked.at(-1)!;
      sameAsk(real, look);
      real.answer(move("call"));
      await flush();
      expect(table(room).hand.lines.flop.at(-1)).toMatchObject({ pos: "BB", action: "call" });
      expect(meter(room).used).toBe(0);
    });

    it("counts an answer two tables take as used once", async () => {
      const { room, asked } = ahead([bbFlop(1), bbFlop(1)], { pause: 1e6 });
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse, MIX);
      await pass(5);
      press(room, 0, CHECKS);
      await flush();
      expect(at(room, 0).answer).not.toBeNull();
      const was = meter(room).used;
      expect(was).toBe(2);

      press(room, 1, CHECKS);
      await flush();
      await pass(100);
      asked.at(-1)!.answer(move("check"));
      await flush();
      expect(at(room, 1).hand.shown).toBe(4);
      expect(at(room, 1).answer).not.toBeNull();
      expect(meter(room).used).toBe(was);
    });

    it("counts nothing for one that never reached the solver", async () => {
      const { room, asked, getSolver, client } = ahead([flopYou(1)]);
      await flush();
      getSolver.mockImplementation(() => new Promise((r) => setTimeout(() => r(client), 1000)));
      asked[0]!.answer(FLOP);
      await flush();
      expect(asked).toHaveLength(1);
      await pass(500);
      show("hidden");
      await pass(500);
      expect(asked).toHaveLength(1);
      expect(meter(room)).toEqual({ asked: 0, used: 0, savedS: 0, spentS: 0 });
    });

    it("holds no more answers than the caches, and none past a new client", async () => {
      // (the seconds of an answer nothing has used: only `usedAhead` reads them, so this looks at them direct)
      const held = (room: Room) => (room as unknown as { aheadHeld: Map<string, number> }).aheadHeld;
      const { room, look } = await inTheAir();
      for (let i = 0; i < 400; i += 1) held(room).set(`old ${i}`, 1);
      look.answer(move("call"));
      await flush();
      expect(held(room).size).toBe(400);
      expect(held(room).has("old 0")).toBe(false);

      room.setSolver(async () => fakeClient().client);
      await flush();
      expect(held(room).size).toBe(0);
    });

    it("counts a real request as nothing", async () => {
      const { room, asked } = several([flopYou(1)]);
      await flush();
      await pass(1000);
      room.pump();
      asked[0]!.answer(FLOP);
      await flush();
      expect(meter(room)).toEqual({ asked: 0, used: 0, savedS: 0, spentS: 0 });
      expect(room.metrics().solves.at(-1)).not.toHaveProperty("ahead");
    });

    it("counts one a failure ended, and one a new client let go, once", async () => {
      const failed = await inTheAir();
      await pass(1000);
      failed.look.answer({ error: "no" });
      await flush();
      expect(meter(failed.room)).toMatchObject({ asked: 2, spentS: 1 });

      const { room, look } = await inTheAir();
      await pass(1000);
      room.setSolver(async () => fakeClient().client);
      expect(meter(room)).toMatchObject({ asked: 1, spentS: 1 });
      expect(look.signal!.aborted).toBe(true);
      await pass(1000);
      expect(meter(room)).toMatchObject({ asked: 1, spentS: 1 });
    });

    it("counts one rejected", async () => {
      const { room, look } = await inTheAir();
      await pass(1000);
      look.reject(new Error("boom"));
      await flush();
      expect(meter(room)).toMatchObject({ spentS: 1 });
    });
  });

  describe("what fails", () => {
    it("says nothing at the table, and isn't asked ahead again", async () => {
      const { room, asked, look } = await inTheAir();
      look.answer({ error: "no such node" });
      await flush();
      expect(table(room).failed).toBeNull();
      expect(table(room).error).toBeNull();
      // (on to your other line)
      expect(asked).toHaveLength(3);
      expect(asked[2]!.state.board).toHaveLength(8);
      asked[2]!.answer(move("check"));
      await flush();
      expect(asked.filter((a, i) => i > 1 && a.state.board!.length === 6)).toEqual([]);
    });

    it("is asked for real all the same once you take that line, and marks the table only then", async () => {
      const { room, asked, look } = await inTheAir();
      look.answer({ error: "no such node" });
      await flush();
      await pass(10);
      press(room, 0, BETS);
      await flush();
      await pass(100);
      const real = asked.at(-1)!;
      sameAsk(real, look);
      expect(real).not.toBe(look);
      real.answer({ error: "no such node" });
      await flush();
      expect(table(room).failed).toBe("no such node");
    });

    it("rejected says nothing at the table either", async () => {
      const { room, asked, look } = await inTheAir();
      look.reject(new Error("the wire was cut"));
      await flush();
      expect(table(room).failed).toBeNull();
      expect(table(room).error).toBeNull();
      expect(asked).toHaveLength(3);
      expect(asked[2]!.state.board).toHaveLength(8);
    });

    it("cancelled by nobody is asked once more, and then passed over like any failure", async () => {
      const { room, asked, look } = await inTheAir();
      look.reject(new SolverError("cancelled", "cancelled"));
      await flush();
      expect(asked).toHaveLength(3);
      sameAsk(asked[2]!, look);
      asked[2]!.reject(new SolverError("cancelled", "cancelled"));
      await flush();
      expect(table(room).failed).toBeNull();
      expect(asked).toHaveLength(4);
      expect(asked[3]!.state.board).toHaveLength(8);
    });

    it("stopped says nothing of the request: it's asked again, not passed over", async () => {
      const { asked, look } = await inTheAir({ deaf: true });
      show("hidden");
      look.answer({ error: "too late" });
      await flush();
      show("visible");
      await flush();
      expect(asked).toHaveLength(3);
      sameAsk(asked[2]!, look);
    });
  });

  describe("a drawn move", () => {
    it("is used once: a second table at the same spot draws its own", async () => {
      const { room, asked } = ahead([flopYou(1), flopYou(1)], { pause: 1e6 });
      await answer(asked, 0, FLOP);
      expect(room.snapshot().tables.every((t) => t.answer)).toBe(true);
      const look = asked[1]!;
      expect(look.play?.seat).toBe("BB");
      look.answer(move("call"));
      await flush();
      await pass(5);
      press(room, 0, BETS);
      await flush();
      expect(at(room, 0).hand.lines.flop.at(-1)).toMatchObject({ pos: "BB", action: "call" });
      press(room, 1, BETS);
      // (what's in the air was table 1's next, real now, and then its spot on the turn)
      await answer(asked, 2, move("check") as AdvisorResponse, FLOP);
      expect(at(room, 1).hand.lines.flop.at(-1)).toMatchObject({ pos: "BTN", action: "bet" });
      const draws = asked.filter((a) => a.play?.seat === "BB" && a.state.board!.length === 6);
      expect(draws).toHaveLength(2);
      sameAsk(draws[1]!, draws[0]!);
      draws[1]!.answer(move("fold"));
      await flush();
      expect(at(room, 1).hand.lines.flop.at(-1)).toMatchObject({ pos: "BB", action: "fold" });
    });

    it("stays in hand as a look-ahead is walked past it, so taking it later is the same move", async () => {
      const { room, asked } = ahead([bbFlop(1)]);
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse);
      asked[3]!.answer(MIX);
      await flush();
      await pass(1000);
      press(room, 0, BETS);
      await flush();
      expect(table(room).hand.lines.flop.map((m) => m.action)).toEqual(["bet", "call"]);
      expect(asked.filter((a) => a.play?.seat === "BTN" && a.state.board!.length === 6)).toHaveLength(2);
    });
  });

  describe("your habits", () => {
    const KEPT = { persist: true, readKept: async () => null };
    const CHECKY: AdvisorResponse = {
      street: "flop",
      pot_bb: 5,
      actions: [
        { action: "check", freq: 0.7, ev_bb: 2 },
        { action: "bet 33%", freq: 0.3, ev_bb: 2, amount_bb: 1.5 },
      ],
    };

    it("are kept as you decide, by whether you faced a bet", async () => {
      const open = ahead([flopYou(1)], { ...KEPT, askAhead: false });
      await flush();
      open.asked[0]!.answer(FLOP);
      await flush();
      press(open.room, 0, BETS);
      expect(readHabits().open).toEqual({ fold: 0, pass: 0, aggr: 1 });
      expect(readHabits().facing).toBeUndefined();
      open.room.stop();

      const facing = ahead([betYou(2)], { ...KEPT, askAhead: false });
      await flush();
      facing.asked[0]!.answer(FACING);
      await flush();
      press(facing.room, 0, 0);
      expect(readHabits().open).toEqual({ fold: 0, pass: 0, aggr: 1 });
      expect(readHabits().facing).toEqual({ fold: 1, pass: 0, aggr: 0 });
    });

    it("say which lines are asked ahead", async () => {
      saveHabits({ open: { fold: 0, pass: 10, aggr: 0 } });
      const { asked } = ahead([flopYou(1)], KEPT);
      await flush();
      asked[0]!.answer(CHECKY);
      await flush();
      // (your bet: under 20% blended)
      expect(asked).toHaveLength(2);
      expect(asked[1]!.state.board).toHaveLength(8);
    });

    it("are neither read nor written with persist off", async () => {
      saveHabits({ open: { fold: 0, pass: 10, aggr: 0 } });
      const { room, asked } = ahead([flopYou(1)]);
      await flush();
      asked[0]!.answer(CHECKY);
      await flush();
      expect(asked[1]!.state.board).toHaveLength(6);
      press(room, 0, CHECKS);
      expect(readHabits().open).toEqual({ fold: 0, pass: 10, aggr: 0 });
    });
  });

  describe("what it leaves alone", () => {
    /** Your bet at table 1, its reply a call, then the turn: asked ahead or not. */
    async function played(askAhead: boolean) {
      vi.setSystemTime(1000);
      const { room, asked } = several([flopYou(1)], { askAhead });
      await flush();
      asked[0]!.answer(FLOP);
      await flush();
      if (askAhead) asked[1]!.answer(move("call"));
      await flush();
      press(room, 0, BETS);
      await flush();
      await pass(100);
      if (!askAhead) asked[1]!.answer(move("call"));
      await flush();
      return table(room);
    }

    it("reaches no grade, no provenance and no hand: a line asked ahead plays as one asked at its turn", async () => {
      const off = await played(false);
      const on = await played(true);
      expect(on.hand).toEqual(off.hand);
      expect(on.last).toEqual(off.last);
      expect(on.last).toMatchObject({ provenance: { source: "live" } });
    });

    it("reaches no session, and no record of one", async () => {
      const kept = { persist: true, readKept: async () => null };
      const { room, asked } = ahead([flopYou(1), flopYou(2)], kept);
      await answer(asked, 0, FLOP, FLOP);
      asked[2]!.answer(move("call"));
      await flush();
      press(room, 0, BETS);
      await flush();
      expect(meter(room).used).toBeGreaterThan(0);
      await pass(1000);
      expect(room.snapshot().session.score.n).toBe(1);
      expect(JSON.stringify(room.snapshot().session)).not.toMatch(/ahead/i);
      expect(JSON.stringify(vi.mocked(putSession).mock.calls)).not.toMatch(/ahead/i);
    });

    it("keeps a look-ahead out of the pace of a table: the wait it saved is a wait of nothing, as any answer in hand", async () => {
      const { room, asked } = ahead([bbFlop(1)]);
      await answer(asked, 0, MIX, move("check") as AdvisorResponse, move("call") as AdvisorResponse);
      asked[3]!.answer(MIX);
      await flush();
      await pass(1000);
      press(room, 0, CHECKS);
      await flush();
      expect(room.metrics().decisions).toBe(2);
      expect(room.metrics().median).toBe(0);
    });
  });

  describe("as the tables change", () => {
    it("a new client: the meter stays, what's in hand goes, and your own spot's asked before anything ahead", async () => {
      const { room, asked, look } = await inTheAir();
      look.answer(move("call"));
      await flush();
      asked[2]!.answer(move("check"));
      await flush();
      const was = meter(room);
      expect(was.asked).toBe(3);

      const next = fakeClient();
      room.setSolver(async () => next.client);
      await flush();
      expect(meter(room)).toEqual(was);
      expect(next.asked).toHaveLength(1);
      expect(next.asked[0]!.play).toBeUndefined();
      sameAsk(next.asked[0]!, asked[0]!);
      next.asked[0]!.answer(FLOP);
      await flush();
      // (the move it had in hand went with it)
      expect(next.asked).toHaveLength(2);
      sameAsk(next.asked[1]!, look);
    });

    it("a new client asks again what the last one failed on", async () => {
      const { room, look } = await inTheAir();
      look.answer({ error: "no such node" });
      await flush();
      const next = fakeClient();
      room.setSolver(async () => next.client);
      await flush();
      next.asked[0]!.answer(FLOP);
      await flush();
      sameAsk(next.asked[1]!, look);
    });

    it("a new client that can't stop cheaply is asked nothing ahead", async () => {
      const { room, look } = await inTheAir();
      await pass(10);
      const next = fakeClient({ stop: "kills" });
      room.setSolver(async () => next.client);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      expect(next.asked).toHaveLength(1);
      next.asked[0]!.answer(FLOP);
      await flush();
      expect(next.asked).toHaveLength(1);
      expect(room.snapshot().stopCost).toBe("kills");
    });

    it("a table that goes takes its look-ahead with it, and asks again as it's back", async () => {
      const { room, asked } = ahead([flopYou(1), flopYou(2)]);
      await flush();
      room.pick(1);
      await answer(asked, 0, FLOP, FLOP);
      const look = asked[2]!;
      expect(tableOf(room, look)).toBe(1);

      room.setTables(1);
      expect(look.signal!.aborted).toBe(true);
      await pass(100);
      // (the table left has its own)
      expect(asked).toHaveLength(4);
      expect(tableOf(room, asked[3]!)).toBe(0);

      room.setTables(2);
      await flush();
      for (let i = 0; i < 8 && tableOf(room, asked.at(-1)!) === 0; i += 1) {
        const a = asked.at(-1)!;
        a.answer(a.play ? move("check") : FLOP);
        await flush();
      }
      sameAsk(asked.at(-1)!, look);
    });

    it("up from one table: the new table's own request goes before the look-ahead, which gives way", async () => {
      const { room, asked, look } = await inTheAir({ seedOf: (n) => n + 50 });
      room.setTables(2);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      await pass(100);
      expect(asked.at(-1)!.state.preflop).toEqual([]);
    });

    it("New session: stops what's in the air, and the meter stays", async () => {
      const { room, look } = await inTheAir();
      await pass(1000);
      room.startSession(6, 100, OPTS);
      await flush();
      expect(look.signal!.aborted).toBe(true);
      await pass(100);
      expect(meter(room)).toEqual({ asked: 1, used: 0, savedS: 0, spentS: 1.1 });
    });

    it("New session: what failed is asked again, as the same cards can come up", async () => {
      const { room, asked } = setup({ players: 2, askAhead: true, pace: 0, seedOf: () => 7 });
      await flush();
      asked[0]!.answer(CHART);
      await flush();
      // (heads-up the button faces the blind: your raise's reply, then your call's)
      const raise = asked[1]!;
      expect(raise.play?.seat).toBe("BB");
      raise.answer({ error: "no" });
      await flush();
      asked[2]!.answer({ error: "no" });
      await flush();
      expect(asked).toHaveLength(3);

      room.startSession(2, 100, OPTS);
      await flush();
      expect(table(room).answer).not.toBeNull();
      expect(asked).toHaveLength(4);
      sameAsk(asked[3]!, raise);
    });
  });
});

const SEATS6 = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const BTN_BB: Record<string, string> = { UTG: "fold", HJ: "fold", CO: "fold", BTN: "raise 2.5", SB: "fold", BB: "call" };
function chartOf(q: AdvisorState, drop: (seat: string, cls: string) => boolean = () => false): AdvisorResponse {
  const seat = SEATS6[q.preflop!.length]!;
  const actions = ["fold", "call", "raise 2.5"].map((a) => ({ action: a, amount_bb: a === "raise 2.5" ? 2.5 : undefined, freq: a === BTN_BB[seat] ? 1 : 0 }));
  const cells = Object.fromEntries(CLASSES.filter((c) => !drop(seat, c)).map((c) => [c, { w: 1, f: actions.map((a) => a.freq) }]));
  return { study: "node", street: "preflop", actor: seat, actions, grid: { actions: actions.map((a) => a.action), cells } };
}

describe("Instant flops", () => {
  const LINE = ["UTG fold", "HJ fold", "CO fold", "BTN raise2.5", "SB fold", "BB call"];
  const lineOf = (h: PracticeHand) => h.lines.preflop.map((m) => `${m.pos} ${m.action}${m.to ?? ""}`);
  const names = Object.keys(index.spots[0]!.flops);
  const six = heldSpots(instantSpots(index), { players: 6, stack: 100 });
  const readIndex = async () => index;
  const deal = (o: Parameters<typeof setup>[0] = {}) => setup({ players: 6, opts: OPTS, tables: 2, pace: 0, pause: 0, guard: 0, readIndex, ...o });
  const allReady = (room: Room) => room.snapshot().tables.every((t) => t.answer);

  // (nothing chosen: what's dealt unless you choose)
  beforeEach(() => {
    useSettings.setState({ practiceSpot: null });
  });

  /** What's asked answered by `by`, until `until`. */
  async function run(asked: Asked[], by: (a: Asked) => AdvisorResponse, until: () => boolean) {
    let done = 0;
    for (let i = 0; i < 400 && !until(); i += 1) {
      await flush();
      const a = asked[done];
      if (!a) continue;
      done += 1;
      a.answer(by(a));
      await flush();
    }
  }
  const flopped = (a: Asked) => (a.state.study ? chartOf(a.state) : a.play ? move("check") : FLOP);

  it("plays the preflop for you, dealing each table until a heads-up flop the library holds; its flop answers count as instant (multitable.test.js:423)", async () => {
    const { room, asked } = deal();
    await run(asked, flopped, () => allReady(room));
    for (const t of room.snapshot().tables) {
      expect(t.answer).not.toBeNull();
      expect(t.hand.pot).toBe("lib");
      expect(["BTN", "BB"]).toContain(t.hand.hero);
      expect(lineOf(t.hand)).toEqual(LINE);
      expect(t.hand.shown).toBe(3);
      expect(names).toContain(flopName(t.hand.board.slice(0, 3)));
    }
    const flops = room.metrics().solves.filter((s) => s.street === "flop");
    expect(flops.length).toBeGreaterThan(0);
    // (solved at the table already: quicker still)
    expect(flops.every((s) => s.est === 0.3 || s.est === 0.2)).toBe(true);
    expect(flops.some((s) => s.est === 0.3)).toBe(true);
  });

  it("calls a turn a quick solve there, as the library holds the flop only", async () => {
    const { room, asked } = deal();
    await run(asked, flopped, () => allReady(room));
    const front = room.snapshot().focus;
    // (a check, and a check back where you're first: the turn)
    press(room, front, 0);
    await run(asked, (a) => (a.state.board?.length === 8 ? (a.play ? move("check") : FLOP) : flopped(a)), () => room.metrics().solves.some((s) => s.street === "turn"));
    expect(room.metrics().solves.filter((s) => s.street === "turn").map((s) => s.est)).toEqual([2]);
  });

  it("is the same at Accurate: a held flop is no long solve, so it goes ahead of one", async () => {
    useSettings.setState({ mode: "accurate" });
    const { room, asked } = deal();
    await run(asked, flopped, () => allReady(room));
    expect(room.metrics().solves.filter((s) => s.street === "flop").every((s) => s.est < 0.5)).toBe(true);
  });

  it("draws each seat's move in the page from its node's chart, asked once a node, not seat by seat (multitable.test.js:503)", async () => {
    const { room, asked } = deal();
    await run(asked, flopped, () => allReady(room));
    const charts = asked.filter((a) => a.state.study);
    expect(asked.filter((a) => a.play && !a.state.board)).toEqual([]);
    expect(charts.map((a) => a.state.preflop!.length)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(charts[3]!.state).toEqual({ players: 6, stack: 100, board: "", preflop: charts[3]!.state.preflop, flop: [], turn: [], river: [], study: true });
    expect(charts.every((a) => a.play === undefined)).toBe(true);
    const m = room.metrics();
    expect(m.charts).toBe(6);
    expect(m.charted).toBeGreaterThanOrEqual(12);
  });

  it("asks a seat where the chart doesn't hold its hand, or the node's chart fails, and doesn't ask that chart again (multitable.test.js:503)", async () => {
    const { room, asked } = deal();
    const drop = (seat: string, c: string) => seat === "BTN" && /^[AKQJT]/.test(c);
    const by = (a: Asked): AdvisorResponse => {
      if (a.state.study) return a.state.preflop!.length === 1 ? { error: "no chart" } : chartOf(a.state, drop);
      if (a.play && !a.state.board) return { ...move(BTN_BB[a.play.seat]!.split(" ")[0] as PlayMove["action"], a.play.seat === "BTN" ? 2.5 : undefined), pos: a.play.seat };
      return flopped(a);
    };
    await run(asked, by, () => allReady(room));
    expect(allReady(room)).toBe(true);
    const seats = (seat: string) => asked.filter((a) => a.play?.seat === seat && !a.state.board);
    expect(seats("HJ").length).toBeGreaterThan(0);
    expect(seats("BTN").length).toBeGreaterThan(0);
    expect(seats("BTN").every((a) => /[AKQJT]/.test(a.play!.hole))).toBe(true);
    expect(asked.filter((a) => a.state.study && a.state.preflop!.length === 1)).toHaveLength(1);
    expect(asked.filter((a) => a.play && !a.state.board && !["HJ", "BTN"].includes(a.play.seat))).toEqual([]);
  });

  it("marks no table for a chart that's rejected, or from anything but the charts: its seats are asked", async () => {
    const { room, asked } = deal();
    await flush();
    expect(asked[0]!.state.study).toBe(true);
    asked[0]!.reject(new Error("worker fell over"));
    await flush();
    expect(room.snapshot().tables.map((t) => t.failed)).toEqual([null, null]);
    expect(asked[1]!.play?.seat).toBe("UTG");

    const rules = deal({ preflop: "rules" });
    await flush();
    rules.asked[0]!.answer(chartOf(rules.asked[0]!.state));
    await flush();
    expect(rules.room.metrics().charted).toBe(0);
    expect(rules.asked[1]!.play?.seat).toBe("UTG");

    // (from the charts, but no node's chart)
    const other = deal();
    await flush();
    other.asked[0]!.answer({ ...chartOf(other.asked[0]!.state), street: "flop" });
    await flush();
    expect(other.room.metrics().charted).toBe(0);
    expect(other.asked[1]!.play?.seat).toBe("UTG");
  });

  it("counts no draw the table refuses, which fails there", async () => {
    const { room, asked } = deal();
    await flush();
    const q = asked[0]!.state;
    const actions = [{ action: "check", freq: 1 }];
    asked[0]!.answer({ ...chartOf(q), actions, grid: { actions: ["check"], cells: Object.fromEntries(CLASSES.map((c) => [c, { w: 1, f: [1] }])) } });
    await flush();
    expect(room.metrics().charted).toBe(0);
    expect(table(room).failed).toBeTruthy();
  });

  it("plays a seat's own answer over a chart that came in behind it", async () => {
    const { room, asked } = setup({ players: 6, opts: { ...OPTS, pot: "srp" }, pace: 0, pause: 0, guard: 0, readIndex, stop: "kills" });
    await flush();
    expect(asked[0]!.play?.seat).toBe("UTG");
    room.setTables(2);
    await flush();
    // (a stop would kill the worker, so the seat's request runs on, and its answer waits for the chart the table now wants)
    asked[0]!.answer(move("raise", 3));
    await flush();
    expect(asked[1]!.state.study).toBe(true);
    asked[1]!.answer(chartOf(asked[1]!.state));
    await flush();
    expect(table(room).hand.lines.preflop[0]).toMatchObject({ pos: "UTG", action: "raise", to: 3 });
  });

  it("holds no more charts than the other caches do", () => {
    const { room } = deal({ start: false });
    const { chart } = room as unknown as { chart(ck: string, answer: null): void };
    for (let i = 0; i < 500; i += 1) chart.call(room, String(i), null);
    expect(room.metrics().charts).toBe(400);
  });

  it("holds nothing for a cancel, so a chart is asked again; one cancelled twice gets its seats asked, and fails no table", async () => {
    const { room, asked } = deal();
    await flush();
    asked[0]!.reject(new SolverError("cancelled", "cancelled"));
    await flush();
    expect(room.metrics().charts).toBe(0);
    expect(asked[1]!.state.study).toBe(true);
    asked[1]!.answer({ cancelled: true });
    await flush();
    expect(room.snapshot().tables.map((t) => t.failed)).toEqual([null, null]);
    expect(asked[2]!.play?.seat).toBe("UTG");
  });

  it("takes a stopped chart that came whole, and nothing from one that errored", async () => {
    // (at one table nobody wants a chart: the flight is stopped, and the answer comes all the same)
    const stopped = async (answer: (a: Asked) => AdvisorResponse) => {
      const { room, asked } = deal({ deaf: true });
      await flush();
      room.setTables(1);
      expect(asked[0]!.signal!.aborted).toBe(true);
      asked[0]!.answer(answer(asked[0]!));
      await flush();
      return room.metrics().charts;
    };
    expect(await stopped(() => ({ error: "stopped late" }))).toBe(0);
    expect(await stopped((a) => chartOf(a.state))).toBe(1);
  });

  it("starts the charts afresh with a new client or a New session", async () => {
    const { room, asked } = deal();
    await run(asked, flopped, () => allReady(room));
    expect(room.metrics().charts).toBe(6);
    room.startSession(6, 100, OPTS);
    expect(room.metrics().charts).toBe(0);
    await flush();
    const n = asked.filter((a) => a.state.study).length;
    expect(n).toBe(7);

    const next = fakeClient();
    const again = deal();
    await run(again.asked, flopped, () => allReady(again.room));
    expect(again.room.metrics().charts).toBe(6);
    again.getSolver.mockResolvedValue(next.client);
    again.room.startSession(6, 100, OPTS);
    again.asked.at(-1)!.answer(chartOf(again.asked.at(-1)!.state));
    await pass(200);
    expect(next.asked[0]!.state.study).toBe(true);
    expect(again.room.metrics().charts).toBe(0);
  });

  it("asks the charts again of a new client, in the middle of a session", async () => {
    const { room, asked, getSolver } = deal();
    await run(asked, flopped, () => allReady(room));
    expect(room.metrics().charts).toBe(6);
    const next = fakeClient();
    getSolver.mockResolvedValue(next.client);
    room.choose(0);
    await flush();
    expect(next.asked).not.toHaveLength(0);
    expect(room.metrics().charts).toBe(0);
  });

  it("draws for a drill above one table too, and for neither at one table or in another game", async () => {
    const drill = deal({ spot: "srp" });
    await flush();
    expect(drill.asked[0]!.state.study).toBe(true);

    const one = setup({ players: 6, opts: { ...OPTS, pot: "srp" }, pace: 0, pause: 0, guard: 0, readIndex });
    await flush();
    expect(one.asked[0]!.state.study).toBeUndefined();
    expect(one.asked[0]!.play?.seat).toBe("UTG");
    expect(one.room.metrics().charts).toBe(0);

    const ante = deal({ spot: "srp", opts: { ...OPTS, ante: 0.1 } });
    await flush();
    expect(ante.asked[0]!.state.study).toBeUndefined();
    expect(ante.asked[0]!.play?.seat).toBe("UTG");
  });

  it("draws nothing at one table, charts in hand or not: a hand still being dealt asks each seat there", async () => {
    // (a session on a drill, as a redeal at one table goes by the session's setup)
    const { room, asked } = deal({ opts: { ...OPTS, pot: "srp" } });
    await flush();
    await run(asked, flopped, () => room.metrics().charts >= 2);
    const n = asked.length;
    room.setTables(1);
    // (the chart in flight, wanted by nobody now, is stopped)
    await pass(200);
    expect(asked.slice(n).filter((a) => a.state.study)).toEqual([]);
    const h = table(room).hand;
    expect(h.pot).toBe("lib");
    expect(asked.at(-1)!.play?.seat).toBe(SEATS6[h.lines.preflop.length]);
    const charted = room.metrics().charted;
    // (off every line and dealt again, it's at a node whose chart is held: asked all the same)
    asked.at(-1)!.answer(move("raise", 9));
    await flush();
    expect(table(room).hand).toMatchObject({ pot: "srp", lines: { preflop: [] } });
    expect(asked.at(-1)!.play?.seat).toBe("UTG");
    expect(room.metrics().charted).toBe(charted);
  });

  it("deals nothing on the first Tables 2 until the index is in, then deals from it", async () => {
    let read: (x: unknown) => void = () => {};
    const readIt = vi.fn(() => new Promise<unknown>((r) => (read = r)));
    const { room, asked } = setup({ players: 6, opts: OPTS, pace: 0, pause: 0, guard: 0, readIndex: readIt });
    await flush();
    expect(readIt).not.toHaveBeenCalled();
    room.setTables(2);
    await flush();
    expect(readIt).toHaveBeenCalledTimes(1);
    const waiting = at(room, 1).hand;
    expect(waiting.pot).toBe("lib");
    expect(waiting.cands).toBeUndefined();
    expect(waiting.tries).toBeUndefined();
    expect(room.snapshot().flops.off).toBeNull();
    expect(asked.filter((a) => a.state.study)).toEqual([]);
    expect(asked.every((a) => tableOf(room, a) === 0)).toBe(true);

    read(index);
    await flush();
    const h = at(room, 1).hand;
    expect(h.pot).toBe("lib");
    expect(h.cands).toEqual(candsFor(six, h.hero, h.board));
    expect(readIt).toHaveBeenCalledTimes(1);
  });

  it("plays Any hand with its reason where the index's read hangs, and deals Instant flops again once it answers late", async () => {
    let read: (x: unknown) => void = () => {};
    const { room, asked } = setup({ players: 6, opts: OPTS, pace: 0, pause: 0, guard: 0, readIndex: () => new Promise<unknown>((r) => (read = r)) });
    await flush();
    room.setTables(2);
    await pass(29_999);
    expect(asked.every((a) => tableOf(room, a) === 0)).toBe(true);
    expect(room.snapshot().flops.off).toBeNull();

    await pass(1);
    expect(room.snapshot().flops.off).toBe("failed");
    expect(flopsNote(room.snapshot().flops, "any")).toBe("The flop library didn't load, so this is Any hand.");
    expect(at(room, 1).hand.pot).toBeUndefined();
    const before = asked.length;
    asked.at(-1)!.answer(move("fold"));
    await flush();
    expect(asked.length).toBeGreaterThan(before);

    read(index);
    await flush();
    expect(room.snapshot().flops.off).toBeNull();
    room.startSession(6, 100, OPTS);
    await flush();
    expect(at(room, 1).hand.pot).toBe("lib");
  });

  it("stays on Any hand where the read that hung fails in the end, and lets go of a read from before a new solver", async () => {
    const reads: { answer: (x: unknown) => void; fail: (e: Error) => void }[] = [];
    const readIndex = () => new Promise<unknown>((answer, fail) => reads.push({ answer, fail }));
    const { room } = setup({ players: 6, opts: OPTS, pace: 0, pause: 0, guard: 0, readIndex });
    await flush();
    room.setTables(2);
    await pass(30_000);
    expect(room.snapshot().flops.off).toBe("failed");
    reads[0]!.fail(new Error("404"));
    await flush();
    expect(room.snapshot().flops.off).toBe("failed");

    room.setSolver(async () => fakeClient().client);
    await flush();
    expect(reads).toHaveLength(2);
    reads[0]!.answer(index);
    await flush();
    expect(room.snapshot().flops.holds).toEqual([]);
    expect(room.snapshot().flops.off).toBeNull();
    reads[1]!.answer(null);
    await flush();
    expect(room.snapshot().flops.off).toBe("failed");
  });

  it("plays Any hand with its reason where the index fails, or holds nothing", async () => {
    for (const readIt of [async () => Promise.reject(new Error("404")), async () => null, async () => ({ spots: [] })]) {
      const { room, asked } = setup({ players: 6, opts: OPTS, pace: 0, pause: 0, guard: 0, readIndex: readIt });
      await flush();
      room.setTables(2);
      await flush();
      expect(at(room, 1).hand.pot).toBeUndefined();
      expect(at(room, 1).hand.cands).toBeUndefined();
      expect(at(room, 1).hand.tries).toBeUndefined();
      expect(room.snapshot().flops.off).toBe("failed");
      expect(flopsNote(room.snapshot().flops, "any")).toBe("The flop library didn't load, so this is Any hand.");
      // (the table plays on: a next deal doesn't ask for it, and nothing waits)
      asked.at(-1)!.answer(move("fold"));
      await flush();
      expect(asked.length).toBeGreaterThan(1);
    }
  });

  it("takes an index it can't read as one that failed, and doesn't leave the tables waiting on it", async () => {
    const readIt = async () => ({
      get spots() {
        throw new Error("no spots");
      },
    });
    const { room, asked } = setup({ players: 6, opts: OPTS, pace: 0, pause: 0, guard: 0, readIndex: readIt });
    await flush();
    room.setTables(2);
    await flush();
    expect(room.snapshot().flops.off).toBe("failed");
    expect(at(room, 1).hand.pot).toBeUndefined();
    asked.at(-1)!.answer(move("fold"));
    await flush();
    expect(asked.length).toBeGreaterThan(1);
  });

  it("reads the index above one table or at Accurate, once, and again with a new solver, whose read wins", async () => {
    const quick = vi.fn(readIndex);
    const one = setup({ players: 6, opts: OPTS, readIndex: quick });
    await flush();
    expect(quick).not.toHaveBeenCalled();
    useSettings.setState({ mode: "accurate" });
    one.room.pump();
    await flush();
    expect(quick).toHaveBeenCalledTimes(1);
    one.room.pump();
    await flush();
    expect(quick).toHaveBeenCalledTimes(1);

    const reads: ((x: unknown) => void)[] = [];
    const held = setup({ players: 6, opts: OPTS, tables: 2, pace: 0, pause: 0, guard: 0, readIndex: () => new Promise((r) => reads.push(r)) });
    await flush();
    expect(reads).toHaveLength(1);
    held.room.setSolver(async () => held.client);
    await flush();
    expect(reads).toHaveLength(2);
    reads[0]!(null);
    await flush();
    expect(held.room.snapshot().flops.off).toBeNull();
    reads[1]!(index);
    await flush();
    expect(at(held.room, 1).hand.cands).toBeDefined();
  });

  it("reads nothing and deals nothing before there's a solver", async () => {
    const read = vi.fn(readIndex);
    const room = new Room({ pace: 0, pause: 0, guard: 0, now: () => Date.now(), persist: false, seedOf: (n) => n + 1, readIndex: read, tables: 2 });
    rooms.push(room);
    room.startSession(6, 100, OPTS);
    room.start();
    await flush();
    expect(read).not.toHaveBeenCalled();
    expect(at(room, 1).hand.cands).toBeUndefined();
    const { client } = fakeClient();
    room.setSolver(async () => client);
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(at(room, 1).hand.cands).toBeDefined();
  });

  it("reads again for a hand still waiting on the index at one quick table", async () => {
    const reads: ((x: unknown) => void)[] = [];
    const { room, client } = deal({ readIndex: () => new Promise((r) => reads.push(r)) });
    await flush();
    room.setTables(1);
    room.setSolver(async () => client);
    await flush();
    expect(reads).toHaveLength(2);
    expect(table(room).hand.cands).toBeUndefined();
    reads[1]!(index);
    await flush();
    expect(table(room).hand.cands).toBeDefined();
  });

  it("ignores a read from before a new solver though no read has followed it", async () => {
    useSettings.setState({ practiceSpot: "any" });
    const reads: ((x: unknown) => void)[] = [];
    const { room, client } = deal({ readIndex: () => new Promise((r) => reads.push(r)) });
    await flush();
    room.setTables(1);
    room.setSolver(async () => client);
    await flush();
    expect(reads).toHaveLength(1);
    reads[0]!(null);
    await flush();
    expect(room.snapshot().flops.off).toBeNull();
  });

  it("reads the index of the library the solver has resolved, once it has", async () => {
    const read = vi.fn(async () => new Response(JSON.stringify(index)));
    vi.stubGlobal("fetch", read);
    const { room, client, getSolver } = deal({ start: false, readIndex: undefined });
    getSolver.mockImplementation(async () => {
      useRuntime.setState({ librarySource: "gto-solver-library" });
      return client;
    });
    room.start();
    await flush();
    vi.unstubAllGlobals();
    useRuntime.setState({ librarySource: null });
    expect(read).toHaveBeenCalledWith("/gto-solver-library/index.json", { cache: "no-cache" });
  });

  it("keeps cands on a redeal, and the next hand has its own", async () => {
    const { room, asked } = deal();
    await run(asked, flopped, () => room.snapshot().tables.some((t) => (t.hand.tries ?? 0) > 0));
    const t = room.snapshot().tables.find((x) => (x.hand.tries ?? 0) > 0)!;
    expect(t.hand.cands).toEqual(candsFor(six, t.hand.hero, t.hand.board));
    expect(t.hand.cands!.length).toBeGreaterThan(0);
  });

  it("fails at its table with Retry after 400 deals with no flop for this seat, asking nothing, and Retry deals by what's chosen now", async () => {
    useSettings.setState({ practiceSeat: "UTG" });
    const { room, asked } = deal();
    await flush();
    for (const i of [0, 1]) {
      expect(at(room, i)).toMatchObject({ spent: true, error: "No instant flop in 400 deals at this seat: try another seat or spot." });
      expect(at(room, i).hand.tries).toBe(DRILL_TRIES - 1);
    }
    expect(asked).toEqual([]);

    useSettings.setState({ practiceSeat: "BTN" });
    room.retry(1);
    expect(at(room, 1)).toMatchObject({ spent: false, error: null });
    expect(at(room, 1).hand.hero).toBe("BTN");
    await flush();
    expect(at(room, 0).spent).toBe(true);
    expect(asked.length).toBeGreaterThan(0);
  });

  it("deals the game the index has a spot of, and draws from no chart there", async () => {
    const { room, asked } = setup({ players: 2, opts: OPTS, tables: 2, pace: 0, pause: 0, guard: 0, readIndex });
    await flush();
    expect(room.snapshot().flops.off).toBeNull();
    expect(at(room, 1).hand.pot).toBe("lib");
    expect(asked.filter((a) => a.state.study)).toEqual([]);
  });

  it("says why it can't be dealt, in words, and plays Any hand or the drill chosen", async () => {
    const reason = async (players: number, stack: number, o: Partial<HandOptions>) => {
      const { room } = setup({ pace: 0, pause: 0, guard: 0, tables: 2, readIndex });
      await flush();
      room.startSession(players, stack, { ...OPTS, ...o });
      await flush();
      expect(room.snapshot().flops.off).toBe("game");
      expect(at(room, 0).hand.pot).toBeUndefined();
      return flopsNote(room.snapshot().flops, "any");
    };
    const held = "Instant flops needs a game the flop library holds (6-max 100bb, Heads-up 100bb).";
    expect(await reason(9, 40, {})).toBe(`${held} This is 9-max 40bb, so you're playing Any hand.`);
    expect(await reason(6, 100, { ante: 0.5 })).toBe(`${held} This is 6-max 100bb ante 0.5, so you're playing Any hand.`);
    expect(await reason(6, 100, { rake: 5 })).toBe(`${held} This is 6-max 100bb with a rake, so you're playing Any hand.`);
    expect(await reason(6, 100, { sizes: { flop: [50] } })).toBe(`${held} This is 6-max 100bb with your own sizes, so you're playing Any hand.`);
    expect(await reason(6, 100, { rake: 5, sizes: { flop: [50] } })).toBe(`${held} This is 6-max 100bb with a rake and your own sizes, so you're playing Any hand.`);

    const f = (o: Partial<RoomFlops>): RoomFlops => ({ off: null, holds: ["6-max 100bb"], game: "9-max 40bb", ...o });
    expect(flopsNote(f({ off: "game" }), "any")).toBe("Instant flops needs a game the flop library holds (6-max 100bb). This is 9-max 40bb, so you're playing Any hand.");
    expect(flopsNote(f({ off: "game" }), "srp")).toBe("Instant flops needs a game the flop library holds (6-max 100bb). This is 9-max 40bb.");
    expect(flopsNote(f({ off: "failed" }), "any")).toBe("The flop library didn't load, so this is Any hand.");
    expect(flopsNote(f({ off: "failed" }), "3bet")).toBe("The flop library didn't load, so Instant flops is off.");
    expect(flopsNote(f({ off: "preflop" }), "any")).toBe("Instant flops: not with preflop only or pot drills.");
    expect(flopsNote(f({}), "lib")).toBeNull();
  });

  it("stays out of a preflop-only session, whatever's saved", async () => {
    useSettings.setState({ practiceSpot: "lib" });
    const { room } = deal({ opts: { ...OPTS, preflopOnly: true } });
    await flush();
    expect(room.snapshot().flops.off).toBe("preflop");
    expect(at(room, 1).hand).toMatchObject({ preflopOnly: true });
    expect(at(room, 1).hand.pot).toBeUndefined();
  });

  it("deals what you've chosen where it's chosen, the index being read regardless", async () => {
    useSettings.setState({ practiceSpot: "any" });
    const { room } = deal();
    await flush();
    expect(at(room, 1).hand.pot).toBeUndefined();
    expect(room.snapshot().flops).toMatchObject({ off: null, holds: ["6-max 100bb", "Heads-up 100bb"], game: "6-max 100bb" });
  });

  it("deals from what's on offer now, after the index has failed: a hand dealt next doesn't wait", async () => {
    const { room } = deal({ readIndex: async () => null });
    await flush();
    room.startSession(6, 100, OPTS);
    await flush();
    expect(room.snapshot().tables.map((t) => t.hand.pot)).toEqual([undefined, undefined]);
    expect(room.snapshot().tables.map((t) => t.hand.cands)).toEqual([undefined, undefined]);
  });

  it("is dealt the same with asking ahead on: no seed moves, no draw goes, and nothing's asked ahead of a table being dealt", async () => {
    const played = async (askAhead: boolean) => {
      const seedOf = vi.fn((n: number) => n + 1);
      const { room, asked } = deal({ askAhead, seedOf });
      await run(asked, flopped, () => allReady(room));
      await flush();
      const { charted, charts } = room.metrics();
      return { room, asked, seeds: seedOf.mock.calls.length, charted, charts, hands: room.snapshot().tables.map((t) => t.hand) };
    };
    const off = await played(false);
    const on = await played(true);
    expect(on.hands).toEqual(off.hands);
    expect(on.seeds).toBe(off.seeds);
    expect(on.charted).toBe(off.charted);
    expect(on.charts).toBe(off.charts);
    expect(on.asked.filter((a) => a.state.study)).toHaveLength(off.asked.filter((a) => a.state.study).length);
    expect(on.asked.filter((a) => a.play && !a.state.board)).toEqual([]);
    // (it ran: what's dealt is a held flop, and your likeliest lines are asked from it)
    expect(on.room.snapshot().ahead.meter.asked).toBeGreaterThan(0);
    expect(on.asked.at(-1)!.state.board).toHaveLength(6);
  });

  it("asks the same request a hand played for you will: the table finds the answer", async () => {
    const { room, asked } = deal({ askAhead: true });
    await run(asked, flopped, () => allReady(room) && room.snapshot().ahead.meter.asked > 0);
    const look = asked.at(-1)!;
    const front = room.snapshot().focus;
    expect(tableOf(room, look)).toBe(front);
    const n = asked.length;
    press(room, front, 1);
    await flush();
    expect(look.signal!.aborted).toBe(false);
    expect(asked).toHaveLength(n);
  });

  it("goes back to the setup at one table, with Table 1's hand played out as it stands", async () => {
    const { room, asked } = deal();
    await run(asked, flopped, () => allReady(room));
    room.setTables(1);
    expect(table(room).hand.pot).toBe("lib");
    room.choose(0);
    await flush();
    expect(table(room).hand.decisions).toHaveLength(1);
    expect(room.metrics().charts).toBe(6);
  });
});

describe("A Room with an end, watched (the engine check's)", () => {
  const FOLD: AdvisorResponse = { street: "preflop", pot_bb: 1.5, actions: [{ action: "fold", freq: 1 }] };
  const run = (o: RoomOptions) => setup({ pace: 0, pause: 0, guard: 0, ...o });
  const answered = new WeakSet<Asked>();

  /** All that's asked answered, every opponent folding and you too, until nothing's left to do. */
  async function playOut(room: Room, asked: Asked[], rounds = 60) {
    for (let i = 0; i < rounds; i += 1) {
      await pass(1);
      for (const a of asked) {
        if (answered.has(a)) continue;
        answered.add(a);
        a.answer(a.play ? move("fold") : FOLD);
        await flush();
      }
      const s = room.snapshot();
      const t = s.tables[s.focus];
      if (t?.answer && t.turnKey && s.queue.includes(s.focus)) room.choose(s.focus, t.turnKey, 0);
    }
  }

  it("deals no more than `maxHands` at several tables, however many are free", async () => {
    const { room, asked } = run({ tables: 2, maxHands: 3 });
    await playOut(room, asked);
    const s = room.snapshot();
    expect(s.session).toMatchObject({ dealt: 3, hands: 3 });
    expect(s.tables.every((t) => t.hand.result)).toBe(true);
    const out = asked.length;
    room.dealFinished();
    room.nextHand(false, 0);
    await pass(5000);
    expect(room.snapshot().session.dealt).toBe(3);
    expect(asked).toHaveLength(out);
  });

  it("deals on with no `maxHands`", async () => {
    const { room, asked } = run({ tables: 2 });
    await playOut(room, asked);
    expect(room.snapshot().session.dealt).toBeGreaterThan(3);
  });

  it("holds Next hand at one table once `maxHands` have been dealt, the last hand left as it ended", async () => {
    const { room, asked } = run({ maxHands: 2 });
    await playOut(room, asked);
    expect(room.snapshot().session).toMatchObject({ dealt: 1, hands: 1 });
    room.nextHand();
    await playOut(room, asked);
    expect(room.snapshot().session).toMatchObject({ dealt: 2, hands: 2 });
    const last = table(room).hand;
    room.nextHand();
    room.nextHand(true);
    await pass(5000);
    expect(room.snapshot().session).toMatchObject({ dealt: 2, hands: 2 });
    expect(table(room).hand).toBe(last);
  });

  it("tells the watcher of each hand as it ends, once, with its table and the session as it then stood", async () => {
    const ended = vi.fn();
    const { room, asked } = run({ tables: 2, maxHands: 5, watch: { ended, refused: vi.fn() } });
    await playOut(room, asked);
    expect(ended).toHaveBeenCalledTimes(5);
    const seen = ended.mock.calls as [PracticeHand, { hands: number }, number][];
    expect(seen.map(([h]) => h.n).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(seen.every(([h]) => h.result)).toBe(true);
    expect(seen.map(([, s]) => s.hands)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(seen.map(([, , t]) => t))).toEqual(new Set([0, 1]));
    // (the table's number is the hand's: this table's next deal is on it by now)
    for (const [h, , t] of seen) expect(room.snapshot().tables[t]!.hand.n).toBeGreaterThanOrEqual(h.n);
  });

  it("tells the watcher of an opponent's answer the table can't take, and of no other failure", async () => {
    const refused = vi.fn();
    const ended = vi.fn();
    const { room, asked } = run({ watch: { ended, refused } });
    await flush();
    asked[0]!.answer(move("check"));
    await pass(1000);
    expect(table(room).failed).toMatch(/can't check/);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused).toHaveBeenCalledWith(table(room).hand, table(room).failed, 0);
    room.retry();
    await flush();
    asked[1]!.answer({ error: "no such node" });
    await pass(1000);
    expect(table(room).failed).toBe("no such node");
    expect(refused).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
  });

  it("gives as many of its last figures as it's asked for, 200 unless it's told", async () => {
    const { room, asked } = run({ tables: 2 });
    await playOut(room, asked, 400);
    const all = room.metrics(Infinity);
    expect(all.solves.length).toBeGreaterThan(200);
    expect(all.waits.length).toBeGreaterThan(0);
    expect(room.metrics(1).solves).toEqual(all.solves.slice(-1));
    expect(room.metrics(1).waits).toEqual(all.waits.slice(-1));
    expect(room.metrics().solves).toEqual(all.solves.slice(-200));
  });
});
