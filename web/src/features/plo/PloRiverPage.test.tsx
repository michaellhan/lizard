import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    expect(screen.getByRole("heading", { level: 1, name: "Heads-up PLO4 flop, turn and river solve" })).toBeTruthy();
    expect(screen.getByText(/^No rake; earlier streets aren.t solved\.$/)).toBeTruthy();
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

  it("deals a hand from the solve and grades the action taken against that combo's mix and EVs", async () => {
    render(<PloRiverPage />);
    small();
    solve();
    const section = await screen.findByRole("region", { name: "River solution" });
    const drill = within(section).getByRole("region", { name: "Practice this solve" });
    // (the first draw is the root, OOP's, and the first combo there: the air, weakest first, which mixes at equal EV)
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    fireEvent.click(within(drill).getByRole("button", { name: "Deal a hand" }));
    random.mockRestore();
    expect(within(drill).getByLabelText("Your spot").textContent).toMatch(/^You're OOP with \S+ on 2c7d9hJsKd\. First to act on the river\. Pot 10\.00, 100\.00 behind\.$/);
    const choices = within(drill).getByRole("group", { name: "Your action" });
    expect(within(choices).getAllByRole("button").map((b) => b.textContent)).toEqual(["Check", "Bet 10"]);
    fireEvent.click(within(choices).getByRole("button", { name: "Check" }));
    const said = within(drill).getByRole("status");
    expect(said.querySelector("p")!.textContent).toMatch(/^Best\. The solve's best here is (Check|Bet 10), and this hand mixes\.$/);
    const freqs = [...within(said).getByRole("table", { name: "This hand in the solve" }).querySelectorAll("tbody td:nth-child(2)")].map((td) => Number.parseFloat(td.textContent!));
    expect(freqs.reduce((t, x) => t + x, 0)).toBeCloseTo(100, 0);
    expect(within(choices).getByRole("button", { name: "Bet 10" }).hasAttribute("disabled")).toBe(true);
    expect(within(drill).getByLabelText("Your tally").textContent).toMatch(/^1 hand: 1 Best or Correct, 0\.00bb given up\./);
    expect(within(drill).getByRole("button", { name: "Next hand" })).toBeTruthy();
  });

  it("puts a street of a pasted PLO hand in the form, its board, pot and stacks, and leaves the ranges as typed", async () => {
    render(<PloRiverPage />);
    fireEvent.click(screen.getByText("Start from a hand you played"));
    type("PLO hand history", (await import("./fromHistory.test.fixture")).PLO);
    fireEvent.click(screen.getByRole("button", { name: "Read the hand" }));
    const street = screen.getByLabelText("Street from the hand");
    expect(within(street).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Flop Qs8d3c: pot 5.5, BB 97.5 and BTN 97.5 behind",
      "Turn Qs8d3c7h: pot 9.1, BB 95.7 and BTN 95.7 behind",
      "River Qs8d3c7h2s: pot 21.3, BB 89.6 and BTN 89.6 behind",
    ]);
    fireEvent.change(street, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this street" }));
    expect((screen.getByLabelText("Board") as HTMLInputElement).value).toBe("Qs8d3c7h");
    expect((screen.getByLabelText("Pot") as HTMLInputElement).value).toBe("9.1");
    expect((screen.getByLabelText("OOP stack") as HTMLInputElement).value).toBe("95.7");
    expect((screen.getByLabelText("OOP range") as HTMLInputElement).value).toBe("AAxx,KKxx,QQxx");
    expect(screen.getByLabelText("From your hand").textContent).toMatch(/^From your hand: the turn, BB \(OOP\) against BTN \(IP\), you BTN with AhQdJsTd\. Board, pot and stacks filled; type the ranges\./);
    expect(screen.getByRole("button", { name: "Solve this turn" })).toBeTruthy();

    type("PLO hand history", "PokerStars Hand #1: Hold'em No Limit ($1/$2)");
    fireEvent.click(screen.getByRole("button", { name: "Read the hand" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Not an Omaha hand/);
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

  it("solves a flop and every turn and river after it, from a board of three cards, and shows a turn and a river after it", async () => {
    render(<PloRiverPage />);
    small();
    type("OOP range", "QhTh4c3c,6s5s4h3d");
    type("Board", "2c7d9h");
    expect(screen.queryByLabelText("Turn bet sizes")).toBeTruthy();
    for (const street of ["Turn", "River"]) {
      type(`${street} bet sizes`, "100");
      type(`${street} raise sizes`, "");
      fireEvent.change(screen.getByLabelText(`${street} raise cap`), { target: { value: "0" } });
      fireEvent.click(screen.getByLabelText(new RegExp(`on the ${street.toLowerCase()}$`)));
    }
    type("Target exploitability", "0.5");
    fireEvent.click(screen.getByRole("button", { name: "Solve this flop" }));
    const section = await screen.findByRole("region", { name: "Flop solution" }, { timeout: 30000 });
    const badge = within(section).getByRole("button", { name: /Heads-up PLO4 solve of every combo/ });
    expect(badge.textContent).toMatch(/a flop and its 45 turn cards, every river after each/);

    // the turn after a bet and a call, on the king; then the river after that turn checks through
    const after = within(section).getByRole("region", { name: "The turn after the flop" });
    const line = within(after).getByLabelText("Flop line");
    fireEvent.change(line, { target: { value: within(line).getAllByRole("option").find((o) => o.textContent === "OOP Bet 10, IP Call 10")!.getAttribute("value") } });
    fireEvent.change(within(after).getByLabelText("Turn card"), { target: { value: "Kd" } });
    fireEvent.click(within(after).getByRole("button", { name: "Show this turn" }));
    await within(after).findByLabelText("Turn decision");
    expect(after.textContent).toMatch(/Board 2c7d9h Kd: pot 30, 90 behind/);
    const river = within(after).getByRole("region", { name: "The river after the turn" });
    fireEvent.change(within(river).getByLabelText("River card"), { target: { value: "4s" } });
    fireEvent.click(within(river).getByRole("button", { name: "Show this river" }));
    await within(river).findByLabelText("River decision");
    expect(river.textContent).toMatch(/Board 2c7d9h Kd 4s: pot 30, 90 behind/);
    const evs = within(river).getAllByRole("table", { name: "Ranges on this line" })[0]!.querySelectorAll("tbody td:last-child");
    expect(Math.abs([...evs].reduce((t, td) => t + Number(td.textContent), 0) - 30)).toBeLessThan(0.02);
  }, 60000);

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
