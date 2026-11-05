// The engine check on a stub solver: a real Room plays the hands, so a clean run is real play, on a table that takes real
// moves, against opponents who fold, call and raise by a seed. Each failure it lists comes from a client that produces it,
// but for the chips and the records, which no client can reach: those are the Room's and the table's own, so there the
// fault is put in by hand behind the same run. Nothing here says a grade is right, as the check can't either.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allSessions, kvGet, kvSet, type HandRecord } from "@/data/db";
import { listHands } from "@/data/hands";
import { readHabits, saveHabits } from "@/features/practice/ahead";
import { KEPT_KEY } from "@/features/practice/keep";
import { practiceRecord } from "@/features/practice/history";
import { chipsAfter, facingBet, newHand, simOf, type Decision, type HandResult } from "@/features/practice/practice";
import { Room, type RoomClient } from "@/features/practice/room";
import { seatsOf } from "@/poker/seats";
import { noLines, seeded, simulate, STREETS, type Lines } from "@/poker/table";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import { SolverClient } from "@/solver/client";
import { describe as describeProv } from "@/solver/provenance";
import { SolverError, type PlayRequest, type Provenance, type SolverTransport, type SolveMode, type SolveRequest, type SolveResult, type StopCost } from "@/solver/types";
import { STUCK_MS } from "@/solver/worker-transport";
import { useSettings } from "@/state/settings";
import { aheadLine, CHECK_KEY, chipsFault, heroPick, labelFault, lastReport, progressLine, quantile, reportLine, runHandsCheck, setupLine, timeText, warmLine, whenLine, type CheckRule, type HandsCheckOptions, type HandsCheckReport } from "./handsCheck";

// the faults no client can produce, and a database that doesn't answer: the real thing unless a test says otherwise
vi.mock("@/features/practice/practice", { spy: true });
vi.mock("@/features/practice/history", { spy: true });
vi.mock("@/data/db", { spy: true });

vi.setConfig({ testTimeout: 60_000 });

const prov = (source: Provenance["source"], over: Partial<Provenance> = {}): Provenance => ({
  source,
  approximate: source === "charts" || source === "rules" || source === "equity",
  mode: "quick",
  transport: "worker",
  solverVersion: "test",
  partial: false,
  receivedAt: 0,
  ...over,
});

const SETUP = { players: 6, stacks: Object.fromEntries(seatsOf(6).map((p) => [p, 100])) };
const simOfState = (q: AdvisorState) => simulate(SETUP, { ...noLines(), ...q } as unknown as Lines, (q.board?.length ?? 0) / 2);
const raiseTo = (sim: ReturnType<typeof simOfState>) => Math.max(3, (sim.cur?.curBet ?? 0) * 3);

/** What a solver may say at the spot: what can be done there, with EVs from the flop on. */
function advice(q: AdvisorState): AdvisorResponse {
  const sim = simOfState(q);
  const street = sim.current ?? "preflop";
  const ev = (x: number) => (street === "preflop" ? {} : { ev_bb: x });
  const facing = facingBet(sim, q.hero!);
  return {
    street,
    pot_bb: sim.pot,
    actions: [
      ...(facing ? [{ action: "fold", freq: 0.3, ...ev(0) }] : [{ action: "check", freq: 0.4, ...ev(1) }]),
      ...(facing ? [{ action: "call", freq: 0.4, ...ev(1) }] : []),
      { action: facing ? "raise" : "bet", freq: 0.3, amount_bb: raiseTo(sim), ...ev(1.2) },
    ],
  };
}

const move = (action: string, to?: number) => ({ pos: "", action, name: action, freq: 1, ...(to === undefined ? {} : { to }) }) as PlayMove;

interface Stub {
  /** your spot's answer (default: `advice`, as the charts preflop and a live solve after) */
  solve?: (q: AdvisorState) => SolveResult | Promise<SolveResult>;
  /** an opponent's move (default: `villain`) */
  play?: (q: AdvisorState, p: PlayRequest) => SolveResult<PlayMove> | Promise<SolveResult<PlayMove>>;
  /** ms a request takes */
  takes?: (q: AdvisorState, play: boolean) => number;
  stop?: StopCost;
  /** what a request stopped rejects with */
  stopped?: SolverError;
  /** ms a stop takes to settle */
  stopTakes?: number;
}

const good = (q: AdvisorState): SolveResult => ({ data: advice(q), provenance: q.board ? prov("live") : prov("charts") });

/** A solver answering every request, as it's told or as a sound one would. */
function stub({ solve = good, play, takes, stop, stopped = new SolverError("cancelled", "cancelled"), stopTakes = 0 }: Stub = {}) {
  const rand = seeded(99);
  const villain = (q: AdvisorState, p: PlayRequest): SolveResult<PlayMove> => {
    const sim = simOfState({ ...q, hero: p.seat });
    const x = rand();
    const m = facingBet(sim, p.seat) && x < 0.3 ? move("fold") : x < 0.5 ? move(sim.cur?.curBet ? "raise" : "bet", raiseTo(sim)) : move(facingBet(sim, p.seat) ? "call" : "check");
    return { data: m, provenance: prov("live") };
  };
  const asked: { state: AdvisorState; play?: PlayRequest; mode?: SolveMode }[] = [];
  const answer = <T,>(q: AdvisorState, isPlay: boolean, signal: AbortSignal | undefined, go: () => T | Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const ms = takes?.(q, isPlay) ?? 0;
      const reply = () => void Promise.resolve().then(go).then(resolve, reject);
      const timer = ms ? setTimeout(reply, ms) : undefined;
      if (!ms) reply();
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        if (stopTakes) setTimeout(() => reject(stopped), stopTakes);
        else reject(stopped);
      });
    });
  const client: RoomClient = {
    solve: (req: SolveRequest) => {
      asked.push({ state: req.state, mode: req.mode });
      return answer(req.state, false, req.signal, () => solve(req.state));
    },
    play: (state, p, opts) => {
      asked.push({ state, play: p, mode: opts?.mode });
      return answer(state, true, opts?.signal, () => (play ?? villain)(state, p));
    },
    transport: { kind: "worker" },
    ...(stop ? { stopCost: () => stop } : {}),
  };
  return { client, asked };
}

const OPTS: HandsCheckOptions = { seed: 7, hands: 8, tables: 4, askAhead: false, thinkMs: 0, pace: 0 };
const check = (s: Stub = {}, o: Partial<HandsCheckOptions> = {}) => {
  const st = stub(s);
  return runHandsCheck(async () => st.client, { ...OPTS, ...o });
};
const rules = (r: HandsCheckReport) => [...new Set(r.failures.map((f) => f.rule))];

/** It failed by this rule alone. */
function failsOn(r: HandsCheckReport, rule: CheckRule, text?: RegExp) {
  expect(r.passed).toBe(false);
  expect(r.stopped).toBe(false);
  expect(rules(r)).toEqual([rule]);
  if (text) expect(r.failures[0]!.text).toMatch(text);
  if (rule !== "label") expect(r.unlabelled).toBe(0);
}

const relabelled = (p: (q: AdvisorState) => Provenance | null) => (q: AdvisorState): SolveResult => ({ data: advice(q), provenance: p(q) as Provenance });
const show = (state: DocumentVisibilityState) => Object.defineProperty(document, "visibilityState", { value: state, configurable: true });

const realChips = (await vi.importActual<typeof import("@/features/practice/practice")>("@/features/practice/practice")).chipsAfter;
const realRecord = (await vi.importActual<typeof import("@/features/practice/history")>("@/features/practice/history")).practiceRecord;

/** Each hand's chips as this says. */
const chipsAs = (f: (c: Record<string, number>) => Record<string, number>) => vi.mocked(chipsAfter).mockImplementation((...a) => f(realChips(...a)));

/** Each hand's record as this says. */
const recordsAs = (f: (r: HandRecord, n: number) => HandRecord) => vi.mocked(practiceRecord).mockImplementation((...a) => f(realRecord(...a), a[0].n));

afterEach(async () => {
  useSettings.setState({ mode: "fast", keepHands: false, practiceSpot: null, practiceSeat: "random", askAhead: null });
  Reflect.deleteProperty(document, "visibilityState");
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(chipsAfter).mockReset();
  vi.mocked(practiceRecord).mockReset();
  vi.restoreAllMocks();
  localStorage.clear();
  await kvSet(CHECK_KEY, undefined);
  await kvSet(KEPT_KEY, undefined);
});

describe("a clean run", () => {
  it("plays every hand out and passes, at four tables", async () => {
    const { client, asked } = stub();
    const seen: string[] = [];
    const r = await runHandsCheck(async () => client, { ...OPTS, hands: 20, onProgress: (p) => seen.push(progressLine(p)) });
    expect(r.failures).toEqual([]);
    expect(r).toMatchObject({ v: 1, passed: true, stopped: false, seed: 7, of: 20, hands: 20, tables: 4, thinkMs: 0, askAhead: false, mode: "quick", transport: "worker", isolated: false, stopCost: "kills", requestErrors: 0, unlabelled: 0, restarts: 0, ahead: null });
    expect(r.verdicts).toBeGreaterThan(20);
    expect(r.bySource["Preflop charts"]).toBeGreaterThan(0);
    expect(r.bySource["Live solve"]).toBeGreaterThan(0);
    expect(Object.values(r.bySource).reduce((a, b) => a + b, 0)).toBe(r.verdicts);
    expect(r.requests).toMatchObject({ reached: asked.length, answered: asked.length, stopped: 0 });
    expect(asked.every((a) => a.mode === "quick")).toBe(true);
    expect(seen[0]).toBe("Hand 1 of 20 · 0 verdicts · 0 errors");
    expect(seen.at(-1)).toMatch(/^Hand 20 of 20 · \d+ verdicts · 0 errors$/);
  });

  it("says each change of progress once", async () => {
    const seen: string[] = [];
    await check({ takes: () => 1 }, { onProgress: (p) => seen.push(progressLine(p)) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.filter((x, i) => x === seen[i - 1])).toEqual([]);
  });

  it("passes on an isolated page, where nothing ended a worker", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    const r = await check();
    expect(r).toMatchObject({ passed: true, isolated: true, restarts: 0 });
  });

  it("plays every hand out at one table, which deals nothing by itself", async () => {
    const r = await check({}, { tables: 1 });
    expect(r.failures).toEqual([]);
    expect(r).toMatchObject({ passed: true, hands: 8, tables: 1 });
  });

  it("deals the hands asked for and stops there", async () => {
    const { client, asked } = stub();
    await runHandsCheck(async () => client, { ...OPTS, hands: 6 });
    // (each table's first hand is dealt at once, then two more)
    const holes = new Set(asked.filter((a) => !a.play && !a.state.preflop?.length).map((a) => a.state.hole));
    expect(holes.size).toBeLessThanOrEqual(6);
    const again = await check({}, { hands: 6 });
    expect(again.hands).toBe(6);
  });

  it("gives the same deals on the same seed, however the run went, and others on another", async () => {
    const a = await check();
    const b = await check({ takes: (q) => (q.board ? 2 : 0) }, { thinkMs: 1 });
    const c = await check({}, { seed: 8 });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("passes the charts and the betting rules where they say what they are", async () => {
    const r = await check({ solve: (q) => ({ data: advice(q), provenance: q.board ? prov("rules") : prov("charts") }) });
    expect(r.passed).toBe(true);
    expect(r.bySource["Heuristic rules (not a solve)"]).toBeGreaterThan(0);
  });

  it("passes an honest fallback before the flop too", async () => {
    const r = await check({ solve: (q) => ({ data: advice(q), provenance: q.board ? prov("live") : prov("equity") }) });
    expect(r.passed).toBe(true);
    expect(r.bySource["Equity estimate (not a solve)"]).toBeGreaterThan(0);
  });

  it("deals the n-th hand on the seed plus n", async () => {
    await check();
    const seeds = vi.mocked(practiceRecord).mock.calls.map(([h]) => [h.n, h.seed]).sort((a, b) => a[0]! - b[0]!);
    expect(seeds).toEqual(Array.from({ length: 8 }, (_, n) => [n, 7 + n]));
  });

  it("plays out every hand dealt where there are more tables than hands asked for", async () => {
    const r = await check({}, { hands: 2 });
    expect(r).toMatchObject({ passed: true, hands: 4, of: 2 });
  });

  it("tells the client each flop, as any table does", async () => {
    const prefetch = vi.fn();
    // (one object: a new one each time is a new client, which starts from nothing)
    const client = { ...stub().client, prefetch };
    await runHandsCheck(async () => client, OPTS);
    expect(prefetch).toHaveBeenCalled();
    expect(prefetch.mock.calls.every(([q]) => q.board.length === 6)).toBe(true);
  });

  it("doesn't take a run for stalled for being slow: a boot, each answer and each decision have the patience to themselves", async () => {
    vi.useFakeTimers();
    const { client } = stub({ takes: () => 30 });
    let booted = false;
    const getSolver = async () => {
      if (!booted) await new Promise((f) => setTimeout(f, 30));
      booted = true;
      return client;
    };
    const run = runHandsCheck(getSolver, { ...OPTS, hands: 2, tables: 1, stallMs: 40, thinkMs: 30, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await run;
    expect(r.failures).toEqual([]);
    expect(r.hands).toBe(2);
  });

  it("times what the Room times on the clock it's given", async () => {
    const r = await check({ takes: () => 2 }, { hands: 2, tables: 1, now: () => performance.now() * 1000 });
    expect(r.requests.medianS).toBeGreaterThan(1);
  });

  it("gets from one hand to the next where every opponent folds", async () => {
    const r = await check({ play: () => ({ data: move("fold"), provenance: prov("live") }) });
    expect(r.failures).toEqual([]);
    expect(r.hands).toBe(8);
  });

  it.each([1, 4])("finds nothing wrong with the hands a sound table can play at %i tables: your folds with seats still to act, all-ins called and not", async (tables) => {
    const rand = seeded(tables);
    // (a solver's sizes aren't round)
    const size = (sim: ReturnType<typeof simOfState>) => Math.round((raiseTo(sim) + rand() * 7) * 1000) / 1000;
    const you = (q: AdvisorState): SolveResult => {
      const a = advice(q);
      const x = rand();
      const only = (action: string, ev: number) => ({ ...a, actions: [{ action, freq: 1, ...(q.board ? { ev_bb: ev } : {}) }] });
      const sized = { ...a, actions: a.actions!.map((o) => (o.amount_bb ? { ...o, amount_bb: size(simOfState(q)) } : o)) };
      return { ...good(q), data: x < 0.25 && facingBet(simOfState(q), q.hero!) ? only("fold", 0) : x < 0.5 ? only("all-in", 1) : sized };
    };
    const opp = (q: AdvisorState, p: PlayRequest) => {
      const sim = simOfState({ ...q, hero: p.seat });
      const facing = facingBet(sim, p.seat);
      const x = rand();
      const m = x < 0.1 ? move("all-in") : x < 0.2 ? move(sim.cur?.curBet ? "raise" : "bet", size(sim)) : x < 0.75 ? move(facing ? "fold" : "check") : move(facing ? "call" : "check");
      return { data: m, provenance: prov("live") };
    };
    const r = await check({ solve: you, play: opp }, { hands: 150, tables });
    expect(r.failures).toEqual([]);
    expect(r).toMatchObject({ passed: true, hands: 150, requestErrors: 0 });
    const hands = vi.mocked(practiceRecord).mock.calls.map(([h]) => h);
    const seatsLeft = (h: (typeof hands)[number]) => simOf(h).active.size;
    expect(hands.some((h) => h.result!.folded && seatsLeft(h) > 1)).toBe(true);
    const allIn = hands.filter((h) => STREETS.some((s) => h.lines[s].some((m) => m.action === "all-in")));
    expect(allIn.some((h) => seatsLeft(h) === 2)).toBe(true);
    expect(allIn.some((h) => seatsLeft(h) > 2)).toBe(true);
    expect(allIn.some((h) => seatsLeft(h) === 1)).toBe(true);
    // (every request's in the figures, not the last of them)
    expect(r.requests.reached).toBeGreaterThan(200);
    expect(r.requests.answered).toBe(r.requests.reached);
  });
});

describe("the hero's time", () => {
  it.each([1, 4])("takes its time over each decision, one at a time, at %i tables", async (tables) => {
    vi.useFakeTimers();
    const run = check({}, { hands: 4, tables, thinkMs: 1000, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(600_000);
    const r = await run;
    expect(r.passed).toBe(true);
    expect(r.verdicts).toBeGreaterThan(4);
    expect(r.seconds).toBeCloseTo(r.verdicts, 0);
  });

  it.each([1, 4])("leaves nothing to wait for but the solver and the hero at %i tables, so a wait is a solve's", async (tables) => {
    vi.useFakeTimers();
    const run = check({}, { hands: 8, tables, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(600_000);
    const r = await run;
    expect(r).toMatchObject({ passed: true, hands: 8 });
    expect(r.seconds).toBeLessThan(0.3);
  });

  it("thinks from the answer being in hand, not from the spot coming up", async () => {
    vi.useFakeTimers();
    const run = check({ takes: (_, play) => (play ? 0 : 1000) }, { hands: 2, tables: 1, thinkMs: 3000, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(600_000);
    const r = await run;
    expect(r.passed).toBe(true);
    expect(r.verdicts).toBeGreaterThan(1);
    expect(r.seconds).toBeCloseTo(r.verdicts * 4, 0);
  });

  it("forgets what the table refused at the last spot", async () => {
    let first = true;
    const r = await check(
      {
        solve: (q) => {
          const a = advice(q);
          const sound = a.actions!.at(-2) ?? a.actions![0]!;
          if (!first) return { ...good(q), data: { ...a, actions: [sound] } };
          first = false;
          return { ...good(q), data: { ...a, actions: [{ action: "bet", freq: 1, amount_bb: 0 }, sound] } };
        },
      },
      { hands: 2, tables: 1 },
    );
    failsOn(r, "move", /refused the answer's own "bet"/);
    expect(r.failures).toHaveLength(1);
    expect(r.hands).toBe(2);
  });

  it("plays on through another table's failures while it thinks", async () => {
    let n = 0;
    const r = await check(
      {
        takes: () => 1,
        play: (q, p) => {
          if (++n % 4 === 0) throw new SolverError("solver-error", "no move");
          return { data: move(facingBet(simOfState({ ...q, hero: p.seat }), p.seat) ? "call" : "check"), provenance: prov("live") };
        },
      },
      { thinkMs: 8, stallMs: 300, hands: 12 },
    );
    expect(rules(r)).toEqual(["request"]);
    expect(r.hands).toBe(12);
  });

  it("goes on at the table in front where another's come forward while it thought", async () => {
    vi.useFakeTimers();
    const start = vi.spyOn(Room.prototype, "start");
    const run = check({}, { tables: 2, hands: 2, thinkMs: 1000, stallMs: 5000, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(500);
    const room = start.mock.contexts[0] as Room;
    room.pick(1 - room.snapshot().focus);
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await run;
    expect(r.failures).toEqual([]);
    expect(r.hands).toBe(2);
  });

  it("waits for the answer again where a new client took it away while it thought", async () => {
    vi.useFakeTimers();
    let swap = false;
    const { client } = stub({
      takes: () => 100,
      solve: (q) => {
        // (once the next request's out, so the one after it finds the new client, with you still thinking)
        setTimeout(() => (swap = true), 60);
        return good(q);
      },
    });
    const other = { ...client };
    const run = runHandsCheck(async () => (swap ? other : client), { ...OPTS, tables: 2, hands: 2, thinkMs: 150, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await run;
    expect(r.failures).toEqual([]);
    expect(r.hands).toBe(2);
  });
});

describe("what it fails on", () => {
  it("a request rejected, whichever kind of request, and it plays on", async () => {
    let n = 0;
    const r = await check({
      solve: (q) => {
        if (q.board && !n++) throw new SolverError("solver-error", "the solve blew up");
        return good(q);
      },
    });
    failsOn(r, "request", /the solve blew up/);
    expect(r).toMatchObject({ requestErrors: 1, hands: 8 });
    expect(r.failures[0]!.study).toMatch(/^p=6&s=100&/);
    expect(r.failures[0]!.study).toContain("b=");
  });

  it("an opponent's move rejected, played on as not a solve", async () => {
    let n = 0;
    const r = await check({
      play: (q, p) => {
        if (!n++) throw new SolverError("unreachable", "no server");
        return { data: move(facingBet(simOfState({ ...q, hero: p.seat }), p.seat) ? "call" : "check"), provenance: prov("live") };
      },
    });
    failsOn(r, "request", /no server/);
    expect(r).toMatchObject({ requestErrors: 1, hands: 8 });
  });

  it("a cancel nobody asked for", async () => {
    let n = 0;
    const r = await check({
      solve: (q) => {
        if (!n++) throw new SolverError("cancelled", "solver disposed");
        return good(q);
      },
    });
    failsOn(r, "request", /solver disposed/);
    expect(r.requests.stopped).toBe(0);
  });

  it("no solver at all", async () => {
    const r = await runHandsCheck(() => Promise.reject(new Error("no client")), { ...OPTS, hands: 2, tables: 1 });
    expect(rules(r)).toContain("request");
    expect(r.failures[0]!.text).toMatch(/no client/);
    expect(r).toMatchObject({ passed: false, transport: null, hands: 2 });
    expect(r.requests.reached).toBe(0);
    expect(r.requestErrors).toBeGreaterThan(0);
  });

  it("an answer that's an error, at your spot and at an opponent's", async () => {
    let n = 0;
    const mine = await check({ solve: (q) => (q.board && !n++ ? { data: { error: "no such spot" }, provenance: prov("live") } : good(q)) });
    failsOn(mine, "request", /no such spot/);
    expect(mine).toMatchObject({ requestErrors: 1, hands: 8 });
    let m = 0;
    const theirs = await check({ play: (q, p) => ({ data: (m++ ? move(facingBet(simOfState({ ...q, hero: p.seat }), p.seat) ? "call" : "check") : { error: "no move" }) as PlayMove, provenance: prov("live") }) });
    failsOn(theirs, "request", /no move/);
    expect(theirs).toMatchObject({ requestErrors: 1, hands: 8 });
  });

  it("a reply marked cancelled that nobody asked to stop", async () => {
    let n = 0;
    const r = await check({ solve: (q) => (n++ ? good(q) : { data: { cancelled: true }, provenance: prov("live") }) });
    failsOn(r, "request", /cancelled/);
  });

  it.each([
    ["no provenance", () => null],
    ["an unknown source", () => prov("unknown")],
    ["a source nobody can describe, so describe() is empty", () => prov("nothing" as Provenance["source"])],
  ])("a graded decision with %s", async (_, p) => {
    const r = await check({ solve: relabelled((q) => (q.board ? p() : prov("charts"))) });
    failsOn(r, "label", /nothing says what answered it/);
    expect(r.unlabelled).toBeGreaterThan(0);
    expect(r.unlabelled).toBe(r.failures.length);
    expect(r.bySource.Unlabelled).toBe(r.unlabelled);
    expect(r.failures[0]!.study).toMatch(/^p=6/);
  });

  it("preflop charts graded by EV", async () => {
    const r = await check({ solve: (q) => ({ data: { ...advice(q), actions: advice(q).actions!.map((a) => ({ ...a, ev_bb: 1 })) }, provenance: q.board ? prov("live") : prov("charts") }) });
    failsOn(r, "honesty", /no EVs/);
  });

  it("preflop charts not marked approximate", async () => {
    const r = await check({ solve: relabelled((q) => (q.board ? prov("live") : prov("charts", { approximate: false }))) });
    failsOn(r, "honesty", /aren't marked approximate/);
  });

  it.each(["library", "live", "preflop-solve", "instant"] as const)("preflop answered by %s, which is no chart", async (source) => {
    const r = await check({ solve: relabelled((q) => (q.board ? prov("live") : prov(source))) });
    failsOn(r, "honesty", /isn't the charts/);
  });

  it.each([
    ["rules", "flop"],
    ["equity", "flop"],
    ["rules", "preflop"],
    ["equity", "preflop"],
  ] as const)("a %s answer on the %s not marked approximate", async (source, street) => {
    const r = await check({ solve: relabelled((q) => (!!q.board === (street === "flop") ? prov(source, { approximate: false }) : q.board ? prov("live") : prov("charts"))) });
    failsOn(r, "honesty", /isn't marked approximate/);
  });

  it("an opponent's answer the table can't take, reported and played on", async () => {
    let n = 0;
    const r = await check({
      // (a check where there's a bet to call: `recordOf` refuses it, and a table would have played a call instead)
      play: (q, p) => ({ data: move(n++ ? (facingBet(simOfState({ ...q, hero: p.seat }), p.seat) ? "call" : "check") : "check"), provenance: prov("live") }),
    });
    failsOn(r, "move", /couldn't take an opponent's answer: .*can't check/);
    expect(r).toMatchObject({ requestErrors: 0, hands: 8 });
    expect(r.failures[0]!.study).toMatch(/^p=6/);
  });

  it("an option of the answer's own that the table refuses, then the next", async () => {
    const r = await check({
      solve: (q) => {
        const a = advice(q);
        return { ...good(q), data: { ...a, actions: [{ action: "bet", freq: 1, amount_bb: 0 }, ...a.actions!] } };
      },
    });
    failsOn(r, "move", /refused the answer's own "bet"/);
    expect(r.hands).toBe(8);
  });

  it("chips not conserved (no client can do this: the fault's put in)", async () => {
    chipsAs((c) => ({ ...c, BB: c.BB! - 5 }));
    const r = await check();
    failsOn(r, "chips", /at the end of a hand that started with 600bb/);
    expect(r.failures).toHaveLength(8);
    expect(r.failures[0]!.study).toMatch(/^p=6/);
  });

  it("a hand that doesn't end: an answer that never comes", async () => {
    const r = await check({ solve: (q) => (q.board ? new Promise(() => {}) : good(q)) }, { stallMs: 40, hands: 4 });
    failsOn(r, "unended", /didn't end: nothing happened/);
    expect(r.hands).toBeLessThan(4);
    expect(r.failures[0]!.study).toMatch(/^p=6/);
  });

  it("a hand that doesn't end: a solver that never comes", async () => {
    const r = await runHandsCheck(() => new Promise(() => {}), { ...OPTS, hands: 2, tables: 1, stallMs: 30 });
    failsOn(r, "unended", /didn't end: nothing happened/);
    expect(r).toMatchObject({ transport: null, hands: 0, requests: { reached: 0 } });
  });

  it("names only the hands that didn't end", async () => {
    const quiet = () => vi.mocked(practiceRecord).mock.calls.length > 0;
    const never = new Promise<never>(() => {});
    const r = await check({ solve: (q) => (quiet() ? never : good(q)), play: () => (quiet() ? never : { data: move("fold"), provenance: prov("live") }) }, { stallMs: 40, hands: 4 });
    failsOn(r, "unended");
    expect(r.hands).toBeGreaterThan(0);
    expect(r.failures).toHaveLength(4 - r.hands);
  });

  it("a hand that doesn't end: an answer with nothing to do", async () => {
    const r = await check({ solve: (q) => ({ ...good(q), data: { ...advice(q), actions: [] } }) }, { hands: 2, tables: 1 });
    failsOn(r, "unended", /leaves no move to make/);
    expect(r.hands).toBe(0);
  });

  it("a hand that doesn't end: every option refused", async () => {
    const r = await check({ solve: (q) => ({ ...good(q), data: { street: "preflop", pot_bb: 1.5, actions: [{ action: "bet", freq: 1, amount_bb: 0 }] } }) }, { hands: 2, tables: 1 });
    expect(rules(r)).toEqual(["move", "unended"]);
    expect(r.passed).toBe(false);
  });

  it("a practiceRecord that fails to parse (no client can do this: the fault's put in)", async () => {
    recordsAs((rec, n) => {
      if (n === 2) throw new Error("no hand in this text");
      return rec;
    });
    const r = await check();
    failsOn(r, "record", /doesn't read back: no hand in this text/);
    expect(r.failures).toHaveLength(1);
  });

  it("a history the table can't follow (no client can do this: the fault's put in)", async () => {
    // (the first move gone, so the next seat is out of turn)
    recordsAs((rec) => {
      const first = rec.text.split("\n").find((l) => /: (folds|calls|raises|checks|bets)/.test(l))!;
      return { ...rec, text: rec.text.replace(`${first}\n`, "") };
    });
    const r = await check();
    failsOn(r, "record", /part ways/);
  });

  it("a practiceRecord that repeats an id (no client can do this: the fault's put in)", async () => {
    recordsAs((rec) => ({ ...rec, id: "the same" }));
    const r = await check();
    failsOn(r, "record", /repeats the id the same/);
    expect(r.failures).toHaveLength(7);
  });

  describe("a worker ended", () => {
    const stuck = { stop: "cheap" as const, stopped: new SolverError("stuck", "the solver stopped answering"), takes: (q: AdvisorState) => (q.board ? 20 : 0) };

    it("fails on an isolated page, and its stops are no request errors", async () => {
      show("visible");
      vi.stubGlobal("crossOriginIsolated", true);
      const r = await check(stuck, { askAhead: true, thinkMs: 5 });
      failsOn(r, "restart", /was ended \d+ time/);
      expect(r.restarts).toBeGreaterThan(0);
      expect(r).toMatchObject({ isolated: true, requestErrors: 0 });
    });

    it("doesn't on a page where that's what a stop is", async () => {
      show("visible");
      const r = await check(stuck, { askAhead: true, thinkMs: 5 });
      expect(r.restarts).toBeGreaterThan(0);
      expect(r).toMatchObject({ passed: true, isolated: false });
    });

    it("gives a stop as the run ends the time a worker has to answer one, and leaves that out of the run's seconds", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("crossOriginIsolated", true);
      const never = (q: AdvisorState) => (q.board ? new Promise<SolveResult>(() => {}) : good(q));
      const run = check({ solve: never, stopped: stuck.stopped, stopTakes: STUCK_MS }, { stallMs: 1000, hands: 4, now: () => Date.now() });
      await vi.advanceTimersByTimeAsync(STUCK_MS + 2000);
      const r = await run;
      expect(rules(r)).toEqual(["unended", "restart"]);
      expect(r).toMatchObject({ restarts: 1, requestErrors: 0, requests: { stopped: 1 } });
      expect(r.seconds).toBeCloseTo(1, 0);
    });

    it("isn't held by one that never settles", async () => {
      vi.useFakeTimers();
      const hung = { solve: (q: AdvisorState) => (q.board ? new Promise<SolveResult>(() => {}) : good(q)), stopTakes: 1e9 };
      const run = check(hung, { stallMs: 1000, hands: 4 });
      await vi.advanceTimersByTimeAsync(STUCK_MS + 5000);
      expect(rules(await run)).toEqual(["unended"]);
    });
  });
});

describe("Stop", () => {
  it("ends the run cleanly with a report that says so", async () => {
    const ac = new AbortController();
    const { client, asked } = stub({ stop: "cheap", takes: () => 5 });
    const r = await runHandsCheck(async () => client, {
      ...OPTS,
      hands: 20,
      signal: ac.signal,
      onProgress: (p) => {
        if (p.verdicts >= 3) ac.abort();
      },
    });
    expect(r).toMatchObject({ stopped: true, passed: false, requestErrors: 0, failures: [] });
    expect(r.hands).toBeLessThan(20);
    expect(r.verdicts).toBeGreaterThanOrEqual(3);
    expect(Object.values(r.bySource).reduce((a, b) => a + b, 0)).toBe(r.verdicts);
    expect(r.requests.reached).toBe(asked.length);
    const out = asked.length;
    await new Promise((f) => setTimeout(f, 20));
    expect(asked).toHaveLength(out);
    expect(await lastReport()).toBeTruthy();
  });

  it("counts the request it stopped, and asks nothing after", async () => {
    const ac = new AbortController();
    const { client, asked } = stub({ takes: (q, play) => (q.board && !play ? 10_000 : 0) });
    const run = runHandsCheck(async () => client, { ...OPTS, signal: ac.signal, tables: 1, hands: 20 });
    await vi.waitFor(() => expect(asked.some((a) => a.state.board && !a.play)).toBe(true), { timeout: 30_000 });
    ac.abort();
    const r = await run;
    expect(r.requests.stopped).toBe(1);
    expect(r.requestErrors).toBe(0);
    expect(r.stopped).toBe(true);
  });

  it("asks nothing if it's stopped before it starts", async () => {
    const ac = new AbortController();
    ac.abort();
    const { client, asked } = stub();
    const r = await runHandsCheck(async () => client, { ...OPTS, signal: ac.signal });
    await new Promise((f) => setTimeout(f, 10));
    expect(asked).toHaveLength(0);
    expect(r).toMatchObject({ stopped: true, passed: false, hands: 0, verdicts: 0 });
  });

  it("makes no move once it's stopped, a decision half thought over included", async () => {
    vi.useFakeTimers();
    const choose = vi.spyOn(Room.prototype, "choose");
    const ac = new AbortController();
    const run = check({ takes: () => 100 }, { hands: 20, thinkMs: 1000, signal: ac.signal, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(2500);
    const moves = choose.mock.calls.length;
    ac.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await run).stopped).toBe(true);
    expect(moves).toBeGreaterThan(0);
    expect(choose).toHaveBeenCalledTimes(moves);
  });

  it("doesn't wait for ever on a request that won't stop", async () => {
    const ac = new AbortController();
    const client: RoomClient = { solve: () => new Promise(() => {}), play: () => new Promise(() => {}), transport: { kind: "worker" } };
    const run = runHandsCheck(async () => client, { ...OPTS, signal: ac.signal, tables: 1 });
    await new Promise((f) => setTimeout(f, 10));
    const at = performance.now();
    ac.abort();
    expect((await run).stopped).toBe(true);
    expect(performance.now() - at).toBeLessThan(5000);
  });
});

describe("a timed run", () => {
  it("plays one table at the page's pace, as its waits are a player's", async () => {
    const r = await check({}, { hands: 1, tables: 1, pace: undefined });
    expect(r.passed).toBe(true);
    expect(r.seconds).toBeGreaterThanOrEqual(0.45);
  });

  it("deals the same at the same number of tables, whatever else differs, and not across them", async () => {
    const at = (tables: number, askAhead = false) => check({ stop: "cheap" }, { hands: 4, tables, askAhead });
    show("visible");
    expect((await at(1)).fingerprint).toBe((await at(1, true)).fingerprint);
    expect((await at(4)).fingerprint).toBe((await at(4, true)).fingerprint);
    expect((await at(1)).fingerprint).not.toBe((await at(4)).fingerprint);
  });

  it("says this solver had played a run already, and a new one hadn't", async () => {
    const st = stub();
    const run = (c: RoomClient) => runHandsCheck(async () => c, { ...OPTS, hands: 1, tables: 1 });
    const seen = [await run(st.client), await run(st.client), await run(st.client), await run(stub().client)];
    expect(seen.map((r) => r.earlier)).toEqual([0, 1, 2, 0]);
  });

  it("stays warm where a run on a warm solver gets a new client on the way", async () => {
    const warm = stub();
    await runHandsCheck(async () => warm.client, { ...OPTS, hands: 1, tables: 1 });
    const fresh = stub();
    let calls = 0;
    const r = await runHandsCheck(async () => ((calls += 1) === 1 ? warm.client : fresh.client), { ...OPTS, hands: 1, tables: 1 });
    expect(calls).toBeGreaterThan(1);
    expect(r.earlier).toBe(1);
  });

  it("names the build it ran on, or nothing where a client doesn't say", async () => {
    const st = stub();
    const r = await runHandsCheck(async () => ({ ...st.client, solverVersion: "9b907bd6/abc" }), { ...OPTS, hands: 1, tables: 1 });
    expect(r.solver).toBe("9b907bd6/abc");
    expect((await check({}, { hands: 1, tables: 1 })).solver).toBeNull();
  });

  it("says when and on what, in a line, and whether that's this page's build", () => {
    const r = { at: Date.UTC(2026, 10, 4, 12), solver: "9b907bd6/abc" } as HandsCheckReport;
    const date = new Date(r.at).toLocaleString();
    expect(whenLine(r, "9b907bd6/abc")).toBe(`Run ${date} on build 9b907bd6/abc`);
    expect(whenLine(r, "1111aaaa/abd")).toBe(`Run ${date} on an earlier build, 9b907bd6/abc`);
    expect(whenLine(r, null)).toBe(`Run ${date} on build 9b907bd6/abc`);
    expect(whenLine({ ...r, solver: null }, "1111aaaa/abd")).toBe(`Run ${date}, build not recorded`);
  });

  it("says a run wasn't cold, in a line, only where it wasn't", () => {
    const r = { earlier: 0 } as HandsCheckReport;
    expect(warmLine(r)).toBeNull();
    expect(warmLine({ ...r, earlier: 1 })).toBe("Not a cold run: this solver had played a run already and keeps its answers, so reload before timing one.");
    expect(warmLine({ ...r, earlier: 3 })).toBe("Not a cold run: this solver had played 3 runs already and keeps its answers, so reload before timing one.");
  });
});

describe("what it leaves alone", () => {
  it("nothing reaches this browser's measured solve times, through a real client", async () => {
    const st = stub();
    const flops: AdvisorState[] = [];
    const request = async (q: AdvisorState, o: { play?: PlayRequest }) => {
      if (o.play) return (await st.client.play(q, o.play)).data;
      if (q.board) flops.push(q);
      return { ...advice(q), ...(q.board ? { seconds: 1.25, solver: { iterations: 10 } } : {}) };
    };
    const client = new SolverClient({ kind: "worker", request, stopCost: () => "kills" } as unknown as SolverTransport, "test");
    const r = await runHandsCheck(async () => client, { ...OPTS, hands: 2, tables: 1 });
    expect(r.passed).toBe(true);
    expect(r.bySource).toHaveProperty("Live solve");
    expect(localStorage.getItem("lizard.solveTimes.v1")).toBeNull();
    // (the same answer, asked by anything else, is measured)
    await client.solve({ state: flops[0]!, mode: "quick" });
    expect(localStorage.getItem("lizard.solveTimes.v1")).not.toBeNull();
    localStorage.removeItem("lizard.solveTimes.v1");
  });

  it("nothing reaches sessions, hands, the kept doc or habits, whatever the Settings", async () => {
    useSettings.setState({ keepHands: true });
    show("visible");
    saveHabits({ open: { fold: 9, pass: 9, aggr: 9 } });
    const before = JSON.stringify({ ...localStorage });
    const read = vi.spyOn(Storage.prototype, "getItem");
    const r = await check({ stop: "cheap", takes: () => 1 }, { askAhead: true, thinkMs: 2 });
    expect(r.passed).toBe(true);
    await new Promise((f) => setTimeout(f, 30));
    expect(await allSessions()).toEqual([]);
    expect(await listHands()).toEqual([]);
    expect(await kvGet(KEPT_KEY)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(JSON.stringify({ ...localStorage })).toBe(before);
    expect(readHabits().open).toEqual({ fold: 9, pass: 9, aggr: 9 });
  });

  it("doesn't take up a session the browser has kept", async () => {
    const hand = newHand(6, 100, 0, 3);
    const kept = { v: 1, n: 2, focus: 1, session: { id: "mine" }, tables: [{ hand, stats: {}, last: null, lastHand: null }, null, null, null] };
    await kvSet(KEPT_KEY, kept);
    const a = await check();
    expect(a.passed).toBe(true);
    expect(await kvGet(KEPT_KEY)).toEqual(kept);
  });

  it("deals the same whatever Spots, Seat, the mode and asking ahead say in Settings", async () => {
    const plain = await check();
    useSettings.setState({ practiceSpot: "3bet", practiceSeat: "BB", mode: "accurate", askAhead: true });
    show("visible");
    // (a guess that takes time and goes wrong would be stopped, so a stop would show here)
    const { client, asked } = stub({ stop: "cheap", takes: (q) => (q.board ? 20 : 0) });
    const set = await runHandsCheck(async () => client, { ...OPTS, thinkMs: 5 });
    expect(set.fingerprint).toBe(plain.fingerprint);
    expect(set).toMatchObject({ passed: true, askAhead: false, ahead: null, requests: { stopped: 0 } });
    expect(asked.every((a) => a.mode === "quick")).toBe(true);
    // (the preflop was yours to play: no drill, and no seat held to the big blind)
    expect(set.bySource["Preflop charts"]).toBeGreaterThan(0);
    expect(new Set(asked.filter((a) => !a.play).map((a) => a.state.hero)).size).toBeGreaterThan(1);
  });
});

describe("asking ahead in the check", () => {
  beforeEach(() => show("visible"));

  it("doesn't count its stopped requests as errors, and its meter is in the report", async () => {
    const r = await check({ stop: "cheap", takes: (q) => (q.board ? 20 : 0) }, { askAhead: true, thinkMs: 5, hands: 12 });
    expect(r.failures).toEqual([]);
    expect(r).toMatchObject({ passed: true, requestErrors: 0, askAhead: true, thinkMs: 5, stopCost: "cheap" });
    expect(r.requests.stopped).toBeGreaterThan(0);
    expect(r.requests.reached).toBe(r.requests.answered + r.requests.stopped);
    expect(r.ahead!.asked).toBeGreaterThan(0);
    expect(r.ahead!.spentS).toBeGreaterThan(0);
    expect(aheadLine(r)).toMatch(/^\d+ of \d+ used · about \d+ s of waiting saved for \d+ s of solver time$/);
  });

  it("still fails on a look-ahead that failed by itself, as nothing stopped it", async () => {
    let n = 0;
    const r = await check(
      {
        stop: "cheap",
        takes: () => 1,
        // (your line's next spot, asked while you think, which is the only time a flop's advice has a line on it)
        solve: (q) => {
          if (q.board && q.flop?.length && !n++) throw new SolverError("solver-error", "a look-ahead blew up");
          return good(q);
        },
      },
      { askAhead: true, thinkMs: 5, hands: 12 },
    );
    expect(rules(r)).toEqual(["request"]);
    expect(r.requestErrors).toBe(1);
    expect(r.failures[0]!.text).toMatch(/a look-ahead blew up/);
  });

  it("says why nothing was asked where a stop would end the solver", async () => {
    const r = await check({ stop: "kills", takes: () => 1 }, { askAhead: true, thinkMs: 2, hands: 4 });
    expect(r.ahead).toEqual({ asked: 0, used: 0, savedS: 0, spentS: 0 });
    expect(aheadLine(r)).toMatch(/can't stop a solve/);
  });
});

describe("the figures", () => {
  it("gives the postflop waits, the seconds per request and the gap to the estimates, on a clock", async () => {
    vi.useFakeTimers();
    // you check to the river each hand and they check behind: a flop answer takes 1 s, a turn's 2, a river's 3, nothing else any
    const solve = (q: AdvisorState) => ({ ...good(q), data: { ...advice(q), actions: [{ action: facingBet(simOfState(q), q.hero!) ? "call" : "check", freq: 1, ...(q.board ? { ev_bb: 1 } : {}) }] } });
    const play = (q: AdvisorState, p: PlayRequest) => ({ data: move(facingBet(simOfState({ ...q, hero: p.seat }), p.seat) ? "call" : "check"), provenance: prov("live") });
    const secs = (q: AdvisorState) => ({ 6: 1000, 8: 2000, 10: 3000 })[q.board?.length ?? 0] ?? 0;
    const run = check({ solve, play, takes: (q, isPlay) => (isPlay ? 0 : secs(q)) }, { hands: 3, tables: 1, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await run;
    expect(r.failures).toEqual([]);
    expect(r.hands).toBe(3);
    expect(r.waits).toEqual({ n: 9, medianS: 2, p90S: 3 });
    expect(r.requests.postflopMedianS).toBe(0);
    expect(r.requests.medianS).toBe(0);
    expect(r.requests.reached).toBe(r.requests.answered);
    expect(r.seconds).toBeCloseTo(18, 0);
    const flop = r.gap.find((g) => g.street === "flop")!;
    expect(flop.estS).toBeGreaterThan(0);
    expect(r.gap.map((g) => g.street)).toEqual(["preflop", "flop", "turn", "river"]);
    expect(r.gap[0]).toMatchObject({ estS: 0.05, s: 0 });
    expect(r.gap.reduce((n, g) => n + g.n, 0)).toBe(r.requests.answered);
  });

  it("gives the median of what reached the solver, and of those after the preflop on their own", async () => {
    vi.useFakeTimers();
    // you limp and bet the flop, and all but the big blind fold: six requests before the flop, three after
    const solve = (q: AdvisorState) => ({ ...good(q), data: { ...advice(q), actions: q.board ? [{ action: "bet", freq: 1, amount_bb: 3, ev_bb: 1 }] : [{ action: "call", freq: 1 }] } });
    const play = (q: AdvisorState, p: PlayRequest) => ({ data: move(facingBet(simOfState({ ...q, hero: p.seat }), p.seat) ? "fold" : "check"), provenance: prov("live") });
    const run = check({ solve, play, takes: (q) => (q.board ? 2000 : 0) }, { hands: 2, tables: 1, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(600_000);
    const r = await run;
    expect(r.failures).toEqual([]);
    expect(r.requests.reached).toBe(18);
    expect(r.requests.medianS).toBe(0);
    expect(r.requests.postflopMedianS).toBe(2);
  });

  it("leaves out the preflop waits", async () => {
    vi.useFakeTimers();
    const run = check({ takes: (q, play) => (!q.board && !play ? 4000 : 0), play: () => ({ data: move("fold"), provenance: prov("live") }) }, { hands: 2, tables: 1, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await run;
    expect(r.waits).toEqual({ n: 0, medianS: null, p90S: null });
    expect(r.requests.postflopMedianS).toBeNull();
  });

  it("quantile: between neighbours, null of nothing", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([3], 0.9)).toBe(3);
    expect(quantile([1, 3], 0.5)).toBe(2);
    expect(quantile([4, 1, 2, 3], 0.5)).toBe(2.5);
    expect(quantile([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 0.9)).toBe(9.1);
  });

  it("says itself in lines", () => {
    const r = { hands: 20, verdicts: 63, requestErrors: 0, unlabelled: 0, seconds: 108, tables: 4, thinkMs: 3000, askAhead: true } as HandsCheckReport;
    expect(reportLine(r)).toBe("20 hands · 63 verdicts · 0 request errors · 0 without a label · 1 m 48 s");
    expect(setupLine(r)).toBe("4 tables · 3 s to think a decision · asking ahead on · Quick");
    expect(setupLine({ ...r, tables: 1, thinkMs: 0, askAhead: false })).toBe("1 table · no time to think · asking ahead off · Quick");
    expect(setupLine({ ...r, stopCost: "kills" })).toBe("4 tables · 3 s to think a decision · asking ahead off · Quick");
    expect(timeText(59.4)).toBe("59 s");
    expect(timeText(60)).toBe("1 m 0 s");
    expect(progressLine({ hands: 6, of: 20, verdicts: 18, errors: 0 })).toBe("Hand 7 of 20 · 18 verdicts · 0 errors");
    expect(progressLine({ hands: 20, of: 20, verdicts: 63, errors: 2 })).toBe("Hand 20 of 20 · 63 verdicts · 2 errors");
    expect(aheadLine({ ...r, ahead: null })).toBeNull();
  });
});

describe("the last report", () => {
  it("doesn't hold the report up for a database that doesn't answer, nor stand in its way", async () => {
    vi.mocked(kvSet).mockImplementationOnce(() => new Promise(() => {}));
    expect((await check({}, { hands: 2, tables: 1 })).hands).toBe(2);
    // (a spy hears every promise it hands back, so a refusal left loose wouldn't show as one)
    let refused!: Promise<void>;
    vi.mocked(kvSet).mockImplementationOnce(() => {
      refused = Promise.reject(new Error("no database"));
      vi.spyOn(refused, "catch");
      return refused;
    });
    expect((await check({}, { hands: 2, tables: 1 })).hands).toBe(2);
    expect(refused.catch).toHaveBeenCalled();
    vi.mocked(kvGet).mockRejectedValueOnce(new Error("no database"));
    expect(await lastReport()).toBeNull();
  });

  it("stays in kv, and one this build can't read isn't taken for it", async () => {
    const r = await check({}, { hands: 2, tables: 1 });
    await vi.waitFor(async () => expect(await lastReport()).toEqual(r));
    await kvSet(CHECK_KEY, { v: 2 });
    expect(await lastReport()).toBeNull();
    await kvSet(CHECK_KEY, undefined);
    expect(await lastReport()).toBeNull();
  });

  it("reads one from before a run said its build and what came before it", async () => {
    await kvSet(CHECK_KEY, { v: 1, passed: true });
    expect(await lastReport()).toEqual({ v: 1, passed: true, solver: null, earlier: 0 });
    await kvSet(CHECK_KEY, undefined);
  });
});

describe("the hero", () => {
  const res = (...a: [string, number][]): AdvisorResponse => ({ actions: a.map(([action, freq]) => ({ action, freq })) });

  it("doesn't fold where it can do anything else, however the mix leans", () => {
    const r = seeded(1);
    const m = res(["fold", 0.97], ["call", 0.03]);
    for (let i = 0; i < 50; i += 1) expect(heroPick(m, new Set(), r)).toBe(1);
  });

  it("folds where there's nothing else, or nothing else left", () => {
    expect(heroPick(res(["fold", 1]), new Set(), seeded(1))).toBe(0);
    expect(heroPick(res(["fold", 0.5], ["call", 0.5]), new Set([1]), seeded(1))).toBe(0);
  });

  it("draws from the mix, by the seed", () => {
    const m = res(["fold", 0.2], ["check", 0.2], ["bet 33%", 0.6]);
    const draw = (seed: number) => {
      const r = seeded(seed);
      return Array.from({ length: 2000 }, () => heroPick(m, new Set(), r));
    };
    const a = draw(5);
    expect(a).toEqual(draw(5));
    expect(a).not.toEqual(draw(6));
    const bets = a.filter((i) => i === 2).length / a.length;
    expect(bets).toBeGreaterThan(0.7);
    expect(bets).toBeLessThan(0.8);
    expect(a).not.toContain(0);
  });

  it("takes anything from a mix with nothing on what's left", () => {
    expect(heroPick(res(["fold", 1], ["call", 0]), new Set(), seeded(2))).toBe(1);
    expect(heroPick(res(["check", 0], ["call", 0]), new Set([0]), seeded(2))).toBe(1);
  });

  it("draws evenly from a mix with nothing on it", () => {
    const m = res(["check", 0], ["bet 33%", 0], ["bet 75%", 0]);
    expect(heroPick(m, new Set(), () => 0)).toBe(0);
    expect(heroPick(m, new Set(), () => 0.99)).toBe(2);
  });

  it("takes the last of a mix where the rounding leaves a little over", () => {
    expect(heroPick(res(["check", 0.1], ["bet 33%", 0.2]), new Set(), () => 1)).toBe(1);
  });

  it("has nothing to take from no options", () => {
    expect(heroPick({ actions: [] }, new Set(), seeded(1))).toBe(-1);
    expect(heroPick(res(["call", 1]), new Set([0]), seeded(1))).toBe(-1);
    expect(heroPick({ error: "x" }, new Set(), seeded(1))).toBe(-1);
  });
});

describe("the rules, one decision and one hand at a time", () => {
  const grade = { a: 0, best: 0, verdict: "Best" as const, ok: true, mixed: false, loss: 0, lossPct: 0, byEv: true };
  const d = (street: Decision["street"], p: Provenance | null, byEv = true): Decision => ({ street, chose: "check", move: { pos: "BB", action: "check" }, grade: { ...grade, byEv }, mix: [], pot: 3, provenance: p, study: "p=6" });

  it("an ungraded decision has nothing to answer for", () => {
    expect(labelFault({ ...d("flop", null), grade: null })).toBeNull();
  });

  it("takes each honest label", () => {
    for (const [street, source, byEv] of [
      ["flop", "live", true],
      ["flop", "library", true],
      ["turn", "library-turn", true],
      ["river", "instant", false],
      ["preflop", "charts", false],
      ["preflop", "rules", false],
      ["preflop", "equity", true],
      ["flop", "rules", false],
      ["river", "equity", false],
    ] as const) {
      const p = prov(source, { approximate: source === "charts" || source === "rules" || source === "equity" });
      expect(describeProv(p)).not.toBe("");
      expect(labelFault(d(street, p, byEv))).toBeNull();
    }
  });

  it("says which rule each breaks", () => {
    expect(labelFault(d("flop", null))?.rule).toBe("label");
    expect(labelFault(d("flop", prov("unknown")))?.rule).toBe("label");
    expect(labelFault(d("preflop", prov("charts"), true))?.text).toMatch(/no EVs/);
    expect(labelFault(d("preflop", prov("charts", { approximate: false }), false))?.text).toMatch(/aren't marked/);
    expect(labelFault(d("turn", prov("equity", { approximate: false })))?.text).toBe("Equity estimate (not a solve) isn't marked approximate");
    expect(labelFault(d("preflop", prov("live"), false))?.text).toBe("answered preflop by Live solve, which isn't the charts");
  });

  const played = () => {
    // (the big blind's walk: everyone folds to it)
    const h = newHand(6, 100, 0, 3);
    const seats = ["UTG", "HJ", "CO", "BTN", "SB"];
    return { ...h, hero: "BB", lines: { ...noLines(), preflop: seats.map((pos) => ({ pos, action: "fold" as const })) }, result: { net: 0.5, folded: false, winners: ["BB"], says: "", pays: { BB: 1.5 } } as HandResult };
  };

  it("takes a hand whose chips add up", () => {
    expect(chipsFault(played())).toBeNull();
  });

  it("catches a result that isn't what happened to your chips", () => {
    const h = played();
    expect(chipsFault({ ...h, result: { ...h.result, net: 3 } })).toBe("your result says 3bb, your chips say 0.5bb");
  });

  it("catches chips gone, and a seat below nothing", () => {
    for (const [as, says] of [
      [(c: Record<string, number>) => ({ ...c, SB: c.SB! - 1 }), /^599bb at the end/],
      [(c: Record<string, number>) => ({ ...c, SB: c.SB! - 0.02 }), /^599.98bb at the end/],
      [(c: Record<string, number>) => ({ ...c, SB: -1, BB: c.BB! + c.SB! + 1 }), /less than nothing/],
      [(c: Record<string, number>) => ({ ...c, SB: NaN }), /less than nothing/],
    ] as const) {
      chipsAs(as);
      expect(chipsFault(played())).toMatch(says);
    }
  });
});
