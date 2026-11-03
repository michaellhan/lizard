import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RangeMatrix } from "./RangeMatrix";

describe("RangeMatrix", () => {
  it("renders 169 labelled cells that say their range weight and mix", () => {
    const onSelect = vi.fn();
    render(
      <RangeMatrix
        cells={{ AA: { w: 1, f: [0, 1] }, "72o": { w: 0.5, f: [1, 0] } }}
        actions={["fold", "raise 2.5"]}
        colors={["gray", "red"]}
        onSelect={onSelect}
        caption="BTN opening range"
      />,
    );
    expect(screen.getAllByRole("gridcell")).toHaveLength(169);
    expect(screen.getByRole("gridcell", { name: /^AA: 100% in range, fold 0%, raise 2.5 100%/ })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^72o: 50% in range/ })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "KK: not in range" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    expect(onSelect).toHaveBeenCalledWith("AA");
  });

  it("says nothing of EV or equity a cell does not have (the Advisor's nulls)", () => {
    render(
      <RangeMatrix
        cells={{ AA: { w: 1, f: [0, 1], ev: null, evm: null, eq: null }, KK: { w: 1, f: [0, 1], ev: [1, 2], evm: 2, eq: 0.8 } }}
        actions={["fold", "raise 2.5"]}
        colors={["gray", "red"]}
        view="eq"
      />,
    );
    expect(screen.getByRole("gridcell", { name: "AA: 100% in range, fold 0%, raise 2.5 100%" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^KK: .*, EV 2\.00bb, equity 80%$/ })).toBeInTheDocument();
  });
});
