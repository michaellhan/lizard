import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerToKeep, openAnswer } from "@/data/answers";
import { db, kvGet, kvSet, type SavedAnswer } from "@/data/db";
import { putSpot, spotAt } from "@/data/saved";
import { CHART_ANSWER, LIVE_ANSWER } from "@/test/answers";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { describe as describeProvenance, provenanceOf } from "@/solver/provenance";
import type { SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";

import { StudyPage } from "./StudyPage";
import { fromSearch, studyRequest, toSearch } from "./studyState";

// the solver stubbed: every request (kept in `stub.asked`) answers with `stub.answer` (a Study node), labelled as a live solve. (One stable
// getSolver, as the real hook's useCallback: StudyPage re-requests when it changes.)
const stub = vi.hoisted(() => {
  const s = {
    answer: {} as AdvisorResponse,
    // (a request's own answer, where a test needs two: the chip-EV comparison)
    answerFor: null as ((st: AdvisorState) => AdvisorResponse | null) | null,
    provenance: null as SolveResult["provenance"] | null,
    asked: [] as AdvisorState[],
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const client = {
    solve: async (req?: { state: AdvisorState }): Promise<SolveResult> => (req && s.asked.push(req.state), {
      data: (req && s.answerFor?.(req.state)) ?? s.answer,
      provenance: s.provenance ?? {
        source: "live",
        approximate: false,
        mode: "fast",
        transport: "worker",
        solverVersion: "test",
        partial: false,
        receivedAt: 0,
        exploitabilityPct: 0.3,
        band: "converged",
        iterations: 300,
      },
    }),
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));
// the build this page says it runs: none, as in a dev server, unless a test sets one
const build = vi.hoisted(() => ({ now: null as string | null }));
vi.mock("@/solver/runtime", async (real) => ({
  ...(await real<typeof import("@/solver/runtime")>()),
  loadManifest: async () => (build.now ? {} : null),
  solverVersionOf: () => build.now,
}));

const cell = (eq: number) => ({ w: 1, f: [0.5, 0.5], ev: [2, 4], evm: 3, eq });

// a 3-way flop node (advisor.py _study_mw: "opponents" per seat)
const THREE_WAY: AdvisorResponse = {
  study: "node",
  street: "flop",
  actor: "BB",
  multiway: true,
  opponent: "CO and BTN",
  pot_bb: 8,
  actions: [
    { action: "check", freq: 0.5, combos: 10, ev_bb: 2 },
    { action: "bet 33%", amount_bb: 2.64, freq: 0.5, combos: 10, ev_bb: 4 },
  ],
  grid: { actions: ["check", "bet 33%"], cells: { AA: cell(0.8), KK: cell(0.6) } },
  combos: {
    AA: [["AsAh", 1, [0.5, 0.5], [2, 4], 0.8, 0, 0]],
    KK: [["KsKh", 1, [0.5, 0.5], [2, 4], 0.6, 1, 0]],
  },
  categories: { made: [["set", "Set"], ["overpair", "Overpair"], ["middle", "Middle pair"]], draws: [["none", "No draw"]] },
  opponents: [
    { seat: "CO", combos: 120, eq: 0.3, grid: { actions: ["in range"], cells: { QQ: { w: 1, f: [1], eq: 0.3 } } } },
    { seat: "BTN", combos: 140, eq: 0.31, grid: { actions: ["in range"], cells: { JJ: { w: 1, f: [1], eq: 0.31 } } } },
  ],
  range_combos: 12,
  range_eq: 0.4,
};

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/study?${search}`]}>
      <StudyPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  useSettings.setState({ evUnit: "bb" });
  stub.provenance = null;
  stub.answerFor = null;
});

describe("StudyPage", () => {
  it("copies the node for AI once its answer is whole, and not from the range builder, which hides the numbers", async () => {
    const writeText = vi.fn(async (_: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    stub.answer = THREE_WAY;
    renderAt("p=3&s=100");
    const actions = await screen.findByRole("region", { name: "Actions" });
    fireEvent.click(await within(actions).findByRole("button", { name: "Copy for AI" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]![0];
    expect(text).toContain("no hand picked, so this is the whole range's mix");
    expect(text).toContain("- check: 50.0%, EV 2.00bb");
    expect(text).toContain("A chatbot might reason about them wrongly");
    fireEvent.click(screen.getByRole("button", { name: "✎ Build" }));
    expect(within(screen.getByRole("region", { name: "Actions" })).queryByRole("button", { name: "Copy for AI" })).toBeNull();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows one toggle per opponent in a 3-way answer, and each one's grid", async () => {
    stub.answer = THREE_WAY;
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h");
    const group = await screen.findByRole("group", { name: "Whose range" });
    const toggles = within(group).getAllByRole("button");
    expect(toggles.map((b) => b.textContent)).toEqual(["BB", "CO", "BTN"]);
    expect(screen.getByRole("grid", { name: "BB range" })).toBeInTheDocument();
    fireEvent.click(toggles[1]!);
    expect(screen.getByRole("grid", { name: "CO range" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^QQ: 100% in range/ })).toBeInTheDocument();
    expect(screen.getByText(/120\.0 combos · equity 30\.0%/)).toBeInTheDocument();
    fireEvent.click(toggles[2]!);
    expect(screen.getByRole("grid", { name: "BTN range" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^JJ: 100% in range/ })).toBeInTheDocument();
  });

  it("filters the grid and the totals to one hand category", async () => {
    stub.answer = THREE_WAY;
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h");
    const select = await screen.findByRole("combobox", { name: "Show only the hands of one category" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["All hands", "Set · 8.3%", "Overpair · 8.3%", "50\u201375% equity · 8.3%", "75\u2013100% equity · 8.3%"]);
    fireEvent.change(select, { target: { value: "m:set" } });
    expect(screen.getByRole("grid", { name: "BB range (Set)" })).toBeInTheDocument();
    expect(screen.getByText(/Set: 1\.0 of 12\.0 combos/)).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^AA: 17% in range/ })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "KK: not in range" })).toBeInTheDocument();
  });

  it("names the filter over the actions, and off an opponent's grid, which it doesn't touch", async () => {
    stub.answer = THREE_WAY;
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h");
    const select = await screen.findByRole("combobox", { name: "Show only the hands of one category" });
    const actions = screen.getByRole("region", { name: "Actions" });
    expect(within(actions).queryByText(/alone, not the whole range/)).toBeNull();
    fireEvent.change(select, { target: { value: "m:set" } });
    expect(within(actions).getByText("These numbers are over Set alone, not the whole range.")).toBeInTheDocument();
    // (the control goes with this view, and the filter stays on for coming back)
    fireEvent.click(within(screen.getByRole("group", { name: "Whose range" })).getByRole("button", { name: "CO" }));
    expect(screen.getByRole("grid", { name: "CO range" })).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "CO range (Set)" })).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Whose range" })).getByRole("button", { name: "BB" }));
    expect(screen.getByRole("grid", { name: "BB range (Set)" })).toBeInTheDocument();
  });

  it("shows every EV in % of the pot when Settings say so", async () => {
    stub.answer = { ...THREE_WAY, opponents: undefined };
    useSettings.setState({ evUnit: "pot" });
    renderAt("p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h");
    // action buttons: 2bb and 4bb of an 8bb pot
    expect(await screen.findByText("50.0% · 10.0 combos · EV 25.0% pot")).toBeInTheDocument();
    expect(screen.getByText("50.0% · 10.0 combos · EV 50.0% pot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: /^AA:/ }));
    // the class panel: its EV (3bb), each action's and the combos'
    expect(screen.getByText(/^EV 37\.5% pot$/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "EV % pot" })).toBeInTheDocument();
  });

  it("starts a new hand at any table size from 2 to 9 and any stack from 10 to 250bb", async () => {
    stub.answer = { study: "node", street: "preflop", actor: "UTG", actions: [], grid: { actions: [], cells: {} } };
    renderAt("p=6&s=100");
    const form = await screen.findByRole("form", { name: "New hand" });
    const players = within(form).getByRole("combobox", { name: "Players" });
    expect(within(players).getAllByRole("option")).toHaveLength(8);
    const stack = within(form).getByRole("spinbutton", { name: "Stack in big blinds" });
    fireEvent.change(stack, { target: { value: "300" } });
    expect(within(form).getByRole("button", { name: "New hand" })).toBeDisabled();
    fireEvent.change(stack, { target: { value: "37.5" } });
    fireEvent.change(players, { target: { value: "9" } });
    fireEvent.click(within(form).getByRole("button", { name: "New hand" }));
    expect(await screen.findByText("9-max 37.5bb")).toBeInTheDocument();
  });

  it("opens the range builder on the node's whole range, and back to the solution", async () => {
    stub.answer = { ...THREE_WAY, opponents: undefined };
    renderAt("p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h");
    fireEvent.click(await screen.findByRole("button", { name: "✎ Build" }));
    expect(screen.getByRole("grid", { name: "BB range, being painted" })).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "BB range" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "AA: yours check 100%" })).toBeInTheDocument();
    // the actions are there to play, without the range's frequencies and EVs
    const actions = screen.getByRole("region", { name: "Actions" });
    expect(within(actions).getAllByRole("button").map((x) => x.textContent)).toEqual(["check", "bet 33%", "How this was produced"]);
    fireEvent.click(screen.getByRole("button", { name: "Check my range" }));
    expect(screen.getByRole("region", { name: "Your score" })).toHaveTextContent("50.0% accurate · Off");
    fireEvent.click(screen.getByRole("button", { name: "Show the solution" }));
    expect(screen.getByRole("grid", { name: "BB range" })).toBeInTheDocument();
    // back in, the scored paint is kept for the node
    fireEvent.click(screen.getByRole("button", { name: "✎ Build" }));
    expect(screen.getByRole("region", { name: "Your score" })).toHaveTextContent("50.0% accurate");
  });

  it("saves the line with a name, tags, a note and the answer's provenance; saving again updates it", async () => {
    stub.answer = { ...THREE_WAY, opponents: undefined };
    const search = "p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h&flop=BB:x";
    renderAt(search);
    await screen.findByRole("region", { name: "Actions" });
    const open = await screen.findByRole("button", { name: "☆ Save spot" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const form = screen.getByRole("form", { name: "Save spot" });
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveValue("SB raise 2.5 · BB call · Kd7c2h · BB check");
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "K-high, checked to" } });
    fireEvent.change(within(form).getByRole("textbox", { name: /Tags/ }), { target: { value: "hu, dry" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Note" }), { target: { value: "stab often" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("Saved in this browser.");
    expect(screen.getByRole("button", { name: "★ Saved" })).toBeInTheDocument();
    const line = toSearch(fromSearch(search)!);
    const s = (await spotAt(line))!;
    expect(s).toMatchObject({ title: "K-high, checked to", tags: ["hu", "dry"], note: "stab often", seen: { source: "live" } });
    const { provenance } = await ((await stub.getSolver()) as { solve: () => Promise<SolveResult> }).solve();
    expect(s.seen?.label).toBe(describeProvenance(provenance));
    // the saved request is the line's
    expect(s.state).toEqual(studyRequest(fromSearch(s.line)!));
    // saving again keeps the one spot
    fireEvent.change(within(form).getByRole("textbox", { name: "Note" }), { target: { value: "stab less" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await spotAt(line))?.note).toBe("stab less"));
    expect((await spotAt(line))?.id).toBe(s.id);
  });

  it("focuses one action from the legend: the others are drawn empty", async () => {
    stub.answer = { ...THREE_WAY, opponents: undefined };
    renderAt("p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h");
    const legend = await screen.findByRole("group", { name: "Show one action" });
    fireEvent.click(within(legend).getByRole("button", { name: /bet 33%/ }));
    expect(within(legend).getByRole("button", { name: /bet 33%/ })).toHaveAttribute("aria-pressed", "true");
    const aa = screen.getByRole("gridcell", { name: /^AA:/ });
    // the check share is drawn empty (outlined), the bet's filled
    const bars = [...aa.querySelectorAll<HTMLDivElement>("div > div")];
    expect(bars.map((b) => b.className.includes("border-y"))).toEqual([true, false]);
    fireEvent.click(within(legend).getByRole("button", { name: "All actions" }));
    expect(within(legend).getByRole("button", { name: /bet 33%/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks a spot of your own with its setup, says the setup with Edit setup, and asks nothing when it's out of range", async () => {
    stub.answer = { ...THREE_WAY, opponents: undefined };
    stub.asked.length = 0;
    const q = "p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h&stacks=BB%3A40&sz.flop=33%2C75&rake=5&cap=3&rg.BB=22%2B%2CA2s%2B";
    const first = renderAt(q);
    await screen.findByRole("group", { name: "Show one action" });
    expect(stub.asked.at(-1)).toMatchObject({ players: 2, stack: 100, board: "Kd7c2h", study: true, stacks: { BB: 40 }, sizes: { flop: [33, 75] }, rake: 0.05, rake_cap: 3, ranges: { BB: "22+,A2s+" } });
    const setup = screen.getByLabelText("Setup");
    expect(setup).toHaveTextContent("Your setup: stacks BB 40bb · flop bets 33%, 75% · rake 5%, capped at 3bb · BB range set.");
    expect(within(setup).getByRole("link", { name: "Edit setup" })).toHaveAttribute("href", `/solve?${toSearch(fromSearch(q)!)}`);
    // Reset keeps the setup
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(stub.asked.at(-1)).toMatchObject({ board: "", preflop: [], rake: 0.05, stacks: { BB: 40 } }));
    first.unmount();

    // a link edited by hand past the limits: said, and nothing asked
    const asked = stub.asked.length;
    renderAt("p=2&s=100&sz.flop=10%2C20%2C30%2C40&rake=40");
    expect(await screen.findByRole("alert")).toHaveTextContent("This setup can't be solved: at most 3 flop bet sizes (each one multiplies the game tree); the rake must be 0–25% of the pot.");
    expect(within(screen.getByLabelText("Setup")).getByRole("link", { name: "Edit setup" })).toBeInTheDocument();
    expect(stub.asked.length).toBe(asked);
  });

  it("offers a setup of your own on a standard spot", () => {
    renderAt("p=6&s=100");
    const setup = screen.getByLabelText("Setup");
    expect(setup).toHaveTextContent("Standard setup.");
    expect(within(setup).getByRole("link", { name: "Set up your own" })).toHaveAttribute("href", "/solve?p=6&s=100");
    expect(within(setup).getByRole("link", { name: "a tournament" })).toHaveAttribute("href", "/tournaments?p=6&s=100");
  });

  it("asks a tournament's spot with its payouts and bounties, and shows its prize equity, bubble factors and bounties", async () => {
    // (the engine's tournament block, as advisor.py _tournament_info writes it)
    stub.answer = {
      ...THREE_WAY,
      opponents: undefined,
      actor: "CO",
      tournament: {
        equity_share: 0.0719,
        bubble_factors: { BTN: 1.15, BB: 1.2 },
        note: "tournament: ICM, CO's prize equity 7.2% of what's left to pay",
        bounties: { format: "ko", you_bust: { BTN: { bb: 6.4, cash: 5, in_hand: true }, BB: { bb: 3.1, cash: 2.5, in_hand: false } }, bust_you: { BTN: 6.4 } },
      },
    };
    // labelled as the solver client labels it (provenanceOf), so the badge names the model
    stub.provenance = provenanceOf({ ...stub.answer, solver: { iterations: 300, exploitability_pct: 0.3 } }, { mode: "fast", transport: "worker", solverVersion: "test", partial: false });
    stub.asked.length = 0;
    const q = "p=6&s=25&stacks=CO%3A8&pay=50%2C30%2C20&bty=ko&bty.each=5";
    renderAt(q);
    const panel = await screen.findByLabelText("Tournament");
    expect(screen.getByText(/^Live solve · prize-equity solve \(ICM\), KO bounties, proportional model · /)).toBeInTheDocument();
    expect(stub.asked.at(-1)).toMatchObject({ players: 6, stack: 25, stacks: { CO: 8 }, payouts: [50, 30, 20], bounties: { format: "ko", seats: { UTG: 5, BB: 5 } }, study: true });
    expect(stub.asked.at(-1)).not.toHaveProperty("rake");
    expect(panel).toHaveTextContent("Prize equity: CO 7.2% of what's left to pay.");
    expect(panel).toHaveTextContent("BTN 1.15 · BB 1.20");
    expect(panel).toHaveTextContent("(busting them, for CO): BTN 6.4bb (pays 5). Covered by BTN.");
    expect(panel).toHaveTextContent("EVs in chips of prize equity.");
    const setup = screen.getByLabelText("Setup");
    expect(setup).toHaveTextContent("Your setup: stacks CO 8bb · payouts 50/30/20 · KO bounties 5.");
    expect(within(setup).getByRole("link", { name: "Edit setup" })).toHaveAttribute("href", `/tournaments?${toSearch(fromSearch(q)!)}`);
  });

  it("asks the same tournament spot in chips on request, and shows both answers' actions with their badges", async () => {
    const prize: AdvisorResponse = {
      ...THREE_WAY,
      opponents: undefined,
      actor: "CO",
      actions: [
        { action: "check", freq: 0.8, combos: 10, ev_bb: 1.5 },
        { action: "bet 33%", freq: 0.2, combos: 2, ev_bb: 1.4 },
      ],
      tournament: { equity_share: 0.0719, bubble_factors: { BB: 1.2 }, note: "tournament: ICM, CO's prize equity 7.2% of what's left to pay" },
    };
    const chips: AdvisorResponse = { ...prize, tournament: undefined, actions: [{ action: "check", freq: 0.55, combos: 7, ev_bb: 2.1 }, { action: "bet 75%", freq: 0.45, combos: 5, ev_bb: 2.3 }] };
    stub.answer = prize;
    stub.answerFor = (st) => ("payouts" in st ? null : chips);
    stub.asked.length = 0;
    renderAt("p=6&s=25&stacks=CO%3A8&ante=0.1&pay=50%2C30%2C20&fld=12%3A40&bty=ko&bty.each=5");
    fireEvent.click(await screen.findByRole("button", { name: "Compare with chip EV" }));
    const table = await screen.findByLabelText("Chip EV comparison");
    const chip = stub.asked.at(-1)!;
    expect(chip).toMatchObject({ players: 6, stack: 25, stacks: { CO: 8 }, ante: 0.1, study: true });
    for (const k of ["payouts", "field", "bounties", "rake"]) expect(chip).not.toHaveProperty(k);
    const rows = within(table).getAllByRole("row").map((r) => r.textContent);
    expect(rows).toEqual(["CO, whole rangePrize equityChip EV", "check80.0% · EV 1.5055.0% · EV 2.10", "bet 33%20.0% · EV 1.40–", "bet 75%–45.0% · EV 2.30"]);
    expect(table).toHaveTextContent("EVs in bb; prize equity's as chips worth as much.");
    expect(within(table).getAllByText(/^Live solve/)).toHaveLength(2);
    // per hand class: the Compare page, the tournament as A and chips as B
    const per = new URLSearchParams(within(table).getByRole("link", { name: "Every hand class, prize equity against chips" }).getAttribute("href")!.split("?")[1]);
    expect(fromSearch(per.get("a")!)!.setup?.tournament?.payouts).toEqual([50, 30, 20]);
    expect(fromSearch(per.get("b")!)!.setup).toEqual({ stacks: { CO: 8 }, ante: 0.1 });
  });

  // a turn report on Kd7c2h after BB and BTN checked the flop (advisor.py study's "runouts"): the 7s and the rest as
  // classes, BB's lead and BTN's bet after a check, each card's chance, equities and EVs
  const deck = (board: string) => [..."AKQJT98765432"].flatMap((r) => [..."shdc"].map((x) => r + x)).filter((c) => !board.includes(c));
  const part = (actor: string, f7: number[], fr: number[]) => ({
    actor,
    actions: ["check", "bet 75%"],
    avg: [0.6, 0.4],
    cards: [
      { card: "7d", cards: deck("Kd7c2h").filter((c) => c[0] === "7"), f: f7, w: 30 },
      { card: "Qh", cards: deck("Kd7c2h").filter((c) => c[0] !== "7"), f: fr, w: 60 },
    ],
  });
  const TURNS = {
    study: "runouts",
    street: "turn",
    first: part("BB", [0.9, 0.1], [1, 0]),
    after_check: part("BTN", [0.8, 0.2], [0.45, 0.55]),
    seats: ["BB", "BTN"],
    pot_bb: 5.5,
    source: "solve",
    cards: deck("Kd7c2h").map((c) => ({ card: c, p: 1 / 49, eq: [0.45, 0.55], ev: c[0] === "A" ? [1.5, 4] : [2.5, 3] })),
    solver: { iterations: 400, exploitability_pct: 0.05, by: "hand buckets" },
  } as unknown as AdvisorResponse;
  const TURN_SEARCH = "p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c&b=Kd7c2h&flop=BB:x,BTN:x";

  it("offers the turn report at a closed flop: asks what's in hand, then solves the flop on request, and a card's row deals it", async () => {
    stub.answer = { study: "deal", street: "turn" };
    stub.answerFor = (st) => (st.runouts === "held" ? { study: "runouts", street: "turn", skipped: "no flop solve" } : st.runouts === true ? TURNS : null);
    stub.asked.length = 0;
    renderAt(TURN_SEARCH);
    const panel = await screen.findByRole("region", { name: "Turn report" });
    expect(panel).toHaveTextContent("The turn’s first decision on every card: strategy, EV and equity.");
    expect(stub.asked.some((st) => "runouts" in st)).toBe(false); // (nothing asked until the button)
    fireEvent.click(within(panel).getByRole("button", { name: "Turn report" }));
    const solve = await within(panel).findByRole("button", { name: /^Solve the flop \(Fast, ~\d+ s\)$/ });
    expect(stub.asked.at(-1)).toMatchObject({ board: "Kd7c2h", flop: [{ pos: "BB", action: "check" }, { pos: "BTN", action: "check" }], runouts: "held" });
    fireEvent.click(solve);
    const avg = await within(panel).findByRole("row", { name: "Average" });
    expect(stub.asked.at(-1)).toMatchObject({ runouts: true, study: true });
    expect(avg).toHaveTextContent("All 49 cards");
    expect(within(panel).getAllByRole("button", { name: /^Deal / })).toHaveLength(49);
    expect(within(panel).getAllByText(/^Live solve/).length).toBeGreaterThan(0);
    // BB's mix on a 7 (it pairs the board) and on an ace; then BTN's after a check
    expect(within(panel).getByRole("row", { name: "7s" })).toHaveTextContent(/90%10%2\.503\.00/);
    expect(within(panel).getByRole("row", { name: "As" })).toHaveTextContent(/100%0%1\.504\.00/);
    fireEvent.click(within(panel).getByRole("button", { name: "BTN after a check" }));
    expect(within(panel).getByRole("row", { name: "7s" })).toHaveTextContent(/80%20%/);
    // only the cards pairing the board: the three 7s (the K's and 2's too)
    fireEvent.change(within(panel).getByRole("combobox", { name: "Only cards that" }), { target: { value: "pair" } });
    expect(within(panel).getAllByRole("button", { name: /^Deal / })).toHaveLength(9);
    fireEvent.click(within(panel).getByRole("button", { name: "Deal 7s" }));
    await waitFor(() => expect(stub.asked.at(-1)).toMatchObject({ board: "Kd7c2h7s" }));
    expect(stub.asked.at(-1)).not.toHaveProperty("runouts");
  });

  it("walks to a flop line the library's stored turns hold, and that node's report opens at once", async () => {
    const lead = [{ pos: "BB", action: "bet", to: 1.82 }, { pos: "BTN", action: "call" }];
    const lines = [{ flop: lead, share: 0.3 }, { flop: [{ pos: "BB", action: "check" }, { pos: "BTN", action: "check" }], share: 0.4 }];
    const stored = { ...TURNS, source: "store", lines, line: 0, cards: (TURNS.cards as { card: string }[]).map((c) => ({ card: c.card, p: 1 / 49, eq: null, ev: null })) } as unknown as AdvisorResponse;
    stub.answer = { study: "deal", street: "turn" };
    stub.answerFor = (st) => (st.runouts !== "held" ? null : st.flop?.[0]?.action === "bet" ? stored : { study: "runouts", street: "turn", skipped: "line not stored", lines: [lines[0]] });
    stub.provenance = provenanceOf(stored, { mode: "fast", transport: "worker", solverVersion: "test", partial: false });
    stub.asked.length = 0;
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c&b=Kd7c2h&flop=BB:x,BTN:b4,BB:c");
    const panel = await screen.findByRole("region", { name: "Turn report" });
    fireEvent.click(within(panel).getByRole("button", { name: "Turn report" }));
    const pick = await within(panel).findByRole("combobox", { name: "Flop line" });
    expect(panel).toHaveTextContent("the flop library's stored turns don't hold this flop line");
    expect(within(pick).getAllByRole("option").map((o) => o.textContent)).toEqual(["Pick a flop line…", "Flop: bet 1.82, call (30%)"]);
    fireEvent.change(pick, { target: { value: "0" } });
    // the new node (BB bet 1.82, BTN called) asks for its report by itself
    const again = await screen.findByRole("region", { name: "Turn report" });
    expect(await within(again).findByRole("row", { name: "Average" })).toHaveTextContent("All 49 cards");
    expect(stub.asked.at(-1)).toMatchObject({ flop: lead, runouts: "held" });
    expect(within(again).getByText(/^Stored turn from the flop library/)).toBeInTheDocument();
    expect(within(again).getByRole("combobox", { name: "Flop line" })).toHaveValue("0");
  });

  it("offers no turn report where the flop went all in or four saw it", async () => {
    stub.answer = { study: "deal", street: "turn", allin: true };
    const { unmount } = renderAt(TURN_SEARCH);
    expect(await screen.findByText(/Deal the turn/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Turn report" })).toBeNull();
    unmount();
    stub.answer = { study: "deal", street: "turn" };
    renderAt("p=6&s=100&pre=UTG:f,HJ:r2.5,CO:c,BTN:c,SB:f,BB:c&b=Kd7c2h&flop=BB:x,HJ:x,CO:x,BTN:x");
    expect(await screen.findByText(/Deal the turn/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Turn report" })).toBeNull();
  });

  it("links the spot to Compare with one thing changed, on a decision only", async () => {
    stub.answer = THREE_WAY;
    const search = "p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h";
    const { unmount } = renderAt(search);
    const nav = await screen.findByRole("navigation", { name: "Compare this spot" });
    const b = (name: string) => fromSearch(new URLSearchParams(within(nav).getByRole("link", { name }).getAttribute("href")!.split("?")[1]).get("b")!)!;
    expect(b("with 5% rake, capped at 3bb").setup).toEqual({ rake: 5, rakeCap: 3 });
    expect(b("compare").stack).toBe(50);
    unmount();
    stub.answer = { study: "over" };
    renderAt(search);
    expect(await screen.findByText(/The hand is over/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Compare this spot" })).toBeNull();
  });

  describe("the split beside the grid", () => {
    const search = "p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h";
    const wide = (matches: boolean) => vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));
    afterEach(() => {
      vi.unstubAllGlobals();
      useSettings.setState({ studySplit: null });
    });

    it("stands between the grid and the panel on a wide window, and starts at the layout's 1.4 to 1", async () => {
      wide(true);
      stub.answer = THREE_WAY;
      renderAt(search);
      const bar = await screen.findByRole("separator", { name: "Resize the range and the panel beside it" });
      expect(bar).toHaveAttribute("aria-valuenow", "58");
      expect(bar.previousElementSibling).toContainElement(screen.getByRole("region", { name: "Range" }));
      expect(bar.nextElementSibling).toContainElement(screen.getByRole("complementary"));
    });

    it("isn't there on a narrow window", async () => {
      wide(false);
      stub.answer = THREE_WAY;
      renderAt(search);
      await screen.findByRole("region", { name: "Range" });
      expect(screen.queryByRole("separator")).toBeNull();
    });

    // (`before(a, b)`: a comes first in the page, which is the order the keyboard goes in)
    const before = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING, `${a.tagName} before ${b.tagName}`).toBeTruthy();

    it("puts the actions and the breakdown in the panel on a wide window, so the separator moves them too", async () => {
      wide(true);
      stub.answer = THREE_WAY;
      renderAt(search);
      const bar = await screen.findByRole("separator");
      const panel = bar.nextElementSibling as HTMLElement;
      const actions = screen.getByRole("region", { name: "Actions" });
      const breakdown = screen.getByText("Breakdown and equity").closest("details")!;
      expect(panel).toContainElement(actions);
      expect(panel).toContainElement(breakdown);
      expect(bar.previousElementSibling).not.toContainElement(actions);
      // the grid, the actions, the combos, the breakdown: left to right and top to bottom, as they're read
      before(screen.getByRole("region", { name: "Range" }), actions);
      before(actions, screen.getByRole("complementary"));
      before(screen.getByRole("complementary"), breakdown);
      // what those numbers came from goes with them
      expect(within(actions).getByText(/^Live solve/)).toBeInTheDocument();
      expect(within(actions).getByRole("button", { name: "How this was produced" })).toBeInTheDocument();
    });

    it("keeps them above and below the grid on a narrow window, as they were", async () => {
      wide(false);
      stub.answer = THREE_WAY;
      renderAt(search);
      const actions = await screen.findByRole("region", { name: "Actions" });
      const range = screen.getByRole("region", { name: "Range" });
      expect(screen.getAllByRole("region", { name: "Actions" })).toHaveLength(1);
      before(actions, range);
      before(range, screen.getByRole("complementary"));
      before(screen.getByRole("complementary"), screen.getByText("Breakdown and equity"));
    });

    it("leaves the actions above Build's own split on a wide window, without the numbers", async () => {
      wide(true);
      stub.answer = THREE_WAY;
      renderAt(search);
      const build = await screen.findByRole("button", { name: "✎ Build" });
      fireEvent.click(build);
      const bar = await screen.findByRole("separator");
      const actions = screen.getByRole("region", { name: "Actions" });
      expect(bar.parentElement).not.toContainElement(actions);
      before(actions, bar);
      expect(within(actions).queryByText(/combos/)).toBeNull();
      expect(screen.queryByText("Breakdown and equity")).toBeNull();
    });

    it("shows a node with no grid in full on a wide window, with no split to put it in", async () => {
      wide(true);
      stub.answer = { ...THREE_WAY, grid: undefined } as unknown as AdvisorResponse;
      renderAt(search);
      await screen.findByRole("region", { name: "Actions" });
      expect(await screen.findByText("Breakdown and equity")).toBeInTheDocument();
      expect(screen.queryByRole("separator")).toBeNull();
    });

    it("asks the same width as the workspace, so the actions move into the panel just as the panes open", async () => {
      const asked = new Set<string>();
      vi.stubGlobal("matchMedia", (q: string) => (asked.add(q), { matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
      stub.answer = THREE_WAY;
      renderAt(search);
      await screen.findByRole("separator");
      expect([...asked]).toEqual(["(min-width: 64rem)"]);
    });

    it("takes the arrow keys without walking the line, and lasts from visit to visit", async () => {
      wide(true);
      stub.answer = THREE_WAY;
      renderAt(search);
      const bar = await screen.findByRole("separator");
      const asked = stub.asked.length;
      fireEvent.keyDown(bar, { key: "ArrowLeft" });
      expect(bar).toHaveAttribute("aria-valuenow", "56");
      fireEvent.keyDown(bar, { key: "ArrowRight" });
      fireEvent.keyDown(bar, { key: "ArrowRight" });
      expect(bar).toHaveAttribute("aria-valuenow", "60");
      await screen.findByRole("region", { name: "Range" });
      expect(stub.asked).toHaveLength(asked);
      const saved = useSettings.getState().studySplit!;
      expect(saved).toBeCloseTo(1.4 / 2.4 + 0.02);
      // read back from the store, as a new visit would
      await vi.waitFor(async () => expect(await kvGet("settings.v1")).toMatchObject({ studySplit: saved }));
      useSettings.setState({ studySplit: null });
      await useSettings.getState().load();
      expect(useSettings.getState().studySplit).toBe(saved);
    });

    it("leaves the separator's keys to it: 1-9, b and Backspace do nothing from it, and Enter puts it back where it was focused", async () => {
      wide(true);
      useSettings.setState({ studySplit: 0.65 });
      stub.answer = THREE_WAY;
      renderAt(search);
      const bar = await screen.findByRole("separator");
      expect(bar).toHaveAttribute("aria-valuenow", "65");
      expect(bar).toHaveAccessibleDescription(/Enter/);
      bar.focus();
      const asked = stub.asked.length;
      for (const key of ["1", "b", "Backspace"]) fireEvent.keyDown(bar, { key });
      expect(screen.getByRole("region", { name: "Range" })).toBeInTheDocument();
      expect(stub.asked).toHaveLength(asked);
      expect(bar).toHaveAttribute("aria-valuenow", "65");
      fireEvent.keyDown(bar, { key: "Enter" });
      await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "58"));
      expect(useSettings.getState().studySplit).toBeNull();
      expect(bar).toHaveFocus();
    });

    it("is the same split around Build's grid, at the same size, and what moves there lasts back in Study", async () => {
      wide(true);
      useSettings.setState({ studySplit: 0.5 });
      stub.answer = THREE_WAY;
      renderAt(search);
      await screen.findByRole("separator");
      fireEvent.click(screen.getByRole("button", { name: "✎ Build" }));
      const painting = await screen.findByRole("region", { name: "Build" });
      const bar = screen.getByRole("separator", { name: "Resize the range and the panel beside it" });
      expect(bar).toHaveAttribute("aria-valuenow", "50");
      expect(bar.previousElementSibling).toContainElement(painting);
      expect(bar.nextElementSibling).toContainElement(screen.getByRole("complementary"));
      fireEvent.keyDown(bar, { key: "ArrowRight" });
      expect(bar).toHaveAttribute("aria-valuenow", "52");
      expect(useSettings.getState().studySplit).toBeCloseTo(0.52);
      fireEvent.click(screen.getByRole("button", { name: "Show the solution" }));
      await screen.findByRole("region", { name: "Range" });
      expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "52");
    });

    it("leaves a brush key alone on Build's separator, and Enter puts it back there too", async () => {
      wide(true);
      useSettings.setState({ studySplit: 0.5 });
      stub.answer = THREE_WAY;
      renderAt(search);
      await screen.findByRole("separator");
      fireEvent.click(screen.getByRole("button", { name: "✎ Build" }));
      const brushes = within(await screen.findByRole("group", { name: "Brush" })).getAllByRole("button");
      const bar = screen.getByRole("separator");
      fireEvent.keyDown(bar, { key: "2" });
      expect(brushes[0]).toHaveAttribute("aria-pressed", "true");
      fireEvent.keyDown(bar, { key: "b" });
      expect(screen.getByRole("region", { name: "Build" })).toBeInTheDocument();
      fireEvent.keyDown(bar, { key: "Enter" });
      await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "58"));
    });

    it("stacks Build's grid and its panel on a narrow window, with no separator", async () => {
      wide(false);
      stub.answer = THREE_WAY;
      renderAt(search);
      await screen.findByRole("region", { name: "Range" });
      fireEvent.click(screen.getByRole("button", { name: "✎ Build" }));
      const painting = await screen.findByRole("region", { name: "Build" });
      expect(screen.queryByRole("separator")).toBeNull();
      const box = painting.parentElement!.parentElement!;
      expect(box.className).toBe("grid gap-4");
      expect(box.getAttribute("style")).toBeNull();
      expect(box.children).toHaveLength(2);
      expect(box.children[1]).toContainElement(screen.getByRole("complementary"));
    });

    it("lays out a corrupt saved value as the default", async () => {
      wide(true);
      await kvSet("settings.v1", { studySplit: "wide" });
      await useSettings.getState().load();
      stub.answer = THREE_WAY;
      renderAt(search);
      expect(await screen.findByRole("separator")).toHaveAttribute("aria-valuenow", "58");
    });
  });
});

describe("a spot opened with its saved answer", () => {
  const TURN = toSearch(fromSearch("p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c&b=Ac7s3d9h&flop=BB:x,BTN:x")!);
  const CHART = toSearch(fromSearch("p=6&s=100")!);
  const CTX = { mode: "fast", transport: "worker", solverVersion: "aaa/111", partial: false, now: 5 } as const;
  const answerAt = (line: string, data: AdvisorResponse, id = "s"): SavedAnswer => {
    const k = answerToKeep(id, line, { data, provenance: provenanceOf(data, CTX) }, Date.UTC(2026, 10, 5, 12));
    if (!("answer" in k)) throw new Error(k.refused);
    return k.answer;
  };
  const spotOf = (line: string) => ({ id: "s", title: "Kept", line, state: studyRequest(fromSearch(line)!) as unknown as Record<string, unknown>, tags: [], note: "", createdAt: 1, updatedAt: 1 });

  beforeEach(async () => {
    const d = (await db())!;
    await Promise.all([d.clear("savedSpots"), d.clear("savedAnswers")]);
    stub.asked = [];
    stub.answer = LIVE_ANSWER;
    build.now = null;
    useSettings.setState({ mode: "fast" });
  });

  it("shows it at once with no request, plainly marked, and Re-solve asks the engine as usual", async () => {
    await putSpot(spotOf(TURN), answerAt(TURN, LIVE_ANSWER));
    renderAt(`${TURN}&saved=s`);
    const note = await screen.findByRole("group", { name: "Saved answer" });
    expect(note).toHaveTextContent("Saved answer of 2026-11-05, not solved again. Solver build aaa/111; whether this page runs the same one can't be told.");
    await screen.findByRole("region", { name: "Actions" });
    expect(screen.getAllByText(/saved answer of 2026-11-05, solver build aaa\/111/).length).toBeGreaterThan(0);
    expect(stub.asked).toEqual([]);

    fireEvent.click(within(note).getByRole("button", { name: "Re-solve" }));
    await waitFor(() => expect(stub.asked).toHaveLength(1));
    expect(screen.queryByRole("group", { name: "Saved answer" })).toBeNull();
  });

  it("says an answer from another engine version is that, not the current one", async () => {
    build.now = "bbb/222";
    await putSpot(spotOf(TURN), answerAt(TURN, LIVE_ANSWER));
    renderAt(`${TURN}&saved=s`);
    const note = await screen.findByRole("group", { name: "Saved answer" });
    await waitFor(() => expect(note).toHaveTextContent("From another engine version, not the current one: solver build aaa/111, where this page runs bbb/222."));
    expect(stub.asked).toEqual([]);
  });

  it("says one from this build is this build's", async () => {
    build.now = "aaa/111";
    await putSpot(spotOf(TURN), answerAt(TURN, LIVE_ANSWER));
    renderAt(`${TURN}&saved=s`);
    const note = await screen.findByRole("group", { name: "Saved answer" });
    await waitFor(() => expect(note).toHaveTextContent("Solver build aaa/111, the one this page runs."));
  });

  it("keeps a chart's answer a chart's, under its own label, not a solve", async () => {
    await putSpot(spotOf(CHART), answerAt(CHART, CHART_ANSWER));
    renderAt(`${CHART}&saved=s`);
    await screen.findByRole("group", { name: "Saved answer" });
    expect(await screen.findAllByText(/Preflop chart.*saved answer of/i)).not.toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Live solve/);
    expect(stub.asked).toEqual([]);
  });

  it("asks afresh, and says why, for a link whose answer is gone", async () => {
    renderAt(`${TURN}&saved=gone`);
    expect(await screen.findByText("The answer saved with this spot is gone or can’t be read, so this one is asked afresh.")).toBeInTheDocument();
    await waitFor(() => expect(stub.asked).toHaveLength(1));
  });

  it.each([
    ["stored at another line", () => answerAt(CHART, CHART_ANSWER)],
    ["that can't be read", () => ({ ...answerAt(TURN, LIVE_ANSWER), json: "{not json" })],
  ])("asks afresh for an answer %s", async (_, answer) => {
    await putSpot(spotOf(TURN), answer());
    renderAt(`${TURN}&saved=s`);
    expect(await screen.findByText(/asked afresh/)).toBeInTheDocument();
    await waitFor(() => expect(stub.asked).toHaveLength(1));
    expect(screen.queryByRole("group", { name: "Saved answer" })).toBeNull();
  });

  it("lets go when another mode is picked: that's a solve", async () => {
    await putSpot(spotOf(TURN), answerAt(TURN, LIVE_ANSWER));
    renderAt(`${TURN}&saved=s`);
    await screen.findByRole("group", { name: "Saved answer" });
    useSettings.setState({ mode: "accurate" });
    await waitFor(() => expect(stub.asked).toHaveLength(1));
    expect(screen.queryByRole("group", { name: "Saved answer" })).toBeNull();
  });

  it("lets go when an unfinished preflop solve it holds is carried on: the page moves on to the run", async () => {
    const line = toSearch(fromSearch("p=2&s=100&pf=solver")!);
    const half = { ...CHART_ANSWER, actor: "SB", players: 2, source: "solver", solver: { iterations: 1500 }, pf_solve: { done: false, iterations: 1500, mbb: 4, label: "HU 100bb" } } as AdvisorResponse;
    await putSpot(spotOf(line), answerAt(line, half));
    renderAt(`${line}&saved=s`);
    await screen.findByRole("group", { name: "Saved answer" });
    fireEvent.click(await screen.findByRole("button", { name: "Continue the solve" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Saved answer" })).toBeNull());
  });

  it("keeps a finished answer with the spot on Save, stamped with its provenance", async () => {
    renderAt(TURN);
    await screen.findByRole("region", { name: "Actions" });
    const open = await screen.findByRole("button", { name: "☆ Save spot" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const form = screen.getByRole("form", { name: "Save spot" });
    expect(form).toHaveTextContent("Keeps this answer with the spot");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await within(form).findByRole("status");
    const s = (await spotAt(TURN))!;
    const kept = await openAnswer(s.id, TURN);
    expect(kept?.result.data).toEqual(stub.answer);
    expect(kept?.record.provenance).toMatchObject({ source: "live", solverVersion: "test", exploitabilityPct: 0.3 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves the line without an answer past the limit, and says so", async () => {
    stub.answer = { ...LIVE_ANSWER, notes: ["x".repeat(600 * 1024)] };
    renderAt(TURN);
    await screen.findByRole("region", { name: "Actions" });
    const open = await screen.findByRole("button", { name: "☆ Save spot" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    fireEvent.click(within(screen.getByRole("form", { name: "Save spot" })).getByRole("button", { name: "Save" }));
    const said = await screen.findByRole("alert");
    expect(said.textContent).toMatch(/^The line is saved, but not its answer: it's \d+ KB, over the 512 KB a saved answer can be\.$/);
    expect(await openAnswer((await spotAt(TURN))!.id, TURN)).toBeNull();
  });

  it("saving while the saved answer is on screen leaves that answer as it was, not stamped anew", async () => {
    const was = answerAt(TURN, LIVE_ANSWER);
    await putSpot(spotOf(TURN), was);
    renderAt(`${TURN}&saved=s`);
    await screen.findByRole("group", { name: "Saved answer" });
    const open = await screen.findByRole("button", { name: "★ Saved" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const form = screen.getByRole("form", { name: "Save spot" });
    expect(form).not.toHaveTextContent("Keeps this answer");
    fireEvent.change(within(form).getByRole("textbox", { name: "Note" }), { target: { value: "seen again" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await within(form).findByRole("status");
    expect((await spotAt(TURN))?.note).toBe("seen again");
    expect((await openAnswer("s", TURN))?.record.savedAt).toBe(was.savedAt);
  });
});

describe("both players' ranges side by side", () => {
  const FLOP = "p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c&b=Kd7c2h";
  // a heads-up node: the one opponent's range in opponent_grid (advisor.py _study_node)
  const HEADS_UP: AdvisorResponse = {
    ...THREE_WAY,
    multiway: undefined,
    opponents: undefined,
    opponent: "BTN",
    opponent_grid: { actions: ["in range"], cells: { QQ: { w: 1, f: [1], eq: 0.6 }, T9s: { w: 0.5, f: [1], eq: 0.3 } } },
    opponent_combos: 140,
    opponent_eq: 0.6,
  };
  const wide = (matches: boolean) => vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));
  const before = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING, `${a.tagName} before ${b.tagName}`).toBeTruthy();
  afterEach(() => vi.unstubAllGlobals());

  it("isn't on until asked: one grid, and a toggle named for what it does", async () => {
    stub.answer = HEADS_UP;
    renderAt("p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h");
    const toggle = await screen.findByRole("button", { name: /^Side by side/ });
    expect(toggle).toHaveAccessibleName("Side by side: BB's range and BTN's");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("grid")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Whose range" })).toBeInTheDocument();
  });

  it("puts the heads-up opponent's range beside the actor's, each labelled with whose it is and its source, and goes back to one grid", async () => {
    stub.answer = HEADS_UP;
    renderAt("p=2&s=100&pre=SB:r2.5,BB:c&b=Kd7c2h");
    fireEvent.click(await screen.findByRole("button", { name: /^Side by side/ }));
    expect(screen.getByRole("button", { name: /^Side by side/ })).toHaveAttribute("aria-pressed", "true");
    const mine = screen.getByRole("region", { name: "Range" });
    const theirs = screen.getByRole("region", { name: "BTN's range" });
    expect(within(mine).getByRole("grid", { name: "BB range" })).toBeInTheDocument();
    expect(within(theirs).getByRole("grid", { name: "BTN range" })).toBeInTheDocument();
    expect(within(mine).getByRole("heading", { name: "BB's range, to act" })).toBeInTheDocument();
    expect(within(theirs).getByRole("heading", { name: "BTN's range, the opponent" })).toBeInTheDocument();
    // each side's numbers, and where they came from
    expect(within(mine).getByText(/12\.0 combos · equity 40\.0%/)).toBeInTheDocument();
    expect(within(theirs).getByText(/140\.0 combos · equity 60\.0%/)).toBeInTheDocument();
    expect(within(mine).getByText(/^Live solve/)).toBeInTheDocument();
    expect(within(theirs).getByText(/^Live solve/)).toBeInTheDocument();
    expect(within(theirs).getByRole("gridcell", { name: /^QQ: 100% in range/ })).toBeInTheDocument();
    // (the one-at-a-time toggle has nothing to do here)
    expect(screen.queryByRole("group", { name: "Whose range" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Side by side/ }));
    expect(screen.getAllByRole("grid").map((g) => g.getAttribute("aria-label"))).toEqual(["BB range"]);
    expect(screen.queryByRole("region", { name: "BTN's range" })).toBeNull();
    expect(screen.getByRole("group", { name: "Whose range" })).toBeInTheDocument();
  });

  it("in a 3-way pot lets you pick which opponent, and keeps the pick from node to node", async () => {
    stub.answer = THREE_WAY;
    renderAt(FLOP);
    fireEvent.click(await screen.findByRole("button", { name: /^Side by side/ }));
    expect(screen.getByRole("button", { name: /^Side by side/ })).toHaveAccessibleName("Side by side: BB's range and an opponent's");
    const pick = screen.getByRole("group", { name: "Which opponent's range beside BB's" });
    const seats = within(pick).getAllByRole("button");
    expect(seats.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["CO", "true"], ["BTN", "false"]]);
    expect(screen.getByRole("grid", { name: "CO range" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "CO's range" })).getByText(/120\.0 combos · equity 30\.0%/)).toBeInTheDocument();
    fireEvent.click(seats[1]!);
    const btn = screen.getByRole("region", { name: "BTN's range" });
    expect(within(btn).getByRole("grid", { name: "BTN range" })).toBeInTheDocument();
    expect(within(btn).getByRole("gridcell", { name: /^JJ: 100% in range/ })).toBeInTheDocument();
    expect(within(btn).getByText(/^Live solve/)).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "BB range" })).toBeInTheDocument();
    // an action played: the next node (here the same answer) still side by side, against BTN
    const asked = stub.asked.length;
    fireEvent.click(within(screen.getByRole("region", { name: "Actions" })).getByRole("button", { name: /^check/ }));
    await waitFor(() => expect(stub.asked.length).toBeGreaterThan(asked));
    expect(await screen.findByRole("grid", { name: "BTN range" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "BB range" })).toBeInTheDocument();
  });

  it("opens side by side from a link, against the seat it names", async () => {
    stub.answer = THREE_WAY;
    renderAt(`${FLOP}&vs=BTN`);
    expect(await screen.findByRole("grid", { name: "BTN range" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "BB range" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Side by side/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the picked class of the opponent's grid in the panel, under that player's name", async () => {
    stub.answer = THREE_WAY;
    renderAt(`${FLOP}&vs=1`);
    const theirs = await screen.findByRole("region", { name: "CO's range" });
    fireEvent.click(within(theirs).getByRole("gridcell", { name: /^QQ:/ }));
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText("CO's range")).toBeInTheDocument();
    expect(within(panel).getByText("QQ")).toBeInTheDocument();
    expect(within(panel).queryByRole("table")).toBeNull();
    // and the actor's: the actor's combos
    fireEvent.click(within(screen.getByRole("region", { name: "Range" })).getByRole("gridcell", { name: /^AA:/ }));
    expect(within(panel).getByText("BB's range")).toBeInTheDocument();
    expect(within(panel).getByRole("table")).toBeInTheDocument();
  });

  it("says so where the answer has no opponent's range to show (a preflop chart), and draws its one grid as ever", async () => {
    stub.answer = CHART_ANSWER;
    renderAt("p=6&s=100&vs=1");
    expect(await screen.findByRole("grid", { name: "UTG range" })).toBeInTheDocument();
    expect(screen.getAllByRole("grid")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Side by side/ })).toBeNull();
    expect(screen.getByText(/no opponent's range to put beside it/)).toBeInTheDocument();
  });

  it("on a wide window puts the opponent's range at the top of the panel, beside the grid, with the actions under it", async () => {
    wide(true);
    stub.answer = THREE_WAY;
    renderAt(`${FLOP}&vs=1`);
    const bar = await screen.findByRole("separator");
    const theirs = screen.getByRole("region", { name: "CO's range" });
    expect(bar.previousElementSibling).toContainElement(screen.getByRole("region", { name: "Range" }));
    expect(bar.nextElementSibling).toContainElement(theirs);
    before(theirs, screen.getByRole("region", { name: "Actions" }));
    before(screen.getByRole("region", { name: "Actions" }), screen.getByRole("complementary"));
  });

  it("on a narrow window stacks it under the actor's grid, the actions above both as ever", async () => {
    wide(false);
    stub.answer = THREE_WAY;
    renderAt(`${FLOP}&vs=1`);
    const theirs = await screen.findByRole("region", { name: "CO's range" });
    const range = screen.getByRole("region", { name: "Range" });
    before(screen.getByRole("region", { name: "Actions" }), range);
    before(range, theirs);
    before(theirs, screen.getByRole("complementary"));
  });
});
