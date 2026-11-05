// What a graded decision says about its grade: a stored turn has no EV and was never the preflop chart.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { DecisionView } from "./PracticeParts";
import type { Decision } from "./practice";

const decision = (source: string): Omit<Decision, "move"> =>
  ({
    street: "turn",
    chose: "check",
    pot: 9.5,
    study: null,
    mix: [
      { action: "check", freq: 1, ev: null },
      { action: "bet", freq: 0, ev: null, amount: 7.13 },
    ],
    grade: { a: 0, best: 0, byEv: false, loss: 0, lossPct: 0, verdict: "best", mixed: false },
    provenance: { source, label: "x", approximate: true },
  }) as unknown as Omit<Decision, "move">;

const show = (source: string) =>
  render(
    <MemoryRouter>
      <DecisionView d={decision(source)} players={2} />
    </MemoryRouter>,
  );

describe("DecisionView", () => {
  it("doesn't call a stored turn the chart, and has no EV column for it", () => {
    show("library-turn");
    expect(screen.getByText(/no EV is stored for it/)).toBeTruthy();
    expect(screen.queryByText(/preflop charts/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "EV bb" })).toBeNull();
    expect(screen.getByText(/Your hand.s frequencies at this heads-up spot/)).toBeTruthy();
  });
  it("still says so for the preflop charts", () => {
    show("charts");
    expect(screen.getByText(/the preflop charts have no EVs/)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "EV bb" })).toBeTruthy();
  });
});
