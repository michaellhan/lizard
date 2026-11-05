/// <reference types="node" />
// The Analyze page's reports over kept hands: the one filter bar and its sample, nothing left, the breakdowns and the
// hands behind a row, a leak held back for its sample, the three measures kept apart, and the raises by size. On hands
// kept in fake-indexeddb, each test clearing them.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type DecisionRecord, type HandRecord } from "@/data/db";
import { addHands, putDecisions } from "@/data/hands";
import { prepare } from "./analyze";
import { AnalyzePage } from "./AnalyzePage";

vi.mock("@/solver/useSolver", () => ({ useSolver: () => async () => ({ solve: async () => ({ data: { skipped: "no" }, provenance: {} }) }) }));

const HH = (f: string) => readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", f), "utf8");
const T0 = Date.UTC(2026, 0, 1, 12);
const DAY = 86_400_000;
let id = 0;
const hand = (playedAt: number, over: Partial<HandRecord> = {}): HandRecord => {
  id++;
  return { id: `h${id}`, number: String(1000 + id), site: "PokerStars", played: playedAt ? new Date(playedAt).toISOString().slice(0, 16).replace("T", " ") : "", playedAt, hero: "BTN", players: 6, hole: "AhKd", board: "Qs8d3c", bb: "$1", potType: "SRP", pot: 5, end: "showdown", decisions: 1, text: "x", importId: "i", importName: "i", importedAt: 1, ...over } as HandRecord;
};
const dec = (h: HandRecord, over: Partial<DecisionRecord> = {}): DecisionRecord => ({ id: `${h.id}|preflop|0`, handId: h.id, street: "preflop", pos: h.hero, action: "raise to 2.5", verdict: "Correct", evLossBb: null, lossPct: null, source: "charts", label: "Preflop charts · approximate", gradedAt: 0, situation: "RFI", mix: [["fold", 0.5, null], ["raise", 0.5, null]], matched: "raise", freq: 0.5, ...over });
const cbet = (h: HandRecord, over: Partial<DecisionRecord> = {}): DecisionRecord => ({ ...dec(h), id: `${h.id}|flop|1`, street: "flop", action: "bet 1.8", situation: "SRP · IP · checked to", role: "PFR", facing: false, multi: false, ip: true, mix: [["check", 0.6, 3.1], ["bet 33%", 0.4, 2.5]], verdict: "Mistake", evLossBb: 0.6, lossPct: 10.9, pot: 5.5, source: "library", label: "Precomputed solution · srp_btn_bb", ...over });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const open = (q = "") =>
  render(
    <MemoryRouter initialEntries={[`/analyze${q ? `?${q}` : ""}`]}>
      <Routes>
        <Route path="/analyze" element={<><AnalyzePage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
const search = () => new URLSearchParams(screen.getByTestId("where").textContent!.split("?")[1] ?? "");
const seed = async (hands: HandRecord[], ds: DecisionRecord[] = []) => {
  await addHands(hands);
  if (ds.length) await putDecisions(ds);
};
const fixtures = async (...files: string[]) => (await prepare([{ name: "a", text: files.map(HH).join("\n\n") }], { id: "i", name: "i", at: 1 })).hands;
const sample = async (says: string) => {
  const el = await screen.findByRole("status", { name: "Sample after filtering" });
  await waitFor(() => expect(el).toHaveTextContent(says));
};
const pick = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });

beforeEach(async () => {
  const d = await db();
  await Promise.all([d!.clear("hands"), d!.clear("decisions"), d!.clear("sessions")]);
});
afterEach(cleanup);

describe("the filter bar", () => {
  const mixed = () => {
    const hs = [hand(T0), hand(T0 + DAY), hand(T0 + 2 * DAY, { site: "GGPoker" }), hand(T0 + 3 * DAY, { bb: "$2" }), hand(0)];
    return { hs, ds: hs.slice(0, 4).map((h) => dec(h)) };
  };

  it("takes dates, site and stakes together, in the URL, says the sample left, and every report follows", async () => {
    const { hs, ds } = mixed();
    await seed(hs, ds);
    open();
    await sample("Every report covers all your 5 hands and 4 graded decisions.");
    pick("Site", "PokerStars");
    pick("Stakes", "$1");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-02" } });
    await waitFor(() => expect(search().get("from")).toBe("2026-01-02"));
    expect(search().get("site")).toBe("PokerStars");
    expect(search().get("bb")).toBe("$1");
    await sample("Every report covers 1 hand of 5 and 1 of 4 graded decisions.");
    await waitFor(() => expect(screen.getByRole("region", { name: "Report" })).toHaveTextContent("1 of your decisions graded in 1 hands"));
    expect(within(screen.getByRole("region", { name: "Filters" })).getByText(/left out while a date is set/)).toHaveTextContent("1 hand with no date in the history is left out");
  });

  it("opens with the filters a link carries, and clearing them keeps the keyboard's place", async () => {
    const { hs, ds } = mixed();
    await seed(hs, ds);
    open("site=GGPoker");
    await sample("Every report covers 1 hand of 5 and 1 of 4 graded decisions.");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await sample("all your 5 hands");
    expect(search().get("site")).toBeNull();
    expect(screen.getByRole("heading", { name: "Filters" })).toHaveFocus();
  });

  it("says when a filter leaves nothing, and when the dates can't match", async () => {
    const { hs, ds } = mixed();
    await seed(hs, ds);
    open("site=GGPoker&bb=%242");
    expect(await screen.findByLabelText("Nothing left")).toHaveTextContent("None of your hands matches all of these filters together. Every report is empty until you change them.");
    await sample("Every report covers 0 hands of 5 and 0 of 4 graded decisions.");
    cleanup();
    open("from=2026-02-01&to=2026-01-01");
    expect(await screen.findByLabelText("Nothing left")).toHaveTextContent("From is later than To, so no day can match.");
  });

  it("names its controls, and the graded count leaves out a decision that isn't graded", async () => {
    const h = hand(T0);
    await seed([h], [dec(h), cbet(h, { verdict: "Not graded", why: "x", evLossBb: null, lossPct: null })]);
    open();
    await sample("all your 1 hand and 1 graded decision.");
    const bar = screen.getByRole("region", { name: "Filters" });
    for (const name of ["Site", "Stakes", "Your seat", "Pot", "EV lost"]) expect(within(bar).getByRole("combobox", { name })).toBeInTheDocument();
    expect(within(bar).getByRole("searchbox", { name: "Search hands" })).toBeInTheDocument();
  });
});

describe("the breakdowns", () => {
  it("shows counts on every row, and the hands behind one", async () => {
    const hs = [hand(T0, { hero: "BTN" }), hand(T0 + 1, { hero: "CO" }), hand(T0 + 2, { hero: "CO" })];
    await seed(hs, [dec(hs[0]!), dec(hs[1]!, { verdict: "Mistake", freq: 0 }), dec(hs[2]!)]);
    open();
    const group = await screen.findByRole("group", { name: "Breakdowns" });
    const table = await within(group).findByRole("table", { name: "Your seat" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Your seat", "Graded", "In the mix", "95% range", "Mistakes", "By EV", "EV lost per decision", "Stands on", "Decisions"]);
    const co = within(table).getByRole("row", { name: "CO" });
    expect(co).toHaveTextContent("CO250%");
    expect(co).toHaveTextContent("few");
    expect(co).toHaveTextContent("Charts, by frequency 2");
    expect(co).not.toHaveTextContent(/solved/i);
    const btn = within(table).getByRole("button", { name: "Decisions: BTN" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(table).getByRole("button", { name: "Decisions: CO" }));
    expect(within(table).getByRole("button", { name: "Decisions: CO" })).toHaveAttribute("aria-expanded", "true");
    const links = within(group).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toContain(`hand=${hs[1]!.id}`);
    expect(links[1]!.getAttribute("href")).toContain(`hand=${hs[2]!.id}`);
  });

  it("reads a size from the history, and says what it leaves out and why", async () => {
    const [srp, pot] = await fixtures("stars_6max_srp.txt", "stars_3bet_pot.txt");
    await seed([srp!, pot!], [dec(srp!, { id: `${srp!.id}|preflop|3`, i: 3 }), dec(pot!, { id: `${pot!.id}|preflop|4`, i: 4 }), cbet(pot!, { id: `${pot!.id}|flop|2`, i: 2 })]);
    open();
    const group = await screen.findByRole("group", { name: "Breakdowns" });
    pick("Break decisions down by", "faced");
    expect(within(group).getByText(/a decision stores only that it faced a bet/)).toBeInTheDocument();
    const table = await within(group).findByRole("table", { name: "Bet size faced" });
    expect(within(table).getByRole("row", { name: "Preflop: a raise to 2.5–3.5bb" })).toHaveTextContent("1");
    expect(within(table).getByRole("row", { name: "After the flop: a bet of 60–80% of the pot" })).toBeInTheDocument();
    expect(within(group).getByLabelText("Left out of this breakdown")).toHaveTextContent("Left out, of 3 decisions graded: 1 because no bet or raise to answer.");
    pick("Break decisions down by", "stack");
    expect(await within(group).findByRole("table", { name: "Effective stack" })).toHaveTextContent("75–125bb");
    expect(within(group).getByText(/a decision stores no stack/)).toBeInTheDocument();
  });

  it("follows the filters, and groups by the flop's texture with the preflop left out", async () => {
    const hs = [hand(T0, { board: "Qs8d3c" }), hand(T0 + 1, { board: "Qs8s3s", site: "GGPoker" })];
    await seed(hs, [dec(hs[0]!), cbet(hs[0]!), cbet(hs[1]!)]);
    open("site=PokerStars");
    const group = await screen.findByRole("group", { name: "Breakdowns" });
    pick("Break decisions down by", "suits");
    const table = await within(group).findByRole("table", { name: "Flop: suits" });
    expect(within(table).getByRole("row", { name: "Rainbow" })).toHaveTextContent("1");
    expect(within(table).queryByRole("row", { name: "Monotone" })).toBeNull();
    expect(within(group).getByLabelText("Left out of this breakdown")).toHaveTextContent("before the flop, there's no board");
  });
});

describe("the frequencies and leaks", () => {
  const opens = (n: number) => {
    const hs = Array.from({ length: n }, (_, i) => hand(T0 + i));
    return { hs, ds: hs.map((h) => dec(h)) };
  };

  it("shows the count and a range on each frequency, and opens the decisions behind it", async () => {
    const { hs, ds } = opens(10);
    await seed(hs, ds);
    open();
    const table = await screen.findByRole("table", { name: "Frequencies" });
    const row = within(table).getByRole("row", { name: "Open (RFI)" });
    expect(row).toHaveTextContent("10");
    expect(row).toHaveTextContent("72%–100%");
    expect(row).toHaveTextContent("few");
    fireEvent.click(within(row).getByRole("button", { name: "Decisions: Open (RFI)" }));
    expect(screen.getByRole("region", { name: "Report" })).toHaveTextContent(/Open \(RFI\)/);
    expect(within(screen.getByRole("region", { name: "Report" })).getAllByRole("link").filter((l) => l.getAttribute("href")?.includes("hand=")).length).toBeGreaterThanOrEqual(10);
  });

  it("holds back what looks off on too few decisions, and says the rule", async () => {
    const { hs, ds } = opens(10);
    await seed(hs, ds);
    open();
    const rep = await screen.findByRole("region", { name: "Report" });
    expect(within(rep).getByLabelText("What makes a leak")).toHaveTextContent("30");
    expect(within(rep).queryByRole("heading", { name: "Open (RFI)" })).toBeNull();
    const thin = within(rep).getByRole("list", { name: "Too few to read", hidden: true });
    expect(thin).toHaveTextContent("Open (RFI)");
    expect(within(rep).queryByRole("button", { name: "Drill this leak" })).toBeNull();
  });

  it("marks a leak once the sample can say so, with its range and the decisions behind it", async () => {
    const { hs, ds } = opens(30);
    await seed(hs, ds);
    open();
    const rep = await screen.findByRole("region", { name: "Report" });
    const leaks = within(rep).getByRole("list", { name: "Leaks" });
    expect(leaks).toHaveTextContent("Open (RFI)");
    expect(leaks).toHaveTextContent("95% range");
    fireEvent.click(within(leaks).getAllByRole("button", { name: /Show its decisions/ })[0]!);
    expect(within(rep).getAllByRole("link").filter((l) => l.getAttribute("href")?.includes("hand=")).length).toBeGreaterThan(0);
  });
});

describe("the three measures", () => {
  it("keeps realized results, all-in adjusted and solver EV lost apart, with no win rate from the last", async () => {
    const [srp, pot] = await fixtures("stars_6max_srp.txt", "stars_3bet_pot.txt");
    await seed([srp!, pot!], [cbet(srp!, { evLossBb: 0.6 }), dec(pot!)]);
    open();
    const res = await screen.findByRole("region", { name: "Your results" });
    const three = await within(res).findByRole("group", { name: "Three measures, kept apart" });
    const real = within(three).getByRole("group", { name: "Realized results" });
    const adj = within(three).getByRole("group", { name: "All-in adjusted" });
    const lost = within(three).getByRole("group", { name: "Solver EV lost" });
    // +10.5bb and −100bb, and the turn all-in was drawing dead
    expect(real).toHaveTextContent("Cash games: −89.5bb over 2 hands");
    expect(adj).toHaveTextContent("Cash games: −89.5bb (1 all-in adjusted)");
    await waitFor(() => expect(lost).toHaveTextContent("Cash games: 0.6bb lost over 1 decision graded by EV, of 2 graded"));
    expect(lost).toHaveTextContent("It isn't a win rate, and none is worked out from it.");
    expect(lost).not.toHaveTextContent("bb/100");
    expect(real).not.toHaveTextContent("lost over");
  });

  it("says nothing's graded where nothing is, and follows the filters", async () => {
    const [srp, pot] = await fixtures("stars_6max_srp.txt", "stars_3bet_pot.txt");
    await seed([srp!, pot!], [cbet(srp!), cbet(pot!, { evLossBb: 2 })]);
    open(`pos=${pot!.hero}`);
    const res = await screen.findByRole("region", { name: "Your results" });
    const lost = await within(res).findByRole("group", { name: "Solver EV lost" });
    await waitFor(() => expect(lost).toHaveTextContent("Cash games: 2bb lost over 1 decision graded by EV, of 1 graded"));
    cleanup();
    await (await db())!.clear("decisions");
    open();
    const again = await screen.findByRole("region", { name: "Your results" });
    const none = await within(again).findByRole("group", { name: "Solver EV lost" });
    await waitFor(() => expect(none).toHaveTextContent("Nothing here is graded."));
  });

  it("links a seat in the results to its hands", async () => {
    const [srp] = await fixtures("stars_6max_srp.txt");
    await seed([srp!]);
    open();
    const res = await screen.findByRole("region", { name: "Your results" });
    const link = await within(res).findByRole("link", { name: "Filter to your hands in BTN" });
    expect(link.getAttribute("href")).toContain("pos=BTN");
  });
});

describe("your stats as played", () => {
  it("adds bluff-catching and the raises by size to the bets, each with its count", async () => {
    const hs = await fixtures("stars_6max_srp.txt", "stars_3bet_pot.txt", "gg_limped_multiway.txt");
    await seed(hs);
    open();
    const st = await screen.findByRole("region", { name: "Your stats" });
    const raises = await within(st).findByRole("table", { name: "Raise sizes" });
    // the open's 2.5×, the 3-bet's 4.4× and the flop's check-raise, 5.25×
    expect(within(raises).getByRole("row", { name: "2.5–3×" })).toHaveTextContent("1");
    expect(within(raises).getByRole("row", { name: "4–6×" })).toHaveTextContent("1");
    const freq = within(st).getByRole("table", { name: "Frequencies as played" });
    expect(within(freq).getByRole("row", { name: "River call (bluff-catching)" })).toBeInTheDocument();
    expect(st).toHaveTextContent("few");
  });
});
