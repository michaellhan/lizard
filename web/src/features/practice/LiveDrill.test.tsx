// A live drill in the page, on entries of the solver snapshot's library with a stubbed solver: the spot shown at once, the
// options with the answer, a pick graded under a live solve's provenance, what's refused said in words with nothing scored,
// and a saved stored drill's link still the stored drill.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentSessions } from "@/data/db";
import { listMistakes } from "@/data/mistakes";
import { deleteDrill, listDrills } from "@/data/saved";
import { LibraryFiles } from "@/library/files";
import { seeded } from "@/poker/table";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import { SolverError, type SolveMode, type SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { libFile } from "@/test/library";
import { DrillsPanel } from "./DrillsPanel";

type Req = { state: AdvisorState; mode: SolveMode; signal: AbortSignal };
const stub = vi.hoisted(() => {
  const s = {
    solve: null as unknown as (req: Req) => Promise<SolveResult>,
    asked: [] as Req[],
    // (one function, as the hook's is: the page solves once a deal)
    getSolver: async () => ({
      solve: (req: Req) => {
        s.asked.push(req);
        return s.solve(req);
      },
    }),
  };
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

const fakeFetch = (async (url: string) => {
  try {
    return new Response(new Uint8Array(libFile(String(url).replace(/^lib\//, "").split("?")[0]!)));
  } catch {
    return new Response("missing", { status: 404 });
  }
}) as unknown as typeof fetch;
const open = (q: string) =>
  render(
    <MemoryRouter initialEntries={[`/practice?tab=drills&${q}`]}>
      <DrillsPanel files={new LibraryFiles("lib/", fakeFetch)} rng={seeded(3)} />
    </MemoryRouter>,
  );
const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "abc", partial: false };
const RIVER: AdvisorResponse = {
  street: "river",
  pot_bb: 9.5,
  to_call_bb: 0,
  actions: [
    { action: "check", freq: 0.98, ev_bb: 3 },
    { action: "bet 75%", freq: 0.02, ev_bb: 1, amount_bb: 7 },
  ],
  solver: { iterations: 111, exploitability_pct: 0.63 },
};
const answer = (data: AdvisorResponse) => async () => ({ data, provenance: provenanceOf(data, ctx) });
const options = () => screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
const decisions = () => within(screen.getByRole("region", { name: "Score" })).getByText("Decisions").nextSibling;

beforeEach(() => {
  stub.asked.length = 0;
  stub.solve = answer(RIVER);
  useSettings.setState({ mode: "quick" });
});
afterEach(cleanup);

describe("a live drill", () => {
  it("shows the river and the spot at once, solves at Fast though Quick is set, and grades by the solve's EVs under its provenance", async () => {
    let release: (r: SolveResult) => void = () => {};
    stub.solve = () => new Promise((go) => (release = go));
    open("spot=srp_btn_bb&street=river&view=oop");
    expect(await screen.findByText(/^On the flop .*\. The turn checks through\. BB to act first on the river · pot [\d.]+bb$/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(5);
    expect(screen.getByRole("status")).toHaveTextContent("Solving this spot live…");
    expect(screen.queryByRole("group", { name: "Your options" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeDisabled();
    // the spot's Hint needs no answer
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    expect(screen.getByText(/^River, heads-up, BB out of position\. Nothing to call/)).toBeInTheDocument();
    await waitFor(() => expect(stub.asked).toHaveLength(1));
    expect(stub.asked[0]).toMatchObject({ mode: "fast", state: { hero: "BB", players: 6, river: [] } });
    expect((stub.asked[0]!.state.board as string).length).toBe(10);
    release(await answer(RIVER)());

    const opts = await options();
    expect(within(opts).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, ""))).toEqual(["check", "bet 75% (7bb)"]);
    fireEvent.click(within(opts).getByRole("button", { name: /bet 75%/ }));
    const said = screen.getByRole("region", { name: "Answer" });
    expect(within(said).getByText("Blunder")).toBeInTheDocument();
    expect(within(said).getByText("Live solve · 0.63% pot from equilibrium in the solved game (converged) · 111 iterations")).toBeInTheDocument();
    expect(within(said).getByText(/^The solver plays this only 2% of the time; its best by EV is check \(98% of the time\)\.$/)).toBeInTheDocument();
    expect(within(said).getByText(/EV given up: 2(\.0+)?bb, 21\.1% of the 9\.50?bb pot\./)).toBeInTheDocument();
    expect(within(said).getByRole("row", { name: /^bet 75% \(7bb\) ← you/ })).toBeInTheDocument();
    expect(within(said).getByRole("link", { name: "Open in Study →" }).getAttribute("href")).toMatch(/&b=([2-9TJQKA][shdc]){5}/);
    expect(screen.queryByText(/Precomputed|stored mix/)).toBeNull();
    expect(decisions()).toHaveTextContent(/^1$/);

    // kept under what answered it, and as a mistake to ask the solver again
    await waitFor(async () => expect((await recentSessions("practice")).some((s) => s.decisions === 1 && (s.meta.sources as Record<string, number>).live === 1)).toBe(true));
    expect((await recentSessions("drill")).filter((s) => s.startedAt > Date.now() - 60000 && s.meta.street === "river")).toEqual([]);
    await waitFor(async () => expect((await listMistakes()).list.some((m) => m.id.startsWith("drill|live|srp_btn_bb|") && m.ask.via === "solver" && m.street === "river")).toBe(true));

    // Enter deals the next, solved afresh
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Answer" })).toBeNull());
    await waitFor(() => expect(stub.asked).toHaveLength(2));
  });

  it("faces a turn bet with the price from the table, a number key answering", async () => {
    stub.solve = answer({ ...RIVER, street: "turn", pot_bb: 16.5, to_call_bb: 4.13, actions: [{ action: "fold", freq: 0.5, ev_bb: 0 }, { action: "call", freq: 0.5, ev_bb: 0, amount_bb: 4 }] });
    open("spot=srp_btn_bb&street=turn&view=checkfaces");
    const opts = await options();
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB checks the turn, faces a bet");
    expect(within(screen.getByRole("combobox", { name: "Decision" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["BB first to act on the turn", "BTN after BB checks the turn", "BB checks the turn, faces a bet", "BTN faces BB's turn bet"]);
    expect(within(opts).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, ""))).toEqual(["fold", "call 4.13bb"]);
    expect(screen.getByText(/BB checks the turn, BTN bets 75% \(.*bb\) · pot/)).toBeInTheDocument();
    expect(stub.asked[0]!.state.turn).toEqual([{ pos: "BB", action: "check" }, { pos: "BTN", action: "bet", to: expect.any(Number) }]);
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByRole("region", { name: "Answer" })).toBeInTheDocument();
    expect(decisions()).toHaveTextContent(/^1$/);
  });

  it("refuses the betting rules' answer in words, offers no options, scores nothing and deals again", async () => {
    stub.solve = answer({ street: "river", actions: RIVER.actions, fallback: "rules", fallback_reason: "too slow" });
    open("spot=srp_btn_bb&street=river&view=ip");
    const says = await screen.findByRole("alert", undefined, { timeout: 5000 });
    expect(says).toHaveTextContent("This answer is from Heuristic rules (not a solve), not a live solve of this spot, so it isn't graded here. Nothing was scored.");
    expect(screen.queryByRole("group", { name: "Your options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
    expect(decisions()).toHaveTextContent(/^0$/);
    stub.solve = answer(RIVER);
    fireEvent.click(within(says).getByRole("button", { name: "Deal again" }));
    await options();
    expect(stub.asked).toHaveLength(2);
  });

  it("says when the solver fails, and stops a solve you've left", async () => {
    stub.solve = () => Promise.reject(new SolverError("boot-failed", "the runtime didn't load"));
    const first = open("spot=srp_btn_bb&street=river&view=oop");
    expect(await screen.findByRole("alert", undefined, { timeout: 5000 })).toHaveTextContent("The solver couldn't answer this spot: the runtime didn't load");
    first.unmount();
    stub.asked.length = 0;
    stub.solve = () => new Promise(() => {});
    const second = open("spot=srp_btn_bb&street=river&view=oop");
    await waitFor(() => expect(stub.asked).toHaveLength(1), { timeout: 5000 });
    expect(stub.asked[0]!.signal.aborted).toBe(false);
    second.unmount();
    expect(stub.asked[0]!.signal.aborted).toBe(true);
  });

  it("a pick after Reveal isn't graded, and the revealed answer names its source", async () => {
    open("spot=srp_btn_bb&street=river&view=oop");
    const opts = await options();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    const shown = screen.getByRole("group", { name: "Revealed answer" });
    expect(within(shown).getByText("Live solve · 0.63% pot from equilibrium in the solved game (converged) · 111 iterations")).toBeInTheDocument();
    fireEvent.click(within(opts).getByRole("button", { name: /check/ }));
    expect(screen.getByText(/^Not graded: you revealed the answer first$/)).toBeInTheDocument();
    expect(decisions()).toHaveTextContent(/^0$/);
    expect(screen.getByText(/1 pick made after Reveal/)).toBeInTheDocument();
  });

  it("caps a grade on an answer off the solve, and says so", async () => {
    stub.solve = answer({ ...RIVER, off_solution: [{ street: "preflop", pos: "BTN", why: "filled" }] });
    open("spot=srp_btn_bb&street=river&view=oop");
    fireEvent.click(within(await options()).getByRole("button", { name: /bet 75%/ }));
    const said = screen.getByRole("region", { name: "Answer" });
    expect(within(said).getByText("Inaccuracy")).toBeInTheDocument();
    expect(within(said).getByText(/this grade stops at Inaccuracy/)).toBeInTheDocument();
    expect(within(said).getByText("Off the solve here: BTN's preflop line isn't in the charts, so their range is the hands that take its last action.")).toBeInTheDocument();
  });

  it("says a draw deals nothing on a river, and asks nothing of the solver", async () => {
    open("spot=srp_btn_bb&street=river&view=oop&hand=d:gutshot");
    expect(await screen.findByText(/No card is left to come on the river, so Gutshot deals nothing/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(stub.asked).toEqual([]);
  });

  it("says a spot with no stored turns can't deal a river", async () => {
    open("spot=srp_co_bb&street=river");
    expect(await screen.findByText(/stores no turn in this library, so nothing can be dealt here/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(within(screen.getByRole("combobox", { name: "Street" })).getByRole("option", { name: "River (needs this spot's stored turns)" })).toBeDisabled();
    expect(stub.asked).toEqual([]);
  });

  it("saves a river drill as a link back to the river", async () => {
    open("spot=srp_btn_bb&street=river&view=ip");
    await options();
    await waitFor(() => expect(screen.getByRole("button", { name: "☆ Save drill" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "☆ Save drill" }));
    const form = screen.getByRole("form", { name: "Save drill" });
    expect((within(form).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("BTN vs BB single-raised pot · BTN after BB checks the river");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("Saved in this browser.");
    const to = "/practice?tab=drills&spot=srp_btn_bb&view=ip&street=river";
    expect((await listDrills()).find((d) => d.to === to)).toMatchObject({ kind: "library" });
    await deleteDrill((await listDrills()).find((d) => d.to === to)!.id);
    cleanup();
    open(to.slice("/practice?tab=drills&".length));
    await options();
    expect(screen.getByRole("combobox", { name: "Street" })).toHaveDisplayValue("River (live solve)");
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BTN after BB checks the river");
  });

  it("a link saved before these drills stays the stored drill, and a live one keeps its street", async () => {
    open("spot=srp_btn_bb&street=turn&view=vsbet");
    expect(await options()).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB first to act on the turn");
    expect(screen.getByText(/A bet to face on the turn and the river are live drills\./)).toBeInTheDocument();
    expect(stub.asked).toEqual([]);
    cleanup();
    open("spot=srp_btn_bb");
    fireEvent.change(await screen.findByRole("combobox", { name: "Street" }, { timeout: 5000 }), { target: { value: "river" } });
    expect(await screen.findByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB first to act on the river");
    await options();
    expect(within(screen.getByRole("combobox", { name: "Decision" })).getAllByRole("option")).toHaveLength(2);
  });
});
