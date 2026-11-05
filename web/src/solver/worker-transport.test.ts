import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolverClient } from "./client";
import type { WorkerInbound, WorkerOutbound } from "./protocol";
import { BOOT_STALL_KNOWN_MS, BOOT_STALL_MS, WorkerTransport } from "./worker-transport";

/** Stands in for the Pyodide worker: records what the page posts, and lets the test send replies. */
class FakeWorker {
  posted: WorkerInbound[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerOutbound>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor(readonly url: string) {}
  postMessage(m: WorkerInbound) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: WorkerOutbound) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerOutbound>);
  }
}

beforeEach(() => localStorage.clear()); // (a boot remembered from another test would shorten this one's wait)

function setup(isolated: boolean) {
  const workers: FakeWorker[] = [];
  const t = new WorkerTransport({
    assetBase: "/lizard/solver/",
    version: "03dec6cd01",
    libraryBase: "/lizard-library/",
    crossOriginIsolated: isolated,
    createWorker: (url) => {
      const w = new FakeWorker(url);
      workers.push(w);
      return w as unknown as Worker;
    },
  });
  return { t, workers };
}

const lastRequest = (w: FakeWorker) => w.posted.filter((m) => "state" in m).at(-1) as { id: number; early?: boolean };

describe("WorkerTransport", () => {
  it("loads the upstream worker with the bundle version and library base", () => {
    const { t } = setup(false);
    expect(t.workerUrl()).toBe("/lizard/solver/worker.js?v=03dec6cd01&lib=%2Flizard-library%2F");
  });

  it("reports boot progress, delivers partials, and resolves with the result", async () => {
    const { t, workers } = setup(false);
    const phases: string[] = [];
    t.onStatus((s) => phases.push(s.phase));
    const partials: unknown[] = [];
    const p = t.request({ players: 2 }, { progressive: true, onPartial: (r) => partials.push(r) });
    const w = workers[0]!;
    const { id, early } = lastRequest(w);
    expect(early).toBe(true);
    w.reply({ status: "Loading numpy…" });
    w.reply({ status: "Solving…", setup: { total: 4.2, core: true, threads: 4 } });
    expect(t.status()).toMatchObject({ phase: "busy", setup: { threads: 4 } });
    w.reply({ id, partial: { street: "turn" } });
    w.reply({ id: id + 99, result: { street: "river" } }); // someone else's: ignored
    w.reply({ id, result: { street: "turn", solver: { iterations: 5 } } });
    await expect(p).resolves.toMatchObject({ solver: { iterations: 5 } });
    expect(partials).toHaveLength(1);
    expect(t.status().phase).toBe("ready");
    expect(phases).toEqual(expect.arrayContaining(["idle", "booting", "busy", "ready"]));
  });

  it("posts a practice opponent's move with its seat and hand, never early", async () => {
    const { t, workers } = setup(false);
    const p = t.request({ players: 2, hero: "SB", hole: "AhKd" }, { progressive: true, play: { seat: "BB", hole: "QcQd", seed: 7 } });
    const w = workers[0]!;
    const m = w.posted.filter((x) => "state" in x).at(-1) as { id: number; early?: boolean; play?: unknown };
    expect(m.play).toEqual({ seat: "BB", hole: "QcQd", seed: 7 });
    expect(m.early).toBeUndefined();
    w.reply({ status: "Solving…" });
    w.reply({ id: m.id, result: { pos: "BB", action: "raise", to: 9, name: "raise 9", freq: 0.4, street: "preflop" } });
    await expect(p).resolves.toMatchObject({ pos: "BB", action: "raise", to: 9 });
  });

  it("without shared memory, cancelling ends the worker and the next request starts a new one", async () => {
    const { t, workers } = setup(false);
    const ac = new AbortController();
    const p = t.request({ players: 2 }, { progressive: false, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
    expect(workers[0]!.terminated).toBe(true);
    void t.request({ players: 2 }, { progressive: false });
    expect(workers).toHaveLength(2);
  });

  it("cross-origin isolated, cancelling flags the running id and keeps the worker", async () => {
    const { t, workers } = setup(true);
    const ac = new AbortController();
    const p = t.request({ players: 2 }, { progressive: false, signal: ac.signal });
    const w = workers[0]!;
    const stop = w.posted.find((m) => "stop" in m) as { stop: SharedArrayBuffer } | undefined;
    expect(stop).toBeDefined();
    const { id } = lastRequest(w);
    ac.abort();
    expect(new Int32Array(stop!.stop)[1]).toBe(id);
    expect(w.posted).toContainEqual({ cancel: id });
    expect(w.terminated).toBe(false);
    w.reply({ id, result: { cancelled: true } });
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("a boot error fails the request and the status; the next request retries with a fresh worker", async () => {
    const { t, workers } = setup(false);
    const p = t.request({ players: 2 }, { progressive: false });
    const w = workers[0]!;
    w.reply({ status: "Loading the Python runtime…" });
    w.reply({ id: lastRequest(w).id, error: "pyodide failed to load" });
    await expect(p).rejects.toMatchObject({ kind: "solver-error" });
    expect(t.status()).toMatchObject({ phase: "failed", error: "pyodide failed to load" });
    void t.request({ players: 2 }, { progressive: false });
    expect(w.terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it("refuses a second concurrent request (the client queues instead)", async () => {
    const { t } = setup(false);
    void t.request({ players: 2 }, { progressive: false });
    await expect(t.request({ players: 2 }, { progressive: false })).rejects.toMatchObject({ kind: "bad-request" });
  });
});

describe("WorkerTransport: the flop told", () => {
  const flop = { players: 2, board: "Ks7d2c" };
  const told = (w: FakeWorker) => w.posted.filter((m) => "prefetch" in m);
  /** A request stopped where the only stop ends the worker. */
  async function killed(t: WorkerTransport) {
    const ac = new AbortController();
    const p = t.request({ players: 2 }, { progressive: false, signal: ac.signal });
    t.prefetch(flop);
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: "cancelled" });
  }

  it("tells the worker at once", () => {
    const { t, workers } = setup(false);
    void t.request({ players: 2 }, { progressive: false }).catch(() => {});
    t.prefetch(flop);
    expect(told(workers[0]!)).toEqual([{ prefetch: flop }]);
  });

  it("tells each new worker too, ahead of its first request: what the last fetched ahead went with it", async () => {
    const { t, workers } = setup(false);
    await killed(t);
    expect(told(workers[0]!)).toHaveLength(1);

    void t.request({ players: 3 }, { progressive: false }).catch(() => {});
    const next = workers[1]!;
    expect(told(next)).toEqual([{ prefetch: flop }]);
    expect(next.posted.findIndex((m) => "prefetch" in m)).toBeLessThan(next.posted.findIndex((m) => "state" in m));
  });

  it("holds a flop told with no worker for the next one", async () => {
    const { t, workers } = setup(false);
    await killed(t);
    const later = { players: 2, board: "As8h3d" };
    t.prefetch(later);
    expect(told(workers[0]!)).toEqual([{ prefetch: flop }]);

    t.boot();
    expect(told(workers[1]!)).toEqual([{ prefetch: later }]);
  });

  it("tells the worker that replaces a failed boot", async () => {
    const { t, workers } = setup(false);
    const p = t.request({ players: 2 }, { progressive: false });
    t.prefetch(flop);
    workers[0]!.onerror?.({ message: "no wasm" } as ErrorEvent);
    await expect(p).rejects.toMatchObject({ kind: "boot-failed" });

    void t.request({ players: 2 }, { progressive: false }).catch(() => {});
    expect(told(workers[1]!)).toEqual([{ prefetch: flop }]);
  });

  it("tells a first worker nothing where no flop has come up", () => {
    const { t, workers } = setup(false);
    t.boot();
    expect(told(workers[0]!)).toEqual([]);
  });
});

describe("WorkerTransport: a stop nobody answers", () => {
  const STUCK_MS = 15_000;
  const pings = (w: FakeWorker) => w.posted.filter((m) => "ping" in m);

  /** A request sent, its controller, and how it has gone so far. */
  function running(t: WorkerTransport) {
    const ac = new AbortController();
    const seen: { error?: unknown; settled: boolean } = { settled: false };
    const p = t.request({ players: 2 }, { progressive: false, signal: ac.signal });
    void p.then(
      () => (seen.settled = true),
      (error: unknown) => Object.assign(seen, { error, settled: true }),
    );
    return { ac, seen };
  }

  /** An isolated worker up and solving, and a request of its stopped. */
  function stopped() {
    const { t, workers } = setup(true);
    const r = running(t);
    const w = workers[0]!;
    w.reply({ status: "Solving…" });
    r.ac.abort();
    return { t, workers, w, ...r };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings the worker once on a stop, and rejects stuck after 15 s of silence", async () => {
    const { t, w, seen } = stopped();
    expect(pings(w)).toEqual([{ ping: 1 }]);
    await vi.advanceTimersByTimeAsync(STUCK_MS - 1);
    expect(seen.settled).toBe(false);
    expect(w.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // (Study and Compare print it where a stop has come to this)
    const why = "The solver stopped answering; it restarts on the next request.";
    expect(seen.error).toMatchObject({ name: "SolverError", kind: "stuck", message: why });
    expect(w.terminated).toBe(true);
    expect(t.status()).toMatchObject({ phase: "idle", message: why });
  });

  it("starts a new worker for the next request, with a stop flag of its own", async () => {
    const { t, workers } = stopped();
    await vi.advanceTimersByTimeAsync(STUCK_MS);
    running(t);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.posted.find((m) => "stop" in m)).toBeDefined();
  });

  it("sends what was queued behind it to the new worker, the client handing on the kind", async () => {
    const { t, workers } = setup(true);
    const c = new SolverClient(t, "test");
    const ac = new AbortController();
    const first = c.solve({ state: { players: 2 }, signal: ac.signal }).catch((e: unknown) => e);
    const next = c.solve({ state: { players: 3 } });
    await vi.advanceTimersByTimeAsync(0);
    workers[0]!.reply({ status: "Solving…" });
    ac.abort();
    await vi.advanceTimersByTimeAsync(STUCK_MS);
    await expect(first).resolves.toMatchObject({ kind: "stuck" });
    expect(workers).toHaveLength(2);
    const w = workers[1]!;
    w.reply({ status: "Solving…" });
    w.reply({ id: lastRequest(w).id, result: { street: "preflop" } });
    await expect(next).resolves.toMatchObject({ data: { street: "preflop" } });
  });

  it("lets a pong call it off: the stop goes on to its own answer", async () => {
    const { t, w, seen } = stopped();
    const { id } = lastRequest(w);
    w.reply({ pong: 1 });
    await vi.advanceTimersByTimeAsync(STUCK_MS * 4);
    expect(w.terminated).toBe(false);
    expect(seen.settled).toBe(false);
    w.reply({ id, result: { cancelled: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toMatchObject({ kind: "cancelled" });
    expect(t.status().phase).toBe("ready");
  });

  it("doesn't take an older ping's pong for this stop's", async () => {
    const { t, w } = stopped();
    w.reply({ id: lastRequest(w).id, result: { cancelled: true } });
    const later = running(t);
    later.ac.abort();
    expect(pings(w)).toEqual([{ ping: 1 }, { ping: 2 }]);
    w.reply({ pong: 1 });
    await vi.advanceTimersByTimeAsync(STUCK_MS);
    expect(w.terminated).toBe(true);
    expect(later.seen.error).toMatchObject({ kind: "stuck" });
  });

  it("doesn't watch while booting: its stretches aren't requests", async () => {
    const { t, workers } = setup(true);
    const { ac, seen } = running(t);
    const w = workers[0]!;
    w.reply({ status: "Loading numpy…" });
    ac.abort();
    expect(pings(w)).toEqual([]);
    expect(vi.getTimerCount()).toBe(1); // (the boot's own watch, no stop's)
    await vi.advanceTimersByTimeAsync(STUCK_MS * 4);
    expect(w.terminated).toBe(false);
    // (once up, the worker sees the stop before it starts)
    w.reply({ status: "Solving…" });
    w.reply({ id: lastRequest(w).id, result: { cancelled: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toMatchObject({ kind: "cancelled" });
  });

  it("clears the timer on dispose: a new worker isn't ended for the old one's stop", async () => {
    const { t, workers, seen } = stopped();
    t.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toMatchObject({ kind: "cancelled" });
    const next = running(t);
    await vi.advanceTimersByTimeAsync(STUCK_MS);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.terminated).toBe(false);
    expect(next.seen.settled).toBe(false);
  });

  it("clears the timer once the stop is answered: the next request's long solve is left alone", async () => {
    const { t, w, seen } = stopped();
    w.reply({ id: lastRequest(w).id, result: { cancelled: true } });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toMatchObject({ kind: "cancelled" });
    const next = running(t);
    await vi.advanceTimersByTimeAsync(STUCK_MS);
    expect(w.terminated).toBe(false);
    expect(next.seen.settled).toBe(false);
  });

  it("clears the timer when a whole answer beats the stop", async () => {
    const { w, seen } = stopped();
    w.reply({ id: lastRequest(w).id, result: { street: "turn" } });
    await vi.advanceTimersByTimeAsync(STUCK_MS);
    expect(seen).toEqual({ settled: true });
    expect(w.terminated).toBe(false);
  });

  it("clears the timer when the worker dies of itself", async () => {
    const { w, seen } = stopped();
    w.onerror?.({ message: "out of memory" } as ErrorEvent);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toMatchObject({ kind: "boot-failed" });
  });

  it("doesn't ping where a stop ends the worker anyway", async () => {
    const { t, workers } = setup(false);
    const { ac, seen } = running(t);
    const w = workers[0]!;
    w.reply({ status: "Solving…" });
    ac.abort();
    expect(pings(w)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.error).toMatchObject({ kind: "cancelled" });
    expect(t.status()).toMatchObject({ phase: "idle", message: "Solver stopped; it restarts on the next request." });
  });

  it("only stops the request it's told to: a finished one's signal does nothing", async () => {
    const { t, workers } = setup(true);
    const { ac } = running(t);
    const w = workers[0]!;
    w.reply({ status: "Solving…" });
    w.reply({ id: lastRequest(w).id, result: { street: "turn" } });
    running(t);
    ac.abort();
    expect(pings(w)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("WorkerTransport: a boot that goes quiet", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("starts the worker again once and sends the waiting request to the new one", async () => {
    const { t, workers } = setup(true);
    const p = t.request({ players: 2 }, { progressive: true });
    const first = lastRequest(workers[0]!);
    await vi.advanceTimersByTimeAsync(BOOT_STALL_MS - 1);
    expect(workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(t.status()).toMatchObject({ phase: "booting", message: expect.stringContaining("starting again") });
    const w = workers[1]!;
    expect(w.posted.some((m) => "stop" in m)).toBe(true); // (its own stop flag: the last one's went with it)
    expect(lastRequest(w)).toEqual(first);
    w.reply({ status: "Solving…", setup: { total: 1, core: true, threads: 4 } });
    w.reply({ id: first.id, result: { street: "flop" } });
    await expect(p).resolves.toEqual({ street: "flop" });
  });

  it("gives up on a second stall, says so, and the next request tries a fresh worker", async () => {
    const { t, workers } = setup(true);
    const p = t.request({ players: 2 }, { progressive: true });
    const failed = expect(p).rejects.toMatchObject({ kind: "boot-failed" });
    await vi.advanceTimersByTimeAsync(BOOT_STALL_MS * 2);
    await failed;
    expect(workers).toHaveLength(2);
    expect(workers[1]!.terminated).toBe(true);
    expect(t.status()).toMatchObject({ phase: "failed", error: expect.stringContaining("didn't start") });
    const again = t.request({ players: 2 }, { progressive: true });
    expect(workers).toHaveLength(3);
    const w = workers[2]!;
    w.reply({ status: "Solving…" });
    w.reply({ id: lastRequest(w).id, result: { street: "flop" } });
    await expect(again).resolves.toEqual({ street: "flop" });
  });

  it("leaves a slow boot alone while it keeps saying something", async () => {
    const { t, workers } = setup(true);
    void t.request({ players: 2 }, { progressive: true }).catch(() => {});
    for (const status of ["Loading the runtime", "Loading numpy", "Starting the solver"]) {
      await vi.advanceTimersByTimeAsync(BOOT_STALL_MS - 1);
      workers[0]!.reply({ status });
    }
    expect(workers).toHaveLength(1);
    workers[0]!.reply({ status: "Solving…" });
    await vi.advanceTimersByTimeAsync(BOOT_STALL_MS * 3); // (a long solve says nothing, and isn't a boot)
    expect(workers).toHaveLength(1);
    t.dispose();
  });

  it("waits less for a version this browser has booted before, and the long wait on the second try", async () => {
    const one = setup(true);
    one.t.boot();
    one.workers[0]!.reply({ status: "Solving…" });
    one.t.dispose();
    const { t, workers } = setup(true);
    t.boot();
    await vi.advanceTimersByTimeAsync(BOOT_STALL_KNOWN_MS);
    expect(workers).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(BOOT_STALL_MS - 1);
    expect(workers[1]!.terminated).toBe(false);
    t.dispose();
  });

  it("doesn't send on a request that was stopped while the worker was loading", async () => {
    const { t, workers } = setup(true);
    const ctl = new AbortController();
    const p = t.request({ players: 2 }, { progressive: true, signal: ctl.signal });
    const stopped = expect(p).rejects.toMatchObject({ kind: "cancelled" });
    ctl.abort();
    await vi.advanceTimersByTimeAsync(BOOT_STALL_MS);
    await stopped;
    expect(workers[1]!.posted.filter((m) => "state" in m)).toEqual([]);
    t.dispose();
  });

  it("stops watching a boot that failed by itself", async () => {
    const { t, workers } = setup(true);
    t.boot();
    workers[0]!.onerror?.({ message: "no network" } as ErrorEvent);
    await vi.advanceTimersByTimeAsync(BOOT_STALL_MS * 2);
    expect(workers).toHaveLength(1);
    expect(t.status()).toMatchObject({ phase: "failed", error: "no network" });
  });
});
