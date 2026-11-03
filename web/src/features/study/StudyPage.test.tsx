import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdvisorResponse } from "@/solver/protocol";
import type { SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";

import { StudyPage } from "./StudyPage";

// the solver stubbed: every request answers with `stub.answer` (a Study node), labelled as a live solve. (One stable
// getSolver, as the real hook's useCallback: StudyPage re-requests when it changes.)
const stub = vi.hoisted(() => {
  const s = { answer: {} as AdvisorResponse, getSolver: null as unknown as () => Promise<unknown> };
  const client = {
    solve: async (): Promise<SolveResult> => ({
      data: s.answer,
      provenance: {
        source: "live",
        approximate: false,
        mode: "fast",
        transport: "worker",
        solverVersion: "test",
        partial: false,
        receivedAt: 0,
        exploitabilityPct: 0.3,
        band: "converged",
        iterations: 300,
      },
    }),
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

const cell = (eq: number) => ({ w: 1, f: [0.5, 0.5], ev: [2, 4], evm: 3, eq });

// a 3-way flop node (advisor.py _study_mw: "opponents" per seat)
const THREE_WAY: AdvisorResponse = {
  study: "node",
  street: "flop",
  actor: "BB",
  multiway: true,
  opponent: "CO and BTN",
  pot_bb: 8,
  actions: [
    { action: "check", freq: 0.5, combos: 10, ev_bb: 2 },
    { action: "bet 33%", amount_bb: 2.64, freq: 0.5, combos: 10, ev_bb: 4 },
  ],
  grid: { actions: ["check", "bet 33%"], cells: { AA: cell(0.8), KK: cell(0.6) } },
  combos: {
    AA: [["AsAh", 1, [0.5, 0.5], [2, 4], 0.8, 0, 0]],
    KK: [["KsKh", 1, [0.5, 0.5], [2, 4], 0.6, 1, 0]],
  },
  categories: { made: [["set", "Set"], ["overpair", "Overpair"], ["middle", "Middle pair"]], draws: [["none", "No draw"]] },
  opponents: [
    { seat: "CO", combos: 120, eq: 0.3, grid: { actions: ["in range"], cells: { QQ: { w: 1, f: [1], eq: 0.3 } } } },
    { seat: "BTN", combos: 140, eq: 0.31, grid: { actions: ["in range"], cells: { JJ: { w: 1, f: [1], eq: 0.31 } } } },
  ],
  range_combos: 12,
  range_eq: 0.4,
};

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/study?${search}`]}>
      <StudyPage />
    </MemoryRouter>,
  );
}

afterEach(() => useSettings.setState({ evUnit: "bb" }));

describe("StudyPage", () => {
  it("shows one toggle per opponent in a 3-way answer, and each one's grid", async () => {
    stub.answer = THREE_WAY;
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h");
    const group = await screen.findByRole("group", { name: "Whose range" });
    const toggles = within(group).getAllByRole("button");
    expect(toggles.map((b) => b.textContent)).toEqual(["BB", "CO", "BTN"]);
    expect(screen.getByRole("grid", { name: "BB range" })).toBeInTheDocument();
    fireEvent.click(toggles[1]!);
    expect(screen.getByRole("grid", { name: "CO range" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^QQ: 100% in range/ })).toBeInTheDocument();
    expect(screen.getByText(/120\.0 combos · equity 30\.0%/)).toBeInTheDocument();
    fireEvent.click(toggles[2]!);
    expect(screen.getByRole("grid", { name: "BTN range" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^JJ: 100% in range/ })).toBeInTheDocument();
  });

  it("filters the grid and the totals to one hand category", async () => {
    stub.answer = THREE_WAY;
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h");
    const select = await screen.findByRole("combobox", { name: "Show only the hands of one category" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["All hands", "Set · 8.3%", "Overpair · 8.3%"]);
    fireEvent.change(select, { target: { value: "m:set" } });
    expect(screen.getByRole("grid", { name: "BB range (Set)" })).toBeInTheDocument();
    expect(screen.getByText(/Set: 1\.0 of 12\.0 combos/)).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^AA: 17% in range/ })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "KK: not in range" })).toBeInTheDocument();
  });

  it("shows every EV in % of the pot when Settings say so", async () => {
    stub.answer = { ...THREE_WAY, opponents: undefined };
    useSettings.setState({ evUnit: "pot" });
    renderAt("p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h");
    // action buttons: 2bb and 4bb of an 8bb pot
    expect(await screen.findByText("50.0% · 10.0 combos · EV 25.0% pot")).toBeInTheDocument();
    expect(screen.getByText("50.0% · 10.0 combos · EV 50.0% pot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    // the class panel: its EV (3bb), each action's and the combos'
    expect(screen.getByText(/^EV 37\.5% pot$/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "EV % pot" })).toBeInTheDocument();
  });

  it("starts a new hand at any table size from 2 to 9 and any stack from 10 to 250bb", async () => {
    stub.answer = { study: "node", street: "preflop", actor: "UTG", actions: [], grid: { actions: [], cells: {} } };
    renderAt("p=6&s=100");
    const form = await screen.findByRole("form", { name: "New hand" });
    const players = within(form).getByRole("combobox", { name: "Players" });
    expect(within(players).getAllByRole("option")).toHaveLength(8);
    const stack = within(form).getByRole("spinbutton", { name: "Stack in big blinds" });
    fireEvent.change(stack, { target: { value: "300" } });
    expect(within(form).getByRole("button", { name: "New hand" })).toBeDisabled();
    fireEvent.change(stack, { target: { value: "37.5" } });
    fireEvent.change(players, { target: { value: "9" } });
    fireEvent.click(within(form).getByRole("button", { name: "New hand" }));
    expect(await screen.findByText("9-max 37.5bb")).toBeInTheDocument();
  });

  it("focuses one action from the legend: the others are drawn empty", async () => {
    stub.answer = { ...THREE_WAY, opponents: undefined };
    renderAt("p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h");
    const legend = await screen.findByRole("group", { name: "Show one action" });
    fireEvent.click(within(legend).getByRole("button", { name: /bet 33%/ }));
    expect(within(legend).getByRole("button", { name: /bet 33%/ })).toHaveAttribute("aria-pressed", "true");
    const aa = screen.getByRole("gridcell", { name: /^AA:/ });
    // the check share is drawn empty (outlined), the bet's filled
    const bars = [...aa.querySelectorAll<HTMLDivElement>("div > div")];
    expect(bars.map((b) => b.className.includes("border-y"))).toEqual([true, false]);
    fireEvent.click(within(legend).getByRole("button", { name: "All actions" }));
    expect(within(legend).getByRole("button", { name: /bet 33%/ })).toHaveAttribute("aria-pressed", "false");
  });
});
