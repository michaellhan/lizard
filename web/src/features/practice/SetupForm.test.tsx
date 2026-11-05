// The New session form's board filter on the pot-type modes: offered only there, the flops it leaves said, a filter no
// flop can meet refused, and what it starts with kept.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionOptions } from "./practice";
import { SetupForm } from "./SetupForm";

const OPTS: SessionOptions = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };
const open = (opts: SessionOptions = OPTS, onStart = vi.fn()) => {
  render(<SetupForm players={6} stack={100} opts={opts} onEdit={() => {}} onStart={onStart} />);
  return onStart;
};
const pick = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });

describe("the board filter", () => {
  it("is only there for a pot-type mode", () => {
    open();
    expect(screen.queryByRole("combobox", { name: "Flop: Suits" })).toBeNull();
    pick("Play", "preflop");
    expect(screen.queryByRole("combobox", { name: "Flop: Suits" })).toBeNull();
    for (const p of ["srp", "3bet", "bvb"]) {
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
