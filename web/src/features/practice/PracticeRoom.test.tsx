// FullHands on its Room: what the page draws where the Room says a step failed, and that the page starts its Room as
// StrictMode runs effects. The hand itself is PracticePage.test.tsx's; the Room's own rules are room.test.ts's.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvGet, kvSet } from "@/data/db";
import { emptyTally } from "@/features/history/history";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import type { PlayRequest, Provenance, SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { KEPT_KEY } from "./keep";
import { decide, newHand, type HandOptions } from "./practice";
import { PracticePage } from "./PracticePage";
import { reviewed } from "./review";
import { freshSession } from "./session";

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

// A doc the views would throw on, with nothing above them to catch it: `keptTables` is all that stands between it and a
// blank page on every load. Each is a doc this build reads as v1, from another build or a damaged store.
describe("a kept doc on the page", () => {
  const OPTS: Required<HandOptions> = { seat: "UTG", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };
  const dealt = (n: number) => newHand(6, 100, n, n + 1, OPTS);
  const place = (n: number, o: object = {}) => ({ hand: dealt(n), stats: emptyTally(), last: null, lastHand: null, ...o });
  const decided = () => {
    const r = decide(dealt(0), CHART, 1, prov);
    if ("error" in r) throw new Error(r.error);
    return r.decision;
  };
  const entry = (o: object = {}) => ({ ...reviewed(dealt(0), decided(), 1), ...o });
  const doc = (session: object = {}, first: object = {}) => ({
    v: 1,
    n: 2,
    focus: 0,
    session: { ...freshSession(6, 100, OPTS), dealt: 2, tables: 2, ...session },
    tables: [place(0, first), place(1), null, null],
  });

  /** The page opened on the doc, as far as its first request: the doc has been read by then, and drawn. */
  async function open(d: unknown) {
    await kvSet(KEPT_KEY, d);
    render(
      <StrictMode>
        <MemoryRouter>
          <PracticePage pace={0} />
        </MemoryRouter>
      </StrictMode>,
    );
    await act(() => vi.waitFor(() => expect(stub.calls.length).toBeGreaterThan(0)));
  }

  beforeEach(() => {
    stub.advice = () => CHART;
    stub.move = () => ({ action: "fold" });
    useSettings.setState({ loaded: true });
  });

  afterEach(async () => {
    cleanup();
    await kvSet(KEPT_KEY, null);
    useSettings.setState({ loaded: false });
  });

  it("draws a sound doc's review and last decision, which is what the cases below would throw on", async () => {
    await open(doc({ review: [entry()] }, { last: decided() }));
    expect(screen.getByRole("region", { name: "Your decisions" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Last decision" })).toBeInTheDocument();
  });

  it.each<[string, object]>([
    ["a review entry whose cards aren't cards", { review: [entry({ hole: ["ZZ", "YY"] })] }],
    ["a review entry whose board isn't cards", { review: [entry({ board: ["ZZ"] })] }],
    ["a review entry that was never graded", { review: [entry({ d: { ...decided(), grade: null, provenance: null } })] }],
    ["a review entry whose source's figure isn't one", { review: [entry({ d: { ...decided(), provenance: { ...prov, exploitabilityPct: "1" } } })] }],
    ["sizes with no list", { opts: { ...OPTS, sizes: { flop: 5 } } }],
  ])("starts fresh on %s, the doc left where it is", async (_, session) => {
    const d = doc(session);
    await open(d);
    expect(screen.queryByRole("region", { name: "Your decisions" })).toBeNull();
    expect(screen.getByRole("form", { name: "New session" })).toBeInTheDocument();
    expect(await kvGet(KEPT_KEY)).toEqual(d);
  });

  it.each<[string, object]>([
    ["nothing in its mix", { ...decided(), mix: [null] }],
    ["an action that's no word", { ...decided(), mix: [{ action: {}, freq: 1, ev: 0 }] }],
  ])("goes on without a last decision with %s", async (_, last) => {
    await open(doc({ review: [entry()] }, { last }));
    expect(screen.queryByRole("region", { name: "Last decision" })).toBeNull();
    expect(screen.getByRole("region", { name: "Your decisions" })).toBeInTheDocument();
  });
});
