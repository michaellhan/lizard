// The Reports page on the fixture library (src/test/library.ts), read through a stubbed fetch: a spot's flops with
// their provenance and coverage, the views, filters, grouping and sorting in the URL, Study links, the CSV.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { libFile, libJson } from "@/test/library";
import { LibraryFiles, type LibraryReport } from "@/library/files";
import { stepClip } from "./ReportChart";
import { ReportsPage } from "./ReportsPage";
import { rows, sortRows } from "./reports";

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
    expect(heads).toEqual(["Flop ▾", "Strategy", "Check", "Bet 33%", "Bet 75%", "BB EV", "BTN EV", "BB eq", "BTN eq", "BB EQR", "BTN EQR", "Range adv", "Study"]);
    // the range advantage, a row's and the average's, with its definition, and why there's no nut advantage
    const lead = (eq: [number, number]) => `${eq[1] > eq[0] ? "BTN" : "BB"} +${(Math.abs(eq[1] - eq[0]) * 100).toFixed(1)}`;
    expect(within(screen.getByRole("row", { name: REP.flops[0]!.f })).getAllByRole("cell").at(-2)).toHaveTextContent(lead(REP.flops[0]!.eq as [number, number]));
    const sum = REP.flops.reduce((a, f) => a + f.w, 0);
    const mean = [0, 1].map((i) => REP.flops.reduce((a, f) => a + f.w * f.eq![i]!, 0) / sum) as [number, number];
    expect(within(avg).getAllByRole("cell").at(-2)).toHaveTextContent(lead(mean));
    expect(screen.queryByText(/Nut adv/)).toBeNull();
    // one row's EQR: EV over equity times the pot
    const fl = REP.flops[0]!;
    const row = screen.getByRole("row", { name: fl.f });
    expect(row).toHaveTextContent((fl.ev![1] / (fl.eq![1] * REP.pot)).toFixed(2));
    expect(within(row).getByRole("link", { name: "Study" }).getAttribute("href")).toBe(
      `/study?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac&b=${fl.f}`,
    );
    // the spots that have reports
    expect(screen.getByText(/Which spots have reports \(4 in the library\)/)).toBeInTheDocument();
  });

  it("has a Nut adv column with its definition where the library has nuts.json, and none where it hasn't", async () => {
    const nuts = { format: 1, nut_eq: 0.8, fp: libJson<{ fp: string[] }>("srp_btn_bb/ranges.json").fp, flops: { [REP.flops[0]!.f]: [0.1, 0.25] } };
    const withFile = (async (url: string) => {
      const path = String(url).replace(/^lib\//, "").split("?")[0]!;
      if (path === "srp_btn_bb/nuts.json") return new Response(JSON.stringify(nuts));
      if (path !== "index.json") return fakeFetch(url);
      const idx = libJson<{ spots: { id: string; nuts?: string }[] }>("index.json");
      return new Response(JSON.stringify({ ...idx, spots: idx.spots.map((s) => (s.id === "srp_btn_bb" ? { ...s, nuts: "abc" } : s)) }));
    }) as unknown as typeof fetch;
    const view = open("spot=srp_btn_bb", new LibraryFiles("lib/", withFile));
    await screen.findByRole("button", { name: "Nut adv" });
    const seat = REP.seats[1];
    expect(screen.getByRole("row", { name: REP.flops[0]!.f })).toHaveTextContent(`${seat} +15.0`);
    expect(screen.getByRole("row", { name: "Average" })).toHaveTextContent(`${seat} +15.0`);
    expect(screen.getByText(/^Nut adv: from the stored ranges, not solved/)).toHaveTextContent(`1 of ${REP.flops.length} flops so far`);
    fireEvent.click(screen.getByRole("button", { name: "Nut adv" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("sort=nut"));
    expect(flopRows()[0]).toBe(REP.flops[0]!.f);
    view.unmount();

    open("spot=srp_btn_bb");
    await screen.findByRole("button", { name: /Range adv/ });
    expect(screen.queryByRole("button", { name: /Nut adv/ })).toBeNull();
    expect(screen.queryByText(/Nut adv is/)).toBeNull();
  });

  it("builds a 3-way spot's report from its flops' files: three decisions, strategies only, Study after two checks", async () => {
    open("spot=mw_btn_sb_bb&view=third");
    expect(await screen.findByText(/^Precomputed solution · mw_btn_sb_bb · 3-way flop report over its 6 stored flops, built in the page from their entries$/)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Decision" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["SB first", "BB vs check", "BTN vs two checks"]);
    expect(screen.getByRole("button", { name: "BTN vs two checks" })).toHaveAttribute("aria-pressed", "true");
    expect(flopRows()).toHaveLength(6);
    // no EV, equity or EQR columns: the 3-way library stores none
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Flop ▾", "Strategy", "Check", "Bet 33%", "Bet 75%", "Study"]);
    expect(screen.queryByText(/Range adv/)).toBeNull();
    const row = screen.getByRole("row", { name: "5c4d2h" });
    expect(row).toHaveTextContent(/56\.1%20\.8%23\.2%/);
    expect(within(row).getByRole("link", { name: "Study" }).getAttribute("href")).toBe(
      "/study?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Ac%2CBB%3Ac&b=5c4d2h&flop=SB%3Ax%2CBB%3Ax",
    );
    // the spot picker groups heads-up and 3-way spots; the coverage lists the 3-way one
    expect(within(screen.getByRole("combobox", { name: "Spot" })).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["Heads-up", "3-way"]);
    expect(screen.getByText("BTN open, SB and BB call (3-way): 6 flops stored")).toBeInTheDocument();
    // a heads-up decision isn't one of a 3-way spot's: the first decision instead
    fireEvent.click(screen.getByRole("button", { name: "SB first" }));
    expect(screen.getByRole("button", { name: "SB first" })).toHaveAttribute("aria-pressed", "true");
  });

  it("in position facing out of position's first bet, where the report stores it (a 3-bet pot's c-bet)", async () => {
    open("spot=3bp_bb_btn&view=ipvsbet");
    await screen.findByRole("row", { name: "Average" });
    expect(screen.getByRole("button", { name: "BTN vs bet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("columnheader").slice(2, 5).map((h) => h.textContent)).toEqual(["Fold", "Call", "Raise"]);
    const r = screen.getAllByRole("row").find((x) => /vs (33|75)%made \d+%/.test(x.textContent ?? ""))!;
    // Study at the bet faced: out of position's first action, no check before it
    expect(within(r).getByRole("link", { name: "Study" }).getAttribute("href")).toMatch(/&flop=BB%3Ab\d[^,]*$/);
  });

  it("keeps the view, filters, grouping and sort in the URL", async () => {
    open("spot=srp_btn_bb");
    await screen.findByRole("row", { name: "Average" });
    fireEvent.click(screen.getByRole("button", { name: "BB vs bet" }));
    expect(screen.getByRole("button", { name: "BB vs bet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("columnheader").slice(2, 5).map((h) => h.textContent)).toEqual(["Fold", "Call", "Raise"]);
    expect(screen.getByTestId("where").textContent).toMatch(/view=vsbet/);
    // a flop row facing a bet opens Study at that bet, said with how often it's made
    const r = screen.getAllByRole("row").find((x) => x.textContent?.includes("vs "))!;
    expect(within(r).getByRole("link", { name: "Study" }).getAttribute("href")).toMatch(/&flop=BB%3Ax%2CBTN%3Ab\d/);
    expect(r).toHaveTextContent(/vs (33|75)%made \d+%/);
    expect(screen.getByText(/Facing a bet: flops with the bet under 5% left out/)).toBeInTheDocument();
    // the fixture's flops don't store in position's response to a first bet: that view can't be picked
    expect(screen.getByRole("button", { name: "BTN vs bet" })).toBeDisabled();

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

  it("draws the flops shown as a chart: a column each in the table's order, groups as columns, hover and click", async () => {
    open("spot=srp_btn_bb&sort=a0");
    await screen.findByRole("row", { name: "Average" });
    fireEvent.click(within(screen.getByRole("group", { name: "Show as" })).getByRole("button", { name: "Chart" }));
    expect(screen.getByTestId("where").textContent).toMatch(/show=chart/);
    expect(screen.queryByRole("row", { name: "Average" })).toBeNull();
    const chart = screen.getByRole("region", { name: "Chart" });
    expect(within(chart).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Check", "Bet 33%", "Bet 75%"]);
    const strip = within(chart).getByRole("img");
    expect(strip.getAttribute("aria-label")).toMatch(/^7 flops, by Check, highest first: check played on \d+% of them, bet 33% played on/);
    // one column a flop, by check highest first: hovered, each shows its own mix; a click opens Study at that flop
    const sorted = sortRows(rows(REP, "oop"), "a0", true, REP.pot);
    strip.getBoundingClientRect = () => ({ left: 0, width: 700, top: 0, height: 160, right: 700, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    sorted.forEach((r, k) => {
      fireEvent.pointerMove(strip, { clientX: k * 100 + 50, clientY: 50 });
      expect(within(chart).getByRole("tooltip")).toHaveTextContent(`Check ${(r.freqs![0]! * 100).toFixed(1)}%Bet 33% ${(r.freqs![1]! * 100).toFixed(1)}%`);
    });
    // (a tap: the column clicked, with no move before it)
    const last = sorted[6]!;
    fireEvent.pointerLeave(strip);
    fireEvent.click(strip, { clientX: 650, clientY: 50 });
    expect(screen.getByTestId("where").textContent).toBe(`/study?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac&b=${last.f}`);
  });

  it("draws each action's band across the flops as one stepped shape", () => {
    const rs = [{ freqs: [0.5, 0.5] }, { freqs: [1, 0] }];
    expect(stepClip(rs, 0)).toBe("polygon(0% 50%,50% 50%,50% 0%,100% 0%,100% 100%,50% 100%,50% 100%,0% 100%)");
    expect(stepClip(rs, 1)).toBe("polygon(0% 0%,50% 0%,50% 0%,100% 0%,100% 0%,50% 0%,50% 50%,0% 50%)");
  });

  it("draws a column a texture group when grouped, a click showing only that group's flops", async () => {
    open("spot=srp_btn_bb&show=chart&group=pair");
    const chart = await screen.findByRole("region", { name: "Chart" });
    const unpaired = within(chart).getByRole("button", { name: /^Unpaired: check / });
    fireEvent.pointerEnter(unpaired);
    expect(within(chart).getByRole("tooltip")).toHaveTextContent(/^Unpaired · [\d.]+% of the flops shown/);
    fireEvent.click(unpaired);
    expect(screen.getByTestId("where").textContent).toMatch(/pair=unpaired/);
    expect(screen.getByTestId("where").textContent).toMatch(/show=chart/);
    expect(within(screen.getByRole("region", { name: "Chart" })).queryByRole("button", { name: /^Unpaired/ })).toBeNull();
    // back to the table
    fireEvent.click(within(screen.getByRole("group", { name: "Show as" })).getByRole("button", { name: "Table" }));
    expect(await screen.findByRole("row", { name: "Average" })).toBeInTheDocument();
    expect(screen.getByTestId("where").textContent).not.toMatch(/show=/);
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
