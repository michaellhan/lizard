// The Solve page: opened on a Study spot (its line and setup filled in), what's out of range refused before Study is
// opened, each field into Study's URL, a saved range picked for a seat, and a new table size starting the line over.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { deleteRange, putRange } from "@/data/saved";
import { fromSearch, studyRequest } from "@/features/study/studyState";
import { SolvePage } from "./SolvePage";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const open = (q: string, at = "/solve") =>
  render(
    <MemoryRouter initialEntries={[`${at}?${q}`]}>
      <Routes>
        <Route path="/solve" element={<SolvePage />} />
        <Route path="/tournaments" element={<SolvePage kind="tournament" />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
const type = (name: string, value: string) => fireEvent.change(screen.getByRole(name === "Players" ? "combobox" : "textbox", { name }), { target: { value } });
const num = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
const problems = () => screen.queryByRole("alert", { name: "Setup problems" });

describe("SolvePage", () => {
  it("says node locks and automatic sizing are in Study, by the names they have there, and sends no one to the classic app for them", () => {
    open("p=2&s=100");
    expect(screen.getByText(/Node locks and automatic sizing are in Study, a hand at a time: .Hold this node at a mix \(true node lock\)., .Against a read \(best response\). and .Choose bet sizes \(automatic sizing\)./)).toBeInTheDocument();
    expect(screen.queryByText(/Not here yet: node locks/)).toBeNull();
    expect(screen.queryByRole("link", { name: /classic/i })).toBeNull();
  });

  it("sets up a spot from a Study line, refuses what's out of range, and opens it in Study with every setting", async () => {
    open("p=2&s=100&pre=SB:r2.5,BB:c&b=Ks7d2c&rake=5");
    expect(screen.getByRole("combobox", { name: "Players" })).toHaveValue("2");
    expect(screen.getByRole("spinbutton", { name: "Rake" })).toHaveValue(5);
    expect(screen.getByText(/From the first decision \(else at SB raise 2\.5 BB call Ks7d2c\)/)).toBeInTheDocument();
    // a straddle needs 3 players
    expect(screen.getByRole("checkbox", { name: "Straddle" })).toBeDisabled();

    // out of range: refused, and Study isn't opened
    type("Flop bets", "33, 75, 125, 150");
    num("Rake", "30");
    type("BB range", "22+, XYZ");
    expect(within(problems()!).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "at most 3 flop bet sizes (each one multiplies the game tree)",
      "the rake must be 0–25% of the pot",
      `BB's range: can't read "XYZ"`,
    ]);
    const go = screen.getByRole("button", { name: "Open in Study" });
    expect(go).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Spot setup" }));
    expect(screen.queryByTestId("where")).toBeNull();

    // fixed: every setting in Study's URL, at the line it came from
    type("Flop bets", "33, 75%");
    type("Raises", "60");
    num("Rake", "5");
    num("Rake cap", "3");
    num("BB stack", "40");
    type("BB range", "22+,A2s+,AhKh");
    expect(problems()).toBeNull();
    fireEvent.click(go);
    const where = screen.getByTestId("where").textContent!;
    expect(where).toMatch(/^\/study\?p=2&s=100&pre=SB%3Ar2\.5%2CBB%3Ac&b=Ks7d2c&/);
    const h = fromSearch(where.split("?")[1]!)!;
    expect(h.setup).toEqual({ stacks: { BB: 40 }, sizes: { flop: [33, 75], raise: [60] }, rake: 5, rakeCap: 3, ranges: { BB: "22+,A2s+,AhKh" } });
    expect(studyRequest(h)).toMatchObject({ stacks: { BB: 40 }, sizes: { flop: [33, 75], raise: [60] }, rake: 0.05, rake_cap: 3, ranges: { BB: "22+,A2s+,AhKh" } });
  });

  it("fills a seat's range from a saved range, and starts the line over at a new table size", async () => {
    await putRange({ id: "r1", name: "BTN open", text: "22+,A2s+,K9s+", combos: 300, note: "", createdAt: 1, updatedAt: 1 });
    open("p=2&s=100&pre=SB:r2.5,BB:c&b=Ks7d2c");
    fireEvent.change(await screen.findByRole("combobox", { name: "SB saved range" }), { target: { value: "r1" } });
    expect(screen.getByRole("textbox", { name: "SB range" })).toHaveValue("22+,A2s+,K9s+");

    type("Players", "6");
    expect(screen.getByText("Opens at the first decision.")).toBeInTheDocument();
    // (the SB's range kept: the seat is at the new table too)
    fireEvent.click(screen.getByRole("checkbox", { name: "Straddle" }));
    num("Ante", "0.12");
    num("Table stack", "60");
    fireEvent.click(screen.getByRole("button", { name: "Open in Study" }));
    const h = fromSearch(screen.getByTestId("where").textContent!.split("?")[1]!)!;
    expect(h).toMatchObject({ players: 6, stack: 60, board: "", preflop: [], setup: { ante: 0.12, straddle: true, ranges: { SB: "22+,A2s+,K9s+" } } });
    await deleteRange("r1");
  });

  it("clears the setup, and opens at the first decision when asked", async () => {
    open("p=6&s=100&pre=UTG:f,HJ:r2.5&sz.turn=75&ante=0.1&straddle=1&rg.BB=QQ%2B");
    expect(screen.getByRole("textbox", { name: "Turn bets" })).toHaveValue("75");
    expect(screen.getByRole("checkbox", { name: "Straddle" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear the setup" }));
    expect(screen.getByRole("textbox", { name: "BB range" })).toHaveValue("");
    fireEvent.click(screen.getByRole("checkbox", { name: /From the first decision/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open in Study" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/study?p=6&s=100"));
  });

  it("sets up a tournament: payouts, other tables, bounties (each seat's and its own), no rake, into Study's URL", () => {
    open("p=6&s=25", "/tournaments");
    expect(screen.getByRole("heading", { name: "Tournaments" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Rake" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Satellite, 5 seats" }));
    expect(screen.getByRole("textbox", { name: "Payouts" })).toHaveValue("1 1 1 1 1");
    fireEvent.click(screen.getByRole("button", { name: "Top 3" }));
    expect(screen.getByRole("textbox", { name: "Payouts" })).toHaveValue("50 30 20");
    num("Players at other tables", "12");
    num("Their average stack", "40");
    fireEvent.change(screen.getByRole("combobox", { name: "Bounties" }), { target: { value: "ko" } });
    num("Each seat's bounty", "5");
    num("BTN bounty", "10");
    num("CO stack", "8");
    // what can't be asked is refused first
    type("Payouts", "50 thirty 20");
    expect(within(problems()!).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["the payouts must be positive numbers, first place first (like 50, 30, 20)"]);
    // a table pasted from a site is read place by place
    const box = screen.getByRole("textbox", { name: "Payouts" });
    fireEvent.paste(box, { clipboardData: { getData: () => "Place\tPrize\n1st\t$5,000\n2nd\t$3,000\n3rd\t$2,000" } });
    expect(box).toHaveValue("5000 3000 2000");
    expect(problems()).toBeNull();
    type("Payouts", "50/30/20");
    expect(problems()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in Study" }));
    const where = screen.getByTestId("where").textContent!;
    expect(where).toBe("/study?p=6&s=25&stacks=CO%3A8&pay=50%2C30%2C20&fld=12%3A40&bty=ko&bty.each=5&bs.BTN=10");
    expect(studyRequest(fromSearch(where.split("?")[1]!)!)).toMatchObject({
      payouts: [50, 30, 20],
      field: { players: 12, chips: 480 },
      bounties: { format: "ko", seats: { UTG: 5, BTN: 10, BB: 5 } },
    });
  });

  it("shows every pair's bubble factor from the setup, and offers the 15%-paid shape for the players left", () => {
    open("p=4&s=35", "/tournaments");
    expect(screen.queryByRole("region", { name: "Bubble factors" })).toBeNull();
    expect(screen.queryByRole("button", { name: /15% paid/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Top 3" }));
    num("BTN stack", "12");
    num("SB stack", "60");
    num("BB stack", "8");
    // (the engine's numbers for these stacks: icm.test.ts)
    const table = within(screen.getByRole("region", { name: "Bubble factors" })).getByRole("table", { name: "Bubble factors, every pair" });
    const row = (seat: string) => within(table).getByRole("row", { name: new RegExp(`^${seat} `) }).textContent;
    expect(row("CO")).toBe("CO—1.163.431.1031.6%");
    expect(row("BB")).toBe("BB1.661.151.78—12.2%");
    // 96 players at other tables: 100 left, 15 places
    num("Players at other tables", "96");
    num("Their average stack", "30");
    fireEvent.click(screen.getByRole("button", { name: "15% paid, 15 places" }));
    expect((screen.getByRole("textbox", { name: "Payouts" }) as HTMLInputElement).value).toMatch(/^23\.7 13\.6 /);
    expect(screen.getByRole("region", { name: "Bubble factors" })).toHaveTextContent("100 players modelled by 12");
    // a winner-takes-all has none
    type("Payouts", "100");
    expect(screen.queryByRole("region", { name: "Bubble factors" })).toBeNull();
  });

  it("sets up a stage of an MTT at once, and opens it in Study from the first decision with every number", () => {
    open("p=6&s=100&pre=UTG:r2.5", "/tournaments");
    fireEvent.click(screen.getByRole("button", { name: "Final table" }));
    expect(screen.getByRole("button", { name: "Final table" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Players" })).toHaveValue("9");
    expect(screen.getByRole("spinbutton", { name: "Table stack" })).toHaveValue(62);
    expect(screen.getByRole("spinbutton", { name: "Ante" })).toHaveValue(0.11);
    expect(screen.getByRole("spinbutton", { name: "BB stack" })).toHaveValue(21);
    expect(screen.getByRole("textbox", { name: "Payouts" })).toHaveValue("30 20 14 10.5 8 6.5 5 3.5 2.5");
    expect(screen.getByText(/^Set up: Final table\. 9 players left, all paid.*Lizard's own, not any site's\.$/)).toBeInTheDocument();
    expect(problems()).toBeNull();
    expect(screen.getByRole("region", { name: "Bubble factors" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open in Study/ }));
    const h = fromSearch(screen.getByTestId("where").textContent!.split("?")[1]!)!;
    expect(h.players).toBe(9);
    expect(h.preflop).toEqual([]);
    expect(h.setup?.stacks).toEqual({ UTG: 27, UTG1: 9, LJ: 16, HJ: 34, CO: 6, BTN: 45, SB: 12, BB: 21 });
    expect(h.setup?.tournament?.payouts).toHaveLength(9);
    // the bubble: the other tables and the places paid make one more bust the money
    open("p=6&s=100", "/tournaments");
    fireEvent.click(screen.getAllByRole("button", { name: "Bubble" }).at(-1)!);
    expect(screen.getAllByRole("spinbutton", { name: "Players at other tables" }).at(-1)).toHaveValue(108);
    expect((screen.getAllByRole("textbox", { name: "Payouts" }).at(-1) as HTMLInputElement).value.split(" ")).toHaveLength(115);
    // Clear forgets it
    fireEvent.click(screen.getAllByRole("button", { name: /^Clear/ }).at(-1)!);
    expect(screen.getAllByText(/^A stage sets the table/).at(-1)).toBeInTheDocument();
  });

  it("opens a Study spot's tournament as it was set, mystery bounties too", () => {
    open("p=6&s=30&pay=100&bty=mystery&bty.pool=500&bty.left=40", "/tournaments");
    expect(screen.getByRole("textbox", { name: "Payouts" })).toHaveValue("100");
    expect(screen.getByRole("combobox", { name: "Bounties" })).toHaveValue("mystery");
    expect(screen.getByRole("spinbutton", { name: "Envelope pool" })).toHaveValue(500);
    expect(screen.getByRole("spinbutton", { name: "Envelopes left" })).toHaveValue(40);
    // a mystery bounty needs both the pool and the envelopes left
    num("Envelopes left", "");
    expect(within(problems()!).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["mystery bounties need the average envelope, or the pool and the envelopes left"]);
  });

  it("ties each problem to its field, and says the limits before they're broken", () => {
    open("p=2&s=100");
    expect(screen.getByRole("spinbutton", { name: "Rake" })).not.toHaveAttribute("aria-invalid");
    num("Rake", "30");
    type("BB range", "22+, XYZ");
    const rake = screen.getByRole("spinbutton", { name: "Rake" });
    expect(rake).toHaveAttribute("aria-invalid", "true");
    expect(rake).toHaveAccessibleDescription("the rake must be 0–25% of the pot");
    expect(screen.getByRole("textbox", { name: "BB range" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "BB range" })).toHaveAccessibleDescription(/can.t read "XYZ"/);
    num("Rake", "5");
    expect(rake).not.toHaveAttribute("aria-invalid");
    expect(rake).not.toHaveAttribute("aria-describedby");
  });
});
