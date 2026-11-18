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
  it("says a grade was re-checked at Fast and what Quick said, and leaves how settled Fast is to its badge", () => {
    const d = decision("live");
    d.grade = { a: 0, best: 0, byEv: true, loss: 0, lossPct: 0, verdict: "Correct", ok: true, mixed: false } as never;
    d.mix = [{ action: "check", freq: 0.7, ev: 1 }, { action: "bet", freq: 0.3, ev: 0.9, amount: 7.13 }];
    d.provenance = { source: "live", approximate: false, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, exploitabilityPct: 0.4, iterations: 300, band: "converged" };
    d.quick = { verdict: "Mistake", ok: false, best: "bet", byEv: true, loss: 0.8, lossPct: 8.4, source: "live" };
    const { unmount } = render(
      <MemoryRouter>
        <DecisionView d={d} players={2} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Re-checked at Fast: Mistake → Correct\./)).toBeTruthy();
    expect(screen.getByText(/A Quick solve graded this Mistake \(its best: bet\)/)).toBeTruthy();
    expect(screen.getByText(/how close it came to equilibrium is in its badge/)).toBeTruthy();
    // (its band says converged, measured: nothing here says otherwise)
    expect(screen.queryByText(/not a converged one/)).toBeNull();
    unmount();
    render(
      <MemoryRouter>
        <DecisionView d={{ ...decision("live"), recheckFailed: "Stopped twice." }} players={2} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Not re-checked at Fast \(Stopped twice\): this grade is on a Quick solve\./)).toBeTruthy();
    expect(screen.queryByText(/Re-checked at Fast:/)).toBeNull();
  });

  it("never calls a rules answer a solve beside its badge", () => {
    const d = decision("rules");
    d.grade = { a: 0, best: 0, byEv: true, loss: 0, lossPct: 0, verdict: "Correct", ok: true, mixed: false } as never;
    d.mix = [{ action: "check", freq: 0.7, ev: 1 }, { action: "bet", freq: 0.3, ev: 0.9, amount: 7.13 }];
    d.provenance = { source: "rules", approximate: true, mode: "fast", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0 };
    d.quick = { verdict: "Correct", ok: true, best: "check", byEv: true, loss: 0, lossPct: 0, source: "rules" };
    render(
      <MemoryRouter>
        <DecisionView d={d} players={2} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Quick.s answer, Heuristic rules \(not a solve\), graded this Correct/)).toBeTruthy();
    expect(screen.queryByText(/short solve|Fast solve|Quick solve/)).toBeNull();
  });
});
