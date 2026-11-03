/// <reference types="node" />
// The Analyze page on the classic fixtures (solver/tests/data/hh), kept in fake-indexeddb: pasting and picking files,
// what's skipped and why, a hand imported twice kept once, the hands table's filters in the URL, a hand replayed with
// its Study links, grading against a stubbed solver (the charts preflop, the library on one flop), and deleting an
// import, and the classic app's My hands imported read only. (In order: the tests share this file's database.)
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { deleteDrill, listDrills } from "@/data/saved";
import { classicDb } from "@/test/classic";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { AnalyzePage } from "./AnalyzePage";

// the solver stubbed: preflop the charts' answer (CO's chart never calls), the SRP hand's flop (Qs8d3c) the library's,
// any other flop skipped
const stub = vi.hoisted(() => {
  const s = { asked: [] as AdvisorState[], getSolver: null as unknown as () => Promise<unknown> };
  s.getSolver = async () => ({
    solve: async ({ state }: { state: AdvisorState }) => {
      s.asked.push(state);
      const { provenanceOf } = await import("@/solver/provenance");
      const data: AdvisorResponse = !state.board
        ? { street: "preflop", pot_bb: 1.5, actions: [{ action: "fold", freq: 0.2 }, ...(state.hero === "CO" ? [] : [{ action: "call", freq: 0.3, amount_bb: 1 }]), { action: "raise", freq: 0.5, amount_bb: 2.5 }] }
        : state.board === "Qs8d3c"
          ? { street: "flop", pot_bb: 5.5, precomputed: { spot: "srp_btn_bb" }, actions: [{ action: "check", freq: 0.48, ev_bb: 3.1 }, { action: "bet 33%", freq: 0.09, ev_bb: 3.0, amount_bb: 1.8 }, { action: "bet 75%", freq: 0.43, ev_bb: 3.12, amount_bb: 4.1 }] }
          : { skipped: "not a flop-library spot" };
      return { data, provenance: provenanceOf(data, { mode: "fast", transport: "worker", solverVersion: "t", partial: false }) };
    },
  });
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

const HH_DIR = join(process.cwd(), "..", "solver", "tests", "data", "hh");
const HH = (f: string) => readFileSync(join(HH_DIR, f), "utf8");
const OMAHA = HH("stars_6max_srp.txt")
  .replace("Hold'em No Limit", "Omaha Pot Limit")
  .replace("PokerStars Hand #249012345678", "PokerStars Hand #249012345600")
  .replace("[Ah Qd]", "[Ah Qd Kc 2s]");

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const open = (q = "", rowLimit?: number) =>
  render(
    <MemoryRouter initialEntries={[`/analyze${q ? `?${q}` : ""}`]}>
      <Routes>
        <Route path="/analyze" element={<><AnalyzePage rowLimit={rowLimit} /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
const handRows = () => screen.queryAllByRole("row").filter((r) => /^Hand /.test(r.getAttribute("aria-label") ?? ""));
const paste = async (text: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: "Paste hand histories" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Import pasted hands" }));
  return screen.findByRole("status", { name: "Import result" });
};

describe("AnalyzePage", () => {
  it("imports pasted hands, says what it skipped, and keeps a hand imported twice once", async () => {
    open();
    expect(await screen.findByText(/No hands kept yet/)).toBeInTheDocument();
    const res = await paste([HH("stars_6max_srp.txt"), HH("stars_3bet_pot.txt"), OMAHA].join("\n\n"));
    expect(res).toHaveTextContent("Pasted hands: 3 hands read, 2 to keep (2 new, 0 already kept from an earlier import).");
    expect(res).toHaveTextContent("Skipped: 1 not Hold'em.");
    await waitFor(() => expect(handRows()).toHaveLength(2));
    // newest played first
    expect(handRows().map((r) => r.getAttribute("aria-label"))).toEqual(["Hand 249876543210", "Hand 249012345678"]);
    expect(within(screen.getByRole("region", { name: "Imports" })).getByText("Pasted hands")).toBeInTheDocument();
    expect(screen.getByText(/^2 hands kept, \d+ kB of history text/)).toBeInTheDocument();

    const again = await paste(HH("stars_6max_srp.txt"));
    expect(again).toHaveTextContent("1 hand read, 1 to keep (0 new, 1 already kept from an earlier import).");
    expect(handRows()).toHaveLength(2);
  });

  it("lists hands with filters in the URL, and replays one with a Study link at each of your decisions", async () => {
    open();
    await waitFor(() => expect(handRows()).toHaveLength(2));
    fireEvent.change(screen.getByRole("combobox", { name: "Pot" }), { target: { value: "3bet pot" } });
    expect(handRows()).toHaveLength(1);
    expect(screen.getByTestId("where").textContent).toMatch(/pot=3bet\+pot/);
    fireEvent.change(screen.getByRole("combobox", { name: "Pot" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: "BTN" } });
    const [row] = handRows();
    expect(row).toHaveAttribute("aria-label", "Hand 249012345678");
    expect(row).toHaveTextContent("SRP");
    expect(row).toHaveTextContent("21.3");
    expect(row).toHaveTextContent("won, all folded");
    fireEvent.click(within(row!).getByRole("button", { name: "Open" }));

    const hand = screen.getByRole("region", { name: "Hand" });
    expect(within(hand).getByRole("heading", { name: "PokerStars hand #249012345678" })).toBeInTheDocument();
    expect(hand).toHaveTextContent("2024-03-02 21:14 · 6-handed · big blind $1");
    expect(hand).toHaveTextContent("You are BTN with");
    expect(hand).toHaveTextContent("you 100bb; UTG 100, HJ 143.27, CO 100, SB 62.4, BB 100");
    expect(within(hand).getByRole("listitem", { name: "flop" })).toHaveTextContent("BB checks");
    expect(within(hand).getByRole("listitem", { name: "flop" })).toHaveTextContent("You bet 1.8");
    expect(hand).toHaveTextContent("Pot 21.3bb (won, all folded). From your hand history, replayed on Lizard's table. None of your decisions here is graded yet.");
    const links = within(hand).getAllByRole("link", { name: /^Study / });
    expect(links).toHaveLength(4);
    // (the small blind, still to act, has its own 62.4bb; the folded seats' stacks don't come along)
    expect(links[0]).toHaveAttribute("href", "/study?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af&stacks=SB%3A62.4");
    expect(links[1]!.getAttribute("href")).toMatch(/&b=Qs8d3c&flop=BB%3Ax$/);
    expect(screen.getByTestId("where").textContent).toMatch(/hand=PokerStars%7C249012345678%7CAhQd/);
    fireEvent.click(within(hand).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Hand" })).toBeNull();
  });

  it("imports picked files, each counted; a tournament hand opens in Study with its ante and stacks, in chips", async () => {
    open();
    await waitFor(() => expect(handRows()).toHaveLength(2));
    const files = [
      new File([HH("gg_straddle.txt")], "gg.txt", { type: "text/plain" }),
      new File([HH("stars_9max_mtt_ante.txt")], "mtt.txt", { type: "text/plain" }),
      new File(["not a hand"], "notes.png", { type: "image/png" }),
    ];
    fireEvent.change(screen.getByLabelText("Choose hand-history files"), { target: { files } });
    const res = await screen.findByRole("status", { name: "Import result" });
    expect(res).toHaveTextContent("2 files: 2 hands read, 2 to keep (2 new, 0 already kept from an earlier import).");
    expect(res).toHaveTextContent("gg.txt: 1 read, 1 to keep");
    await waitFor(() => expect(handRows()).toHaveLength(4));
    const mtt = handRows().find((r) => r.textContent?.includes("300 chips"))!;
    expect(mtt).toHaveTextContent("MTT");
    fireEvent.click(within(mtt).getByRole("button", { name: "Open" }));
    const hand = screen.getByRole("region", { name: "Hand" });
    expect(hand).toHaveTextContent("tournament 3712345678");
    expect(hand).toHaveTextContent("0.1bb ante");
    expect(hand).toHaveTextContent("A tournament hand: Study answers it in chips, with no ICM or bounties.");
    const links = within(hand).getAllByRole("link", { name: /^Study / });
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", "/study?p=9&s=80&pre=UTG%3Af%2CUTG1%3Af%2CUTG2%3Af%2CLJ%3Ar2.2%2CHJ%3Af&stacks=LJ%3A100%2CBTN%3A136.73%2CSB%3A41.67%2CBB%3A83.67&ante=0.1");

    fireEvent.change(screen.getByLabelText("Choose hand-history files"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("None of the 1 files is a hand history (.txt, .xml, .log or .hh).");
  });

  it("grades your preflop and library flops, shows each grade on the hand and in the report, and forgets them", async () => {
    open("hand=PokerStars%7C249012345678%7CAhQd");
    await waitFor(() => expect(handRows()).toHaveLength(4));
    const panel = screen.getByRole("region", { name: "Grading" });
    expect(panel).toHaveTextContent("the charts aren't a solve and have no EVs");
    fireEvent.click(within(panel).getByRole("button", { name: "Grade 4 hands" }));
    expect(await within(panel).findByText(/^Done: 9 decisions graded in this run\.$/)).toBeInTheDocument();
    // 4 preflop decisions and 5 flop ones asked; the flops of the library only, nothing past the flop
    const boards = stub.asked.map((s) => s.board || "preflop");
    expect([boards.filter((b) => b === "preflop").length, boards.filter((b) => b.length === 6).length]).toEqual([4, 5]);
    expect(boards).toContain("Qs8d3c");
    expect(stub.asked.filter((s) => s.board).every((s) => s.library_only)).toBe(true);

    const hand = screen.getByRole("region", { name: "Hand" });
    expect(within(hand).getByLabelText("Grade of preflop decision 4")).toHaveTextContent("Best");
    const flop = within(hand).getByLabelText("Grade of flop decision 2");
    expect(flop).toHaveTextContent("Mistake");
    expect(flop).toHaveTextContent("−0.12bb");
    expect(flop.getAttribute("title")).toMatch(/0\.12bb lost \(2\.2% of the pot\) · Precomputed solution · srp_btn_bb/);
    expect(within(hand).getByLabelText("Grade of preflop decision 4").getAttribute("title")).toMatch(/preflop charts, by frequency \(not a solve\)/);

    const rep = screen.getByRole("region", { name: "Report" });
    expect(within(rep).getByLabelText("Summary")).toHaveTextContent("5 of your decisions graded in 4 hands: 60% in the mix (Best or Correct).");
    expect(within(rep).getByLabelText("Summary")).toHaveTextContent("1 decision, 0.12bb lost in all, 2.2% of the pot a decision on average.");
    expect(within(rep).getByText("4 not graded")).toBeInTheDocument();
    // the mtt hand's call is one CO's chart leaves out: off the chart
    const off = within(rep).getByRole("list", { name: /^Off the chart/ });
    expect(off).toHaveTextContent("CO AhTd preflop: call (vs open)");
    expect(within(rep).getByRole("row", { name: "RFI" })).toHaveTextContent("RFI1100%00");
    expect(within(rep).getByRole("row", { name: "vs open" })).toHaveTextContent("vs open10%10");
    expect(within(rep).getByRole("button", { name: "Export CSV" })).toBeInTheDocument();

    // asked again: nothing left to ask
    stub.asked = [];
    fireEvent.click(within(panel).getByRole("button", { name: "Grade 4 hands" }));
    expect(await within(panel).findByText(/^Done: 0 decisions graded in this run\.$/)).toBeInTheDocument();
    expect(stub.asked).toHaveLength(0);
    fireEvent.click(within(panel).getByRole("button", { name: "Forget the grades" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Forget 9 grades" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Report" })).toBeNull());
    expect(within(screen.getByRole("region", { name: "Hand" })).queryByLabelText("Grade of flop decision 2")).toBeNull();
  });

  it("drills a leak's decisions against the kept answer, and resumes the drill where it was left", async () => {
    const first = open();
    await waitFor(() => expect(handRows()).toHaveLength(4));
    const panel = screen.getByRole("region", { name: "Grading" });
    fireEvent.click(within(panel).getByRole("button", { name: "Grade 4 hands" }));
    expect(await within(panel).findByText(/^Done: 9 decisions graded in this run\.$/)).toBeInTheDocument();
    first.unmount();

    const q = `drill=${encodeURIComponent("spot:SRP · IP · checked to")}`;
    // (opened with a filter set: the drill's links keep it)
    const view = open(`pos=BTN&${q}`);
    const drill = await screen.findByRole("region", { name: "Leak drill" });
    expect(within(drill).getByRole("heading", { name: "Drill: SRP · IP · checked to" })).toBeInTheDocument();
    // kept as a saved drill: the leak, over the hands its filters keep
    // (enabled once it's looked up whether the drill is saved)
    await waitFor(() => expect(within(drill).getByRole("button", { name: "☆ Save drill" })).toBeEnabled());
    fireEvent.click(within(drill).getByRole("button", { name: "☆ Save drill" }));
    const save = within(drill).getByRole("form", { name: "Save drill" });
    expect(within(save).getByRole("textbox", { name: "Name" })).toHaveValue("Leak: SRP · IP · checked to · your seat BTN");
    fireEvent.click(within(save).getByRole("button", { name: "Save" }));
    expect(await within(save).findByRole("status")).toHaveTextContent("Saved in this browser.");
    const [kept] = await listDrills();
    expect(kept).toMatchObject({ kind: "leak", to: `/analyze?${new URLSearchParams({ drill: "spot:SRP · IP · checked to", pos: "BTN" })}` });
    await deleteDrill(kept!.id);
    fireEvent.click(within(save).getByRole("button", { name: "Close" }));
    expect(await within(drill).findByLabelText("Drill score")).toHaveTextContent("0 of 1 drilled.");
    expect(drill).toHaveTextContent("Decision 1 of 1 · SRP · IP · checked to · PokerStars hand #249012345678");
    expect(within(drill).getByRole("list", { name: "The action before" })).toHaveTextContent("flopBB checks");
    const options = within(drill).getByRole("group", { name: "Your options" });
    expect(within(options).getAllByRole("button").map((b) => b.textContent)).toEqual(["check", "bet 33%", "bet 75%"]);
    fireEvent.click(within(options).getByRole("button", { name: "bet 33%" }));
    const answer = within(drill).getByLabelText("Answer");
    expect(answer).toHaveTextContent("Mistake0.12bb lost (2.2% of the pot)");
    expect(within(answer).getByRole("table", { name: "The answer for your hand" })).toHaveTextContent("bet 75%43%3.12bb");
    expect(answer).toHaveTextContent("In the hand you played bet 1.8");
    expect(answer).toHaveTextContent("From Precomputed solution · srp_btn_bb.");
    expect(within(answer).getByRole("link", { name: "Open in Study" }).getAttribute("href")).toMatch(/&b=Qs8d3c&flop=BB%3Ax$/);
    const handHref = within(answer).getByRole("link", { name: "Open the hand" }).getAttribute("href")!;
    expect([...new URLSearchParams(handHref.split("?")[1])]).toEqual([["pos", "BTN"], ["drill", "spot:SRP · IP · checked to"], ["hand", "PokerStars|249012345678|AhQd"]]);
    expect(within(drill).getByLabelText("Drill score")).toHaveTextContent("1 of 1 drilled: 0 in the mix (0%), 0.12bb lost over 1 graded by EV.");
    fireEvent.click(within(drill).getByRole("button", { name: "Finish" }));
    expect(within(drill).getByRole("status")).toHaveTextContent("Every decision of this leak is drilled.");
    view.unmount();

    // opened again: where it was left (the progress is kept as a session), and started over from there
    open(q);
    const again = await screen.findByRole("region", { name: "Leak drill" });
    expect(await within(again).findByRole("status")).toHaveTextContent("Every decision of this leak is drilled.");
    expect(within(again).getByLabelText("Drill score")).toHaveTextContent("1 of 1 drilled: 0 in the mix (0%)");
    fireEvent.click(within(again).getByRole("button", { name: "Start over" }));
    expect(within(again).getByLabelText("Drill score")).toHaveTextContent("0 of 1 drilled.");
    expect(within(again).getByRole("group", { name: "Your options" })).toBeInTheDocument();
    fireEvent.click(within(again).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Leak drill" })).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/analyze");
  });

  it("counts your stats over the hands the filters show, each over its chances, with the hands behind it", async () => {
    open();
    await waitFor(() => expect(handRows()).toHaveLength(4));
    const stats = await screen.findByRole("region", { name: "Your stats" });
    expect(stats).toHaveTextContent("Counted from your 4 hands, as you played them: nothing here is graded or solved.");
    const row = (name: string) => within(stats).getByRole("row", { name });
    await waitFor(() => expect(row("VPIP")).toHaveTextContent("100%4 / 4"));
    // the SRP hand's open, the 3-bet pots' re-raises, the MTT hand's call; three c-bets, one turn barrel of three
    expect(row("PFR")).toHaveTextContent("75%3 / 4");
    expect(row("RFI")).toHaveTextContent("100%1 / 1");
    expect(row("RFI · BTN")).toHaveTextContent("100%1 / 1");
    expect(row("3-bet")).toHaveTextContent("67%2 / 3");
    expect(row("3-bet")).toHaveTextContent("21%–94%few");
    expect(row("Flop c-bet")).toHaveTextContent("100%3 / 3");
    expect(row("Turn barrel")).toHaveTextContent("33%1 / 3");
    expect(row("Fold to flop c-bet")).toHaveTextContent("0%0 / 1");
    expect(row("Went to showdown")).toHaveTextContent("50%2 / 4");
    expect(row("Squeeze")).toHaveTextContent("none");
    expect(within(stats).getByRole("row", { name: "30–45%" })).toHaveTextContent("30–45%3 100%1 50%0 0%");
    expect(within(stats).getByRole("row", { name: "60–80%" })).toHaveTextContent("60–80%0 0%1 50%1 100%");

    // the hands behind a stat, each a link to it
    fireEvent.click(within(row("3-bet")).getByRole("button", { name: "Hands" }));
    const list = within(stats).getByRole("region", { name: "Hands: 3-bet" });
    expect(list).toHaveTextContent("Took it (you re-raised) (2):");
    expect(list).toHaveTextContent("Didn't (1):");
    const mtt = within(list).getAllByRole("link").find((a) => a.textContent?.includes("AhTd"))!;
    expect(mtt).toHaveTextContent("CO AhTd");
    fireEvent.click(mtt);
    expect(screen.getByRole("region", { name: "Hand" })).toHaveTextContent("tournament 3712345678");

    // a filter: the report and the stats follow it
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: "BB" } });
    await waitFor(() => expect(row("VPIP")).toHaveTextContent("100%2 / 2"));
    expect(stats).toHaveTextContent("Counted from the 2 hands the filters show");
    expect(row("3-bet")).toHaveTextContent("100%2 / 2");
    expect(within(screen.getByRole("region", { name: "Report" })).getByLabelText("Summary")).toHaveTextContent("Over the 2 hands the filters show, of 4 kept.");
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Stakes" }), { target: { value: "300 chips" } });
    expect(handRows()).toHaveLength(1);
    await waitFor(() => expect(row("VPIP")).toHaveTextContent("100%1 / 1"));
    expect(screen.getByTestId("where").textContent).toMatch(/bb=300\+chips/);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2030-01-01" } });
    expect(handRows()).toHaveLength(0);
    expect(screen.getByText("No hand kept matches these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your stats" })).toBeNull();
    expect(screen.getByRole("region", { name: "Report" })).toHaveTextContent("None of your graded decisions is in the 0 hands the filters show.");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(handRows()).toHaveLength(4);
    expect(screen.getByTestId("where").textContent).not.toMatch(/bb=|from=/);
  });

  it("keeps your tags and note on a hand, and finds it by tag or search", async () => {
    const first = open("hand=PokerStars%7C249012345678%7CAhQd");
    await waitFor(() => expect(handRows()).toHaveLength(4));
    const notes = within(screen.getByRole("region", { name: "Hand" })).getByRole("group", { name: "Your tags and note" });
    fireEvent.click(within(notes).getByRole("button", { name: "Add tags or a note" }));
    fireEvent.change(within(notes).getByRole("textbox", { name: "Tags" }), { target: { value: "review, c-bet, review" } });
    fireEvent.change(within(notes).getByRole("textbox", { name: "Note" }), { target: { value: "Check the river sizing" } });
    fireEvent.click(within(notes).getByRole("button", { name: "Save" }));
    await within(notes).findByRole("button", { name: "Edit tags and note" });
    expect(notes).toHaveTextContent("reviewc-betCheck the river sizing");
    const row = () => handRows().find((r) => r.getAttribute("aria-label") === "Hand 249012345678")!;
    expect(row()).toHaveTextContent("reviewc-betnote");
    first.unmount();

    // kept: opened again, filtered by a tag, found by the note's words
    open();
    await waitFor(() => expect(handRows()).toHaveLength(4));
    fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), { target: { value: "c-bet" } });
    expect(handRows().map((r) => r.getAttribute("aria-label"))).toEqual(["Hand 249012345678"]);
    expect(await screen.findByText(/Counted from the 1 hand the filters show/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search hands" }), { target: { value: "river SIZING" } });
    expect(handRows()).toHaveLength(1);
    expect(screen.getByTestId("where").textContent).toMatch(/q=river\+SIZING/);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search hands" }), { target: { value: "300 chips" } });
    expect(handRows()).toHaveLength(1);
    expect(handRows()[0]).toHaveTextContent("MTT");
  });

  it("lists the first hands of many, and deletes an import with its hands", async () => {
    open("", 3);
    await waitFor(() => expect(handRows()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Show all 4 hands" }));
    expect(handRows()).toHaveLength(4);
    const imports = screen.getByRole("region", { name: "Imports" });
    const pasted = within(imports).getByText("Pasted hands").closest("li")!;
    fireEvent.click(within(pasted).getByRole("button", { name: "Delete this import" }));
    fireEvent.click(within(pasted).getByRole("button", { name: "Delete 2 hands, 1 with your tags or note" }));
    await waitFor(() => expect(handRows()).toHaveLength(2));
    expect(within(screen.getByRole("region", { name: "Imports" })).queryByText("Pasted hands")).toBeNull();
  });

  it("says when the hand in the URL isn't kept here", async () => {
    open("hand=gone");
    expect(await screen.findByText(/That hand isn't kept in this browser/)).toBeInTheDocument();
  });

  it("imports the classic app's My hands on request, read only, and says when it keeps none", async () => {
    open();
    await waitFor(() => expect(handRows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Import its My hands" }));
    expect(await screen.findByText("The classic app keeps no hands in this browser.")).toBeInTheDocument();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain("gto-store");

    // a hand played on the classic table (BTN opens, the big blind calls and folds to a flop bet), and one without cards
    const state = {
      players: 6,
      hero: "BTN",
      stack: 100,
      cards: ["Ah", "Kd", "Qs", "8d", "3c", null, null],
      actions: {
        preflop: [{ pos: "UTG", action: "fold" }, { pos: "HJ", action: "fold" }, { pos: "CO", action: "fold" }, { pos: "BTN", action: "raise", to: 2.5 }, { pos: "SB", action: "fold" }, { pos: "BB", action: "call" }],
        flop: [{ pos: "BB", action: "check" }, { pos: "BTN", action: "bet", to: 1.8 }, { pos: "BB", action: "fold" }],
        turn: [],
        river: [],
      },
    };
    const at = new Date(2025, 5, 1, 9, 30).getTime();
    const rec = (id: string, data: object) => ({ id, v: 1, created: at, updated: at, dev: "classic-device", data });
    await classicDb("gto-store", [rec("c1", { state, source: "table", tags: ["classic"], note: "bet small" }), rec("c2", { state: { ...state, cards: [null, null, null, null, null, null, null] } })]);
    fireEvent.click(screen.getByRole("button", { name: "Import its My hands" }));
    expect(await screen.findByText("From the classic app (IndexedDB): 2 hands read; 1 hand imported; left out: no hole cards (1).")).toBeInTheDocument();
    await waitFor(() => expect(handRows()).toHaveLength(3));
    expect(within(screen.getByRole("region", { name: "Imports" })).getByText("Classic app, My hands")).toBeInTheDocument();
    const row = handRows().find((r) => r.textContent?.includes("classic"))!;
    expect(row).toHaveTextContent("SRP");
    fireEvent.click(within(row).getByRole("button", { name: "Open" }));
    const hand = screen.getByRole("region", { name: "Hand" });
    expect(hand).toHaveTextContent("2025-06-01 09:30 · 6-handed");
    expect(within(hand).getByRole("listitem", { name: "flop" })).toHaveTextContent("You bet 1.8");
    expect(hand).toHaveTextContent("A hand from the classic app's My hands, replayed on Lizard's table.");
    expect(within(hand).getByRole("group", { name: "Your tags and note" })).toHaveTextContent("classicbet small");

    // again: nothing new; the classic database as it was
    fireEvent.click(screen.getByRole("button", { name: "Import its My hands" }));
    expect(await screen.findByText("From the classic app (IndexedDB): 2 hands read; 0 hands imported, 1 hand already here; left out: no hole cards (1).")).toBeInTheDocument();
    const d = await new Promise<IDBDatabase>((resolve) => {
      const q = indexedDB.open("gto-store");
      q.onsuccess = () => resolve(q.result);
    });
    expect(d.version).toBe(1);
    const kept = await new Promise<unknown[]>((resolve) => {
      const q = d.transaction("hands").objectStore("hands").getAll();
      q.onsuccess = () => resolve(q.result);
    });
    d.close();
    expect(kept).toEqual([rec("c1", { state, source: "table", tags: ["classic"], note: "bet small" }), rec("c2", { state: { ...state, cards: [null, null, null, null, null, null, null] } })]);
  });

  it("opens one hand after another and closes it where scrolling returns a promise (Chrome)", async () => {
    const scroll = vi.fn(() => Promise.resolve());
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: scroll, configurable: true });
    try {
      open();
      await waitFor(() => expect(handRows()).toHaveLength(3));
      fireEvent.click(within(handRows()[0]!).getByRole("button", { name: "Open" }));
      fireEvent.click(within(handRows()[1]!).getByRole("button", { name: "Open" }));
      fireEvent.click(within(screen.getByRole("region", { name: "Hand" })).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("region", { name: "Hand" })).toBeNull());
      expect(scroll).toHaveBeenCalledTimes(2);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      errors.mockRestore();
    }
  });
});
