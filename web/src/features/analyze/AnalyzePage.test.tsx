/// <reference types="node" />
// The Analyze page on the classic fixtures (solver/tests/data/hh), kept in fake-indexeddb: pasting and picking files,
// what's skipped and why, a hand imported twice kept once, the hands table's filters in the URL, a hand replayed with
// its Study links, grading against a stubbed solver (the charts preflop, the library on one flop), and deleting an
// import. (In order: the tests share this file's database.)
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
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
    expect(links[0]).toHaveAttribute("href", "/study?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af");
    expect(links[1]!.getAttribute("href")).toMatch(/&b=Qs8d3c&flop=BB%3Ax$/);
    expect(screen.getByTestId("where").textContent).toMatch(/hand=PokerStars%7C249012345678%7CAhQd/);
    fireEvent.click(within(hand).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Hand" })).toBeNull();
  });

  it("imports picked files, each counted, and says when a hand can't open in Study", async () => {
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
    expect(hand).toHaveTextContent("Study can't set up this hand's ante or straddle");
    expect(within(hand).queryAllByRole("link", { name: /^Study / })).toHaveLength(0);

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

  it("lists the first hands of many, and deletes an import with its hands", async () => {
    open("", 3);
    await waitFor(() => expect(handRows()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Show all 4 hands" }));
    expect(handRows()).toHaveLength(4);
    const imports = screen.getByRole("region", { name: "Imports" });
    const pasted = within(imports).getByText("Pasted hands").closest("li")!;
    fireEvent.click(within(pasted).getByRole("button", { name: "Delete this import" }));
    fireEvent.click(within(pasted).getByRole("button", { name: "Delete 2 hands" }));
    await waitFor(() => expect(handRows()).toHaveLength(2));
    expect(within(screen.getByRole("region", { name: "Imports" })).queryByText("Pasted hands")).toBeNull();
  });

  it("says when the hand in the URL isn't kept here", async () => {
    open("hand=gone");
    expect(await screen.findByText(/That hand isn't kept in this browser/)).toBeInTheDocument();
  });
});
