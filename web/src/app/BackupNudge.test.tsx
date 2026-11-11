import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteSaved, nudgeState, NUDGE } from "@/data/backupNudge";
import { db } from "@/data/db";
import { BackupNudge } from "./BackupNudge";

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BackupNudge />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await (await db())!.delete("kv", "backupNudge");
});
afterEach(() => vi.restoreAllMocks());

const DAY = 86_400_000;
// a count due now: enough saves, kept long enough
const due = () => (async () => (await db())!.put("kv", { saves: NUDGE.saves, since: Date.now() - NUDGE.days * DAY }, "backupNudge"))();

describe("BackupNudge", () => {
  it("is rare: not for a few saves, nor many saves made today", async () => {
    at("/study");
    await act(() => noteSaved(NUDGE.saves));
    expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull();
  });

  it("says so once due; Later puts it off; a backup downloaded ends it", async () => {
    await due();
    at("/study");
    const line = await screen.findByRole("region", { name: "Backup reminder" });
    expect(line).toHaveTextContent("Your saved work is only in this browser. Download a backup · Later");

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull());
    expect((await nudgeState()).snoozedUntil).toBeGreaterThan(Date.now() + (NUDGE.snoozeDays - 1) * DAY);

    await due();
    await act(() => noteSaved());
    await screen.findByRole("region", { name: "Backup reminder" });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Download a backup" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull());
    expect(click).toHaveBeenCalledOnce();
    expect(await nudgeState()).toMatchObject({ saves: 0, lastBackupAt: expect.any(Number) });
  });

  it("isn't shown on the Saved page, whose backup panel says it", async () => {
    await due();
    at("/saved");
    await act(() => nudgeState());
    expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull();
  });

  it("isn't shown while account sync is on, which keeps a copy", async () => {
    await due();
    localStorage.setItem("lizard-sync", "1");
    try {
      at("/study");
      await act(() => nudgeState());
      expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull();
    } finally {
      localStorage.removeItem("lizard-sync");
    }
  });
});
