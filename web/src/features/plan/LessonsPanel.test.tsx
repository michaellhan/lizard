import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@/data/db";
import { LESSONS } from "./lessons";
import { Lessons } from "./LessonsPanel";

const kept = (n: number, ok: number): SessionRecord => ({ id: "d", kind: "drill", startedAt: 1, endedAt: 2, decisions: n, evLossBb: 0, meta: { spot: "srp_btn_bb", view: "ip", byDeal: { "": { n, ok } } } });

describe("Lessons", () => {
  it("says how many are done, gives the next one in full, and lists every lesson by unit with its progress, report and drill", () => {
    render(
      <MemoryRouter>
        <Lessons sessions={[kept(20, 15)]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status", { name: "Lessons done" })).toHaveTextContent(`1 of ${LESSONS.length} done. Next: 2. Paired flops`);
    expect(screen.getAllByRole("listitem")).toHaveLength(LESSONS.length);
    const first = screen.getAllByRole("listitem")[0]!;
    expect(first).toHaveTextContent("1. The button's flop bet after a check✓ done · 75% Best or Correct");
    expect(within(first).getByRole("link", { name: "Drill it again" })).toHaveAttribute("href", "/practice?tab=drills&spot=srp_btn_bb&view=ip");
    const second = screen.getAllByRole("listitem")[1]!;
    expect(second.querySelector("details")).not.toHaveAttribute("open");
    expect(second).toHaveTextContent("0 of 20");
    // (the next one, out of the list, with its drill and its report)
    const panel = screen.getByRole("region", { name: "Lessons" });
    const all = panel.querySelector<HTMLElement>(":scope > details")!;
    expect(within(panel).getAllByRole("link", { name: "Drill it" }).filter((a) => !all.contains(a))).toHaveLength(1);
    expect(within(all).getByText("All 12 lessons")).toBeInTheDocument();
    expect(within(second).getByRole("link", { name: "Read the report" })).toHaveAttribute("href", "/reports?spot=srp_btn_bb&view=ip&group=pair");
    expect(screen.getByRole("heading", { name: "3-bet pots" })).toBeInTheDocument();
  });
});
