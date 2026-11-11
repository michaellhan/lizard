// The Review page: the schedule said, the queue, a retry graded under the current answer's provenance, a changed answer
// not compared, frequency grades never EV, a damaged record counted.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/data/db";
import { keepMistake, listMistakes } from "@/data/mistakes";
import { CAPPED_WORDS } from "@/grading/grade";
import { CHART, chartMistake, LIVE, mistake, STORED } from "@/test/mistake";
import type { MistakeRecord } from "@/data/db";
import type { RetryAnswer } from "./mistakes";

const ask = vi.hoisted(() => ({ next: vi.fn<() => Promise<RetryAnswer>>(), solver: async () => ({}) }));
vi.mock("./retry", async (real) => ({ ...(await real<typeof import("./retry")>()), askAgain: () => ask.next() }));
vi.mock("@/solver/useSolver", () => ({ useSolver: () => ask.solver }));
import { ReviewPage } from "./ReviewPage";

const PAST = new Date(2020, 0, 1).getTime();
const seed = (...xs: MistakeRecord[]) => Promise.all(xs.map((m) => keepMistake(m, (_, f) => f)));
function Address() {
  return <output aria-label="address">{useLocation().search}</output>;
}
const page = (at = "/review") =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <ReviewPage />
      <Address />
    </MemoryRouter>,
  );
const answer = (x: Partial<RetryAnswer> = {}): RetryAnswer => ({ mix: mistake().mix, pot: 5.5, provenance: LIVE, ...x });

beforeEach(async () => {
  await (await db())!.clear("mistakes");
  ask.next.mockReset();
});

describe("ReviewPage", () => {
  it("opens the first due from the Plan's link, once, and takes the link from the address", async () => {
    ask.next.mockReturnValue(new Promise(() => undefined));
    await seed(mistake({ id: "a", due: PAST + 1 }), mistake({ id: "b", due: PAST }));
    page("/review?retry=next&street=flop");
    expect(await screen.findByRole("heading", { name: /Retry/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status", { name: "address" })).toHaveTextContent("?street=flop"));
  });

  it("opens nothing from that link with nothing due, and still takes it from the address", async () => {
    await seed(mistake({ due: Date.now() + 5 * 86_400_000 }));
    page("/review?retry=next");
    expect(await screen.findByText(/Nothing is due today/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status", { name: "address" })).toHaveTextContent(/^$/));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("sends you to Practice with nothing kept", async () => {
    page();
    expect(await screen.findByText(/No mistakes yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Practice" })[0]).toHaveAttribute("href", "/practice");
  });

  it("lists a mistake with its grade, EV lost, provenance, schedule and Study link", async () => {
    await seed(mistake({ due: Date.now() + 5 * 86_400_000 }));
    page();
    const list = await screen.findByRole("region", { name: "Past mistakes" });
    expect(within(list).getByText("Mistake")).toBeInTheDocument();
    expect(within(list).getByText("0.40bb lost · 7.3% pot")).toBeInTheDocument();
    expect(within(list).getAllByText(/Live/).length).toBeGreaterThan(0);
    expect(within(list).getByText(/^Due in \d days$/)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Open in Study →" })).toHaveAttribute("href", "/study?p=6&s=100");
    expect(within(list).getByRole("button", { name: /^Retry early/ })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is due today/)).toBeInTheDocument();
    expect(within(list).getByText(/1 spot: 1 graded by EV, 0 by frequency/)).toBeInTheDocument();
  });

  it("labels a chart's mistake by frequency, never EV lost or a solve", async () => {
    await seed(chartMistake({ due: PAST }));
    page();
    const list = await screen.findByRole("region", { name: "Past mistakes" });
    expect(within(list).getByText("by frequency, no EV: the chart plays it 3.0%")).toBeInTheDocument();
    expect(within(list).queryByText(/bb lost/)).toBeNull();
    expect(within(list).getAllByText(/Preflop charts/i).length).toBeGreaterThan(0);
    expect(within(list).getByText(/^Graded against (≈ )?Preflop charts \(not a solve\)/)).toBeInTheDocument();
    expect(within(list).getByText(/0 graded by EV, 1 by frequency with no EV/)).toBeInTheDocument();
  });

  it("says where Study can't open a spot", async () => {
    await seed(mistake({ study: null }));
    page();
    expect(await screen.findByText(/Study can.t set up this game/)).toBeInTheDocument();
  });

  it("retries a due spot like with like: the first grade beside this one, a step on, and it's kept", async () => {
    await seed(mistake({ due: PAST }));
    ask.next.mockResolvedValue(answer());
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
    const options = await screen.findByRole("group", { name: "Your options" });
    expect(within(options).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, ""))).toEqual(["check", "bet 33% (2bb)"]);
    expect(options.textContent).not.toMatch(/%.*%/); // no mix shown before you pick
    fireEvent.click(within(options).getByRole("button", { name: /bet 33%/ }));
    const panel = screen.getByRole("region", { name: "Retry" });
    expect(within(panel).getByText(/Same kind of answer both times/)).toBeInTheDocument();
    expect(await within(panel).findByText(/One step on: due in 3 days/)).toBeInTheDocument();
    const [m] = (await listMistakes()).list;
    expect(m).toMatchObject({ step: 1, tries: [{ verdict: "Best", ok: true, like: true, moved: true }] });
    expect(screen.queryByRole("group", { name: "Your options" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Retry" })).toBeNull();
  });

  it("takes a key, and a miss goes back", async () => {
    await seed(mistake({ due: PAST, step: 2 }));
    ask.next.mockResolvedValue(answer({ mix: [{ action: "check", freq: 0.01, ev: 4 }, { action: "bet 33%", freq: 0.99, ev: 4.4, amount: 2 }] }));
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
    await screen.findByRole("group", { name: "Your options" });
    fireEvent.keyDown(window, { key: "1" });
    expect(await screen.findByText(/One step back: due in 3 days/)).toBeInTheDocument();
    expect((await listMistakes()).list[0]).toMatchObject({ step: 1, tries: [{ ok: false, chose: "check" }] });
  });

  it("doesn't set grades side by side when the answer's source has changed, and says what changed", async () => {
    await seed(mistake({ due: PAST, provenance: STORED }));
    ask.next.mockResolvedValue(answer());
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: /bet 33%/ }));
    const panel = screen.getByRole("region", { name: "Retry" });
    expect(within(panel).getByText(/The answer has changed, so these two grades aren.t compared/)).toBeInTheDocument();
    expect(within(panel).getByText(/first graded against .*the answer now is/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/Same kind of answer/)).toBeNull();
    expect(within(panel).getByText(/Under this answer your first pick, check, grades/)).toBeInTheDocument();
    await waitFor(async () => expect((await listMistakes()).list[0]?.tries[0]?.like).toBe(false));
  });

  it("grades a chart's retry by frequency", async () => {
    const m = chartMistake({ due: PAST });
    await seed(m);
    ask.next.mockResolvedValue(answer({ mix: m.mix, pot: m.pot, provenance: CHART }));
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: /fold/ }));
    const panel = screen.getByRole("region", { name: "Retry" });
    expect(within(panel).getByText(/Same kind of answer/).textContent).toMatch(/by frequency, no EV/);
    expect(within(panel).queryByText(/bb lost/)).toBeNull();
  });

  it("leaves the schedule alone on a retry before its day", async () => {
    const m = mistake({ due: Date.now() + 5 * 86_400_000 });
    await seed(m);
    ask.next.mockResolvedValue(answer());
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^Retry early/ }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: /bet 33%/ }));
    expect(await screen.findByText(/Before its day, so its date doesn.t move/)).toBeInTheDocument();
    expect((await listMistakes()).list[0]).toMatchObject({ step: 0, due: m.due, tries: [{ moved: false }] });
  });

  it("says when there's no answer to grade against, moves nothing, and can ask again", async () => {
    await seed(mistake({ due: PAST }));
    ask.next.mockRejectedValueOnce(new Error("this library doesn't hold it any more"));
    ask.next.mockResolvedValueOnce(answer());
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/doesn't hold it any more.*Nothing has changed on its schedule/);
    expect((await listMistakes()).list[0]).toMatchObject({ step: 0, tries: [] });
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(await screen.findByRole("group", { name: "Your options" })).toBeInTheDocument();
  });

  it("goes on to the next one due", async () => {
    await seed(mistake({ id: "a", due: PAST }), chartMistake({ id: "b", due: PAST + 1 }));
    ask.next.mockResolvedValue(answer());
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: /bet 33%/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Next one due" }));
    expect(await within(screen.getByRole("region", { name: "Retry" })).findByText(/^preflop · missed/)).toBeInTheDocument();
  });

  describe("an entry from Analyze", () => {
    const keptAsk = { via: "kept", hand: "h1", decision: "h1|turn|1" } as const;
    const provenance = { ...LIVE, transport: "kept", keptLabel: "Live solve (Quick) · medium confidence" } as const;
    const kept = (x: Partial<MistakeRecord> = {}) => mistake({ id: "k", from: "analyze", ask: keptAsk, provenance, due: PAST, ...x });

    it("says a grade stopped at Inaccuracy by a rough solve, in its row and beside the retry", async () => {
      ask.next.mockImplementation(async () => answer({ provenance }));
      const capped = { ...kept().grade, verdict: "Inaccuracy", loss: 2, lossPct: 30, capped: true } as const;
      await seed(kept({ grade: capped }));
      page();
      const row = await screen.findByText(CAPPED_WORDS);
      expect(row).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
      fireEvent.click(within(await screen.findByRole("group", { name: "Your options" })).getByRole("button", { name: /check/ }));
      expect(await screen.findByText(`Your first grade: ${CAPPED_WORDS}`)).toBeInTheDocument();
    });

    it("says nothing of a cap on a grade that wasn't", async () => {
      await seed(kept());
      page();
      await screen.findByText(/Added from Analyze/);
      expect(screen.queryByText(CAPPED_WORDS)).toBeNull();
    });

    it("says where it came from, keeps its provenance and links to its hand", async () => {
      await seed(kept(), kept({ id: "l", from: "leak", hole: ["Qh", "Qd"], times: 3 }));
      page();
      expect(await screen.findByText(/Added from Analyze/)).toBeInTheDocument();
      expect(screen.getByText(/From a leak drill/)).toBeInTheDocument();
      expect(screen.getByText(/missed 3 times/)).toBeInTheDocument();
      expect(screen.getAllByText(/Live solve \(Quick\) · medium confidence/).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: "Open the hand →" })[0]).toHaveAttribute("href", "/analyze?hand=h1");
    });

    it("retries against the answer kept, says so, and says it's the same answer", async () => {
      ask.next.mockImplementation(async () => answer({ provenance }));
      await seed(kept());
      page();
      fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
      expect(await screen.findByText(/Against the answer kept in Analyze; nothing solved/)).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: /bet 33%/ }));
      expect(await screen.findByText(/The same answer both times/)).toBeInTheDocument();
      await waitFor(async () => expect((await listMistakes()).list[0]).toMatchObject({ step: 1 }));
    });
  });

  describe("deleting an entry", () => {
    const two = () => seed(mistake({ id: "a", due: PAST, hole: ["Ah", "Kd"] }), mistake({ id: "b", due: PAST + 1, hole: ["Qh", "Qd"] }));

    it("asks once more, then it's gone, says so, and the keyboard goes to the row in its place", async () => {
      await two();
      page();
      fireEvent.click(await screen.findByRole("button", { name: "Delete: Ah Kd, flop" }));
      expect((await listMistakes()).list).toHaveLength(2);
      fireEvent.click(screen.getByRole("button", { name: "Delete this entry" }));
      await waitFor(async () => expect((await listMistakes()).list.map((m) => m.id)).toEqual(["b"]));
      expect(await screen.findByText("Entry deleted.")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("button", { name: "Delete: Ah Kd, flop" })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete: Qh Qd, flop" }).closest("li")));
    });

    it("keeps it on Keep", async () => {
      await two();
      page();
      fireEvent.click(await screen.findByRole("button", { name: "Delete: Ah Kd, flop" }));
      fireEvent.click(screen.getByRole("button", { name: "Keep" }));
      expect(screen.queryByRole("button", { name: "Delete this entry" })).toBeNull();
      expect((await listMistakes()).list).toHaveLength(2);
    });

    it("closes a retry open on it", async () => {
      ask.next.mockReturnValue(new Promise(() => undefined));
      await seed(mistake({ id: "a", due: PAST }));
      page();
      fireEvent.click(await screen.findByRole("button", { name: "Retry the next one" }));
      expect(await screen.findByRole("heading", { name: /Retry/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Delete: Ah Kd, flop" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete this entry" }));
      await waitFor(() => expect(screen.queryByRole("heading", { name: /Retry/ })).toBeNull());
      expect(await screen.findByText(/No mistakes yet/)).toBeInTheDocument();
    });
  });

  it("counts a damaged record and shows the rest", async () => {
    await seed(mistake({ id: "good" }));
    await (await db())!.put("mistakes", { id: "bad", street: "flop", due: 1, lastAt: 2 } as never);
    page();
    expect(await screen.findByText(/1 record kept here couldn.t be read, and is left out/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Past mistakes" })).toBeInTheDocument();
  });

  it("filters by street and shows more on request", async () => {
    await seed(...Array.from({ length: 33 }, (_, i) => mistake({ id: `m${i}`, lastAt: i })), chartMistake());
    page();
    const list = await screen.findByRole("region", { name: "Past mistakes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(30);
    fireEvent.click(within(list).getByRole("button", { name: "Show 4 more of 4" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(34);
    fireEvent.change(within(list).getByRole("combobox", { name: "Street" }), { target: { value: "preflop" } });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("takes focus to the retry, and hands it back to what opened it", async () => {
    await seed(mistake({ due: PAST }));
    ask.next.mockReturnValue(new Promise(() => {}));
    page();
    const row = await screen.findByRole("button", { name: /^Retry: / });
    row.focus();
    fireEvent.click(row);
    const panel = await screen.findByRole("region", { name: "Retry" });
    expect(panel).toHaveFocus();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Retry: / })).toHaveFocus();
  });
});
