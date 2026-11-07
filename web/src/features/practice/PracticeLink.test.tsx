// A setup's link or a saved scenario's, at a page with a session on it: it opens straight away with nothing running, and with
// a hand under way it asks first, with keeping what you're playing as the answer that has the focus.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type SavedScenario } from "@/data/db";
import { putScenario } from "@/data/scenarios";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import type { PlayRequest, Provenance, SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";

import type { SessionOptions } from "./practice";
import { PracticePage } from "./PracticePage";
import { setupLink } from "./setupLink";

const CHART_P: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 };
const CHART: AdvisorResponse = { street: "preflop", pot_bb: 1.5, actions: [{ action: "fold", freq: 0.1 }, { action: "call", freq: 0.2 }, { action: "raise 2.5", freq: 0.7, amount_bb: 2.5 }] };
const FLOP: AdvisorResponse = { street: "flop", pot_bb: 5, actions: [{ action: "check", freq: 0.4, ev_bb: 2 }, { action: "bet 33%", freq: 0.6, ev_bb: 2.2, amount_bb: 1.6 }] };

const stub = vi.hoisted(() => {
  const s = { asked: 0, getSolver: null as unknown as () => Promise<unknown>, answer: null as unknown as (st: AdvisorState) => SolveResult };
  const client = {
    solve: async ({ state }: { state: AdvisorState }) => {
      s.asked += 1;
      return s.answer(state);
    },
    play: async (state: AdvisorState, p: PlayRequest): Promise<SolveResult<PlayMove>> => {
      const action: PlayMove["action"] = !state.board ? "call" : "check";
      return { data: { pos: p.seat, action, name: action, freq: 1, street: "flop" }, provenance: s.answer(state).provenance };
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));
stub.answer = (st) => ({ data: st.board ? FLOP : CHART, provenance: CHART_P });

afterEach(() => {
  stub.asked = 0;
  useSettings.setState({ mode: "fast", keepHands: false });
});

const LINK = setupLink({ play: "preflop", seat: "moves", players: 2, stack: 40 });

function Page() {
  const go = useNavigate();
  const { search } = useLocation();
  return (
    <>
      <button type="button" onClick={() => void go(LINK)}>
        a link
      </button>
      <button type="button" onClick={() => void go("/practice?scenario=short")}>
        a saved link
      </button>
      <output aria-label="address">{search}</output>
      <PracticePage pace={0} />
    </>
  );
}
const dialog = () => screen.queryByRole("alertdialog", { name: "A session is under way" });
const keep = () => screen.getByRole("button", { name: "Keep this session" });
const replace = () => screen.getByRole("button", { name: "Start the new one" });
const score = () => screen.getByRole("region", { name: "Score" });

/** heads-up, your raise made and the flop to play: a hand under way */
async function underWay() {
  render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "New session" }));
  const options = await screen.findByRole("group", { name: "Your options" });
  fireEvent.click(within(options).getByRole("button", { name: "raise 2.5" }));
  await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).queryByRole("button", { name: "raise 2.5" })).toBeNull());
}
const clickLink = (name = "a link") => {
  const link = screen.getByRole("button", { name });
  link.focus();
  fireEvent.click(link);
  return link;
};

describe("a setup's link", () => {
  it("opens straight away with nothing running, and leaves the address", async () => {
    render(
      <MemoryRouter initialEntries={[LINK]}>
        <Page />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/^Started .*40bb/)).toBeInTheDocument();
    expect(dialog()).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("address").textContent).toBe(""));
  });

  it("asks first with a hand under way, Keep this session the focused answer and the first", async () => {
    await underWay();
    clickLink();
    const ask = await screen.findByRole("alertdialog", { name: "A session is under way" });
    expect(keep()).toHaveFocus();
    expect(within(ask).getAllByRole("button").map((b) => b.textContent)).toEqual(["Keep this session", "Start the new one"]);
    expect(ask).toHaveAccessibleDescription(/This link starts .*, in place of what you.re playing\. Finished hands stay in History, and the hand in progress goes\./);
    // (the address is clear, so a reload doesn't ask again)
    await waitFor(() => expect(screen.getByLabelText("address").textContent).toBe(""));
  });

  it("keeps the session on Keep, saying so, and gives the focus back", async () => {
    await underWay();
    const before = score().textContent;
    const link = clickLink();
    await screen.findByRole("alertdialog");
    fireEvent.click(keep());
    expect(dialog()).toBeNull();
    expect(screen.getByText(/^Kept this session\. .* wasn't started\.$/)).toBeInTheDocument();
    expect(link).toHaveFocus();
    expect(score().textContent).toBe(before);
    expect(screen.getByRole("group", { name: "Your options" })).toBeInTheDocument();
  });

  it("keeps it on Escape as well", async () => {
    await underWay();
    const before = score().textContent;
    clickLink();
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(keep(), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(screen.getByText(/^Kept this session\./)).toBeInTheDocument();
    expect(score().textContent).toBe(before);
  });

  it("starts the link's setup on Start the new one, in place of the session", async () => {
    await underWay();
    clickLink();
    await screen.findByRole("alertdialog");
    fireEvent.click(replace());
    expect(dialog()).toBeNull();
    expect(screen.getByText(/^Started .*40bb/)).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Your options" })).toBeInTheDocument();
    expect(score()).not.toHaveTextContent(/^$/);
  });

  it("gives the focus to the line saying what happened where it had nowhere to go back to", async () => {
    await underWay();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(screen.getByRole("button", { name: "a link" }));
    await screen.findByRole("alertdialog");
    // (the click left the focus on the page's body, so that's where it came from)
    act(() => keep().click());
    expect(screen.getByText(/^Kept this session\./)).toHaveFocus();
  });

  it("takes no key at the table while it asks, and the table's keys are back after", async () => {
    await underWay();
    clickLink();
    await screen.findByRole("alertdialog");
    const asked = stub.asked;
    const flop = within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button").map((b) => b.textContent);
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(document.body, { key: "2" });
    expect(screen.getByRole("region", { name: "Hand history" }).textContent).not.toMatch(/You check|bet 33%/);
    expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button").map((b) => b.textContent)).toEqual(flop);
    expect(stub.asked).toBe(asked);
    fireEvent.click(keep());
    fireEvent.keyDown(document.body, { key: "1" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Last decision" })).toHaveTextContent(/check/));
  });
});

describe("a saved scenario's link", () => {
  const OPTS: SessionOptions = { seat: "moves", preflopOnly: true, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, board: null };
  const SHORT: SavedScenario = { id: "short", name: "Short ones", players: 2, stack: 40, opts: OPTS, note: "", createdAt: 1, updatedAt: 2 };
  beforeEach(async () => {
    await (await db())!.clear("savedScenarios");
    expect(await putScenario(SHORT)).toBe(true);
  });

  it("opens straight away with nothing running", async () => {
    render(
      <MemoryRouter initialEntries={["/practice?scenario=short"]}>
        <Page />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Started Short ones.")).toBeInTheDocument();
    expect(dialog()).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("address").textContent).toBe(""));
  });

  it("asks first with a hand under way, by its name, and the address goes", async () => {
    await underWay();
    clickLink("a saved link");
    const ask = await screen.findByRole("alertdialog", { name: "A session is under way" });
    expect(keep()).toHaveFocus();
    expect(ask).toHaveAccessibleDescription(/^This link starts Short ones, in place of what you.re playing\./);
    await waitFor(() => expect(screen.getByLabelText("address").textContent).toBe(""));
  });

  it("keeps the session on Keep, saying so, and gives the focus back", async () => {
    await underWay();
    const before = score().textContent;
    const link = clickLink("a saved link");
    await screen.findByRole("alertdialog");
    fireEvent.click(keep());
    expect(dialog()).toBeNull();
    expect(screen.getByText("Kept this session. Short ones wasn't started.")).toBeInTheDocument();
    expect(link).toHaveFocus();
    expect(score().textContent).toBe(before);
  });

  it("starts it on Start the new one, in place of the session", async () => {
    await underWay();
    clickLink("a saved link");
    await screen.findByRole("alertdialog");
    fireEvent.click(replace());
    expect(dialog()).toBeNull();
    expect(screen.getByText("Started Short ones.")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Stack in big blinds" })).toHaveValue(40);
  });

  it("asks nothing of a link to a scenario that's gone: it says so, and the hand goes on", async () => {
    await (await db())!.clear("savedScenarios");
    await underWay();
    const before = score().textContent;
    clickLink("a saved link");
    expect((await screen.findByRole("alert")).textContent).toMatch(/gone or can't be read/);
    expect(dialog()).toBeNull();
    expect(score().textContent).toBe(before);
  });
});
