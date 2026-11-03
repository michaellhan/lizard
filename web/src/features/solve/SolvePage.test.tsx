// The Solve page: opened on a Study spot (its line and setup filled in), what's out of range refused before Study is
// opened, each field into Study's URL, a saved range picked for a seat, and a new table size starting the line over.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { deleteRange, putRange } from "@/data/saved";
import { fromSearch, studyRequest } from "@/features/study/studyState";
import { SolvePage } from "./SolvePage";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const open = (q: string) =>
  render(
    <MemoryRouter initialEntries={[`/solve?${q}`]}>
      <Routes>
        <Route path="/solve" element={<SolvePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
const type = (name: string, value: string) => fireEvent.change(screen.getByRole(name === "Players" ? "combobox" : "textbox", { name }), { target: { value } });
const num = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
const problems = () => screen.queryByRole("alert", { name: "Setup problems" });

describe("SolvePage", () => {
  it("sets up a spot from a Study line, refuses what's out of range, and opens it in Study with every setting", async () => {
    open("p=2&s=100&pre=SB:r2.5,BB:c&b=Ks7d2c&rake=5");
    expect(screen.getByRole("combobox", { name: "Players" })).toHaveValue("2");
    expect(screen.getByRole("spinbutton", { name: "Rake" })).toHaveValue(5);
    expect(screen.getByText(/From the first decision \(else at SB raise 2\.5 BB call Ks7d2c\)/)).toBeInTheDocument();
    // a straddle needs 3 players
    expect(screen.getByRole("checkbox", { name: "Straddle" })).toBeDisabled();

    // out of range: refused, and Study isn't opened
    type("Flop bets", "33, 75, 125, 150");
    num("Rake", "30");
    type("BB range", "22+, XYZ");
    expect(within(problems()!).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "at most 3 flop bet sizes (each one multiplies the game tree)",
      "the rake must be 0–25% of the pot",
      `BB's range: can't read "XYZ"`,
    ]);
    const go = screen.getByRole("button", { name: "Open in Study" });
    expect(go).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Spot setup" }));
    expect(screen.queryByTestId("where")).toBeNull();

    // fixed: every setting in Study's URL, at the line it came from
    type("Flop bets", "33, 75%");
    type("Raises", "60");
    num("Rake", "5");
    num("Rake cap", "3");
    num("BB stack", "40");
    type("BB range", "22+,A2s+,AhKh");
    expect(problems()).toBeNull();
    fireEvent.click(go);
    const where = screen.getByTestId("where").textContent!;
    expect(where).toMatch(/^\/study\?p=2&s=100&pre=SB%3Ar2\.5%2CBB%3Ac&b=Ks7d2c&/);
    const h = fromSearch(where.split("?")[1]!)!;
    expect(h.setup).toEqual({ stacks: { BB: 40 }, sizes: { flop: [33, 75], raise: [60] }, rake: 5, rakeCap: 3, ranges: { BB: "22+,A2s+,AhKh" } });
    expect(studyRequest(h)).toMatchObject({ stacks: { BB: 40 }, sizes: { flop: [33, 75], raise: [60] }, rake: 0.05, rake_cap: 3, ranges: { BB: "22+,A2s+,AhKh" } });
  });

  it("fills a seat's range from a saved range, and starts the line over at a new table size", async () => {
    await putRange({ id: "r1", name: "BTN open", text: "22+,A2s+,K9s+", combos: 300, note: "", createdAt: 1, updatedAt: 1 });
    open("p=2&s=100&pre=SB:r2.5,BB:c&b=Ks7d2c");
    fireEvent.change(await screen.findByRole("combobox", { name: "SB saved range" }), { target: { value: "r1" } });
    expect(screen.getByRole("textbox", { name: "SB range" })).toHaveValue("22+,A2s+,K9s+");

    type("Players", "6");
    expect(screen.getByText("Opens at the first decision.")).toBeInTheDocument();
    // (the SB's range kept: the seat is at the new table too)
    fireEvent.click(screen.getByRole("checkbox", { name: "Straddle" }));
    num("Ante", "0.12");
    num("Table stack", "60");
    fireEvent.click(screen.getByRole("button", { name: "Open in Study" }));
    const h = fromSearch(screen.getByTestId("where").textContent!.split("?")[1]!)!;
    expect(h).toMatchObject({ players: 6, stack: 60, board: "", preflop: [], setup: { ante: 0.12, straddle: true, ranges: { SB: "22+,A2s+,K9s+" } } });
    await deleteRange("r1");
  });

  it("clears the setup, and opens at the first decision when asked", async () => {
    open("p=6&s=100&pre=UTG:f,HJ:r2.5&sz.turn=75&ante=0.1&straddle=1&rg.BB=QQ%2B");
    expect(screen.getByRole("textbox", { name: "Turn bets" })).toHaveValue("75");
    expect(screen.getByRole("checkbox", { name: "Straddle" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear the setup" }));
    expect(screen.getByRole("textbox", { name: "BB range" })).toHaveValue("");
    fireEvent.click(screen.getByRole("checkbox", { name: /From the first decision/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open in Study" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/study?p=6&s=100"));
  });
});
