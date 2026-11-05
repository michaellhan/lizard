import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChangeCards } from "./ChangeCards";
import { fromSearch, type StudyHand } from "./studyState";

const hand = (q: string) => fromSearch(`p=2&s=100&pre=SB:c,BB:x${q}`)!;

function open(h: StudyHand) {
  const onChange = vi.fn();
  render(<ChangeCards hand={h} onChange={onChange} />);
  return onChange;
}

describe("ChangeCards", () => {
  it("has nothing to change before the flop", () => {
    open(hand(""));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the street on screen, and changes only its card", () => {
    const onChange = open(hand("&b=Ks7d2c5h&flop=BB:x,SB:x"));
    fireEvent.click(screen.getByRole("button", { name: "Change the turn" }));
    fireEvent.change(screen.getByLabelText("New turn"), { target: { value: "9d" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChange.mock.calls[0]![0]).toMatchObject({ board: "Ks7d2c9d", flop: hand("&flop=BB:x,SB:x").flop });
  });

  it("says what's wrong with a card and changes nothing", () => {
    const onChange = open(hand("&b=Ks7d2c"));
    fireEvent.click(screen.getByRole("button", { name: "Change the flop" }));
    fireEvent.change(screen.getByLabelText("New flop"), { target: { value: "Ks" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("alert")).toHaveTextContent("type 3 cards");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("can be put away", () => {
    open(hand("&b=Ks7d2c"));
    fireEvent.click(screen.getByRole("button", { name: "Change the flop" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Change the flop" })).toBeInTheDocument();
  });
});
