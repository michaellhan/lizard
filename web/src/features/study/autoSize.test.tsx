// Automatic sizing (ROADMAP Phase 6): one hand's advice with the engine's optimize_sizes, the first solve's menu and the
// sizes kept shown with their source, and the kept menu offered on the Compare page against this spot's.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { describe as describeProvenance, provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import type { SolveRequest, SolveResult } from "@/solver/types";
import { autoSizeRequest, keptMenu, offersAutoSize, usageOf } from "./autoSize";
import { AutoSizePanel } from "./AutoSizePanel";
import { freshHand, studyRequest, type StudyHand } from "./studyState";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 1 };

const NODE: AdvisorResponse = {
  study: "node",
  street: "river",
  actor: "SB",
  opponent: "BB",
  pot_bb: 5,
  actions: [{ action: "check" }, { action: "bet 50%" }, { action: "bet 100%" }],
  grid: { actions: ["check", "bet 50%", "bet 100%"], cells: { AQo: { w: 1, f: [1, 0, 0] } } },
  combos: { AQo: [["AhQd", 1, [1, 0, 0], null, null, 0, 0]] },
};
// the engine's answer with optimize_sizes (a probe of advisor.py at this river: Ks7d2c5h9s checked to SB, AhQd)
const OPT: AdvisorResponse = {
  street: "river",
  hero: "SB",
  villain: "BB",
  pot_bb: 5,
  actions: [
    { action: "check", freq: 1, ev_bb: 2.45 },
    { action: "bet 25%", freq: 0, ev_bb: 2.18, rough_ev: true },
    { action: "bet 33%", freq: 0, ev_bb: 2.33, rough_ev: true },
    { action: "bet 50%", freq: 0, ev_bb: 2.43 },
  ],
  size_usage: { check: 0.314, "25%": 0.046, "33%": 0.225, "50%": 0.211, "75%": 0.125, "100%": 0.067, "150%": 0.011, "200%": 0 },
  sizes_kept: ["25%", "33%", "50%"],
  range_action_freq: { check: 0.495, "bet 25%": 0, "bet 33%": 0.009, "bet 50%": 0.496 },
  solver: { iterations: 1000, exploitability_pct: 0.03 },
  notes: ["river: bet sizes chosen by a first solve over 25%, 33%, 50%, 75%, 100%, 150%, 200%: kept 25%, 33%, 50% (used by 3%+ of a range)"],
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

describe("automatic sizing", () => {
  it("is offered where the player to act can bet, heads-up after the flop, and asked as one hand's advice", () => {
    expect(offersAutoSize(NODE)).toBe(true);
    expect(offersAutoSize({ ...NODE, actions: [{ action: "fold" }, { action: "call" }, { action: "raise 50%" }] })).toBe(false);
    expect(offersAutoSize({ ...NODE, multiway: true })).toBe(false);
    expect(offersAutoSize({ ...NODE, street: "preflop" })).toBe(false);
    const st = autoSizeRequest(studyRequest(HAND), "SB", "AhQd");
    expect(st).not.toHaveProperty("study");
    expect(st).toMatchObject({ hero: "SB", hole: "AhQd", optimize_sizes: true, river: [{ pos: "BB", action: "check" }] });
  });

  it("reads the first solve's menu and the sizes kept, and labels the answer's sizes as chosen", () => {
    const u = usageOf(OPT)!;
    expect(u.check).toBe(0.314);
    expect(u.rows.map((r) => [r.size, r.kept])).toEqual([
      ["25%", true],
      ["33%", true],
      ["50%", true],
      ["75%", false],
      ["100%", false],
      ["150%", false],
      ["200%", false],
    ]);
    expect(usageOf({ ...OPT, sizes_kept: undefined, size_usage: undefined })).toBeNull();
    expect(keptMenu(["25%", "33%", "50%"])).toEqual([25, 33, 50]);
    expect(keptMenu(["50%", "all-in"])).toBeNull();
    const p = provenanceOf(OPT, ctx);
    expect(p.sizing).toBe("river bet sizes 25%, 33%, 50% chosen by a first solve over a wide menu (one street deep, one raise)");
    expect(describeProvenance(p)).toBe(
      "Live solve · river bet sizes 25%, 33%, 50% chosen by a first solve over a wide menu (one street deep, one raise) · 0.03% pot from equilibrium in the solved game (converged) · 1000 iterations",
    );
    expect(provenanceOf({ ...OPT, sizes_kept: undefined }, ctx).sizing).toBeUndefined();
  });

  it("asks once and shows the menu, the hand and range at the kept sizes, and the comparison with this spot's menu", async () => {
    const asked: AdvisorState[] = [];
    const client = {
      solve: async ({ state }: SolveRequest): Promise<SolveResult> => {
        asked.push(state);
        return { data: OPT, provenance: provenanceOf(OPT, ctx) };
      },
    } as unknown as SolverClient;
    render(
      <MemoryRouter>
        <AutoSizePanel hand={HAND} res={NODE} cls="AQo" mode="fast" getSolver={async () => client} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Choose bet sizes (automatic sizing)"));
    const form = screen.getByRole("form", { name: "Automatic sizing" });
    expect(within(form).getByLabelText("Hand")).toHaveValue("AhQd");
    fireEvent.click(within(form).getByRole("button", { name: "Choose sizes" }));
    const answer = await screen.findByRole("region", { name: "Sizes chosen" });
    expect(asked.map((s) => [s.hero, s.hole, s.optimize_sizes])).toEqual([["SB", "AhQd", true]]);
    expect(answer).toHaveTextContent("river bet sizes 25%, 33%, 50% chosen by a first solve over a wide menu");
    expect(answer).toHaveTextContent("Kept: 25%, 33%, 50%");
    const wide = within(within(answer).getByRole("table", { name: "The wide menu" })).getAllByRole("row");
    expect(wide[1]).toHaveTextContent("check31.4%");
    expect(wide[3]).toHaveTextContent("33%22.5%kept");
    expect(wide[5]).toHaveTextContent("75%12.5%");
    expect(wide[5]).not.toHaveTextContent("kept");
    const kept = within(within(answer).getByRole("table", { name: "At the kept sizes" })).getAllByRole("row");
    expect(kept[2]).toHaveTextContent("bet 25%0.0% · EV ≈2.18bb0.0%");
    expect(kept[4]).toHaveTextContent("bet 50%0.0% · EV 2.43bb49.6%");
    // this spot's river menu is the answer's 50/100; B is the spot with the kept sizes for the river
    const link = within(answer).getByRole("link", { name: "compare the kept sizes with this spot's" });
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain("sz.river=25%2C33%2C50");
  });
});
