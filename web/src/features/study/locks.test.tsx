// Node locks (ROADMAP Phase 6): the read as the engine's "locks" (exploit.py's keys, bounds and words), one hand's
// advice asked at equilibrium and against the read, and the answer always labelled the best response with the GTO
// frequency beside it.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { describe as describeProvenance, provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import type { SolveRequest, SolveResult } from "@/solver/types";
import { describeLock, lockOf, lockRequest, offersLock, presetOf } from "./locks";
import { holesOf, LockPanel } from "./LockPanel";
import { freshHand, studyRequest, type StudyHand } from "./studyState";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 1 };

// Study's answer at a heads-up river (SB to act after BB checks): AQo in the range
const NODE: AdvisorResponse = {
  study: "node",
  street: "river",
  actor: "SB",
  opponent: "BB",
  pot_bb: 5,
  grid: { actions: ["check", "bet 50%", "bet 100%"], cells: { AQo: { w: 1, f: [1, 0, 0] }, KK: { w: 0.5, f: [0, 0, 1] } } },
  combos: {
    AQo: [
      ["AhQd", 1, [1, 0, 0], null, null, 0, 0],
      ["AsQc", 0.5, [1, 0, 0], null, null, 0, 0],
      ["AdQh", 0, [1, 0, 0], null, null, 0, 0],
    ],
    KK: [["KhKd", 0.5, [0, 0, 1], null, null, 0, 0]],
  },
};
// one hand's advice (advisor.py _advise_at): at equilibrium, and against BB folding 15 points more (the engine's shape)
const GTO: AdvisorResponse = {
  street: "river",
  hero: "SB",
  villain: "BB",
  pot_bb: 5,
  actions: [
    { action: "check", freq: 1, ev_bb: 2.65 },
    { action: "bet 50%", freq: 0, ev_bb: 2.4 },
    { action: "bet 100%", freq: 0, ev_bb: 2.5 },
  ],
  range_action_freq: { check: 0.6, "bet 50%": 0.15, "bet 100%": 0.25 },
  grid: { actions: ["check", "bet 50%", "bet 100%"], cells: { AQo: { w: 1, f: [1, 0, 0] }, KK: { w: 0.5, f: [0, 0, 1] } } },
  solver: { iterations: 1000, exploitability_pct: 0.03 },
  notes: [],
};
const BR: AdvisorResponse = {
  ...GTO,
  actions: [
    { action: "check", freq: 0, ev_bb: 2.65, gto_freq: 1 },
    { action: "bet 50%", freq: 0, ev_bb: 2.4, gto_freq: 0 },
    { action: "bet 100%", freq: 1, ev_bb: 2.8, gto_freq: 0 },
  ],
  range_action_freq: { check: 0.389, "bet 50%": 0.16, "bet 100%": 0.45 },
  grid: { actions: ["check", "bet 50%", "bet 100%"], cells: { AQo: { w: 1, f: [0, 0, 1] }, KK: { w: 0.5, f: [0, 0, 1] } } },
  locked: { BB: { fold: 15 } },
  notes: ["locked: BB folds +15 pts to bets (on GTO); the advice is your best response to that, and EVs assume you keep best-responding on later streets"],
};

const HAND: StudyHand = {
  ...freshHand(2, 100),
  board: "Ks7d2c5h9s",
  preflop: [
    { pos: "SB", action: "raise", to: 2.5 },
    { pos: "BB", action: "call" },
  ],
  river: [{ pos: "BB", action: "check" }],
};

describe("a read on the opponent", () => {
  it("is the engine's keys within their bounds, zero profile values dropped, in the engine's words", () => {
    expect(lockOf({ fold: "15", bluff: "", next_fold: "0" })).toEqual({ lock: { fold: 15, next_fold: 0 }, problems: [] });
    expect(lockOf({ fold: "0", bet: " " })).toEqual({ lock: null, problems: [] });
    expect(lockOf({ fold: "150", bluff: "lots", next_bet: "-5" }).problems).toEqual(["Folds to bets must be -100 to 100", "Bluffs: a number", "Next: bets must be 0 to 100"]);
    expect(describeLock({ fold: 15, bluff: -50, next_fold: 40 })).toBe("folds +15 pts to bets, bluffs -50%, folds 40% to your next bet");
    expect(presetOf({ fold: 15 })).toBe("overfolder");
    expect(presetOf({ fold: -20, bluff: -50, raise: -50 })).toBe("station");
    expect(presetOf({ fold: 15, bluff: 1 })).toBeNull();
  });

  it("is offered at a heads-up node after the flop, and asked as one hand's advice", () => {
    expect(offersLock(NODE)).toBe(true);
    expect(offersLock({ ...NODE, street: "preflop" })).toBe(false);
    expect(offersLock({ ...NODE, multiway: true })).toBe(false);
    expect(offersLock({ ...NODE, opponent: undefined })).toBe(false);
    const st = lockRequest(studyRequest(HAND), "SB", "AhQd", "BB", { fold: 15 });
    expect(st).not.toHaveProperty("study");
    expect(st).toMatchObject({ hero: "SB", hole: "AhQd", board: "Ks7d2c5h9s", locks: { BB: { fold: 15 } }, river: [{ pos: "BB", action: "check" }] });
    expect(lockRequest(studyRequest(HAND), "SB", "AhQd", "BB", null)).not.toHaveProperty("locks");
    // the hands of the class picked (in the range, heaviest first), else of the heaviest class
    expect(holesOf(NODE, "AQo")).toEqual(["AhQd", "AsQc"]);
    expect(holesOf(NODE, null)).toEqual(["AhQd", "AsQc"]);
    expect(holesOf(NODE, "KK")).toEqual(["KhKd"]);
  });

  it("labels a locked answer the best response, never an equilibrium", () => {
    const p = provenanceOf(BR, ctx);
    expect(p.lock).toBe("best response to BB folds +15 pts to bets, not an equilibrium re-solve");
    expect(describeProvenance(p)).toBe("Live solve · best response to BB folds +15 pts to bets, not an equilibrium re-solve · 0.03% pot from equilibrium in the solved game (converged) · 1000 iterations");
    expect(provenanceOf(GTO, ctx).lock).toBeUndefined();
  });

  it("asks the hand at equilibrium, then against the read, and shows both with the label", async () => {
    const asked: AdvisorState[] = [];
    const client = {
      solve: async ({ state }: SolveRequest): Promise<SolveResult> => {
        asked.push(state);
        const data = state.locks ? BR : GTO;
        return { data, provenance: provenanceOf(data, ctx) };
      },
    } as unknown as SolverClient;
    render(<LockPanel hand={HAND} res={NODE} cls="AQo" mode="fast" getSolver={async () => client} />);
    fireEvent.click(screen.getByText("Against a read (node lock)"));
    const form = screen.getByRole("form", { name: "The read" });
    // the overfolder preset to start with
    expect(within(form).getByLabelText("Preset")).toHaveValue("overfolder");
    expect(within(form).getByLabelText("Folds to bets ±")).toHaveValue("15");
    expect(within(form).getByLabelText("Hand")).toHaveValue("AhQd");
    fireEvent.change(within(form).getByLabelText("Folds to bets ±"), { target: { value: "500" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Folds to bets must be -100 to 100.");
    expect(within(form).getByRole("button", { name: "Ask" })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Preset"), { target: { value: "overfolder" } });
    fireEvent.click(within(form).getByRole("button", { name: "Ask" }));
    const answer = await screen.findByRole("region", { name: "Best response to the read" });
    expect(asked.map((s) => [s.hero, s.hole, s.locks ?? null, "study" in s])).toEqual([
      ["SB", "AhQd", null, false],
      ["SB", "AhQd", { BB: { fold: 15 } }, false],
    ]);
    expect(answer).toHaveTextContent("best response to BB folds +15 pts to bets, not an equilibrium re-solve");
    const rows = within(answer).getAllByRole("row");
    expect(rows[3]).toHaveTextContent("bet 100%100.0% · EV 2.80bb0.0%45.0%25.0%");
    expect(rows[1]).toHaveTextContent("check0.0% · EV 2.65bb100.0%38.9%60.0%");
    expect(within(answer).getByRole("grid", { name: "Change in any bet or raise" })).toBeInTheDocument();
    expect(within(answer).getByText(/^locked: BB folds \+15 pts to bets/)).toBeInTheDocument();
  });
});
