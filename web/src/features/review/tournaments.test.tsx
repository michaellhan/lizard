// A tournament's kept mistakes: what they're in, a chip EV one kept apart from the same spot in cash, a retry stamped and
// graded as the first was, and a list of their own on the Review page.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/data/db";
import { keepMistake, readMistake } from "@/data/mistakes";
import { CHIP_MODEL, newHand, type Decision } from "@/features/practice/practice";
import { evUnit } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import { LIVE, mistake } from "@/test/mistake";
import { costWords, handMistake, retried, type RetryAnswer } from "./mistakes";

vi.mock("@/solver/useSolver", () => ({ useSolver: () => async () => ({}) }));
import { LIST_PAGE as LIST, ReviewPage } from "./ReviewPage";

const OPTS = { seat: "BTN", preflopOnly: false, pot: null, ante: 0, straddle: false, carry: false, sizes: null, rake: 0, rakeCap: 0 };
const STACKS = { BTN: 25, SB: 8, BB: 30 };
const PRIZE: Provenance = { ...LIVE, evIn: "prize", tournament: "prize-equity solve (ICM)" };
const mix = [
  { action: "check", freq: 0.1, ev: 2.5 },
  { action: "bet 33%", freq: 0.9, ev: 2.9, amount: 2 },
];
const decision = (provenance: Provenance): Decision => ({
  street: "flop",
  chose: "check",
  move: { pos: "BTN", action: "check" },
  grade: { a: 0, best: 1, verdict: "Mistake", ok: false, mixed: false, loss: 0.4, lossPct: 7.3, byEv: true },
  mix,
  pot: 5.5,
  provenance,
  study: "p=3&s=20",
});

describe("handMistake", () => {
  it("says the game it came from", () => {
    const icm = newHand(3, 20, 0, 1, { ...OPTS, tournament: { model: "icm", stacks: STACKS, payouts: [50, 30, 20] } });
    expect(handMistake("t", icm, decision(PRIZE), 1)?.tournament).toBe("icm");
    const chips = newHand(3, 20, 0, 1, { ...OPTS, tournament: { model: "chips", stacks: STACKS } });
    expect(handMistake("t", chips, decision({ ...LIVE, tournament: CHIP_MODEL }), 1)?.tournament).toBe("chips");
    expect(handMistake("t", newHand(3, 20, 0, 1, OPTS), decision(LIVE), 1)?.tournament).toBeUndefined();
  });

  it("keeps a chip EV mistake apart from the same spot in cash, whose EVs go in the bb totals", () => {
    const chips = newHand(3, 20, 0, 1, { ...OPTS, tournament: { model: "chips", stacks: STACKS } });
    const cash = newHand(3, 20, 0, 1, OPTS);
    expect(handMistake("t", chips, decision(LIVE), 1)?.id).not.toBe(handMistake("t", cash, decision(LIVE), 1)?.id);
  });
});

describe("the words", () => {
  it("say the unit", () => {
    const g = { byEv: true, loss: 0.4, lossPct: 7.3, a: 0 };
    expect(costWords(g, mix, "live", evUnit(PRIZE))).toBe("0.40bb of prize equity lost · 7.3% pot");
    expect(costWords(g, mix, "live")).toBe("0.40bb lost · 7.3% pot");
  });
  it("say the model where it's graded by frequency, with no EV", () => {
    expect(costWords({ byEv: false, loss: 0, lossPct: 0, a: 0 }, [{ action: "fold", freq: 0.2, ev: null }], "push-fold")).toMatch(/push\/fold model/);
  });
});

describe("a retry", () => {
  const answer = (x: Partial<RetryAnswer> = {}): RetryAnswer => ({ mix, pot: 5.5, provenance: LIVE, ...x });

  it("stamps a chip EV spot's answer as the first was, so the two can be compared", () => {
    const m = mistake({ tournament: "chips", provenance: { ...LIVE, tournament: CHIP_MODEL } });
    const r = retried(m, answer(), 1, 2);
    expect(r.decision.provenance?.tournament).toBe(CHIP_MODEL);
    expect(r.change).toEqual([]);
  });

  it("grades a prize-equity spot's chip fallback by frequency", () => {
    const m = mistake({ tournament: "icm", provenance: PRIZE });
    const r = retried(m, answer({ provenance: { ...LIVE, source: "rules", approximate: true, evIn: "chips" } }), 0, 2);
    expect(r.grade.byEv).toBe(false);
    expect(r.decision.mix.every((a) => a.ev === null)).toBe(true);
  });
});

describe("the record", () => {
  it("reads a tournament's back, and a kind it doesn't know as damaged", () => {
    expect(readMistake(mistake({ tournament: "icm", provenance: PRIZE }))?.tournament).toBe("icm");
    expect(readMistake(mistake({ provenance: { ...LIVE, source: "push-fold", approximate: true } }))).not.toBeNull();
    expect(readMistake({ ...mistake(), tournament: "pko" })).toBeNull();
  });
});

describe("ReviewPage", () => {
  beforeEach(async () => {
    await (await db())!.clear("mistakes");
  });
  const seed = (...xs: ReturnType<typeof mistake>[]) => Promise.all(xs.map((m) => keepMistake(m, (_, f) => f)));
  const page = () =>
    render(
      <MemoryRouter initialEntries={["/review"]}>
        <ReviewPage />
      </MemoryRouter>,
    );
  const FAR = Date.now() + 5 * 86_400_000;

  it("lists a tournament's mistakes on their own, saying what they're in", async () => {
    await seed(mistake({ due: FAR }), mistake({ id: "hand|t", due: FAR, tournament: "icm", provenance: PRIZE }));
    page();
    const own = await screen.findByRole("region", { name: "Tournament mistakes" });
    expect(within(own).getByText("0.40bb of prize equity lost · 7.3% pot")).toBeInTheDocument();
    const past = screen.getByRole("region", { name: "Past mistakes" });
    expect(within(past).getByText("0.40bb lost · 7.3% pot")).toBeInTheDocument();
    expect(within(past).queryByText(/prize equity lost/)).toBeNull();
  });

  it("shows the rest of a long list when asked", async () => {
    await seed(...Array.from({ length: LIST + 1 }, (_, i) => mistake({ id: `hand|t${i}`, due: FAR, tournament: "icm", provenance: PRIZE })));
    page();
    const own = await screen.findByRole("region", { name: "Tournament mistakes" });
    fireEvent.click(within(own).getByRole("button", { name: "Show 1 more of 1" }));
    expect(within(own).getAllByRole("listitem")).toHaveLength(LIST + 1);
  });

  it("has no list of cash mistakes with only tournaments", async () => {
    await seed(mistake({ id: "hand|t", due: FAR, tournament: "chips", provenance: { ...LIVE, tournament: CHIP_MODEL } }));
    page();
    expect(await screen.findByRole("region", { name: "Tournament mistakes" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Past mistakes" })).toBeNull();
  });
});
