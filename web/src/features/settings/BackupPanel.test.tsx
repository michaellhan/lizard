// Backup and restore, on Settings: one JSON file of everything kept in this browser, and a restore that merges.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_STORES, makeBackup } from "@/data/backup";
import { db, type SavedSpot } from "@/data/db";
import { deleteSpot, listRanges, listSpots, putSpot } from "@/data/saved";
import { fromSearch, studyRequest } from "@/features/study/studyState";
import { BackupPanel } from "./BackupPanel";

const LINE = "p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac&b=Ac7s3d&flop=BB%3Ax";
const spot = (id: string, title: string): SavedSpot => ({ id, title, line: LINE, state: studyRequest(fromSearch(LINE)!) as unknown as Record<string, unknown>, tags: [], note: "", createdAt: 1, updatedAt: 1 });
const show = (at = "/settings") =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <BackupPanel />
    </MemoryRouter>,
  );

beforeEach(async () => {
  const d = (await db())!;
  for (const s of BACKUP_STORES) await d.clear(s);
  await d.clear("tombstones");
});
afterEach(() => vi.restoreAllMocks());

describe("BackupPanel", () => {
  it("downloads a backup and restores one by merging", async () => {
    await putSpot(spot("a", "Kept"));
    const backup = await makeBackup();
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (created.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    show();
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    expect(await screen.findByText("Backup made: 1 spots, 0 saved answers, 0 drills, 0 scenarios, 0 ranges, 0 saved reports, 0 flop reports, 0 sessions, 0 hands, 0 graded decisions, 0 kept mistakes.")).toBeInTheDocument();
    expect(click).toHaveBeenCalledOnce();
    expect(JSON.parse(await created[0]!.text()).stores.savedSpots[0].data.title).toBe("Kept");
    expect(await screen.findByLabelText("Last backup")).toHaveTextContent(/^Last backup made here .+; 0 changes to your data since\.$/);

    // a backup holding one more spot and a range: added, nothing here deleted
    const more = { ...backup, stores: { ...backup.stores, savedSpots: [...backup.stores.savedSpots, { ...backup.stores.savedSpots[0]!, id: "b", data: spot("b", "From the file") }], savedRanges: [{ id: "r", v: 1, created: 1, updated: 1, dev: "d", data: { id: "r", name: "BB defend", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 1 } }] } };
    const file = new File([JSON.stringify(more)], "lizard-backup.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [file] } });
    expect(await screen.findByText(/^Restored: 2 added, 0 updated, 1 kept \(as new or newer here\)\. Nothing here was deleted\.$/)).toBeInTheDocument();
    expect((await listSpots()).map((x) => x.title).sort()).toEqual(["From the file", "Kept"]);
    expect((await listRanges()).map((r) => [r.name, r.combos])).toEqual([["BB defend", 78]]);

    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [new File(["{"], "x.json")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That file isn't JSON.");
    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [new File(['{"format":"other"}'], "x.json")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That isn't a Lizard backup file."));
  });
  it("refuses a file too big to read, before reading it", async () => {
    show();
    const text = vi.fn();
    const file = { name: "huge.json", size: 1100 * 1024 * 1024, text } as unknown as File;
    fireEvent.change(await screen.findByLabelText("Backup file to restore"), { target: { files: [file] } });
    expect(await screen.findByText(/^That's 1,100 MB, over the 1,024 MB one import can read\./)).toBeInTheDocument();
    expect(text).not.toHaveBeenCalled();
  });
  it("says a restore keeps out what was deleted, and how many it left out", async () => {
    await putSpot(spot("a", "Kept"));
    await putSpot(spot("b", "Deleted"));
    const b = await makeBackup();
    await deleteSpot("b");
    show();
    expect(await screen.findByText(/A restore merges/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [new File([JSON.stringify(b)], "backup.json")] } });
    expect(await screen.findByText("Restored: 0 added, 0 updated, 1 kept (as new or newer here), 1 left out because it was deleted after that copy. Nothing here was deleted.")).toBeInTheDocument();
    expect((await listSpots()).map((x) => x.id)).toEqual(["a"]);
  });
  it("shows the focus on the backup's file input through its label", async () => {
    show();
    const input = (await screen.findByLabelText("Backup file to restore")) as HTMLInputElement;
    expect(input.closest("label")?.className).toMatch(/focus-within:outline/);
  });

  it("comes into view and takes the keyboard when opened at #backup, as Saved's link does", async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    show("/settings#backup");
    const panel = screen.getByRole("region", { name: "Backup" });
    await waitFor(() => expect(panel).toHaveFocus());
    expect(into).toHaveBeenCalled();
  });
});
