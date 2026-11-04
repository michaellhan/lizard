// FullHands on its Room: what the page draws where the Room says a step failed, and that the page starts its Room as
// StrictMode runs effects. The hand itself is PracticePage.test.tsx's; the Room's own rules are room.test.ts's.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import type { PlayRequest, Provenance, SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { PracticePage } from "./PracticePage";

const prov: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 };
const CHART: AdvisorResponse = {
  street: "preflop",
  pot_bb: 1.5,
  actions: [
    { action: "fold", freq: 0.1 },
    { action: "call", freq: 0.9 },
  ],
};

// the solver stubbed: your spot and each move as the test says
const stub = vi.hoisted(() => {
  const s = {
    calls: [] as string[],
    advice: null as null | (() => AdvisorResponse),
    move: null as null | ((p: PlayRequest) => Partial<PlayMove>),
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const client = {
    solve: async ({ state, mode }: { state: AdvisorState; mode?: string }): Promise<SolveResult> => {
      s.calls.push(`advise ${state.hero} ${mode}`);
      return { data: s.advice!(), provenance: prov };
    },
    play: async (_: AdvisorState, p: PlayRequest): Promise<SolveResult<Partial<PlayMove>>> => {
      s.calls.push(`play ${p.seat}`);
      return { data: s.move!(p), provenance: prov };
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

afterEach(() => {
  stub.calls = [];
  stub.advice = null;
  stub.move = null;
  useSettings.setState({ mode: "fast", keepHands: false });
});

// heads-up, your first hand from the small blind: you act first; in the big blind (`seat`), the small blind does
function heads(seat?: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
  if (seat) fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: seat } });
  fireEvent.click(screen.getByRole("button", { name: "New session" }));
}

describe("FullHands on a Room", () => {
  it("asks each spot once under StrictMode", async () => {
    stub.advice = () => CHART;
    stub.move = () => ({ action: "fold" });
    render(
      <StrictMode>
        <MemoryRouter>
          <PracticePage pace={0} />
        </MemoryRouter>
      </StrictMode>,
    );
    // (the 6-max hand it deals on load: left to run, three folds and your spot)
    await screen.findByRole("group", { name: "Your options" });
    await waitFor(() => expect(stub.calls).toEqual(["play UTG", "play HJ", "play CO", "advise BTN quick"]));
  });

  it("offers Try again and Play on where an opponent's move failed, and your own moves nowhere near it", async () => {
    stub.move = () => ({ error: "no such node" });
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    heads("BB");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("BTN/SB's move failed: no such node");
    expect(screen.queryByRole("group", { name: "Moves without a grade" })).toBeNull();
    expect(screen.queryByText(/is thinking/)).toBeNull();

    // asked again, the same answer
    stub.calls = [];
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(stub.calls).toEqual(["play SB"]));
    const again = await screen.findByRole("alert");

    // played on: the small blind's call, in the hand's line, labelled, and no decision of yours
    stub.advice = () => CHART;
    fireEvent.click(within(again).getByRole("button", { name: "Play on: BTN/SB checks or calls (not a solve)" }));
    await screen.findByRole("group", { name: "Your options" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent("preflop: BTN/SB calls");
    expect(screen.queryByRole("region", { name: "Last decision" })).toBeNull();
  });

  it("offers Ask again and your own moves where your spot's answer came back an error", async () => {
    stub.advice = () => ({ error: "no such node" });
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    heads();
    await screen.findByText(/No answer to grade this spot against: no such node/);
    expect(screen.queryByRole("button", { name: /^Play on/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "Your options" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "Moves without a grade" })).getByRole("button", { name: "fold" })).toBeInTheDocument();

    stub.advice = () => CHART;
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await screen.findByRole("group", { name: "Your options" });
    expect(screen.queryByRole("group", { name: "Moves without a grade" })).toBeNull();
  });

  it("asks again when the mode changes", async () => {
    stub.advice = () => CHART;
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    heads();
    await screen.findByRole("group", { name: "Your options" });
    fireEvent.click(screen.getByRole("radio", { name: /Accurate/ }));
    await waitFor(() => expect(stub.calls).toEqual(["advise SB quick", "advise SB accurate"]));
  });
});
