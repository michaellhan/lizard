// The node lock's request, answer and words in the solver layer: what's asked of the worker, what its refusals become,
// and a label that never calls the answer the equilibrium.
import { describe, expect, it, vi } from "vitest";
import { NodeLockError, SolverClient } from "./client";
import type { AdvisorResponse, AdvisorState, NodeLockRequest } from "./protocol";
import { ANSWER, BLOCK } from "./nodeLock.fixture";
import { describe as words, provenanceOf, sourceLabel, sourceOf } from "./provenance";
import { SolverError, type RuntimeStatus, type SolverTransport } from "./types";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 1 };

describe("the node-lock source", () => {
  it("names the answer and its partials a node lock, whatever else they carry", () => {
    expect(sourceOf(ANSWER)).toBe("node-lock");
    expect(sourceOf({ study: "nodelock_progress", street: "flop" })).toBe("node-lock");
    expect(sourceOf({ ...ANSWER, precomputed: { spot: "srp" } })).toBe("node-lock");
  });

  it("says the restricted game, the lock, the abstraction and its own exploitability, and never just the equilibrium", () => {
    const p = provenanceOf(ANSWER, ctx);
    const said = words(p);
    expect(sourceLabel("node-lock")).toBe("Node-locked equilibrium of the restricted game, not the unlocked equilibrium");
    expect(said).toContain("Node-locked equilibrium of the restricted game, not the unlocked equilibrium");
    expect(said).toContain("BTN holds check 50.0%, bet 33% 50.0% (whole range)");
    expect(said).toContain("Below it the turn is played as one card per class");
    expect(said).toContain("0.07% pot exploitable in the restricted game, each player's best response keeping their own locks (converged)");
    expect(said).toContain("300 iterations");
    expect(said).not.toContain("from equilibrium");
    expect(said).not.toContain("solved game");
    expect(said.replace("not the unlocked equilibrium", "")).not.toMatch(/\bthe equilibrium\b/);
  });

  it("leaves the best response's words as they were", () => {
    const p = provenanceOf({ street: "river", solver: { iterations: 10, exploitability_pct: 1 }, locked: { BB: { fold: 15 } } }, ctx);
    expect(words(p)).toContain("best response to BB");
    expect(words({ ...p, source: "best-response" })).toContain("1.00% pot from equilibrium in the solve it's laid on");
  });

  it("says approximate where the solver does", () => {
    const p = provenanceOf({ ...ANSWER, solver: { ...ANSWER.solver, approximate: true } }, ctx);
    expect(p.approximate).toBe(true);
    expect(words(p)).toContain("(approximate, target 0.2%)");
  });
});

class Fake implements SolverTransport {
  readonly kind: "worker" | "http";
  sent: AdvisorState[] = [];
  partial: AdvisorResponse[] = [];
  constructor(
    public reply: () => AdvisorResponse | Promise<AdvisorResponse>,
    kind: "worker" | "http" = "worker",
  ) {
    this.kind = kind;
  }
  async request(state: AdvisorState, opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void }) {
    this.sent.push(state);
    for (const p of this.partial) opts.onPartial?.(p);
    if (opts.signal?.aborted) throw new SolverError("cancelled", "cancelled");
    return this.reply();
  }
  stopCost() {
    return "cheap" as const;
  }
  onStatus(cb: (s: RuntimeStatus) => void) {
    cb(this.status());
    return () => {};
  }
  status(): RuntimeStatus {
    return { phase: "ready", transport: "worker", crossOriginIsolated: false };
  }
  dispose() {}
}

const STATE: AdvisorState = { players: 6, board: "Kd7c2h", study: true };
const LOCK: NodeLockRequest = { mix: { check: 0.5, "bet 33%": 0.5 }, hands: "all", expect: { actor: "BTN", actions: ["check", "bet 33%", "bet 75%"] } };

describe("SolverClient.nodeLock", () => {
  it("sends Study's state at the mode's budgets with the lock on it, and answers with its provenance", async () => {
    const t = new Fake(() => ANSWER);
    const r = await new SolverClient(t, "v").nodeLock(STATE, LOCK, { mode: "fast" });
    expect(t.sent[0]).toMatchObject({ study: true, board: "Kd7c2h", nodelock: LOCK, speed: "fast", budget: 8, prior_budget: 3 });
    expect(r.data.node_lock.line).toEqual(["check"]);
    expect(r.provenance.source).toBe("node-lock");
    expect(r.provenance.lock).toBe(BLOCK.words);
  });

  it("asks Quick's Study mode at Fast, as Study's own solve is", async () => {
    const t = new Fake(() => ANSWER);
    await new SolverClient(t, "v").nodeLock(STATE, LOCK, { mode: "quick" });
    expect(t.sent[0]!.speed).toBe("fast");
    expect(t.sent[0]!.quick).toBeUndefined();
  });

  it("hands progress on", async () => {
    const t = new Fake(() => ANSWER);
    t.partial = [{ study: "nodelock_progress", iterations: 300, of: 1000, exploitability_pct: 0.4, seconds: 2 }];
    const heard = vi.fn();
    await new SolverClient(t, "v").nodeLock(STATE, LOCK, { mode: "fast", onProgress: heard });
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ iterations: 300, of: 1000 }));
  });

  it("turns LockError and LockRefused into their words", async () => {
    const invalid = new SolverClient(new Fake(() => ({ error: "frequencies must sum to 1", lock_error: "invalid" })), "v");
    const e1 = await invalid.nodeLock(STATE, LOCK).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(NodeLockError);
    expect(e1).toMatchObject({ lockKind: "invalid", kind: "bad-request", message: "frequencies must sum to 1" });
    const refused = new SolverClient(new Fake(() => ({ error: "not these actions", lock_error: "refused", live_actions: ["check", "bet 50%"] })), "v");
    const e2 = await refused.nodeLock(STATE, LOCK).catch((e: unknown) => e);
    expect(e2).toMatchObject({ lockKind: "refused", actions: ["check", "bet 50%"] });
  });

  it("refuses a local server in words, before asking it: it would answer plain advice", async () => {
    const t = new Fake(() => ANSWER, "http");
    await expect(new SolverClient(t, "v").nodeLock(STATE, LOCK)).rejects.toThrow(/runs in the browser's solver/);
    expect(t.sent).toEqual([]);
  });

  it("cancels as a solve does", async () => {
    const ac = new AbortController();
    const t = new Fake(() => ({ cancelled: true }));
    ac.abort();
    await expect(new SolverClient(t, "v").nodeLock(STATE, LOCK, { signal: ac.signal })).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("an answer with no lock in it is an error, not an empty result", async () => {
    await expect(new SolverClient(new Fake(() => ({ study: "node" })), "v").nodeLock(STATE, LOCK)).rejects.toMatchObject({ kind: "solver-error" });
  });
});
