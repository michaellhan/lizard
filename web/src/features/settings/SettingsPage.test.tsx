// Settings: the classic app's speed, read on request (fake-indexeddb), and used as the solve mode.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useSettings } from "@/state/settings";
import { classicDb } from "@/test/classic";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  it("uses the classic app's speed on request, and says when it saved none", async () => {
    render(<SettingsPage />, { wrapper: MemoryRouter });
    const accuracy = screen.getByRole("radiogroup", { name: "Solve accuracy" });
    expect(screen.getByRole("radio", { name: "Fast" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Use its speed" }));
    expect(await screen.findByRole("status")).toHaveTextContent("The classic app has no speed saved in this browser.");
    expect(useSettings.getState().mode).toBe("fast");
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain("gto-store");

    // the classic store's kv: "gto-speed" saved as "accurate"
    await classicDb("gto-store", []);
    fireEvent.click(screen.getByRole("button", { name: "Use its speed" }));
    expect(await screen.findByText("Set to Accurate, the classic app's speed.")).toBeInTheDocument();
    expect(useSettings.getState().mode).toBe("accurate");
    expect(accuracy.querySelector('[aria-checked="true"]')).toHaveTextContent("Accurate");
  });

  it("reaches Engine from here, as a phone hides the status pill", () => {
    render(<SettingsPage />, { wrapper: MemoryRouter });
    expect(screen.getByRole("link", { name: "Engine status" })).toHaveAttribute("href", "/engine");
  });
});
