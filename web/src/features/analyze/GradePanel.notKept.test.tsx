// Grades that couldn't be stored aren't reported as kept. (Its own file: putDecisions is stubbed for all of it.)
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { GradePanel } from "./GradingPanel";
import { recordOf } from "./analyze";
import { importHand } from "@/hh/replay";

vi.mock("@/data/hands", async (orig) => ({ ...(await orig<typeof import("@/data/hands")>()), putDecisions: async () => false }));
vi.mock("@/solver/useSolver", () => ({
  useSolver: () => async () => ({
    solve: async () => {
      const { provenanceOf } = await import("@/solver/provenance");
      const data = { street: "preflop" as const, pot_bb: 1.5, actions: [{ action: "fold", freq: 0.2 }, { action: "raise", freq: 0.8, amount_bb: 2.5 }] };
      return { data, provenance: provenanceOf(data, { mode: "fast", transport: "worker", solverVersion: "t", partial: false }) };
    },
  }),
}));

const TEXT = "PokerStars Hand #123: Hold'em No Limit ($0.50/$1.00) - 2024/05/01 20:00:00\nTable 'x' 6-max Seat #1 is the button\nSeat 1: me ($100)\nSeat 2: b ($100)\nb: posts big blind $1\n*** HOLE CARDS ***\nDealt to me [Ah Kd]\nme: folds\n";

it("says the grades weren't saved where the browser kept nothing", async () => {
  const hand = recordOf(TEXT, importHand(TEXT), { id: "i", name: "x", at: 1 });
  render(
    <MemoryRouter>
      <GradePanel hands={[hand]} decisions={[]} onGraded={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /^Grade 1 hand/ }));
  expect(await screen.findByText(/These grades aren't saved: this browser isn't keeping Lizard's data right now\./)).toBeInTheDocument();
});
