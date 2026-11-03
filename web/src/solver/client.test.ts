import { describe, expect, it } from "vitest";
import { applyMode, SolverClient } from "./client";
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { SolverError, type RuntimeStatus, type SolverTransport } from "./types";

/** A transport whose requests the test answers by hand. */
class FakeTransport implements SolverTransport {
  readonly kind = "worker" as const;
  calls: { state: AdvisorState; resolve: (r: AdvisorResponse) => void; signal?: AbortSignal }[] = [];
  disposed = false;
  request(state: AdvisorState, opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void }) {
    return new Promise<AdvisorResponse>((resolve, reject) => {
      opts.onPartial?.({ street: "turn", solver: { iterations: 1 } });
      opts.signal?.addEventListener("abort", () => reject(new SolverError("cancelled", "cancelled")));
      this.calls.push({ state, resolve, signal: opts.signal });
    });
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
});
