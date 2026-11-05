// Saved scenarios on the page: kept from the New session form, listed on Saved, and started in Practice from there.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type SavedScenario } from "@/data/db";
import { getScenario, listScenarios, putScenario } from "@/data/scenarios";
import { exploitOf } from "@/features/practice/exploit";
import type { SessionOptions } from "@/features/practice/practice";
import { SetupForm } from "@/features/practice/SetupForm";
import type { AdvisorState, PlayMove } from "@/solver/protocol";
import type { PlayRequest, Provenance, SolveResult } from "@/solver/types";
import { SavedPage } from "./SavedPage";

const LIVE: Provenance = { source: "live", approximate: false, mode: "quick", transport: "worker", solverVersion: "t", partial: false, receivedAt: 1 };
const stub = vi.hoisted(() => {
  const s = { states: [] as AdvisorState[], getSolver: null as unknown as () => Promise<unknown> };
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));
stub.getSolver = async () => ({
  solve: async ({ state }: { state: AdvisorState }): Promise<SolveResult> => {
    stub.states.push(state);
    return { data: { street: "preflop", pot_bb: 1.5, actions: [{ action: "fold", freq: 1 }] }, provenance: LIVE } as never;
  },
  play: async (_: AdvisorState, p: PlayRequest): Promise<SolveResult<PlayMove>> => ({ data: { pos: p.seat, action: "fold", name: "fold", freq: 1 }, provenance: LIVE }) as never,
});

const OPTS: SessionOptions = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0, board: null };
const scenario = (id: string, x: Partial<SavedScenario> = {}): SavedScenario => ({ id, name: `Scenario ${id}`, players: 6, stack: 100, opts: OPTS, note: "", createdAt: 1, updatedAt: 2, ...x });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const form = (opts: SessionOptions = OPTS, stack = 100) =>
  render(
    <MemoryRouter>
      <SetupForm players={6} stack={stack} opts={opts} onEdit={() => {}} onStart={() => {}} />
    </MemoryRouter>,
  );
const saved = () =>
  render(
    <MemoryRouter initialEntries={["/saved"]}>
      <Routes>
        <Route path="/saved" element={<SavedPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  stub.states = [];
  const d = (await db())!;
  await d.clear("savedScenarios");
});
afterEach(() => vi.restoreAllMocks());

describe("Save scenario", () => {
  const openIt = () => fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));

  it("keeps the form's setup under a name, and the note", async () => {
    form();
    fireEvent.change(screen.getByRole("combobox", { name: "Play" }), { target: { value: "bvb" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Exploit" }), { target: { value: "overfolder" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Ante" }), { target: { value: "0.5" } });
    openIt();
    const pop = screen.getByRole("form", { name: "Save scenario" });
    expect(within(pop).getByText(/blind vs blind · exploiting Overfolds to bets \(assumed numbers\): folds \+15 pts to bets · ante 0.5bb/)).toBeInTheDocument();
    fireEvent.change(within(pop).getByLabelText("Name"), { target: { value: "Overfolders" } });
    fireEvent.change(within(pop).getByLabelText("Note"), { target: { value: "bet small" } });
    fireEvent.click(within(pop).getByRole("button", { name: "Save" }));
    expect(await within(pop).findByRole("status")).toHaveTextContent("Saved in this browser.");
    const [s] = (await listScenarios()).list;
    expect(s).toMatchObject({ name: "Overfolders", note: "bet small", players: 6, stack: 100, opts: { pot: "bvb", ante: 0.5, exploit: exploitOf("overfolder") } });
  });

  it("changes the scenario of that name, and keeps when it was made", async () => {
    await putScenario(scenario("a", { name: "Same" }));
    form();
    openIt();
    const pop = screen.getByRole("form", { name: "Save scenario" });
    fireEvent.change(within(pop).getByLabelText("Name"), { target: { value: "Same" } });
    fireEvent.click(within(pop).getByRole("button", { name: "Save" }));
    expect(await within(pop).findByRole("status")).toHaveTextContent("Changed the scenario with this name.");
    const { list } = await listScenarios();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "a", createdAt: 1 });
  });

  it("can't save a setup that can't start", () => {
    form();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Stack in big blinds" }), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "Save scenario" })).toBeDisabled();
  });

  it("gives focus back when it closes", () => {
    form();
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("form", { name: "Save scenario" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save scenario" })).toHaveFocus();
  });

  it("says when nothing was kept", async () => {
    const put = vi.spyOn(await import("@/data/scenarios"), "putScenario");
    put.mockResolvedValue(false);
    form();
    openIt();
    const pop = screen.getByRole("form", { name: "Save scenario" });
    fireEvent.click(within(pop).getByRole("button", { name: "Save" }));
    expect(await within(pop).findByRole("alert")).toHaveTextContent("Not saved");
  });
});

describe("the Saved page", () => {
  it("lists a scenario in words, with a link to start it", async () => {
    await putScenario(scenario("a b", { opts: { ...OPTS, pot: "srp", exploit: exploitOf("nit") }, note: "tight ones" }));
    saved();
    const row = await screen.findByRole("listitem", { name: "Scenario a b" });
    expect(within(row).getByText(/exploiting Nit \(assumed numbers\): folds \+15 pts to bets/)).toBeInTheDocument();
    expect(within(row).getByText("tight ones")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("link", { name: "Start Scenario a b" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/practice?scenario=a%20b");
  });

  it("edits a name and a note, and leaves the setup", async () => {
    await putScenario(scenario("a", { opts: { ...OPTS, ante: 0.5 } }));
    saved();
    const row = await screen.findByRole("listitem", { name: "Scenario a" });
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(row).getByRole("textbox", { name: "Name" }), { target: { value: "Renamed" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("listitem", { name: "Renamed" })).toBeInTheDocument();
    expect((await getScenario("a"))?.opts.ante).toBe(0.5);
  });

  it("deletes one, saying so", async () => {
    await putScenario(scenario("a"));
    saved();
    const row = await screen.findByRole("listitem", { name: "Scenario a" });
    fireEvent.click(within(row).getByRole("button", { name: /Delete/ }));
    const sure = within(row).queryByRole("button", { name: /Yes|Confirm|Delete scenario|Really/ });
    if (sure) fireEvent.click(sure);
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Scenario a" })).toBeNull());
    expect(await getScenario("a")).toBeUndefined();
  });

  it("says when one can't be read, and shows the rest", async () => {
    await putScenario(scenario("a"));
    await (await db())!.put("savedScenarios", { ...scenario("b"), players: 40 } as never);
    saved();
    expect(await screen.findByRole("listitem", { name: "Scenario a" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Scenario b" })).toBeNull();
    expect(screen.getByText(/1 saved scenario is damaged/)).toBeInTheDocument();
  });

  it("says there are none yet", async () => {
    saved();
    expect(await screen.findByText(/No saved scenarios yet/)).toBeInTheDocument();
  });
});

describe("starting one in Practice", () => {
  const practice = async (path: string) => {
    const { PracticePage } = await import("@/features/practice/PracticePage");
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/practice"
            element={
              <>
                <PracticePage pace={0} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("starts the session as it was set, and takes the link from the address", async () => {
    await putScenario(scenario("a", { name: "Short ones", players: 2, stack: 40, opts: { ...OPTS, ante: 0.5 } }));
    await practice("/practice?scenario=a");
    expect(await screen.findByText("Started Short ones.")).toHaveAttribute("role", "status");
    expect(screen.getByRole("combobox", { name: "Players" })).toHaveValue("2");
    expect(screen.getByRole("spinbutton", { name: "Stack in big blinds" })).toHaveValue(40);
    expect(screen.getByRole("spinbutton", { name: "Ante" })).toHaveValue(0.5);
    await waitFor(() => expect(stub.states.at(-1)).toMatchObject({ stack: 40, players: 2 }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/practice"));
  });

  it("restores the exploit profile", async () => {
    await putScenario(scenario("a", { opts: { ...OPTS, pot: "srp", exploit: exploitOf("maniac") } }));
    await practice("/practice?scenario=a");
    await screen.findByText("Started Scenario a.");
    expect(screen.getByRole("combobox", { name: "Exploit" })).toHaveValue("maniac");
    expect(screen.getByRole("combobox", { name: "Play" })).toHaveValue("srp");
  });

  it("says when it can't be read, and starts nothing", async () => {
    await (await db())!.put("savedScenarios", { ...scenario("b"), stack: 2 } as never);
    await practice("/practice?scenario=b");
    expect(await screen.findByRole("alert")).toHaveTextContent("That saved scenario is gone or can't be read");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/practice"));
  });
});
