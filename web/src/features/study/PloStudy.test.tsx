import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { StudyPage } from "./StudyPage";

// jsdom has no Worker, so the PLO solve runs its slices on the page (as PloRiverPage.test.tsx)

function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}
const where = () => screen.getByTestId("where").textContent ?? "";

const open = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/study${search}`]}>
      <Routes>
        <Route
          path="/study"
          element={
            <>
              <StudyPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

// a river that solves in moments, as a link
const SPOT = "game=plo4&oop=QhTh4c3c,6s5s4h3d&ip=AsAc8s8c&board=2c7d9hJsKd&pot=10&stacks=100,100&bets=100&cap=0&allin=0";

describe("Study for PLO", () => {
  it("opens a PLO spot from its link, solved, under the solve's provenance", async () => {
    open(`?${SPOT}`);
    const games = await screen.findByRole("navigation", { name: "Game" });
    expect(screen.getByRole("heading", { level: 1, name: "Study" })).toBeTruthy();
    expect(within(games).getByRole("link", { name: "PLO" }).getAttribute("aria-current")).toBe("page");
    expect(within(games).getByRole("link", { name: "Hold'em" }).getAttribute("href")).toBe("/study");
    expect(screen.getByText(/heads-up flop, turn or river from ranges you give/)).toBeTruthy();
    expect((screen.getByLabelText("Board") as HTMLInputElement).value).toBe("2c7d9hJsKd");

    const section = await screen.findByRole("region", { name: "River solution" }, { timeout: 10_000 });
    expect(within(section).getByRole("button", { name: /Heads-up PLO4 solve of every combo/ })).toBeTruthy();
    // the condensed range view, with a drill-down
    const shapes = within(section).getByRole("table", { name: "Hand shapes at this decision" });
    expect(within(shapes).getAllByRole("button").length).toBeGreaterThan(0);
    // the link keeps the spot it solved
    expect(new URLSearchParams(where()).get("board")).toBe("2c7d9hJsKd");
    expect(new URLSearchParams(where()).get("game")).toBe("plo4");
  });

  it("hides Hold'em's tools and lists them as not for PLO", async () => {
    open(`?${SPOT}`);
    await screen.findByRole("navigation", { name: "Game" });
    const missing = screen.getByRole("list", { name: "Not for PLO" });
    for (const item of ["preflop ranges and solves", "three or more players", "node locking", "ICM"]) expect(within(missing).getByText(item)).toBeTruthy();
    // none of Hold'em Study's controls are drawn
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByText(/More tools/)).toBeNull();
    expect(screen.queryByRole("button", { name: /New hand/i })).toBeNull();
    await screen.findByRole("region", { name: "River solution" }, { timeout: 10_000 });
  });

  it("grades your hand when the link carries it", async () => {
    // you were IP with the aces: OOP checks, you bet the pot
    open(`?${SPOT}&hand=AsAc8s8c&seat=1&act=x,b10&from=a%20test%20hand`);
    // from a hand, the ranges are yours to type first: nothing is solved until you ask
    expect(await screen.findByText(/Type both ranges \(yours, IP, must hold/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "River solution" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Solve this river" }));
    const mine = await screen.findByRole("region", { name: "Your hand" }, { timeout: 10_000 });
    expect(mine.textContent).toMatch(/You were IP with AsAc8s8c, a test hand/);
    const line = within(mine).getByRole("list", { name: "Your line" });
    expect(line.textContent).toMatch(/OOP: Check/);
    expect(line.textContent).toMatch(/You: Bet 10/);
    expect(line.textContent).toMatch(/Best|Correct|Inaccuracy|Mistake|Blunder/);
  });
});
