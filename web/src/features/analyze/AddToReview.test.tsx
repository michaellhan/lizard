/// <reference types="node" />
// "Add to review" in the hand: on a miss only, keeps it once, and isn't offered for a tournament or an exploit session.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, putSession, type DecisionRecord, type HandRecord } from "@/data/db";
import { addHands, putDecisions } from "@/data/hands";
import { keepMistake, listMistakes } from "@/data/mistakes";
import { addedMistake } from "@/features/review/fromAnalyze";
import { importHand } from "@/hh/replay";
import { recordOf } from "./analyze";
import { AnalyzePage } from "./AnalyzePage";
import { decisionId } from "./grading";
import { sessionImport } from "./sessions";

vi.mock("@/solver/useSolver", () => ({ useSolver: () => async () => ({}) }));

const text = readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", "stars_6max_srp.txt"), "utf8");
const rec = (n: string, importId: string, over: Partial<HandRecord> = {}): HandRecord => ({ ...recordOf(text, importHand(text), { id: importId, name: "Hands", at: 1 }), id: `h|${n}`, number: n, ...over });
const miss = (handId: string, x: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: decisionId(handId, "flop", 1),
  handId,
  street: "flop",
  i: 1,
  pos: "BTN",
  action: "bet 1.8",
  matched: "bet 33%",
  situation: "SRP · IP · checked to",
  verdict: "Mistake",
  evLossBb: 0.5,
  lossPct: 9,
  byEv: true,
  pot: 5.5,
  mix: [["check", 0.95, 3.5], ["bet 33%", 0.05, 3]],
  source: "library",
  label: "Precomputed solution · srp_btn_bb",
  gradedAt: 1,
  ...x,
});
const open = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/analyze?${new URLSearchParams({ hand: id })}`]}>
      <AnalyzePage />
    </MemoryRouter>,
  );

beforeEach(async () => {
  const d = (await db())!;
  for (const s of ["hands", "decisions", "mistakes", "sessions"] as const) await d.clear(s);
});

describe("Add to review", () => {
  it("keeps a miss once, says when it's due, and says the rule", async () => {
    await addHands([rec("A", "imp")]);
    await putDecisions([miss("h|A")]);
    open("h|A");
    const hand = await screen.findByRole("region", { name: "Hand" });
    expect(await within(hand).findByText(/Misses reach Review only through Add to review/)).toBeInTheDocument();
    fireEvent.click(await within(hand).findByRole("button", { name: "Add to review: flop decision 2" }));
    const said = await within(hand).findByText(/Added, due tomorrow/);
    expect(within(said).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/review");
    const { list } = await listMistakes();
    expect(list).toMatchObject([{ from: "analyze", chose: "bet 33%", street: "flop", ask: { via: "kept", hand: "h|A" } }]);
  });

  it("says a spot's already kept", async () => {
    await addHands([rec("A", "imp")]);
    await putDecisions([miss("h|A")]);
    const first = open("h|A");
    fireEvent.click(await screen.findByRole("button", { name: "Add to review: flop decision 2" }));
    await screen.findByText(/Added, due tomorrow/);
    first.unmount();
    open("h|A");
    fireEvent.click(await screen.findByRole("button", { name: "Add to review: flop decision 2" }));
    expect(await screen.findByText(/Already kept/)).toBeInTheDocument();
    expect((await listMistakes()).list).toHaveLength(1);
  });

  it("says a spot's kept already under Practice's id, and adds nothing", async () => {
    const hand = rec("A", "imp");
    await addHands([hand]);
    await putDecisions([miss("h|A")]);
    const entry = addedMistake(miss("h|A"), hand, importHand(text), 1)!;
    await keepMistake({ ...entry, id: "hand|written another way", from: "hand", ask: { via: "solver", state: { players: 6 } as never } }, (w) => w);
    open("h|A");
    fireEvent.click(await screen.findByRole("button", { name: "Add to review: flop decision 2" }));
    expect(await screen.findByText(/Already kept/)).toBeInTheDocument();
    expect((await listMistakes()).list.map((m) => m.id)).toEqual(["hand|written another way"]);
  });

  it("links a Practice hand to Study with the rake and sizes it was played at", async () => {
    await addHands([rec("A", "imp", { setup: { rake: 5, sizes: { flop: [50] } } })]);
    await putDecisions([miss("h|A")]);
    open("h|A");
    expect((await screen.findByRole("link", { name: "Study flop decision 2" })).getAttribute("href")).toContain("sz.flop=50&rake=5");
  });

  it("says why a miss can't be added, and not that this browser keeps nothing", async () => {
    await addHands([rec("A", "imp")]);
    await putDecisions([miss("h|A", { matched: "bet 300%" })]);
    open("h|A");
    fireEvent.click(await screen.findByRole("button", { name: "Add to review: flop decision 2" }));
    expect(await screen.findByText(/Not for Review: what you played, bet 1\.8, isn't one of the actions in the answer kept/)).toBeInTheDocument();
    expect(screen.queryByText(/private window/)).toBeNull();
    expect((await listMistakes()).list).toEqual([]);
  });

  it("says a hand with no cards of yours can't be added", async () => {
    await addHands([rec("A", "imp", { hole: "" })]);
    await putDecisions([miss("h|A")]);
    open("h|A");
    fireEvent.click(await screen.findByRole("button", { name: "Add to review: flop decision 2" }));
    expect(await screen.findByText(/Not for Review: this hand kept no cards of yours/)).toBeInTheDocument();
    expect(screen.queryByText(/private window/)).toBeNull();
  });

  it("isn't offered on what wasn't missed, and says why where a miss can't be dealt", async () => {
    await addHands([rec("A", "imp")]);
    await putDecisions([miss("h|A", { verdict: "Correct" }), miss("h|A", { id: decisionId("h|A", "turn", 1), street: "turn", mix: undefined })]);
    open("h|A");
    expect(await screen.findByText(/Not for Review: no mix was kept with its grade/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add to review/ })).toBeNull();
  });

  it.each([
    ["a tournament hand", "T", { tournament: "T" }, /A tournament hand stays out of Review/],
    ["a hand from an exploit session", "E", {}, /A hand from an exploit session stays out of Review/],
  ])("keeps out %s, and says so", async (_, n, over, words) => {
    await putSession({ id: "x", kind: "exploit", startedAt: 1, endedAt: 2, data: {} } as never);
    await addHands([rec(n, n === "E" ? sessionImport("x") : "imp", over)]);
    await putDecisions([miss(`h|${n}`)]);
    open(`h|${n}`);
    expect(await screen.findByText(words)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Add to review/ })).toBeNull());
  });
});
