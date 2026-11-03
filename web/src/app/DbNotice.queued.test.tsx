import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DB_NAME, DB_VERSION, DB_WAIT_NOTICE_MS, db, dbState, openLizardDB } from "@/data/db";
import { DbNotice } from "./DbNotice";

afterEach(() => vi.useRealTimers());

// (its own file: the shared connection must not be open yet)
it("says another tab holds the data when this tab's open is queued behind another tab's waiting upgrade", async () => {
  const old = await openLizardDB(DB_VERSION - 1, DB_NAME); // an older Lizard's tab, which never closes by itself
  const otherUpgrade = openLizardDB(DB_VERSION, DB_NAME); // another new tab, its upgrade waiting on the old one
  await new Promise((r) => setTimeout(r, 20));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  render(<DbNotice />);
  const opened = db(); // queued behind the other tab's request: no event reaches it
  await act(async () => {
    await Promise.resolve();
  });
  expect(dbState()).toBe("ok");
  act(() => vi.advanceTimersByTime(DB_WAIT_NOTICE_MS));
  expect(dbState()).toBe("waiting");
  expect(screen.getByRole("alert")).toHaveTextContent("Close or reload the other Lizard tabs");
  vi.useRealTimers();

  old.close();
  const other = await otherUpgrade;
  const d = await opened;
  expect(d?.version).toBe(DB_VERSION);
  expect(dbState()).toBe("ok");
  expect(screen.queryByRole("alert")).toBeNull();
  other.close();
});
