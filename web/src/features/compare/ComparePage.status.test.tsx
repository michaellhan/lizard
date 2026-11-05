// Compare as a reader and a keyboard meet it: one region that says each answer, Stop and Try again.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import { SolverError, type SolveResult } from "@/solver/types";
import { ComparePage } from "./ComparePage";

// `holdFrom`: the request at this count and after wait for `release()` or Stop; `fail`: the next one rejects
const stub = vi.hoisted(() => {
  const s = {
    asked: [] as AdvisorState[],
    holdFrom: Infinity,
    fail: null as string | null,
    release: () => {},
    answer: null as unknown as () => SolveResult,
    cancelled: null as unknown as () => Error,
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const client = {
    solve: async (req: { state: AdvisorState; signal?: AbortSignal }): Promise<SolveResult> => {
      s.asked.push(req.state);
      if (s.asked.length >= s.holdFrom)
        await new Promise<void>((ok, no) => {
          s.release = ok;
          req.signal?.addEventListener("abort", () => no(s.cancelled()));
        });
      if (s.fail) throw new Error(s.fail);
      return s.answer();
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

const NODE: AdvisorResponse = {
  study: "node",
  street: "flop",
  actor: "BB",
  pot_bb: 6,
  actions: [{ action: "check", freq: 1, combos: 10, ev_bb: 2 }],
  grid: { actions: ["check"], cells: { AA: { w: 1, f: [1] } } },
  range_combos: 10,
  solver: { iterations: 300 },
};

function show() {
  render(
    <MemoryRouter initialEntries={["/compare?a=p%3D6%26s%3D100&b=p%3D6%26s%3D40"]}>
      <ComparePage />
    </MemoryRouter>,
  );
}
const told = () => screen.getAllByRole("status").find((n) => n.className.includes("sr-only"))!;

beforeEach(() => {
  stub.asked.length = 0;
  stub.holdFrom = Infinity;
  stub.fail = null;
  stub.cancelled = () => new SolverError("cancelled", "cancelled");
  stub.answer = () => ({ data: NODE, provenance: provenanceOf(NODE, { mode: "fast", transport: "worker", solverVersion: "test", partial: false }) });
});

describe("Compare's region, Stop and Try again", () => {
  it("is one region through each answer, ending with both and their sources", async () => {
    stub.holdFrom = 2;
    show();
    const region = told();
    expect(region).toHaveTextContent("Finding A's answer.");
    await waitFor(() => expect(region).toHaveTextContent("A answered. Finding B's answer."));
    await act(async () => stub.release());
    await screen.findByRole("region", { name: "Actions" });
    expect(told()).toBe(region);
    expect(region).toHaveTextContent("A: BB to act on the flop, pot 6bb. Live solve");
    expect(region).toHaveTextContent("B: BB to act on the flop, pot 6bb. Live solve");
  });

  it("keeps A through a stop on B: Try again asks B alone, with focus on it and then held", async () => {
    stub.holdFrom = 2;
    show();
    const stop = await screen.findByRole("button", { name: "Stop" });
    await waitFor(() => expect(stub.asked).toHaveLength(2));
    stop.focus();
    fireEvent.click(stop);
    const again = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(again).toHaveFocus());
    expect(told()).toHaveTextContent("B: Stopped.");
    expect(within(screen.getByLabelText("Spots")).getByText(/^Live solve/)).toBeInTheDocument();

    stub.holdFrom = Infinity;
    fireEvent.click(again);
    await screen.findByRole("region", { name: "Actions" });
    expect(stub.asked).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("group", { name: "Comparison" })).toHaveFocus());
  });

  it("says a failure, and Try again re-asks both when A failed", async () => {
    stub.fail = "The engine gave up.";
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(told()).toHaveTextContent(/Finding A's answer\.|A: The engine gave up\./);
    await waitFor(() => expect(stub.asked.length).toBeGreaterThan(2));
    await waitFor(() => expect(told()).toHaveTextContent("A: The engine gave up."));
    stub.fail = null;
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("region", { name: "Actions" });
  });
});
