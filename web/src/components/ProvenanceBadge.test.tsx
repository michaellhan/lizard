import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Provenance } from "@/solver/types";
import { describe as describeProvenance } from "@/solver/provenance";
import { ProvenanceBadge, ProvenanceDetail } from "./ProvenanceBadge";

const p: Provenance = { source: "live", mode: "quick", transport: "worker", solverVersion: "1.2", seconds: 1.5, fallbackReason: "the worker died", approximate: true, partial: false, receivedAt: 0 };

describe("ProvenanceBadge", () => {
  it("keeps its words in view, and opens to its detail from a button, not only a title", () => {
    render(<ProvenanceBadge p={p} />);
    const b = screen.getByRole("button", { name: describeProvenance(p) });
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("fallback: the worker died")).toBeNull();
    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(b.getAttribute("aria-controls")!)).toHaveTextContent("fallback: the worker died");
    expect(screen.getByText("1.50 s")).toBeInTheDocument();
    expect(screen.getByText("mode quick · worker · solver 1.2")).toBeInTheDocument();
    fireEvent.click(b);
    expect(screen.queryByText("1.50 s")).toBeNull();
  });

  it("makes no tab stop when quiet, and the panel's one disclosure holds each different answer once", () => {
    render(
      <>
        <ProvenanceBadge p={p} quiet />
        <ProvenanceBadge p={p} quiet />
        <ProvenanceDetail ps={[p, p, { ...p, seconds: 2 }]} />
      </>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "How this was produced" }));
    expect(screen.getAllByText(describeProvenance(p))).toHaveLength(4); // two badges, two answers in the list
    expect(screen.getByText("1.50 s")).toBeInTheDocument();
    expect(screen.getByText("2.00 s")).toBeInTheDocument();
    cleanup();
    const { container } = render(<ProvenanceDetail ps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
