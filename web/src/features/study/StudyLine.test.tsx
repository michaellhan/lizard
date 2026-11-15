// The Line bar's board and its rows: a street a row, each street's cards heading it, where the node shown stands.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LineBoard, LineRows } from "./StudyLine";
import { back, fromSearch, lineSteps } from "./studyState";

const river = fromSearch("p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c&b=Ks7d2cQh4s&flop=BB:x,BTN:b1.8,BB:c&turn=BB:x,BTN:x")!;

describe("the Line bar", () => {
  it("lays the line out a street a row, the river's card heading its own, and says who acts at the end", () => {
    render(<LineRows steps={lineSteps(river, river)} setHand={() => {}} toAct="BB" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Preflop", "Flop", "Turn", "River"]);
    expect(within(rows[0]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["3 folds", "BTN raise 2.5", "SB fold", "BB call"]);
    expect(within(rows[1]!).getAllByRole("img").map((c) => c.getAttribute("aria-label"))).toEqual(["king of spades", "7 of diamonds", "2 of clubs"]);
    expect(within(rows[1]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Flop K♠7♦2♣", "BB check", "BTN bet 1.8", "BB call"]);
    const riverCard = within(rows[3]!).getByRole("button", { name: /River 4 of spades/ });
    expect(riverCard).toHaveAttribute("aria-current", "step");
    expect(rows[3]).toHaveTextContent("BB to act");
  });

  it("goes to a step's node, and says no seat while what's next on the street is still ahead", () => {
    const go = vi.fn();
    const at = back(back(river)!)!; // (the turn's BB check is the node shown, BTN's check ahead)
    render(<LineRows steps={lineSteps(at, river)} setHand={go} toAct="BTN" />);
    const turn = screen.getByRole("listitem", { name: "Turn" });
    expect(within(turn).getByRole("button", { name: "BB check" })).toHaveAttribute("aria-current", "step");
    expect(turn).not.toHaveTextContent("to act");
    fireEvent.click(within(turn).getByRole("button", { name: "BTN check" }));
    expect(go).toHaveBeenCalledWith(lineSteps(at, river)[10]!.hand);
  });

  it("starts with the hand's start, and shows the board only from the flop, places not dealt an outline", () => {
    const fresh = fromSearch("p=6&s=100")!;
    const { container } = render(
      <>
        <LineBoard board={fresh.board} />
        <LineRows steps={lineSteps(fresh, fresh)} setHand={() => {}} />
      </>,
    );
    expect(screen.queryByRole("group", { name: "Board" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Preflop" })).toHaveTextContent("the start of the hand");
    container.remove();
    render(<LineBoard board="Ks7d2cQh" />);
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(4);
  });
});
