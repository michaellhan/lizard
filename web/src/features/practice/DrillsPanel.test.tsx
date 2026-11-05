// The drills panel on entries of the solver snapshot's library (src/test/library.ts), read through a stubbed fetch: a hand dealt, your
// pick graded against the stored answer with its provenance, the keys, the texture filter, the score kept.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { libFile } from "@/test/library";
import { recentSessions } from "@/data/db";
import { deleteDrill, listDrills, putDrill } from "@/data/saved";
import { LibraryFiles } from "@/library/files";
import { seeded } from "@/poker/table";
import { DrillsPanel } from "./DrillsPanel";

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
const suitOf = (img: HTMLElement) => img.getAttribute("aria-label")!.split(" of ")[1];

describe("DrillsPanel", () => {
  it("deals a hand at the spot's node, grades your pick against the stored answer, and deals again on a key", async () => {
    open("spot=srp_btn_bb&view=oop");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(within(options).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, ""))).toEqual(["check", "bet 33% (1.82bb)", "bet 75% (4.13bb)"]);
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    expect(within(screen.getByRole("group", { name: "Your cards" })).getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("BB to act first · pot 5.5bb")).toBeInTheDocument();
    expect(screen.getByText(/7 flops stored; 7 store this decision\./)).toBeInTheDocument();

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

    // Enter: the next hand; a number key answers it
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Answer" })).toBeNull());
    await screen.findByRole("group", { name: "Your options" });
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Your options" })).getAllByRole("button")[0]).toBeEnabled());
    fireEvent.keyDown(window, { key: "2" });
    expect(within(await screen.findByRole("region", { name: "Answer" })).getByRole("row", { name: /^bet 33% \(1\.82bb\) ← you/ })).toBeInTheDocument();
  });

  it("in position facing out of position's first bet (the 3-bet pot's c-bet): the bet said, Study at it", async () => {
    open("spot=3bp_bb_btn&view=ipvsbet");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(within(options).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, "")).slice(0, 2)).toEqual(["fold", expect.stringMatching(/^call [\d.]+bb$/)]);
    expect(screen.getByText(/^BB bets (33|75)% \([\d.]+bb\) · pot [\d.]+bb$/)).toBeInTheDocument();
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
    expect(screen.getByText(/^BB checks, BTN bets (33|75)% \(\d+(\.\d+)?bb\) · pot \d+(\.\d+)?bb$/)).toBeInTheDocument();
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
    expect(screen.getByRole("combobox", { name: "Street" })).toHaveDisplayValue("Turn");
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB first to act on the turn");
    expect(within(screen.getByRole("combobox", { name: "Decision" })).getAllByRole("option")).toHaveLength(2);
    expect(within(options).getAllByRole("button").map((b) => b.textContent?.replace(/^\d/, "").replace(/ \(.*/, ""))).toEqual(["check", "bet 75%"]);
    expect(screen.getByText(/^On the flop .*\. BB to act first on the turn · pot \d+(\.\d+)?bb$/)).toBeInTheDocument();
    expect(screen.getByText(/7 flops stored; 7 store their turns\./)).toBeInTheDocument();
    expect(asked.slice(before).some((p) => p.endsWith(".turn.bin"))).toBe(true);
    // (only what's stored: the river isn't offered)
    expect(within(screen.getByRole("combobox", { name: "Street" })).getByRole("option", { name: "River (none stored)" })).toBeDisabled();

    fireEvent.click(within(options).getByRole("button", { name: /^.?check$/ }));
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getByText(/^(Best|Correct|Inaccuracy|Mistake)$/)).toBeInTheDocument();
    expect(within(answer).getByText(/^Stored turn from the flop library · srp_btn_bb · the precomputed flop solve's view of this turn, in 5% steps \(one bet size, 75%\) · approximate$/)).toBeInTheDocument();
    expect(within(answer).getByText(/Graded by how often your hand plays each action: no EV is stored for it, so none is counted as lost\./)).toBeInTheDocument();
    // no EV column: a format-1 file holds none
    expect(within(answer).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Action", "Played"]);
    expect(within(answer).getByRole("link", { name: "Open in Study →" }).getAttribute("href")).toMatch(/&b=([2-9TJQKA][shdc]){4}/);
    expect(within(screen.getByRole("region", { name: "Score" })).getByText("EV lost a decision").nextSibling).toHaveTextContent("–");
  });

  it("a 3-bet pot's turn file shows the range's EV by action, marked as not your hand's, and in position after a check", async () => {
    open("spot=3bp_bb_btn&street=turn&view=ip");
    const options = await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByText(/BB checks the turn · pot/)).toBeInTheDocument();
    fireEvent.click(within(options).getAllByRole("button")[0]!);
    const answer = screen.getByRole("region", { name: "Answer" });
    expect(within(answer).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Action", "Played", "Range’s EV bb"]);
    expect(within(answer).getByText(/not your hand's, and not what's graded/)).toBeInTheDocument();
  });

  it("says a spot with no stored turns has none, and doesn't deal one", async () => {
    const before = asked.length;
    open("spot=srp_co_bb&street=turn");
    await screen.findByText(/stores no turn in this library: pick another spot, or the flop\./, undefined, { timeout: 5000 });
    expect(within(screen.getByRole("combobox", { name: "Street" })).getByRole("option", { name: "Turn (none stored for this spot)" })).toBeDisabled();
    expect(asked.slice(before).filter((p) => p.endsWith(".bin"))).toEqual([]);
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
    expect(await screen.findByText(/Quads or better: \d+ of \d+ deals match on the 1 flop.*Too few: the same hands will keep coming back\./, undefined, { timeout: 5000 })).toBeInTheDocument();
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
    expect(screen.getByRole("combobox", { name: "Street" })).toHaveDisplayValue("Turn");
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveDisplayValue("Gutshot");
    expect(screen.getByRole("combobox", { name: "Suits" })).toHaveDisplayValue("Monotone");
  });

  it("a drill saved before streets and hand filters opens as it was: the flop, no filter, and still the saved one", async () => {
    const to = "/practice?tab=drills&spot=srp_btn_bb&view=ip&pair=unpaired";
    await putDrill({ id: "old", name: "Old drill", kind: "library", to, about: "from before", note: "", createdAt: 1, updatedAt: 1 });
    open("spot=srp_btn_bb&view=ip&pair=unpaired");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(await screen.findByRole("button", { name: "★ Saved drill" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Street" })).toHaveDisplayValue("Flop");
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveDisplayValue("Any");
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    await deleteDrill("old");
  });

  it("a street or hand the URL can't mean is ignored; a turn with a flop's facing-a-bet decision starts out of position", async () => {
    open("spot=srp_btn_bb&street=river&view=oop&hand=m:nonsense");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByRole("combobox", { name: "Street" })).toHaveDisplayValue("Flop");
    expect(screen.getByRole("combobox", { name: "Hands" })).toHaveDisplayValue("Any");
    cleanup();
    open("spot=srp_btn_bb&street=turn&view=vsbet");
    await screen.findByRole("group", { name: "Your options" }, { timeout: 5000 });
    expect(screen.getByRole("combobox", { name: "Decision" })).toHaveDisplayValue("BB first to act on the turn");
  });
});
