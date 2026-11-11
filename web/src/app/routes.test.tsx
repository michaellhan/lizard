// The home page's badges follow docs/FEATURE_MATRIX.md: each page names the rows it delivers, and its badge reads
// "Working" only where every one of them is graded WORKING there, else how many are. A regrade in the matrix that isn't
// made in routes.ts GRADES fails here, so the badges can't drift back to what they said months ago.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { HomePage } from "@/features/home/HomePage";
import { GRADES, routeGrade, ROUTES, type Grade } from "./routes";

/** Every feature row of the matrix by name, with its Lizard grade (the fourth column). */
function matrix(): Map<string, Grade> {
  const text = readFileSync(resolve(__dirname, "../../../docs/FEATURE_MATRIX.md"), "utf8");
  const rows = new Map<string, Grade>();
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const g = cells[4] as Grade;
    if (cells.length > 6 && ["WORKING", "PARTIAL", "APPROXIMATE", "NOT IMPLEMENTED"].includes(g)) rows.set(cells[1]!, g);
  }
  return rows;
}

describe("the pages' badges", () => {
  const m = matrix();

  it("name only rows the matrix has, graded as it grades them", () => {
    expect(m.size).toBeGreaterThan(50);
    for (const r of ROUTES) for (const n of r.rows ?? []) expect(m.has(n), `${r.path}: no matrix row "${n}"`).toBe(true);
    for (const [n, g] of Object.entries(GRADES)) expect(g, `"${n}" is ${m.get(n)} in docs/FEATURE_MATRIX.md`).toBe(m.get(n));
  });

  it("give every page in the nav, but Library, rows of its own", () => {
    for (const r of ROUTES.filter((x) => x.nav && x.path !== "library")) expect(r.rows?.length, r.path).toBeGreaterThan(0);
  });

  it("say working only where every row is, else how many are and which aren't", () => {
    const study = routeGrade(ROUTES.find((r) => r.path === "study")!);
    expect(study.status).toBe(study.others.length ? "partial" : "working");
    expect(study.others).toContainEqual(["Preflop", "APPROXIMATE"]);
    expect(routeGrade(ROUTES.find((r) => r.path === "reports")!)).toMatchObject({ status: "working", working: 1, total: 1 });
    expect(routeGrade(ROUTES.find((r) => r.path === "library")!).status).toBe("working");
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    // the home page is for players: the four main pages and the rest in a list, no build grades
    expect(screen.getByRole("link", { name: /^Study/ })).toHaveAttribute("href", "/study");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/reports");
    expect(screen.queryByText(/of \d+ working/)).toBeNull();
  });
});
