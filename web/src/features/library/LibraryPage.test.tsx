import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalog, type LibraryCatalog } from "@/library/catalog";
import { LibraryPage } from "./LibraryPage";

vi.mock("@/library/catalog", async (real) => ({
  ...(await real<object>()),
  loadCatalog: vi.fn(),
}));
const load = vi.mocked(loadCatalog);
afterEach(() => vi.clearAllMocks());

const open = () =>
  render(
    <MemoryRouter>
      <LibraryPage />
    </MemoryRouter>,
  );

describe("LibraryPage", () => {
  it("says a library isn't published in words, and no file name", async () => {
    load.mockResolvedValue({
      source: "lizard-library",
      base: "x/",
      available: false,
      spots: [],
      fetchedAt: 0,
      error: "index.json not found",
    });
    open();
    expect(
      (await screen.findAllByText("Not published yet."))[0],
    ).toBeInTheDocument();
    expect(screen.queryByText(/index\.json/)).toBeNull();
  });

  it("keeps a failed read apart from an unpublished library, with no raw error", async () => {
    load.mockRejectedValue(new TypeError("Failed to fetch"));
    open();
    expect(
      (await screen.findAllByText(/Couldn't read this library's index/))[0],
    ).toBeInTheDocument();
    expect(screen.queryByText(/TypeError|Failed to fetch/)).toBeNull();
  });

  it("names every column, the links' too", async () => {
    load.mockResolvedValue({
      source: "lizard-library",
      base: "x/",
      available: true,
      fetchedAt: 0,
      spots: [
        {
          id: "srp",
          label: "BTN v BB",
          game: "6-max 100bb",
          kind: "srp",
          flops: 10,
          target: 100,
          storedTurns: false,
          line: "",
          tablePlayers: 6,
          tableStack: 100,
        },
      ],
    } as unknown as LibraryCatalog);
    open();
    const table = (await screen.findAllByRole("table"))[0]!;
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Spot", "Type", "Flops", "Stored turns", "Open in Study"]);
  });

  it("shows the single-size library as a source of its own, with the flops it covers and Study links that pick it", async () => {
    load.mockResolvedValue({
      source: "lizard-library",
      base: "x/",
      available: true,
      fetchedAt: 0,
      spots: [],
      singleSize: {
        spots: [
          {
            id: "ss_srp_btn_bb",
            label: "BTN vs BB single-raised pot, single size",
            line: "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c",
            flops: 2,
          },
        ],
        flops: ["Ac7d2h", "KcQc8d"],
        target: 552,
        games: [],
      },
    } as LibraryCatalog);
    open();
    const cap = (
      await screen.findAllByText(
        /^Single-size library: 6-max 100bb, one bet size a node/,
      )
    )[0]!;
    const table = cap.closest("table")!;
    expect(within(table).getByText("2 / 552")).toBeInTheDocument();
    expect(
      within(table).getByRole("link", { name: "Study →" }).getAttribute("href"),
    ).toContain("lib=ss");
    expect(
      screen.getAllByText(
        /Flops covered on every 100bb spot \(2 of 552 planned\)/,
      )[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("Ac7d2h KcQc8d")[0]).toBeInTheDocument();
  });

  it("shows an ante game's spots with their ranges' source, its own flops, and Study links that carry the ante", async () => {
    load.mockResolvedValue({
      source: "lizard-library",
      base: "x/",
      available: true,
      fetchedAt: 0,
      spots: [],
      singleSize: {
        spots: [
          {
            id: "ss_srp_btn_bb_ante",
            label:
              "BTN vs BB single-raised pot, 1bb big-blind ante (0.17bb a seat), single size",
            line: "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c",
            flops: 3,
            target: 1755,
            game: { ante: 0.17, straddle: false },
            gameWords: "1bb big-blind ante (0.17bb a seat)",
          },
        ],
        flops: [],
        target: 552,
        games: [
          {
            ante: 0.17,
            straddle: false,
            words: "1bb big-blind ante (0.17bb a seat)",
            flops: ["5c4d2h", "6c5d2h", "7c4d3h"],
            target: 1755,
          },
        ],
      },
    } as LibraryCatalog);
    open();
    const cap = (
      await screen.findAllByText(
        /^Single-size library: 6-max 100bb, one bet size a node/,
      )
    )[0]!;
    const table = cap.closest("table")!;
    expect(within(table).getByText("3 / 1755")).toBeInTheDocument();
    expect(
      within(table).getByText(
        /Lizard's stored preflop solve of this game \(1bb big-blind ante \(0.17bb a seat\)\), not the charts/,
      ),
    ).toBeInTheDocument();
    const href = within(table)
      .getByRole("link", { name: "Study →" })
      .getAttribute("href")!;
    expect(new URLSearchParams(href.split("?")[1]).get("ante")).toBe("0.17");
    expect(href).toContain("lib=ss");
    expect(
      screen.getAllByText(
        /Flops covered on every spot with a 1bb big-blind ante \(0.17bb a seat\) \(3 of 1755 planned\)/,
      )[0],
    ).toBeInTheDocument();
    expect(screen.queryByText(/Flops covered on every 100bb spot/)).toBeNull();
  });
});
