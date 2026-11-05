// Save spot and Save drill's popovers: Escape and Close shut them, the keyboard goes back to the button that opened
// them, and on a phone they sit inside the screen's gutters rather than off its edge.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { StudyHand } from "@/features/study/studyState";
import { fromSearch } from "@/features/study/studyState";
import { SaveSpot } from "@/features/study/SaveSpot";
import { SaveDrill } from "./SaveDrill";

const HAND = fromSearch("p=2&s=100") as StudyHand;

describe.each([
  ["Save spot", /Save spot/, <SaveSpot key="spot" hand={HAND} />],
  ["Save drill", /Save drill/, <SaveDrill key="drill" kind="library" to="/practice?tab=drills" about="A drill" />],
])("%s", (form, button, ui) => {
  const opened = async () => {
    const toggle = await screen.findByRole("button", { name: button });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    return { toggle, box: screen.getByRole("form", { name: form }) };
  };

  it("shuts on Escape and on Close, giving focus back to the button", async () => {
    render(<MemoryRouter>{ui}</MemoryRouter>);
    const a = await opened();
    fireEvent.keyDown(within(a.box).getAllByRole("textbox")[0]!, { key: "Escape" });
    expect(screen.queryByRole("form", { name: form })).toBeNull();
    expect(a.toggle).toHaveFocus();
    expect(a.toggle).toHaveAttribute("aria-expanded", "false");

    const b = await opened();
    fireEvent.click(within(b.box).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("form", { name: form })).toBeNull();
    expect(b.toggle).toHaveFocus();
  });

  it("holds to the gutters on a phone and to its button above that", async () => {
    render(<MemoryRouter>{ui}</MemoryRouter>);
    const { box } = await opened();
    expect(box).toHaveClass("max-sm:fixed", "max-sm:inset-x-4", "sm:absolute", "sm:right-0");
    expect(box.className).not.toMatch(/(^| )(absolute|w-72)( |$)/);
  });
});
