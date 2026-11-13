import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseIds } from "@/engine/plo/cards";
import { handIndex, sortHand } from "@/engine/plo/combos";
import { StructureGrid } from "./StructureGrid";

const idx = (text: string) => handIndex(sortHand(parseIds(text, 4)!));

describe("StructureGrid", () => {
  const hands = Int32Array.from(["AsAhKsKh", "AdAcKdKc", "JsTs9h8h", "Ks9s5h2d"].map(idx));
  const weight = Float32Array.from([1, 1, 2, 0]);
  const start = Float32Array.from([1, 1, 2, 1]);
  const actions = [
    { label: "Check", kind: "check" },
    { label: "Bet 15", kind: "bet" },
  ];
  const strategy = Float32Array.from([0, 0, 0.5, 1, 1, 1, 0.5, 0]);
  const ev = Float32Array.from([10, 12, 3, Number.NaN]);

  it("shows each cell's share and mix, and a cell's combos when picked", () => {
    render(<StructureGrid label="Shapes" whose="OOP hands" hands={hands} weight={weight} start={start} actions={actions} strategy={strategy} ev={ev} />);
    const grid = screen.getByRole("table", { name: "Shapes" });
    // only rows holding weight: the zero-weight hand's row is left out
    expect(within(grid).queryByRole("rowheader", { name: "Other" })).toBeNull();
    const aces = within(grid).getByRole("button", { name: "Two pair ds: 50.0% of the range, Check 0%, Bet 15 100%" });
    within(grid).getByRole("button", { name: "Rundown ds: 50.0% of the range, Check 50%, Bet 15 50%" });
    fireEvent.click(aces);
    const combos = screen.getByRole("table", { name: "Combos in Two pair ds" });
    expect(within(combos).getAllByRole("row")).toHaveLength(3);
    expect(combos.textContent).toContain("12.00");
    expect(screen.getByText(/2 combos, 50.0% of the range, EV 11.00bb/)).toBeTruthy();
    fireEvent.click(aces);
    expect(screen.queryByRole("table", { name: "Combos in Two pair ds" })).toBeNull();
  });

  it("lays out a range with no decision as shares only", () => {
    render(<StructureGrid label="Typed" whose="IP range" hands={hands} weight={Float32Array.from([1, 1, 1, 1])} />);
    expect(screen.getByRole("button", { name: "Other ss: 25.0% of the range" })).toBeTruthy();
  });
});
