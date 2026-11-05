/// <reference types="node" />
// A leak drill on the page: a turn dealt from what its grade kept, what it carries of the grade, a miss kept for Review
// and a pick that isn't, and what can't be dealt said.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, getSession, type DecisionRecord, type HandRecord } from "@/data/db";
import { addHands, putDecisions } from "@/data/hands";
import { keepMistake, listMistakes } from "@/data/mistakes";
import { leakMistake } from "@/features/review/fromAnalyze";
import { importHand } from "@/hh/replay";
import { recordOf } from "./analyze";
import { AnalyzePage } from "./AnalyzePage";
import { decisionId } from "./grading";
import { drillSessionId, leakParam, type LeakRef } from "./leakDrill";
import { LeakDrill } from "./LeakDrillPanel";

const mocks = vi.hoisted(() => ({ solve: vi.fn() }));
vi.mock("@/solver/useSolver", () => ({ useSolver: () => mocks.solve }));

const text = readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", "stars_6max_srp.txt"), "utf8");
const hand: HandRecord = { ...recordOf(text, importHand(text), { id: "i1", name: "Hands", at: 1 }), id: "h1" };
const LEAK: LeakRef = { kind: "spot", key: "Turn · SRP · IP · checked to" };
const turn = (x: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: decisionId("h1", "turn", 1),
  handId: "h1",
  street: "turn",
  i: 1,
  pos: "BTN",
  action: "check",
  matched: "check",
  situation: "SRP · IP · checked to",
  verdict: "Mistake",
  evLossBb: 0.5,
  lossPct: 5,
  byEv: true,
  pot: 10,
  mix: [["check", 0.05, 2.5], ["bet 75%", 0.95, 3]],
  source: "live",
  label: "Live solve (Quick) · 0.80% pot from equilibrium in the solved game (converged) · 300 iterations · medium confidence",
  band: "converged",
  confidence: "medium",
  triageSource: "quick",
  version: "build:abc/123",
  gradedAt: 1,
  ...x,
});
const drill = (ds: DecisionRecord[], hands = [hand]) =>
  render(
    <MemoryRouter>
      <LeakDrill leak={LEAK} decisions={ds} hands={hands} kept={hands} onClose={() => undefined} />
    </MemoryRouter>,
  );

beforeEach(async () => {
  const d = (await db())!;
  await d.clear("mistakes");
  await d.clear("sessions");
  await d.clear("hands");
  await d.clear("decisions");
});

describe("a leak drill from Analyze", () => {
  it("totals the hands the leak is read from: a tournament's decision is no part of it", async () => {
    const cups: HandRecord = { ...hand, id: "t1", number: "t1", tournament: "Sunday" };
    await addHands([hand, cups]);
    await putDecisions([turn(), turn({ id: decisionId("t1", "turn", 1), handId: "t1" })]);
    render(
      <MemoryRouter initialEntries={[`/analyze?${new URLSearchParams({ drill: leakParam(LEAK) })}`]}>
        <AnalyzePage />
      </MemoryRouter>,
    );
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: /^check/i }));
    await waitFor(async () => expect((await getSession(drillSessionId(LEAK)))?.meta).toMatchObject({ total: 1, done: [turn().id] }));
  });
});

describe("a leak drill on the turn", () => {
  it("deals the turn from what the grade kept, and says nothing is solved", async () => {
    drill([turn()]);
    expect(await screen.findByRole("button", { name: /^check/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Leak drill" })).toHaveTextContent(/on every street/);
    expect(screen.getByRole("region", { name: "Leak drill" })).toHaveTextContent(/Nothing is solved/);
    expect(mocks.solve).not.toHaveBeenCalled();
  });

  it("grades a miss against the kept mix with the grade's provenance and confidence, and keeps it for Review", async () => {
    drill([turn()]);
    fireEvent.click(await screen.findByRole("button", { name: /^check/i }));
    const group = await screen.findByRole("group", { name: "What graded it" });
    expect(group).toHaveTextContent(/medium confidence/);
    expect(group).toHaveTextContent(/nothing is solved here/);
    expect(group).toHaveTextContent(/A Quick triage read at medium confidence/);
    const said = await screen.findByText(/due tomorrow/);
    expect(said).toHaveTextContent("Kept for Review, due tomorrow.");
    expect(within(said).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/review");
    const { list } = await listMistakes();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ from: "leak", chose: "check", street: "turn", ask: { via: "kept", hand: "h1" }, provenance: { confidence: "medium", source: "live" } });
    expect(mocks.solve).not.toHaveBeenCalled();
  });

  it("merges a miss into the spot's record under another id, whose id stays", async () => {
    const pick = { a: 0, best: 1, verdict: "Mistake", ok: false, mixed: false, loss: 0.5, lossPct: 5, byEv: true } as const;
    const was = leakMistake(turn(), hand, importHand(text), pick, "s", 1)!;
    await keepMistake({ ...was, id: "hand|written another way", from: "hand", ask: { via: "solver", state: { players: 6 } as never } }, (w) => w);
    drill([turn()]);
    fireEvent.click(await screen.findByRole("button", { name: /^check/i }));
    await screen.findByText(/due tomorrow/);
    expect((await listMistakes()).list).toMatchObject([{ id: "hand|written another way", times: 2, ask: { via: "solver" } }]);
  });

  it("links a Practice hand to Study with the rake and sizes it was played at", async () => {
    drill([turn()], [{ ...hand, setup: { rake: 5, sizes: { flop: [50] } } }]);
    fireEvent.click(await screen.findByRole("button", { name: /^check/i }));
    expect((await screen.findByRole("link", { name: "Open in Study" })).getAttribute("href")).toContain("sz.flop=50&rake=5");
  });

  it("keeps nothing for a pick that's right", async () => {
    drill([turn()]);
    fireEvent.click(await screen.findByRole("button", { name: /^bet 75%/i }));
    await screen.findByRole("group", { name: "What graded it" });
    expect(screen.queryByText(/Kept for/)).toBeNull();
    expect((await listMistakes()).list).toEqual([]);
  });

  it("marks a rough solve's cap and a rough EV", async () => {
    drill([turn({ band: "rough", roughEvs: ["check"], mix: [["check", 0.05, 1], ["bet 75%", 0.95, 9]] })]);
    fireEvent.click(await screen.findByRole("button", { name: /^check/i }));
    expect(await screen.findByRole("group", { name: "What graded it" })).toHaveTextContent(/stops at Inaccuracy/);
    expect(screen.getByText(/≈/, { selector: "td" })).toBeInTheDocument();
    await waitFor(async () => expect((await listMistakes()).list[0]).toMatchObject({ grade: { verdict: "Inaccuracy" } }));
  });

  it("says what it can't deal, with others to deal and with none", async () => {
    const some = drill([turn(), turn({ id: "h1|turn|2", i: 2, mix: undefined })]);
    expect(await screen.findByText(/1 of this leak's graded decisions isn't dealt here/)).toBeInTheDocument();
    some.unmount();
    drill([turn({ mix: undefined })]);
    expect(await screen.findByText(/None of this leak's decisions is graded with its mix in this browser/)).toBeInTheDocument();
    expect(screen.getByText(/1 kept no mix with the grade/)).toBeInTheDocument();
  });
});
