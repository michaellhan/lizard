import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { PracticePage } from "./PracticePage";

// jsdom has no Worker, so the PLO solve runs its slices on the page (as PloRiverPage.test.tsx)

const SPOT = "game=plo4&oop=QhTh4c3c,6s5s4h3d&ip=AsAc8s8c,KhKd9s9c&board=2c7d9hJsKd&pot=10&stacks=100,100&bets=100&cap=0&allin=0";

const open = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/practice${search}`]}>
      <Routes>
        <Route path="/practice" element={<PracticePage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Practice for PLO", () => {
  it("plays PLO hands on a solved spot, each of your decisions graded by EV lost", async () => {
    open(`?${SPOT}`);
    const games = await screen.findByRole("navigation", { name: "Game" });
    expect(within(games).getByRole("link", { name: "PLO" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1, name: "Practice" })).toBeTruthy();
    // the spot from the link, then what PLO Practice doesn't do
    expect((screen.getByLabelText("PLO spot") as HTMLSelectElement).value).toBe("link");
    expect(within(screen.getByRole("list", { name: "Not for PLO" })).getByText("preflop")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open it in Study" }).getAttribute("href")).toMatch(/^\/study\?.*game=plo4/);
    // Hold'em Practice's tabs aren't drawn
    expect(screen.queryByRole("tablist", { name: "Practice" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Your seat"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Solve this spot" }));
    const hand = await screen.findByRole("region", { name: "PLO hand" }, { timeout: 10_000 });
    expect(within(hand).getByRole("button", { name: /Heads-up PLO4 solve of every combo/ })).toBeTruthy();

    for (let h = 0; h < 4; h++) {
      fireEvent.click(within(hand).getByRole("button", { name: h ? "Next hand" : "Deal a hand" }));
      await within(hand).findByLabelText("Your spot");
      expect(within(hand).getByRole("group", { name: "Your hand" }).querySelectorAll("[role=img]")).toHaveLength(4);
      // IP on a river: OOP moves first, as the solve plays; then you
      for (let guard = 0; guard < 5 && !within(hand).queryByLabelText("How the hand ended"); guard++) {
        const group = await within(hand).findByRole("group", { name: "Your action" });
        fireEvent.click(within(group).getAllByRole("button")[0]!);
        await waitFor(() => expect(within(hand).queryByRole("group", { name: "Your action" }) === null || within(hand).getByRole("list", { name: "This hand" })).toBeTruthy());
      }
      await within(hand).findByLabelText("How the hand ended");
      const log = within(hand).getByRole("list", { name: "This hand" });
      expect(log.textContent).toMatch(/River, you: /);
      expect(log.textContent).toMatch(/Best|Correct|Inaccuracy|Mistake|Blunder|ungraded/);
    }
    const tally = within(hand).getByLabelText("Your tally");
    expect(tally.textContent).toMatch(/^4 hands, \d+ decisions? graded: \d+ Best or Correct, \d+\.\d\dbb given up/);
    expect(tally.textContent).toMatch(/Not saved to History\.$/);
  });

  it("leaves Hold'em Practice as it was, with the game picker", async () => {
    open("");
    const games = await screen.findByRole("navigation", { name: "Game" });
    expect(within(games).getByRole("link", { name: "Hold'em" }).getAttribute("aria-current")).toBe("page");
    expect(within(games).getByRole("link", { name: "PLO" }).getAttribute("href")).toBe("/practice?game=plo4");
  });
});
