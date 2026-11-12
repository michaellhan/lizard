// The actions so far under Practice's seats: a street a line, sizes in bb, the folds before the open one phrase.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HandLine } from "./PracticeParts";
import { newHand, type PracticeHand } from "./practice";

const hand = (): PracticeHand => {
  const h = newHand(6, 100, 0, 7);
  return {
    ...h,
    shown: 3,
    lines: {
      ...h.lines,
      preflop: [
        { pos: "UTG", action: "fold" },
        { pos: "HJ", action: "fold" },
        { pos: "CO", action: "raise", to: 2.5 },
        { pos: "BTN", action: "call" },
        { pos: "SB", action: "fold" },
        { pos: "BB", action: "fold" },
      ],
      flop: [{ pos: "CO", action: "bet", to: 2 }],
    },
  } as PracticeHand;
};

describe("HandLine", () => {
  it("says each street's moves with their sizes, the folds before the open as one phrase", () => {
    const h = hand();
    render(<HandLine hand={h} />);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^preflop: UTG, HJ fold, CO raises to 2\.5bb, .*call, SB folds, BB folds$/);
    expect(rows[1]).toMatch(new RegExp(`^flop ${h.board.slice(0, 3).join(" ")}: CO bets 2bb$`));
  });
  it("says a lone fold before you as itself", () => {
    const h = hand();
    render(<HandLine hand={{ ...h, shown: 0, lines: { ...h.lines, preflop: [{ pos: "UTG", action: "fold" }] } } as PracticeHand} />);
    expect(screen.getByRole("listitem").textContent).toBe("preflop: UTG folds");
  });
  it("draws nothing before anyone has moved", () => {
    const { container } = render(<HandLine hand={{ ...hand(), lines: newHand(6, 100, 0, 7).lines, shown: 0 }} />);
    expect(container.textContent).toBe("");
  });
});
