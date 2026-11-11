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
    expect(screen.getByText(/no EV stored/)).toBeTruthy();
    expect(screen.queryByText(/preflop charts/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "EV bb" })).toBeNull();
  });
  it("marks an EV the answer calls rough, in the table and in what was given up", () => {
    const d = decision("live");
    d.mix = [
      { action: "check", freq: 1, ev: 4 },
      { action: "bet", freq: 0, ev: 1, amount: 7.13, rough: true },
    ];
    d.grade = { a: 1, best: 0, byEv: true, loss: 3, lossPct: 31.6, verdict: "blunder", mixed: false } as never;
    render(
      <MemoryRouter>
        <DecisionView d={d} players={2} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("cell", { name: "≈1.00" })).toBeTruthy();
    expect(screen.getByText(/EV given up: ≈3\.00bb/)).toBeTruthy();
  });
  it("still says so for the preflop charts", () => {
    show("charts");
    expect(screen.getByText(/charts have no EVs/)).toBeTruthy();
    // (a column of dashes would say there's something to read)
    expect(screen.queryByRole("columnheader", { name: "EV bb" })).toBeNull();
  });
  it("calls a grade by the preflop solve a class-level model's", () => {
    const d = decision("preflop-solve");
    d.grade = { ...d.grade!, byEv: true };
    d.mix = [{ action: "check", freq: 1, ev: 1 }, { action: "bet", freq: 0, ev: 0.5 }];
    render(
      <MemoryRouter>
        <DecisionView d={d} players={6} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /class-level model/ })).toBeTruthy();
    expect(screen.queryByText(/Chart.s grade/)).toBeNull();
  });
  it("says why a decision in such a session took the chart's grade, and calls it the chart's", () => {
    const d = decision("charts");
    d.pfWhy = "The solve's options aren't yours here.";
    render(
      <MemoryRouter>
        <DecisionView d={d} players={6} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Chart.s grade, not the solve.s: The solve.s options aren.t yours here\./)).toBeTruthy();
    expect(screen.getByText(/Graded by chart frequency/)).toBeTruthy();
    expect(screen.queryByText(/not a full solve/)).toBeNull();
  });
  it("says neither of a decision in any other session", () => {
    show("charts");
    expect(screen.queryByText(/preflop solve/)).toBeNull();
  });
});
