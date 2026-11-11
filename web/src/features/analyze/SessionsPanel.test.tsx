/// <reference types="node" />
// Your sessions on the Analyze page, on hands kept in fake-indexeddb: the rows, a session picked as a filter that the
// report, grading and links follow, a link with nothing behind it, the line with what it stands on, and what's left
// out and said so. (In order: the tests share this file's database, each clearing it.)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, putSession, type DecisionRecord, type HandRecord } from "@/data/db";
import { addHands, putDecisions } from "@/data/hands";
import { prepare } from "./analyze";
import { AnalyzePage } from "./AnalyzePage";
import { BASES } from "./report";
import { sessionsOf, sessKey, sessWords } from "./sessions";
import { toSession, type LeakRef } from "./leakDrill";
import { rowOf } from "@/features/history/history";

vi.mock("@/solver/useSolver", () => ({ useSolver: () => async () => ({ solve: async () => ({ data: { skipped: "no" }, provenance: {} }) }) }));

const HH = (f: string) => readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", f), "utf8");
const T0 = Date.UTC(2026, 0, 1, 12);
const DAY = 86_400_000;
let id = 0;
const hand = (playedAt: number, over: Partial<HandRecord> = {}): HandRecord => {
  id++;
  return { id: `h${id}`, number: String(1000 + id), site: "PokerStars", played: playedAt ? new Date(playedAt).toISOString().slice(0, 16).replace("T", " ") : "", playedAt, hero: "BTN", players: 6, hole: "AhKd", board: "", bb: "$1", potType: "SRP", pot: 5, end: "showdown", decisions: 1, text: "", importId: "i", importName: "i", importedAt: 0, ...over };
};
const dec = (h: HandRecord, over: Partial<DecisionRecord> = {}): DecisionRecord => ({ id: `${h.id}|preflop|0`, handId: h.id, street: "preflop", pos: "BTN", action: "raise to 2.5", verdict: "Best", evLossBb: null, source: "charts", label: "the preflop charts", situation: "RFI", mix: [["raise", 0.6, null], ["fold", 0.4, null]], freq: 0.6, gradedAt: 1, ...over });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}
const open = (q = "") =>
  render(
    <MemoryRouter initialEntries={[`/analyze${q ? `?${q}` : ""}`]}>
      <Routes>
        <Route path="/analyze" element={<><AnalyzePage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
const panel = async () => screen.findByLabelText("Your sessions");
// (the page's views are tabs: one's content shows at a time)
const tab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }));
const search = () => new URLSearchParams(screen.getByTestId("where").textContent!.split("?")[1] ?? "");
const seed = async (hands: HandRecord[], ds: DecisionRecord[] = []) => {
  await addHands(hands);
  if (ds.length) await putDecisions(ds);
};

beforeEach(async () => {
  const d = await db();
  await Promise.all([d!.clear("hands"), d!.clear("decisions"), d!.clear("sessions")]);
});
afterEach(cleanup);

describe("Your sessions", () => {
  it("lists sittings newest first, with hands, won, graded and the share, and says nothing is solved where nothing's graded", async () => {
    const texts = (await prepare([{ name: "a", text: `${HH("stars_6max_srp.txt")}\n\n${HH("stars_3bet_pot.txt")}` }], { id: "i", name: "i", at: 1 })).hands;
    expect(texts).toHaveLength(2);
    await seed(texts);
    open();
    await tab("Sessions");
    const rows = within(await screen.findByRole("list", { name: "Sessions" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/2024\/04\/18|2024-04-18/);
    expect(rows[1]).toHaveTextContent(/2024\/03\/02|2024-03-02/);
    await waitFor(() => expect(rows[0]).toHaveTextContent(/won [+−]\d+\.\dbb/));
    expect(rows[0]).toHaveTextContent("1 hand");
    expect(rows[0]).toHaveTextContent("0 of");
    expect(rows[0]).toHaveTextContent("—");
    expect(await panel()).toHaveTextContent("None graded here yet.");
  });

  it("keeps a tournament's chips out of Won, and each kind to itself", async () => {
    await seed([hand(T0), hand(T0 + 60_000), hand(T0, { tournament: "Sunday 50", bb: "100 chips" })]);
    open();
    await tab("Sessions");
    await panel();
    expect(within(await screen.findByRole("list", { name: "Sessions" })).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Games" }), { target: { value: "tour" } });
    const [row] = within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("listitem");
    expect(row).toHaveTextContent("Sunday 50");
    expect(row).toHaveTextContent("1 hand");
    expect(row).toHaveTextContent("won —");
    expect(row).not.toHaveTextContent("bb");
  });

  it("makes a session a filter: the hands, the report, grading and links follow, and All sessions lets go", async () => {
    const [a, b] = [hand(T0), hand(T0 + DAY)];
    await seed([a, b], [dec(a, { verdict: "Mistake", freq: 0.1, mix: [["raise", 0.1, null], ["fold", 0.9, null]] }), dec(b)]);
    open();
    await tab("Grades & leaks");
    expect(await screen.findByRole("button", { name: "Grade 2 hands" })).toBeInTheDocument();
    await tab("Sessions");
    const list = await screen.findByRole("list", { name: "Sessions" });
    fireEvent.click(within(list).getByRole("button", { name: /^Session PokerStars cash, 2026-01-01 12:00$/ }));
    await waitFor(() => expect(search().get("sess")).toBe(sessionsOf([a, b])[0]!.key));
    expect(within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Games" })).toBeNull();
    await tab("Grades & leaks");
    expect(await screen.findByRole("button", { name: "Grade 1 hand" })).toBeInTheDocument();
    // a hand linked from the report stays in the session
    const report = screen.getByLabelText("Report");
    fireEvent.click(within(report).getAllByRole("link", { name: /^Hand / })[0]!);
    await waitFor(() => expect(search().get("hand")).toBe(a.id));
    expect(search().get("sess")).toBe(sessionsOf([a, b])[0]!.key);
    await tab("Sessions");
    fireEvent.click(screen.getByRole("button", { name: "All sessions" }));
    await waitFor(() => expect(search().has("sess")).toBe(false));
    expect(within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("clears a session with the other filters", async () => {
    const a = hand(T0);
    await seed([a]);
    open(`sess=${encodeURIComponent(sessionsOf([a])[0]!.key)}&pos=BTN`);
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(search().has("sess")).toBe(false));
    expect(search().has("pos")).toBe(false);
  });

  it("keeps the session picked in view when the other filters leave it no hands", async () => {
    const a = hand(T0);
    await seed([a]);
    open(`sess=${encodeURIComponent(sessionsOf([a])[0]!.key)}&pos=BB`);
    await tab("Sessions");
    const [row] = within(await screen.findByRole("list", { name: "Sessions" })).getAllByRole("listitem");
    expect(row).toHaveTextContent("0 of 1 hand");
  });

  it("says what's become of a link: its range changed, not kept here, or unreadable, and shows no other hands", async () => {
    const [a, b] = [hand(T0), hand(T0 + 10 * 60_000)];
    await seed([a, b]);
    const stale = sessKey({ kind: "cash", site: "PokerStars", first: T0, last: T0 + 60_000 });
    const q = (s: string) => `sess=${encodeURIComponent(s)}`;
    open(q(stale));
    await tab("Sessions");
    expect(await screen.findByRole("status", { name: "Session not found" })).toHaveTextContent("Changed: 1 hand kept in that time");
    cleanup();
    open(q(sessKey({ kind: "cash", site: "GGPoker", first: T0, last: T0 })));
    await tab("Sessions");
    expect(await screen.findByRole("status", { name: "Session not found" })).toHaveTextContent("Not kept here: GGPoker cash, 2026-01-01 12:00");
    cleanup();
    open(q("nonsense"));
    await tab("Sessions");
    expect(await screen.findByRole("status", { name: "Session not found" })).toHaveTextContent("That session can't be read");
    await tab("Grades & leaks");
    expect(await screen.findByRole("button", { name: "Grade 0 hands" })).toBeDisabled();
    await tab("Sessions");
    const st = await screen.findByRole("status", { name: "Session not found" });
    fireEvent.click(within(st).getByRole("button", { name: "All sessions" }));
    await waitFor(() => expect(search().has("sess")).toBe(false));
  });

  it("counts the hands whose result the history doesn't say, as left out", async () => {
    const ok = (await prepare([{ name: "a", text: HH("stars_6max_srp.txt") }], { id: "i", name: "i", at: 1 })).hands[0]!;
    await seed([ok, { ...ok, id: "unread", number: "1", text: "not a history" }]);
    open();
    await tab("Sessions");
    const [row] = within(await screen.findByRole("list", { name: "Sessions" })).getAllByRole("listitem");
    await waitFor(() => expect(row).toHaveTextContent("(1 left out)"));
    expect(row).toHaveTextContent("2 hands");
  });

  it("draws the line with what it stands on in its title, and calls the latest third, the charts never as solved", async () => {
    const hs = Array.from({ length: 330 }, (_, k) => hand(T0 + k * DAY));
    await seed(hs, hs.map((h, k) => dec(h, { verdict: k < 220 ? (k % 2 ? "Best" : "Mistake") : k % 10 ? "Best" : "Mistake" })));
    open();
    await tab("Sessions");
    const p = await panel();
    const fig = await within(p).findByRole("figure");
    expect(fig).toHaveTextContent(BASES[0]!);
    expect(fig).toHaveTextContent("not a solve");
    expect(within(fig).getByRole("table", { name: "The line by blocks", hidden: true })).toBeInTheDocument();
    const line = within(fig).getByRole("slider");
    fireEvent.focus(line);
    expect(within(fig).getByRole("tooltip")).toHaveTextContent(/\d+% in the mix/);
    const lastBlock = line.getAttribute("aria-valuemax");
    expect(line).toHaveAttribute("aria-valuenow", lastBlock);
    fireEvent.keyDown(line, { key: "ArrowLeft" });
    expect(within(fig).getByRole("tooltip")).toHaveTextContent(/2026|2027/);
    expect(line).toHaveAttribute("aria-valuenow", String(Number(lastBlock) - 1));
    expect(line.getAttribute("aria-valuetext")).toMatch(/^Block \d+ of \d+: \d+% in the mix/);
    expect(screen.getByLabelText("Latest sessions against before")).toHaveTextContent(/not a solve.*in the mix over your latest 110 decisions.*Better\./);
    expect(p).toHaveTextContent("In the mix: on Preflop charts (by frequency, not a solve).");
    expect(within(p).getByRole("table", { name: "Changes against before" })).toHaveTextContent("RFI");
  });

  it("says on the row and the comparison where the versions differ, and keeps the row's numbers", async () => {
    const hs = Array.from({ length: 330 }, (_, k) => hand(T0 + k * DAY));
    const version = (k: number) => (k < 220 ? "build:aaaa/1111" : "build:bbbb/2222");
    await seed(hs, hs.map((h, k) => dec(h, { version: version(k), verdict: k < 220 ? (k % 2 ? "Best" : "Mistake") : k % 10 ? "Best" : "Mistake" })));
    open();
    await tab("Sessions");
    const p = await panel();
    await within(p).findByRole("figure");
    expect(screen.getByLabelText("Versions compared")).toHaveTextContent("Graded on different versions: solver build aaaa/1111 before, bbbb/2222 latest.");
    const table = within(p).getByRole("table", { name: "Changes against before" });
    expect(within(table).getByRole("columnheader", { name: "Versions" })).toBeInTheDocument();
    const [row] = within(table).getAllByRole("row").slice(1);
    expect(row).toHaveTextContent("RFI");
    expect(row).toHaveTextContent("Better");
    expect(row).toHaveTextContent("solver build aaaa/1111 before, bbbb/2222 latest");
  });

  it("shows grades with no version as unknown, and one known version as the same", async () => {
    const hs = Array.from({ length: 330 }, (_, k) => hand(T0 + k * DAY));
    const graded = (over: Partial<DecisionRecord>) => hs.map((h, k) => dec(h, { ...over, verdict: k < 220 ? (k % 2 ? "Best" : "Mistake") : k % 10 ? "Best" : "Mistake" }));
    await seed(hs, graded({}));
    open();
    await tab("Sessions");
    const p = await panel();
    const table = await within(p).findByRole("table", { name: "Changes against before" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(/Version unknown \(\d+ before, \d+ latest\)/);
    expect(p).toHaveTextContent("Unknown: graded before versions were kept");
    cleanup();
    await putDecisions(graded({ version: "build:aaaa/1111" }));
    open();
    await tab("Sessions");
    const same = await within(await panel()).findByRole("table", { name: "Changes against before" });
    expect(within(within(same).getAllByRole("row")[1]!).getAllByRole("cell").at(-1)).toHaveTextContent(/^Same$/);
    expect(screen.queryByLabelText("Versions compared")).toBeNull();
  });

  it("hides the line and the comparison under a session and the filters that pick hands by how they went", async () => {
    const hs = Array.from({ length: 330 }, (_, k) => hand(T0 + k * DAY));
    await seed(hs, hs.map((h) => dec(h)));
    open("q=PokerStars");
    await tab("Sessions");
    const p = await panel();
    await within(p).findByRole("list", { name: "Sessions" });
    await waitFor(() => expect(p).toHaveTextContent("No line while the EV lost, tag or search filters are on."));
    expect(within(p).queryByRole("figure")).toBeNull();
    expect(screen.queryByLabelText("Latest sessions against before")).toBeNull();
    cleanup();
    open(`sess=${encodeURIComponent(sessionsOf(hs)[0]!.key)}`);
    await tab("Sessions");
    await panel();
    expect(within(await panel()).queryByRole("figure")).toBeNull();
  });

  it("says how many more decisions make a line, and lists 50 sessions until asked", async () => {
    const hs = Array.from({ length: 60 }, (_, k) => hand(T0 + k * DAY));
    await seed(hs, hs.map((h) => dec(h)));
    open();
    await tab("Sessions");
    const p = await panel();
    await waitFor(() => expect(p).toHaveTextContent("240 more decisions for a line"));
    expect(within(await within(p).findByRole("list", { name: "Sessions" })).getAllByRole("listitem")).toHaveLength(50);
    const more = within(p).getByRole("button", { name: "Show all 60 sessions" });
    more.focus();
    fireEvent.click(more);
    const rows = within(within(p).getByRole("list", { name: "Sessions" })).getAllByRole("listitem");
    expect(rows).toHaveLength(60);
    // (the button is gone: the first row it brought has the focus)
    await waitFor(() => expect(document.activeElement).toBe(within(rows[50]!).getByRole("button", { name: /^Session / })));
  });

  it("shows a frequency on the other side of the answer among the changes", async () => {
    const hs = Array.from({ length: 450 }, (_, k) => hand(T0 + k * DAY));
    const opens = (h: HandRecord, you: boolean) => dec(h, { action: you ? "raise to 2.5" : "fold", mix: [["fold", 0.5, null], ["raise", 0.5, null]], freq: 0.5 });
    await seed(hs, hs.map((h, k) => opens(h, k < 300 ? k % 5 === 0 : k % 5 !== 0)));
    open();
    await tab("Sessions");
    const p = await panel();
    const changes = await within(p).findByRole("table", { name: "Changes against before" });
    expect(changes).toHaveTextContent(/you 20%, the answer 50% \(300\)you 80%, the answer 50% \(150\)Now over the answer/);
  });

  it("tells a drill with nothing in these hands from a leak with nothing graded", async () => {
    const hs = [hand(T0), hand(T0 + DAY), hand(T0 + 2 * DAY)];
    await seed(hs, [dec(hs[0]!), dec(hs[1]!), dec(hs[2]!, { situation: "vs open" })]);
    open("drill=pf:RFI");
    const drill = await screen.findByLabelText("Leak drill");
    fireEvent.click((await within(drill).findAllByRole("button", { name: /raise|fold/i }))[0]!);
    expect(await within(drill).findByLabelText("Drill score")).toHaveTextContent("1 of 2 drilled");
    await tab("Sessions");
    fireEvent.click(within(screen.getByRole("list", { name: "Sessions" })).getByRole("button", { name: `Session ${sessWords(sessionsOf(hs).find((s) => s.hands[0]!.id === hs[2]!.id)!.key)}` }));
    await waitFor(() => expect(screen.getByLabelText("Leak drill")).toHaveTextContent("None of this leak's graded decisions is in these hands."));
    expect(screen.getByLabelText("Leak drill")).not.toHaveTextContent("is graded with its mix");
    fireEvent.click(screen.getByRole("button", { name: "All sessions" }));
    await waitFor(() => expect(within(screen.getByLabelText("Leak drill")).getByLabelText("Drill score")).toHaveTextContent("1 of 2 drilled"));
    cleanup();
    open("drill=pf:Limp");
    expect(await screen.findByText("None of this leak's decisions is graded with its mix.")).toBeInTheDocument();
  });

  it("keeps History's total the whole leak's, whatever session a pick or a Start over was made under", async () => {
    const hs = Array.from({ length: 10 }, (_, k) => hand(T0 + k * DAY));
    await seed(hs, hs.map((h) => dec(h)));
    const stored = async () => {
      const [s] = await (await db())!.getAll("sessions");
      return rowOf(s!).what;
    };
    const sess = sessionsOf(hs)[3]!.key;
    open(`drill=pf:RFI&sess=${encodeURIComponent(sess)}`);
    const drill = await screen.findByLabelText("Leak drill");
    fireEvent.click((await within(drill).findAllByRole("button", { name: /raise|fold/i }))[0]!);
    await waitFor(async () => expect(await stored()).toMatch(/^Leak: RFI · 1 of 10 done when last drilled, /));
    fireEvent.click(within(drill).getByRole("button", { name: "Start over" }));
    await waitFor(async () => expect(await stored()).toMatch(/^Leak: RFI · 0 of 10 done when last drilled, /));
  });

  it("never counts a drill past its total, the session cutting it down", async () => {
    const hs = [hand(T0), hand(T0 + DAY), hand(T0 + 2 * DAY)];
    const ds = hs.map((h) => dec(h));
    await seed(hs, ds);
    const leak: LeakRef = { kind: "pf", key: "RFI" };
    await putSession(toSession(leak, { startedAt: 1, done: ds.map((d) => d.id), score: { n: 3, ok: 3, ne: 0, loss: 0, lossPct: 0 } as never }, 3));
    await act(async () => {
      open(`drill=${encodeURIComponent("pf:RFI")}&sess=${encodeURIComponent(sessionsOf(hs)[0]!.key)}`);
    });
    expect(await screen.findByLabelText("Drill score")).toHaveTextContent("1 of 1 drilled here; 3 of this leak in all: 3 in the mix");
    expect(screen.getByRole("button", { name: "Start this leak over" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Leak drill")).getByRole("status")).toHaveTextContent("Every decision of this leak in these hands is drilled");
  });

  it("deals the next decision in view when a filter takes the one answered away, and keeps History's count within its total", async () => {
    const hs = [hand(T0), hand(T0 + DAY)];
    const ds = hs.map((h) => dec(h));
    await seed(hs, ds);
    open("drill=pf:RFI");
    const drill = await screen.findByLabelText("Leak drill");
    const first = await within(drill).findAllByRole("button", { name: /raise|fold/i });
    fireEvent.click(first[0]!);
    const answered = (await within(drill).findByLabelText("Drill score")).textContent;
    expect(answered).toContain("1 of 2 drilled");
    const stored = await (await db())!.getAll("sessions");
    const dealt = stored.flatMap((s) => (s.meta as { done: string[] }).done)[0]!;
    const other = sessionsOf(hs).find((s) => !s.hands.some((h) => dealt.startsWith(h.id)))!;
    await tab("Sessions");
    fireEvent.click(within(screen.getByRole("list", { name: "Sessions" })).getByRole("button", { name: `Session ${sessWords(other.key)}` }));
    await waitFor(() => expect(within(screen.getByLabelText("Leak drill")).getByLabelText("Drill score")).toHaveTextContent("0 of 1 drilled here; 1 of this leak in all"));
    expect(screen.queryByRole("button", { name: "Next decision" })).toBeNull();
    expect(screen.queryByText(/Every decision of this leak/)).toBeNull();
    fireEvent.click(within(screen.getByLabelText("Leak drill")).getAllByRole("button", { name: /raise|fold/i })[0]!);
    await waitFor(async () => {
      const [s] = await (await db())!.getAll("sessions");
      const m = s!.meta as { done: string[]; total: number };
      expect(m.done.length).toBe(2);
      expect(m.total).toBe(2);
    });
  });

  it("says when nothing counts toward a line though decisions are graded: clear folds, or no dates", async () => {
    const folds = [hand(T0), hand(T0 + DAY)];
    await seed(folds, folds.map((h) => dec(h, { action: "fold", freq: 1, mix: [["fold", 1, null]] })));
    open();
    await tab("Sessions");
    const p = await panel();
    await waitFor(() => expect(p).toHaveTextContent("300 more decisions for a line."));
    expect(p).not.toHaveTextContent("Nothing graded yet");
    cleanup();
    const d = await db();
    await Promise.all([d!.clear("hands"), d!.clear("decisions")]);
    const undated = [hand(0)];
    await seed(undated, undated.map((h) => dec(h)));
    open();
    await tab("Sessions");
    const row = within(await screen.findByRole("list", { name: "Sessions" })).getAllByRole("listitem")[0]!;
    await waitFor(() => expect(row).toHaveTextContent("1 of 1 in the mix"));
    expect(screen.getByRole("combobox", { name: "Graded on" })).toHaveTextContent(`${BASES[0]} · 0`);
  });

  it("says when filters shape what it shows, and a row's share of its sitting", async () => {
    const hs = [hand(T0, { hero: "BTN" }), hand(T0 + 60_000, { hero: "BB" }), hand(T0 + 120_000, { hero: "BTN" })];
    await seed(hs);
    open("pos=BTN");
    await tab("Sessions");
    const p = await panel();
    await within(p).findByRole("list", { name: "Sessions" });
    expect(p).toHaveTextContent("Over the 2 hands the filters show, of 3 kept.");
    expect(within(within(p).getByRole("list", { name: "Sessions" })).getAllByRole("listitem")[0]).toHaveTextContent("2 of 3 hands");
  });

  it("brings the session picked into view, and gives focus to the heading when it lets go", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      const hs = [hand(T0), hand(T0 + DAY)];
      await seed(hs);
      open();
      await tab("Sessions");
      const list = await screen.findByRole("list", { name: "Sessions" });
      scroll.mockClear();
      fireEvent.click(within(list).getAllByRole("button", { name: /^Session / })[0]!);
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.contexts.some((el) => (el as Element).tagName === "LI")).toBe(true);
      fireEvent.click(await screen.findByRole("button", { name: "All sessions" }));
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your sessions" }));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("reads the block under a tap", async () => {
    const hs = Array.from({ length: 400 }, (_, k) => hand(T0 + k * DAY));
    await seed(hs, hs.map((h) => dec(h)));
    open();
    await tab("Sessions");
    const fig = await within(await panel()).findByRole("figure");
    const line = within(fig).getByRole("slider");
    vi.spyOn(line, "getBoundingClientRect").mockReturnValue({ left: 0, width: 400, top: 0, height: 100, right: 400, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(line, { clientX: 10 });
    expect(within(fig).getByRole("tooltip")).toHaveTextContent("2026-01-01");
    fireEvent.focus(line);
    expect(within(fig).getByRole("tooltip")).toHaveTextContent("2026-01-01");
  });
});
