// A tournament answer's numbers in words: winner-takes-all has no bubble factors, a short stack that covers nobody
// still says who covers it (of the seats still in), and an answer with no payouts says its EVs are chips.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TournamentPanel } from "./TournamentPanel";

describe("the tournament panel", () => {
  it("says who covers a short stack that busts nobody", () => {
    render(<TournamentPanel actor="CO" out={["UTG"]} t={{ equity_share: 0.082, bubble_factors: { BTN: 1.18, BB: null }, bounties: { format: "ko", you_bust: {}, bust_you: { UTG: 3, BTN: 3, BB: 3 } } }} />);
    const panel = screen.getByLabelText("Tournament");
    expect(panel).toHaveTextContent("Prize equity: CO 8.2% of what's left to pay.");
    expect(panel).toHaveTextContent("BTN 1.18 · BB (a chip won gains nothing)");
    expect(panel).toHaveTextContent("Bounties CO covers nobody still in the hand who carries a bounty. Covered by BTN, BB.");
    expect(panel).toHaveTextContent("they're in prize equity");
  });

  it("leaves out bubble factors when the winner takes all, and says chips when no payouts were given", () => {
    const { unmount } = render(<TournamentPanel actor="BTN" t={{ equity_share: 0.4, bubble_factors: { BB: 1 }, note: "tournament: winner-take-all, chips are prizes" }} />);
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("(winner takes all: that's their share of the chips)");
    expect(screen.queryByText(/Bubble factors/)).toBeNull();
    unmount();
    render(<TournamentPanel actor={undefined} t={{ note: "tournament: no payouts given, the prizes taken as the bounties in play" }} />);
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("Where EVs show, they're chips, the bounties priced in chips.");
  });

  it("says so once when no chip won gains anything (every player left paid)", () => {
    render(<TournamentPanel actor="UTG" t={{ equity_share: 1 / 6, bubble_factors: { HJ: null, BB: null }, note: "tournament: ICM, UTG's prize equity 16.7%" }} />);
    expect(screen.getByLabelText("Tournament")).toHaveTextContent("chips won): none: a chip won from anyone gains nothing.");
  });
});
