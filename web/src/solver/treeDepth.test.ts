// This device's tree cap and a spot's raise cap (engine/tree_depth.py): sent to the worker only where they differ from
// the engine's own, never to a local server (upstream has neither key), and said in the answer's provenance.
import { describe, expect, it } from "vitest";
import { SolverClient } from "./client";
import { describe as describeProvenance, provenanceOf } from "./provenance";
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { capWords, ENGINE_CELLS, peakMb, TREE_CAPS, treeWords, withTreeCap } from "./treeDepth";
import type { RuntimeStatus, SolverTransport } from "./types";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "v", partial: false, now: 1 };

describe("the tree cap", () => {
  it("goes to the worker only where it isn't the engine's 24M", () => {
    const st: AdvisorState = { players: 2, board: "Ks7d2c" };
    expect(withTreeCap(st, "standard", "worker")).toBe(st);
    expect(withTreeCap(st, "phone", "worker")).toEqual({ ...st, max_cells: 12_000_000 });
    expect(withTreeCap(st, "large", "worker")).toEqual({ ...st, max_cells: 32_000_000 });
    expect(TREE_CAPS.standard.cells).toBe(ENGINE_CELLS);
  });

  it("never goes to a local server, nor does a spot's raise cap: upstream has neither", () => {
    const st: AdvisorState = { players: 2, board: "Ks7d2c", raises: 4, max_cells: 1 };
    expect(withTreeCap(st, "large", "http")).toEqual({ players: 2, board: "Ks7d2c" });
    const plain: AdvisorState = { players: 2 };
    expect(withTreeCap(plain, "phone", "http")).toBe(plain);
  });

  it("says each cap's memory from the measured bytes a cell, smallest first", () => {
    expect(peakMb(TREE_CAPS.phone.cells)).toBeLessThan(peakMb(TREE_CAPS.standard.cells));
    expect(peakMb(TREE_CAPS.large.cells)).toBeLessThan(1200); // (the worker's heap is 2 GB, with the solves it keeps)
    expect(capWords("phone")).toMatch(/^12M cells, up to ~0\.\d GB$/);
  });

  it("is read as each request goes", async () => {
    const sent: AdvisorState[] = [];
    const t: SolverTransport = {
      kind: "worker",
      request: (state: AdvisorState) => {
        sent.push(state);
        return Promise.resolve({ street: "flop", solver: { iterations: 5 } } as AdvisorResponse);
      },
      stopCost: () => "kills",
      onStatus: () => () => {},
      status: () => ({ phase: "ready", transport: "worker", crossOriginIsolated: false }) as RuntimeStatus,
      dispose: () => {},
    };
    let cap: "phone" | "large" = "phone";
    const c = new SolverClient(t, "v", undefined, () => cap);
    await c.solve({ state: { players: 2, board: "Ks7d2c", study: true }, mode: "fast", untimed: true });
    cap = "large";
    await c.solve({ state: { players: 2, board: "Ks7d2c", study: true }, mode: "fast", untimed: true });
    expect(sent.map((s) => s.max_cells)).toEqual([12_000_000, 32_000_000]);
  });
});

describe("an answer's tree in words", () => {
  it("names the raise cap and the device's cap the engine says it solved under", () => {
    expect(treeWords(undefined)).toBeNull();
    expect(treeWords({})).toBeNull();
    expect(treeWords({ raises: 4 })).toBe("up to 4 bets and raises a street");
    expect(treeWords({ raises: 1, max_cells: 12_000_000 })).toBe("a bet a street, then all-in only, trees up to 12M cells");
  });

  it("goes into a live solve's provenance, beside the figure measured in that game, and nowhere else", () => {
    const live: AdvisorResponse = { street: "turn", tree: { raises: 3 }, solver: { iterations: 120, exploitability_pct: 0.4 } };
    const p = provenanceOf(live, ctx);
    expect(p.tree).toBe("up to 3 bets and raises a street");
    expect(describeProvenance(p)).toBe("Live solve · up to 3 bets and raises a street · 0.40% pot from equilibrium in the solved game (converged) · 120 iterations");
    // a library answer wasn't solved under it
    expect(provenanceOf({ street: "flop", precomputed: { spot: "srp" }, tree: { raises: 3 } }, ctx).tree).toBeUndefined();
  });
});
