// The Plan page: built once from what's kept, each step a link, the rule on the page, and no plan to read as a solve.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, putSession, type DecisionRecord, type HandRecord, type MistakeRecord } from "@/data/db";
import { keepMistake } from "@/data/mistakes";
import type { LibraryFiles } from "@/library/files";
import { mistake } from "@/test/mistake";

const count = vi.hoisted(() => ({ n: 0 }));
vi.mock("./plan", async (real) => {
  const m = await real<typeof import("./plan")>();
  return {
    ...m,
    buildPlan: (x: Parameters<typeof m.buildPlan>[0]) => {
      count.n++;
      return m.buildPlan(x);
    },
  };
});
import { PlanPage } from "./PlanPage";

const NOW = Date.now();
const page = (files?: LibraryFiles) =>
  render(
    <MemoryRouter initialEntries={["/plan"]}>
      <PlanPage files={files ?? ({ index: async () => ({ spots: [] }) } as unknown as LibraryFiles)} />
    </MemoryRouter>,
  );
const hand = (id: string, x: Partial<HandRecord> = {}) => ({ id, site: "PokerStars", number: id, hero: "BTN", playedAt: 1, importedAt: 1, importId: "i1", text: "", ...x }) as HandRecord;
let k = 0;
const decision = (o: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: `d${k++}`,
  handId: "h1",
  street: "flop",
  i: 0,
  pos: "BTN",
  action: "bet 1.8",
  situation: "SRP · IP · checked to",
  role: "PFR",
  facing: false,
  multi: false,
  ip: true,
  mix: [["check", 0.6, 3.1], ["bet 33%", 0.4, 2.1]],
  verdict: "Mistake",
  evLossBb: 1,
  lossPct: 10,
  pot: 5.5,
  source: "library",
  label: "Precomputed solution · srp_btn_bb",
  gradedAt: 0,
  ...o,
}) as DecisionRecord;
const seed = async (hands: HandRecord[], ds: DecisionRecord[], ms: MistakeRecord[] = []) => {
  const d = (await db())!;
  for (const h of hands) await d.put("hands", h);
  for (const x of ds) await d.put("decisions", x);
  await Promise.all(ms.map((m) => keepMistake(m, (_, f) => f)));
};

beforeEach(async () => {
  const d = (await db())!;
  await Promise.all([d.clear("mistakes"), d.clear("hands"), d.clear("decisions"), d.clear("sessions")]);
  count.n = 0;
});

describe("PlanPage", () => {
  it("says what to do first with nothing kept", async () => {
    page();
    const start = await screen.findByRole("region", { name: "Start here" });
    expect(within(start).getByText(/Nothing kept yet/)).toBeInTheDocument();
    expect(within(start).getByRole("link", { name: "Play hands in Practice" })).toHaveAttribute("href", "/practice");
    expect(within(start).getByRole("link", { name: "Import hands in Analyze" })).toHaveAttribute("href", "/analyze");
    expect(screen.queryByRole("region", { name: "How this plan is made" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Leaks" })).toBeNull();
  });

  it("lists each part in order with its link, and the next step as the current one", async () => {
    await seed([hand("h1")], Array.from({ length: 40 }, () => decision()), [mistake({ due: NOW - 1000 })]);
    page();
    const next = await screen.findByRole("status", { name: "Next step" });
    expect(within(next).getByRole("link", { name: "Retry 1 due review" })).toHaveAttribute("href", "/review?retry=next");
    const reviews = screen.getByRole("region", { name: "Reviews due" });
    expect(within(reviews).getByRole("listitem", { name: "Reviews due today" })).toHaveAttribute("aria-current", "step");
    const leaks = screen.getByRole("region", { name: "Leaks" });
    const link = within(leaks).getAllByRole("link", { name: /^Drill this leak: / })[0]!;
    expect(link.getAttribute("href")).toMatch(/^\/analyze\?drill=.*game=equilibrium/);
    expect(within(leaks).getAllByText(/of solver EV given up over 40 decisions graded by EV/).length).toBeGreaterThan(0);
    const drill = screen.getByRole("region", { name: "Practice drill" });
    expect(within(drill).getByRole("link", { name: "Practice the flop from BTN" })).toHaveAttribute("href", "/practice?play=srp&seat=BTN&players=6&stack=100");
    expect(within(drill).getByRole("button", { name: /Save scenario/ })).toBeInTheDocument();
  });

  it("doesn't call a leak with nothing to deal done", async () => {
    await seed([hand("h1")], Array.from({ length: 40 }, () => decision({ mix: undefined, verdict: "Correct" })));
    page();
    const said = await screen.findByRole("status", { name: "Next step" });
    expect(said).toHaveTextContent(/Nothing to start: the open leak keeps no mix/);
    expect(said).not.toHaveTextContent(/marked done/);
  });

  it("marks a step done by what's kept, and a press changes nothing", async () => {
    await seed([hand("h1")], [decision()], [mistake({ due: NOW - 1000 })]);
    page();
    const reviews = await screen.findByRole("listitem", { name: "Reviews due today" });
    expect(within(reviews).queryByText("Done")).toBeNull();
    fireEvent.click(within(reviews).getByRole("link", { name: /Retry 1 due review/ }));
    expect(within(reviews).queryByText("Done")).toBeNull();
  });

  it("shows a drill done from a session kept today", async () => {
    await seed([hand("h1")], [decision({ street: "preflop", situation: "RFI" })]);
    await putSession({ id: "s1", kind: "practice", startedAt: NOW, endedAt: NOW, decisions: 20, evLossBb: 0, meta: { seat: "BTN", preflopOnly: true } });
    page();
    const row = await screen.findByRole("listitem", { name: "Practice preflop from BTN" });
    expect(within(row).getByText("Done")).toBeInTheDocument();
    expect(within(row).getByText("20 of 20 decisions today.")).toBeInTheDocument();
  });

  it("says a preflop leak is by frequency against the charts, not a solve", async () => {
    await seed(
      [hand("h1")],
      Array.from({ length: 40 }, () => decision({ street: "preflop", situation: "RFI", evLossBb: null, lossPct: null, source: "charts", label: "Preflop charts · approximate", mix: [["fold", 1, null]], action: "raise to 2.5", matched: "raise", freq: 0, best: "fold", bestFreq: 1 })),
    );
    page();
    const row = await screen.findByRole("listitem", { name: "RFI" });
    expect(within(row).getByText(/against the preflop charts, by frequency, not a solve/)).toBeInTheDocument();
  });

  it("says the rows too few to read aren't leaks, and shows the rest on a press", async () => {
    const sits = Array.from({ length: 8 }, (_, i) => `Pot ${i} · IP · checked to`);
    await seed([hand("h1")], sits.flatMap((situation) => Array.from({ length: 12 }, () => decision({ situation }))));
    page();
    const thin = await screen.findByRole("region", { name: "Too few to read" });
    expect(within(thin).getByText(/Not leaks: too few decisions yet/)).toBeInTheDocument();
    expect(within(thin).getAllByRole("listitem").length).toBe(6);
    fireEvent.click(within(thin).getByRole("button", { name: /^Show \d+ more$/ }));
    expect(within(thin).getAllByRole("listitem").length).toBeGreaterThan(6);
    expect(within(thin).getAllByRole("link", { name: "Import more hands" })[0]).toHaveAttribute("href", "/analyze");
  });

  it("says what it left out", async () => {
    await seed([hand("t", { tournament: "Practice" })], [decision({ handId: "t" })], [mistake({ due: NOW + 86_400_000 })]);
    page();
    expect(await screen.findByText(/1 graded decision in tournament hands/)).toBeInTheDocument();
  });

  it("builds the plan once, whatever re-renders it", async () => {
    await seed([hand("h1")], Array.from({ length: 12 }, () => decision()));
    const { rerender } = page();
    await screen.findByRole("status", { name: "Next step" });
    for (let i = 0; i < 3; i++)
      rerender(
        <MemoryRouter initialEntries={["/plan"]}>
          <PlanPage files={{ index: async () => ({ spots: [] }) } as unknown as LibraryFiles} />
        </MemoryRouter>,
      );
    const thin = await screen.findByRole("region", { name: "Too few to read" });
    fireEvent.click(thin);
    expect(count.n).toBe(1);
  });

  it("reads the library for a flop drill, and stays with hands if it can't", async () => {
    await seed([hand("h1")], [decision()]);
    const spots = [{ id: "srp_btn_bb", label: "BTN vs BB", seats: ["BB", "BTN"], flops: { a: "x" }, report: "r" }];
    const { unmount } = page({ index: async () => ({ spots }) } as unknown as LibraryFiles);
    const drillLink = () => within(screen.getByRole("region", { name: "Practice drill" })).getByRole("link", { name: "Practice the flop from BTN" });
    await waitFor(() => expect(drillLink()).toHaveAttribute("href", "/practice?tab=drills&spot=srp_btn_bb&view=ip"));
    expect(screen.getByRole("button", { name: /Save drill/ })).toBeInTheDocument();
    unmount();
    page({ index: async () => Promise.reject(new Error("offline")) } as unknown as LibraryFiles);
    await screen.findByRole("region", { name: "Practice drill" });
    expect(drillLink()).toHaveAttribute("href", "/practice?play=srp&seat=BTN&players=6&stack=100");
  });
});
