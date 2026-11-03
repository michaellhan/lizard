// The drills panel on entries of the solver snapshot's library (src/test/library.ts), read through a stubbed fetch: a hand dealt, your
// pick graded against the stored answer with its provenance, the keys, the texture filter, the score kept.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { libFile } from "@/test/library";
import { recentSessions } from "@/data/db";
import { listDrills } from "@/data/saved";
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
    expect(within(screen.getByRole("region", { name: "Answer" })).getByRole("row", { name: /^bet 33% \(1\.82bb\) ← you/ })).toBeInTheDocument();
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
});
