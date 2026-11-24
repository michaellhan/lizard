// The board view on the page (BoardsPanel.tsx): a flop frequency by texture class against the answer's, the flops
// behind a class, the decisions behind a row, the choices of decision, grouping, pot type and position, and what it
// leaves out; and in the report, folded until opened.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { BoardsPanel } from "./BoardsPanel";
import { GradeReport } from "./GradingPanel";

vi.mock("@/solver/useSolver", () => ({ useSolver: () => async () => ({ solve: async () => ({ data: { skipped: "no" }, provenance: {} }) }) }));

let id = 0;
const hand = (board: string, over: Partial<HandRecord> = {}): HandRecord =>
  ({ id: `h${++id}`, number: String(id), site: "PokerStars", played: "", playedAt: 0, hero: "BTN", players: 6, hole: "AhKd", board, bb: "$1", potType: "SRP", pot: 5, end: "showdown", decisions: 1, text: "x", importId: "i", importName: "i", importedAt: 1, ...over }) as HandRecord;
const cbet = (h: HandRecord, action: string, over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: `${h.id}|flop|1`,
  handId: h.id,
  street: "flop",
  pos: "BTN",
  action,
  situation: "SRP · IP · checked to",
  role: "PFR",
  facing: false,
  multi: false,
  ip: true,
  potType: "SRP",
  mix: [["check", 0.6, 3.1], ["bet 33%", 0.4, 2.5]],
  verdict: "Best",
  evLossBb: 0,
  lossPct: 0,
  source: "library",
  label: "Precomputed solution · srp_btn_bb",
  gradedAt: 0,
  ...over,
});

const HS = [hand("As7d2c"), hand("Ah7s2d"), hand("Kh9h4h"), hand("Qs8d3c", { potType: "3bet pot" }), hand("")];
const DS = [
  cbet(HS[0]!, "bet 1.8"),
  cbet(HS[1]!, "bet 1.8"),
  cbet(HS[2]!, "check", { mix: [["check", 1, 2], ["bet 33%", 0, 1]] }),
  cbet(HS[3]!, "check", { potType: "3bet pot", ip: false, verdict: "Mistake", evLossBb: 0.4 }),
  cbet(HS[4]!, "bet 1.8"),
];
const byId = new Map(HS.map((h) => [h.id, h]));
const show = (ds = DS) =>
  render(
    <MemoryRouter>
      <BoardsPanel ds={ds} byId={byId} />
    </MemoryRouter>,
  );
const row = (name: string) => screen.getByRole("row", { name });
const cells = (name: string) => within(row(name)).getAllByRole("cell").map((c) => c.textContent);
const pick = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });

afterEach(cleanup);

describe("the board view", () => {
  it("shows the c-bet by high card, each class with its count, your share, its range, few, the answer's and the gap", () => {
    show();
    expect(screen.getByRole("combobox", { name: "Flop decision" })).toHaveValue("Flop c-bet");
    expect(screen.getByRole("option", { name: "Flop c-bet (4)" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Flop c-bet by board" })).toBeInTheDocument();
    // every flop: 4 decisions, 2 bets; the answer bets 40%, 40%, 0%, 40%
    expect(cells("Every flop").slice(0, 5)).toEqual(["4", "50%", expect.stringMatching(/few$/), "30%", "+20"]);
    expect(cells("A high").slice(0, 5)).toEqual(["2", "100%", expect.stringMatching(/few$/), "40%", "+60"]);
    expect(cells("K high").slice(0, 5)).toEqual(["1", "0%", expect.stringMatching(/few$/), "0%", "0"]);
    expect(cells("A high")[5]).toBe("Flop library 2");
    expect(screen.getByRole("group", { name: "Left out of the board view" })).toHaveTextContent("1 decision because its hand keeps no flop");
  });

  it("opens a class's flops, alike flops in one row, and the decisions behind a row", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Flops: A high" }));
    expect(cells("A high: As7h2d").slice(0, 2)).toEqual(["2", "100%"]);
    fireEvent.click(screen.getByRole("button", { name: "Decisions: Flop c-bet, As7h2d" }));
    expect(within(screen.getByRole("list", { name: "Flop c-bet, As7h2d" })).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Decisions: Flop c-bet, K high" }));
    expect(within(screen.getByRole("list", { name: "Flop c-bet, K high" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("groups by suits, and narrows to a pot type and a position", () => {
    show();
    pick("Board by", "suits");
    expect(cells("Rainbow")[0]).toBe("3");
    expect(cells("Monotone")[0]).toBe("1");
    pick("Board pot type", "3bet pot");
    expect(cells("Every flop").slice(0, 2)).toEqual(["1", "0%"]);
    pick("Board pot type", "");
    pick("Board position", "ip");
    expect(cells("Every flop")[0]).toBe("3");
    pick("Board position", "oop");
    expect(cells("Every flop")[0]).toBe("1");
  });

  it("says when a decision has nothing to show", () => {
    show();
    pick("Flop decision", "Flop check-raise");
    expect(screen.getByText("No graded flop check-raise decision with a flop yet.")).toBeInTheDocument();
  });

  it("is in the report, folded until opened", () => {
    render(
      <MemoryRouter>
        <GradeReport decisions={DS} hands={HS} />
      </MemoryRouter>,
    );
    const details = screen.getByText("Your flop play by board, against the answer's").closest("details")!;
    expect(screen.queryByRole("group", { name: "Flop play by board", hidden: true })).toBeNull();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(screen.getByRole("group", { name: "Flop play by board" })).toBeInTheDocument();
  });
});
