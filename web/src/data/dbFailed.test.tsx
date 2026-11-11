// A browser that won't open the database: a save stores nothing, so nothing may read as saved. (Its own file: the shared
// connection must not be open yet.)
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DbNotice } from "@/app/DbNotice";
import { SaveDrill } from "@/features/saved/SaveDrill";
import { RangesPage } from "@/features/ranges/RangesPage";
import { SavedPage } from "@/features/saved/SavedPage";
import { SaveSpot } from "@/features/study/SaveSpot";
import { fromSearch } from "@/features/study/studyState";
import { makeBackup } from "./backup";
import { db, dbState, putSession, type SessionRecord } from "./db";
import { addHands, putDecisions } from "./hands";
import { listSpots, putDrill, putRange, putSpot } from "./saved";

const HAND = fromSearch("p=6&s=100&pre=BTN%3Ar2.5%2CBB%3Ac&b=Ac7s3d")!;
const SPOT = { id: "s", title: "t", line: "l", state: {}, tags: [], note: "", createdAt: 1, updatedAt: 1 };
const RANGE = { id: "r", name: "n", text: "", combos: 0, note: "", createdAt: 1, updatedAt: 1 };
const DRILL = { id: "d", name: "n", kind: "library" as const, to: "/practice?tab=drills", about: "a", note: "", createdAt: 1, updatedAt: 1 };
/** the button, once it's looked the line up */
const opened = async (name: string) => {
  const b = await screen.findByRole("button", { name });
  await waitFor(() => expect(b).toBeEnabled());
  fireEvent.click(b);
};
const SESSION: SessionRecord = { id: "x", kind: "drill", startedAt: 1, decisions: 0, evLossBb: 0, meta: {} };

/** an open that errors, as a browser's does when it won't keep data */
function failing(): IDBOpenDBRequest {
  const q = { error: new DOMException("no", "UnknownError") } as unknown as IDBOpenDBRequest & { onerror?: () => void };
  const events: Record<string, ((e: Event) => void)[]> = {};
  q.addEventListener = ((t: string, f: (e: Event) => void) => void (events[t] ??= []).push(f)) as never;
  q.removeEventListener = (() => {}) as never;
  setTimeout(() => {
    for (const f of events.error ?? []) f(new Event("error"));
  }, 0);
  return q;
}

afterEach(() => vi.restoreAllMocks());

describe("when the database won't open", () => {
  // (in this order: each starts from what the last left)
  it("says so, and every write says it stored nothing", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(indexedDB, "open").mockImplementation(failing);
    render(<DbNotice />);
    expect(dbState()).toBe("ok");
    await act(async () => {
      expect(await db()).toBeNull();
    });
    expect(dbState()).toBe("failed");
    expect(screen.getByRole("alert")).toHaveTextContent("nothing is being kept");
    expect(quiet).toHaveBeenCalled();
    expect(await putSpot(SPOT)).toBe(false);
    expect(await putRange(RANGE)).toBe(false);
    expect(await putDrill(DRILL)).toBe(false);
    expect(await putSession(SESSION)).toBe(false);
    expect(await putDecisions([])).toBe(false);
    expect(await addHands([])).toBeNull();
    await expect(makeBackup()).rejects.toThrow("can't be read here");
  });

  it("does the same for an open that throws outright", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("no", "SecurityError");
    });
    expect(await db()).toBeNull();
    expect(dbState()).toBe("failed");
  });

  it("Save spot says it wasn't saved, and the button doesn't say saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(indexedDB, "open").mockImplementation(failing);
    render(
      <MemoryRouter>
        <SaveSpot hand={HAND} />
      </MemoryRouter>,
    );
    await opened("☆ Save spot");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: this browser isn't keeping Lizard's data right now.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "★ Saved" })).toBeNull();
  });

  it("Save drill says it wasn't saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(indexedDB, "open").mockImplementation(failing);
    render(
      <MemoryRouter>
        <SaveDrill kind="library" to="/practice?tab=drills" about="A drill" />
      </MemoryRouter>,
    );
    await opened("☆ Save drill");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved");
    expect(screen.queryByRole("button", { name: "★ Saved drill" })).toBeNull();
  });

  it("the Ranges page says it wasn't saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(indexedDB, "open").mockImplementation(failing);
    render(
      <MemoryRouter>
        <RangesPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(await screen.findByText(/Not saved/)).toBeInTheDocument();
    expect(screen.queryByText(/Saved “Mine”/)).toBeNull();
  });

  it("clears as soon as an open works, and the save stands", async () => {
    render(<DbNotice />);
    await act(async () => {
      expect(await db()).not.toBeNull();
    });
    await waitFor(() => expect(dbState()).toBe("ok"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await putSpot(SPOT)).toBe(true);
    expect((await listSpots()).map((s) => s.id)).toEqual(["s"]);
  });

  it("an edit on the Saved page stays open and says it wasn't saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = (await db())!;
    await putDrill(DRILL);
    vi.spyOn(d, "put").mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    render(
      <MemoryRouter>
        <SavedPage />
      </MemoryRouter>,
    );
    for (const what of ["t", "n"]) {
      const row = await screen.findByRole("listitem", { name: what });
      fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
      fireEvent.change(within(row).getByRole("textbox", { name: "Name" }), { target: { value: "New" } });
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));
      expect(await within(row).findByRole("alert")).toHaveTextContent("Not saved");
      expect(within(row).getByRole("form")).toBeInTheDocument();
    }
  });

  it("says a write the open database refused wasn't saved", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = (await db())!;
    vi.spyOn(d, "put").mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    render(
      <MemoryRouter>
        <SaveSpot hand={HAND} />
      </MemoryRouter>,
    );
    await opened("☆ Save spot");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved");
    expect(quiet.mock.calls.some((c) => c[0] === "A save failed:")).toBe(true);
    expect(screen.queryByRole("button", { name: "★ Saved" })).toBeNull();
  });
});
