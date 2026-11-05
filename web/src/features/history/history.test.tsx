// The sessions history (ROADMAP Phase 1): every kept session by day with what graded it, lifetime totals by kind,
// and Practice's finished hands by pot type, where the session kept them.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { allSessions, db, putSession, type SessionRecord } from "@/data/db";
import { keepMistake } from "@/data/mistakes";
import { mistake } from "@/test/mistake";
import type { Sim } from "@/poker/table";
import { addHandToPot, addSource, byDay, handPot, kindTotals, linePot, potTotals, rowOf } from "./history";
import { HistoryPage } from "./HistoryPage";

const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).getTime();
const sim = (nRaises: number) => ({ streets: { preflop: { nRaises } } }) as unknown as Pick<Sim, "streets">;
const g = (ok: boolean, loss = 0, byEv = true) => ({ ok, loss, lossPct: loss * 10, byEv });

const OLD: SessionRecord = {
  id: "practice-old",
  kind: "practice",
  startedAt: at(1, 20),
  decisions: 4,
  evLossBb: 0.5,
  meta: { hands: 3, net: -2, ok: 3, graded: 2, lossPct: 5, players: 6, stack: 100, seat: "moves" },
};
const NEW: SessionRecord = {
  id: "practice-new",
  kind: "practice",
  startedAt: at(3, 21),
  decisions: 3,
  evLossBb: 0.3,
  meta: {
    hands: 2,
    net: 4.5,
    ok: 2,
    graded: 2,
    lossPct: 6,
    players: 2,
    stack: 100,
    seat: "moves",
    byPot: {
      SRP: addHandToPot(undefined, [g(true, 0, false), g(true, 0)], 2.5),
      "3bet pot": addHandToPot(undefined, [g(false, 0.3)], 2),
    },
    sources: { charts: 1, live: 2 },
  },
};
const PREFLOP: SessionRecord = {
  id: "practice-pf",
  kind: "practice",
  startedAt: at(3, 9),
  decisions: 1,
  evLossBb: 0,
  meta: { hands: 1, net: 0, ok: 1, graded: 0, lossPct: 0, players: 6, stack: 100, seat: "BTN", preflopOnly: true, byPot: { SRP: addHandToPot(undefined, [g(true, 0, false)], null) }, sources: { charts: 1 } },
};
const DRILL: SessionRecord = {
  id: "drill-1",
  kind: "drill",
  startedAt: at(3, 10),
  decisions: 4,
  evLossBb: 0.2,
  meta: { spot: "srp_btn_bb", label: "SRP BTN vs BB", view: "vsbet", ok: 3, graded: 4, lossPct: 4, best: 2 },
};
const LEAK: SessionRecord = {
  id: "leak-drill|pf:RFI",
  kind: "analysis",
  startedAt: at(2, 18),
  decisions: 2,
  evLossBb: 0,
  meta: { drill: "leak", leak: "pf:RFI", label: "RFI", total: 5, done: ["a", "b"], score: { n: 2, ok: 1, loss: 0, lossPct: 0, ne: 0, streak: 0, best: 1, recent: [1, 0] } },
};
const BUILD: SessionRecord = {
  id: "build-1",
  kind: "build",
  startedAt: at(3, 11),
  decisions: 1,
  evLossBb: 0.04,
  meta: { line: "p=2&s=100&pre=SB%3Ar2.5%2CBB%3Ac&b=Ks7d2c", label: "SB raise 2.5 BB call Ks7d2c", actor: "BB", street: "flop", acc: 0.82, evLossBb: 0.04, source: "library", approximate: false },
};

describe("sessions history", () => {
  it("names a Practice hand's pot as its preflop went, and tallies its decisions and net", () => {
    expect(handPot([{ pos: "SB", action: "raise", to: 2.5 }], sim(1))).toBe("SRP");
    expect(handPot([], sim(2))).toBe("3bet pot");
    expect(handPot([], sim(4))).toBe("4bet+ pot");
    expect(handPot([{ pos: "SB", action: "call" }, { pos: "BB", action: "check" }], sim(0))).toBe("Limped");
    expect(handPot([{ pos: "UTG", action: "fold" }], sim(0))).toBe("Unopened");
    const t = addHandToPot(addHandToPot(undefined, [g(true, 0, false), null, g(false, 0.5)], -3), [g(true, 0.1)], null);
    expect(t).toEqual({ hands: 2, n: 3, ok: 2, ne: 2, loss: 0.6, lossPct: 6, played: 1, net: -3 });
    expect(addSource(addSource({}, "charts"), undefined)).toEqual({ charts: 1, unknown: 1 });
  });

  it("reads each kind's record into a row with what graded it and where it opens again", () => {
    const old = rowOf(OLD);
    expect(old).toMatchObject({ what: "6 players · 100bb", n: 4, ok: 3, lossPer: 0.25, lossPctPer: 2.5, hands: 3, net: -2 });
    expect(old.graded).toBe("Not kept: played before Lizard kept what graded each decision");
    expect(rowOf(NEW).graded).toBe("Live solve 2, Preflop charts (approximate) 1");
    expect(rowOf({ ...NEW, meta: { ...NEW.meta, pot: "3bet" } }).what).toBe("2 players · 100bb · 3-bet pots");
    expect(rowOf({ ...NEW, meta: { ...NEW.meta, pot: "3bet", board: { suits: "mono" }, hand: "m:set" } }).what).toMatch(/^2 players · 100bb · 3-bet pots · .+ · set$/);
    // (a backup can carry anything, and it's left unsaid rather than drawn)
    expect(rowOf({ ...NEW, meta: { ...NEW.meta, pot: "3bet", board: { suits: "nonsense" }, hand: "m:nonsense" } }).what).toBe("2 players · 100bb · 3-bet pots");
    expect(rowOf({ ...OLD, meta: { ...OLD.meta, ante: 0.1, straddle: true } }).what).toBe("6 players · 100bb · ante 0.1 · straddle");
    expect(rowOf({ ...OLD, meta: { ...OLD.meta, carry: true } }).what).toBe("6 players · 100bb · chips carried");
    expect(rowOf({ ...OLD, meta: { ...OLD.meta, sizes: { flop: [50] } } }).what).toBe("6 players · 100bb · your own sizes");
    expect(rowOf({ ...OLD, meta: { ...OLD.meta, rake: 5, rakeCap: 3 } }).what).toBe("6 players · 100bb · rake 5%");
    expect(rowOf(PREFLOP)).toMatchObject({ what: "6 players · 100bb · preflop only · seat BTN", net: null, lossPer: null });
    expect(rowOf(DRILL)).toMatchObject({ what: "SRP BTN vs BB, facing a bet", ok: 3, lossPer: 0.05, to: { href: "/practice?tab=drills&spot=srp_btn_bb&view=vsbet" } });
    expect(rowOf({ ...DRILL, meta: { ...DRILL.meta, view: "ipvsbet" } }).what).toBe("SRP BTN vs BB, in position facing a bet");
    expect(rowOf(DRILL).graded).toBe("Precomputed solution (the flop library)");
    expect(rowOf({ ...DRILL, evLossBb: 0, meta: { ...DRILL.meta, view: "oop", street: "turn", graded: 0, lossPct: 0 } })).toMatchObject({
      what: "SRP BTN vs BB, first to act on the turn",
      lossPer: null,
      graded: "Stored turn from the flop library (by how often, in 5% steps)",
      to: { href: "/practice?tab=drills&spot=srp_btn_bb&street=turn&view=oop" },
    });
    expect(rowOf(LEAK)).toMatchObject({ what: "Leak: RFI · 2 of 5 done when last drilled", n: 2, ok: 1, lossPer: null, to: { href: "/analyze?drill=pf%3ARFI" } });
    // (a row sits under the day it was started: a drill resumed since says its own day)
    expect(rowOf({ ...LEAK, endedAt: Date.UTC(2026, 9, 30, 14) }).what).toMatch(/^Leak: RFI · 2 of 5 done when last drilled, \S+.*\d/);
    // (a leak's decisions may stand on a solve or a read on any street: its row doesn't name one answer for them all)
    expect(rowOf(LEAK).graded).toContain("preflop charts by frequency (not a solve)");
    expect(rowOf(LEAK).graded).not.toContain("flop library");
    expect(rowOf(BUILD)).toMatchObject({ n: 1, ok: null, acc: 0.82, buildLoss: 0.04, graded: "Precomputed solution", to: { href: `/study?${BUILD.meta.line as string}` } });
    expect(rowOf(BUILD).what).toBe("HU 100bb · SB raise 2.5 BB call Ks7d2c · BB's range");
    expect(rowOf({ ...BUILD, meta: { ...BUILD.meta, source: "charts" } }).graded).toBe("Preflop charts (approximate)");
    // a preflop node's empty label: the table and "first in"
    expect(rowOf({ ...BUILD, meta: { line: "p=6&s=100", label: "", actor: "UTG", street: "preflop", acc: 0.8, source: "charts" } }).what).toBe("6-max 100bb · first in · UTG's range");
    // a record missing its fields still reads
    expect(rowOf({ id: "x", kind: "practice", startedAt: 1, decisions: 0, evLossBb: 0, meta: {} })).toMatchObject({ what: "? players · ?bb", n: 0, hands: 0 });
  });

  it("totals each kind, and full hands by pot type over the sessions that kept them", () => {
    const all = [OLD, NEW, PREFLOP, DRILL, LEAK, BUILD];
    const [practice, drill, leak, build] = kindTotals(all);
    expect(practice).toMatchObject({ kind: "practice", sessions: 3, n: 8, ok: 6, ne: 4, loss: 0.8, hands: 6, played: 5, net: 2.5 });
    expect(drill).toMatchObject({ kind: "drill", sessions: 1, n: 4, ok: 3, ne: 4 });
    expect(leak).toMatchObject({ kind: "analysis", sessions: 1, n: 2, ok: 1, ne: 0 });
    expect(build).toMatchObject({ kind: "build", sessions: 1, acc: 0.82, buildLoss: 0.04 });
    const pots = potTotals(all);
    expect(pots.rows.map((r) => [r.pot, r.hands, r.n, r.ok, r.ne, r.played, r.net])).toEqual([
      ["SRP", 2, 3, 3, 1, 1, 2.5],
      ["3bet pot", 1, 1, 0, 1, 1, 2],
    ]);
    expect([pots.without, pots.withoutHands]).toEqual([1, 3]);
    const days = byDay(all.map(rowOf));
    expect(days.map((d) => d.rows.map((r) => r.id))).toEqual([["practice-new", "build-1", "drill-1", "practice-pf"], ["leak-drill|pf:RFI"], ["practice-old"]]);
  });

  it("splits decisions by street, counts the old ones apart, says why there's no trend, and never calls EV lost a result", async () => {
    const d = (await db())!;
    await d.clear("sessions");
    await keepMistake(mistake({ id: "a", due: 1 }), (_, f) => f);
    await keepMistake(mistake({ id: "b", due: null, step: 4 }), (_, f) => f);
    await putSession({
      id: "practice-cells",
      kind: "practice",
      startedAt: at(4, 20),
      decisions: 6,
      evLossBb: 0.4,
      meta: {
        cells: {
          "preflop|charts|freq": { street: "preflop", source: "charts", byEv: false, n: 4, ok: 3, loss: 0, lossPct: 0 },
          "flop|live|ev": { street: "flop", source: "live", byEv: true, n: 2, ok: 1, loss: 0.4, lossPct: 6, versions: { "build:aaa/111": 1, "build:bbb/222": 1 } },
        },
      },
    });
    await putSession(OLD);
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <HistoryPage />
      </MemoryRouter>,
    );
    const split = await screen.findByRole("region", { name: "Decisions by street" });
    const rows = within(within(split).getByRole("table", { name: "Totals by street" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(/preflop\s*4\s*3 of 4\s*0\s*none: by frequency/i);
    expect(rows[1]).toHaveTextContent(/Preflop charts \(approximate\)/);
    expect(rows[2]).toHaveTextContent(/flop\s*2\s*1 of 2\s*2\s*0\.20bb · 3\.0% pot/i);
    expect(split).toHaveTextContent("4 decisions in 1 earlier session");
    expect(split).toHaveTextContent(/isn.t a result or a win rate/);
    const trend = screen.getByRole("region", { name: "Over time" });
    expect(within(trend).getAllByText(/^No line yet\./)).toHaveLength(2);
    expect(within(trend).queryByRole("img")).toBeNull();
    const notes = within(trend).getAllByLabelText("Versions compared").map((p) => p.textContent);
    expect(notes[0]).toMatch(/^Graded on different versions: solver build aaa\/111 and bbb\/222\. Part of a change here can be the answer's\.$/);
    expect(notes[1]).toMatch(/^Version unknown\. A version is unknown where a grade was made before versions were kept/);
    expect(screen.getByRole("link", { name: /2 mistakes kept for review, 1 due/ })).toHaveAttribute("href", "/review");
    cleanup();
    await d.clear("sessions");
    await d.clear("mistakes");
  });

  it("names a library line's pot as a hand's would be", () => {
    const m = (action: string) => ({ pos: "X", action });
    expect(linePot([m("fold"), m("raise"), m("call")])).toBe("SRP");
    expect(linePot([m("raise"), m("raise"), m("call")])).toBe("3bet pot");
    expect(linePot([m("raise"), m("raise"), m("raise"), m("all-in"), m("call")])).toBe("4bet+ pot");
    expect(linePot([m("call"), m("check")])).toBe("Limped");
  });

  describe("rates by seat and pot type", () => {
    const CELLS: SessionRecord = {
      id: "practice-seats",
      kind: "practice",
      startedAt: at(4, 20),
      decisions: 40,
      evLossBb: 3,
      meta: {
        cells: {
          a: { street: "flop", source: "live", byEv: true, seat: "BTN", pot: "SRP", n: 30, ok: 24, loss: 3, lossPct: 60 },
          b: { street: "preflop", source: "charts", byEv: false, seat: "BTN", pot: "Unopened", n: 6, ok: 5, loss: 0, lossPct: 0 },
          c: { street: "river", source: "library-turn", byEv: false, seat: "BB", pot: "SRP", n: 4, ok: 1, loss: 0, lossPct: 0 },
        },
      },
    };
    const OLDER: SessionRecord = { id: "practice-older", kind: "practice", startedAt: at(1, 20), decisions: 4, evLossBb: 0.5, meta: { hands: 3 } };
    const LEAK: SessionRecord = { id: "leak-1", kind: "analysis", startedAt: at(2, 20), decisions: 7, evLossBb: 0, meta: { score: { n: 7 } } };
    const page = async (...kept: SessionRecord[]) => {
      const d = (await db())!;
      await d.clear("sessions");
      for (const s of kept) await putSession(s);
      render(
        <MemoryRouter initialEntries={["/history"]}>
          <HistoryPage />
        </MemoryRouter>,
      );
      return screen.findByRole("region", { name: "Rates by seat and pot type" });
    };
    const rows = (box: HTMLElement, name: string) => within(within(box).getByRole("table", { name })).getAllByRole("row").slice(1);

    it("shows each seat and pot by basis, with what graded it, a count under too few, and no chart called solved", async () => {
      const box = await page(CELLS);
      const ev = rows(box, "By seat: Graded by EV");
      expect(ev).toHaveLength(1);
      expect(ev[0]).toHaveTextContent(/BTN\s*30\s*80%\s*0\.10bb · 2\.0% pot\s*Live solve 30/);
      const freq = rows(box, "By seat: Graded by frequency (no EV)");
      expect(freq[0]).toHaveTextContent(/BTN\s*6\s*5 of 6\s*Preflop charts \(approximate\) 6/);
      expect(freq[1]).toHaveTextContent(/BB\s*4\s*1 of 4/);
      expect(rows(box, "By pot type: Graded by frequency (no EV)").map((r) => r.textContent)).toEqual([expect.stringMatching(/^Unopened/), expect.stringMatching(/^SRP/)]);
      expect(rows(box, "By pot type: Graded by EV")[0]).toHaveTextContent(/SRP\s*30\s*80%/);
      expect(within(box).getAllByRole("columnheader", { name: "EV lost per decision" })).toHaveLength(2);
      expect(box).toHaveTextContent("the pot as it stood when you decided, before your own move");
      expect(box).toHaveTextContent(/isn.t a result or a win rate/);
      expect(box).toHaveTextContent("Graded by EV and graded by frequency are never added together");
      expect(box.textContent).not.toMatch(/(?<!never a )solved/i);
      cleanup();
    });

    it("says how many weren't kept, makes up no seat for them, and keeps them in the street table", async () => {
      const box = await page(CELLS, OLDER, LEAK);
      expect(box).toHaveTextContent("Seat not kept: 4 decisions in 1 session");
      expect(box).toHaveTextContent("Pot type not kept: 4 decisions in 1 session");
      expect(box).toHaveTextContent("7 leak drill decisions aren't split");
      expect(within(screen.getByRole("region", { name: "Decisions by street" })).getByRole("table")).toHaveTextContent(/flop\s*30/i);
      expect(screen.getByRole("region", { name: "Decisions by street" })).toHaveTextContent("4 decisions in 1 earlier session");
      cleanup();
      const none = await page(OLDER);
      expect(within(none).queryByRole("table")).toBeNull();
      expect(none).toHaveTextContent("No decision here keeps its seat");
      expect(none).toHaveTextContent("Seat not kept: 4 decisions in 1 session");
      cleanup();
    });

    it("filters with the page's kind, which the sessions list follows, and each scrolling table takes the keys", async () => {
      const box = await page(CELLS, OLDER, LEAK);
      const scroller = within(box).getByRole("group", { name: /^By seat: Graded by EV/ });
      expect(scroller).toHaveClass("scroll-x");
      expect(scroller).toHaveAttribute("tabindex", "0");
      fireEvent.change(within(box).getByRole("combobox", { name: "Rates from" }), { target: { value: "analysis" } });
      expect(within(box).queryByRole("table")).toBeNull();
      expect(box).toHaveTextContent("Leak drills: not split by seat or pot");
      expect(within(screen.getByRole("region", { name: "Sessions" })).getByRole("combobox", { name: "Show" })).toHaveValue("analysis");
      fireEvent.change(within(box).getByRole("combobox", { name: "Rates from" }), { target: { value: "drill" } });
      expect(box).toHaveTextContent("No decision here keeps its seat");
      fireEvent.change(within(box).getByRole("combobox", { name: "Rates from" }), { target: { value: "" } });
      expect(rows(box, "By seat: Graded by EV")).toHaveLength(1);
      cleanup();
    });

    it("draws a stored session with crafted cells, and fakes no total", async () => {
      const bad: SessionRecord = {
        id: "practice-bad",
        kind: "practice",
        startedAt: at(5, 20),
        decisions: 3,
        evLossBb: 0,
        meta: {
          cells: {
            a: { street: "flop", source: "live", byEv: true, seat: { toString: 1 }, pot: ["SRP"], n: 2, ok: 2, loss: 0, lossPct: 0 },
            b: { street: "flop", source: { a: 1 }, byEv: true, seat: "BB", pot: "SRP", n: 1, ok: 1, loss: 0, lossPct: 0 },
            c: { street: "turn", source: "live", byEv: true, seat: "BB", pot: "SRP", n: 1_000_000, ok: 1_000_000, loss: -5, lossPct: 0 },
          },
        },
      };
      const box = await page(CELLS, bad);
      expect(rows(box, "By seat: Graded by EV")).toHaveLength(1);
      expect(rows(box, "By seat: Graded by EV")[0]).toHaveTextContent(/BTN\s*30/);
      expect(box).toHaveTextContent("Seat not kept: 3 decisions in 1 session");
      expect(box.textContent).not.toContain("1000000");
      cleanup();
      await (await db())!.clear("sessions");
    });

    it("isn't drawn where nothing it reads is kept", async () => {
      const d = (await db())!;
      await d.clear("sessions");
      await putSession({ id: "b", kind: "build", startedAt: at(1, 1), decisions: 1, evLossBb: 0, meta: { acc: 0.5 } });
      render(
        <MemoryRouter initialEntries={["/history"]}>
          <HistoryPage />
        </MemoryRouter>,
      );
      await screen.findByRole("region", { name: "Sessions" });
      expect(screen.queryByRole("region", { name: "Rates by seat and pot type" })).toBeNull();
      cleanup();
      await (await db())!.clear("sessions");
    });
  });

  it("shows nothing kept yet, then every session by day with the totals, filtered by kind in the URL", async () => {
    const page = () =>
      render(
        <MemoryRouter initialEntries={["/history"]}>
          <HistoryPage />
        </MemoryRouter>,
      );
    const empty = page();
    expect(await screen.findByText(/No session kept yet/)).toBeInTheDocument();
    empty.unmount();

    for (const s of [OLD, NEW, PREFLOP, DRILL, LEAK, BUILD]) await putSession(s);
    expect((await allSessions()).map((s) => s.id)).toEqual(["practice-new", "build-1", "drill-1", "practice-pf", "leak-drill|pf:RFI", "practice-old"]);
    page();
    const totals = within(await screen.findByRole("table", { name: "Totals by kind" })).getAllByRole("row");
    expect(totals[1]).toHaveTextContent("Full hands3875%0.20bb · 2.8% pot6 · +2.5bb over 5");
    expect(totals[2]).toHaveTextContent("Drills1475%0.05bb · 1.0% pot–");
    expect(totals[3]).toHaveTextContent("Leak drills1250%––");
    expect(totals[4]).toHaveTextContent("Range builds182.0% accurate on average · 0.040bb a combo lost on average");
    const pots = screen.getByRole("region", { name: "Full hands by pot type" });
    const rows = within(within(pots).getByRole("table", { name: "Totals by pot type" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("SRP23100%0.00bb · 0.0% pot+2.5bb over 1");
    expect(rows[2]).toHaveTextContent("3bet pot110%0.30bb · 3.0% pot+2bb over 1");
    expect(pots).toHaveTextContent("1 earlier session (3 hands) was played before pot types were kept, and isn't split.");

    const label = (d: number) => new Date(at(d, 12)).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    const sessions = screen.getByRole("region", { name: "Sessions" });
    const today = within(sessions).getByRole("region", { name: label(3) });
    const items = within(today).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Full hands2 players · 100bb");
    expect(items[0]).toHaveTextContent("2 hands · 3 decisions · 67% Best or Correct · 0.15bb · 3.0% pot lost per decision · net +4.5bb");
    expect(items[0]).toHaveTextContent("Graded against: Live solve 2, Preflop charts (approximate) 1");
    expect(items[1]).toHaveTextContent("82.0% accurate · 0.040bb a combo");
    expect(within(items[1]!).getByRole("link", { name: "Open the node in Study" })).toHaveAttribute("href", `/study?${BUILD.meta.line as string}`);
    expect(within(items[2]!).getByRole("link", { name: "Drill it again" })).toHaveAttribute("href", "/practice?tab=drills&spot=srp_btn_bb&view=vsbet");
    expect(items[3]).toHaveTextContent("1 hand · 1 decision · 100% Best or Correct · no net (preflop only)");
    expect(within(sessions).getByRole("region", { name: label(1) })).toHaveTextContent("3 hands · 4 decisions · 75% Best or Correct");

    fireEvent.change(within(sessions).getByRole("combobox", { name: "Show" }), { target: { value: "analysis" } });
    await waitFor(() => expect(within(sessions).queryByRole("region", { name: label(3) })).toBeNull());
    const leak = within(sessions).getByRole("region", { name: label(2) });
    expect(within(leak).getByRole("link", { name: "Open the drill" })).toHaveAttribute("href", "/analyze?drill=pf%3ARFI");
    // (the totals stay over every session)
    expect(within(screen.getByRole("table", { name: "Totals by kind" })).getAllByRole("row")).toHaveLength(5);
  });
});
