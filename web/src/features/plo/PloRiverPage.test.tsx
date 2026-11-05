import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PloRiverPage } from "./PloRiverPage";

// jsdom has no Worker, so the page runs its slices on the page: the same job (engine/plo/river/run.test.ts has the worker)

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const solve = () => fireEvent.click(screen.getByRole("button", { name: "Solve this river" }));

/** A spot that solves in moments. */
function small() {
  type("OOP range", "QhTh4c3c,6s5s4h3d");
  type("IP range", "AsAc8s8c");
  type("Board", "2c7d9hJsKd");
  type("Pot", "10");
  type("Bet sizes", "100");
  type("Raise sizes", "");
  fireEvent.change(screen.getByLabelText("Raise cap"), { target: { value: "0" } });
  fireEvent.click(screen.getByLabelText(/All-in where pot limit/));
  type("Target exploitability", "0.05");
}

describe("PloRiverPage", () => {
  it("says what it covers and what it doesn't, before anything is run", () => {
    render(<PloRiverPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Heads-up PLO4 river solve" })).toBeTruthy();
    const words = screen.getByText(/One river, solved exactly/).textContent;
    expect(words).toMatch(/no earlier street is solved/);
    expect(words).toMatch(/heads-up/);
    expect(words).toMatch(/no rake/);
  });

  it("solves a polarised river, with its provenance, frequencies and combos", async () => {
    render(<PloRiverPage />);
    small();
    solve();
    const section = await screen.findByRole("region", { name: "River solution" });
    const badge = within(section).getByRole("button", { name: /Heads-up PLO4 river solve of every combo/ });
    expect(badge.textContent).toMatch(/earlier streets aren't solved/);
    expect(badge.textContent).toMatch(/iterations/);
    expect(badge.textContent).toMatch(/% pot from equilibrium in the solved game/);
    expect(badge.textContent).toMatch(/no rake/);
    expect(section.textContent).toMatch(/Reached the target of 0.05% of the pot/);

    const ranges = within(section).getByRole("table", { name: "Ranges on this line" });
    expect(ranges.textContent).toMatch(/OOP7\.5/);
    expect(ranges.textContent).toMatch(/IP2\.5/);

    const actions = within(section).getByRole("table", { name: "Actions at this decision" });
    expect(within(actions).getByText("Check")).toBeTruthy();
    expect(within(actions).getByText("Bet 10")).toBeTruthy();

    const combos = within(section).getByRole("table", { name: "Combos at this decision" });
    expect(within(combos).getAllByRole("row")).toHaveLength(3);
    expect(combos.textContent).toContain("Qh");
  });

  it("goes to another decision, the other range's", async () => {
    render(<PloRiverPage />);
    small();
    solve();
    const section = await screen.findByRole("region", { name: "River solution" });
    fireEvent.change(within(section).getByLabelText("Decision"), { target: { value: within(section).getByRole<HTMLOptionElement>("option", { name: "IP after OOP Bet 10" }).value } });
    const actions = within(section).getByRole("table", { name: "Actions at this decision" });
    expect(within(actions).getByText("Fold")).toBeTruthy();
    expect(within(actions).getByText("IP action")).toBeTruthy();
    expect(within(section).getByRole("table", { name: "Combos at this decision" }).textContent).toContain("Ac");
  });

  it("finds a hand in the table", async () => {
    render(<PloRiverPage />);
    small();
    solve();
    const section = await screen.findByRole("region", { name: "River solution" });
    fireEvent.change(within(section).getByLabelText("Find a hand"), { target: { value: "6s" } });
    expect(within(within(section).getByRole("table", { name: "Combos at this decision" })).getAllByRole("row")).toHaveLength(2);
  });

  it("says what's wrong with the input", async () => {
    render(<PloRiverPage />);
    type("Board", "2c7d");
    solve();
    expect((await screen.findByRole("alert")).textContent).toMatch(/five cards/);
    type("Board", "2c7d9hJsKd");
    type("Bet sizes", "half");
    solve();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/percents/));
    type("Bet sizes", "150");
    solve();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/up to 100/));
  });

  it("refuses ranges that can't meet, and says so", async () => {
    render(<PloRiverPage />);
    small();
    type("IP range", "QhTh4c3c");
    type("OOP range", "QhKc5s6s");
    solve();
    expect((await screen.findByRole("alert")).textContent).toMatch(/no matchup can be dealt/);
  });

  it("can be cancelled, and labels what it hands back as short of the target", async () => {
    render(<PloRiverPage />);
    type("Target exploitability", "0.001");
    type("Time budget", "600");
    solve();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    const section = await screen.findByRole("region", { name: "River solution" });
    expect(section.textContent).toMatch(/Cancelled: the strategies as they stood, short of the 0.001% target, so approximate/);
    expect(within(section).getByRole("button", { name: /short of its target: cancelled/ })).toBeTruthy();
  });

  it("says a time budget ran out", async () => {
    render(<PloRiverPage />);
    type("Target exploitability", "0.001");
    type("Time budget", "0.05");
    solve();
    const section = await screen.findByRole("region", { name: "River solution" });
    expect(section.textContent).toMatch(/The time budget ran out short of the 0.001% target/);
  });
});
