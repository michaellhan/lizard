import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { kvSet } from "@/data/db";
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

  it("re-checks Quick's grades at Fast by default, and turns it off on request", () => {
    useSettings.getState().reset();
    render(<SettingsPage />, { wrapper: MemoryRouter });
    const box = screen.getByRole("checkbox", { name: "Re-check Quick grades at Fast when the solver is idle" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(useSettings.getState().recheckFast).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(useSettings.getState().recheckFast).toBe(true);
  });

  it("has it on for settings saved before it, and off where it was turned off", async () => {
    await kvSet("settings.v1", { mode: "fast", keepHands: true });
    await useSettings.getState().load();
    expect(useSettings.getState()).toMatchObject({ recheckFast: true, keepHands: true });
    await kvSet("settings.v1", { mode: "fast", recheckFast: false });
    await useSettings.getState().load();
    expect(useSettings.getState().recheckFast).toBe(false);
    useSettings.getState().reset();
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
