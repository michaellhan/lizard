// The two kinds of game a Practice session can be set up as: push/fold at 12bb or less, and a tournament in prize equity or
// chip EV. What's asked, what's graded and how, what's kept, all on the one Room.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTally } from "@/features/history/history";
import { fromSearch } from "@/features/study/studyState";
import type { Move } from "@/poker/table";
import { provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import type { PlayRequest, Provenance, SolveRequest, SolveResult } from "@/solver/types";
import { reviewedText } from "./copyForAi";
import { keptHand, keptTables } from "./keep";
import { DecisionView, ScoreStrip } from "./PracticeParts";
import { carries, CHIP_MODEL, decide, finish, gameLabel, gradable, modelled, newHand, phaseOf, stateFor, studyOf, withVillain, type Decision, type HandOptions, type PracticeHand, type SessionOptions, type TournamentOptions } from "./practice";
import { Room, type RoomClient } from "./room";
import { freshSession, sessionUnit, toRecord } from "./session";
import { SetupForm } from "./SetupForm";
import { draftOf, readDraft, T_MIN_STACK } from "./TournamentFields";

vi.mock("@/data/db", async (orig) => ({ ...(await orig<typeof import("@/data/db")>()), putSession: vi.fn(async () => {}) }));
vi.mock("@/data/mistakes", async (orig) => ({ ...(await orig<typeof import("@/data/mistakes")>()), keepMistake: vi.fn(async () => {}) }));

const OPTS: Required<HandOptions> = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };
const CTX = { mode: "quick", transport: "worker", solverVersion: "t", partial: false, now: 1 } as const;

const STACKS = { BTN: 25, SB: 8, BB: 30 };
const ICM: TournamentOptions = { model: "icm", stacks: STACKS, payouts: [50, 30, 20], field: { players: 6, avg: 20 } };
const CHIPS: TournamentOptions = { model: "chips", stacks: STACKS };

const JAM_NOTE = "a raise here commits too much of a 12bb stack: all-in, range from the push/fold equilibrium against 1 player";
const JAM: AdvisorResponse = {
  street: "preflop",
  pot_bb: 1.5,
  notes: ["preflop: chart approximation", JAM_NOTE],
  actions: [
    { action: "fold", freq: 0.3 },
    { action: "all-in", freq: 0.7, amount_bb: 12 },
  ],
};
const TOURNEY = { equity_share: 0.3, note: "tournament: ICM, BTN's prize equity 30.0% of what's left to pay; bubble factor up to 1.20" };
const ICM_FLOP: AdvisorResponse = {
  street: "flop",
  pot_bb: 5,
  tournament: TOURNEY,
  notes: [TOURNEY.note],
  solver: { iterations: 200 },
  actions: [
    { action: "check", freq: 0.5, ev_bb: 2.5 },
    { action: "bet 75%", freq: 0.5, ev_bb: 2.44, amount_bb: 3.75 },
  ],
};
const RULES: AdvisorResponse = {
  street: "flop",
  pot_bb: 5,
  fallback: "rules",
  tournament: TOURNEY,
  notes: ["this is a Monte Carlo heuristic"],
  actions: [
    { action: "check", freq: 0.5, ev_bb: 7 },
    { action: "bet 75%", freq: 0.5, ev_bb: 6, amount_bb: 3.75 },
  ],
};

const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const played = (h: PracticeHand, ms: Move[]) => ms.reduce((x, m) => withVillain(x, m), h);

/** The Room's solver: answers each ask with what's asked for, as the real provenance reads it. */
function stubClient(answer: (s: AdvisorState) => AdvisorResponse, play: (s: AdvisorState, p: PlayRequest) => PlayMove) {
  const states: AdvisorState[] = [];
  const client: RoomClient = {
    solve: async (req: SolveRequest) => {
      states.push(req.state);
      const data = answer(req.state);
      return { data, provenance: provenanceOf(data, CTX) } as SolveResult<AdvisorResponse>;
    },
    play: async (state, p) => ({ data: play(state, p), provenance: provenanceOf({}, CTX) }) as SolveResult<PlayMove>,
    prefetch: () => {},
    transport: { kind: "worker" },
  };
  return { client, states };
}
const room = (client: RoomClient, tables?: number) => {
  const r = new Room({ pace: 0, pause: 0, guard: 0, now: () => Date.now(), persist: false, seedOf: (n) => n + 1, readIndex: async () => null, ...(tables ? { tables } : {}) });
  r.setSolver(async () => client);
  rooms.push(r);
  return r;
};
let rooms: Room[] = [];
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i += 1) await vi.advanceTimersByTimeAsync(5);
  expect(ok()).toBe(true);
};

describe("a push/fold hand", () => {
  const OPT = { ...OPTS, pushFold: true };

  it("is marked, and carries no chips", () => {
    expect(newHand(6, 12, 0, 1, OPT).pushFold).toBe(true);
    expect(newHand(6, 12, 0, 1, OPTS).pushFold).toBeUndefined();
    expect(carries({ ...OPT, carry: true })).toBe(false);
  });

  it("runs an all-in out to the river, and shows it down", () => {
    const h = newHand(2, 12, 0, 1, { ...OPT, seat: "SB" });
    const all = played(h, [mv("SB", "all-in", 12), mv("BB", "call")]);
    expect(phaseOf(all)).toEqual({ kind: "deal", street: "flop" });
    expect(finish({ ...all, shown: 5 }).cut).toBeUndefined();
  });

  it("stops at the flop if two can still bet: the mode has nothing to say there", () => {
    const h = newHand(3, 12, 0, 1, { ...OPT, seat: "BB" });
    const limped = played(h, [mv("BTN", "fold"), mv("SB", "call"), mv("BB", "check")]);
    expect(phaseOf(limped).kind).toBe("over");
    expect(finish(limped).cut).toBe(true);
  });
});

describe("a tournament hand", () => {
  it("has its game and each seat's chips", () => {
    const h = newHand(3, 20, 0, 1, { ...OPTS, tournament: ICM });
    expect(h.tournament).toEqual({ model: "icm", payouts: [50, 30, 20], field: { players: 6, avg: 20 } });
    expect(h.stacks).toEqual(STACKS);
    expect(carries({ ...OPTS, carry: true, tournament: ICM })).toBe(false);
  });

  it("asks in the session's prizes, with the other tables as chips", () => {
    const s = stateFor(newHand(3, 20, 0, 1, { ...OPTS, seat: "BTN", tournament: ICM }));
    expect(s).toMatchObject({ payouts: [50, 30, 20], field: { players: 6, chips: 120 }, stacks: STACKS });
  });

  it("asks in chips with no prizes in a chip EV session", () => {
    const s = stateFor(newHand(3, 20, 0, 1, { ...OPTS, seat: "BTN", tournament: CHIPS }));
    expect(s).toMatchObject({ stacks: STACKS });
    expect(s).not.toHaveProperty("payouts");
    expect(s).not.toHaveProperty("field");
  });

  it("opens in Study on the same game", () => {
    const h = fromSearch(studyOf(newHand(3, 20, 0, 1, { ...OPTS, seat: "BTN", tournament: ICM })))!;
    expect(h.setup?.tournament).toMatchObject({ payouts: [50, 30, 20], field: { players: 6, avg: 20 } });
  });

  it("names its game", () => {
    expect(gameLabel(ICM)).toBe("tournament in prize equity, prizes 50/30/20");
    expect(gameLabel(CHIPS)).toBe("tournament in chip EV");
  });
});

describe("what a tournament's decision is graded on", () => {
  const atFlop = (t: TournamentOptions) => {
    const h = newHand(2, 20, 0, 1, { ...OPTS, seat: "BB", tournament: { ...t, stacks: { SB: 20, BB: 20 } } });
    return { ...played(h, [mv("SB", "raise", 2.5), mv("BB", "call")]), shown: 3 };
  };

  it("grades a solve in prize equity by EV, and says so", () => {
    const r = decide(atFlop(ICM), ICM_FLOP, 1, provenanceOf(ICM_FLOP, CTX));
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.grade).toMatchObject({ byEv: true });
    expect(r.decision.provenance).toMatchObject({ source: "live", evIn: "prize" });
  });

  it("drops a fallback's chip EVs in a prize-equity session, grading it by frequency", () => {
    const p = provenanceOf(RULES, CTX);
    expect(p.evIn).toBe("chips");
    const r = decide(atFlop(ICM), RULES, 1, p);
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.grade?.byEv).toBe(false);
    expect(r.decision.mix.map((a) => a.ev)).toEqual([null, null]);
    expect(gradable(ICM_FLOP.actions!.map((a) => ({ action: a.action, freq: a.freq ?? 0, ev: a.ev_bb ?? null })), { evIn: "prize" }).map((a) => a.ev)).toEqual([2.5, 2.44]);
  });

  it("marks a chip EV session's answer, which says nothing of a tournament", () => {
    const flop: AdvisorResponse = { street: "flop", pot_bb: 5, solver: { iterations: 200 }, actions: ICM_FLOP.actions! };
    const r = decide(atFlop(CHIPS), flop, 0, provenanceOf(flop, CTX));
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.provenance).toMatchObject({ source: "live", tournament: CHIP_MODEL });
    expect(r.decision.grade?.byEv).toBe(true);
    expect(modelled({}, provenanceOf(flop, CTX))?.tournament).toBeUndefined();
    expect(modelled({ tournament: { model: "chips" } }, null)).toBeNull();
  });

  it("grades a push/fold answer by frequency, with no EV to lose", () => {
    const h = newHand(2, 12, 0, 1, { ...OPTS, seat: "SB", pushFold: true });
    const r = decide(h, JAM, 0, provenanceOf(JAM, CTX));
    if ("error" in r) throw new Error(r.error);
    expect(r.decision.grade).toMatchObject({ byEv: false, loss: 0 });
    expect(r.decision.provenance?.source).toBe("push-fold");
  });
});

describe("a session of each kind, as it's kept", () => {
  const rec = (o: SessionOptions) => toRecord({ ...freshSession(3, 20, o), hands: 2, net: 3 });

  it("goes under the kind of what its EVs are in", () => {
    expect(rec(OPTS).kind).toBe("practice");
    expect(rec({ ...OPTS, pushFold: true }).kind).toBe("practice");
    expect(rec({ ...OPTS, tournament: ICM }).kind).toBe("tournament");
    expect(rec({ ...OPTS, tournament: CHIPS }).kind).toBe("tournament-chips");
  });

  it("keeps the game beside the totals", () => {
    expect(rec({ ...OPTS, pushFold: true }).meta).toMatchObject({ pushFold: true });
    expect(rec({ ...OPTS, tournament: ICM }).meta).toMatchObject({ tournament: ICM });
    expect(rec(OPTS).meta).not.toHaveProperty("tournament");
    expect(rec(OPTS).meta).not.toHaveProperty("pushFold");
  });

  it("says what its EVs are in", () => {
    expect(sessionUnit({ tournament: ICM })).toBe("bb of prize equity");
    expect(sessionUnit({ tournament: CHIPS })).toBe("bb");
    expect(sessionUnit({})).toBe("bb");
  });
});

describe("the kept doc", () => {
  const kept = (hand: PracticeHand) => ({ hand, stats: emptyTally(), sources: {}, last: null, lastHand: null });
  const doc = (o: SessionOptions) => ({ v: 1, n: 2, focus: 1, session: { ...freshSession(3, 20, o), dealt: 2, tables: 2 }, tables: [kept(newHand(3, 20, 0, 1, o)), kept(newHand(3, 20, 1, 2, o))] });

  it("reads a hand of each kind back", () => {
    expect(keptHand(structuredClone(newHand(3, 12, 0, 1, { ...OPTS, pushFold: true })))?.pushFold).toBe(true);
    expect(keptHand(structuredClone(newHand(3, 20, 0, 1, { ...OPTS, tournament: ICM })))?.tournament).toEqual({ model: "icm", payouts: [50, 30, 20], field: { players: 6, avg: 20 } });
  });

  it("refuses a hand whose game is damaged", () => {
    const h = newHand(3, 20, 0, 1, { ...OPTS, tournament: ICM });
    expect(keptHand({ ...h, tournament: { model: "bounties" } })).toBeNull();
    expect(keptHand({ ...h, tournament: { model: "icm", payouts: ["50"] } })).toBeNull();
    expect(keptHand({ ...h, pushFold: "yes" })).toBeNull();
    expect(keptHand({ ...h, stacks: undefined })).toBeNull();
  });

  it("reads a session's game back, and a damaged one loses the session", () => {
    const o = { ...OPTS, board: null, tournament: ICM };
    expect(keptTables(structuredClone(doc(o)))?.session.opts.tournament).toEqual(ICM);
    expect(keptTables(structuredClone(doc({ ...OPTS, board: null, pushFold: true })))?.session.opts.pushFold).toBe(true);
    expect(keptTables(doc({ ...o, tournament: { model: "icm", payouts: [50, 50] } as unknown as TournamentOptions }))).toBeNull();
  });
});

describe("the New session form", () => {
  const open = (o: Partial<SessionOptions> = {}, start = vi.fn(), players = 6, stack = 100) => {
    render(<SetupForm players={players} stack={stack} opts={{ ...OPTS, ...o }} onEdit={() => {}} onStart={start} />);
    return start;
  };
  const pick = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });
  const type = (name: string, value: string) => fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
  const spin = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
  const go = () => fireEvent.click(screen.getByRole("button", { name: "New session" }));

  it("brings the stack down to the band, says what's answered and starts a push/fold session", () => {
    const start = open();
    pick("Play", "pushfold");
    expect(screen.getByRole("spinbutton", { name: "Stack in big blinds" })).toHaveValue(12);
    expect(screen.getByText(/equilibrium by hand class with no EVs/)).toBeInTheDocument();
    go();
    expect(start).toHaveBeenCalledWith(6, 12, expect.objectContaining({ pushFold: true, preflopOnly: false, sizes: null }));
  });

  it("keeps a stack in the band, and refuses one above it, saying so", () => {
    const start = open();
    spin("Stack in big blinds", "10");
    pick("Play", "pushfold");
    expect(screen.getByRole("spinbutton", { name: "Stack in big blinds" })).toHaveValue(10);
    spin("Stack in big blinds", "13");
    expect(screen.getByRole("alert")).toHaveTextContent("Push/fold is 10 to 12bb");
    go();
    expect(start).not.toHaveBeenCalled();
  });

  it("starts a tournament with its prizes, stacks and field", () => {
    const start = open();
    spin("Stack in big blinds", "20");
    pick("Play", "tournament");
    pick("Players", "3");
    type("Prizes left", "50, 30, 20");
    spin("Stack at BTN", "25");
    spin("Stack at SB", "8");
    spin("Players at other tables", "6");
    spin("Their average stack", "20");
    fireEvent.click(screen.getByRole("checkbox", { name: "Stop at the flop" }));
    go();
    expect(start).toHaveBeenCalledWith(3, 20, expect.objectContaining({ preflopOnly: true, rake: 0, straddle: false, tournament: { model: "icm", payouts: [50, 30, 20], field: { players: 6, avg: 20 }, stacks: { BTN: 25, SB: 8, BB: 20 } } }));
  });

  it("sets up a stage of an MTT at once: the table, each seat's chips, the ante and the prizes", () => {
    const start = open();
    pick("Play", "tournament");
    pick("Stage", "Final-table bubble");
    expect(screen.getByRole("combobox", { name: "Players" })).toHaveValue("5");
    expect(screen.getByRole("spinbutton", { name: "Stack in big blinds" })).toHaveValue(40);
    go();
    expect(start).toHaveBeenCalledWith(
      5,
      40,
      expect.objectContaining({
        ante: 0.2,
        tournament: { model: "icm", payouts: [30, 20, 14, 10.5, 8, 6.5, 5, 3.5, 2.5], field: { players: 5, avg: 22 }, stacks: { HJ: 20, CO: 40, BTN: 8, SB: 28, BB: 14 } },
      }),
    );
  });

  it("plays a tournament out where asked, in full hands with your seat moving", () => {
    const start = open();
    pick("Play", "tournament");
    const box = screen.getByRole("checkbox", { name: "Play it out" });
    expect(screen.queryByRole("checkbox", { name: "Carry chips" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Stop at the flop" }));
    expect(box).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Stop at the flop" }));
    fireEvent.click(box);
    go();
    expect(start.mock.calls[0]![2]).toMatchObject({ carry: true, preflopOnly: false });
  });

  it("starts a chip EV tournament with no prizes to ask for", () => {
    const start = open();
    pick("Play", "tournament");
    pick("Answers in", "chips");
    expect(screen.queryByRole("textbox", { name: "Prizes left" })).toBeNull();
    go();
    expect(start.mock.calls[0]![2].tournament.model).toBe("chips");
    expect(start.mock.calls[0]![2].tournament.payouts).toBeUndefined();
  });

  it("opens on the session it was given", () => {
    open({ tournament: { ...ICM, stacks: { BTN: 25, SB: 8, BB: 30 } } }, vi.fn(), 3, 20);
    expect(screen.getByRole("combobox", { name: "Play" })).toHaveValue("tournament");
    expect(screen.getByRole("textbox", { name: "Prizes left" })).toHaveValue("50, 30, 20");
  });
});

describe("readDraft", () => {
  const draft = (o: Partial<ReturnType<typeof draftOf>> = {}) => ({ ...draftOf(undefined, 20), ...o });

  it("fills blank seats with the table's stack", () => {
    expect(readDraft(draft({ stacks: { BTN: "8" } }), 3, 20, 250).value?.stacks).toEqual({ BTN: 8, SB: 20, BB: 20 });
  });
  it("takes a seat as short as its floor, and refuses less or too many chips", () => {
    expect(readDraft(draft({ stacks: { BTN: String(T_MIN_STACK) } }), 3, 20, 250).problems).toEqual([]);
    expect(readDraft(draft({ stacks: { BTN: "1.5" } }), 3, 20, 250).value).toBeNull();
    expect(readDraft(draft({ stacks: { BTN: "251" } }), 3, 20, 250).value).toBeNull();
    expect(readDraft(draft({ stacks: { BTN: "x" } }), 3, 20, 250).value).toBeNull();
  });
  it("needs two prizes for ICM, as one is chips", () => {
    expect(readDraft(draft({ payouts: "100" }), 3, 20, 250).problems.join()).toMatch(/two or more prizes/);
    expect(readDraft(draft({ payouts: "100", model: "chips" }), 3, 20, 250).value).toEqual({ model: "chips", stacks: { BTN: 20, SB: 20, BB: 20 } });
  });
  it("gives the draft back as it was set up", () => {
    const d = draftOf(ICM, 25);
    expect(d).toMatchObject({ model: "icm", payouts: "50, 30, 20", stacks: { SB: "8", BB: "30" }, others: "6", avg: "20" });
    expect(readDraft(d, 3, 25, 250).value).toEqual(ICM);
  });
});

describe("what's said of a decision", () => {
  const prov = (x: Partial<Provenance>): Provenance => ({ source: "live", approximate: false, mode: "quick", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, ...x });
  const dec = (p: Provenance, ev: boolean, byEv: boolean): Omit<Decision, "move"> => ({
    street: "flop",
    chose: "bet 75%",
    pot: 5,
    study: "",
    mix: [
      { action: "check", freq: 0.5, ev: ev ? 2.5 : null },
      { action: "bet 75%", freq: 0.5, ev: ev ? 2.44 : null, amount: 3.75 },
    ],
    grade: { a: 1, best: 0, byEv, loss: byEv ? 0.06 : 0, lossPct: byEv ? 1.2 : 0, verdict: "Inaccuracy", mixed: false, ok: false },
    provenance: p,
  });
  const show = (d: Omit<Decision, "move">) =>
    render(
      <MemoryRouter>
        <DecisionView d={d} players={2} />
      </MemoryRouter>,
    );

  it("heads a prize-equity EV in what it's in, and never bb", () => {
    show(dec(prov({ evIn: "prize", tournament: "prize-equity solve (ICM)" }), true, true));
    expect(screen.getByRole("columnheader", { name: "EV bb of prize equity" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "EV bb" })).toBeNull();
  });

  it("gives a push/fold answer no EV column, and calls it the model", () => {
    show(dec(prov({ source: "push-fold", approximate: true }), false, false));
    expect(screen.queryByRole("columnheader", { name: /^EV/ })).toBeNull();
    expect(screen.getByText(/Graded by how often the push\/fold model plays your hand/)).toBeInTheDocument();
  });

  it("gives a fallback's chips in a prize session no EV column either", () => {
    show(dec(prov({ source: "rules", approximate: true, evIn: "chips" }), false, false));
    expect(screen.queryByRole("columnheader", { name: /^EV/ })).toBeNull();
  });

  it("copies the unit for an AI", () => {
    const text = reviewedText({ n: 1, seat: "SB", players: 2, hole: ["Ah", "Kd"], board: ["Ks", "7d", "2c"], line: "", d: { ...dec(prov({ evIn: "prize", tournament: "prize-equity solve (ICM)" }), true, true), move: mv("SB", "bet", 3.75), study: "p=2&s=20&b=Ks7d2c" } as Decision });
    expect(text).toContain("bb of prize equity");
  });

  it("shows a tournament's score without a net", () => {
    const s = { ...freshSession(3, 20, { ...OPTS, tournament: ICM }), hands: 3, net: 5 };
    render(<ScoreStrip session={s} acc={1} loss={0.1} lossPct={2} />);
    expect(screen.queryByText(/^Net/)).toBeNull();
  });
});

describe("the one Room", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const r of rooms) r.stop();
    rooms = [];
    vi.useRealTimers();
  });
  const call: PlayMove = { pos: "", action: "call", name: "call", freq: 1 };

  it("plays a push/fold hand to its end, graded under the model", async () => {
    const { client, states } = stubClient((s) => (s.board ? { street: "flop", actions: [] } : JAM), () => call);
    const r = room(client);
    r.startSession(2, 12, { ...OPTS, seat: "SB", pushFold: true });
    r.start();
    await until(() => !!r.snapshot().tables[0]!.answer);
    expect(states[0]).toMatchObject({ stack: 12, hero: "SB" });
    r.choose(1);
    expect(r.snapshot().tables[0]!.last).toMatchObject({ chose: "all-in", provenance: { source: "push-fold" }, grade: { byEv: false } });
    await until(() => !!r.snapshot().tables[0]!.hand.result);
    const s = r.snapshot().session;
    expect(s.hands).toBe(1);
    expect(s.sources).toEqual({ "push-fold": 1 });
    expect(s.score.ne).toBe(0);
  });

  it("deals each hand of a tournament from the session's stacks", async () => {
    const fold: PlayMove = { pos: "", action: "fold", name: "fold", freq: 1 };
    const short: AdvisorResponse = { street: "preflop", pot_bb: 1.5, tournament: TOURNEY, notes: [TOURNEY.note], actions: [{ action: "fold", freq: 1 }, { action: "raise 2.5", freq: 0, amount_bb: 2.5 }] };
    const { client, states } = stubClient(() => short, () => fold);
    const r = room(client);
    r.startSession(3, 20, { ...OPTS, seat: "BTN", tournament: ICM });
    r.start();
    await until(() => !!r.snapshot().tables[0]!.answer);
    expect(states[0]).toMatchObject({ payouts: [50, 30, 20], stacks: STACKS });
    r.choose(1);
    await until(() => !!r.snapshot().tables[0]!.hand.result);
    r.nextHand();
    await until(() => states.length > 1);
    expect(states.at(-1)).toMatchObject({ stacks: STACKS });
    expect(r.snapshot().session.net).toBeGreaterThan(0); // (kept, as a hand's chips are; shown nowhere and in no total)
  });

  it("deals any hand above one table, whatever Spots says, and keeps the game", async () => {
    const { useSettings } = await import("@/state/settings");
    useSettings.setState({ practiceSpot: "srp" });
    const { client } = stubClient(() => JAM, () => call);
    const r = room(client);
    r.startSession(2, 12, { ...OPTS, pushFold: true });
    r.start();
    r.setTables(2);
    const hands = r.snapshot().tables.map((t) => t.hand);
    expect(hands).toHaveLength(2);
    for (const h of hands) {
      expect(h.pushFold).toBe(true);
      expect(h.pot).toBeUndefined();
    }
    useSettings.setState({ practiceSpot: null });
  });
});

