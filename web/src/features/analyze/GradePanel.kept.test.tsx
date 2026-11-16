// The grading scope last picked is the one the panel opens on.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { GradePanel } from "./GradingPanel";

const panel = () =>
  render(
    <MemoryRouter>
      <GradePanel hands={[]} decisions={[]} onGraded={() => {}} />
    </MemoryRouter>,
  );

it("opens on the scope last picked", () => {
  const first = panel();
  expect(screen.getByRole("combobox", { name: "Grade" })).toHaveValue("triage");
  fireEvent.change(screen.getByRole("combobox", { name: "Grade" }), { target: { value: "library" } });
  first.unmount();
  panel();
  expect(screen.getByRole("combobox", { name: "Grade" })).toHaveValue("library");
});
