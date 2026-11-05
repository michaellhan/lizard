import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { rowKeys, rowMove } from "./rowKeys";

describe("rowMove", () => {
  it("goes round the row, and a tablist leaves Up and Down alone", () => {
    expect(rowMove(2, 3, "ArrowRight")).toBe(0);
    expect(rowMove(0, 3, "ArrowLeft")).toBe(2);
    expect(rowMove(0, 3, "ArrowDown")).toBe(1);
    expect(rowMove(1, 3, "ArrowUp")).toBe(0);
    expect(rowMove(1, 3, "Home")).toBe(0);
    expect(rowMove(1, 3, "End")).toBe(2);
    expect(rowMove(0, 3, "ArrowDown", true)).toBeNull();
    expect(rowMove(0, 3, "ArrowRight", true)).toBe(1);
    expect(rowMove(0, 3, "a")).toBeNull();
    expect(rowMove(-1, 3, "ArrowRight")).toBeNull();
  });
});

describe("rowKeys", () => {
  it("moves focus and picks, and takes the key from the page", () => {
    const pick = vi.fn();
    render(
      <div role="radiogroup" aria-label="Row" onKeyDown={rowKeys("radio", pick)}>
        <button type="button" role="radio" aria-checked>
          One
        </button>
        <button type="button" role="radio" aria-checked={false}>
          Two
        </button>
      </div>,
    );
    const one = screen.getByRole("radio", { name: "One" });
    one.focus();
    expect(fireEvent.keyDown(one, { key: "ArrowRight" })).toBe(false);
    expect(pick).toHaveBeenCalledWith(1);
    expect(screen.getByRole("radio", { name: "Two" })).toHaveFocus();
    expect(fireEvent.keyDown(one, { key: "ArrowRight", shiftKey: true })).toBe(true);
    expect(pick).toHaveBeenCalledTimes(1);
  });
});
