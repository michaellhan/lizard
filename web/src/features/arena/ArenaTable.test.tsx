// The table drawn from the server's view: the other seat's cards face down until shown, your moves only on your turn and
// sent as asked, the clock, and after a hand its outcome, the next hand and Review in Analyze.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ArenaTable } from "./ArenaTable";
import type { ClientMessage, HandView, TableView } from "./protocol";

const NOW = 1_800_000_000_000;
const hand = (o: Partial<HandView> = {}): HandView => ({
  n: 4,
  pos: { SB: 0, BB: 1 },
  cards: ["As", "Ah"],
  theirs: null,
  board: [],
  lines: { preflop: [], flop: [], turn: [], river: [] },
  bets: { SB: 0.5, BB: 1 },
  behind: { SB: 99.5, BB: 99 },
  pot: 1.5,
  toAct: 0,
  deadline: NOW + 20_000,
  bankFrom: NOW + 10_000,
  legal: { toCall: 0.5, canRaise: true, minTo: 2, allInTo: 100, curBet: 1 },
  result: null,
  ...o,
});
const view = (h: HandView | null = hand(), o: Partial<TableView> = {}): TableView => ({
  t: "state",
  rules: { stack: 100, clock: 30 },
  you: 0,
  seats: [
    { name: "Ann", connected: true, ready: false, bank: 60_000, score: 3 },
    { name: "Bob", connected: true, ready: false, bank: 60_000, score: -3 },
  ],
  hand: h,
  now: NOW,
  ...o,
});

function draw(v: TableView, onReview = vi.fn()) {
  const sent: ClientMessage[] = [];
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const r = render(
    <MemoryRouter>
      <ArenaTable view={v} skew={0} send={(m) => sent.push(m)} review={null} onReview={onReview} />
    </MemoryRouter>,
  );
  return { sent, ...r };
}

describe("the arena table", () => {
  it("shows your cards, the other seat's face down, and your moves on your turn, sent for this hand", () => {
    const { sent } = draw(view());
    const bob = screen.getByRole("listitem", { name: "Bob" });
    expect(within(bob).getAllByRole("img", { name: "face-down card" })).toHaveLength(2);
    const ann = screen.getByRole("listitem", { name: "Ann (you)" });
    expect(within(ann).getByRole("img", { name: "ace of spades" })).toBeInTheDocument();
    expect(within(ann).getByRole("timer")).toHaveTextContent("20s");
    fireEvent.click(screen.getByRole("button", { name: "Call 0.5" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold" }));
    fireEvent.click(screen.getByRole("button", { name: "All-in 100" }));
    fireEvent.click(screen.getByRole("button", { name: /^pot/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Raise to 3/ }));
    expect(sent).toEqual([
      { t: "act", n: 4, action: "call" },
      { t: "act", n: 4, action: "fold" },
      { t: "act", n: 4, action: "all-in" },
      { t: "act", n: 4, action: "raise", to: 3 },
    ]);
  });

  it("offers check and bet with nothing to call, and no moves on the other seat's turn", () => {
    const { sent, unmount } = draw(view(hand({ legal: { toCall: 0, canRaise: true, minTo: 1, allInTo: 98, curBet: 0 }, board: ["2c", "7d", "9h"] })));
    expect(screen.queryByRole("button", { name: "Fold" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "4.5" } });
    fireEvent.click(screen.getByRole("button", { name: /^Bet 4.5/ }));
    expect(sent).toEqual([
      { t: "act", n: 4, action: "check" },
      { t: "act", n: 4, action: "bet", to: 4.5 },
    ]);
    unmount();
    draw(view(hand({ toAct: 1, legal: null })));
    expect(screen.queryByRole("group", { name: "Your move" })).toBeNull();
    expect(screen.getByText("Bob to act.")).toBeInTheDocument();
  });

  it("after a hand: what happened, the shown cards, the next hand, and Review in Analyze with the history", () => {
    const onReview = vi.fn();
    const h = hand({
      toAct: null,
      legal: null,
      deadline: null,
      theirs: ["Ks", "Kh"],
      board: ["2c", "7d", "9h", "Jc", "3s"],
      result: { net: [100, -100], winners: [0], says: "Ann wins 200bb with pair of aces.", history: "THE HISTORY" },
    });
    const { sent } = draw(view(h), onReview);
    expect(screen.getByText(/Ann wins 200bb/)).toHaveTextContent("(+100bb for you)");
    expect(within(screen.getByRole("listitem", { name: "Bob" })).getByRole("img", { name: "king of spades" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next hand" }));
    expect(sent).toEqual([{ t: "next" }]);
    fireEvent.click(screen.getByRole("button", { name: "Review in Analyze" }));
    expect(onReview).toHaveBeenCalledWith("THE HISTORY");
  });

  it("waits for a friend before the first hand, and says who's away", () => {
    draw(view(null, { seats: [{ name: "Ann", connected: true, ready: true, bank: 60_000, score: 0 }, null] }));
    expect(screen.getByText(/Waiting for your friend/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Empty seat" })).toBeInTheDocument();
  });
});
