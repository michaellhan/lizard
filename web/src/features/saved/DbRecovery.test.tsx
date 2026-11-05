// The recovery panel. Never a delete without its confirm. Each test loads the app's database module anew: the panel needs
// the shared connection to be one that failed.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupFileName } from "@/data/backup";
import { DB_NAME, DB_VERSION, openLizardDB, type SavedSpot } from "@/data/db";

const SPOT: SavedSpot = { id: "s", title: "Kept", line: "p=6&s=100", state: {}, tags: [], note: "", createdAt: 1, updatedAt: 1 };
const realOpen = indexedDB.open.bind(indexedDB);

/** an open at a version fails with this; a versionless one (the salvage's) goes through, unless `all` */
function failWith(name: string, all = false) {
  return vi.spyOn(indexedDB, "open").mockImplementation((n: string, v?: number) => {
    if (v === undefined && !all) return realOpen(n);
    throw new DOMException("no", name);
  });
}

const wipe = () =>
  new Promise<void>((resolve) => {
    const q = indexedDB.deleteDatabase(DB_NAME);
    q.onsuccess = () => resolve();
  });

let app: typeof import("@/data/db");
let recovery: typeof import("./DbRecovery");
let saved: typeof import("@/data/saved");

/** one saved spot in the database, the panel up over a failed open */
async function failed(name: string, all = false) {
  await wipe();
  const d = await openLizardDB(DB_VERSION);
  await d.put("savedSpots", SPOT);
  d.close();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const open = failWith(name, all);
  const reload = vi.fn();
  render(<recovery.DbRecovery reload={reload} />);
  await act(async () => {
    expect(await app.db()).toBeNull();
  });
  return { open, reload, panel: await screen.findByRole("region", { name: "Saved data recovery" }) };
}

const button = (p: HTMLElement, name: string | RegExp) => within(p).getByRole("button", { name });

beforeEach(async () => {
  vi.resetModules();
  [app, saved, recovery] = await Promise.all([import("@/data/db"), import("@/data/saved"), import("./DbRecovery")]);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(async () => {
  vi.restoreAllMocks();
  (await app.db())?.close();
});

describe("the recovery panel", () => {
  it("shows nothing while the database opens", async () => {
    await act(async () => {
      await app.db();
    });
    render(<recovery.DbRecovery />);
    expect(app.dbState()).toBe("ok");
    expect(screen.queryByRole("region", { name: "Saved data recovery" })).toBeNull();
  });

  it.each([
    ["UnknownError", "damaged", "can mean the files behind it are damaged"],
    ["VersionError", "newer", "written by a newer Lizard than this page"],
    ["QuotaExceededError", "full", "no room left"],
    ["AbortError", "upgrade", "couldn't be brought up to this version"],
  ])("says what happened in words for %s", async (name, kind, words) => {
    const { panel } = await failed(name);
    expect(app.dbFailure()?.kind).toBe(kind);
    expect(panel).toHaveTextContent(words);
    expect(await within(panel).findByText("It can still read 1 saved spot.")).toBeInTheDocument();
  });

  it("downloads what can be read, as a file a restore takes, without touching anything", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const made: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (made.push(b), "blob:x")) as never;
    let name = "";
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((t: string) => {
      const e = real(t);
      if (t === "a") queueMicrotask(() => (name = (e as HTMLAnchorElement).download));
      return e;
    });
    const { panel } = await failed("UnknownError");
    const del = vi.spyOn(indexedDB, "deleteDatabase");
    fireEvent.click(await within(panel).findByRole("button", { name: "Download what can be read" }));
    expect(click).toHaveBeenCalledOnce();
    await waitFor(() => expect(name).toBe(backupFileName(new Date(), "recovered")));
    expect(JSON.parse(await made[0]!.text()).stores.savedSpots[0].data.title).toBe("Kept");
    expect(panel).toHaveTextContent("Downloaded 1 record.");
    expect(del).not.toHaveBeenCalled();
  });

  it("offers no download where nothing can be read, and says so", async () => {
    const { panel } = await failed("UnknownError", true);
    expect(await within(panel).findByText("Nothing could be read from it.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Download what can be read" })).toBeNull();
    expect(button(panel, "Start fresh…")).toBeInTheDocument();
  });

  it("offers only another try where the browser stores nothing at all: there's nothing to delete", async () => {
    const { panel } = await failed("SecurityError", true);
    expect(app.dbFailure()?.kind).toBe("unavailable");
    expect(panel).toHaveTextContent("isn't letting the page store anything");
    expect(within(panel).queryByRole("button", { name: /Start fresh/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Download/ })).toBeNull();
    expect(button(panel, "Try again")).toBeInTheDocument();
  });

  it("Try again that opens reloads the page; one that doesn't says so", async () => {
    const { panel, reload, open } = await failed("UnknownError");
    fireEvent.click(button(panel, "Try again"));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("It still won't open.");
    expect(reload).not.toHaveBeenCalled();
    open.mockRestore();
    fireEvent.click(button(panel, "Try again"));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(app.dbState()).toBe("ok");
  });

  it("deletes nothing on Start fresh alone: the confirm says what's lost, focus starts on keeping it, and backing out changes nothing", async () => {
    const { panel } = await failed("UnknownError");
    const del = vi.spyOn(indexedDB, "deleteDatabase");
    await within(panel).findByText(/can still read/);
    fireEvent.click(button(panel, "Start fresh…"));
    const say = within(panel).getByRole("alert");
    expect(say).toHaveTextContent(/every saved spot and answer, range, drill, scenario and report/);
    expect(say).toHaveTextContent("your settings");
    expect(say).toHaveTextContent("it can still read 1 saved spot");
    expect(say).toHaveTextContent("can’t be undone");
    expect(say).toHaveTextContent("download what can be read first");
    expect(button(panel, "Keep it")).toHaveFocus();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(button(panel, "Keep it"));
    // (a delete would have begun by now: it starts a moment after the click)
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(del).not.toHaveBeenCalled();
    expect(button(panel, "Start fresh…")).toBeEnabled();
    // (the keyboard comes back to where it was, not to the top of the page)
    expect(button(panel, "Start fresh…")).toHaveFocus();
    vi.mocked(indexedDB.open).mockRestore();
    expect((await saved.listSpots()).map((s) => s.id)).toEqual(["s"]);
  });

  it("deletes on the confirm, opens a new database, and offers the backup back", async () => {
    const { panel, open } = await failed("UnknownError");
    const del = vi.spyOn(indexedDB, "deleteDatabase");
    await within(panel).findByText(/can still read/);
    fireEvent.click(button(panel, "Start fresh…"));
    open.mockRestore();
    fireEvent.click(button(panel, "Delete everything and start fresh"));
    expect(await within(panel).findByRole("heading", { name: "Started fresh" })).toBeInTheDocument();
    expect(del).toHaveBeenCalledExactlyOnceWith(DB_NAME);
    expect(app.dbState()).toBe("ok");
    expect(await saved.listSpots()).toEqual([]);

    const backup = { format: "lizard-backup", schema: 1, stores: { savedSpots: [{ id: "s", data: SPOT }] } };
    const file = new File([JSON.stringify(backup)], "b.json", { type: "application/json" });
    fireEvent.change(within(panel).getByLabelText("Backup file to restore"), { target: { files: [file] } });
    expect(await within(panel).findByRole("status")).toHaveTextContent("Restored: 1 added");
    expect((await saved.listSpots()).map((s) => s.id)).toEqual(["s"]);
    expect(button(panel, "Reload the page")).toBeInTheDocument();
  });

  it("goes away with the confirm unanswered if the database opens after all: nothing to delete any more", async () => {
    const { panel, open } = await failed("UnknownError");
    const del = vi.spyOn(indexedDB, "deleteDatabase");
    await within(panel).findByText(/can still read/);
    fireEvent.click(button(panel, "Start fresh…"));
    open.mockRestore();
    await act(async () => {
      await app.db();
    });
    expect(screen.queryByRole("region", { name: "Saved data recovery" })).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("says what a file it can't restore is, and carries on", async () => {
    const { panel, open } = await failed("UnknownError");
    await within(panel).findByText(/can still read/);
    fireEvent.click(button(panel, "Start fresh…"));
    open.mockRestore();
    fireEvent.click(button(panel, "Delete everything and start fresh"));
    await within(panel).findByRole("heading", { name: "Started fresh" });
    fireEvent.change(within(panel).getByLabelText("Backup file to restore"), { target: { files: [new File(["nope"], "b.json")] } });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("That file isn't JSON.");
  });

  it("says so where the delete fails, with nothing changed", async () => {
    const { panel } = await failed("UnknownError");
    vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
      throw new DOMException("no", "UnknownError");
    });
    await within(panel).findByText(/can still read/);
    fireEvent.click(button(panel, "Start fresh…"));
    fireEvent.click(button(panel, "Delete everything and start fresh"));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("The browser wouldn't delete it");
  });
});
