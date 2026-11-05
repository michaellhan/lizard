// Compare EV: per class one action's EV minus another's, the classes where each is worth most more, and the
// equilibrium check (a class taking both should be near zero); and Study's panel for it.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";
import { EvGapPanel } from "./EvGapPanel";
import { evGaps, hasActionEvs, mixing, widest } from "./evgap";

const NODE: AdvisorResponse = {
  study: "node",
  street: "flop",
  actor: "BB",
  pot_bb: 10,
  actions: [
    { action: "check", freq: 0.6, combos: 6, ev_bb: 3 },
    { action: "bet 75%", freq: 0.4, combos: 4, ev_bb: 4, rough_ev: true },
  ],
  grid: {
    actions: ["check", "bet 75%"],
    cells: {
      // AA bets: worth 1.5bb more; KQs mixes: 0.02 apart; 72o checks: betting loses 0.8; 65s isn't in the range
      AA: { w: 1, f: [0, 1], ev: [8, 9.5] },
      KQs: { w: 1, f: [0.5, 0.5], ev: [4, 4.02] },
      "72o": { w: 0.5, f: [1, 0], ev: [0.3, -0.5] },
      "65s": { w: 0, f: [0, 0], ev: [0, 0] },
    },
  },
};

describe("two actions' EV per class", () => {
  it("is offered only where every action has an EV per class", () => {
    expect(hasActionEvs(NODE)).toBe(true);
    expect(hasActionEvs({ ...NODE, grid: { ...NODE.grid!, cells: { AA: { w: 1, f: [1, 0], ev: null } } } })).toBe(false);
    expect(hasActionEvs({ ...NODE, grid: { actions: ["check"], cells: { AA: { w: 1, f: [1], ev: [1] } } } })).toBe(false);
  });

  it("gives each class in the range the first EV minus the second, and is the negative the other way round", () => {
    const g = evGaps(NODE, "bet 75%", "check");
    expect(g.map((x) => x.cls)).toEqual(["AA", "KQs", "72o"]);
    expect(g[0]).toMatchObject({ ex: 9.5, ey: 8, d: 1.5, fx: 1, fy: 0 });
    expect(g[2]!.d).toBeCloseTo(-0.8);
    expect(evGaps(NODE, "check", "bet 75%").map((x) => x.d)).toEqual(g.map((x) => -x.d!));
    expect(evGaps(NODE, "check", "fold")).toEqual([]);
  });

  it("lists where each is worth most more, and checks the classes taking both", () => {
    const g = evGaps(NODE, "bet 75%", "check");
    expect(widest(g, 1).map((x) => x.cls)).toEqual(["AA", "KQs"]);
    expect(widest(g, -1).map((x) => x.cls)).toEqual(["72o"]);
    const m = mixing(g);
    expect(m.n).toBe(1);
    expect(m.meanAbs).toBeCloseTo(0.02);
    expect(mixing(g, 0.6)).toEqual({ n: 0, meanAbs: null });
  });
});

describe("Study's two actions' EV", () => {
  it("names a filter on, as its numbers are that filter's", () => {
    const p: Provenance = { source: "live", approximate: false, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0 };
    const seen = render(<EvGapPanel res={NODE} provenance={p} evUnit="bb" />);
    fireEvent.click(screen.getByRole("button", { name: "Compare two actions' EV" }));
    expect(screen.queryByText(/alone, not the whole range/)).toBeNull();
    seen.unmount();
    render(<EvGapPanel res={{ ...NODE, filter: { key: "q:25", label: "25–50% equity", of: 12 } }} provenance={p} evUnit="bb" />);
    fireEvent.click(screen.getByRole("button", { name: "Compare two actions' EV" }));
    expect(within(screen.getByRole("region", { name: "Two actions' EV" })).getByText("These numbers are over 25–50% equity alone, not the whole range.")).toBeInTheDocument();
  });

  it("opens on the two actions taken most, swaps, and carries the rough-EV caveat and the equilibrium check", () => {
    const p: Provenance = { source: "live", approximate: false, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, exploitabilityPct: 0.5 };
    render(<EvGapPanel res={NODE} provenance={p} evUnit="bb" />);
    fireEvent.click(screen.getByRole("button", { name: "Compare two actions' EV" }));
    const panel = screen.getByRole("region", { name: "Two actions' EV" });
    expect(within(panel).getByRole("grid", { name: "EV of check minus bet 75%" })).toBeInTheDocument();
    expect(within(panel).getByText(/≈ bet 75% is taken by almost none of the range here/)).toBeInTheDocument();
    expect(within(panel).getByText(/1 class takes both at least 5% of the time; its gap is 0\.02bb in size/)).toBeInTheDocument();
    // noise: 0.5% of the 10bb pot
    expect(within(panel).getByText(/Gaps under 0\.05bb/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Swap" }));
    expect(within(panel).getByRole("gridcell", { name: "AA: bet 75% − check = +1.50bb (bet 75% 9.50bb, check 8.00bb; takes them 100% and 0%)" })).toBeInTheDocument();
    expect(within(panel).getByRole("gridcell", { name: "65s: not in the range" })).toBeInTheDocument();
    expect(within(panel).getByRole("gridcell", { name: /^KQs: bet 75% − check = \+0\.02bb, noise \(/ })).toBeInTheDocument();
    expect(within(within(panel).getByLabelText("Where bet 75% is worth most more")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "AA +1.50bb (takes it 100%)",
      "KQs +0.02bb (takes it 50%)",
    ]);
    expect(within(within(panel).getByLabelText("Where check is worth most more")).getByRole("listitem")).toHaveTextContent("72o +0.80bb (takes it 100%)");
  });

  it("isn't offered without every action's EV per class", () => {
    const p: Provenance = { source: "charts", approximate: true, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0 };
    const { container } = render(<EvGapPanel res={{ ...NODE, grid: { ...NODE.grid!, cells: { AA: { w: 1, f: [1, 0] } } } }} provenance={p} evUnit="bb" />);
    expect(container).toBeEmptyDOMElement();
  });
});
