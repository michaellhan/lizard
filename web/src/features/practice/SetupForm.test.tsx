// The New session form's board filter on the pot-type modes: offered only there, the flops it leaves said, a filter no
// flop can meet refused, and what it starts with kept.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionOptions } from "./practice";
import { SetupForm } from "./SetupForm";

const OPTS: SessionOptions = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };
const open = (opts: SessionOptions = OPTS, onStart = vi.fn()) => {
  render(<SetupForm players={6} stack={100} opts={opts} onEdit={() => {}} onStart={onStart} />);
  return onStart;
};
const pick = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });

describe("the hand filter", () => {
  const note = () => document.getElementById("hands-note")!;

  it("is only there for a pot drill, and says what's read on what", () => {
    open();
    expect(screen.queryByRole("combobox", { name: "Hands" })).toBeNull();
    pick("Play", "preflop");
    expect(screen.queryByRole("combobox", { name: "Hands" })).toBeNull();
    for (const p of ["srp", "3bet", "4bet", "bvb"]) {
      pick("Play", p);
      expect(screen.getByRole("combobox", { name: "Hands" })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: "Made hands: read on the flop dealt" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Draws: read on the flop dealt" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Hand classes: read on your two cards" })).toBeInTheDocument();
    expect(note()).toHaveTextContent("Made hands and draws are read on the flop dealt, hand classes on your two cards.");
  });

  it("starts the session with it, and says it's graded as ever, once", () => {
    const start = open();
    pick("Play", "3bet");
    pick("Hands", "m:top_tk");
    expect(note()).toHaveTextContent("Top pair, top kicker: read on the flop dealt, at one table.");
    pick("Hands", "c:sa");
    expect(note()).toHaveTextContent("Suited aces: read on your two cards, at one table.");
    expect(note()).toHaveTextContent("graded as any other hand's, against the strategy for every hand you could hold there");
    expect(screen.getAllByText(/graded as any other hand/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start).toHaveBeenCalledWith(6, 100, expect.objectContaining({ pot: "3bet", hand: "c:sa" }));
  });

  it("starts with none on any hand, and off a pot drill", () => {
    const start = open();
    pick("Play", "srp");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start.mock.lastCall![2]).not.toHaveProperty("hand");
    pick("Hands", "m:set");
    pick("Play", "full");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start.mock.lastCall![2]).not.toHaveProperty("hand");
  });

  it("lists what a pot can find: hands it almost never reaches aren't there, and one that's hard says so", () => {
    open();
    pick("Play", "4bet");
    const select = screen.getByRole("combobox", { name: "Hands" }) as HTMLSelectElement;
    const offered = () => [...select.options].map((o) => o.value);
    expect(offered()).toContain("m:quads");
    expect(offered()).not.toContain("m:nothing");
    expect(note()).toHaveTextContent("Hands this pot almost never reaches aren't listed.");
    pick("Hands", "m:trips");
    expect(note()).toHaveTextContent("Rare in 4-bet pots: on the 6-max 100bb charts about 1 deal in 1,081 gets here at the hardest seat, so the 3,000 deals can run out.");
    pick("Hands", "m:quads");
    expect(note()).not.toHaveTextContent("Rare in");
    pick("Play", "srp");
    expect(offered()).toContain("m:nothing");
    expect(note()).not.toHaveTextContent("aren't listed");
  });

  it("drops a choice the next pot doesn't offer, rather than keep it unseen", () => {
    const start = open();
    pick("Play", "srp");
    pick("Hands", "m:nothing");
    pick("Play", "4bet");
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start.mock.lastCall![2]).not.toHaveProperty("hand");
  });

  it("comes back as it was set", () => {
    open({ ...OPTS, pot: "srp", hand: "d:fd" });
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveValue("d:fd");
  });

  it("refuses what the flops can't hold, saying so, until they're widened", () => {
    const start = open();
    pick("Play", "srp");
    pick("Hands", "m:flush");
    pick("Flop: Suits", "rainbow");
    expect(screen.getByRole("alert")).toHaveTextContent("No Flush turned up on these flops: widen them or pick other hands.");
    expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start).not.toHaveBeenCalled();
    pick("Flop: Suits", "mono");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "New session" })).toBeEnabled();
  });

  it("says so if more tables are set, and only then", () => {
    render(<SetupForm players={6} stack={100} opts={{ ...OPTS, pot: "srp", hand: "m:set" }} tables={3} onEdit={() => {}} onStart={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 tables are set, and hands are filtered at one table only: above it they aren't.");
    cleanup();
    open({ ...OPTS, pot: "srp", hand: "m:set" });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the board filter", () => {
  it("is only there for a pot-type mode", () => {
    open();
    expect(screen.queryByRole("combobox", { name: "Flop: Suits" })).toBeNull();
    pick("Play", "preflop");
    expect(screen.queryByRole("combobox", { name: "Flop: Suits" })).toBeNull();
    for (const p of ["srp", "3bet", "4bet", "bvb"]) {
      pick("Play", p);
      expect(screen.getByRole("combobox", { name: "Flop: Suits" })).toBeInTheDocument();
    }
  });

  it("says how many flops fit and starts the session with the filter", () => {
    const start = open();
    pick("Play", "3bet");
    pick("Flop: Suits", "mono");
    expect(screen.getByRole("status")).toHaveTextContent("1,144 of 22,100 flops fit, at one table.");
    pick("Flop: High card", "A");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start).toHaveBeenCalledWith(6, 100, expect.objectContaining({ pot: "3bet", board: { suits: "mono", hi: "A" } }));
  });

  it("refuses a filter no flop can meet, saying so", () => {
    const start = open();
    pick("Play", "srp");
    pick("Flop: Pairing", "trips");
    pick("Flop: Suits", "mono");
    expect(screen.getByRole("alert")).toHaveTextContent("No flop fits these: widen them.");
    expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "New session" }));
    expect(start).not.toHaveBeenCalled();
    pick("Flop: Suits", "");
    expect(screen.getByRole("button", { name: "New session" })).toBeEnabled();
  });

  it("no filter set, or another mode with one still in the form: none goes with the session", () => {
    const start = open();
    pick("Play", "srp");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start).toHaveBeenLastCalledWith(6, 100, expect.objectContaining({ pot: "srp", board: null }));
    pick("Flop: Suits", "mono");
    pick("Play", "full");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start).toHaveBeenLastCalledWith(6, 100, expect.objectContaining({ pot: null, board: null }));
  });

  it("opens with the session's filter", () => {
    open({ ...OPTS, pot: "bvb", board: { pair: "paired" } });
    expect(screen.getByRole("combobox", { name: "Flop: Pairing" })).toHaveDisplayValue("Paired");
    expect(screen.getByRole("status")).toHaveTextContent("3,744 of 22,100 flops fit");
  });
});

describe("grading preflop by the preflop solve", () => {
  const box = () => screen.queryByRole("checkbox", { name: "Grade preflop by the preflop solve" }) as HTMLInputElement | null;
  const typed = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });

  it("is on by default where the game is stored, and a session without it says so", () => {
    const start = open();
    expect(box()!.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start.mock.calls[0]![2]).toMatchObject({ pfSolve: true });
    fireEvent.click(box()!);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    // (said off, so the session keeps it off where an option left out would be read as the default)
    expect(start.mock.calls[1]![2]).toMatchObject({ pfSolve: false });
  });
  it("comes back unticked with a session that had it off", () => {
    open({ ...OPTS, pfSolve: false });
    expect(box()!.checked).toBe(false);
  });
  it("says what the solve is, and that the opponents stay the charts'", () => {
    open();
    const note = document.getElementById("pf-note")!;
    expect(note).toBeVisible();
    expect(note).toHaveTextContent("equilibrium of a simplified class-level preflop game, not a full solve");
    expect(note).toHaveTextContent("the opponents stay the charts");
    expect(note).toHaveTextContent("keep the chart\u2019s grade and say why");
  });
  it("isn't there where no solve is stored, and says why", () => {
    open();
    pick("Players", "8");
    expect(box()).toBeNull();
    expect(screen.getByText(/Preflop is graded by the charts here\. The preflop solve is stored for 2 to 6 players only/)).toBeInTheDocument();
    pick("Players", "2");
    expect(box()).not.toBeNull();
    pick("Players", "6");
    typed("Stack in big blinds", "70");
    expect(screen.getByText(/stored for stacks of 20, 25, .* or 200bb only; the nearest is 60bb/)).toBeInTheDocument();
    expect(box()).toBeNull();
    typed("Stack in big blinds", "100");
    expect(box()).not.toBeNull();
    pick("Play", "srp");
    expect(box()).toBeNull();
    expect(screen.getByText(/no preflop decision to grade/)).toBeInTheDocument();
  });
  it("doesn't go on into a game that has no stored solve", () => {
    const start = open();
    pick("Players", "7");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(start.mock.calls[0]![2]).not.toHaveProperty("pfSolve");
  });
  it("comes back ticked with a session that had it", () => {
    open({ ...OPTS, pfSolve: true });
    expect(box()!.checked).toBe(true);
  });
  describe("offering the solve's raise sizes", () => {
    const sizes = () => screen.queryByRole("checkbox", { name: "Offer the solve's raise sizes" }) as HTMLInputElement | null;

    it("is there only while the first is ticked, and off by default", () => {
      const start = open();
      expect(sizes()!.checked).toBe(false);
      fireEvent.click(box()!);
      expect(sizes()).toBeNull();
      fireEvent.click(box()!);
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      expect(start.mock.calls[0]![2]).toMatchObject({ pfSolve: true });
      expect(start.mock.calls[0]![2]).not.toHaveProperty("pfSizes");
    });
    it("starts the session with it once it's ticked, and never without the first", () => {
      const start = open();
      fireEvent.click(sizes()!);
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      expect(start.mock.calls[0]![2]).toMatchObject({ pfSolve: true, pfSizes: true });
      fireEvent.click(box()!);
      expect(sizes()).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      expect(start.mock.calls[1]![2]).toMatchObject({ pfSolve: false });
      expect(start.mock.calls[1]![2]).not.toHaveProperty("pfSizes");
    });
    it("says its cost in plain words before you tick it, and what it is once you have", () => {
      open();
      const note = document.getElementById("pf-note")!;
      expect(sizes()).toHaveAccessibleDescription(/not a full solve/);
      expect(note).toHaveTextContent("12bb, not the chart\u2019s 10bb");
      expect(note).toHaveTextContent("leave the flop library");
      fireEvent.click(sizes()!);
      expect(note).toHaveTextContent("equilibrium of a simplified class-level preflop game, not a full solve");
      expect(note).toHaveTextContent("12bb, not the chart\u2019s 10bb");
      expect(note).toHaveTextContent("leave the flop library");
      expect(note).not.toHaveTextContent("Your options and the opponents stay the charts");
      expect(note).toHaveTextContent("The opponents stay the charts");
    });
    it("doesn't go on into a game with no stored solve", () => {
      const start = open();
      fireEvent.click(sizes()!);
      pick("Players", "7");
      expect(sizes()).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      expect(start.mock.calls[0]![2]).not.toHaveProperty("pfSizes");
    });
    it("comes back ticked with a session that had it", () => {
      open({ ...OPTS, pfSolve: true, pfSizes: true });
      expect(sizes()!.checked).toBe(true);
    });
  });
});
