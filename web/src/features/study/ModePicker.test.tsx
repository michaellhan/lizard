import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettings } from "@/state/settings";
import { ModePicker } from "./ModePicker";

beforeEach(() => act(() => useSettings.getState().set({ mode: "fast" })));

describe("ModePicker", () => {
  it("is one tab stop, moved and picked with the arrows", () => {
    render(<ModePicker />);
    const [quick, fast, accurate] = screen.getAllByRole("radio");
    expect([quick, fast, accurate].map((r) => r!.tabIndex)).toEqual([-1, 0, -1]);
    fast!.focus();
    fireEvent.keyDown(fast!, { key: "ArrowRight" });
    expect(useSettings.getState().mode).toBe("accurate");
    expect(accurate).toHaveFocus();
    expect(accurate).toBeChecked();
    expect([quick, fast, accurate].map((r) => r!.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(accurate!, { key: "ArrowRight" });
    expect(useSettings.getState().mode).toBe("quick");
    expect(quick).toHaveFocus();
  });
});
