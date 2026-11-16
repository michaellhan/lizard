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

  it("holds backup and restore, and none of the settings that went", () => {
    render(<SettingsPage />, { wrapper: MemoryRouter });
    expect(screen.getByRole("region", { name: "Backup" })).toHaveAttribute("id", "backup");
    expect(screen.getByRole("button", { name: "Download backup" })).toBeInTheDocument();
    for (const gone of ["Use its speed", "Clear"]) expect(screen.queryByRole("button", { name: gone })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Keyboard shortcuts in Study" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Library source" })).toBeNull();
  });
});
