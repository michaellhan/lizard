import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareLinks, variantsOf } from "@/features/study/CompareLinks";
import { freshHand, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { ComparePage } from "./ComparePage";
import { compareLink } from "./compare";
import { diffLabel } from "./DiffMatrix";

// the solver stubbed: each request (kept in `stub.asked`) answers with `stub.answerFor` and `stub.provenanceFor` of it
const stub = vi.hoisted(() => {
  const s = {
    answerFor: (() => ({})) as (st: AdvisorState) => AdvisorResponse,
    provenanceFor: null as ((st: AdvisorState) => Partial<Provenance>) | null,
    asked: [] as AdvisorState[],
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const client = {
    solve: async ({ state }: { state: AdvisorState }): Promise<SolveResult> => (s.asked.push(state), {
      data: s.answerFor(state),
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
        ...s.provenanceFor?.(state),
      },
    }),
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

afterEach(() => {
  stub.asked = [];
  stub.provenanceFor = null;
});

const node = (bet: number, aa: number): AdvisorResponse => ({
  study: "node",
  street: "flop",
  actor: "BB",
  pot_bb: 10,
  range_combos: 400,
  range_ev_bb: 3 + bet,
  range_eq: 0.48,
  actions: [
    { action: "check", freq: 1 - bet, combos: 400 * (1 - bet), ev_bb: 3 },
    { action: "bet 33%", freq: bet, combos: 400 * bet, ev_bb: 4 },
  ],
  grid: {
    actions: ["check", "bet 33%"],
    cells: { AA: { w: 1, f: [1 - aa, aa], evm: 9 + aa }, KQs: { w: 1, f: [0.6, 0.4], evm: 4 } },
  },
});

const A: StudyHand = { ...freshHand(2, 100), board: "Ks7d2c", preflop: [], setup: { rake: 5, rakeCap: 3 } };
const B: StudyHand = { ...A, setup: undefined };

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ComparePage />
    </MemoryRouter>,
  );
}

describe("the Compare page", () => {
  it("asks A, then B, and shows how B differs: the actions, the range, each class", async () => {
    // A raked (bets 30%, AA 80%), B unraked (bets 40%, AA 90%)
    stub.answerFor = (st) => (st.rake ? node(0.3, 0.8) : node(0.4, 0.9));
    renderAt(compareLink(A, B));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(stub.asked.map((s) => s.rake ?? null)).toEqual([0.05, null]);
    expect(screen.getByLabelText("What differs")).toHaveTextContent("What differs: B drops: rake 5%, capped at 3bb.");
    const spots = screen.getByLabelText("Spots");
    expect(within(spots).getAllByText(/^Live solve · 0\.30% pot from equilibrium/)).toHaveLength(2);
    expect(within(spots).getAllByRole("link", { name: "Open in Study" }).map((l) => l.getAttribute("href"))).toEqual([`/study?${toSearch(A)}`, `/study?${toSearch(B)}`]);
    // the same source on both sides: no warning
    expect(screen.queryByLabelText("Warning")).toBeNull();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("check70.0% · EV 3.00bb60.0% · EV 3.00bb−10.0 points · EV +0.00bb");
    expect(rows[2]).toHaveTextContent("bet 33%30.0% · EV 4.00bb40.0% · EV 4.00bb+10.0 points · EV +0.00bb");
    expect(rows[3]).toHaveTextContent("The range400.0 combos · EV 3.30bb");
    expect(rows[3]).toHaveTextContent("EV +0.10bb");
    // EV changes within the two answers' distance from equilibrium (0.6% of 10bb) are noise
    expect(screen.getByText(/EV changes under 0\.06bb/)).toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "Change in check" });
    expect(within(grid).getByRole("gridcell", { name: "AA: check 20.0% → 10.0% (−10.0 points), EV +0.10bb" })).toBeInTheDocument();
    expect(within(grid).getByRole("gridcell", { name: "72o: in neither range" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Biggest differences")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["AA: 20.0% → 10.0% (−10.0 points), EV +0.10bb"]);
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "bet 33%" } });
    expect(screen.getByRole("grid", { name: "Change in bet 33%" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    expect(screen.getByText("AA: bet 33% 80.0% → 90.0% (+10.0 points), EV +0.10bb")).toBeInTheDocument();
  });

  it("warns first when the two sides come from different sources", async () => {
    stub.answerFor = () => node(0.3, 0.8);
    stub.provenanceFor = (st) => (st.stack === 100 ? { source: "library", exploitabilityPct: 0.2 } : {});
    renderAt(compareLink(B, { ...B, stack: 50 }));
    expect(await screen.findByLabelText("Warning")).toHaveTextContent(
      "The two sides come from different sources (A: Precomputed solution; B: Live solve), so a difference can be the source's, not the spot's.",
    );
    expect(screen.getByLabelText("What differs")).toHaveTextContent("stack 100bb → 50bb");
  });

  it("says when there's nothing to compare, and asks nothing for a setup that can't be solved", async () => {
    renderAt("/compare");
    expect(screen.getByText(/Nothing to compare/)).toBeInTheDocument();
    const { unmount } = renderAt(compareLink(B, { ...B, stack: 5 }));
    expect(screen.getByRole("alert")).toHaveTextContent("These setups can't be solved: B: the table's stack must be 10–250bb.");
    unmount();
    renderAt(compareLink(B, { ...B, setup: { rake: 40 } }));
    expect(screen.getByRole("alert")).toHaveTextContent("These setups can't be solved: B: the rake must be 0–25% of the pot.");
    await waitFor(() => expect(stub.asked).toEqual([]));
    expect(screen.getAllByText("Not asked.")).toHaveLength(2);
  });
});

describe("Study's Compare this spot links", () => {
  it("offers chip EV for a tournament, rake on or off postflop, and another stack", () => {
    const t: StudyHand = { ...freshHand(6, 25), setup: { tournament: { payouts: [50, 30, 20] } } };
    expect(variantsOf(t).map(([l, b]) => [l, b.setup])).toEqual([["in chip EV", undefined]]);
    expect(variantsOf(A).map(([l, b]) => [l, b.setup])).toEqual([["without rake", undefined]]);
    expect(variantsOf(B).map(([l, b]) => [l, b.setup])).toEqual([["with 5% rake, capped at 3bb", { rake: 5, rakeCap: 3 }]]);
    // preflop no rake is taken
    expect(variantsOf(freshHand(6, 100))).toEqual([]);

    render(
      <MemoryRouter>
        <CompareLinks hand={A} min={10} max={250} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Compare this spot" });
    const href = (name: string) => new URLSearchParams(within(nav).getByRole("link", { name }).getAttribute("href")!.split("?")[1]);
    expect(fromSearch(href("without rake").get("b")!)).toEqual(B);
    expect(fromSearch(href("compare").get("b")!)!.stack).toBe(50);
    expect(fromSearch(href("compare").get("a")!)).toEqual(A);
    fireEvent.change(screen.getByLabelText("Another stack"), { target: { value: "5" } });
    expect(within(nav).queryByRole("link", { name: "compare" })).toBeNull();
  });

  it("labels a grid cell in words", () => {
    expect(diffLabel(undefined, "AA", "check")).toBe("AA: in neither range");
    const only = { cls: "T9s", wa: 0, wb: 1, fa: null, fb: 0.5, dFreq: null, eva: null, evb: 2, dEv: null };
    expect(diffLabel(only, "T9s", "check")).toBe("T9s: only in B's range (check 50%)");
    expect(diffLabel({ ...only, wa: 1, wb: 0, fa: 0.5, fb: null }, "T9s", "check")).toBe("T9s: only in A's range (check 50%)");
  });
});
