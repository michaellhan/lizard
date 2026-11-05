import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Breakdown } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import { SolverError, type Provenance } from "@/solver/types";
import { BreakdownPanel } from "./BreakdownPanel";
import { freshHand } from "./studyState";

const PROV: Provenance = { source: "live", approximate: false, mode: "fast", transport: "worker", solverVersion: "test", iterations: 300, exploitabilityPct: 0.2 } as Provenance;
const BD: Breakdown = {
  actions: ["check", "bet 50%"],
  pot: 6,
  hero: {
    who: "BB",
    combos: 300,
    made: [
      { id: "set", label: "Set", c: 10, eq: 0.95, f: [0.25, 0.75], ev: 8 },
      { id: "nothing", label: "No made hand", c: 30, eq: 0.2, f: [1, 0], ev: 0.5 },
    ],
    draws: [{ id: "fd", label: "Flush draw", c: 12, eq: 0.4, f: [0.5, 0.5], ev: 2 }],
    eq: 0.46,
    nuts: 0.12,
    curve: [1, 0.5, 0],
    ev: 2.5,
  },
  villains: [{ who: "BTN", combos: 200, made: [{ id: "set", label: "Set", c: 8, eq: 0.96 }], draws: [], eq: 0.54, nuts: 0.2, curve: [1, 0.6, 0], ev: 3.5 }],
  nut_eq: 0.8,
  runouts: [1, 1],
};

const hand = { ...freshHand(2, 100), board: "Ks7d2c5h9d" };
const solver = (answer: () => unknown) => {
  const solve = vi.fn(() => Promise.resolve(answer()));
  return { solve, getSolver: () => Promise.resolve({ solve } as unknown as SolverClient) };
};
const opened = async (getSolver: () => Promise<SolverClient>, onFilter = vi.fn()) => {
  render(<BreakdownPanel hand={hand} mode="fast" open onOpen={() => {}} evUnit="bb" getSolver={getSolver} onFilter={onFilter} />);
  await act(async () => {});
};

describe("BreakdownPanel", () => {
  it("asks nothing until it's opened", async () => {
    const { solve, getSolver } = solver(() => ({ data: { breakdown: BD }, provenance: PROV }));
    render(<BreakdownPanel hand={hand} mode="fast" open={false} onOpen={() => {}} evUnit="bb" getSolver={getSolver} onFilter={() => {}} />);
    await act(async () => {});
    expect(solve).not.toHaveBeenCalled();
  });

  it("asks the node with the breakdown flag, and shows categories, equity and the advantages under its provenance", async () => {
    const { solve, getSolver } = solver(() => ({ data: { breakdown: BD }, provenance: PROV }));
    await opened(getSolver);
    expect(solve).toHaveBeenCalledOnce();
    expect(solve.mock.calls[0]).toMatchObject([{ state: { breakdown: true, study: true, board: "Ks7d2c5h9d" }, mode: "fast" }]);
    const cats = screen.getByRole("region", { name: "Hand categories" });
    const row = within(cats).getByRole("row", { name: /Set/ });
    expect(row.textContent).toContain("25.0%"); // (10 of the 40 combos in the made rows)
    expect(row.textContent).toContain("95%");
    expect(row.textContent).toContain("8.00");
    const eq = screen.getByRole("region", { name: "Equity distribution" });
    expect(eq.textContent).toContain("BTN has the range advantage (54.0% equity).");
    expect(eq.textContent).toContain("BTN has the nut advantage: 8.0 points");
    expect(eq.textContent).toContain("on the river, no cards to come");
    expect(screen.getByText(/Live solve/i)).toBeTruthy();
  });

  it("shows the other range's make-up, with no EV and no mix of its own", async () => {
    const { getSolver } = solver(() => ({ data: { breakdown: BD }, provenance: PROV }));
    await opened(getSolver);
    const cats = screen.getByRole("region", { name: "Hand categories" });
    fireEvent.click(within(within(cats).getByRole("group", { name: "Whose range" })).getByRole("button", { name: "BTN" }));
    expect(within(cats).getByText(/isn't the one to act/)).toBeTruthy();
    expect(within(cats).queryByRole("columnheader", { name: "EV" })).toBeNull();
  });

  it("turns to the draws, and offers a picked category in the grid by its filter key", async () => {
    const { getSolver } = solver(() => ({ data: { breakdown: BD }, provenance: PROV }));
    const onFilter = vi.fn();
    await opened(getSolver, onFilter);
    const cats = screen.getByRole("region", { name: "Hand categories" });
    fireEvent.click(within(cats).getByRole("button", { name: "Draws" }));
    fireEvent.click(within(cats).getByRole("button", { name: "Flush draw" }));
    fireEvent.click(within(cats).getByRole("button", { name: "Show these hands in the grid" }));
    expect(onFilter).toHaveBeenCalledWith("d:fd");
  });

  it("says so where the rules answered", async () => {
    const { getSolver } = solver(() => ({ data: { breakdown: null }, provenance: PROV }));
    await opened(getSolver);
    expect(screen.getByText(/answered by the betting rules/)).toBeTruthy();
  });

  it("says what went wrong", async () => {
    const { getSolver } = solver(() => {
      throw new SolverError("solver-error", "the solver broke");
    });
    await opened(getSolver);
    expect(screen.getByText(/broke|solver/i)).toBeTruthy();
  });

  it("reads the lines from the keyboard, without moving along the hand", async () => {
    const { getSolver } = solver(() => ({ data: { breakdown: BD }, provenance: PROV }));
    await opened(getSolver);
    const chart = screen.getByRole("img", { name: /Equity distribution/ });
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    act(() => chart.focus());
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    window.removeEventListener("keydown", seen);
    expect(screen.getByText(/Top 52% of each range/)).toBeTruthy();
    expect((seen.mock.calls[0]?.[0] as KeyboardEvent).defaultPrevented).toBe(true);
  });
});
