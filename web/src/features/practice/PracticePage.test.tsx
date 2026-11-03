import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allSessions } from "@/data/db";
import { deleteImport, listHands, PRACTICE_SITE } from "@/data/hands";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
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
    stub.states = [];
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    // 3-handed, you're on the button, which straddles and acts last preflop: the blinds call first
    await screen.findByRole("group", { name: "Your options" });
    expect(screen.getByText("Hand 1 · 3-max · 100bb · ante 0.1 · straddle")).toBeInTheDocument();
    expect(screen.getByText("Pot").nextSibling).toHaveTextContent("6.3bb");
    expect(stub.states.length).toBeGreaterThan(0);
    for (const st of stub.states) expect(st).toMatchObject({ ante: 0.1, straddle: true });
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getByRole("button", { name: "fold" }));
    expect(await screen.findByText("You folded")).toBeInTheDocument();
    await waitFor(async () => expect((await allSessions()).find((s) => s.meta.ante === 0.1)?.meta).toMatchObject({ players: 3, straddle: true }));
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

  it("labels a size the solver's name doesn't say", () => {
    expect(optionLabel("bet 33%", 1.8)).toBe("bet 33% (1.8bb)");
    expect(optionLabel("raise 2.5", 2.5)).toBe("raise 2.5");
    expect(optionLabel("check", undefined)).toBe("check");
  });
});
