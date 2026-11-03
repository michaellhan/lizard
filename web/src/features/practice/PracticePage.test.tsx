import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import { describe as describeProvenance } from "@/solver/provenance";
import type { PlayRequest, Provenance, SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";

import { optionLabel, PracticePage } from "./PracticePage";

const prov = (source: Provenance["source"], extra: Partial<Provenance> = {}): Provenance => ({
  source,
  approximate: source === "charts",
  mode: "quick",
  transport: "worker",
  solverVersion: "test",
  partial: false,
  receivedAt: 0,
  ...extra,
});
const LIVE = prov("live", { exploitabilityPct: 0.4, band: "converged" });

// preflop: the chart's answer (no EVs); on the flop: a solve with EVs
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
    { action: "bet 33%", freq: 0.6, ev_bb: 2.2, amount_bb: 1.6 },
  ],
};

// the solver stubbed: your spot answered by street, the big blind calls, checks the flop, folds to a bet
const stub = vi.hoisted(() => {
  const s = {
    calls: [] as string[],
    getSolver: null as unknown as () => Promise<unknown>,
    answer: (st: AdvisorState): SolveResult => ({ data: st.board ? FLOP : CHART, provenance: st.board ? LIVE : prov("charts") }),
  };
  const client = {
    solve: async ({ state }: { state: AdvisorState }) => {
      s.calls.push(`advise ${state.hero} ${state.board || "preflop"}`);
      return s.answer(state);
    },
    play: async (state: AdvisorState, p: PlayRequest): Promise<SolveResult<PlayMove>> => {
      s.calls.push(`play ${p.seat}`);
      const flop = (state.flop as unknown[] | undefined) ?? [];
      const action: PlayMove["action"] = !state.board ? "call" : flop.length === 0 ? "check" : "fold";
      return { data: { pos: p.seat, action, name: action, freq: 1, street: "flop" }, provenance: LIVE };
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

afterEach(() => {
  stub.calls = [];
  useSettings.setState({ mode: "fast" });
});

describe("PracticePage", () => {
  it("plays a hand: your options are the solver's, each move graded with its answer's source; the pot to the winner", async () => {
    render(<PracticePage pace={0} />);
    // heads-up, the first hand from the button (the small blind): you act first
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    const options = await screen.findByRole("group", { name: "Your options" });
    expect(within(options).getAllByRole("button").map((b) => b.textContent)).toEqual(["fold", "call", "raise 2.5"]);
    expect(screen.getByRole("listitem", { name: "BTN/SB (you)" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(options).getByRole("button", { name: "raise 2.5" }));

    // graded by frequency (the chart), with the chart's provenance
    let last = await screen.findByRole("region", { name: "Last decision" });
    expect(within(last).getByText("Best")).toBeInTheDocument();
    expect(within(last).getByText(/Graded by how often the chart plays it/)).toBeInTheDocument();
    expect(within(last).getByText(describeProvenance(prov("charts")))).toBeInTheDocument();

    // the big blind calls and checks the flop; you bet, it folds
    const flop = await screen.findByRole("group", { name: "Your options" });
    expect(within(flop).getAllByRole("button").map((b) => b.textContent)).toEqual(["check", "bet 33% (1.6bb)"]);
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    fireEvent.click(within(flop).getByRole("button", { name: "bet 33% (1.6bb)" }));
    last = screen.getByRole("region", { name: "Last decision" });
    expect(within(last).getByText("Best")).toBeInTheDocument();
    expect(within(last).getByText(/^No EV given up\. This hand mixes actions here\.$/)).toBeInTheDocument();
    expect(within(last).getByText(describeProvenance(LIVE))).toBeInTheDocument();
    expect(within(last).getByRole("row", { name: /bet 33% \(1\.6bb\) ← you 60\.0% 2\.20/ })).toBeInTheDocument();

    // 2.5bb each preflop, your 1.5bb bet not called: you win the 5bb pot, +2.5bb
    expect(await screen.findByText("You won")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You won 2.5bb");
    const score = screen.getByRole("region", { name: "Score" });
    expect(within(score).getByText("+2.5bb")).toBeInTheDocument();
    expect(within(score).getByText("100%")).toBeInTheDocument();
    // one request a decision: yours (advice) and the big blind's (a move)
    // (from the heads-up hand: the 6-max hand dealt on load may have asked for its first move)
    const mine = stub.calls.slice(stub.calls.indexOf("advise SB preflop"));
    expect(mine.map((c) => c.replace(/([2-9TJQKA][shdc]){3}$/, "<flop>"))).toEqual([
      "advise SB preflop",
      "play BB",
      "play BB",
      "advise SB <flop>",
      "play BB",
    ]);
    expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent(/preflop: You raise to 2\.5, BB calls/);
    expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent(/flop \[.. .. ..\]: BB checks, You bet 1\.5, BB folds/);

    // the next hand: your seat moves to the big blind
    fireEvent.click(screen.getByRole("button", { name: "Next hand" }));
    expect(await screen.findByRole("listitem", { name: "BB (you)" })).toBeInTheDocument();
  });

  it("offers the moves without a grade where your spot has no answer", async () => {
    const answer = stub.answer;
    stub.answer = () => {
      throw new Error("the solve failed");
    };
    try {
      render(<PracticePage pace={0} />);
      fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      const moves = await screen.findByRole("group", { name: "Moves without a grade" });
      expect(screen.getByText(/No answer to grade this spot against: the solve failed/)).toBeInTheDocument();
      expect(within(moves).getAllByRole("button").map((b) => b.textContent)).toEqual(["fold", "call 0.5", "raise to 2", "all-in 100"]);
      fireEvent.click(within(moves).getByRole("button", { name: "fold" }));
      expect(await screen.findByText("Not graded")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("You folded · −0.5bb");
      expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent("preflop: You fold");
    } finally {
      stub.answer = answer;
    }
  });

  it("labels a size the solver's name doesn't say", () => {
    expect(optionLabel("bet 33%", 1.8)).toBe("bet 33% (1.8bb)");
    expect(optionLabel("raise 2.5", 2.5)).toBe("raise 2.5");
    expect(optionLabel("check", undefined)).toBe("check");
  });
});
