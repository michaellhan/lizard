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
    expect(screen.getByRole("heading", { level: 1, name: "Heads-up PLO4 river and turn solve" })).toBeTruthy();
    const words = screen.getByText(/One river, or a turn and every river card after it, solved exactly/).textContent;
    expect(words).toMatch(/no earlier street is solved/);
    expect(words).toMatch(/heads-up/);
    expect(words).toMatch(/no rake/);
  });

  it("solves a polarised river, with its provenance, frequencies and combos", async () => {
    render(<PloRiverPage />);
    small();
    solve();
    const section = await screen.findByRole("region", { name: "River solution" });
    const badge = within(section).getByRole("button", { name: /Heads-up PLO4 solve of every combo/ });
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

    // condensed by what each holds: the straight always bets, the air half the time
    const classes = within(section).getByRole("table", { name: "Hand classes at this decision" });
    const rows = within(classes).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows.map((r) => r.slice(0, 4))).toEqual([
      ["Straight (1)", "50.0%", "0%", "100%"],
      ["High card (1)", "50.0%", "50%", "50%"],
    ]);

    const combos = within(section).getByRole("table", { name: "Combos at this decision" });
    expect(within(combos).getAllByRole("row")).toHaveLength(3);
    expect(combos.textContent).toContain("Qh");
  });

  it("solves a turn and every river after it, from a board of four cards", async () => {
    render(<PloRiverPage />);
    small();
    type("Board", "2c7d9hJs");
    expect(screen.queryByLabelText("River bet sizes")).toBeTruthy();
    type("River bet sizes", "100");
    type("River raise sizes", "");
    fireEvent.change(screen.getByLabelText("River raise cap"), { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText(/on the river$/));
    type("Target exploitability", "0.5");
    fireEvent.click(screen.getByRole("button", { name: "Solve this turn" }));
    // (44 rivers: the four cards of IP's one hand leave it nothing)
    const section = await screen.findByRole("region", { name: "Turn solution" }, { timeout: 20000 });
    const badge = within(section).getByRole("button", { name: /Heads-up PLO4 solve of every combo/ });
    expect(badge.textContent).toMatch(/a turn and its 44 river cards from the ranges typed/);
    expect(badge.textContent).toMatch(/every river at bets 100% of the pot, raises none, up to 0 raises/);
    expect(section.textContent).toMatch(/through the turn and all 44 rivers/);
    expect(section.textContent).toMatch(/less chips bet on the turn and river/);
    expect(section.textContent).toMatch(/highest EV first/);

    // the river after the turn checks through, on a card: the solve's own river, its two EVs adding to the river's pot
    const after = within(section).getByRole("region", { name: "The river after the turn" });
    expect(within(after).getByLabelText("Turn line").textContent).toContain("OOP Check, IP Check");
    fireEvent.change(within(after).getByLabelText("Turn line"), { target: { value: within(after).getAllByRole("option").find((o) => o.textContent === "OOP Check, IP Check")!.getAttribute("value") } });
    fireEvent.change(within(after).getByLabelText("River card"), { target: { value: "Kd" } });
    fireEvent.click(within(after).getByRole("button", { name: "Show this river" }));
    await within(after).findByLabelText("River decision");
    expect(after.textContent).toMatch(/Board 2c7d9hJs Kd: pot 10, 100 behind/);
    const evs = within(after).getByRole("table", { name: "Ranges on this line" }).querySelectorAll("tbody td:last-child");
    expect(Math.abs([...evs].reduce((t, td) => t + Number(td.textContent), 0) - 10)).toBeLessThan(0.02);
    expect(within(after).getByRole("table", { name: "Actions at this decision" }).textContent).toContain("Bet 10");
    expect(within(after).getByRole("table", { name: "Hand classes at this decision" }).textContent).toContain("Straight (1)");
  }, 30000);

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
