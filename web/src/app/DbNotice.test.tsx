import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DB_NAME, DB_VERSION, db, dbState, openLizardDB } from "@/data/db";
import { DbNotice } from "./DbNotice";

// (in this order: the first test's connection is the one the second sees taken over)
describe("the database with other Lizard tabs open", () => {
  it("waits for an older tab that holds the database, saying so, then carries on", async () => {
    const old = await openLizardDB(DB_VERSION - 1, DB_NAME); // an older Lizard's tab: no handler, it never closes by itself
    render(<DbNotice />);
    const opened = db();
    await vi.waitFor(() => expect(dbState()).toBe("waiting"));
    expect(screen.getByRole("alert")).toHaveTextContent("Another Lizard tab, open since before an update, is holding this browser's saved data.");
    act(() => old.close());
    const d = await opened;
    expect(d?.version).toBe(DB_VERSION);
    expect(dbState()).toBe("ok");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("steps aside for a newer tab's upgrade, and says this tab keeps nothing until reloaded", async () => {
    expect(await db()).not.toBeNull();
    render(<DbNotice />);
    const newer = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open(DB_NAME, DB_VERSION + 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    expect(newer.version).toBe(DB_VERSION + 1);
    expect(dbState()).toBe("replaced");
    expect(await screen.findByRole("alert")).toHaveTextContent("Lizard was updated in another tab");
    expect(screen.getByRole("button", { name: "Reload this page" })).toBeInTheDocument();
    expect(await db()).toBeNull();
    newer.close();
  });
});
