import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import { ComboPanel, eqr } from "./ComboPanel";

const COLORS = ["#111", "#222"];

// A Study answer's shape for one class (advisor.py _study_node): grid cells and combo rows
// [cards, reach, mix, EVs, equity, made, draw]
const RES: AdvisorResponse = {
  pot_bb: 10,
  grid: { actions: ["check", "bet 33%"], cells: { AKs: { w: 0.75, f: [0.4, 0.6], ev: [3, 5], evm: 4.2, eq: 0.6 } } },
  opponent_grid: { actions: ["check", "bet 33%"], cells: { AKs: { w: 0.5, f: [1, 0], eq: 0.4 } } },
  combos: {
    AKs: [
      ["AsKs", 1, [1, 0], [3, 5], 0.55, 0, 0],
      ["AhKh", 1, [0, 1], [3, 6], 0.65, 0, 0],
      ["AdKd", 0.5, [0.5, 0.5], [2, 4], 0.6, 0, 0],
    ],
  },
};

describe("ComboPanel", () => {
  it("computes equity realization as EV over equity times the pot", () => {
    expect(eqr(4.2, 0.6, 10)).toBeCloseTo(0.7);
    expect(eqr(undefined, 0.6, 10)).toBeUndefined();
    expect(eqr(4.2, 0, 10)).toBeUndefined();
  });

  it("shows the class's combos, EV, equity, EQR and mix, combos sorted by EV", () => {
    render(<ComboPanel cls="AKs" res={RES} colors={COLORS} opponent={false} />);
    expect(screen.getByText("3.00 of 4 combos")).toBeInTheDocument();
    expect(screen.getByText(/EQR 0\.70/)).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    // EVs of the mixes: AhKh 6, AsKs 3, AdKd 3 (ties keep their order)
    expect(rows.map((r) => r.textContent?.slice(0, 4))).toEqual(["AhKh", "AsKs", "AdKd"]);
    expect(rows[2]?.textContent).toContain("(50%)"); // reach below 1 is shown
  });

  it("sorts by reach when the answer has no EVs, and shows no combo table for the opponent", () => {
    const noEv: AdvisorResponse = {
      ...RES,
      combos: { AKs: [["AdKd", 0.5, [0.5, 0.5], null, null, 0, 0], ["AsKs", 1, [1, 0], null, null, 0, 0]] },
    };
    const { unmount } = render(<ComboPanel cls="AKs" res={noEv} colors={COLORS} opponent={false} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent?.slice(0, 4))).toEqual(["AsKs", "AdKd"]);
    expect(screen.queryByText("EV")).not.toBeInTheDocument();
    unmount();

    render(<ComboPanel cls="AKs" res={RES} colors={COLORS} opponent />);
    expect(screen.getByText("2.00 of 4 combos")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/EQR/)).not.toBeInTheDocument();
  });
});
