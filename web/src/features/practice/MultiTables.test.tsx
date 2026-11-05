// Practice above one table as you see it, on a stubbed solver: the row above the score, the tiles, the dock, the rail, the
// phone's tabs and the keys, each drawn from a real Room. multitable.test.js's view is here: `:68` changed, as your hand
// becomes Table 1; `:366`; and `:534` changed, since your hand's request is still wanted then, so what's stopped is a run-out
// nobody plays above one table. What the Room decides is room.test.ts's. Layout isn't here, as jsdom draws no Tailwind, past the classes that hold it still.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { kvGet, kvSet, putSession } from "@/data/db";
import { addHands } from "@/data/hands";
import { classOf } from "@/engine/nlhe/cards";
import { emptyTally } from "@/features/history/history";
import { handName, rank7 } from "@/poker/evaluate";
import { noLines, type Lines, type Move } from "@/poker/table";
import { SolverClient } from "@/solver/client";
import { HttpTransport } from "@/solver/http-transport";
import { describe as describeProvenance } from "@/solver/provenance";
import { useRuntime } from "@/solver/runtime";
import type { AdvisorResponse, AdvisorState, PlayMove } from "@/solver/protocol";
import { SolverError, type PlayRequest, type Provenance, type SolveResult, type StopCost } from "@/solver/types";
import { DEFAULT_SETTINGS, useSettings } from "@/state/settings";
import index from "@/library/fixtures/srp_btn_bb.flops.json";
import { KEPT_KEY } from "./keep";
import { decide, DRILL_TRIES, newHand, type Decision, type HandOptions, type HandResult, type PracticeHand } from "./practice";
import { PracticePage } from "./PracticePage";
import { reviewed } from "./review";
import type { RoomClient } from "./room";
import { freshSession } from "./session";
import { resultLine, verdictLine } from "./TableTile";

const CHARTS: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 };
const LIVE: Provenance = { ...CHARTS, source: "live", approximate: false, exploitabilityPct: 1.2 };

const CHART: AdvisorResponse = {
  street: "preflop",
  pot_bb: 1.5,
  actions: [
    { action: "fold", freq: 0.1 },
    { action: "call", freq: 0.3 },
    { action: "raise 2.5", amount_bb: 2.5, freq: 0.6 },
  ],
};
/** BB bet into you, your options in the order an answer may give them. */
const facing = (...order: ("fold" | "call")[]): AdvisorResponse => ({
  street: "flop",
  pot_bb: 8.5,
  recommended: "call",
  actions: order.map((action) => ({ action, freq: action === "call" ? 0.8 : 0.2, ev_bb: action === "call" ? 0.6 : 0 })),
});
/** BB checked to you: checking gives up 0.41bb, 7.5% of the pot. */
const CHECKED: AdvisorResponse = {
  street: "flop",
  pot_bb: 5.5,
  recommended: "bet 33%",
  actions: [
    { action: "bet 33%", amount_bb: 1.8, freq: 0.95, ev_bb: 1 },
    { action: "check", freq: 0.05, ev_bb: 0.59 },
  ],
};

// the solver stubbed: your spots and each move as the test says, held at a gate while the test looks
const stub = vi.hoisted(() => {
  const s = {
    calls: [] as string[],
    advice: null as null | ((q: AdvisorState) => AdvisorResponse),
    move: null as null | ((p: PlayRequest) => Partial<PlayMove> | Promise<Partial<PlayMove>>),
    prov: null as unknown as Provenance,
    gate: null as null | Promise<void>,
    stop: "cheap" as StopCost,
    client: null as unknown,
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const fake = {
    stopCost: () => s.stop,
    solve: async ({ state }: { state: AdvisorState }): Promise<SolveResult> => {
      s.calls.push(`advise ${state.hero}`);
      await s.gate;
      return { data: s.advice!(state), provenance: s.prov };
    },
    play: async (_: AdvisorState, p: PlayRequest): Promise<SolveResult<Partial<PlayMove>>> => {
      s.calls.push(`play ${p.seat}`);
      await s.gate;
      return { data: await s.move!(p), provenance: s.prov };
    },
  };
  s.getSolver = async () => s.client ?? fake;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));
vi.mock("@/data/hands", async (orig) => {
  const hands = await orig<typeof import("@/data/hands")>();
  return { ...hands, addHands: vi.fn(hands.addHands) };
});

/** Hold every request here until the function it gives back is called. */
function hold() {
  let open = () => {};
  stub.gate = new Promise((r) => {
    open = r;
  });
  return () => {
    stub.gate = null;
    open();
  };
}

const OPTS: Required<HandOptions> = { seat: "moves", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };
const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });
const SRP = [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call")];
/** A hand at a spot: your seat, the line to it, the cards out. `seed` is its cards and its number. */
const spot = (seed: number, hero: string, lines: Partial<Lines> = {}, shown = 0): PracticeHand => ({
  ...newHand(6, 100, seed, seed, { ...OPTS, seat: hero }),
  lines: { ...noLines(), ...lines },
  shown,
});
const betInto = (seed: number) => spot(seed, "BTN", { preflop: SRP, flop: [mv("BB", "bet", 3)] }, 3);
const checkedTo = (seed: number) => spot(seed, "BTN", { preflop: SRP, flop: [mv("BB", "check")] }, 3);
/** BB's move on the flop first: asked behind your spot at another table, as the solver answers yours first. */
const theirMove = (seed: number) => spot(seed, "BTN", { preflop: SRP }, 3);
/** Checked to you on the river: your check is a showdown. */
const river = (seed: number) =>
  spot(seed, "BTN", { preflop: SRP, flop: [mv("BB", "check"), mv("BTN", "check")], turn: [mv("BB", "check"), mv("BTN", "check")], river: [mv("BB", "check")] }, 5);
const youFirst = (seed: number) => spot(seed, "UTG");

const place = (hand: PracticeHand, o: object = {}) => ({ hand, stats: emptyTally(), last: null, lastHand: null, ...o });
const doc = (hands: PracticeHand[], o: { session?: object; places?: object[]; focus?: number } = {}) => ({
  v: 1,
  n: hands.length,
  focus: o.focus ?? 0,
  session: { ...freshSession(6, 100, OPTS), dealt: 99, tables: hands.length, ...o.session },
  tables: [0, 1, 2, 3].map((i) => (hands[i] ? place(hands[i]!, o.places?.[i]) : null)),
});
const holeOf = (h: PracticeHand) => h.hands[h.hero]!.join("");
/** The hand you made on the flop, as a tile's foot says it. */
const madeOn = (h: PracticeHand) => handName(rank7([...h.hands[h.hero]!, ...h.board.slice(0, 3)]));
/** The answer at each hand, by your cards. */
const byHand = (...xs: [PracticeHand, AdvisorResponse][]) => (q: AdvisorState) => (xs.find(([h]) => holeOf(h) === q.hole) ?? [null, CHART])[1];

const page = (o: { pause?: number; guard?: number } = {}) =>
  render(
    <MemoryRouter>
      <PracticePage pace={0} pause={o.pause ?? 1e7} guard={o.guard ?? 0} />
    </MemoryRouter>,
  );

/** The page opened on the doc, as far as its first request. */
async function open(d: unknown, o: { pause?: number; guard?: number } = {}) {
  await kvSet(KEPT_KEY, d);
  page(o);
  await act(() => vi.waitFor(() => expect(stub.calls.length).toBeGreaterThan(0)));
}

/** The page dealt on load, and `n` tables asked for: your hand is Table 1's. */
async function atTables(n: number, o: { pause?: number; guard?: number } = {}) {
  page(o);
  await screen.findByRole("group", { name: "Your options" });
  fireEvent.click(screen.getByRole("radio", { name: String(n) }));
  await screen.findByRole("region", { name: `Table ${n}` });
}

const tile = (i: number) => screen.getByRole("region", { name: `Table ${i}` });
const cardsAt = (i: number) => cardsIn(within(tile(i)).getByRole("group", { name: "Your cards" }));
const dock = () => screen.getByRole("region", { name: "Your move" });
const key = (k: string, target: Element | Window = window, o: object = {}) => fireEvent.keyDown(target, { key: k, ...o });
const ready = () => screen.findByRole("group", { name: "Your options" });
const cardsIn = (el: HTMLElement) => within(el).getAllByRole("img").map((c) => c.getAttribute("aria-label"));
const tablesRow = (i: number) => within(screen.getByRole("region", { name: "Tables' results" })).getByRole("listitem", { name: `Table ${i}` });

beforeEach(() => {
  stub.prov = LIVE;
  stub.advice = () => CHART;
  stub.move = () => ({ action: "fold" });
  // (what these tests deal by: Instant flops has its own below)
  useSettings.setState({ loaded: true, practiceSpot: "any" });
});

afterEach(async () => {
  stub.calls = [];
  stub.gate = null;
  stub.stop = "cheap";
  stub.client = null;
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  await kvSet(KEPT_KEY, null);
  useSettings.setState({ loaded: false, mode: "fast", keepHands: false, practiceSpot: null, practiceSeat: "random", askAhead: null });
});

describe("Tables (multitable.test.js:68)", () => {
  it("is one table's page at 1, with no Spots or Seat; above it your hand is Table 1's and each table has its own; back at 1 that hand goes on", async () => {
    useSettings.setState({ practiceSeat: "UTG" });
    page();
    await ready();
    expect(screen.getAllByRole("radio", { name: /^[1-4]$/ }).map((r) => r.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(screen.getByRole("radio", { name: "1" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("combobox", { name: "Spots" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Seat" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Tables" })).toBeNull();
    expect(screen.queryByText(/Not here yet/)).toBeNull();
    expect(screen.queryByText(/Spots and Seat apply/)).toBeNull();
    expect(screen.getByRole("form", { name: "New session" }).closest("details")).toBeNull();
    const yours = () => cardsIn(within(screen.getByRole("region", { name: "Table" })).getByRole("listitem", { name: "BTN (you)" }));
    const cards = yours();

    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    await screen.findByRole("region", { name: "Table 3" });
    expect(screen.getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("region", { name: "Table" })).toBeNull();
    const hands = [1, 2, 3].map(cardsAt);
    expect(hands[0]).toEqual(cards);
    expect(new Set(hands.map(String)).size).toBe(3);
    expect(within(tile(2)).getByRole("button", { name: /^Table 2 · #\d+ · UTG$/ })).toBeInTheDocument();
    // the rest of the setup folds under Game
    const game = screen.getByRole("form", { name: "New session" }).closest("details")!;
    expect(within(game).getByText("Game")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "1" }));
    await screen.findByRole("region", { name: "Table" });
    expect(screen.queryByRole("region", { name: "Table 1" })).toBeNull();
    expect(yours()).toEqual(cards);
    expect(screen.getByRole("form", { name: "New session" }).closest("details")).toBeNull();
  });

  it("restarts every table on a New session", async () => {
    await atTables(3);
    const before = [1, 2, 3].map(cardsAt);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    await waitFor(() => expect(within(tile(3)).getByRole("button", { name: /^Table 3 · #3 · / })).toBeInTheDocument());
    expect(within(tile(1)).getByRole("button", { name: /^Table 1 · #1 · / })).toBeInTheDocument();
    expect([1, 2, 3].map(cardsAt)).not.toEqual(before);
    expect(screen.getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");
  });

  it("takes focus off a button that's done to the dock: a change of Tables, New session, a tile, a tab", async () => {
    page();
    await ready();
    const head = () => within(dock()).getByRole("heading");
    const press = (b: HTMLElement) => {
      b.focus();
      fireEvent.click(b);
    };

    press(screen.getByRole("radio", { name: "3" }));
    await screen.findByRole("region", { name: "Table 3" });
    await waitFor(() => expect(document.activeElement).toBe(head()));

    // (Enter would start every table again, with no confirm)
    const fresh = screen.getByRole("button", { name: "New session" });
    press(fresh);
    await waitFor(() => expect(within(tile(3)).getByRole("button", { name: /^Table 3 · #3 · / })).toBeInTheDocument());
    expect(document.activeElement).toBe(head());
    expect(head()).toHaveAttribute("tabindex", "-1");

    press(within(tile(2)).getByRole("button", { name: /^Table 2/ }));
    expect(document.activeElement).toBe(head());
    press(screen.getByRole("tab", { name: /^Table 3/ }));
    expect(document.activeElement).toBe(head());

    press(screen.getByRole("radio", { name: "4" }));
    await screen.findByRole("region", { name: "Table 4" });
    await waitFor(() => expect(document.activeElement).toBe(head()));
  });

  it("takes you to the dock and the tables from New session with a changed setup, which remakes the form you pressed in", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await atTables(2);
    scroll.mockClear();
    const form = screen.getByRole("form", { name: "New session" });
    fireEvent.change(within(form).getByRole("spinbutton", { name: "Stack in big blinds" }), { target: { value: "150" } });
    const fresh = within(form).getByRole("button", { name: "New session" });
    fresh.focus();
    fireEvent.click(fresh);
    await waitFor(() => expect(document.activeElement).toBe(within(dock()).getByRole("heading")));
    expect(fresh.isConnected).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("leaves focus and the page alone as tables come back by themselves, whatever had focus", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    hold();
    await kvSet(KEPT_KEY, doc([youFirst(1), youFirst(2)]));
    render(
      <MemoryRouter>
        <a href="#out">Practice</a>
        <PracticePage pace={0} pause={1e7} guard={0} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Practice" });
    link.focus();
    await screen.findByRole("region", { name: "Table 2" });
    await act(async () => {});
    expect(document.activeElement).toBe(link);
    expect(scroll).not.toHaveBeenCalled();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("keeps what you've typed in the setup as the tables go above one and back, in the one form", async () => {
    page();
    await ready();
    const form = () => screen.getByRole("form", { name: "New session" });
    const stack = () => screen.getByRole("spinbutton", { name: "Stack in big blinds" });
    fireEvent.change(stack(), { target: { value: "150" } });
    const field = stack();
    expect(form().closest("details")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await screen.findByRole("region", { name: "Table 2" });
    expect(stack()).toBe(field);
    expect(stack()).toHaveValue(150);
    expect(form().closest("details")).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "1" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Table 2" })).toBeNull());
    expect(stack()).toHaveValue(150);
    expect(form().closest("details")).toBeNull();
  });

  it("says what it is opponents play by, above one table and at one", async () => {
    page();
    await ready();
    expect(screen.queryByText(/GTO opponents/)).toBeNull();
    expect(screen.getByText(/from the charts preflop, then the solver.s mix, or betting rules on a flop or turn with five or more still in/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await screen.findByRole("region", { name: "Table 2" });
    expect(screen.queryByText(/GTO opponents/)).toBeNull();
    expect(screen.getByText(/Opponents play the charts preflop, then the solver, or betting rules on a flop or turn with five or more still in/)).toBeInTheDocument();
  });

  it("says at one table what will answer your spot, not that a chart is being solved", async () => {
    hold();
    page();
    fireEvent.change(screen.getByRole("combobox", { name: "Players" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(await screen.findByText(/^Reading the chart so your move can be graded…/)).toBeInTheDocument();
    expect(screen.queryByText(/Solving your spot/)).toBeNull();
  });

  it("takes focus from nowhere on a reload, and off a field Enter started a session from", async () => {
    hold();
    await open(doc([youFirst(1), youFirst(2)]));
    expect(document.activeElement).toBe(document.body);

    const field = screen.getByRole("spinbutton", { name: "Ante" });
    field.focus();
    fireEvent.submit(screen.getByRole("form", { name: "New session" }));
    await waitFor(() => expect(document.activeElement).toBe(within(dock()).getByRole("heading")));
  });

  it("says what Game's settings do above one table, and only there", async () => {
    page();
    await ready();
    expect(screen.queryByText(/Above one table Spots and Seat decide/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await screen.findByRole("region", { name: "Table 2" });
    const game = screen.getByRole("form", { name: "New session" }).closest("details")!;
    expect(within(game).getByText(/Above one table Spots and Seat decide what.s dealt, so Your seat, Play.s kinds of pot and Carry chips here wait until you.re back at one table\. Preflop only still counts\./)).toBeInTheDocument();
  });
});

describe("the view (multitable.test.js:366)", () => {
  const hands = [betInto(1), youFirst(2), spot(3, "BB", { preflop: SRP }, 3), spot(4, "SB")];

  it("says what each table is doing while nobody waits for you", async () => {
    hold();
    await open(doc(hands));
    expect(dock()).toHaveTextContent("No table needs you yet: working on 4 tables.");
    expect(dock()).toHaveTextContent("Table 1 · Solving your spot…");
    expect(tile(1)).toHaveTextContent("Solving your spot…");
    expect(tile(2)).toHaveTextContent("Reading the chart…");
    expect(tile(4)).toHaveTextContent("UTG is thinking…");
    // said in words on a phone's tab too, with a dot or a spinner each
    expect(screen.getByRole("tab", { name: "Table 4: UTG is thinking…" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Table 1: Solving your spot…" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("radio", { name: "4" })).toHaveAttribute("aria-checked", "true");
  });

  it("says a chart or the betting rules are being read where one of those will answer, not that a spot is being solved", async () => {
    const calls = (...ps: string[]) => ps.map((p) => mv(p, "call"));
    const limped = [mv("UTG", "fold"), ...calls("HJ", "CO", "BTN", "SB"), mv("BB", "check")];
    const fourWay = [mv("UTG", "fold"), mv("HJ", "fold"), ...calls("CO", "BTN", "SB"), mv("BB", "check")];
    const round = ["SB", "BB", "HJ", "CO", "BTN"].map((p) => mv(p, "check"));
    hold();
    await open(doc([spot(1, "SB", { preflop: limped }, 3), spot(2, "SB", { preflop: limped, flop: round }, 4), spot(3, "SB", { preflop: limped, flop: round, turn: round }, 5), spot(4, "SB", { preflop: fourWay }, 3)]));
    // (five still in: flop and turn are the rules, the river is solved, and so is a flop at four or fewer)
    expect(tile(1)).toHaveTextContent("Reading the betting rules…");
    expect(tile(2)).toHaveTextContent("Reading the betting rules…");
    expect(tile(3)).toHaveTextContent("Solving your spot…");
    expect(tile(4)).toHaveTextContent("Solving your spot…");
    expect(dock()).toHaveTextContent("Table 1 · Reading the betting rules…");
    expect(tile(1)).not.toHaveTextContent("Solving");
  });

  it("draws the table in front whole, with the dock, the tabs, Spots and Seat, and a row a table with its source", async () => {
    stub.advice = byHand([hands[0]!, facing("fold", "call")]);
    await open(doc(hands, { places: [{ stats: { ...emptyTally(), hands: 3, n: 4, ok: 3, ne: 2, loss: 0.5, played: 3, net: 2.5 }, sources: { live: 4 } }] }));
    const first = await within(tile(1)).findByText("Your turn");
    fireEvent.click(within(tile(1)).getByRole("button", { name: "Table 1 · #2 · BTN" }));
    await ready();

    const t = tile(1);
    expect(first).toBeInTheDocument();
    expect(t).toHaveAttribute("aria-current", "true");
    expect(t.className).toMatch(/ring-accent/);
    for (const i of [2, 3, 4]) expect(tile(i)).not.toHaveAttribute("aria-current");
    // a waiting table's edge is amber, in words too
    expect(tile(2).className).toMatch(/border-warn/);
    expect(cardsAt(1)).toHaveLength(2);
    expect(within(t).getAllByRole("listitem")).toHaveLength(6);
    expect(within(t).getByRole("listitem", { name: "BTN (you)" })).toBeInTheDocument();
    expect(within(t).getByRole("listitem", { name: "BTN (you)" })).toHaveAttribute("aria-current", "true");
    expect(within(t).getByRole("listitem", { name: "BB" })).toHaveTextContent("bet 3");
    expect(within(t).getByRole("listitem", { name: "SB" })).toHaveTextContent("folded");
    expect(t).toHaveTextContent("Pot 8.5bb");
    expect(t).toHaveTextContent(madeOn(hands[0]!));
    expect(tile(2)).not.toHaveTextContent(/pair|high card|two pair|straight|flush/i);

    expect(within(dock()).getByRole("heading")).toHaveTextContent("Table 1 · your turn · BTN · flop · pot 8.5bb");
    expect(within(within(dock()).getByRole("group", { name: "Your options" })).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("fold"), expect.stringContaining("call")]);

    expect(screen.getAllByRole("tab", { name: /^Table \d: / })).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Table 1: Your turn" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Table 1: Your turn" })).toHaveAttribute("aria-controls", t.id);

    expect(screen.getByRole("combobox", { name: "Spots" })).toHaveValue("any");
    expect(screen.getByRole("combobox", { name: "Seat" })).toHaveValue("random");
    expect(screen.getByText(/Preflop is answered from the charts, not solved/)).toHaveTextContent("later streets are read from the library or solved while you play the other tables");

    const row = tablesRow(1);
    expect(row).toHaveTextContent("3 hands");
    expect(row).toHaveTextContent("75% best or correct");
    expect(row).toHaveTextContent("0.25bb lost a decision");
    expect(row).toHaveTextContent("net +2.5bb");
    expect(row).toHaveTextContent("Graded against: Live solve 4");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(tablesRow(2)).not.toHaveTextContent("Graded against");
    expect(tablesRow(2)).not.toHaveTextContent(/best or correct|lost a decision|net|NaN/);
    expect(screen.getByText(/Each decision is graded here once you act/)).toBeInTheDocument();
  });

  it("shows a queue's places, and a table you've picked says who's waiting (Go, S)", async () => {
    await open(doc([youFirst(1), youFirst(2), youFirst(3)]));
    await within(tile(3)).findByTitle("Your place in the queue");
    expect(screen.getByRole("tab", { name: "Table 3: Your turn" })).toBeInTheDocument();
    expect(within(tile(1)).getByTitle("Your place in the queue")).toHaveTextContent("1");
    expect(within(tile(2)).getByTitle("Your place in the queue")).toHaveTextContent("2");
    expect(dock()).toHaveTextContent("2 more waiting · S next table · F fold · C or X check or call · 1–3 your options");
    expect(dock()).not.toHaveTextContent("is waiting for you");
    // a tab's number, its dot, and its place
    const tab = screen.getByRole("tab", { name: "Table 3: Your turn" });
    expect(tab).toHaveTextContent(/^33$/);
    expect(tab.querySelector(".bg-warn")).not.toBeNull();
  });

  it("takes a tab as a pick, and marks each state on it", async () => {
    stub.move = () => new Promise(() => {});
    await open(doc([youFirst(1), theirMove(2)]));
    await ready();
    const thinking = screen.getByRole("tab", { name: "Table 2: BB is thinking…" });
    expect(thinking).toHaveTextContent(/^2$/);
    expect(thinking.querySelector(".animate-pulse")).not.toBeNull();
    fireEvent.click(thinking);
    await waitFor(() => expect(tile(2)).toHaveAttribute("aria-current", "true"));
    expect(screen.getByRole("tab", { name: "Table 2: BB is thinking…" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Table 1: Your turn" })).toHaveAttribute("aria-selected", "false");
  });

  it("says who the solver is on, and when nobody's left to ask", async () => {
    stub.move = () => new Promise(() => {});
    const hand = betInto(1);
    stub.advice = byHand([hand, facing("fold", "call")]);
    await open(doc([hand, theirMove(2)]));
    fireEvent.click(within(await ready()).getByRole("button", { name: /fold/i }));
    await waitFor(() => expect(dock()).toHaveTextContent("No table needs you yet: working on 1 table."));
    cleanup();

    const a = betInto(3);
    const b = betInto(4);
    stub.advice = byHand([a, facing("fold", "call")], [b, facing("fold", "call")]);
    await open(doc([a, b]));
    await ready();
    await waitFor(() => expect(screen.getAllByTitle("Your place in the queue")).toHaveLength(2));
    key("f");
    await waitFor(() => expect(tile(1)).toHaveTextContent(/You folded/));
    key("f");
    await waitFor(() => expect(dock()).toHaveTextContent("Dealing the next hands…"));
    expect(dock()).not.toHaveTextContent("No table needs you");
  });

  it("sticks the phone's tabs as long as the tables go on: they're in the wrapper that holds tiles and dock, not one of their own", async () => {
    hold();
    await open(doc([youFirst(1), youFirst(2)]));
    const tabs = screen.getByRole("tablist", { name: "Tables" });
    expect(tabs.className).toMatch(/\bsticky\b/);
    expect(tabs.className).toMatch(/sm:hidden/);
    expect(tabs.parentElement).toContainElement(dock());
    expect(tabs.parentElement).toContainElement(tile(2));
  });

  it("holds a tile's height whatever its hand: each row kept to its line, and the foot there with nothing in it", async () => {
    hold();
    await open(doc([youFirst(1), betInto(2)]));
    for (const i of [1, 2]) {
      const t = tile(i);
      const foot = t.lastElementChild!;
      expect(foot.className).toMatch(/sm:min-h-17/);
      expect(within(t).getByRole("list", { name: "Seats" }).className).toMatch(/sm:grid-cols-2/);
      for (const chip of within(t).getAllByRole("listitem")) {
        expect(chip.className).toMatch(/sm:h-6/);
        expect(chip.className).toMatch(/whitespace-nowrap/);
      }
      expect(within(t).getByRole("group", { name: "Board" }).parentElement!.className).toMatch(/sm:flex-nowrap/);
      expect(within(t).getByText("Pot").parentElement!.className).toMatch(/whitespace-nowrap/);
      expect(within(t).getByRole("button", { name: new RegExp(`^Table ${i}`) }).parentElement!.className).toMatch(/sm:flex-nowrap/);
      expect(within(t).getByTitle(/…$/).className).toMatch(/sm:truncate/);
    }
    expect(tile(1).lastElementChild).toHaveTextContent(/^$/);
  });

  it("puts a failure in the foot, not above the board, and a shown hand in a seat's stack's place", async () => {
    const hand = river(1);
    const failing = betInto(2);
    stub.advice = byHand([hand, { street: "river", actions: [{ action: "check", freq: 1, ev_bb: 0 }] }], [failing, { error: "no such node" }]);
    await open(doc([hand, failing]));
    const says = await within(tile(2)).findByRole("alert");
    expect(tile(2).lastElementChild).toContainElement(says);

    fireEvent.click(within(await ready()).getByRole("button", { name: /check/i }));
    const bb = () => within(tile(1)).getByRole("listitem", { name: "BB" });
    await waitFor(() => expect(bb().querySelectorAll('[role="img"]')).toHaveLength(2));
    expect(bb().querySelector(".text-muted")).toBeNull();
    for (const c of bb().querySelectorAll('[role="img"]')) {
      expect(c.className).toMatch(/\bh-4\b/);
      expect(c.className).not.toMatch(/flex-col/);
    }
  });

  it("deals a finished table again by itself after the pause", async () => {
    const hand = betInto(1);
    stub.advice = byHand([hand, facing("fold", "call")]);
    await open(doc([hand, theirMove(2)]), { pause: 10 });
    fireEvent.click(within(await ready()).getByRole("button", { name: /fold/i }));
    await waitFor(() => expect(within(tile(1)).getByRole("button", { name: /^Table 1 · #1\d\d · / })).toBeInTheDocument());
  });

  it("shows what a showdown showed: the cards, and who won what", async () => {
    const hand = river(1);
    stub.advice = byHand([hand, { street: "river", actions: [{ action: "check", freq: 1, ev_bb: 0 }] }]);
    await open(doc([hand, theirMove(2)]));
    expect(within(tile(1)).queryByText(/^won /)).toBeNull();
    fireEvent.click(within(await ready()).getByRole("button", { name: /check/i }));
    await waitFor(() => expect(within(tile(1)).getByRole("listitem", { name: "BB" }).querySelectorAll('[role="img"]')).toHaveLength(2));
    expect(within(tile(1)).getAllByText(/^won /).length).toBeGreaterThan(0);
    expect(within(tile(1)).getByRole("listitem", { name: "SB" }).querySelectorAll('[role="img"]')).toHaveLength(0);
  });

  it("offers Go where the table you picked isn't waiting", async () => {
    stub.move = () => new Promise(() => {});
    await open(doc([youFirst(1), theirMove(2)]));
    await ready();
    // (alone in the queue, it has no place to say)
    expect(screen.queryByTitle("Your place in the queue")).toBeNull();
    fireEvent.click(tile(2));
    await waitFor(() => expect(within(dock()).getByRole("heading")).toHaveTextContent("Table 2 · BB is thinking…"));
    expect(dock()).toHaveTextContent("Table 1 is waiting for you · Go (S)");
    fireEvent.click(within(dock()).getByRole("button", { name: "Go (S)" }));
    await waitFor(() => expect(within(dock()).getByRole("heading")).toHaveTextContent("Table 1 · your turn"));
  });

  it("dims a drill still being dealt, and says what it's dealing", async () => {
    useSettings.setState({ practiceSpot: "srp" });
    hold();
    const seek = { ...spot(1, "BTN"), pot: "srp" as const };
    await open(doc([youFirst(2), seek], { session: { dealt: 9 } }));
    expect(tile(2)).toHaveTextContent("Dealing a single-raised pot…");
    expect(tile(2).className).toMatch(/opacity-60/);
  });
});

describe("the dock", () => {
  it("tells a screen reader only your turn and a failure, with the table's number, not the whole dock at each change", async () => {
    const go = hold();
    await open(doc([betInto(1), theirMove(2)]));
    expect(dock()).not.toHaveAttribute("aria-live");
    const said = document.querySelector('p.sr-only[role="status"]')!;
    expect(said).toHaveAttribute("aria-atomic", "true");
    expect(said).toBeEmptyDOMElement();
    stub.advice = byHand([betInto(1), facing("fold", "call")]);
    go();
    await ready();
    expect(said).toHaveTextContent(/^Table 1: your turn, flop, pot 8\.5bb$/);
  });

  it("says where your turn is, as the next at the same table can be ready at once, and a line that's the same isn't read out", async () => {
    const first = betInto(1);
    const second = checkedTo(2);
    stub.advice = byHand([first, facing("fold", "call")], [second, CHECKED]);
    stub.move = () => ({ action: "check" });
    await open(doc([first, second]));
    fireEvent.click(within(await ready()).getByRole("button", { name: /fold/i }));
    const said = document.querySelector('p.sr-only[role="status"]')!;
    await waitFor(() => expect(said).toHaveTextContent(/^Table 2: your turn, flop, pot 5\.5bb$/));
    fireEvent.click(within(await ready()).getByRole("button", { name: /check/i }));
    await waitFor(() => expect(said).toHaveTextContent(/^Table 2: your turn, turn, pot 5\.5bb$/));
  });

  it("says when a table behind yours comes up, as one you've picked stays in front while it thinks", async () => {
    let free = () => {};
    stub.gate = new Promise((r) => {
      free = r;
    });
    await open(doc([betInto(1), betInto(2)]));
    fireEvent.click(tile(2));
    const said = document.querySelector('p.sr-only[role="status"]')!;
    expect(said).toBeEmptyDOMElement();
    stub.advice = byHand([betInto(1), facing("fold", "call")]);
    // (the request out is Table 1's, and Table 2's goes on being held)
    stub.gate = new Promise(() => {});
    free();
    await waitFor(() => expect(said).toHaveTextContent(/^Table 1: your turn$/));
    expect(within(dock()).getByRole("heading")).toHaveTextContent(/^Table 2 ·/);
  });

  it("says that after a failure in front of it", async () => {
    const other = betInto(1);
    const bad = betInto(2);
    const go = hold();
    await open(doc([other, bad]));
    fireEvent.click(tile(2));
    stub.advice = (q) => (q.hole === holeOf(bad) ? { error: "no such node" } : facing("fold", "call"));
    go();
    await waitFor(() => expect(document.querySelector('p.sr-only[role="status"]')).toHaveTextContent(/^Table 2: No answer to grade this spot against: no such node\. Table 1: your turn$/));
  });

  it("tells it what failed, at which table", async () => {
    stub.advice = () => ({ error: "no such node" });
    await open(doc([betInto(1), betInto(2)]));
    await within(tile(1)).findByRole("alert");
    expect(document.querySelector('p.sr-only[role="status"]')).toHaveTextContent(/^Table 1: No answer to grade this spot against: no such node$/);
  });

  it("holds its hint to a line below `sm`: what's waiting, and the keys only where there are keys", async () => {
    stub.advice = byHand([betInto(1), facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    await open(doc([betInto(1), betInto(2)]));
    await ready();
    const keys = within(dock()).getByText(/F fold/);
    expect(keys.tagName).toBe("SPAN");
    expect(keys.className).toBe("hidden sm:inline");
    expect(keys.parentElement!.className).toMatch(/min-h-4/);
    await waitFor(() => expect(keys.parentElement).toHaveTextContent(/^1 more waiting · S next table · F fold/));
  });

  it("answers for the table it names", async () => {
    const hand = checkedTo(1);
    stub.advice = byHand([hand, CHECKED]);
    await open(doc([hand, theirMove(2)]));
    const options = await ready();
    fireEvent.click(within(options).getByRole("button", { name: /Bet 33%/i }));
    await waitFor(() => expect(tile(1)).toHaveTextContent(/Best · flop · bet 33% · no EV lost · Live solve \(Quick\)/));
  });

  it("guards a table that came forward by itself", async () => {
    const hand = checkedTo(1);
    stub.advice = byHand([hand, CHECKED]);
    // (on a clock held still, as a real 200 ms can be over before a busy machine gets to look: the guard ends when this says)
    let now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    onTestFinished(() => clock.mockRestore());
    await open(doc([hand, theirMove(2)]), { guard: 200 });
    const options = await ready();
    expect(options).toHaveAttribute("aria-disabled", "true");
    expect(options.className).toMatch(/opacity-50/);
    fireEvent.click(within(options).getAllByRole("button")[0]!);
    key("1");
    expect(within(tile(1)).queryByText(/Best · flop/)).toBeNull();
    now += 199;
    key("1");
    expect(within(tile(1)).queryByText(/Best · flop/)).toBeNull();
    expect(options).toHaveAttribute("aria-disabled", "true");
    now += 1;
    // (nothing is pressed: the Room's own timer tells the page)
    await waitFor(() => expect(screen.getByRole("group", { name: "Your options" })).not.toHaveAttribute("aria-disabled"), { timeout: 4000 });
    expect(screen.getByRole("group", { name: "Your options" }).className).not.toMatch(/opacity-50/);
    fireEvent.click(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")[0]!);
    await waitFor(() => expect(tile(1)).toHaveTextContent("Best · flop"));
  });

  it("offers no Run it out, at a hand you've folded either", async () => {
    const hand = betInto(1);
    stub.advice = byHand([hand, facing("fold", "call")]);
    await open(doc([hand, theirMove(2)]));
    const options = await ready();
    expect(tile(1)).toHaveTextContent(madeOn(hand));
    fireEvent.click(within(options).getAllByRole("button")[0]!);
    await waitFor(() => expect(tile(1)).toHaveTextContent(/You folded/));
    expect(screen.queryByRole("button", { name: /Run it out|Show hands/i })).toBeNull();
    // (and no hand you threw away is called yours)
    expect(tile(1)).not.toHaveTextContent(madeOn(hand));
  });

  it("numbers the first nine options, and takes no key past them", async () => {
    const hand = checkedTo(1);
    const sizes = [5, 10, 15, 20, 25, 33, 50, 66, 75, 100];
    stub.advice = byHand([hand, { street: "flop", pot_bb: 5.5, actions: sizes.map((n) => ({ action: `bet ${n}%`, amount_bb: (n * 5.5) / 100, freq: 0.1, ev_bb: 0 })) }]);
    await open(doc([hand, theirMove(2)]));
    const buttons = within(await ready()).getAllByRole("button");
    expect(buttons).toHaveLength(10);
    expect(buttons[8]!.textContent).toMatch(/^9/);
    expect(buttons[9]!.textContent).toMatch(/^bet/);
    expect(dock()).toHaveTextContent("1–9 your options");
  });
});

describe("the keys", () => {
  /** Tables at your spots, each with its answer, in front in turn. (Dealt from under the gun, a next hand waits for you:
   * in the big blind the others' folds could end it with you unasked.) */
  async function spots(...xs: [PracticeHand, AdvisorResponse][]) {
    useSettings.setState({ practiceSeat: "UTG" });
    stub.advice = byHand(...xs);
    await open(doc(xs.map(([h]) => h)));
    await ready();
    await waitFor(() => expect(screen.getAllByTitle("Your place in the queue")).toHaveLength(xs.length));
  }
  const line = (i: number) => within(tile(i)).getByTitle(describeProvenance(LIVE));

  it("takes 1–9 by place and F, C and X by what the option is, whichever order they came in", async () => {
    await spots([betInto(1), facing("call", "fold")], [betInto(2), facing("fold", "call")], [checkedTo(3), CHECKED], [checkedTo(4), CHECKED]);
    key("f");
    await waitFor(() => expect(line(1)).toHaveTextContent("flop · fold ·"));
    key("c");
    await waitFor(() => expect(line(2)).toHaveTextContent("flop · call ·"));
    key("x");
    await waitFor(() => expect(line(3)).toHaveTextContent("flop · check ·"));
    key("1");
    await waitFor(() => expect(line(4)).toHaveTextContent("flop · bet 33% ·"));
  });

  it("takes C on a check, and F, 9 nothing where there's no such option", async () => {
    await spots([checkedTo(1), CHECKED], [betInto(2), facing("fold", "call")]);
    key("f");
    key("9");
    expect(within(tile(1)).queryByTitle(describeProvenance(LIVE))).toBeNull();
    expect(within(tile(1)).queryByRole("alert")).toBeNull();
    key("c");
    await waitFor(() => expect(line(1)).toHaveTextContent("flop · check ·"));
  });

  it("takes C where the call comes first", async () => {
    await spots([betInto(1), facing("call", "fold")], [betInto(2), facing("fold", "call")]);
    key("c");
    await waitFor(() => expect(line(1)).toHaveTextContent("flop · call ·"));
  });

  it("moves to the next waiting table on S, this one to the back", async () => {
    await spots([betInto(1), facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    expect(tile(1)).toHaveAttribute("aria-current", "true");
    key("s");
    await waitFor(() => expect(tile(2)).toHaveAttribute("aria-current", "true"));
    expect(within(tile(2)).getByTitle("Your place in the queue")).toHaveTextContent("1");
    expect(within(tile(1)).getByTitle("Your place in the queue")).toHaveTextContent("2");
  });

  it("deals finished tables now on Enter or Space, not on a focused control's own", async () => {
    const a = betInto(1);
    const b = betInto(2);
    await spots([a, facing("fold", "call")], [b, facing("fold", "call")]);
    // (nothing finished: Space doesn't scroll the page out from under the tiles; `key` says false where a key's default was stopped)
    expect(key(" ")).toBe(false);
    expect(key(" ", document.body)).toBe(false);
    expect(within(tile(1)).queryByText(/You folded/)).toBeNull();
    key("f");
    await waitFor(() => expect(tile(1)).toHaveTextContent(/You folded/));
    // (on a button, Enter and Space are that button's)
    expect(key("Enter", within(tile(1)).getByRole("button", { name: /^Table 1/ }))).toBe(true);
    expect(key(" ", within(tile(1)).getByRole("button", { name: /^Table 1/ }))).toBe(true);
    expect(key(" ", screen.getByText("Game"))).toBe(true);
    expect(tile(1)).toHaveTextContent(/You folded/);
    expect(key("Enter")).toBe(false);
    await waitFor(() => expect(tile(1)).not.toHaveTextContent(/You folded/));

    key("f");
    await waitFor(() => expect(tile(2)).toHaveTextContent(/You folded/));
    expect(key(" ")).toBe(false);
    await waitFor(() => expect(tile(2)).not.toHaveTextContent(/You folded/));
  });

  it("keeps the last finished hand on K, after its table has dealt the next, and not twice", async () => {
    const a = betInto(1);
    await spots([a, facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    expect(screen.queryByRole("region", { name: "Last finished hand" })).toBeNull();
    key("f");
    await waitFor(() => expect(tile(1)).toHaveTextContent(/You folded/));
    key("Enter");
    await waitFor(() => expect(tile(1)).not.toHaveTextContent(/You folded/));

    const last = screen.getByRole("region", { name: "Last finished hand" });
    expect(last).toHaveTextContent(`Last finished: Table 1 · #${a.n + 1} · You folded`);
    key("k");
    await within(screen.getByRole("region", { name: "Last finished hand" })).findByText(/Kept in Analyze/);
    key("k");
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("region", { name: "Last finished hand" })).toHaveTextContent(/^.*Kept in Analyze/);
    expect(screen.getByRole("region", { name: "Last finished hand" })).not.toHaveTextContent("Already kept");

    // the next hand to finish is the one on offer, its own
    key("f");
    await waitFor(() => expect(screen.getByRole("region", { name: "Last finished hand" })).toHaveTextContent("Last finished: Table 2"));
    expect(within(screen.getByRole("region", { name: "Last finished hand" })).getByRole("button", { name: "Keep in Analyze" })).toBeInTheDocument();
  });

  it("tries K again where keeping failed", async () => {
    await spots([betInto(1), facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    key("f");
    await screen.findByRole("region", { name: "Last finished hand" });
    vi.mocked(addHands).mockRejectedValueOnce(new Error("quota"));
    key("k");
    await within(screen.getByRole("region", { name: "Last finished hand" })).findByText("Not kept: quota");
    key("k");
    await within(screen.getByRole("region", { name: "Last finished hand" })).findByText(/Kept in Analyze/);
  });

  it("keeps the hand on offer when you turn on Keep every hand", async () => {
    await spots([betInto(1), facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    key("f");
    const last = await screen.findByRole("region", { name: "Last finished hand" });
    fireEvent.click(within(last).getByRole("checkbox", { name: "Keep every hand" }));
    await within(screen.getByRole("region", { name: "Last finished hand" })).findByText(/Kept in Analyze/);
    expect(useSettings.getState().keepHands).toBe(true);
    // (on a checkbox the page's keys don't work, and Space would turn it off again)
    expect(document.activeElement).toBe(within(dock()).getByRole("heading"));
  });

  it("gives Enter back to the tables once a pick is done, not to the button that picked", async () => {
    await spots([betInto(1), facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    key("f");
    await waitFor(() => expect(tile(1)).toHaveTextContent(/You folded/));
    const pick = within(tile(1)).getByRole("button", { name: /^Table 1/ });
    pick.focus();
    fireEvent.click(pick);
    expect(document.activeElement).toBe(within(dock()).getByRole("heading"));
    expect(key("Enter", document.activeElement!)).toBe(false);
    await waitFor(() => expect(tile(1)).not.toHaveTextContent(/You folded/));
  });

  it("leaves a key alone with a modifier held, held down, or typed in a field", async () => {
    await spots([betInto(1), facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    key("f", window, { metaKey: true });
    key("f", window, { ctrlKey: true });
    key("f", window, { altKey: true });
    key("f", window, { repeat: true });
    key("f", screen.getByRole("combobox", { name: "Spots" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(tile(1)).not.toHaveTextContent(/You folded/);
  });

  it("takes no key while the Drills tab shows", async () => {
    await spots([betInto(1), facing("fold", "call")], [betInto(2), facing("fold", "call")]);
    fireEvent.click(screen.getByRole("tab", { name: /Drills/ }));
    await screen.findByRole("tab", { name: /Drills/, selected: true });
    key("f");
    key("s");
    fireEvent.click(screen.getByRole("tab", { name: /Hands|Full hands/ }));
    await screen.findByRole("group", { name: "Your options" });
    expect(tile(1)).not.toHaveTextContent(/You folded/);
    expect(tile(1)).toHaveAttribute("aria-current", "true");
    key("f");
    await waitFor(() => expect(tile(1)).toHaveTextContent(/You folded/));
  });
});

describe("what graded the figures", () => {
  it("says what graded a table's figures weren't kept, where the doc's couldn't be read, not that nothing was graded", async () => {
    hold();
    await open(doc([youFirst(1), youFirst(2)], { places: [{ stats: { ...emptyTally(), hands: 3, n: 4, ok: 3, played: 3 }, sources: "x" }, { stats: { ...emptyTally(), hands: 3 } }] }));
    expect(tablesRow(1)).toHaveTextContent("Graded against: Not kept: played before Lizard kept what graded each decision");
    expect(tablesRow(1)).not.toHaveTextContent("No decision graded");
    expect(tablesRow(2)).not.toHaveTextContent("Graded against");
  });

  it("says it under the score once a decision is graded, the line held before that above one table, and a table's row at its first finished hand", async () => {
    const hand = betInto(1);
    stub.advice = byHand([hand, facing("fold", "call")]);
    stub.move = () => new Promise(() => {});
    await open(doc([hand, theirMove(2)]));
    const score = screen.getByRole("region", { name: "Score" });
    const held = score.querySelector("p")!;
    expect(held.className).toMatch(/min-h-8/);
    expect(held).toHaveTextContent(/^$/);

    // (mid-hand: your decision's in the score, and not yet in the table's row, which counts finished hands)
    fireEvent.click(within(await ready()).getByRole("button", { name: /call/i }));
    await waitFor(() => expect(score).toHaveTextContent("Graded against: Live solve 1"));
    expect(score).toHaveTextContent(/Decisions graded\s*1/);
    expect(tablesRow(1)).not.toHaveTextContent("Graded against");
  });

  it("says it at one table too, once there's a figure, with no line held before that", async () => {
    page();
    await ready();
    const score = screen.getByRole("region", { name: "Score" });
    expect(score.querySelector("p")).toBeNull();
    fireEvent.click(within(await ready()).getAllByRole("button")[0]!);
    await waitFor(() => expect(score).toHaveTextContent("Graded against: Live solve 1"));
    expect(score.querySelector("p")!.className).not.toMatch(/min-h-8/);
  });

  it("says it on a past session's row, where one has a figure to read", async () => {
    const past = { kind: "practice" as const, evLossBb: 1, meta: { hands: 3, ok: 3, graded: 2, net: 1 } };
    // (dated ahead of the sessions these tests have left behind)
    const ahead = Date.now() + 1e6;
    await putSession({ ...past, id: "kept", startedAt: ahead + 2, decisions: 4, meta: { ...past.meta, sources: { live: 3, charts: 1 } } });
    await putSession({ ...past, id: "older", startedAt: ahead + 1, decisions: 4 });
    await putSession({ ...past, id: "none", startedAt: ahead, decisions: 0 });
    page();
    const rows = within(await screen.findByRole("region", { name: "Past sessions" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Graded against: Live solve 3, Preflop charts (approximate) 1");
    expect(rows[0]).toHaveTextContent("75% best or correct");
    expect(rows[1]).toHaveTextContent("Graded against: Not kept: played before Lizard kept what graded each decision");
    expect(rows[2]).not.toHaveTextContent("Graded against");
  });
});

describe("your verdict", () => {
  it("is on the tile's foot with what answered, all of it in the tooltip, and in the rail across the tables", async () => {
    const hand = checkedTo(1);
    stub.advice = byHand([hand, CHECKED]);
    await open(doc([hand, theirMove(2)]));
    const options = await ready();
    fireEvent.click(within(options).getByRole("button", { name: /check/i }));
    const foot = await within(tile(1)).findByText("Mistake · flop · check · −0.41bb · Live solve (Quick)");
    expect(foot).toHaveAttribute("title", describeProvenance(LIVE));
    const rail = screen.getByRole("region", { name: `Table 1, hand ${hand.n + 1}, flop` });
    expect(rail).toHaveTextContent("Mistake");
    const review = screen.getByRole("region", { name: "Your decisions" });
    expect(review).toHaveTextContent(`T1 #${hand.n + 1} flop`);
  });

  it("is the hand's last decision on the tile", async () => {
    const dealt = youFirst(1);
    const first = decide(dealt, CHART, 2, CHARTS);
    const hand = checkedTo(2);
    const then = decide(hand, CHECKED, 1, LIVE);
    if ("error" in first || "error" in then) throw new Error("no decision");
    hold();
    await open(doc([{ ...hand, decisions: [first.decision, then.decision] }, youFirst(3)]));
    expect(tile(1)).toHaveTextContent("Mistake · flop · check");
    expect(tile(1)).not.toHaveTextContent("raise 2.5");
  });

  it("draws your whole range under the rail's decision, as the answer plays it", async () => {
    stub.prov = CHARTS;
    stub.advice = (q) => ({ ...CHART, grid: { actions: ["fold", "call", "raise 2.5"], cells: { [classOf(q.hole!)]: { w: 1, f: [0.1, 0.2, 0.7] } } } });
    await open(doc([youFirst(1), theirMove(2)]));
    fireEvent.click(within(await ready()).getByRole("button", { name: /raise 2.5/ }));
    const rail = await screen.findByRole("region", { name: /^Table 1, hand 2, preflop$/ });
    expect(within(rail).getByText(/^Your range · preflop · UTG/)).toBeInTheDocument();
  });

  it("carries ≈ where the answer is approximate, by frequency with no EVs, and says when nothing graded it", () => {
    const h = youFirst(1);
    const r = decide(h, CHART, 2, CHARTS);
    if ("error" in r) throw new Error(r.error);
    expect(verdictLine(r.decision)).toEqual({ text: "Best · preflop · raise 2.5 · by frequency · ≈ Preflop charts", title: describeProvenance(CHARTS) });
    expect(verdictLine({ ...r.decision, provenance: null })).toEqual({ text: "Best · preflop · raise 2.5 · by frequency · Unlabelled" });
    expect(verdictLine({ ...r.decision, grade: null, provenance: null })).toEqual({ text: "Not graded · preflop · raise 2.5" });
    const g = r.decision.grade!;
    expect(verdictLine({ ...r.decision, grade: { ...g, byEv: true, loss: 0.004 } }).text).toContain("· no EV lost ·");
    expect(verdictLine({ ...r.decision, grade: { ...g, byEv: true, loss: 0.006 } }).text).toContain("· −0.01bb ·");
  });

  it("is one line under the phone's tabs, with what answered, opening the whole decision", async () => {
    const hand = checkedTo(1);
    stub.advice = byHand([hand, CHECKED]);
    await open(doc([hand, theirMove(2)]));
    const options = await ready();
    fireEvent.click(within(options).getByRole("button", { name: /check/i }));
    const line = await screen.findByRole("button", { name: "Mistake · flop · check · −0.41bb · Live solve (Quick)" });
    expect(line).toHaveAttribute("aria-expanded", "false");
    const decision = `Table 1, hand ${hand.n + 1}, flop`;
    expect(screen.getAllByRole("region", { name: decision })).toHaveLength(1);
    fireEvent.click(line);
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("region", { name: decision })).toHaveLength(2);
  });

  it("marks a verdict from one table as dimmed once the front is waiting", async () => {
    const a = checkedTo(1);
    const b = checkedTo(2);
    stub.advice = byHand([a, CHECKED], [b, CHECKED]);
    await open(doc([a, b]));
    await ready();
    await waitFor(() => expect(screen.getAllByTitle("Your place in the queue")).toHaveLength(2));
    key("1");
    await within(tile(1)).findByText(/flop · bet 33%/);
    const rail = screen.getByRole("region", { name: `Table 1, hand ${a.n + 1}, flop` });
    expect(rail.parentElement!.className).toMatch(/opacity-60/);
    key("1");
    await within(tile(2)).findByText(/flop · bet 33%/);
    const now = screen.getByRole("region", { name: `Table 2, hand ${b.n + 1}, flop` });
    await waitFor(() => expect(now.parentElement!.className).not.toMatch(/opacity-60/));
  });
});

describe("a failed table", () => {
  it("puts what went wrong in place of the foot's lines, three at most from `sm`, all of it in the tooltip", async () => {
    const hand = betInto(1);
    stub.advice = () => ({ error: "no such node" });
    await open(doc([hand, betInto(2)]));
    const says = await within(tile(1)).findByRole("alert");
    const words = within(says).getByText(/No answer to grade this spot against/);
    expect(words).toHaveAttribute("title", "No answer to grade this spot against: no such node");
    expect(words.className).toMatch(/sm:line-clamp-3/);
    expect(within(says).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(tile(1)).queryByText(madeOn(hand))).toBeNull();
    expect(says.parentElement!.className).toMatch(/sm:min-h-17/);
    // (its neighbour, where nothing's wrong, as it was)
    expect(within(tile(2)).queryByRole("alert")).not.toBeNull();
  });

  it("stays back with the error and Retry; picked, the dock offers Ask again and moves without a grade", async () => {
    const hand = betInto(1);
    stub.advice = byHand([hand, { error: "no such node" }]);
    await open(doc([hand, youFirst(2)]));
    const says = await within(tile(1)).findByRole("alert");
    expect(says).toHaveTextContent("No answer to grade this spot against: no such node");
    expect(tile(1).className).toMatch(/border-danger/);
    expect(screen.getByRole("tab", { name: /^Table 1: No answer/ })).toBeInTheDocument();
    // a failed table doesn't come forward by itself
    expect(tile(2)).toHaveAttribute("aria-current", "true");
    expect(within(dock()).queryByRole("group", { name: "Moves without a grade" })).toBeNull();

    fireEvent.click(tile(1));
    expect(within(dock()).getByRole("group", { name: "Moves without a grade" })).toBeInTheDocument();
    expect(within(dock()).queryByRole("button", { name: /^Play on/ })).toBeNull();

    // asked again from the dock
    stub.calls = [];
    fireEvent.click(within(dock()).getByRole("button", { name: "Ask again" }));
    await waitFor(() => expect(stub.calls).toContain("advise BTN"));
    await within(tile(1)).findByRole("alert");

    // and from the tile, the table in front staying in front
    fireEvent.click(within(tile(2)).getByRole("button", { name: /^Table 2/ }));
    stub.advice = byHand([hand, facing("fold", "call")]);
    fireEvent.click(within(within(tile(1)).getByRole("alert")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(tile(1)).queryByRole("alert")).toBeNull());
    expect(tile(2)).toHaveAttribute("aria-current", "true");
  });

  it("plays your move without a grade, and marks it so", async () => {
    const hand = betInto(1);
    stub.advice = byHand([hand, { error: "no such node" }]);
    await open(doc([hand, theirMove(2)]));
    await within(tile(1)).findByRole("alert");
    fireEvent.click(within(within(dock()).getByRole("group", { name: "Moves without a grade" })).getByRole("button", { name: "fold" }));
    await within(tile(1)).findByText("Not graded · flop · fold");
    expect(screen.queryByRole("region", { name: "Your decisions" })).toBeNull();
  });

  it("offers Play on where an opponent's move failed, labelled, and never as a decision of yours", async () => {
    stub.move = () => ({ error: "no such node" });
    await open(doc([theirMove(1), theirMove(2)]));
    const says = await within(tile(1)).findByRole("alert");
    expect(says).toHaveTextContent("BB's move failed: no such node");
    expect(within(dock()).queryByRole("group", { name: "Moves without a grade" })).toBeNull();
    expect(within(dock()).getByRole("button", { name: "Ask again" })).toBeInTheDocument();
    expect(dock()).not.toHaveTextContent(/No table needs you|Dealing the next/);
    stub.move = () => ({ action: "fold" });
    fireEvent.click(within(dock()).getByRole("button", { name: "Play on: BB checks or calls (not a solve)" }));
    await waitFor(() => expect(within(tile(1)).queryByRole("alert")).toBeNull());
    expect(within(tile(1)).queryByText(/Not graded/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Your decisions" })).toBeNull();
  });

  it("says a drill's deals are used up, and deals afresh on Try again", async () => {
    useSettings.setState({ practiceSpot: "srp" });
    await open(doc([youFirst(1), { ...spot(2, "BTN"), pot: "srp", tries: DRILL_TRIES - 1 }]));
    const says = await within(tile(2)).findByRole("alert");
    expect(says).toHaveTextContent(`No single-raised pot in ${DRILL_TRIES} deals.`);
    expect(tile(2).className).toMatch(/border-danger/);
    expect(screen.getByRole("tab", { name: /^Table 2: No single-raised pot/ }).querySelector(".bg-danger")).not.toBeNull();
    fireEvent.click(tile(2));
    await waitFor(() => expect(tile(2)).toHaveAttribute("aria-current", "true"));
    stub.move = () => new Promise(() => {});
    fireEvent.click(within(dock()).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(tile(2)).queryByRole("alert")).toBeNull());
  });

  it("says where a table's hand couldn't be brought back, and draws its last hand", async () => {
    const bad: PracticeHand = { ...youFirst(1), board: ["Zz", "Yy", "Xx", "Ww", "Vv"] };
    const lastHand = { n: 6, net: -3, seat: "UTG", result: { net: -3, folded: false, says: "BB had the flush.", winners: ["BB"], pays: { BB: 6 } } };
    hold();
    await open(doc([bad, youFirst(2)], { places: [{ lastHand }] }));
    expect(within(tile(1)).getByRole("alert")).toHaveTextContent("couldn't be brought back");
    const row = within(tablesRow(1)).getByText(/^Last hand:/);
    expect(row).toHaveTextContent("Last hand: #7 · UTG · You lose −3bb");
    expect(row).toHaveAttribute("title", "BB had the flush.");
  });
});

describe("a reload", () => {
  it("draws the tables it brought back with their number, whatever the session began with, and the review across them", async () => {
    const hand = checkedTo(1);
    const r = decide(hand, CHECKED, 1, LIVE);
    if ("error" in r) throw new Error(r.error);
    const entry = reviewed(hand, r.decision as Decision, 7, 2);
    hold();
    await open(doc([youFirst(1), youFirst(2), youFirst(3)], { session: { review: [entry] } }));
    expect(screen.getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("region", { name: "Table 3" })).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Your decisions" });
    expect(review).toHaveTextContent("T2 #7 flop");
    expect(screen.getAllByRole("region", { name: "Table 2, hand 7, flop" })).toHaveLength(1);
    fireEvent.click(within(review).getByRole("button", { name: /T2 #7 flop/ }));
    expect(screen.getAllByRole("region", { name: "Table 2, hand 7, flop" })).toHaveLength(2);
  });

  it("marks a decision from before there were tables as Table 1's", async () => {
    const hand = checkedTo(1);
    const r = decide(hand, CHECKED, 1, LIVE);
    if ("error" in r) throw new Error(r.error);
    hold();
    await open(doc([youFirst(1), youFirst(2)], { session: { review: [reviewed(hand, r.decision as Decision, 7)] } }));
    expect(screen.getByRole("region", { name: "Table 1, hand 7, flop" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Your decisions" })).toHaveTextContent(/#7 flop/);
    expect(screen.getByRole("region", { name: "Your decisions" })).not.toHaveTextContent("T1");
  });
});

describe("Spots and Seat", () => {
  it("apply from a table's next hand, and never redeal", async () => {
    useSettings.setState({ practiceSeat: "UTG" });
    await atTables(2);
    const cards = () => [1, 2].map(cardsAt);
    const before = cards();
    fireEvent.change(screen.getByRole("combobox", { name: "Seat" }), { target: { value: "CO" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Spots" }), { target: { value: "srp" } });
    expect(useSettings.getState()).toMatchObject({ practiceSeat: "CO", practiceSpot: "srp" });
    expect(cards()).toEqual(before);
    expect(screen.getByText(/Each table is dealt until a single-raised pot/)).toHaveTextContent("Preflop is played for you from the charts, not solved.");
    expect(screen.getByText(/Spots and Seat apply from each table/)).toBeInTheDocument();

    // (held, or the stub's folds would see the new table through 400 deals of its drill)
    hold();
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    await screen.findByRole("region", { name: "Table 3" });
    expect(within(tile(3)).getByRole("button", { name: /^Table 3 · #\d+ · CO$/ })).toBeInTheDocument();
  });

  it("offers only the blinds at blind vs blind, a seat that's gone reading Random", async () => {
    useSettings.setState({ practiceSeat: "CO" });
    await atTables(2);
    fireEvent.change(screen.getByRole("combobox", { name: "Spots" }), { target: { value: "bvb" } });
    const seat = screen.getByRole("combobox", { name: "Seat" });
    expect(seat).toHaveValue("random");
    expect(within(seat).getByRole("option", { name: "UTG" })).toBeDisabled();
    expect(within(seat).getByRole("option", { name: "SB" })).toBeEnabled();
    expect(within(seat).getByRole("option", { name: "BB" })).toBeEnabled();
    expect(within(seat).getByRole("option", { name: "Random" })).toBeEnabled();
  });

  it("give focus back once set: on a select the page's keys don't work, and the next is type-ahead", async () => {
    await atTables(2);
    for (const [name, value] of [["Spots", "srp"], ["Seat", "UTG"]] as const) {
      const box = screen.getByRole("combobox", { name });
      box.focus();
      fireEvent.change(box, { target: { value } });
      expect(document.activeElement).not.toBe(box);
    }
    expect(useSettings.getState()).toMatchObject({ practiceSpot: "srp", practiceSeat: "UTG" });
  });

  it("stay put on an arrow's step, which changes them at each press, and give focus back on Enter or Escape", async () => {
    await atTables(2);
    for (const [name, value, end] of [["Spots", "srp", "Enter"], ["Seat", "UTG", "Escape"]] as const) {
      const box = screen.getByRole("combobox", { name });
      box.focus();
      fireEvent.keyDown(box, { key: "ArrowDown" });
      fireEvent.change(box, { target: { value } });
      fireEvent.keyUp(box, { key: "ArrowDown" });
      expect(document.activeElement).toBe(box);
      fireEvent.keyDown(box, { key: end });
      fireEvent.keyUp(box, { key: end });
      expect(document.activeElement).not.toBe(box);
    }
    expect(useSettings.getState()).toMatchObject({ practiceSpot: "srp", practiceSeat: "UTG" });
  });

  it("give focus back a while after a letter's change, as nothing says you've done, and only another change puts that off", async () => {
    await atTables(2);
    const box = screen.getByRole("combobox", { name: "Seat" });
    box.focus();
    // (the page is up, so nothing's waiting on Testing Library's timers)
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const letter = (k: string, value?: string) => {
        fireEvent.keyDown(box, { key: k });
        if (value) fireEvent.change(box, { target: { value } });
        fireEvent.keyUp(box, { key: k });
      };
      const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));
      letter("c", "CO");
      pass(1499);
      expect(document.activeElement).toBe(box);
      letter("s", "SB");
      pass(1499);
      expect(document.activeElement).toBe(box);
      // (a key that changes nothing)
      letter("f");
      pass(1);
      expect(document.activeElement).not.toBe(box);
      expect(useSettings.getState().practiceSeat).toBe("SB");
    } finally {
      vi.useRealTimers();
    }
  });

  it("say what a table's later streets are, the betting rules among them, at Any hand", async () => {
    hold();
    await open(doc([youFirst(1), youFirst(2)]));
    expect(screen.getByText(/Preflop is answered from the charts, not solved/)).toHaveTextContent("a flop or turn with five or more players still in is answered by betting rules, not solved");
  });

  it("say a preflop-only session's table stops at the flop and the charts answer it, with no later street to speak of", async () => {
    hold();
    await open(doc([{ ...youFirst(1), preflopOnly: true }, { ...youFirst(2), preflopOnly: true }], { session: { opts: { ...OPTS, preflopOnly: true } } }));
    const note = screen.getByText(/Each table plays its preflop and stops as the flop comes\. The charts answer it, not a solve\./);
    expect(note).not.toHaveTextContent(/later streets/);
  });

  it("stays on Any hand in a preflop-only session, and says why", async () => {
    useSettings.setState({ practiceSpot: "srp" });
    hold();
    await open(doc([{ ...youFirst(1), preflopOnly: true }, { ...youFirst(2), preflopOnly: true }], { session: { opts: { ...OPTS, preflopOnly: true } } }));
    const spots = screen.getByRole("combobox", { name: "Spots" });
    expect(spots).toHaveValue("any");
    expect(within(spots).getByRole("option", { name: "Any hand" })).toBeEnabled();
    expect(within(spots).getByRole("option", { name: /single-raised/i })).toBeDisabled();
    expect(within(spots).getByRole("option", { name: "Instant flops" })).toBeDisabled();
    expect(screen.getByText(/Instant flops plays no preflop, so a preflop-only session stays on Any hand\. Nor can a pot drill: each plays your preflop for you\./)).toBeInTheDocument();
  });

  it("start at nothing chosen, read as Instant flops where it can be dealt, and Random", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ practiceSpot: null, practiceSeat: "random" });
  });

  it("go through Settings' save and back (pick)", async () => {
    useSettings.getState().set({ practiceSpot: "3bet", practiceSeat: "BB" });
    await waitFor(async () => expect(await kvGet("settings.v1")).toMatchObject({ practiceSpot: "3bet", practiceSeat: "BB" }));
    useSettings.setState({ practiceSpot: null, practiceSeat: "random" });
    await useSettings.getState().load();
    expect(useSettings.getState()).toMatchObject({ practiceSpot: "3bet", practiceSeat: "BB" });
  });
});

describe("where a stop can't be cheap", () => {
  it("says tables wait for a solve to finish, from the client, before any worker has answered", async () => {
    stub.stop = "kills";
    hold();
    await open(doc([youFirst(1), youFirst(2)]));
    expect(await screen.findByText(/This browser can't stop a solve: tables wait for it to finish\./)).toBeInTheDocument();
  });

  it("says nothing where a stop is cheap, or at one table", async () => {
    hold();
    await open(doc([youFirst(1), youFirst(2)]));
    expect(await screen.findByText(/Spots and Seat apply/)).toBeInTheDocument();
    expect(screen.queryByText(/can't stop a solve/)).toBeNull();
  });
});

describe("Asking ahead", () => {
  const box = () => screen.getByRole("checkbox", { name: "Ask ahead" });
  const WHY = /this browser can.t stop a solve, so a wrong guess would hold up your next answer/i;
  const METER = /measured in this browser/;

  it("starts at nothing chosen, read as the measured default", () => {
    expect(DEFAULT_SETTINGS.askAhead).toBeNull();
  });

  it.each([true, false])("goes through Settings' save and back at %s (pick)", async (askAhead) => {
    useSettings.getState().set({ askAhead });
    await waitFor(async () => expect(await kvGet("settings.v1")).toMatchObject({ askAhead }));
    useSettings.setState({ askAhead: null });
    await useSettings.getState().load();
    expect(useSettings.getState().askAhead).toBe(askAhead);
  });

  it("says a rare one can run on, not that nothing long is asked", async () => {
    page();
    await ready();
    const title = box().closest("label")!.title;
    expect(title).toMatch(/Only what should be quick is asked ahead, though a rare one can run on until you move/);
    expect(title).not.toMatch(/Nothing long/);
  });

  it("says it's off on this page once a stop has ended the worker, as the box still reads as you left it", async () => {
    let n = 0;
    stub.advice = () => {
      n += 1;
      if (n === 1) throw new SolverError("stuck", "The solver stopped answering; it restarts on the next request.");
      return CHECKED;
    };
    useSettings.setState({ askAhead: true });
    await open(doc([checkedTo(1), checkedTo(2)]));
    expect(await screen.findByText(/Off on this page: the solver didn.t answer a stop and had to restart/)).toBeInTheDocument();
    expect(box()).toBeChecked();
    await ready();
    expect(stub.calls).not.toContain("play BB");
  });

  it("is a box by the mode picker at one table and several, on until you say, which gives focus back", async () => {
    page();
    await ready();
    expect(box()).toBeEnabled();
    expect(box()).toBeChecked();
    box().focus();
    fireEvent.click(box());
    expect(useSettings.getState().askAhead).toBe(false);
    expect(box()).not.toBeChecked();
    expect(box()).not.toHaveFocus();

    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await screen.findByRole("region", { name: "Table 2" });
    expect(box()).not.toBeChecked();
    fireEvent.click(box());
    expect(useSettings.getState().askAhead).toBe(true);
    expect(box()).toBeChecked();
    expect(screen.queryByText(WHY)).toBeNull();
  });

  it("can't be had where a stop would end the solver, and says why in words, at one table and several, whatever Settings say", async () => {
    stub.stop = "kills";
    useSettings.setState({ askAhead: true });
    page();
    await ready();
    expect(box()).toBeDisabled();
    expect(box()).not.toBeChecked();
    expect(screen.getByText(WHY)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await screen.findByRole("region", { name: "Table 2" });
    expect(box()).toBeDisabled();
    expect(screen.getByText(WHY)).toBeInTheDocument();
    expect(useSettings.getState().askAhead).toBe(true);
    expect(screen.queryByText(METER)).toBeNull();
    // (no room kept for a meter that can't start)
    expect(document.querySelector("p.min-h-12:empty")).toBeNull();
  });

  it("shows no meter while it's off", async () => {
    stub.advice = () => CHECKED;
    useSettings.setState({ askAhead: false });
    await open(doc([checkedTo(1), checkedTo(2)]));
    await ready();
    expect(stub.calls).not.toContain("play BB");
    expect(screen.queryByText(METER)).toBeNull();
  });

  it("shows no meter on until it has run", async () => {
    stub.advice = () => CHECKED;
    useSettings.setState({ askAhead: true });
    const go = hold();
    await open(doc([checkedTo(1), checkedTo(2)]));
    expect(screen.queryByText(METER)).toBeNull();
    // (its room is kept, so the page stays put as it starts)
    expect(document.querySelector("p.min-h-12:empty")).not.toBeNull();
    go();
    expect(await screen.findByText(METER)).toBeInTheDocument();
  });

  it("says what it measured under the score, and goes on saying it once it's off", async () => {
    stub.advice = () => CHECKED;
    useSettings.setState({ askAhead: true });
    await open(doc([checkedTo(1), checkedTo(2)]));
    const line = await screen.findByText(METER);
    expect(line.textContent).toMatch(/^Asking ahead, measured in this browser since this page opened: 0 of \d postflop look-aheads used · about 0 s saved with no other table waiting, for \d+ s of solver time$/);
    expect(line.compareDocumentPosition(screen.getByRole("region", { name: "Your move" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // (your bet, its reply in hand)
    await waitFor(() => expect(stub.calls.filter((c) => c === "play BB").length).toBeGreaterThan(1));
    key("1");
    await waitFor(() => expect(screen.getByText(METER).textContent).toMatch(/: 1 of \d postflop/));

    act(() => useSettings.setState({ askAhead: false }));
    expect(screen.getByText(METER)).toBeInTheDocument();
  });
});

describe("going from one table to several (multitable.test.js:534, changed)", () => {
  it("stops what one table asked and no longer needs before the tables' first request, and 2 to 3 stops nothing", async () => {
    const fetched: string[] = [];
    let cancel = () => {};
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url).split("/").at(-1)!;
      fetched.push(u);
      if (u === "cancel") {
        cancel();
        return json({ ok: true });
      }
      if (u === "advise") return json(CHART);
      // the run-out's moves, the small blind's unanswered until it's stopped, as a server's answers {cancelled} then
      if ((JSON.parse(String(init?.body)) as { seat: string }).seat !== "SB") return json({ action: "fold" });
      return new Promise<Response>((r) => {
        cancel = () => r(json({ cancelled: true }));
      });
    }) as typeof fetch;
    stub.client = new SolverClient(new HttpTransport({ url: "http://127.0.0.1:1", fetchImpl }), "test") as RoomClient;
    // (what's stopped here is real: a look-ahead gives way to a real request at any number of tables)
    useSettings.setState({ askAhead: false });

    page();
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), { target: { value: "UTG" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    const options = await ready();
    fireEvent.click(within(options).getByRole("button", { name: /fold/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Run it out/i }));
    await waitFor(() => expect(fetched.filter((u) => u === "play").length).toBe(4));

    const at = fetched.length;
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    await waitFor(() => expect(fetched.slice(at)).toContain("cancel"));
    await waitFor(() => expect(fetched.slice(at).some((u) => u === "advise" || u === "play")).toBe(true));
    const after = fetched.slice(at);
    expect(after.indexOf("cancel")).toBeLessThan(after.findIndex((u) => u === "advise" || u === "play"));

    // 2 to 3 tables: nothing's stopped
    const then = fetched.length;
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    await screen.findByRole("region", { name: "Table 3" });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(fetched.slice(then)).not.toContain("cancel");
  });
});

describe("resultLine", () => {
  const r: HandResult = { net: 0, folded: false, says: "", winners: [], pays: {} };
  it.each<[string, object]>([
    ["You win +8.5bb", { net: 8.5 }],
    ["You lose −3bb", { net: -3 }],
    ["You break even", { net: 0 }],
    ["You folded −1bb", { net: -1, folded: true }],
    ["You folded", { net: 0, folded: true }],
    ["You see the flop", { cut: true }],
  ])("says %s", (text, o) => {
    expect(resultLine({ ...r, ...o })).toBe(text);
  });
});

describe("Instant flops", () => {
  /** The library's index as the page fetches it: `read` is what comes back. */
  const library = (read: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(read));
  const answers = (x: unknown = index) => async () => new Response(JSON.stringify(x));
  const select = () => screen.getByRole("combobox", { name: "Spots" });
  const option = () => within(select()).getByRole("option", { name: "Instant flops" });

  beforeEach(() => {
    useSettings.setState({ practiceSpot: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is first in Spots and what's dealt unless you choose, and says what it does; the drills stay", async () => {
    library(answers());
    await open(doc([betInto(1), betInto(2)]));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/index\.json$/), { cache: "no-cache" }));
    expect(within(select()).getAllByRole("option").map((o) => o.textContent)).toEqual(["Instant flops", "Any hand", "Single-raised pots", "3-bet pots", "Blind vs blind"]);
    expect(select()).toHaveValue("lib");
    await waitFor(() => expect(option()).toBeEnabled());
    expect(screen.getByText(/^Preflop is played for you from the charts, not solved\./)).toHaveTextContent(
      "Preflop is played for you from the charts, not solved. Each table is dealt until a heads-up flop the library holds. Flops answer at once; later streets are solved while you play the others. Spots and Seat apply from each table’s next hand.",
    );
    fireEvent.change(select(), { target: { value: "any" } });
    expect(useSettings.getState().practiceSpot).toBe("any");
    expect(select()).toHaveValue("any");
    fireEvent.change(select(), { target: { value: "lib" } });
    expect(useSettings.getState().practiceSpot).toBe("lib");
  });

  it("reads the index of the library the runtime resolved", async () => {
    useRuntime.setState({ librarySource: "gto-solver-library" });
    library(answers());
    await open(doc([betInto(1), betInto(2)]));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/gto-solver-library/index.json", { cache: "no-cache" }));
    useRuntime.setState({ librarySource: null });
  });

  it("says it's loading the flop library on a table waiting for the index", async () => {
    library(() => new Promise(() => {}));
    await open(doc([betInto(1), { ...spot(2, "BTN"), pot: "lib" }]));
    expect(tile(2)).toHaveTextContent("Loading the flop library…");
    expect(tile(2).className).toMatch(/opacity-60/);
  });

  it("says what it's dealing, once the index is in", async () => {
    hold();
    library(answers());
    await open(doc([betInto(1), { ...spot(2, "BTN"), pot: "lib", cands: [["UTG:f"]] }]));
    expect(tile(2)).toHaveTextContent("Dealing an instant flop…");
    // (its preflop isn't over, so there's nothing to label yet)
    expect(tile(2)).not.toHaveTextContent("not solved");
  });

  it("says what it's dealing at one table too, where a hand was left being dealt", async () => {
    hold();
    library(answers());
    await open(doc([{ ...spot(1, "BTN"), pot: "lib", cands: [["UTG:f"]] }, betInto(2)]));
    fireEvent.click(screen.getByRole("radio", { name: "1" }));
    expect(await screen.findByText(/Dealing an instant flop: the preflop is played for you/)).toBeInTheDocument();
  });

  it("is off where the library didn't load, says so in the note, and the table plays Any hand", async () => {
    library(async () => new Response("", { status: 404 }));
    await open(doc([betInto(1), { ...spot(2, "BTN"), pot: "lib" }]));
    await waitFor(() => expect(option()).toBeDisabled());
    expect(select()).toHaveValue("any");
    expect(within(select()).getByRole("option", { name: /single-raised/i })).toBeEnabled();
    expect(screen.getByText(/The flop library didn't load, so this is Any hand\./)).toBeInTheDocument();
    expect(tile(2)).not.toHaveTextContent(/flop library|instant flop/i);
  });

  it("is off on a game the library holds no spot of, and says so", async () => {
    library(answers({ spots: [index.spots[2]] }));
    await open(doc([betInto(1), betInto(2)]));
    await waitFor(() => expect(option()).toBeDisabled());
    expect(select()).toHaveValue("any");
    expect(screen.getByText(/Each table plays a whole hand/)).toHaveTextContent("Instant flops needs a game the flop library holds (Heads-up 100bb). This is 6-max 100bb, so you're playing Any hand.");
  });

  it("leaves a drill you've chosen on, and says Instant flops is off", async () => {
    useSettings.setState({ practiceSpot: "3bet" });
    library(async () => new Response("", { status: 404 }));
    await open(doc([betInto(1), betInto(2)]));
    await waitFor(() => expect(option()).toBeDisabled());
    expect(select()).toHaveValue("3bet");
    expect(screen.getByText(/The flop library didn't load, so Instant flops is off\./)).toBeInTheDocument();
  });

  it("fails at its table with Retry where no flop comes up at your seat", async () => {
    library(answers());
    useSettings.setState({ practiceSeat: "UTG" });
    await open(doc([betInto(1), { ...spot(2, "UTG"), pot: "lib", tries: DRILL_TRIES - 1, cands: [] }]));
    const says = await within(tile(2)).findByRole("alert");
    expect(says).toHaveTextContent("No instant flop in 400 deals at this seat: try another seat or spot.");
    expect(within(says).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("labels a preflop played for you as the charts', never solved, on the table, and only there", async () => {
    library(answers());
    hold();
    await open(doc([{ ...betInto(1), pot: "lib", cands: [] }, { ...betInto(2), pot: "srp" }, betInto(3)]));
    const label = "≈ Preflop from the charts, not solved";
    expect(within(tile(1)).getByText(label)).toBeInTheDocument();
    expect(within(tile(2)).getByText(label)).toBeInTheDocument();
    expect(within(tile(3)).queryByText(label)).toBeNull();
  });
});
