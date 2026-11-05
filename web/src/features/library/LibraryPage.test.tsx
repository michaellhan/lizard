import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalog, type LibraryCatalog } from "@/library/catalog";
import { LibraryPage } from "./LibraryPage";

vi.mock("@/library/catalog", async (real) => ({ ...(await real<object>()), loadCatalog: vi.fn() }));
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
    load.mockResolvedValue({ source: "lizard-library", base: "x/", available: false, spots: [], fetchedAt: 0, error: "index.json not found" });
    open();
    expect((await screen.findAllByText("Not published yet."))[0]).toBeInTheDocument();
    expect(screen.queryByText(/index\.json/)).toBeNull();
  });

  it("keeps a failed read apart from an unpublished library, with no raw error", async () => {
    load.mockRejectedValue(new TypeError("Failed to fetch"));
    open();
    expect((await screen.findAllByText(/Couldn't read this library's index/))[0]).toBeInTheDocument();
    expect(screen.queryByText(/TypeError|Failed to fetch/)).toBeNull();
  });

  it("names every column, the links' too", async () => {
    load.mockResolvedValue({
      source: "lizard-library",
      base: "x/",
      available: true,
      fetchedAt: 0,
      spots: [{ id: "srp", label: "BTN v BB", game: "6-max 100bb", kind: "srp", flops: 10, target: 100, storedTurns: false, line: "", tablePlayers: 6, tableStack: 100 }],
    } as unknown as LibraryCatalog);
    open();
    const table = (await screen.findAllByRole("table"))[0]!;
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Spot", "Type", "Flops", "Stored turns", "Open in Study"]);
  });
});
