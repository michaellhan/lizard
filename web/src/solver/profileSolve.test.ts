// The profile re-solve in the solver layer: its source and words (never an equilibrium, never "solved"), what's asked of
// the worker for Study and for Exploit practice, and what other backends get instead.
import { describe, expect, it } from "vitest";
import { NodeLockError, profileRouted, SolverClient } from "./client";
import type { AdvisorResponse, AdvisorState } from "./protocol";
import { PROFILE_ANSWER } from "./profileSolve.fixture";
import { describe as words, provenanceOf, sourceLabel, sourceOf } from "./provenance";
import { SolverError, type RuntimeStatus, type SolverTransport } from "./types";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 1 };

// Exploit practice's advice as engine/profile_solve.py advise_answer gives it
const ADVICE: AdvisorResponse = {
  street: "flop",
  hero: "BTN",
  villain: "BB",
  actions: [
    { action: "check", freq: 0.2, ev_bb: 3.1, gto_freq: 0.4, gto_ev: 3.0 },
    { action: "bet 75%", freq: 0.8, ev_bb: 3.4, gto_freq: 0.6, gto_ev: 3.2 },
  ],
  solver: { iterations: 300, exploitability_pct: 0.01 },
  locked: { BB: { fold: -20, bluff: -50, raise: -50 } },
  profile_solve: { seat: "BB", player: 0, adj: { fold: -20, bluff: -50, raise: -50 }, words: "BB folds -20 pts to bets, bluffs -50%, raises -50%", gain_pct: 0.01, iterations: 300, streets: ["flop"], label: "Exploit re-solve" },
  notes: ["profile re-solve: BB ... (not an equilibrium)"],
};

describe("the profile re-solve's source", () => {
  it("is its own, for Study's answer, its progress and practice's advice", () => {
    expect(sourceOf(PROFILE_ANSWER)).toBe("profile-solve");
    expect(sourceOf({ study: "profile_progress", street: "river" })).toBe("profile-solve");
    expect(sourceOf(ADVICE)).toBe("profile-solve");
  });

  it("says what it is, the profile, its convergence, and never the equilibrium or a solved game", () => {
    const p = provenanceOf(PROFILE_ANSWER, ctx);
    const said = words(p);
    expect(sourceLabel("profile-solve")).toBe("Exploit re-solve against an assumed profile (not an equilibrium)");
    expect(said).toContain("Exploit re-solve against an assumed profile (not an equilibrium)");
    expect(said).toContain("BTN folds -20 pts to bets, bluffs -50%, raises -50%, held at every decision of theirs and the rest re-solved");
    expect(said).toContain("The profile is held at every decision of BTN's in this street's solve");
    expect(said).toContain("0.0003% pot still gained by a best response to the profile (the re-solve's convergence)");
    expect(said).toContain("300 iterations");
    expect(said).not.toContain("solved game");
    expect(said).not.toContain("pot from equilibrium in");
    // (the ranges entering the river came from a turn solve stopped short: said, and so approximate)
    expect(said).toContain("the turn's narrowing solve stopped");
    expect(p.exploitabilityPct).toBe(PROFILE_ANSWER.solver!.exploitability_pct);
  });

  it("names practice's advice the re-solve, not the one-node best response its `locked` would say", () => {
    const said = words(provenanceOf(ADVICE, ctx));
    expect(said).toContain("BB folds -20 pts to bets, bluffs -50%, raises -50%, held at every decision of theirs and the rest re-solved");
    expect(said).toContain("re-solved on the flop");
    expect(said).not.toContain("not an equilibrium re-solve");
  });
});

class Fake implements SolverTransport {
  readonly kind: "worker" | "http";
  sent: AdvisorState[] = [];
  partial: AdvisorResponse[] = [];
  constructor(
    public reply: (s: AdvisorState) => AdvisorResponse,
    kind: "worker" | "http" = "worker",
  ) {
    this.kind = kind;
  }
  async request(state: AdvisorState, opts: { progressive: boolean; signal?: AbortSignal; onPartial?: (r: AdvisorResponse) => void }) {
    this.sent.push(state);
    for (const p of this.partial) opts.onPartial?.(p);
    if (opts.signal?.aborted) throw new SolverError("cancelled", "cancelled");
    return this.reply(state);
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

const STUDY: AdvisorState = { players: 6, board: "Kd7c2h5s9d", study: true };
const STATION = { fold: -20, bluff: -50, raise: -50 };

describe("SolverClient.profileSolve", () => {
  it("sends Study's state with the profile as the nodelock request, at the mode's budgets", async () => {
    const t = new Fake(() => PROFILE_ANSWER);
    const r = await new SolverClient(t, "v").profileSolve(STUDY, { seat: "BTN", adj: STATION, streets: "hand" }, { mode: "fast" });
    expect(t.sent[0]).toMatchObject({ study: true, nodelock: { profile: { seat: "BTN", adj: STATION, streets: "hand" } }, speed: "fast", budget: 8, prior_budget: 3 });
    expect(r.provenance.source).toBe("profile-solve");
    expect(r.data.profile_solve.values.exploit).toBeGreaterThan(r.data.profile_solve.values.eq_vs_profile);
  });

  it("hands progress on, and turns a refusal into its words", async () => {
    const t = new Fake(() => PROFILE_ANSWER);
    t.partial = [{ study: "profile_progress", street: "river", iterations: 128, of: 1000, exploitability_pct: 0.3, seconds: 1 }];
    const heard: unknown[] = [];
    await new SolverClient(t, "v").profileSolve(STUDY, { seat: "BTN", adj: "station" }, { onProgress: (p) => heard.push(p) });
    expect(heard).toEqual([expect.objectContaining({ street: "river", iterations: 128 })]);
    const refused = new SolverClient(new Fake(() => ({ error: "Profile re-solves are heads-up", lock_error: "refused" })), "v");
    const e = await refused.profileSolve(STUDY, { seat: "BTN", adj: "station" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NodeLockError);
    expect(e).toMatchObject({ lockKind: "refused", message: "Profile re-solves are heads-up" });
  });

  it("refuses a local server before asking it, and an answer without the re-solve is an error", async () => {
    const t = new Fake(() => PROFILE_ANSWER, "http");
    await expect(new SolverClient(t, "v").profileSolve(STUDY, { seat: "BTN", adj: "station" })).rejects.toThrow(/browser's solver/);
    expect(t.sent).toEqual([]);
    await expect(new SolverClient(new Fake(() => ({ study: "node" })), "v").profileSolve(STUDY, { seat: "BTN", adj: "station" })).rejects.toMatchObject({ kind: "solver-error" });
  });
});

describe("Exploit practice's requests (profileRouted)", () => {
  const PRACTICE: AdvisorState = { players: 6, hero: "BTN", hole: "AhKh", board: "Kd7s2c", locks: { BB: STATION }, profile_solve: true };

  it("on the worker, sends your advice to the profile re-solve and keeps the flag on their move", () => {
    expect(profileRouted(PRACTICE, "worker", false)).toEqual({ players: 6, hero: "BTN", hole: "AhKh", board: "Kd7s2c", nodelock: { profile: { seat: "BB", adj: STATION }, advise: true } });
    expect(profileRouted(PRACTICE, "worker", true)).toBe(PRACTICE);
  });

  it("elsewhere drops the flag (a local server's advice is the one-node best response), and leaves other states alone", () => {
    expect(profileRouted(PRACTICE, "http", false)).toEqual({ players: 6, hero: "BTN", hole: "AhKh", board: "Kd7s2c", locks: { BB: STATION } });
    const plain = { players: 6, board: "Kd7s2c" };
    expect(profileRouted(plain, "worker", false)).toBe(plain);
  });

  it("asks the worker the re-solve, and where it's refused asks the one-node best response, said so", async () => {
    const t = new Fake((s) => (s.nodelock ? { error: "No profile re-solve here: this pot isn't heads up against BB.", lock_error: "refused" } : { ...ADVICE, profile_solve: undefined }));
    const r = await new SolverClient(t, "v").solve({ state: PRACTICE, mode: "fast" });
    expect(t.sent).toHaveLength(2);
    expect(t.sent[0]!.nodelock).toEqual({ profile: { seat: "BB", adj: STATION }, advise: true });
    expect(t.sent[1]).toMatchObject({ locks: { BB: STATION } });
    expect(t.sent[1]!.profile_solve).toBeUndefined();
    expect(r.provenance.source).not.toBe("profile-solve");
    expect(r.data.notes?.[0]).toContain("no profile re-solve here");
  });

  it("a re-solve that answers is one request", async () => {
    const t = new Fake(() => ADVICE);
    const r = await new SolverClient(t, "v").solve({ state: PRACTICE, mode: "fast" });
    expect(t.sent).toHaveLength(1);
    expect(r.provenance.source).toBe("profile-solve");
  });
});
