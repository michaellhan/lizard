// The drills panel on entries of the solver snapshot's library (src/test/library.ts), read through a stubbed fetch: a hand dealt, your
// pick graded against the stored answer with its provenance, the keys, the texture filter, the score kept.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { libFile } from "@/test/library";
import { recentSessions } from "@/data/db";
import { deleteDrill, listDrills, putDrill } from "@/data/saved";
import { LibraryFiles } from "@/library/files";
import { seeded } from "@/poker/table";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import type { SolveResult } from "@/solver/types";
import nodes from "@/test/fixtures/pf_nodes.json";
import { DrillsPanel } from "./DrillsPanel";

// (Any spot deals preflop and live spots too: the stored preflop solve's node is the engine's own, for the seat asked,
// and a live spot gets a converged answer)
type Req = { state: AdvisorState };
const stub = vi.hoisted(() => {
  const s = {
    asked: [] as Req[],
    solve: null as unknown as (req: Req) => Promise<SolveResult>,
    getSolver: async () => ({ solve: (req: Req) => (s.asked.push(req), s.solve(req)) }),
  };
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));
const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "abc", partial: false };
const FIRST = (nodes as unknown as Record<string, AdvisorResponse>).first!;
const LIVE: AdvisorResponse = {
  street: "river",
  pot_bb: 9.5,
  to_call_bb: 0,
  actions: [
    { action: "check", freq: 0.98, ev_bb: 3 },
    { action: "bet 75%", freq: 0.02, ev_bb: 1, amount_bb: 7 },
  ],
  solver: { iterations: 111, exploitability_pct: 0.63 },
};
stub.solve = async ({ state }) => {
  const data = state.preflop_solve ? { ...FIRST, actor: state.hero } : LIVE;
  return { data, provenance: provenanceOf(data, ctx) };
};
/** draws in this order, then 0 */
const scripted = (xs: number[]) => () => xs.shift() ?? 0;

const asked: string[] = [];
const fakeFetch = (async (url: string) => {
  const path = String(url).replace(/^lib\//, "").split("?")[0]!;
  asked.push(path);
  try {
    return new Response(new Uint8Array(libFile(path)));
  } catch {
    return new Response("missing", { status: 404 });
  }
}) as unknown as typeof fetch;

const open = (q: string) =>
  render(
    <MemoryRouter initialEntries={[`/practice?tab=drills&${q}`]}>
      <DrillsPanel files={new LibraryFiles("lib/", fakeFetch)} rng={seeded(3)} />
    </MemoryRouter>,
  );
/** the hand so far, a line a street and the last for now (each line's label and text run together) */
const told = () => within(screen.getByRole("list", { name: "The hand so far" })).getAllByRole("listitem").map((li) => li.textContent);
const suitOf = (img: HTMLElement) => img.getAttribute("aria-label")!.split(" of ")[1];

describe("DrillsPanel", () => {
  it("drills any spot by default: a spot and decision drawn each hand, one score over them, kept as an any-spot session", async () => {
    render(
      <MemoryRouter initialEntries={["/practice?tab=drills"]}>
        <DrillsPanel files={new LibraryFiles("lib/", fakeFetch)} rng={seeded(3)} />
      </MemoryRouter>,
    );
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByRole("combobox", { name: "Spot" })).toHaveDisplayValue("Any spot");
    expect(screen.queryByRole("combobox", { name: "Decision" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("list", { name: "The hand so far" })).toBeInTheDocument();
    fireEvent.click(within(options).getAllByRole("button")[0]!);
    const score = () => within(screen.getByRole("region", { name: "Score" }));
    expect(score().getByText("Decisions").nextSibling).toHaveTextContent(/^1$/);
    await waitFor(async () => expect((await recentSessions("drill")).some((s) => s.meta.spot === "any" && s.meta.label === "Any spot" && s.decisions === 1)).toBe(true));

    // the next hand keeps the score
    fireEvent.click(screen.getByRole("button", { name: /Next hand/ }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")[0]).toBeEnabled(), { timeout: 5000 });
    fireEvent.keyDown(window, { key: "1" });
    await screen.findByRole("region", { name: "Answer" }, { timeout: 5000 });
    expect(score().getByText("Decisions").nextSibling).toHaveTextContent(/^2$/);

    // the filters open from one button, and a texture set there is drawn
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Suits" }), { target: { value: "mono" } });
    expect(screen.getByRole("button", { name: /^Filters · 1/ })).toBeInTheDocument();
    // (a filter changed deals afresh)
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")[0]).toBeEnabled(), { timeout: 5000 });
    // (the flop's three: a turn dealt after it can be any suit)
    expect(new Set(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img").slice(0, 3).map(suitOf)).size).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: /^Filters/ }).textContent).not.toMatch(/·/);
  });

  it("any spot deals a stored turn too, its street named on the row you act on", async () => {
    // (the first spot, which stores turns; not preflop; a stored turn)
    render(
      <MemoryRouter initialEntries={["/practice?tab=drills"]}>
        <DrillsPanel files={new LibraryFiles("lib/", fakeFetch)} rng={scripted([0, 0.5, 0.1])} />
      </MemoryRouter>,
    );
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(4);
    expect(screen.getByText("BTN vs BB single-raised pot · BB first to act on the turn")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(/^Turnpot [\d.]+bb · BB to act · [\d.]+bb behind$/);
    expect(told()[1]).toMatch(/^Floppot 5\.5bb · /);
  });

  it("any spot deals preflop, graded by the stored preflop solve under its simplified model's label, kept by what graded it", async () => {
    // (the first spot; preflop; the line's first decision: UTG first in)
    render(
      <MemoryRouter initialEntries={["/practice?tab=drills"]}>
        <DrillsPanel files={new LibraryFiles("lib/", fakeFetch)} rng={() => 0} />
      </MemoryRouter>,
    );
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByText("Preflop · 6-max 100bb · graded by the preflop solve (a simplified model)")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Board" })).toBeNull();
    expect(told()).toEqual(["Prefloppot 1.5bb · UTG to act · 100bb behind"]);
    expect(within(options).getAllByRole("button").map((b) => b.textContent)).toEqual(["1raise to 2.5bb", "2fold"]);
    expect(stub.asked.at(-1)!.state).toMatchObject({ hero: "UTG", preflop: [], study: true, preflop_solve: true });
    fireEvent.click(within(options).getAllByRole("button")[1]!);
    const answer = await screen.findByRole("region", { name: "Answer" });
    expect(within(answer).getByText(/simplified class-level preflop game, not a full solve/)).toBeInTheDocument();
    expect(within(answer).getByText(/^The preflop solve /)).toBeInTheDocument();
    await waitFor(async () => expect((await recentSessions("drill")).some((s) => s.meta.spot === "any" && (s.meta.sources as Record<string, number>)?.["preflop-solve"] === 1)).toBe(true));
  });

  it("any spot deals a river, solved live, the turn said checked through", async () => {
    // (the first spot; not preflop; a river; out of position first)
    render(
      <MemoryRouter initialEntries={["/practice?tab=drills"]}>
        <DrillsPanel files={new LibraryFiles("lib/", fakeFetch)} rng={scripted([0, 0.5, 0.45, 0])} />
      </MemoryRouter>,
    );
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByText(/· BB first to act on the river · a live solve, some seconds$/)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(5);
    const rows = told();
    expect(rows.slice(0, 3).map((r) => r!.slice(0, 7))).toEqual(["Preflop", "Floppot", "Turnpot"]);
    expect(rows[2]).toMatch(/Checked through$/);
    expect(rows[3]).toMatch(/^Riverpot [\d.]+bb · BB to act · [\d.]+bb behind$/);
    fireEvent.click(within(options).getAllByRole("button")[0]!);
    await screen.findByRole("region", { name: "Answer" });
    await waitFor(async () => expect((await recentSessions("drill")).some((s) => s.meta.spot === "any" && (s.meta.sources as Record<string, number>)?.live === 1)).toBe(true));
  });

  it("says when no spot drawn has a flop under the filters", async () => {
    render(
      <MemoryRouter initialEntries={["/practice?tab=drills&pair=trips&suits=twotone&hand=m:quads"]}>
        <DrillsPanel files={new LibraryFiles("lib/", fakeFetch)} rng={seeded(3)} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/^None of \d+ spots drawn has a flop with these filters: widen one\./, undefined, { timeout: 10_000 })).toBeInTheDocument();
  });

  it("deals a hand at the spot's node, grades your pick against the stored answer, and deals again on a key", async () => {
    open("spot=srp_btn_bb&view=oop");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(within(options).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, ""))).toEqual(["check", "bet 33% (2bb)", "bet 75% (4bb)"]);
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    expect(within(screen.getByRole("group", { name: "Your cards" })).getAllByRole("img")).toHaveLength(2);
    expect(told()).toEqual(["PreflopFolds to BTN. BTN raises to 2.5bb, BB calls", "Floppot 5.5bb · BB to act · 97.5bb behind"]);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(/^Flop/);
    // (what the library stores is said only under a filter)
    expect(screen.queryByText(/flops stored/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Spot" })).toHaveDisplayValue("BTN vs BB single-raised pot");
    expect(screen.queryByRole("combobox", { name: "Hands" })).toBeNull();

    fireEvent.click(within(options).getByRole("button", { name: "check" }));
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getByText(/^(Best|Correct|Inaccuracy|Mistake|Blunder)$/)).toBeInTheDocument();
    expect(within(answer).getByText(/^The solver (always plays this here|picks this most often|plays this|mixes this in|never plays this)/)).toBeInTheDocument();
    expect(within(answer).getByText(/^Precomputed solution · srp_btn_bb · \d\.\d\d% pot from equilibrium in the solved game \(\w+\) · \d+ iterations$/)).toBeInTheDocument();
    expect(within(answer).getAllByRole("row")).toHaveLength(4);
    expect(within(answer).getByRole("row", { name: /^check ← you/ })).toBeInTheDocument();
    expect(within(answer).getByRole("link", { name: "Open in Study →" }).getAttribute("href")).toMatch(/^\/study\?p=6&s=100&pre=UTG%3Af.*&b=[2-9TJQKA][shdc]{1}/);
    const score = within(screen.getByRole("region", { name: "Score" }));
    expect(score.getByText("Decisions").nextSibling).toHaveTextContent(/^1$/);
    // the decision is kept
    await waitFor(async () => expect((await recentSessions("drill")).some((s) => s.decisions === 1 && s.meta.spot === "srp_btn_bb")).toBe(true));
    const kept = (await recentSessions("drill")).find((s) => s.decisions === 1)!;
    expect(Object.entries(kept.meta.versions as Record<string, number>)).toEqual([[expect.stringMatching(/^library:srp_btn_bb:[0-9a-f]{8}$/), 1]]);
    // what it was dealt from (every flop and hand), for the lessons
    const ok = within(answer).queryByText(/^(Best|Correct)$/) ? 1 : 0;
    expect(kept.meta.byDeal).toEqual({ "": { n: 1, ok } });

    // Enter: the next hand; a number key answers it
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Answer" })).toBeNull());
    await screen.findByRole("group", { name: "Your options" });
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")[0]).toBeEnabled());
    fireEvent.keyDown(window, { key: "2" });
    expect(within(await screen.findByRole("region", { name: "Answer" })).getByRole("row", { name: /^bet 33% \(2bb\) ← you/ })).toBeInTheDocument();
  });

  it("Hint gives the spot, and a pick after Reveal isn't scored, kept or graded, and says so", async () => {
    open("spot=srp_btn_bb&view=oop");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    expect(screen.getByText(/^Flop, heads-up, BB out of position\. Nothing to call: the pot is 5\.5bb\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    const shown = screen.getByRole("group", { name: "Revealed answer" });
    expect(within(shown).getByRole("row", { name: /^check / })).toBeInTheDocument();
    expect(within(shown).getByText(/^Precomputed solution · srp_btn_bb/)).toBeInTheDocument();
    expect(within(shown).getByRole("status")).toHaveTextContent("Answer seen first: not graded.");
    const sessions = (await recentSessions("drill")).length;

    fireEvent.click(within(options).getByRole("button", { name: "check" }));
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getByText("Not graded: revealed")).toBeInTheDocument();
    expect(within(answer).queryByRole("button", { name: "Copy for AI" })).toBeNull();
    expect(within(answer).queryByText(/^(Best|Correct|Inaccuracy|Mistake|Blunder)$/)).toBeNull();
    const score = within(screen.getByRole("region", { name: "Score" }));
    expect(score.getByText("Decisions").nextSibling).toHaveTextContent(/^0$/);
    expect(score.getByText("1 revealed pick not graded.")).toBeInTheDocument();
    // nothing to record yet
    expect((await recentSessions("drill")).length).toBe(sessions);

    // the next deal is graded again
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Answer" })).toBeNull());
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")[0]).toBeEnabled());
    expect(screen.queryByRole("group", { name: "Revealed answer" })).toBeNull();
    fireEvent.keyDown(window, { key: "1" });
    // (graded off the main path: a slow runner can take longer than findBy's 1 s, as CI did on 2026-11-10)
    expect(within(await screen.findByRole("region", { name: "Answer" }, { timeout: 10_000 })).getByText(/^(Best|Correct|Inaccuracy|Mistake|Blunder)$/)).toBeInTheDocument();
    expect(score.getByText("Decisions").nextSibling).toHaveTextContent(/^1$/);
  });

  it("copies a graded drill for AI, the stored answer named", async () => {
    const writeText = vi.fn(async (_: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    open("spot=srp_btn_bb&view=oop");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    fireEvent.click(within(options).getByRole("button", { name: "check" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Answer" })).getByRole("button", { name: "Copy for AI" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]![0];
    expect(text).toMatch(/^You: BB, holding .. ..$/m);
    expect(text).toMatch(/^Source of these numbers: Precomputed solution · srp_btn_bb/m);
    expect(text).toMatch(/^You took: check\. Lizard's grade: /m);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("in position facing out of position's first bet (the 3-bet pot's c-bet): the bet said, Study at it", async () => {
    open("spot=3bp_bb_btn&view=ipvsbet");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(within(options).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, "")).slice(0, 2)).toEqual(["fold", expect.stringMatching(/^call [\d.]+bb$/)]);
    expect(told()[0]).toBe("PreflopFolds to BTN. BTN raises to 2.5bb, BB 3-bets to 10bb, BTN calls");
    expect(told()[1]).toMatch(/^Floppot 20\.5bb · BB bets (33|75)% \([\d.]+bb\) · BTN to act, [\d.]+bb to call · 90bb behind$/);
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BTN faces BB's bet");
    fireEvent.click(within(options).getByRole("button", { name: "fold" }));
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getByRole("link", { name: "Open in Study →" }).getAttribute("href")).toMatch(/&flop=BB%3Ab[\d.]+$/);
  });

  it("facing a bet: the flop drawn with the texture asked for, the bet said", async () => {
    open("spot=srp_btn_bb&view=vsbet&suits=mono");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    const board = within(screen.getByRole("group", { name: "Board" })).getAllByRole("img");
    expect(new Set(board.map(suitOf)).size).toBe(1);
    expect(told()[1]).toMatch(/^Floppot 5\.5bb · BB checks, BTN bets (33|75)% \(\d+(\.\d+)?bb\) · BB to act, \d+(\.\d+)?bb to call · 97\.5bb behind$/);
    expect(screen.getByText(/store this decision with this texture\./)).toBeInTheDocument();
    const names = within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, ""));
    expect(names[0]).toBe("fold");
    expect(names[1]).toMatch(/^call \d+(\.\d+)?bb$/);

    // the drill as set, saved under a name (Saved lists it)
    await waitFor(() => expect(screen.getByRole("button", { name: "☆ Save drill" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "☆ Save drill" }));
    const form = screen.getByRole("form", { name: "Save drill" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    expect((name as HTMLInputElement).value).toBe("BTN vs BB single-raised pot · BB checks, faces a bet · Monotone");
    fireEvent.change(name, { target: { value: "Monotone defence" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("Saved in this browser.");
    expect(screen.getByRole("button", { name: "★ Saved drill" })).toBeInTheDocument();
    const [d] = await listDrills();
    expect(d).toMatchObject({ name: "Monotone defence", kind: "library", to: "/practice?tab=drills&spot=srp_btn_bb&view=vsbet&suits=mono" });
  });

  it("says when no flop stores the decision with that texture", async () => {
    const before = asked.length;
    open("spot=srp_btn_bb&view=oop&pair=trips&suits=twotone");
    expect(await screen.findByText("No flop in this spot stores this decision with that texture: widen the filter.", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(asked.slice(before).filter((p) => p.endsWith(".bin"))).toEqual([]); // (no entry read)
  });

  it("deals a stored turn: the board of four, the two options the file holds, graded by the mix under the stored turn's badge, with no EV counted", async () => {
    const before = asked.length;
    open("spot=srp_btn_bb&street=turn&view=oop");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(4);
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB first to act on the turn");
    expect(within(screen.getByRole("group", { name: "Turn" })).getAllByRole("option")).toHaveLength(4);
    expect(within(options).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, "").replace(/ \(.*/, ""))).toEqual(["check", "bet 75%"]);
    expect(told()[1]).toMatch(/^Floppot 5\.5bb · /);
    expect(told()[2]).toMatch(/^Turnpot \d+(\.\d+)?bb · BB to act · \d+(\.\d+)?bb behind$/);
    expect(screen.queryByText(/store their turns/)).toBeNull();
    expect(asked.slice(before).some((p) => p.endsWith(".turn.bin"))).toBe(true);
    // (the river is a live drill, which this stored one reads nothing of)
    expect(within(screen.getByRole("group", { name: "River (live solve)" })).getByRole("option", { name: "BB first to act on the river" })).toBeEnabled();

    fireEvent.click(within(options).getByRole("button", { name: /^.?check$/ }));
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getByText(/^(Best|Correct|Inaccuracy|Mistake)$/)).toBeInTheDocument();
    expect(within(answer).getByText(/^Stored turn from the flop library · srp_btn_bb · the precomputed flop solve's view of this turn, in 5% steps \(one bet size, 75%\) · approximate$/)).toBeInTheDocument();
    expect(within(answer).getByText("Graded by frequency: no EV stored.")).toBeInTheDocument();
    // no EV column: a format-1 file holds none
    expect(within(answer).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Action", "Played"]);
    expect(within(answer).getByRole("link", { name: "Open in Study →" }).getAttribute("href")).toMatch(/&b=([2-9TJQKA][shdc]){4}/);
    expect(within(screen.getByRole("region", { name: "Score" })).getByText("EV lost per decision").nextSibling).toHaveTextContent("–");
  });

  it("a 3-bet pot's turn file shows the range's EV by action, marked as not your hand's, and in position after a check", async () => {
    open("spot=3bp_bb_btn&street=turn&view=ip");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(told()[2]).toMatch(/^Turnpot [\d.]+bb · BB checks · BTN to act · [\d.]+bb behind$/);
    fireEvent.click(within(options).getAllByRole("button")[0]!);
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Action", "Played", "Range’s EV bb"]);
  });

  it("says a spot with no stored turns has none, and doesn't deal one", async () => {
    const before = asked.length;
    open("spot=srp_co_bb&street=turn");
    await screen.findByText(/stores no turn in this library: pick another spot, or the flop\./, undefined, { timeout: 5000 });
    expect(within(screen.getByRole("group", { name: "Turn (none stored for this spot)" })).getAllByRole("option").every((o) => (o as HTMLOptionElement).disabled)).toBe(true);
    expect(asked.slice(before).filter((p) => p.endsWith(".bin"))).toEqual([]);
  });

  it("moves off a turn drill to a spot with no stored turns at its flop, not on a street it lacks", async () => {
    open("spot=srp_btn_bb&street=turn&view=oop");
    const spot = await screen.findByRole("combobox", { name: "Spot" }, { timeout: 5000 });
    fireEvent.change(spot, { target: { value: "srp_co_bb" } });
    expect(screen.queryByText(/stores no turn in this library/)).toBeNull();
    expect((screen.getByRole("combobox", { name: "Decision" }) as HTMLSelectElement).value.startsWith("flop|")).toBe(true);
  });

  it("a hand filter: only those hands dealt, how many deals match said, on a flop and a turn", async () => {
    open("spot=srp_btn_bb&view=oop&hand=c:pairs");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    const cards = within(screen.getByRole("group", { name: "Your cards" })).getAllByRole("img");
    const rankOf = (img: HTMLElement) => img.getAttribute("aria-label")!.split(" of ")[0];
    expect(rankOf(cards[0]!)).toBe(rankOf(cards[1]!));
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveDisplayValue("Pocket pairs");
    expect(await screen.findByText(/^Pocket pairs: [\d,]+ of [\d,]+ deals match on all 7 flops \(\d+\.\d%\)\.$/, undefined, { timeout: 5000 })).toBeInTheDocument();
    cleanup();
    open("spot=srp_btn_bb&street=turn&view=oop&hand=m:set");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(await screen.findByText(/^Set: [\d,]+ of [\d,]+ deals match on all 7 flops/, undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it("says plainly when a filter leaves too few, or none", async () => {
    open("spot=srp_btn_bb&view=oop&suits=rainbow&hand=m:flush");
    expect(await screen.findByText("No flop here can hold Flush with that texture: widen a filter.", undefined, { timeout: 5000 })).toBeInTheDocument();
    cleanup();
    open("spot=srp_btn_bb&view=oop&pair=trips&hand=m:quads");
    expect(await screen.findByText(/Quads or better: \d+ of \d+ deals match on the 1 flop.*Few: hands will repeat\./, undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it("a turn drill with its hand filter is saved in the URL, opens as it was set, and comes back to the same drill", async () => {
    open("spot=srp_btn_bb&street=turn&view=ip&suits=mono&hand=d:gutshot");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "☆ Save drill" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "☆ Save drill" }));
    const form = screen.getByRole("form", { name: "Save drill" });
    expect((within(form).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("BTN vs BB single-raised pot · BTN after BB checks the turn · Monotone · Gutshot");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("Saved in this browser.");
    const to = "/practice?tab=drills&spot=srp_btn_bb&view=ip&street=turn&suits=mono&hand=d%3Agutshot";
    expect((await listDrills()).find((d) => d.name.endsWith("Gutshot"))).toMatchObject({ kind: "library", to });
    cleanup();
    open(to.slice("/practice?tab=drills&".length));
    await waitFor(() => expect(screen.getByRole("button", { name: "★ Saved drill" })).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BTN after BB checks the turn");
    expect(screen.getByRole("button", { name: /^Filters · 2/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveDisplayValue("Gutshot");
    expect(screen.getByRole("combobox", { name: "Suits" })).toHaveDisplayValue("Monotone");
  });

  it("a drill saved before streets and hand filters opens as it was: the flop, no filter, and still the saved one", async () => {
    const to = "/practice?tab=drills&spot=srp_btn_bb&view=ip&pair=unpaired";
    await putDrill({ id: "old", name: "Old drill", kind: "library", to, about: "from before", note: "", createdAt: 1, updatedAt: 1 });
    open("spot=srp_btn_bb&view=ip&pair=unpaired");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(await screen.findByRole("button", { name: "★ Saved drill" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BTN after BB checks");
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveDisplayValue("Any");
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    await deleteDrill("old");
  });

  it("a street or hand the URL can't mean is ignored; a turn with a flop's facing-a-bet decision starts out of position", async () => {
    open("spot=srp_btn_bb&street=moon&view=oop&hand=m:nonsense");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB first to act");
    // (no filter set, so they stay folded)
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveDisplayValue("Any");
    cleanup();
    open("spot=srp_btn_bb&street=turn&view=vsbet");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB first to act on the turn");
  });
});
