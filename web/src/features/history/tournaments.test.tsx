// A tournament's sessions in History: each under the kind of what its EVs are in, in no total with a cash session's, with
// no net, and in words saying what they're in.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { allSessions, db, putSession, type SessionRecord } from "@/data/db";
import { kindLabel, kindTotals, kindUnit, potTotals, rowOf } from "./history";
import { HistoryPage } from "./HistoryPage";
import { streetTotals, trends } from "./progress";

const AT = new Date(2026, 10, 3, 20).getTime();
const cell = (byEv: boolean, loss: number) => ({ street: "flop", source: "live", byEv, n: 2, ok: 1, loss, lossPct: 5 });
const byPot = { SRP: { hands: 2, n: 3, ok: 2, ne: 2, loss: 1, lossPct: 5, played: 2, net: 9 } };
const session = (id: string, kind: SessionRecord["kind"], loss: number, meta: Record<string, unknown>): SessionRecord => ({
  id,
  kind,
  startedAt: AT,
  decisions: 2,
  evLossBb: loss,
  meta: { hands: 2, net: 9, ok: 2, graded: 2, lossPct: 5, players: 3, stack: 20, seat: "moves", byPot, sources: { live: 3 }, cells: { a: cell(true, loss) }, ...meta },
});
const CASH = session("cash", "practice", 1, {});
const PRIZE = session("prize", "tournament", 2, { tournament: { model: "icm", payouts: [50, 30, 20], field: { players: 6, avg: 20 }, stacks: { BTN: 25, SB: 8, BB: 30 } } });
const CHIPS = session("chips", "tournament-chips", 4, { tournament: { model: "chips", stacks: { BTN: 25, SB: 8, BB: 30 } } });
const ALL = [CASH, PRIZE, CHIPS];

beforeEach(async () => {
  await (await db())!.clear("sessions");
});

describe("an exploit session", () => {
  const READ = session("read", "exploit", 8, { exploit: { profile: "nit", lock: { fold: 15, bluff: -60 } }, pot: "srp", sources: { "best-response": 3 } });

  it("has a row of its own, in no total with an equilibrium's, and says so", async () => {
    expect(kindTotals([CASH, READ]).map((x) => [x.kind, x.loss, x.net])).toEqual([
      ["practice", 1, 9],
      ["exploit", 8, 0],
    ]);
    expect(potTotals([CASH, READ]).rows.find((r) => r.pot === "SRP")).toMatchObject({ loss: 1, hands: 2 });
    expect(streetTotals([CASH, READ]).rows).toEqual([expect.objectContaining({ n: 2, loss: 1 })]);
    await putSession(READ);
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Exploit sessions have their own row and go in no other totals here/)).toBeInTheDocument();
    expect(screen.getAllByText("Exploiting an assumed profile").length).toBeGreaterThan(0);
    expect(screen.getByText(/Nit \(assumed: folds \+15 pts to bets, bluffs -60%\) · 3 players · 20bb · single-raised pots/)).toBeInTheDocument();
    expect(screen.queryByText(/net \+9/)).toBeNull();
  });
});

describe("the totals", () => {
  it("keeps each kind's EV lost apart", () => {
    const t = kindTotals(ALL);
    expect(t.map((x) => [x.kind, x.loss])).toEqual([
      ["practice", 1],
      ["tournament", 2],
      ["tournament-chips", 4],
    ]);
  });

  it("counts a tournament's hands and no net", () => {
    const t = kindTotals(ALL).find((x) => x.kind === "tournament")!;
    expect(t).toMatchObject({ hands: 2, net: 0, played: 0 });
  });

  it("leaves tournaments out of the totals by pot and by street, which are in bb", () => {
    expect(potTotals(ALL).rows.find((r) => r.pot === "SRP")).toMatchObject({ loss: 1, net: 9, hands: 2 });
    const st = streetTotals(ALL);
    expect(st.rows).toEqual([expect.objectContaining({ street: "flop", n: 2, loss: 1 })]);
    expect(st.apartSessions).toBe(0);
    expect(trends(ALL).flatMap((t) => [t.n, t.sessions])).toEqual([2, 1]);
  });

  it("says what each kind's EVs are in", () => {
    expect(kindUnit("tournament")).toBe("bb of prize equity");
    expect(kindUnit("tournament-chips")).toBe("bb");
    expect(kindUnit("practice")).toBe("bb");
    expect(kindLabel("tournament")).toBe("Tournaments in prize equity");
    expect(kindLabel("tournament-chips")).toBe("Tournaments in chip EV");
  });
});

describe("a row", () => {
  it("says the game, with no net", () => {
    const r = rowOf(PRIZE);
    expect(r.what).toContain("stacks BTN 25, SB 8, BB 30");
    expect(r.what).toMatch(/50/);
    expect(r.hands).toBe(2);
    expect(r.net).toBeUndefined();
  });

  it("names a chip EV session with no prizes", () => {
    expect(rowOf(CHIPS).what).toBe("3 players · stacks BTN 25, SB 8, BB 30");
    expect(rowOf(CHIPS).net).toBeUndefined();
  });

  it("names the push/fold mode, in Practice", () => {
    expect(rowOf(session("pf", "practice", 0, { pushFold: true, stack: 12 })).what).toBe("3 players · 12bb · push/fold");
  });

  it("reads a damaged game as nothing said", () => {
    expect(() => rowOf(session("x", "tournament", 0, { tournament: "no" }))).not.toThrow();
    expect(() => rowOf(session("y", "tournament", 0, { tournament: { payouts: "no", stacks: 3 } }))).not.toThrow();
  });
});

describe("the page", () => {
  it("has a row for each, in its unit, and says why they're apart", async () => {
    for (const s of ALL) await putSession(s);
    expect((await allSessions()).map((s) => s.kind).sort()).toEqual(["practice", "tournament", "tournament-chips"]);
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <HistoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Tournaments each have their own row/)).toBeInTheDocument();
    const row = screen.getAllByText("Tournaments in prize equity").map((n) => n.closest("tr")).find(Boolean)!;
    expect(within(row).getByText(/bb of prize equity/)).toBeInTheDocument();
  });
});
