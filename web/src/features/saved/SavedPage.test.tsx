import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerToKeep } from "@/data/answers";
import { BACKUP_STORES, makeBackup, restoreBackup, type Backup } from "@/data/backup";
import { db, kvGet, kvSet, type SavedSpot } from "@/data/db";
import { filtersOf, putReport, reportWords } from "@/data/reports";
import { deleteSpot, listDrills, listRanges, listSpots, putDrill, putRange, putSpot } from "@/data/saved";
import { putScenario, type ScenarioSetup } from "@/data/scenarios";
import { provenanceOf } from "@/solver/provenance";
import { CHART_ANSWER, LIBRARY_ANSWER } from "@/test/answers";
import { fromSearch, studyRequest, toSearch } from "@/features/study/studyState";
import { RangesPage } from "@/features/ranges/RangesPage";
import { formatRange, parseRange, rangeCombos } from "@/features/ranges/rangeText";

import { SaveDrill } from "./SaveDrill";
import { SaveReport } from "./SaveReport";
import { SaveScenario } from "./SaveScenario";
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
  await d.clear("tombstones");
});
afterEach(() => vi.restoreAllMocks());

const SPOT_FOR_EDIT: SavedSpot = { id: "edit", title: "Edit me", line: "p=6&s=100", state: {}, tags: [], note: "as kept", createdAt: 1, updatedAt: 1 };

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
    const search = screen.getByRole("searchbox", { name: "Search everything saved" });
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
    expect(await screen.findByText("Backup made: 1 spots, 0 saved answers, 0 drills, 0 scenarios, 0 ranges, 0 saved reports, 0 sessions, 0 hands, 0 graded decisions, 0 kept mistakes.")).toBeInTheDocument();
    expect(click).toHaveBeenCalledOnce();
    expect(JSON.parse(await created[0]!.text()).stores.savedSpots[0].data.title).toBe("Kept");
    expect(await screen.findByLabelText("Last backup")).toHaveTextContent(/^Last backup made here .+; 0 changes to your data since\.$/);

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

  it("refuses a file too big to read, before reading it", async () => {
    renderAt("/saved");
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
    renderAt("/saved");
    expect(await screen.findByText(/A restore merges/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [new File([JSON.stringify(b)], "backup.json")] } });
    expect(await screen.findByText("Restored: 0 added, 0 updated, 1 kept (as new or newer here), 1 left out because it was deleted after that copy. Nothing here was deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Deleted" })).toBeNull();
  });

  it("lists saved drills of both kinds, opens one where it's dealt, renames and deletes", async () => {
    const at = { note: "", createdAt: 1 };
    await putDrill({ id: "l", name: "Monotone defence", kind: "library", to: "/practice?tab=drills&spot=srp_btn_bb&view=vsbet&suits=mono", about: "BTN vs BB · BB facing a bet · Monotone", ...at, updatedAt: 2 });
    await putDrill({ id: "k", name: "BTN opens", kind: "leak", to: "/analyze?drill=pf%3ABTN+RFI&bb=0.5%2F1", about: "Leak: BTN RFI · stakes 0.5/1", ...at, note: "too tight", updatedAt: 3 });
    // (a link that isn't a drill page's is listed, not opened)
    await putDrill({ id: "x", name: "Odd one", kind: "library", to: "/settings", about: "?", ...at, updatedAt: 1 });
    renderAt("/saved");
    const section = await screen.findByRole("region", { name: "Saved drills" });
    await within(section).findByText("3");
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

  it("Edit always opens on the record as it stands: not on text cancelled, nor on what a restore replaced", async () => {
    await putSpot(SPOT_FOR_EDIT);
    renderAt("/saved");
    const row = async () => within(await screen.findByRole("listitem", { name: /^Edit me|^Restored$/ }));
    fireEvent.click((await row()).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "cancelled text" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click((await row()).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("as kept");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const b = await makeBackup();
    b.stores.savedSpots[0]!.data = { ...b.stores.savedSpots[0]!.data, title: "Restored", note: "from the file", updatedAt: 99 };
    b.stores.savedSpots[0]!.updated = 99;
    const file = new File([JSON.stringify(b)], "b.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [file] } });
    await screen.findByRole("listitem", { name: "Restored" });
    fireEvent.click((await row()).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Restored");
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("from the file");
  });

  it("keeps focus through Edit, Cancel and Delete, and a delete lands on the next row and is said", async () => {
    await putSpot(spot("a", "First", { updatedAt: 3 }));
    await putSpot(spot("b", "Second", { updatedAt: 2 }));
    await putSpot(spot("c", "Third", { updatedAt: 1 }));
    renderAt("/saved");
    const list = await screen.findByRole("region", { name: "Saved spots" });
    const row = (name: string) => within(list).findByRole("listitem", { name });
    const told = () => screen.getAllByRole("status").map((s) => s.textContent).join(" ");

    // (a click on a button focuses it in a browser; here it has to be told)
    const press = (b: HTMLElement) => {
      b.focus();
      fireEvent.click(b);
    };
    const inRow = async (name: string, button: string) => within(await row(name)).getByRole("button", { name: button });

    // Edit lands in the form, Cancel back on Edit
    press(await inRow("First", "Edit"));
    const form = screen.getByRole("form", { name: "Edit First" });
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveFocus();
    press(within(form).getByRole("button", { name: "Cancel" }));
    expect(await inRow("First", "Edit")).toHaveFocus();

    // Delete moves to the choice, Keep back to Delete
    press(await inRow("First", "Delete"));
    expect(await inRow("First", "Keep")).toHaveFocus();
    press(await inRow("First", "Keep"));
    expect(await inRow("First", "Delete")).toHaveFocus();

    // a middle row: the next one takes focus, and the delete is said
    press(await inRow("Second", "Delete"));
    press(await inRow("Second", "Delete spot"));
    await waitFor(() => expect(within(list).queryByRole("listitem", { name: "Second" })).toBeNull());
    await waitFor(() => expect(within(list).getByRole("listitem", { name: "Third" })).toHaveFocus());
    expect(told()).toContain("Second deleted.");

    // the last row: the one before it
    press(await inRow("Third", "Delete"));
    press(await inRow("Third", "Delete spot"));
    await waitFor(() => expect(within(list).getByRole("listitem", { name: "First" })).toHaveFocus());

    // none left: the section goes, and the page's heading takes focus
    press(await inRow("First", "Delete"));
    press(await inRow("First", "Delete spot"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Saved" })).toHaveFocus());
  });

  it("shows the focus on the backup's file input through its label", async () => {
    renderAt("/saved");
    const input = (await screen.findByLabelText("Backup file to restore")) as HTMLInputElement;
    expect(input.closest("label")?.className).toMatch(/focus-within:outline/);
  });

  it("says where saved things come from when there are none", async () => {
    renderAt("/saved");
    // (one line, not an empty section for each kind, and no search over nothing)
    expect(await screen.findByText(/^Nothing saved yet\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Study" })).toHaveAttribute("href", "/study");
    expect(screen.queryByRole("region", { name: "Saved spots" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("every kind on the Saved page", () => {
  const CHART_LINE = toSearch(fromSearch("p=6&s=100")!);
  const SCENARIO = { id: "c", name: "Nit table", players: 6, stack: 100, opts: { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, board: null }, note: "", createdAt: 1, updatedAt: 2 } as never;
  const REPORT = { id: "p", name: "Stars 2026", filters: {}, note: "", createdAt: 1, updatedAt: 2 };
  const DRILL = { id: "d", name: "Flops", kind: "library" as const, to: "/practice?tab=drills", about: "a", note: "", createdAt: 1, updatedAt: 2 };
  const RANGE = { id: "r", name: "UTG open", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 2 };

  it("sorts by the control across kinds, and remembers it", async () => {
    await putRange({ ...RANGE, id: "1", name: "beta", createdAt: 5, updatedAt: 5 });
    await putRange({ ...RANGE, id: "2", name: "alpha", createdAt: 9, updatedAt: 1 });
    await putRange({ ...RANGE, id: "3", name: "gamma", createdAt: 1, updatedAt: 9 });
    await putSpot(spot("a", "Zed", { createdAt: 2, updatedAt: 2 }));
    await putSpot(spot("b", "Abe", { createdAt: 1, updatedAt: 1, line: "p=2&s=100" }));
    renderAt("/saved");
    const names = async (kind: string) => within(await screen.findByRole("region", { name: kind })).findAllByRole("listitem").then((l) => l.map((x) => x.getAttribute("aria-label")));
    expect(await names("Saved ranges")).toEqual(["gamma", "beta", "alpha"]);
    expect(await names("Saved spots")).toEqual(["Zed", "Abe"]);
    const sort = screen.getByRole("combobox", { name: "Sort" });
    fireEvent.change(sort, { target: { value: "name" } });
    expect(await names("Saved ranges")).toEqual(["alpha", "beta", "gamma"]);
    expect(await names("Saved spots")).toEqual(["Abe", "Zed"]);
    await waitFor(async () => expect(await kvGet("savedSort")).toBe("name"));
    fireEvent.change(sort, { target: { value: "newest" } });
    expect(await names("Saved ranges")).toEqual(["alpha", "beta", "gamma"]);
    fireEvent.change(sort, { target: { value: "oldest" } });
    expect(await names("Saved ranges")).toEqual(["gamma", "beta", "alpha"]);
  });

  it("reads a kept sort back, and ignores one it doesn't know", async () => {
    await putRange({ ...RANGE, id: "1", name: "beta", updatedAt: 5 });
    await putRange({ ...RANGE, id: "2", name: "alpha", updatedAt: 1 });
    await kvSet("savedSort", "name");
    const first = renderAt("/saved");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("name"));
    await waitFor(async () => expect(within(await screen.findByRole("region", { name: "Saved ranges" })).getAllByRole("listitem")[0]).toHaveAttribute("aria-label", "alpha"));
    first.unmount();
    await kvSet("savedSort", "whatever");
    renderAt("/saved");
    await screen.findByRole("region", { name: "Saved ranges" });
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("changed");
  });

  it("shows a kind's tags, edits them, and finds them in the one search", async () => {
    await putRange({ ...RANGE, tags: ["open"] });
    await putDrill({ ...DRILL, tags: ["3bp"] });
    await putReport({ ...REPORT, tags: ["stars"] });
    await putScenario({ ...(SCENARIO as object), tags: ["nit"] } as never);
    renderAt("/saved");
    const rows = [
      ["UTG open", "open"],
      ["Flops", "3bp"],
      ["Stars 2026", "stars"],
      ["Nit table", "nit"],
    ] as const;
    for (const [name, tag] of rows) expect(await screen.findByRole("listitem", { name })).toHaveTextContent(tag);
    for (const [name, tag] of rows) {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search everything saved" }), { target: { value: tag } });
      expect(await screen.findByRole("listitem", { name })).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    }
    fireEvent.change(screen.getByRole("searchbox", { name: "Search everything saved" }), { target: { value: "" } });
    for (const [name] of rows) {
      const row = await screen.findByRole("listitem", { name });
      fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
      fireEvent.change(within(row).getByRole("textbox", { name: "Tags" }), { target: { value: "alike, two" } });
      fireEvent.click(within(row).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(within(screen.getByRole("listitem", { name })).queryByRole("form")).toBeNull());
    }
    expect((await listRanges())[0]?.tags).toEqual(["alike", "two"]);
    expect((await listDrills())[0]?.tags).toEqual(["alike", "two"]);
    const d = (await db())!;
    expect((await d.get("savedReports", "p"))?.tags).toEqual(["alike", "two"]);
    expect((await d.get("savedScenarios", "c"))?.tags).toEqual(["alike", "two"]);
  });

  it("keeps the tags through a save from a drill's, a report's or a scenario's own page, none of which edit them", async () => {
    const twice = async (name: string) => {
      fireEvent.click(await screen.findByRole("button", { expanded: false }));
      const form = screen.getByRole("form");
      if (name) fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: name } });
      fireEvent.click(within(form).getByRole("button", { name: "Save" }));
      await within(form).findByRole("status");
    };
    const d = (await db())!;
    await putDrill({ ...DRILL, tags: ["kept"] });
    const drill = render(
      <MemoryRouter>
        <SaveDrill kind={DRILL.kind} to={DRILL.to} about={DRILL.about} />
      </MemoryRouter>,
    );
    const open = await screen.findByRole("button", { name: "★ Saved drill" });
    fireEvent.click(open);
    fireEvent.change(within(screen.getByRole("form")).getByRole("textbox", { name: "Note" }), { target: { value: "n" } });
    fireEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Save" }));
    await within(screen.getByRole("form")).findByRole("status");
    expect((await d.get("savedDrills", "d"))).toMatchObject({ note: "n", tags: ["kept"] });
    drill.unmount();

    const params = new URLSearchParams();
    const about = reportWords(filtersOf(params));
    await putReport({ ...REPORT, name: about, tags: ["kept"] });
    const report = render(
      <MemoryRouter>
        <SaveReport params={params} />
      </MemoryRouter>,
    );
    await twice("");
    expect((await d.get("savedReports", "p"))).toMatchObject({ name: about, tags: ["kept"] });
    expect((await d.get("savedReports", "p"))?.updatedAt).toBeGreaterThan(2);
    report.unmount();

    await putScenario({ ...(SCENARIO as object), tags: ["kept"] } as never);
    const { players, stack, opts } = SCENARIO as unknown as ScenarioSetup;
    render(
      <MemoryRouter>
        <SaveScenario setup={{ players, stack, opts }} />
      </MemoryRouter>,
    );
    await twice("Nit table");
    expect((await d.get("savedScenarios", "c"))).toMatchObject({ name: "Nit table", tags: ["kept"] });
    expect((await d.get("savedScenarios", "c"))?.updatedAt).toBeGreaterThan(2);
  });

  it("exports one item, of any kind, to a file a restore takes", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const made = vi.mocked(URL.createObjectURL);
    await putRange(RANGE);
    await putSpot(spot("a", "A spot"));
    renderAt("/saved");
    fireEvent.click(await screen.findByRole("button", { name: "Export UTG open" }));
    await waitFor(() => expect(made).toHaveBeenCalledOnce());
    const file = JSON.parse(await (made.mock.calls[0]![0] as Blob).text()) as Backup;
    expect(file.stores.savedRanges.map((r) => r.id)).toEqual(["r"]);
    expect(file.stores.savedSpots).toEqual([]);
    const d = (await db())!;
    await d.clear("savedRanges");
    expect((await restoreBackup(file)).savedRanges.added).toBe(1);
  });

  it("says a spot keeps its answer, under that answer's own label, and links to it", async () => {
    const k = answerToKeep("a", CHART_LINE, { data: CHART_ANSWER, provenance: provenanceOf(CHART_ANSWER, { mode: "fast", transport: "worker", solverVersion: "aaa/111", partial: false, now: 1 }) }, Date.UTC(2026, 10, 5, 12));
    await putSpot(spot("a", "Kept", { line: CHART_LINE }), "answer" in k ? k.answer : undefined);
    await putSpot(spot("b", "Plain", { line: LINE }));
    renderAt("/saved");
    const row = await screen.findByRole("listitem", { name: "Kept" });
    await waitFor(() => expect(row).toHaveTextContent(/Answer kept: Preflop charts.*\(\d+(\.\d)? KB\)\. Saved answer of 2026-11-05, not solved again\./));
    expect(row).toHaveTextContent("aaa/111");
    expect(within(row).getByRole("link", { name: "Open in Study" })).toHaveAttribute("href", `/study?${CHART_LINE}&saved=a`);
    expect(within(await screen.findByRole("listitem", { name: "Plain" })).getByRole("link", { name: "Open in Study" })).toHaveAttribute("href", `/study?${LINE}`);
  });

  it("says when a spot's answer can't be read, and opens the line plainly", async () => {
    const k = answerToKeep("a", LINE, { data: LIBRARY_ANSWER, provenance: provenanceOf(LIBRARY_ANSWER, { mode: "fast", transport: "worker", solverVersion: "aaa/111", partial: false, now: 1 }) });
    await putSpot(spot("a", "Hurt"), "answer" in k ? { ...k.answer, json: "{not json" } : undefined);
    renderAt("/saved");
    const row = await screen.findByRole("listitem", { name: "Hurt" });
    await waitFor(() => expect(row).toHaveTextContent("Saved answer unreadable: opening it solves again."));
    expect(within(row).getByRole("link", { name: "Open in Study" })).toHaveAttribute("href", `/study?${LINE}`);
  });

  it("won't repeat a label calling a chart solved, from a spot a crafted file brought", async () => {
    await putSpot(spot("a", "Crafted", { line: CHART_LINE, seen: { source: "live", label: "Solved by the engine" } }));
    renderAt("/saved");
    const row = await screen.findByRole("listitem", { name: "Crafted" });
    expect(row).not.toHaveTextContent("Solved by the engine");
    expect(row).not.toHaveTextContent("the answer then");
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

  it("applies text in the solver's syntax, single combos as their share of the class", () => {
    renderAt("/ranges");
    fireEvent.change(screen.getByLabelText("Range text"), { target: { value: "qq+ AhKh KdAd, xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply text" }));
    expect(screen.getByLabelText("Range text")).toHaveValue("AA,AKs:0.5,KK,QQ");
    expect(screen.getByText("Not understood: xyz")).toBeInTheDocument();
    expect(screen.getByText(/^Single combos \(AhKh, KdAd\) are kept as their share of the class/)).toBeInTheDocument();
    expect(screen.getByText(/^20\.0$/)).toBeInTheDocument();
  });

  it("keeps Ranges' cell label plain, the brush spoken and the text's error tied to its field", () => {
    renderAt("/ranges");
    expect(screen.getByRole("gridcell", { name: "AA: 100% in range" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "72o: not in range" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("gridcell", { name: "AA: not in range" })).toHaveAttribute("tabindex", "0");
    const brush = screen.getByRole("slider", { name: "Brush weight" });
    fireEvent.change(brush, { target: { value: "0.5" } });
    expect(brush).toHaveAttribute("aria-valuetext", "50%");
    fireEvent.click(screen.getByRole("gridcell", { name: "AA: not in range" }));
    expect(screen.getByRole("gridcell", { name: "AA: 50% in range" })).toBeInTheDocument();
    expect(screen.getByText(/^AA at 50%\. 3\.0 combos in the range\.$/)).toBeInTheDocument();

    const field = screen.getByLabelText("Range text");
    expect(field).toHaveAttribute("aria-invalid", "false");
    fireEvent.change(field, { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply text" }));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/^Not understood: xyz/);
  });

  it("says when Ranges copied the text, and what to do when it couldn't", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      renderAt("/ranges");
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(await screen.findByText("Copied the range text.")).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("AKs"));

      writeText.mockRejectedValueOnce(new Error("denied"));
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(await screen.findByText(/Couldn't copy here\. Select the range text/)).toBeInTheDocument();

      // (no clipboard at all: an insecure page)
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(await screen.findByText(/Couldn't copy here/)).toBeInTheDocument();
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
});
