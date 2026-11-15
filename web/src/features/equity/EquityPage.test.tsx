import { fireEvent, render as renderPage, screen, waitFor } from "@testing-library/react";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { EquityPage } from "./EquityPage";

const render = (ui: ReactElement) => renderPage(<MemoryRouter>{ui}</MemoryRouter>);

// jsdom has no Worker, so the page runs its slices on the page: the same job (engine/plo/equityRun.test.ts has the worker)

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const calculate = () => fireEvent.click(screen.getByRole("button", { name: "Calculate" }));

describe("EquityPage", () => {
  it("says it's a calculator, not a solver", () => {
    render(<EquityPage />);
    expect(screen.getByRole("heading", { name: "PLO4 equity" })).toBeTruthy();
    expect(screen.getByText(/A calculator, not a strategy/).textContent).toMatch(/one heads-up river/);
  });

  it("gives an exact count, labelled as one, with no ± to it", async () => {
    render(<EquityPage />);
    type("Board", "2c7h9d");
    calculate();
    expect(await screen.findByText("Exact: every board counted, 820 boards.")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(table.textContent).toContain("JdTd9c8c");
    expect(table.textContent).not.toContain("±");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("gives a Monte Carlo with its runs, seed and standard error", async () => {
    render(<EquityPage />);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "montecarlo" } });
    type("Monte Carlo runouts", "5000");
    type("Monte Carlo seed", "9");
    calculate();
    expect(await screen.findByText("Monte Carlo: 5,000 random runouts, seed 9; ± is one standard error.")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "± 1 s.e." })).toBeTruthy();
  });

  it("goes to Monte Carlo by itself when a range is too much to count, and says so", async () => {
    render(<EquityPage />);
    type("Player 2: hand or range", "JTxx");
    type("Monte Carlo runouts", "2000");
    calculate();
    expect(await screen.findByText(/^Monte Carlo: 2,000 random runouts/)).toBeTruthy();
  });

  it("shows what's wrong with the input", async () => {
    render(<EquityPage />);
    type("Player 2: hand or range", "hello");
    calculate();
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Player 2:/);
    type("Player 2: hand or range", "AsTd9c8c");
    calculate();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/same card/));
  });

  it("adds and removes players, between 2 and 9", () => {
    render(<EquityPage />);
    const remove = screen.getByRole<HTMLButtonElement>("button", { name: "Remove the last" });
    expect(remove.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add a player" }));
    expect(screen.getByLabelText("Player 3: hand or range")).toBeTruthy();
    expect(remove.disabled).toBe(false);
  });

  it("can be cancelled, and keeps the page's answer honest: a Monte Carlo says where it stopped", async () => {
    render(<EquityPage />);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "montecarlo" } });
    type("Monte Carlo runouts", "500000000");
    calculate();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText(/stopped at .* of 500,000,000/)).toBeTruthy();
  });

  it("a cancelled exact count shows no numbers", async () => {
    render(<EquityPage />);
    type("Player 1: hand or range", "AAKK,AAQQ"); // 72 matchups, each of a million boards
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "exact" } });
    calculate();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText(/an exact count needs every board/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("the initial bundle", () => {
  const src = join(__dirname, "..", "..");

  it("holds no PLO code: nothing the first page loads statically reaches it", () => {
    // Every file main.tsx reaches through static imports (`import ... from`, not `import()`), the initial bundle. PLO
    // code (engine/plo, features/plo, features/equity) may only be reached through a dynamic import, as the routes and
    // Study's and Practice's PLO panels are (lazy).
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? join(src, spec.slice(2)) : spec.startsWith(".") ? join(from, "..", spec) : null;
      if (!base) return null;
      for (const f of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
        try {
          if (statSync(f).isFile()) return f;
        } catch {
          /* not this one */
        }
      }
      return null;
    };
    const reached = new Set<string>();
    const queue = [join(src, "main.tsx")];
    while (queue.length) {
      const f = queue.pop()!;
      if (reached.has(f)) continue;
      reached.add(f);
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of text.matchAll(/(?:^|[\s;])(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?"([^"]+)"/g)) {
        const to = resolve(f, m[1]!);
        if (to && /\.tsx?$/.test(to)) queue.push(to);
      }
    }
    expect(reached.size).toBeGreaterThan(30);
    const plo = [...reached].filter((f) => /\/(engine\/plo|features\/plo|features\/equity)\//.test(f));
    expect(plo).toEqual([]);
    const app = readFileSync(join(src, "app", "App.tsx"), "utf8");
    expect(app).toMatch(/import\("@\/features\/equity\/EquityPage"\)/);
    expect(app).toMatch(/import\("@\/features\/plo\/PloRiverPage"\)/);
  });
});
