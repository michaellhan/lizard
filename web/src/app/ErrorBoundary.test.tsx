// A page that throws keeps a way out: a message, a reload, and the backup, even where the page that threw is the one that
// holds the backup's own button. The records here are stored directly: what a restore from before the check could leave.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { BACKUP_STORES } from "@/data/backup";
import { db, type HandRecord, type SavedSpot } from "@/data/db";
import { AnalyzePage } from "@/features/analyze/AnalyzePage";
import { SavedPage } from "@/features/saved/SavedPage";
import { ErrorBoundary } from "./ErrorBoundary";
import { Shell } from "./Shell";

const POISON = { id: "bad", title: "Bad", line: "p=6", state: {}, tags: [{ a: 1 }], note: "", createdAt: 1, updatedAt: 1 } as unknown as SavedSpot;

const inShell = (at: string) =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="saved" element={<SavedPage />} />
          <Route path="analyze" element={<AnalyzePage />} />
          <Route path="*" element={<p>Another page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

let logged: MockInstance<typeof console.error>;
const blobs: Blob[] = [];

beforeEach(async () => {
  const d = (await db())!;
  for (const s of BACKUP_STORES) await d.clear(s);
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
  blobs.length = 0;
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return "blob:x";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

const ours = () => logged.mock.calls.filter((c) => c[0] === "A page stopped drawing:");

describe("a page that throws", () => {
  it("/saved itself: the page's gone, its backup still comes down, and the error is in the console", async () => {
    await (await db())!.put("savedSpots", POISON);
    inShell("/saved");
    expect(await screen.findByRole("alert", { name: "This page stopped" })).toHaveTextContent("This page stopped working");
    expect(ours()).toHaveLength(1);
    expect(String(ours()[0]![1])).toContain("Objects are not valid as a React child");
    // (the rest of the app stands)
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload this page" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    expect(await screen.findByText(/Backup made/)).toBeInTheDocument();
    const b = JSON.parse(await blobs[0]!.text());
    expect(b.stores.savedSpots.map((r: { id: string }) => r.id)).toEqual(["bad"]);
  });

  it("/analyze on a hand with an object for a pot type", async () => {
    const h = { id: "h", site: "s", number: "1", played: "", playedAt: 0, hero: "BTN", players: 6, hole: "AhKd", board: "", bb: "$1", potType: { a: 1 }, pot: 1, end: "x", decisions: 0, text: "x", importId: "i", importName: "n", importedAt: 1 } as unknown as HandRecord;
    await (await db())!.put("hands", h);
    inShell("/analyze");
    expect(await screen.findByRole("alert", { name: "This page stopped" })).toBeInTheDocument();
  });

  it("clears when the address changes, so one bad page doesn't take the others", async () => {
    await (await db())!.put("savedSpots", POISON);
    inShell("/saved");
    await screen.findByRole("alert", { name: "This page stopped" });
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByText("Another page")).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "This page stopped" })).toBeNull();
  });

  it("says so when the backup can't be made", async () => {
    const Bad = (): never => {
      throw new Error("drawn wrong");
    };
    render(
      <ErrorBoundary>
        <Bad />
      </ErrorBoundary>,
    );
    URL.createObjectURL = vi.fn(() => {
      throw new Error("no blobs here");
    });
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    expect(await screen.findByText("No backup was made: no blobs here")).toBeInTheDocument();
    expect(logged.mock.calls.some((c) => c[0] === "The backup failed:")).toBe(true);
  });

  it("has no text for a page that draws, and doesn't remount it as its URL changes", async () => {
    const Page = () => {
      const [n, setN] = useState(0);
      const go = useNavigate();
      return (
        <button
          type="button"
          onClick={() => {
            setN(n + 1);
            void go(`/?x=${n}`);
          }}
        >
          clicked {n}
        </button>
      );
    };
    const Keyed = () => (
      <ErrorBoundary resetKey="same">
        <Page />
      </ErrorBoundary>
    );
    render(
      <MemoryRouter>
        <Keyed />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("clicked 1"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });
});
