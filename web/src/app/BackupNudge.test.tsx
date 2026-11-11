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

describe("BackupNudge", () => {
  it("says so past a number of saves; Not now puts it off; a backup downloaded ends it", async () => {
    at("/study");
    await act(() => noteSaved(NUDGE.first - 1));
    expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull();
    await act(() => noteSaved());
    const line = await screen.findByRole("region", { name: "Backup reminder" });
    expect(line).toHaveTextContent(`${NUDGE.first} saves since Lizard started counting, and no backup yet: kept in this browser only`);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull());
    await act(() => noteSaved(NUDGE.again));
    expect(await screen.findByRole("region", { name: "Backup reminder" })).toBeInTheDocument();

    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Download a backup" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull());
    expect(click).toHaveBeenCalledOnce();
    expect(await nudgeState()).toMatchObject({ saves: 0, lastBackupAt: expect.any(Number) });
  });

  it("isn't shown on the Saved page, whose backup panel says it", async () => {
    await noteSaved(NUDGE.first);
    at("/saved");
    await act(() => nudgeState());
    expect(screen.queryByRole("region", { name: "Backup reminder" })).toBeNull();
  });
});
