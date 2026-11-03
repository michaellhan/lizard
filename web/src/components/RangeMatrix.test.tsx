import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cellValue, RangeMatrix } from "./RangeMatrix";

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

  it("draws hidden actions' shares empty (the action filter)", () => {
    render(<RangeMatrix cells={{ AA: { w: 1, f: [0.25, 0.75] } }} actions={["check", "bet"]} colors={["gray", "red"]} hidden={new Set([0])} />);
    const bars = [...screen.getByRole("gridcell", { name: /^AA:/ }).querySelectorAll<HTMLDivElement>("div > div")];
    expect(bars.map((b) => [b.style.width, b.className.includes("border-y")])).toEqual([
      ["25%", true],
      ["75%", false],
    ]);
  });

  it("shades the EQR view by evm / (eq x pot), and the EV view by a focused action's EV", () => {
    const c = { w: 1, f: [0.5, 0.5], ev: [2, 6], evm: 4, eq: 0.5 };
    expect(cellValue(c, "eqr", null, 10)).toBeCloseTo(0.8);
    expect(cellValue(c, "eqr", 1, 10)).toBeCloseTo(1.2);
    expect(cellValue({ ...c, eq: 0 }, "eqr", null, 10)).toBeNull(); // no equity: no EQR
    expect(cellValue({ ...c, evm: null }, "eqr", null, 10)).toBeNull();
    expect(cellValue(c, "ev", 0)).toBe(2);
    expect(cellValue(c, "ev")).toBe(4);
    expect(cellValue(c, "eq")).toBe(0.5);
    // two cells at the bottom and the top of the scale get different shades; a cell without a value the neutral fill
    render(
      <RangeMatrix
        cells={{ AA: c, KK: { ...c, evm: 2 }, QQ: { ...c, eq: null } }}
        actions={["check", "bet"]}
        colors={["gray", "red"]}
        view="eqr"
        potBb={10}
        evRange={[0.4, 0.8]}
      />,
    );
    const fill = (cls: string) => screen.getByRole("gridcell", { name: new RegExp(`^${cls}:`) }).querySelector<HTMLDivElement>("div")!;
    expect(fill("AA").style.background).not.toBe(fill("KK").style.background);
    expect(fill("QQ").className).toContain("bg-surface-3");
  });
});
