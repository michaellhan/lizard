import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allSessions } from "@/data/db";
import { deleteImport, listHands, PRACTICE_SITE } from "@/data/hands";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import { classOf } from "@/engine/nlhe/cards";
import { describe as describeProvenance } from "@/solver/provenance";
import type { PlayRequest, Provenance, SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";

import { optionLabel, PracticePage } from "./PracticePage";

const prov = (source: Provenance["source"], extra: Partial<Provenance> = {}): Provenance => ({
  source,
  approximate: source === "charts",
  mode: "quick",
  transport: "worker",
  solverVersion: "test",
  partial: false,
  receivedAt: 0,
  ...extra,
});
const LIVE = prov("live", { exploitabilityPct: 0.4, band: "converged" });

// preflop: the chart's answer (no EVs); on the flop: a solve with EVs
const CHART: AdvisorResponse = {
  street: "preflop",
  pot_bb: 1.5,
  actions: [
    { action: "fold", freq: 0.1 },
    { action: "call", freq: 0.2 },
    { action: "raise 2.5", freq: 0.7, amount_bb: 2.5 },
  ],
};
const FLOP: AdvisorResponse = {
  street: "flop",
  pot_bb: 5,
  actions: [
    { action: "check", freq: 0.4, ev_bb: 2 },
    { action: "bet 33%", freq: 0.6, ev_bb: 2.2, amount_bb: 1.6 },
  ],
};

// the solver stubbed: your spot answered by street, the big blind calls, checks the flop, folds to a bet
const stub = vi.hoisted(() => {
  const s = {
    calls: [] as string[],
    states: [] as AdvisorState[],
    // a preflop move of the stub's own for a seat (else it calls)
    pre: null as null | ((seat: string) => { action: PlayMove["action"]; to?: number } | null),
    getSolver: null as unknown as () => Promise<unknown>,
    answer: (st: AdvisorState): SolveResult => ({ data: st.board ? FLOP : CHART, provenance: st.board ? LIVE : prov("charts") }),
  };
  const client = {
    solve: async ({ state }: { state: AdvisorState }) => {
      s.calls.push(`advise ${state.hero} ${state.board || "preflop"}`);
      s.states.push(state);
      return s.answer(state);
    },
    play: async (state: AdvisorState, p: PlayRequest): Promise<SolveResult<PlayMove>> => {
      s.calls.push(`play ${p.seat}`);
      s.states.push(state);
      const own = !state.board ? s.pre?.(p.seat) : null;
      if (own) return { data: { pos: p.seat, ...own, name: own.action, freq: 1, street: "preflop" }, provenance: LIVE };
      const flop = (state.flop as unknown[] | undefined) ?? [];
      const action: PlayMove["action"] = !state.board ? "call" : flop.length === 0 ? "check" : "fold";
      return { data: { pos: p.seat, action, name: action, freq: 1, street: "flop" }, provenance: LIVE };
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

afterEach(() => {
  stub.calls = [];
  stub.states = [];
  stub.pre = null;
  useSettings.setState({ mode: "fast", keepHands: false });
});

describe("PracticePage", () => {
  it("plays a hand: your options are the solver's, each move graded with its answer's source; the pot to the winner", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    // heads-up, the first hand from the button (the small blind): you act first
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    const options = await screen.findByRole("group", { name: "Your options" });
    expect(within(options).getAllByRole("button").map((b) => b.textContent)).toEqual(["1fold", "2call", "3raise 2.5"]);
    expect(screen.getByRole("listitem", { name: "BTN/SB (you)" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(options).getByRole("button", { name: "raise 2.5" }));

    // graded by frequency (the chart), with the chart's provenance
    let last = await screen.findByRole("region", { name: "Last decision" });
    expect(within(last).getByText("Best")).toBeInTheDocument();
    expect(within(last).getByText(/Graded by how often the chart plays it/)).toBeInTheDocument();
    // the rule-based why, in the chart's name (not a solver's)
    expect(within(last).getByText(/^The chart (always plays this here|picks this most often here: \d+% of the time)\.$/)).toBeInTheDocument();
    expect(within(last).getByText(describeProvenance(prov("charts")))).toBeInTheDocument();
    // the spot in Study: heads-up at 100bb, nothing before your decision
    expect(within(last).getByRole("link", { name: "Open this spot in Study →" })).toHaveAttribute("href", "/study?p=2&s=100");

    // the big blind calls and checks the flop; you bet, it folds
    const flop = await screen.findByRole("group", { name: "Your options" });
    expect(within(flop).getAllByRole("button").map((b) => b.textContent)).toEqual(["1check", "2bet 33% (1.6bb)"]);
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    fireEvent.click(within(flop).getByRole("button", { name: "bet 33% (1.6bb)" }));
    last = screen.getByRole("region", { name: "Last decision" });
    expect(within(last).getByText("Best")).toBeInTheDocument();
    expect(within(last).getByText(/^No EV given up\. This hand mixes actions here\.$/)).toBeInTheDocument();
    expect(within(last).getByText("The solver picks this most often here: 60% of the time.")).toBeInTheDocument();
    expect(within(last).getByText(describeProvenance(LIVE))).toBeInTheDocument();
    expect(within(last).getByRole("row", { name: /bet 33% \(1\.6bb\) ← you 60\.0% 2\.20/ })).toBeInTheDocument();
    // (your raise, its call, the big blind's check, the flop)
    expect(within(last).getByRole("link", { name: "Open this spot in Study →" }).getAttribute("href")).toMatch(/^\/study\?p=2&s=100&pre=SB%3Ar2\.5%2CBB%3Ac&b=([2-9TJQKA][shdc]){3}&flop=BB%3Ax$/);

    // 2.5bb each preflop, your 1.5bb bet not called: you win the 5bb pot, +2.5bb
    expect(await screen.findByText("You won")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You won 2.5bb");
    const score = screen.getByRole("region", { name: "Score" });
    expect(within(score).getByText("+2.5bb")).toBeInTheDocument();
    expect(within(score).getByText("100%")).toBeInTheDocument();
    // one request a decision: yours (advice) and the big blind's (a move)
    // (from the heads-up hand: the 6-max hand dealt on load may have asked for its first move)
    const mine = stub.calls.slice(stub.calls.indexOf("advise SB preflop"));
    expect(mine.map((c) => c.replace(/([2-9TJQKA][shdc]){3}$/, "<flop>"))).toEqual([
      "advise SB preflop",
      "play BB",
      "play BB",
      "advise SB <flop>",
      "play BB",
    ]);
    expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent(/preflop: You raise to 2\.5, BB calls/);
    expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent(/flop \[.. .. ..\]: BB checks, You bet 1\.5, BB folds/);
    // the session kept for History: the hand under its pot type, the decisions under what graded them
    await waitFor(async () =>
      expect((await allSessions()).find((s) => s.kind === "practice" && s.meta.hands === 1 && s.meta.players === 2)?.meta).toMatchObject({
        byPot: { SRP: { hands: 1, n: 2, ok: 2, ne: 1, played: 1, net: 2.5 } },
        sources: { charts: 1, live: 1 },
      }),
    );

    // the next hand: your seat moves to the big blind
    fireEvent.click(screen.getByRole("button", { name: "Next hand" }));
    expect(await screen.findByRole("listitem", { name: "BB (you)" })).toBeInTheDocument();
  });

  it("drills one kind of pot: your preflop played for you, dealt again until it's that pot; you play from the flop", async () => {
    // the first deal you limp (the hand goes another way); the next you raise and the big blind calls
    let limps = 1;
    stub.pre = (seat) => (seat === "SB" ? (limps-- > 0 ? { action: "call" } : { action: "raise", to: 2.5 }) : null);
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    const play = screen.getByRole("combobox", { name: "Play" });
    expect(within(play).getAllByRole("option").map((o) => o.textContent)).toEqual(["Full hands", "Preflop only", "Single-raised pots", "3-bet pots", "Blind vs blind"]);
    fireEvent.change(play, { target: { value: "srp" } });
    stub.calls = [];
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    // on the flop: the big blind checks, your spot is solved; nothing of your preflop was asked for advice or graded
    const options = await screen.findByRole("group", { name: "Your options" });
    expect(within(options).getAllByRole("button").map((b) => b.textContent)).toEqual(["1check", "2bet 33% (1.6bb)"]);
    expect(stub.calls.map((c) => c.replace(/([2-9TJQKA][shdc]){3}$/, "<flop>"))).toEqual(["play SB", "play BB", "play SB", "play BB", "play BB", "advise SB <flop>"]);
    expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent(/preflop: You raise to 2\.5, BB calls/);
    expect(screen.getByText("Hand 1 · heads-up · 100bb")).toBeInTheDocument();
    fireEvent.click(within(options).getByRole("button", { name: "bet 33% (1.6bb)" }));
    expect(await screen.findByText("You won")).toBeInTheDocument();
    const score = screen.getByRole("region", { name: "Score" });
    expect(within(score).getByText("Decisions graded").nextSibling).toHaveTextContent("1");
    await waitFor(async () =>
      expect((await allSessions()).find((s) => s.kind === "practice" && s.meta.pot === "srp")?.meta).toMatchObject({
        hands: 1,
        byPot: { SRP: { hands: 1, n: 1 } },
        sources: { live: 1 },
      }),
    );
  });

  it("plays with an ante and a straddle: on the table, in every request, and kept with the session", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    const straddle = screen.getByRole("checkbox", { name: "Straddle" });
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    expect(straddle).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "3" } });
    fireEvent.click(straddle);
    const ante = screen.getByRole("spinbutton", { name: "Ante" });
    fireEvent.change(ante, { target: { value: "2" } });
    expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
    fireEvent.change(ante, { target: { value: "0.1" } });
    // (a rake over 25% is refused; 5% capped at 3bb is sent with every request)
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rake" }), { target: { value: "30" } });
    expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rake" }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rake cap" }), { target: { value: "3" } });
    stub.states = [];
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    // 3-handed, you're on the button, which straddles and acts last preflop: the blinds call first
    await screen.findByRole("group", { name: "Your options" });
    expect(screen.getByText("Hand 1 · 3-max · 100bb · ante 0.1 · straddle · rake 5% (cap 3bb)")).toBeInTheDocument();
    expect(screen.getByText("Pot").nextSibling).toHaveTextContent("6.3bb");
    expect(stub.states.length).toBeGreaterThan(0);
    for (const st of stub.states) expect(st).toMatchObject({ ante: 0.1, straddle: true, rake: 0.05, rake_cap: 3 });
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "fold" }));
    expect(await screen.findByText("You folded")).toBeInTheDocument();
    // (the best named by the answer's source: the chart, not a solver)
    expect(screen.getByRole("region", { name: "Last decision" })).toHaveTextContent("preflop: you took fold; the chart’s best was raise 2.5");
    await waitFor(async () => expect((await allSessions()).find((s) => s.meta.ante === 0.1)?.meta).toMatchObject({ players: 3, straddle: true, rake: 5, rakeCap: 3 }));
  });

  it("carries chips from hand to hand: your stack as the hand ends, the next hand from it, every request with the stacks", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    const carry = screen.getByRole("checkbox", { name: "Carry chips" });
    // (full hands with your seat moving only)
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: "BB" } });
    expect(carry).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: "moves" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Play" }), { target: { value: "preflop" } });
    expect(carry).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Play" }), { target: { value: "full" } });
    fireEvent.click(carry);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    // you raise, the big blind calls and checks the flop; you bet, it folds: 2.5bb won
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["1check", "2bet 33% (1.6bb)"]));
    expect(screen.getByText(/^Chips carried: your stack/)).toHaveTextContent("Chips carried: your stack 100bb");
    expect(screen.getByRole("button", { name: "Reset stacks" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "bet 33% (1.6bb)" }));
    await screen.findByRole("button", { name: "Next hand" });
    expect(screen.getByText(/^Chips carried: your stack/)).toHaveTextContent("Chips carried: your stack 100bb → 102.5bb");
    // the next hand: you're the big blind with your 102.5, the small blind has its 97.5
    stub.states = [];
    fireEvent.click(screen.getByRole("button", { name: "Next hand" }));
    await screen.findByRole("group", { name: "Your options" });
    expect(screen.getByRole("listitem", { name: "BB (you)" })).toHaveTextContent("101.5");
    expect(screen.getByText(/^Chips carried: your stack/)).toHaveTextContent("Chips carried: your stack 102.5bb");
    expect(stub.states.length).toBeGreaterThan(0);
    for (const st of stub.states) expect(st).toMatchObject({ stack: 100, stacks: { SB: 97.5, BB: 102.5 } });
    await waitFor(async () => expect((await allSessions())[0]?.meta).toMatchObject({ players: 2, carry: true, hands: 1, net: 2.5 }));
  });

  it("reviews your mistakes: the costliest of your decisions this session, each opening its spot and verdict", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(screen.queryByRole("region", { name: "Your decisions" })).toBeNull();
    // your raise (Best); the big blind calls and checks the flop; your check is in the mix but gives up 0.2bb
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["1check", "2bet 33% (1.6bb)"]));
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "check" }));
    const review = await screen.findByRole("region", { name: "Your decisions" });
    // your last decisions, newest first
    expect(within(review).getByRole("heading")).toHaveTextContent("Recent decisions");
    expect(within(review).getAllByRole("button", { name: /^#1 / }).map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^#1 flop.*check.*Correct.*0\.20bb lost.*Live solve$/),
      expect.stringMatching(/^#1 preflop.*raise 2\.5.*Best.*played 70\.0%.*Preflop charts$/),
    ]);
    const toggle = within(review).getByRole("button", { name: "Review mistakes (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(review).getByRole("heading")).toHaveTextContent("Your biggest mistakes · last 2 decisions");
    const row = within(review).getByRole("button", { name: /^#1 flop/ });
    expect(row).toHaveTextContent("#1 flop");
    expect(row).toHaveTextContent("check");
    expect(row).toHaveTextContent("Correct");
    expect(row).toHaveTextContent("0.20bb lost");
    // (the number's source, named)
    expect(row).toHaveTextContent("Live solve");
    expect(within(row).getByTitle(describeProvenance(LIVE))).toBeInTheDocument();
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(within(review).getByText(/· BB checks$/)).toBeInTheDocument();
    const spot = within(review).getByRole("region", { name: "Hand 1, flop" });
    expect(within(spot).getByText(describeProvenance(LIVE))).toBeInTheDocument();
    expect(within(spot).getByText(/^EV given up: 0\.20bb/)).toBeInTheDocument();
    // a new session starts its own
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Your decisions" })).toBeNull());
  });

  it("shows your whole range at your last decision, as its answer plays it, once asked for", async () => {
    const answer = stub.answer;
    // (the chart's answer with its grid: your hand's class and another)
    const grid = { actions: ["fold", "call", "raise 2.5"], cells: {} as Record<string, { w: number; f: number[] }> };
    stub.answer = (st) => {
      const r = answer(st);
      if (st.board) return r;
      grid.cells[classOf(st.hole!)] = { w: 1, f: [0.1, 0.2, 0.7] };
      grid.cells["72o"] = { w: 0.5, f: [1, 0, 0] };
      return { ...r, data: { ...r.data, grid } };
    };
    try {
      render(
        <MemoryRouter>
          <PracticePage pace={0} />
        </MemoryRouter>,
      );
      fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
      const last = await screen.findByRole("region", { name: "Last decision" });
      const summary = within(last).getByText("Your range · preflop · BTN/SB vs BB");
      const details = summary.closest("details")!;
      expect(details.open).toBe(false);
      fireEvent.click(summary);
      await waitFor(() => expect(details.open).toBe(true));
      const matrix = within(last).getByRole("grid", { name: "Your range · preflop · BTN/SB vs BB" });
      expect(within(matrix).getAllByRole("gridcell")).toHaveLength(169);
      const mine = classOf(stub.states.find((x) => !x.board)!.hole!);
      expect(within(last).getByText(/\(your hand\): fold 10\.0%, call 20\.0%, raise 2\.5 70\.0%$/).textContent).toBe(`${mine} (your hand): fold 10.0%, call 20.0%, raise 2.5 70.0%`);
      // another hand picked: its mix, and its share of combos
      fireEvent.click(within(matrix).getByRole("gridcell", { name: /^72o/ }));
      expect(within(last).getByText(/^: fold 100\.0%$/)).toHaveTextContent(/^72o: fold 100\.0% · 50\.0% of its combos in the range$/);
      // on the flop: no grid in the answer, none shown
      await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")).toHaveLength(2));
      fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "check" }));
      await waitFor(() => expect(within(screen.getByRole("region", { name: "Last decision" })).queryByText(/^Your range/)).toBeNull());
    } finally {
      stub.answer = answer;
    }
  });

  it("runs a hand out after your fold: the others play on, each from its own seat; your fold stays as it was", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    // you fold the button; the small blind calls, the big blind checks, then checks behind on the flop... and folds
    stub.pre = (seat) => (seat === "BB" ? { action: "check" } : null);
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "fold" }));
    // (your result's line: an opponent's move under way has its own)
    const result = () => screen.getAllByRole("status").find((e) => e.textContent?.startsWith("You folded"));
    await waitFor(() => expect(result()).toHaveTextContent(/^You folded$/));
    expect(stub.calls.filter((c) => c.startsWith("play"))).toEqual([]);
    const faces = (seat: string) => within(screen.getByRole("listitem", { name: seat })).queryAllByRole("img").map((i) => i.getAttribute("aria-label"));
    expect(faces("SB")).toEqual(["face-down card", "face-down card"]);
    stub.states = [];
    fireEvent.click(screen.getByRole("button", { name: "Run it out" }));
    await waitFor(() => expect(result()).toHaveTextContent("You folded · run out: SB took the pot"));
    expect(screen.queryByRole("button", { name: "Run it out" })).toBeNull();
    expect(stub.calls.filter((c) => c.startsWith("play"))).toEqual(["play SB", "play BB", "play SB", "play BB"]);
    // each asked from the seat's own view
    expect(stub.states.map((st) => st.hero)).toEqual(["SB", "BB", "SB", "BB"]);
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    expect(screen.getByRole("listitem", { name: "SB" })).toHaveTextContent("won 2");
    // every seat's cards shown once it's over, the big blind's folded ones too
    for (const seat of ["SB", "BB"]) expect(faces(seat)).toEqual([expect.stringMatching(/ of /), expect.stringMatching(/ of /)]);
    await waitFor(async () => expect((await allSessions())[0]?.meta).toMatchObject({ players: 3, hands: 1, net: 0 }));
  });

  it("plays with your own sizes: checked before the session, sent from the flop on, named on the table and kept", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Flop bets" }), { target: { value: "50, 700" } });
    expect(screen.getByRole("alert")).toHaveTextContent("flop bet sizes must be 5–500% of the pot");
    expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Flop bets" }), { target: { value: "50" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Raises" }), { target: { value: "250%" } });
    stub.states = [];
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["1check", "2bet 33% (1.6bb)"]));
    expect(screen.getByText(/^Hand 1 · heads-up/)).toHaveTextContent("Hand 1 · heads-up · 100bb · your sizes: flop bets 50%, raises 250%");
    // preflop's requests without them, the flop's with them
    const sizes = { flop: [50], raise: [250] };
    expect(stub.states.filter((st) => !st.board).every((st) => !("sizes" in st))).toBe(true);
    expect(stub.states.filter((st) => st.board).length).toBeGreaterThan(0);
    for (const st of stub.states.filter((x) => x.board)) expect(st).toMatchObject({ sizes });
    expect(within(screen.getByRole("region", { name: "Last decision" })).getByRole("link", { name: "Open this spot in Study →" })).toHaveAttribute("href", "/study?p=2&s=100&sz.flop=50&sz.raise=250");
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "check" }));
    await waitFor(async () => expect((await allSessions())[0]?.meta).toMatchObject({ players: 2, sizes }));
  });

  it("plays by keys: 1–9 your options, K keeps the hand, Enter the next one; none while drilling or typing", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    await screen.findByRole("group", { name: "Your options" });
    // (on the Drills tab the hand waits)
    fireEvent.click(screen.getByRole("tab", { name: "Drills" }));
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.click(screen.getByRole("tab", { name: "Full hands" }));
    expect(screen.queryByRole("region", { name: "Last decision" })).toBeNull();
    // (a held key, or one typed in a field, takes nothing)
    fireEvent.keyDown(window, { key: "3", repeat: true });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Players" }), { key: "3" });
    expect(screen.queryByRole("region", { name: "Last decision" })).toBeNull();

    // 3: raise 2.5; on the flop, 9 is no option, 2 bets
    fireEvent.keyDown(window, { key: "3" });
    expect(within(await screen.findByRole("region", { name: "Last decision" })).getByText("Best")).toBeInTheDocument();
    await screen.findByRole("button", { name: "bet 33% (1.6bb)" });
    fireEvent.keyDown(window, { key: "9" });
    expect(screen.getByRole("button", { name: "bet 33% (1.6bb)" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2" });
    expect(await screen.findByText("You won")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next hand" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "k" });
    expect(await screen.findByRole("link", { name: "Open it there" })).toBeInTheDocument();
    const kept = await listHands();
    expect(kept).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(await screen.findByRole("listitem", { name: "BB (you)" })).toBeInTheDocument();
    await deleteImport(kept[0]!.importId);
  });

  it("keeps a finished hand in Analyze, and every hand once asked to", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    // (the flop's options: the preflop group's buttons are gone first)
    fireEvent.click(await screen.findByRole("button", { name: "bet 33% (1.6bb)" }));
    expect(await screen.findByText("You won")).toBeInTheDocument();
    expect(await listHands()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Keep in Analyze" }));
    const open = await screen.findByRole("link", { name: "Open it there" });
    const [kept] = await listHands();
    expect(kept).toMatchObject({ site: PRACTICE_SITE, hero: "SB", players: 2, end: "won, all folded", decisions: 2, potType: "SRP" });
    expect(open).toHaveAttribute("href", `/analyze?hand=${encodeURIComponent(kept!.id)}`);
    expect(screen.getByText(/^Kept in Analyze/)).toBeInTheDocument();

    // every hand from now: the next one kept as it ends (you're the big blind; the small blind limps and folds the flop)
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep every hand" }));
    expect(useSettings.getState().keepHands).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next hand" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "call" }));
    fireEvent.click(await screen.findByRole("button", { name: "bet 33% (1.6bb)" }));
    expect(await screen.findByRole("link", { name: "Open it there" })).toBeInTheDocument();
    const both = await listHands();
    expect(both.map((h) => [h.hero, h.end, h.importId === kept!.importId])).toEqual(
      expect.arrayContaining([
        ["SB", "won, all folded", true],
        ["BB", "won, all folded", true],
      ]),
    );
    expect(both).toHaveLength(2);
  });

  it("preflop only, in the big blind each hand: the hand stops as the preflop closes, no net counted", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: "BB" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Play" }), { target: { value: "preflop" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    // the small blind limps; you check
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: "call" }));
    expect(await screen.findByText("You see the flop: preflop only, the hand stops here")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "BB (you)" })).toBeInTheDocument();
    // (the small blind's cards stay face down: nothing was shown down)
    expect(within(screen.getByRole("listitem", { name: "BTN/SB" })).getAllByRole("img").map((c) => c.getAttribute("aria-label"))).toEqual(["face-down card", "face-down card"]);
    const score = screen.getByRole("region", { name: "Score" });
    expect(within(score).getByText("Hands").nextElementSibling).toHaveTextContent(/^1$/);
    expect(within(score).queryByText("Net")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next hand" }));
    expect(await screen.findByRole("group", { name: "Your options" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "BB (you)" })).toHaveAttribute("aria-current", "true");
  });

  it("offers the moves without a grade where your spot has no answer", async () => {
    const answer = stub.answer;
    stub.answer = () => {
      throw new Error("the solve failed");
    };
    try {
      render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
      fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      const moves = await screen.findByRole("group", { name: "Moves without a grade" });
      expect(screen.getByText(/No answer to grade this spot against: the solve failed/)).toBeInTheDocument();
      expect(within(moves).getAllByRole("button").map((b) => b.textContent)).toEqual(["fold", "call 0.5", "raise to 2", "all-in 100"]);
      fireEvent.click(within(moves).getByRole("button", { name: "fold" }));
      expect(await screen.findByText("Not graded")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("You folded · −0.5bb");
      expect(screen.getByRole("region", { name: "Hand history" })).toHaveTextContent("preflop: You fold");
    } finally {
      stub.answer = answer;
    }
  });

  it("drills in their own tab, the hand under way kept", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    const hands = screen.getByRole("tabpanel", { name: "Full hands" });
    fireEvent.click(screen.getByRole("tab", { name: "Drills" }));
    expect(screen.getByRole("tab", { name: "Drills" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tabpanel", { name: "Drills" })).toBeInTheDocument();
    expect(hands).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Full hands" }));
    expect(screen.getByRole("tabpanel", { name: "Full hands" })).toBe(hands);
    expect(screen.queryByRole("tabpanel", { name: "Drills" })).toBeNull();
  });

  const headsUp = async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    return screen.findByRole("group", { name: "Your options" });
  };
  const askedSoFar = () => stub.calls.slice(stub.calls.lastIndexOf("advise SB preflop"));

  it("Hint says the spot and the price, from the table, and gives no mix away", async () => {
    await headsUp();
    const before = askedSoFar().length;
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    const said = screen.getByText(/A call is 0\.5bb to win 1\.5bb: pot odds of 25\.0%/);
    expect(said).toHaveTextContent("Preflop in BTN/SB, no one has come in yet.");
    expect(said).toHaveTextContent("Worked out from the chips on the table. The answer isn't read for a hint");
    expect(said.textContent).not.toMatch(/70\.0%|raise 2\.5/);
    expect(askedSoFar()).toHaveLength(before);
    // (it doesn't cost the grade)
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    expect(within(await screen.findByRole("region", { name: "Last decision" })).getByText("Best")).toBeInTheDocument();
  });

  it("Reveal shows the mix for your hand from the answer in hand; the decision after it isn't graded, and the page says so", async () => {
    await headsUp();
    const before = askedSoFar().length;
    expect(within(screen.getByRole("button", { name: "Reveal" }).parentElement!).getByText(/Reveal shows the answer for your hand, and what you do after it isn.t graded\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    const shown = screen.getByRole("group", { name: "Revealed answer" });
    expect(within(shown).getByRole("row", { name: /raise 2\.5 70\.0%/ })).toBeInTheDocument();
    // the charts by name, never a solve
    expect(within(shown).getByText(/^The chart.s mix for your hand$/)).toBeInTheDocument();
    expect(within(shown).getByText("This answer has no EVs for your hand.")).toBeInTheDocument();
    expect(within(shown).getByRole("status")).toHaveTextContent(/this decision isn.t graded\. It doesn.t count toward your score, your streak, History or Review\. The hand still counts in Hands and Net\./);
    expect(askedSoFar()).toHaveLength(before);

    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    const last = await screen.findByRole("region", { name: "Last decision" });
    expect(within(last).getByText("Not graded: you revealed the answer first")).toBeInTheDocument();
    expect(within(last).queryByRole("button", { name: "Copy for AI" })).toBeNull();
    const score = within(screen.getByRole("region", { name: "Score" }));
    expect(score.getByText("1 decision made after Reveal, not in these numbers. The hand still counts in Hands and Net.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent decisions" })).toBeNull();
    // the flop's decision is yours to grade again
    const flop = await screen.findByRole("group", { name: "Your options" });
    expect(screen.queryByRole("group", { name: "Revealed answer" })).toBeNull();
    expect(within(flop).getByRole("button", { name: "check" })).toBeInTheDocument();
    fireEvent.click(within(flop).getByRole("button", { name: "check" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Last decision" })).queryByText(/^Not graded/)).toBeNull());
  });

  it("steps back through this session's decisions, and a retry is graded and shown with the score as it was", async () => {
    await headsUp();
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "fold" }));
    await screen.findByRole("region", { name: "Last decision" });
    const score = () => screen.getByRole("region", { name: "Score" }).textContent;
    await waitFor(() => expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument());
    const was = score();
    const calls = stub.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText(/Decision 1 of the 1 kept\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry this decision" }));
    const retry = await screen.findByRole("region", { name: "Retry this decision" });
    expect(within(retry).getByText(/A retry is graded and shown here\. It doesn.t change your score/)).toBeInTheDocument();
    const options = await within(retry).findByRole("group", { name: "Retry options" });
    // held by the Room, so asked of nobody
    expect(stub.calls).toHaveLength(calls);
    // a number key doesn't reach the table under it
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.click(within(options).getByRole("button", { name: "raise 2.5" }));
    expect(within(retry).getByText(/^This retry$/)).toBeInTheDocument();
    expect(within(retry).getByText(/This time:/)).toHaveTextContent("Same kind of answer both times.");
    expect(score()).toBe(was);

    fireEvent.click(within(retry).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Retry this decision" })).toBeNull();
  });

  it("keeps the table's keys off while a retry is open, as they'd play a real move under it", async () => {
    await headsUp();
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    const flop = await screen.findByRole("group", { name: "Your options" });
    await waitFor(() => expect(within(flop).getByRole("button", { name: "check" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry this decision" }));
    await screen.findByRole("group", { name: "Retry options" });
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByRole("group", { name: "Your options" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Last decision" })).getByText("raise 2.5", { selector: "span.font-mono" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Retry this decision" })).toBeNull());
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Last decision" })).getByText("check", { selector: "span.font-mono" })).toBeInTheDocument());
  });

  it("copies a graded decision for AI, and says why where the clipboard fails, with the text to copy by hand", async () => {
    const writeText = vi.fn(async (_: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await headsUp();
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "raise 2.5" }));
    const last = await screen.findByRole("region", { name: "Last decision" });
    fireEvent.click(within(last).getByRole("button", { name: "Copy for AI" }));
    expect(await within(last).findByText(/^Copied\. Lizard sent nothing/)).toBeInTheDocument();
    const text = writeText.mock.calls[0]![0];
    expect(text).toContain("Seats, first to act preflop first: BTN/SB, BB");
    expect(text).toContain("The preflop charts are approximate tables. They are not a solved answer");
    expect(text).toContain("- raise 2.5: 70.0%");

    writeText.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    fireEvent.click(within(last).getByRole("button", { name: "Copy for AI" }));
    expect(await within(last).findByRole("alert")).toHaveTextContent(/Not copied: the browser refused it/);
    expect((within(last).getByRole("textbox", { name: "Text for AI" }) as HTMLTextAreaElement).value).toBe(text);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("says Hint, Reveal and Previous are at one table only, and offers none above it", async () => {
    render(
      <MemoryRouter>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await screen.findByRole("tablist", { name: "Tables" });
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hint" })).toBeNull();
    expect(screen.getByText(/Hint, Reveal, Previous and retrying a decision are at one table only/)).toBeInTheDocument();
  });

  it("labels a size the solver's name doesn't say", () => {
    expect(optionLabel("bet 33%", 1.8)).toBe("bet 33% (1.8bb)");
    expect(optionLabel("raise 2.5", 2.5)).toBe("raise 2.5");
    expect(optionLabel("check", undefined)).toBe("check");
  });
});
