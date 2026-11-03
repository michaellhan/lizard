// The Reports page on the fixture library (src/test/library.ts), read through a stubbed fetch: a spot's flops with
// their provenance and coverage, the views, filters, grouping and sorting in the URL, Study links, the CSV.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { libFile, libJson } from "@/test/library";
import { LibraryFiles, type LibraryReport } from "@/library/files";
import { ReportsPage } from "./ReportsPage";

const fakeFetch = (async (url: string) => {
  const path = String(url).replace(/^lib\//, "").split("?")[0]!;
  try {
    return new Response(new Uint8Array(libFile(path)));
  } catch {
    return new Response("missing", { status: 404 });
  }
}) as unknown as typeof fetch;

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const open = (q = "", files = new LibraryFiles("lib/", fakeFetch), rowLimit?: number) =>
  render(
    <MemoryRouter initialEntries={[`/reports${q ? `?${q}` : ""}`]}>
      <Routes>
        <Route path="/reports" element={<><ReportsPage files={files} rowLimit={rowLimit} /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
const flopRows = () => screen.getAllByRole("row").filter((r) => /^[2-9TJQKA][shdc]{1}/.test(r.getAttribute("aria-label") ?? "")).map((r) => r.getAttribute("aria-label"));
const REP = libJson<LibraryReport>("srp_btn_bb/report.json");

afterEach(() => vi.restoreAllMocks());

describe("ReportsPage", () => {
  it("shows a spot's stored flops with the report's provenance and coverage, sorted high flop first", async () => {
    open("spot=srp_btn_bb");
    expect(await screen.findByText(/^Precomputed solution · srp_btn_bb · flop report over its 7 stored flops$/)).toBeInTheDocument();
    const w = REP.flops.reduce((a, f) => a + f.w, 0);
    expect(screen.getByText(`7 of 1,755 flops stored, standing for ${((w / 22100) * 100).toFixed(1)}% of all 22,100`)).toBeInTheDocument();
    expect(flopRows()).toHaveLength(7);
    // the average row: frequencies weighted, summing to 100%
    const avg = screen.getByRole("row", { name: "Average" });
    expect(avg).toHaveTextContent("All stored flops");
    const cells = within(avg).getAllByRole("cell").slice(2, 5).map((c) => parseFloat(c.textContent!));
    expect(Math.abs(cells.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(0.3);
    // columns: the view's actions, each player's EV, equity and EQR
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Flop ▾", "Strategy", "Check", "Bet 33%", "Bet 75%", "BB EV", "BTN EV", "BB eq", "BTN eq", "BB EQR", "BTN EQR", "Study"]);
    // one row's EQR: EV over equity times the pot
    const fl = REP.flops[0]!;
    const row = screen.getByRole("row", { name: fl.f });
    expect(row).toHaveTextContent((fl.ev![1] / (fl.eq![1] * REP.pot)).toFixed(2));
    expect(within(row).getByRole("link", { name: "Study" }).getAttribute("href")).toBe(
      `/study?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac&b=${fl.f}`,
    );
    // the spots that have reports
    expect(screen.getByText(/Which spots have reports \(3 in the library\)/)).toBeInTheDocument();
  });

  it("keeps the view, filters, grouping and sort in the URL", async () => {
    open("spot=srp_btn_bb");
    await screen.findByRole("row", { name: "Average" });
    fireEvent.click(screen.getByRole("button", { name: "BB vs bet" }));
    expect(screen.getByRole("button", { name: "BB vs bet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("columnheader").slice(2, 5).map((h) => h.textContent)).toEqual(["Fold", "Call", "Raise"]);
    expect(screen.getByTestId("where").textContent).toMatch(/view=vsbet/);
    // a flop row facing a bet opens Study at that bet
    const r = screen.getAllByRole("row").find((x) => x.textContent?.includes("vs "))!;
    expect(within(r).getByRole("link", { name: "Study" }).getAttribute("href")).toMatch(/&flop=BB%3Ax%2CBTN%3Ab\d/);

    // grouped by pairing, then a group's button filters to it
    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), { target: { value: "pair" } });
    const unpaired = REP.flops.filter((f) => new Set(f.f.match(/[2-9TJQKA](?=[shdc])/g)).size === 3).length;
    expect(screen.getByRole("row", { name: "Unpaired" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("row", { name: "Unpaired" })).getByRole("button", { name: "Unpaired" }));
    await waitFor(() => expect(flopRows()).toHaveLength(unpaired));
    expect(screen.getByRole("combobox", { name: "Pairing" })).toHaveValue("unpaired");
    expect(screen.getByTestId("where").textContent).toMatch(/pair=unpaired/);
    expect(screen.getByTestId("where").textContent).not.toMatch(/group=/);

    // sort by the first action, highest first, then the other way
    fireEvent.click(screen.getByRole("button", { name: "Fold" }));
    expect(screen.getByRole("columnheader", { name: "Fold ▾" })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: "Fold ▾" }));
    expect(screen.getByRole("columnheader", { name: "Fold ▴" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByTestId("where").textContent).toMatch(/sort=a0&desc=0/);
  });

  it("lists the first flops of a long report, all of them on request, averaging over every flop", async () => {
    open("spot=srp_btn_bb", undefined, 3);
    const avg = await screen.findByRole("row", { name: "Average" });
    expect(avg).toHaveTextContent("All stored flops");
    expect(flopRows()).toHaveLength(3);
    expect(screen.getByText(/^3 of 7 flops listed, in this order; the averages above take all of them\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 7 flops" }));
    expect(flopRows()).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("downloads the rows shown as CSV", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (created.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    open("spot=srp_co_bb&suits=rainbow");
    await screen.findByRole("row", { name: "Average" });
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(click).toHaveBeenCalledOnce();
    const lines = (await created[0]!.text()).trim().split("\n");
    expect(lines[0]).toMatch(/^flop,weight,share of flops,high card,suits,pairing,connectedness,check,/);
    expect(lines.slice(1).every((l) => l.split(",")[4] === "rainbow")).toBe(true);
    expect(lines).toHaveLength(flopRows().length + 1);
    expect(lines[1]).toMatch(/,Precomputed solution · srp_co_bb · flop report over its 3 stored flops$/);
  });

  it("says when a library has no report for a spot, and when it can't be read", async () => {
    const noReports = (async (url: string) => {
      const path = String(url).replace(/^lib\//, "").split("?")[0]!;
      if (path === "index.json") {
        const idx = JSON.parse(libFile(path).toString("utf8")) as { spots: { report?: string }[] };
        return new Response(JSON.stringify({ ...idx, spots: idx.spots.map(({ report: _, ...s }) => s) }));
      }
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;
    const a = open("", new LibraryFiles("lib/", noReports));
    expect(await screen.findByText("This library has no spot with a flop report.")).toBeInTheDocument();
    expect(screen.getByText(/Which spots have reports \(0 in the library\)/)).toBeInTheDocument();
    a.unmount();
    open("", new LibraryFiles("lib/", (async () => new Response("down", { status: 503 })) as unknown as typeof fetch));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t read the library: couldn't load index.json (503)");
  });
});
