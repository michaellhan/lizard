import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useSettings } from "@/state/settings";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("draws plain colours by default, and puts the patterns on the whole page on request", () => {
    useSettings.getState().reset();
    render(<SettingsPage />, { wrapper: MemoryRouter });
    const box = screen.getByRole("checkbox", { name: "Patterns on action colours" });
    expect(box).not.toBeChecked();
    expect(document.documentElement.dataset.patterns).toBeUndefined();
    fireEvent.click(box);
    expect(useSettings.getState().actionPatterns).toBe(true);
    expect(document.documentElement.dataset.patterns).toBe("on");
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(document.documentElement.dataset.patterns).toBeUndefined();
  });

  it("reaches Engine from here, as a phone hides the status pill", () => {
    render(<SettingsPage />, { wrapper: MemoryRouter });
    expect(screen.getByRole("link", { name: "Engine status" })).toHaveAttribute("href", "/engine");
    expect(screen.getByRole("link", { name: "What’s precomputed" })).toHaveAttribute("href", "/library");
    for (const gone of ["Use its speed", "Clear"]) expect(screen.queryByRole("button", { name: gone })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Keyboard shortcuts in Study" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Library source" })).toBeNull();
  });
});
