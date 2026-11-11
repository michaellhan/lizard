// A tournament answer's numbers in words: winner-takes-all has no bubble factors, a short stack that covers nobody
// still says who covers it (of the seats still in), and an answer with no payouts says its EVs are chips.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { bubbleTable, icmModel } from "@/features/tournaments/icm";
import { TournamentPanel } from "./TournamentPanel";

describe("the tournament panel", () => {
  it("says who covers a short stack that busts nobody", () => {
    render(<TournamentPanel actor="CO" out={["UTG"]} t={{ equity_share: 0.082, bubble_factors: { BTN: 1.18, BB: null }, bounties: { format: "ko", you_bust: {}, bust_you: { UTG: 3, BTN: 3, BB: 3 } } }} />);
    const panel = screen.getByLabelText("Tournament");
    expect(panel).toHaveTextContent("Prize equity: CO 8.2% of what's left to pay.");
    expect(panel).toHaveTextContent("BTN 1.18 · BB (a chip won gains nothing)");
    expect(panel).toHaveTextContent("Bounties CO covers nobody still in the hand who carries a bounty. Covered by BTN, BB.");
    expect(panel).toHaveTextContent("EVs in chips of prize equity.");
  });

  it("leaves out bubble factors when the winner takes all, and says chips when no payouts were given", () => {
    const { unmount } = render(<TournamentPanel actor="BTN" t={{ equity_share: 0.4, bubble_factors: { BB: 1 }, note: "tournament: winner-take-all, chips are prizes" }} />);
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("(winner takes all: that's their share of the chips)");
    expect(screen.queryByText(/Bubble factors/)).toBeNull();
    unmount();
    render(<TournamentPanel actor={undefined} t={{ note: "tournament: no payouts given, the prizes taken as the bounties in play" }} />);
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("EVs in chips, bounties included.");
  });

  it("has every pair's bubble factor behind \"Every pair\", the actor's row its own numbers", () => {
    const pairs = bubbleTable(icmModel({ CO: 35, BTN: 12, SB: 60, BB: 8 }, [50, 30, 20]));
    render(<TournamentPanel actor="CO" pairs={pairs} t={{ equity_share: 0.316, bubble_factors: { BTN: 1.16, SB: 3.43, BB: 1.1 }, note: "tournament: ICM, CO's prize equity 31.6%" }} />);
    expect(screen.getByText("Every pair")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Bubble factors, every pair" });
    expect(within(table).getByRole("row", { name: /^CO / })).toHaveTextContent("CO—1.163.431.1031.6%");
    expect(within(table).getByRole("row", { name: /^SB / })).toHaveTextContent("SB1.331.08—1.0538.4%");
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("worked out in this page from the setup with the engine's prize model");
    // the same pairs as the equity a call of the all-in needs (CO against SB: 3.43 -> 77.4%)
    fireEvent.click(screen.getByRole("radio", { name: "Equity to call" }));
    expect(within(table).getByRole("row", { name: /^CO / })).toHaveTextContent("CO—53.7%77.4%52.4%31.6%");
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("nothing else in the pot (chips: 50%)");
  });

  it("says so once when no chip won gains anything (every player left paid)", () => {
    render(<TournamentPanel actor="UTG" t={{ equity_share: 1 / 6, bubble_factors: { HJ: null, BB: null }, note: "tournament: ICM, UTG's prize equity 16.7%" }} />);
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("Bubble factors: none: a chip won from anyone gains nothing.");
  });
});
