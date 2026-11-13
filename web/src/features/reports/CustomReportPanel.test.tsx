// Your spot's flop report on the page: a Solve-page spot with no line gets a pot, then a set with its weights and a tier,
// then its run (kept, finished, drawn as the library's reports are, with its provenance), and the Saved page lists it.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/data/db";
import { listFlopReports } from "@/data/flopReports";
import { SavedPage } from "@/features/saved/SavedPage";
import { freshHand, toSearch } from "@/features/study/studyState";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { ReportsPage } from "./ReportsPage";

const ORDER = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const prov = (source: Provenance["source"]): Provenance => ({ source, approximate: false, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, exploitabilityPct: 0.25, iterations: 300 });

/** The stand-in engine: the charts preflop (folds, a 2.5bb open, a call), a flop's root and the nodes after it. */
function answer(state: AdvisorState): SolveResult<AdvisorResponse> {
  const line = state.preflop ?? [];
  if (!state.board) {
    const raised = line.some((a) => a.action === "raise");
    if (raised && line.at(-1)?.action === "call") return { data: { study: "deal", street: "flop" }, provenance: prov("charts") };
    const actor = ORDER[line.length]!;
    return {
      data: { study: "node", street: "preflop", actor, actions: [{ action: "fold", freq: 0.7 }, ...(raised ? [{ action: "call", freq: 0.2 }] : []), { action: "raise 2.5", amount_bb: 2.5, freq: 0.1 }] },
      provenance: prov("charts"),
    };
  }
  // (each flop's mix differs a little, by its high card, so the rows can be told apart)
  const hi = "23456789TJQKA".indexOf(state.board[0]!) / 12;
  if (!state.flop?.length)
    return {
      data: { study: "node", street: "flop", actor: "BB", opponent: "BTN", pot_bb: 5.5, range_ev_bb: 2 + hi, range_eq: 0.44, opponent_eq: 0.56, actions: [{ action: "check", freq: 0.8 - hi / 4 }, { action: "bet 33%", freq: 0.2 + hi / 4, amount_bb: 1.8 }] },
      provenance: prov("live"),
    };
  return { data: { study: "node", street: "flop", actor: "BTN", actions: [{ action: "check", freq: 0.5 }, { action: "bet 33%", freq: 0.5, amount_bb: 1.8 }] }, provenance: prov("live") };
}

const stub = vi.hoisted(() => ({ asked: [] as AdvisorState[], getSolver: null as unknown as () => Promise<unknown> }));
stub.getSolver = async () => ({
  solve: async (req: { state: AdvisorState }) => {
    stub.asked.push(req.state);
    return answer(req.state);
  },
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const where = () => new URLSearchParams(screen.getByTestId("where").textContent!.split("?")[1] ?? "");

beforeEach(async () => {
  stub.asked = [];
  await (await db())!.clear("flopReports");
});

describe("a flop report of a Solve-page spot", () => {
  it("picks a pot, shows the set's weights, solves each flop, keeps the report and draws it with its provenance", async () => {
    const spot = toSearch(freshHand(6, 100));
    render(
      <MemoryRouter initialEntries={[`/reports?mine=${encodeURIComponent(spot)}&from=solve`]}>
        <Routes>
          <Route path="/reports" element={<><ReportsPage /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    // no line yet: a pot to pick
    expect(await screen.findByText(/doesn't reach a flop yet\. Pick the pot below\./)).toBeInTheDocument();
    const pot = screen.getByRole("form", { name: "Pick the pot" });
    expect(within(pot).getByRole("combobox", { name: "Opener" })).toHaveValue("BTN");
    fireEvent.change(within(pot).getByRole("combobox", { name: "Opener" }), { target: { value: "CO" } });
    expect(within(pot).getByRole("combobox", { name: "Caller" })).toHaveValue("BB");
    fireEvent.click(within(pot).getByRole("button", { name: "Set this pot" }));
    expect(await screen.findByText("Heads-up on the flop: CO and BB.")).toBeInTheDocument();
    expect(new URLSearchParams(where().get("mine")!).get("pre")).toBe("UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c");

    // the set: 9 flops, each with its weight and how often it's dealt
    const form = screen.getByRole("form", { name: "Report setup" });
    fireEvent.click(within(form).getByRole("radio", { name: "9" }));
    fireEvent.click(within(form).getByText("The 9 flops and their weights"));
    const flops = within(form).getByRole("table", { name: "The flops of the set" });
    const rows = within(flops).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual(["9c8d3h", "QcTd7h", "AcTd9h", "AdAc2h", "Tc6d2c", "Qc7c3d", "KcTc8d", "AcQd4d", "AdAc7c"]);
    expect(within(rows[0]!).getAllByRole("cell")[3]).toHaveTextContent("11.11%");
    expect(within(rows[0]!).getAllByRole("cell")[2]).toHaveTextContent("0.11%");
    expect(within(form).getByRole("table", { name: /Each texture/ })).toHaveTextContent(/Rainbow/);
    fireEvent.click(within(form).getByRole("radio", { name: /Accurate/ }));
    fireEvent.click(within(form).getByRole("radio", { name: /Fast/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Solve 9 flops" }));

    // the run, to the end, kept
    await waitFor(() => expect(where().get("custom")).toBeTruthy());
    expect(await screen.findByText(/9 of the 9 flops solved at Fast.*; finished\./)).toBeInTheDocument();
    const { list } = await listFlopReports();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ from: "solve", mode: "fast", size: 9, status: "done", seats: ["BB", "CO"].includes(list[0]!.seats![0]) ? list[0]!.seats : null });
    expect(list[0]!.done).toHaveLength(9);
    expect(stub.asked.filter((s) => s.board && !s.flop?.length).every((s) => s.cache_mb === 256)).toBe(true);

    // drawn as the library's: every flop a row, the average, its EV, equity and EQR, and what it is
    expect(screen.getAllByRole("row").filter((r) => /^[2-9TJQKA][cdhs]/.test(r.getAttribute("aria-label") ?? ""))).toHaveLength(9);
    expect(screen.getByRole("row", { name: "Average" })).toHaveTextContent("All 9 flops solved");
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent).join("|")).toMatch(/EQR/);
    expect(screen.getByRole("button", { name: /flop report of your spot over 9 sampled flops of the solver's representative 9.*9 solved live at Fast.*; 300 iterations a flop · this flop model gave up 1\.9% pot on average/ })).toBeInTheDocument();
    // a texture filter narrows the rows
    fireEvent.change(screen.getByRole("combobox", { name: "Pairing" }), { target: { value: "paired" } });
    await waitFor(() => expect(screen.getAllByRole("row").filter((r) => /^[2-9TJQKA][cdhs]/.test(r.getAttribute("aria-label") ?? ""))).toHaveLength(2));
  });

  it("is listed on the Saved page, with how far it got, and opens on Reports", async () => {
    await (await db())!.put("flopReports", {
      id: "k1",
      name: "CO vs BB · 9 flops · Fast",
      spot: toSearch({ ...freshHand(6, 100), preflop: [{ pos: "UTG", action: "fold" }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "raise", to: 2.5 }, { pos: "BTN", action: "fold" }, { pos: "SB", action: "fold" }, { pos: "BB", action: "call" }] }),
      from: "solve",
      mode: "accurate",
      size: 9,
      flops: ["9c8d3h", "QcTd7h", "AcTd9h"],
      done: [{ f: "9c8d3h", w: 22100 / 9, nodes: { "": { names: ["check"], freqs: [1] } }, bets: {}, source: "live", approximate: false }],
      left: [],
      seats: ["BB", "CO"],
      pot: 5.5,
      status: "paused",
      note: "",
      createdAt: 1,
      updatedAt: 2,
    });
    render(
      <MemoryRouter>
        <SavedPage />
      </MemoryRouter>,
    );
    const row = await screen.findByRole("listitem", { name: "CO vs BB · 9 flops · Fast" });
    expect(row).toHaveTextContent("1 of 3 flops solved live at Accurate · paused, 2 to go");
    expect(row).toHaveTextContent(/CO raise 2\.5 · BB call/);
    expect(within(row).getByRole("link", { name: "Open CO vs BB · 9 flops · Fast" })).toHaveAttribute("href", "/reports?custom=k1");
  });
});
