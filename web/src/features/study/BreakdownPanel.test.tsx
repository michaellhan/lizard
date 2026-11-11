import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Breakdown } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import { SolverError, type Provenance } from "@/solver/types";
import { useSettings } from "@/state/settings";
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

  it("remembers Draws in Settings, for the next node", async () => {
    const { getSolver } = solver(() => ({ data: { breakdown: BD }, provenance: PROV }));
    await opened(getSolver);
    fireEvent.click(within(screen.getByRole("region", { name: "Hand categories" })).getByRole("button", { name: "Draws" }));
    expect(useSettings.getState().breakdownPart).toBe("draws");
    cleanup();
    await opened(getSolver);
    expect(within(screen.getByRole("region", { name: "Hand categories" })).getByRole("button", { name: "Flush draw" })).toBeTruthy();
    useSettings.getState().set({ breakdownPart: "made" });
  });

  it("shows what one action is made of, without the whole category's equity and EV", async () => {
    const { getSolver } = solver(() => ({ data: { breakdown: BD }, provenance: PROV }));
    await opened(getSolver);
    const cats = screen.getByRole("region", { name: "Hand categories" });
    const check = within(within(cats).getByRole("group", { name: "What an action is made of" })).getByRole("button", { name: "check" });
    fireEvent.click(check);
    const rows = within(cats).getAllByRole("row");
    expect(rows[1]!.textContent).toContain("7.7%"); // Set: 2.5 of the 32.5 combos that check
    expect(rows[2]!.textContent).toContain("92.3%");
    expect(within(cats).queryByRole("columnheader", { name: "Eq" })).toBeNull();
    expect(within(cats).queryByRole("columnheader", { name: "EV" })).toBeNull();
    fireEvent.click(check);
    expect(within(cats).getByRole("columnheader", { name: "Eq" })).toBeTruthy();
  });

  describe("value and bluff", () => {
    const RES = {
      breakdown: BD,
      categories: { made: [["set", "Set"], ["nothing", "No made hand"]], draws: [["fd", "Flush draw"], ["none", "No draw"]] },
      // bet 50%: AhAd 1 x 0.75 at 90% is value; 7h2d 1 x 0.25 at 20% is bluff: three quarters value
      combos: { AA: [["AhAd", 1, [0.25, 0.75], [0, 1], 0.9, 0, 1]], "72o": [["7h2d", 1, [0.75, 0.25], [0, 1], 0.2, 1, 1]] },
    };
    const pick = async (name: string, data: unknown = RES, provenance: Provenance = PROV) => {
      const { getSolver } = solver(() => ({ data, provenance }));
      await opened(getSolver);
      const cats = screen.getByRole("region", { name: "Hand categories" });
      fireEvent.click(within(within(cats).getByRole("group", { name: "What an action is made of" })).getByRole("button", { name }));
      return cats;
    };

    it("splits a bet by the answer's combos, says what the words mean, and keeps it under the provenance", async () => {
      const cats = await pick("bet 50%");
      const vb = within(cats).getByRole("group", { name: "Value and bluff" });
      expect(vb.textContent).toContain("75.0% value (0.8 combos)");
      expect(vb.textContent).toContain("25.0% bluff (0.3 combos)");
      expect(vb.textContent).toContain("over 50% equity against BTN's whole range");
      expect(within(cats).getByText(/Live solve/i)).toBeTruthy();
      expect(within(vb).getByRole("img", { name: /75\.0% value/ })).toBeTruthy();
    });

    it("adds how much of each category in the action is value", async () => {
      const cats = await pick("bet 50%");
      expect(within(cats).getByRole("columnheader", { name: "Value" })).toBeTruthy();
      expect(within(cats).getByRole("row", { name: /Set/ }).textContent).toContain("100%");
    });

    it("isn't there for a check, and says why", async () => {
      const cats = await pick("check");
      expect(within(cats).queryByRole("group", { name: "Value and bluff" })).toBeNull();
      expect(within(cats).getByText(/Value and bluff describe a bet or raise/)).toBeTruthy();
    });

    it("shows nothing on a rule fallback, and never a solved number", async () => {
      const cats = await pick("bet 50%", RES, { ...PROV, source: "rules" } as Provenance);
      expect(within(cats).queryByRole("group", { name: "Value and bluff" })).toBeNull();
      expect(within(cats).getByText(/the betting rules, not a solve/)).toBeTruthy();
    });

    it("shows nothing with no equities in the answer", async () => {
      const cats = await pick("bet 50%", { breakdown: BD });
      expect(within(cats).queryByRole("group", { name: "Value and bluff" })).toBeNull();
      expect(within(cats).getByText(/holds no equities/)).toBeTruthy();
    });
  });

  describe("blockers", () => {
    const NODE = {
      breakdown: BD,
      street: "river",
      actor: "BB",
      opponent: "BTN",
      opponent_combos: 2,
      categories: { made: [["set", "Set"]], draws: [] },
      actions: [{ action: "check" }, { action: "bet 50%", amount_bb: 3 }],
      combos: { AKo: [["AhKd", 1, [1, 0], [0, 0], 0.5, 0, 0], ["AsKc", 0.5, [1, 0], [0, 0], 0.5, 0, 0]] },
    };
    const NEXT = {
      study: "node",
      actor: "BTN",
      categories: { made: [["overpair", "Overpair"], ["nothing", "No made hand"]], draws: [] },
      grid: { actions: ["fold", "call"], cells: {} },
      combos: {
        // 2 combos, half folding; AhKd takes out AhAd, which calls: 1 of 2 combos, leaving only the fold
        AA: [["AhAd", 1, [0, 1], null, 0.9, 0, 0]],
        "65o": [["6s5h", 1, [1, 0], null, 0.1, 1, 0]],
      },
    };
    const twoAsks = (node: unknown = NODE, next: unknown = NEXT, provenance: Provenance = PROV) => {
      const solve = vi.fn((req: { state: { river: unknown[] } }) => Promise.resolve(req.state.river.length ? { data: next, provenance: { ...provenance, source: "library" } } : { data: node, provenance }));
      return { solve, getSolver: () => Promise.resolve({ solve } as unknown as SolverClient) };
    };

    it("asks for nothing more until a hand is picked, then the next node once, whatever the combo", async () => {
      const { solve, getSolver } = twoAsks();
      await opened(getSolver);
      const box = screen.getByRole("region", { name: "Blockers" });
      expect(box.textContent).toContain("Pick a hand");
      expect(solve).toHaveBeenCalledOnce();
      fireEvent.change(within(box).getByRole("combobox", { name: "Hand" }), { target: { value: "AKo" } });
      await act(async () => {});
      expect(solve).toHaveBeenCalledTimes(2);
      expect(solve.mock.calls[1]).toMatchObject([{ state: { breakdown: true, river: [{ pos: "BB", action: "bet", to: 3 }] }, mode: "fast" }]);
      fireEvent.change(within(box).getByRole("combobox", { name: "Combo" }), { target: { value: "AhKd" } });
      await act(async () => {});
      expect(solve).toHaveBeenCalledTimes(2);
    });

    it("shows what a combo takes out and how it moves the reply, under the next answer's provenance", async () => {
      const { getSolver } = twoAsks();
      await opened(getSolver);
      const box = screen.getByRole("region", { name: "Blockers" });
      fireEvent.change(within(box).getByRole("combobox", { name: "Hand" }), { target: { value: "AKo" } });
      await act(async () => {});
      fireEvent.change(within(box).getByRole("combobox", { name: "Combo" }), { target: { value: "AhKd" } });
      expect(box.textContent).toContain("takes out 1.0 of BTN's 2.0 combos (50.0%)");
      expect(box.textContent).toContain("continues 50.0% of the time, 0.0% with AhKd out (−50.0 points)");
      expect(box.textContent).toContain("Value it blocks: 1.0 of the 1.0 combos");
      expect(within(box).getByRole("table", { name: "Made hands it blocks" }).textContent).toContain("Overpair");
      expect(within(box).getByText(/Precomputed solution/)).toBeTruthy();
    });

    it("refuses a next answer whose range isn't this node's", async () => {
      const { getSolver } = twoAsks({ ...NODE, opponent_combos: 40 });
      await opened(getSolver);
      const box = screen.getByRole("region", { name: "Blockers" });
      fireEvent.change(within(box).getByRole("combobox", { name: "Hand" }), { target: { value: "AKo" } });
      await act(async () => {});
      expect(box.textContent).toContain("isn't the same range");
      expect(box.textContent).not.toContain("takes out");
    });

    it("says why not on a 3-way answer, without asking", async () => {
      const { solve, getSolver } = twoAsks({ ...NODE, breakdown: { ...BD, villains: [...BD.villains, { ...BD.villains[0]!, who: "SB" }] } });
      await opened(getSolver);
      expect(screen.getByRole("region", { name: "Blockers" }).textContent).toContain("3-way");
      expect(solve).toHaveBeenCalledOnce();
    });
  });

  it("says so where the rules answered", async () => {
    const { getSolver } = solver(() => ({ data: { breakdown: null }, provenance: PROV }));
    await opened(getSolver);
    expect(screen.getByText(/betting rules, not a solve/)).toBeTruthy();
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
    const chart = screen.getByRole("slider", { name: /Equity distribution/ });
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    act(() => chart.focus());
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    window.removeEventListener("keydown", seen);
    expect(screen.getByText(/Top 52% of each range/)).toBeTruthy();
    expect(chart.getAttribute("aria-valuetext")).toMatch(/^Top 52% of each range/);
    expect((seen.mock.calls[0]?.[0] as KeyboardEvent).defaultPrevented).toBe(true);
  });
});
