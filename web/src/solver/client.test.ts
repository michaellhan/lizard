import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMode, effectiveMode, SolverClient } from "./client";
import { HttpTransport } from "./http-transport";
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { SolverError, type PlayRequest, type RuntimeStatus, type SolverTransport } from "./types";
import { WorkerTransport } from "./worker-transport";

/** A transport whose requests the test answers by hand. */
class FakeTransport implements SolverTransport {
  readonly kind = "worker" as const;
  calls: { state: AdvisorState; resolve: (r: AdvisorResponse) => void; signal?: AbortSignal; play?: PlayRequest; progressive: boolean }[] = [];
  disposed = false;
  request(
    state: AdvisorState,
    opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void; play?: PlayRequest },
  ) {
    return new Promise<AdvisorResponse>((resolve, reject) => {
      opts.onPartial?.({ street: "turn", solver: { iterations: 1 } });
      opts.signal?.addEventListener("abort", () => reject(new SolverError("cancelled", "cancelled")));
      this.calls.push({ state, resolve, signal: opts.signal, play: opts.play, progressive: opts.progressive });
    });
  }
  stopCost() {
    return "kills" as const;
  }
  onStatus(cb: (s: RuntimeStatus) => void) {
    cb(this.status());
    return () => {};
  }
  status(): RuntimeStatus {
    return { phase: "ready", transport: "worker", crossOriginIsolated: false };
  }
  dispose() {
    this.disposed = true;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("SolverClient", () => {
  it("measures a live answer unless it's told that one isn't the player's", async () => {
    const t = new FakeTransport();
    const c = new SolverClient(t, "test");
    localStorage.removeItem("lizard.solveTimes.v1");
    const live = { street: "flop" as const, seconds: 1.25, solver: { iterations: 10 } };
    const a = c.solve({ state: { players: 2, board: "Ks7d2c" }, mode: "fast", untimed: true });
    await tick();
    t.calls[0]!.resolve(live);
    await a;
    expect(localStorage.getItem("lizard.solveTimes.v1")).toBeNull();
    const b = c.solve({ state: { players: 2, board: "Ks7d2c" }, mode: "fast" });
    await tick();
    t.calls[1]!.resolve(live);
    await b;
    expect(localStorage.getItem("lizard.solveTimes.v1")).not.toBeNull();
    localStorage.removeItem("lizard.solveTimes.v1");
  });

  it("maps modes onto the Advisor's keys, with the classic app's budgets for the backend", () => {
    expect(applyMode({ players: 2, board: "Ks7d2c" }, "quick")).toEqual({
      players: 2, board: "Ks7d2c", quick: true, speed: "fast", budget: 1.5, prior_budget: 0.3,
    });
    expect(applyMode({ players: 2, board: "Ks7d2c8h5s" }, "quick")).toMatchObject({ quick: true, budget: 0.8 });
    // preflop Quick: no quick key (the Advisor's quick is postflop), the Quick budget
    expect(applyMode({ players: 2 }, "quick")).toEqual({ players: 2, speed: "fast", budget: 1.5, prior_budget: 0.3 });
    expect(applyMode({ players: 2, quick: true }, "accurate")).toEqual({ players: 2, speed: "accurate", budget: 60, prior_budget: 12 });
    expect(applyMode({ players: 2 }, "fast")).toMatchObject({ budget: 8, prior_budget: 3 });
    expect(applyMode({ players: 2 }, "fast", "http")).toMatchObject({ budget: 2.5, prior_budget: 2.5 });
    expect(applyMode({ players: 2 }, "accurate", "http")).toMatchObject({ budget: 30, prior_budget: 12 });
    expect(applyMode({ players: 2, board: "Ks 7d 2c 8h 5s" }, "quick")).toMatchObject({ quick: true, budget: 0.8 });
    // a Study request never carries quick: Quick runs it at Fast
    const study = applyMode({ players: 2, board: "Kh7d2c", study: true }, "quick");
    expect(study).not.toHaveProperty("quick");
    expect(study).toMatchObject({ speed: "fast", budget: 8, prior_budget: 3 });
    expect(effectiveMode({ study: true }, "quick")).toBe("fast");
    expect(effectiveMode({}, "quick")).toBe("quick");
  });

  it("runs one request at a time, in order, with provenance on partials and answers", async () => {
    const t = new FakeTransport();
    const c = new SolverClient(t, "test");
    const partials: string[] = [];
    const a = c.solve({ state: { players: 2, board: "a" }, mode: "fast", onPartial: (p) => partials.push(p.provenance.source) });
    const b = c.solve({ state: { players: 2, board: "b" }, mode: "accurate" });
    await tick();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.state).toMatchObject({ board: "a", speed: "fast", budget: 8, prior_budget: 3 });
    t.calls[0]!.resolve({ street: "turn", solver: { iterations: 10 } });
    const ra = await a;
    expect(ra.provenance).toMatchObject({ source: "live", mode: "fast", solverVersion: "test", partial: false });
    expect(partials).toEqual(["live"]);
    await tick();
    expect(t.calls).toHaveLength(2);
    t.calls[1]!.resolve({ street: "preflop" });
    expect((await b).provenance.source).toBe("charts");
  });

  it("drops a queued request when its signal aborts, without touching the running one", async () => {
    const t = new FakeTransport();
    const c = new SolverClient(t, "test");
    const first = c.solve({ state: { players: 2 } });
    const ac = new AbortController();
    const second = c.solve({ state: { players: 3 }, signal: ac.signal });
    ac.abort();
    await expect(second).rejects.toMatchObject({ kind: "cancelled" });
    await tick();
    t.calls[0]!.resolve({ street: "preflop" });
    await expect(first).resolves.toBeTruthy();
    await tick();
    expect(t.calls).toHaveLength(1);
  });

  it("passes an abort through to the running request, then serves the next", async () => {
    const t = new FakeTransport();
    const c = new SolverClient(t, "test");
    const ac = new AbortController();
    const first = c.solve({ state: { players: 2 }, signal: ac.signal });
    const next = c.solve({ state: { players: 3 } });
    await tick();
    ac.abort();
    await expect(first).rejects.toBeInstanceOf(SolverError);
    await tick();
    expect(t.calls).toHaveLength(2);
    t.calls[1]!.resolve({ street: "preflop" });
    await expect(next).resolves.toBeTruthy();
  });

  it("rejects everything queued on dispose", async () => {
    const t = new FakeTransport();
    const c = new SolverClient(t, "test");
    void c.solve({ state: { players: 2 } }).catch(() => {});
    const queued = c.solve({ state: { players: 3 } });
    c.dispose();
    await expect(queued).rejects.toMatchObject({ kind: "cancelled" });
    expect(t.disposed).toBe(true);
  });

  it("asks for an opponent's move at the mode's budgets, in the queue like any request, never progressive", async () => {
    const t = new FakeTransport();
    const c = new SolverClient(t, "test");
    const mv = c.play({ players: 2, hero: "SB", hole: "AhKd", board: "Ks7d2c" }, { seat: "BB", hole: "QcQd" }, { mode: "quick" });
    await tick();
    expect(t.calls[0]).toMatchObject({ play: { seat: "BB", hole: "QcQd" }, progressive: false, state: { quick: true, budget: 1.5 } });
    t.calls[0]!.resolve({ pos: "BB", action: "check", name: "check", freq: 0.6, street: "flop" });
    await expect(mv).resolves.toMatchObject({ data: { pos: "BB", action: "check" }, provenance: { mode: "quick" } });
  });
});

describe("stopCost", () => {
  const worker = (crossOriginIsolated: boolean) => {
    const createWorker = vi.fn();
    const c = new SolverClient(new WorkerTransport({ assetBase: "/s/", version: "v", libraryBase: "/l/", crossOriginIsolated, createWorker }), "test");
    return { c, createWorker };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is cheap over HTTP: the server stops the solve and stays up", () => {
    expect(new SolverClient(new HttpTransport({ url: "http://127.0.0.1:8765" }), "test").stopCost()).toBe("cheap");
  });

  it("is cheap on an isolated worker, and known before one has started", () => {
    const { c, createWorker } = worker(true);
    expect(c.stopCost()).toBe("cheap");
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("kills an unisolated worker: it has to be ended", () => {
    expect(worker(false).c.stopCost()).toBe("kills");
  });

  it("kills an isolated worker where the browser has no SharedArrayBuffer: there's no flag to share", () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    expect(worker(true).c.stopCost()).toBe("kills");
  });

  it("asks the transport it has", () => {
    expect(new SolverClient(new FakeTransport(), "test").stopCost()).toBe("kills");
  });
});
