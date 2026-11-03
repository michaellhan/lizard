import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_STORES, makeBackup } from "@/data/backup";
import { db, type SavedSpot } from "@/data/db";
import { listDrills, listRanges, listSpots, putDrill, putRange, putSpot } from "@/data/saved";
import { fromSearch, studyRequest } from "@/features/study/studyState";
import { RangesPage } from "@/features/ranges/RangesPage";
import { formatRange, parseRange, rangeCombos } from "@/features/ranges/rangeText";

import { SavedPage } from "./SavedPage";

const LINE = "p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac&b=Ac7s3d&flop=BB%3Ax";
const spot = (id: string, title: string, extra: Partial<SavedSpot> = {}): SavedSpot => ({
  id,
  title,
  line: LINE,
  state: studyRequest(fromSearch(LINE)!) as unknown as Record<string, unknown>,
  tags: [],
  note: "",
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/ranges" element={<RangesPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  const d = (await db())!;
  for (const s of BACKUP_STORES) await d.clear(s);
});
afterEach(() => vi.restoreAllMocks());

describe("SavedPage", () => {
  it("lists, searches, edits and deletes saved spots, and opens one in Study at its line", async () => {
    await putSpot(spot("a", "Ace-high c-bet", { tags: ["srp", "dry"], note: "bet small", seen: { source: "library", label: "Precomputed solution · srp_btn_bb" }, updatedAt: 5 }));
    await putSpot(spot("b", "Low board", { line: "p=2&s=100&pre=SB%3Ar2.5%2CBB%3Ac&b=7c5d2h", updatedAt: 3 }));
    renderAt("/saved");
    const list = await screen.findByRole("region", { name: "Saved spots" });
    expect(await within(list).findByRole("listitem", { name: "Ace-high c-bet" })).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Ace-high c-bet", "Low board"]);
    const a = within(list).getByRole("listitem", { name: "Ace-high c-bet" });
    expect(a).toHaveTextContent("6-max 100bb · BTN raise 2.5 · BB call · Ac7s3d · BB check");
    expect(a).toHaveTextContent("the answer then: Precomputed solution · srp_btn_bb");
    expect(within(a).getByRole("link", { name: "Open in Study" })).toHaveAttribute("href", `/study?${LINE}`);

    // search: every word, over names, tags, notes and the line as shown
    const search = screen.getByRole("searchbox", { name: "Search saved spots" });
    fireEvent.change(search, { target: { value: "dry ace" } });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "HU 7c5d2h" } });
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Low board"]);
    fireEvent.change(search, { target: { value: "turn" } });
    expect(screen.getByText("No saved spot matches “turn”.")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });

    // edit: name and tags
    fireEvent.click(within(within(list).getByRole("listitem", { name: "Low board" })).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit Low board" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "7-high HU" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Tags" }), { target: { value: "hu, low" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    const renamed = await within(list).findByRole("listitem", { name: "7-high HU" });
    expect(renamed).toHaveTextContent("hu");
    expect((await listSpots()).find((s) => s.id === "b")).toMatchObject({ title: "7-high HU", tags: ["hu", "low"] });
    // (the edited spot is now the latest changed: first)
    expect(within(list).getAllByRole("listitem")[0]).toBe(renamed);

    // delete asks once more
    fireEvent.click(within(renamed).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(renamed).getByRole("button", { name: "Keep" }));
    fireEvent.click(within(renamed).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(renamed).getByRole("button", { name: "Delete spot" }));
    await waitFor(() => expect(within(list).queryByRole("listitem", { name: "7-high HU" })).toBeNull());
    expect((await listSpots()).map((s) => s.id)).toEqual(["a"]);

    // the link opens Study at the saved line, which asks for the same request
    fireEvent.click(within(within(list).getByRole("listitem", { name: "Ace-high c-bet" })).getByRole("link", { name: "Open in Study" }));
    const where = screen.getByTestId("where").textContent!;
    expect(where).toBe(`/study?${LINE}`);
    expect(studyRequest(fromSearch(where.split("?")[1]!)!)).toEqual((await listSpots())[0]!.state);
  });

  it("downloads a backup and restores one by merging", async () => {
    await putSpot(spot("a", "Kept"));
    const backup = await makeBackup();
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (created.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderAt("/saved");
    await screen.findByRole("listitem", { name: "Kept" });
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    expect(await screen.findByText("Backup made: 1 spots, 0 drills, 0 ranges, 0 sessions, 0 hands, 0 graded decisions.")).toBeInTheDocument();
    expect(click).toHaveBeenCalledOnce();
    expect(JSON.parse(await created[0]!.text()).stores.savedSpots[0].data.title).toBe("Kept");
    expect(await screen.findByLabelText("Last backup")).toHaveTextContent(/^Last backup made here .+; 0 saves since\.$/);

    // a backup holding one more spot and a range: added, nothing here deleted
    const more = { ...backup, stores: { ...backup.stores, savedSpots: [...backup.stores.savedSpots, { ...backup.stores.savedSpots[0]!, id: "b", data: spot("b", "From the file") }], savedRanges: [{ id: "r", v: 1, created: 1, updated: 1, dev: "d", data: { id: "r", name: "BB defend", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 1 } }] } };
    const file = new File([JSON.stringify(more)], "lizard-backup.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [file] } });
    expect(await screen.findByText(/^Restored: 2 added, 0 updated, 1 kept \(as new or newer here\)\. Nothing here was deleted\.$/)).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { name: "From the file" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "BB defend" })).toHaveTextContent("78.0 combos");

    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [new File(["{"], "x.json")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That file isn't JSON.");
    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [new File(['{"format":"other"}'], "x.json")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That isn't a Lizard backup file."));
  });

  it("lists saved drills of both kinds, opens one where it's dealt, renames and deletes", async () => {
    const at = { note: "", createdAt: 1 };
    await putDrill({ id: "l", name: "Monotone defence", kind: "library", to: "/practice?tab=drills&spot=srp_btn_bb&view=vsbet&suits=mono", about: "BTN vs BB · BB facing a bet · Monotone", ...at, updatedAt: 2 });
    await putDrill({ id: "k", name: "BTN opens", kind: "leak", to: "/analyze?drill=pf%3ABTN+RFI&bb=0.5%2F1", about: "Leak: BTN RFI · stakes 0.5/1", ...at, note: "too tight", updatedAt: 3 });
    // (a link that isn't a drill page's is listed, not opened)
    await putDrill({ id: "x", name: "Odd one", kind: "library", to: "/settings", about: "?", ...at, updatedAt: 1 });
    renderAt("/saved");
    const section = await screen.findByRole("region", { name: "Saved drills" });
    await within(section).findByText("3 saved");
    expect(within(section).getAllByRole("listitem").map((l) => l.getAttribute("aria-label"))).toEqual(["BTN opens", "Monotone defence", "Odd one"]);
    const leak = within(section).getByRole("listitem", { name: "BTN opens" });
    expect(leak).toHaveTextContent("leak drill");
    expect(leak).toHaveTextContent("Leak: BTN RFI · stakes 0.5/1");
    expect(leak).toHaveTextContent("too tight");
    expect(within(leak).getByRole("link", { name: "Open in Analyze" })).toHaveAttribute("href", "/analyze?drill=pf%3ABTN+RFI&bb=0.5%2F1");
    expect(within(within(section).getByRole("listitem", { name: "Odd one" })).queryByRole("link")).toBeNull();

    // renamed, then deleted (asked once more)
    fireEvent.click(within(leak).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(section).getByRole("textbox", { name: "Name" }), { target: { value: "Button opens, 0.5/1" } });
    fireEvent.click(within(section).getByRole("button", { name: "Save" }));
    const renamed = await within(section).findByRole("listitem", { name: "Button opens, 0.5/1" });
    expect((await listDrills()).find((d) => d.id === "k")).toMatchObject({ name: "Button opens, 0.5/1", note: "too tight", to: "/analyze?drill=pf%3ABTN+RFI&bb=0.5%2F1" });
    fireEvent.click(within(renamed).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(renamed).getByRole("button", { name: "Delete drill" }));
    await waitFor(() => expect(within(section).queryByRole("listitem", { name: "Button opens, 0.5/1" })).toBeNull());
    expect((await listDrills()).map((d) => d.id)).toEqual(["l", "x"]);

    fireEvent.click(within(within(section).getByRole("listitem", { name: "Monotone defence" })).getByRole("link", { name: "Open in Practice" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/practice?tab=drills&spot=srp_btn_bb&view=vsbet&suits=mono");
  });

  it("says where saved things come from when there are none", async () => {
    renderAt("/saved");
    expect(await screen.findByText(/No saved spots yet/)).toBeInTheDocument();
    expect(screen.getByText(/No saved drills yet/)).toBeInTheDocument();
    expect(screen.getByText(/No saved ranges yet/)).toBeInTheDocument();
  });
});

describe("saved ranges in the Ranges editor", () => {
  it("saves the range under a name, updates it by name, and opens a saved one by link", async () => {
    renderAt("/ranges");
    const form = screen.getByRole("form", { name: "Save range" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "UTG open" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved “UTG open” in this browser.")).toBeInTheDocument();
    let all = await listRanges();
    expect(all).toHaveLength(1);
    const def = parseRange("22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+").weights;
    expect(all[0]).toMatchObject({ name: "UTG open", text: formatRange(def), combos: rangeCombos(def) });
    // the same name again: that range, updated
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Updated “UTG open”.")).toBeInTheDocument();
    all = await listRanges();
    expect(all).toHaveLength(1);

    await putRange({ id: "r2", name: "BB defend", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 1 });
    const page = renderAt("/ranges?range=r2");
    expect(await within(page.container).findByText("Opened “BB defend”.")).toBeInTheDocument();
    expect(within(page.container).getByText(/^78\.0$/)).toBeInTheDocument();
  });
});
