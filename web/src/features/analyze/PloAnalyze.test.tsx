import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { addPloHands, deletePloHands, listPloHands, putPloGrade } from "@/data/ploHands";
import { PLO } from "@/features/plo/fromHistory.test.fixture";
import { prepare } from "./analyze";
import { AnalyzePage } from "./AnalyzePage";
import { readOmahaFiles } from "./PloAnalyze";
import { GG_PLO } from "./omaha.test.fixture";

const HOLDEM = PLO.replace("Omaha Pot Limit", "Hold'em No Limit").replace("[Ah Qd Js Td]", "[Ah Qd]");

const open = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/analyze${search}`]}>
      <Routes>
        <Route path="/analyze" element={<AnalyzePage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await deletePloHands();
});

describe("PLO hands in Analyze", () => {
  it("keeps Omaha hands from a Hold'em import apart, the Hold'em hand imported as before", async () => {
    const prep = await prepare([{ name: "mixed.txt", text: [HOLDEM, PLO, GG_PLO].join("\n\n\n") }], { id: "i1", name: "mixed.txt", at: 1 });
    expect(prep.total).toBe(3);
    expect(prep.hands.map((h) => h.hole)).toEqual(["AhQd"]);
    expect(prep.omaha!.map((h) => h.hole)).toEqual(["AhQdJsTd", "KhQhJcTc"]);
    expect(prep.skipped.nonHoldem).toBe(0);
    // a Hold'em-only import has no `omaha` at all, so its result is as it was
    expect("omaha" in (await prepare([{ name: "h.txt", text: HOLDEM }], { id: "i2", name: "h.txt", at: 1 }))).toBe(false);
    // hi-lo is still not Hold'em, and not PLO4 either: skipped as before
    const hilo = await prepare([{ name: "x.txt", text: PLO.replace("Omaha Pot Limit", "Omaha Hi/Lo Pot Limit") }], { id: "i3", name: "x.txt", at: 1 });
    expect(hilo.skipped.nonHoldem).toBe(1);
    expect(hilo.omaha).toBeUndefined();
  });

  it("stores them once each, a grade kept with its hand", async () => {
    const { hands, read, skipped } = readOmahaFiles([`${PLO}\n\n\n${GG_PLO}\n\n\n${HOLDEM}`], "t", 5);
    expect([read, hands.length, skipped]).toEqual([3, 2, 1]);
    expect(await addPloHands(hands)).toEqual({ added: 2, existing: 0 });
    expect(await addPloHands(hands.slice(0, 1))).toEqual({ added: 0, existing: 1 });
    expect(await putPloGrade(hands[1]!.id, "flop", { verdicts: ["Mistake"], loss: 1.5, exploitabilityPct: 0.1, ranges: ["a", "b"] }, 9)).toBe(true);
    expect((await listPloHands()).find((h) => h.id === hands[1]!.id)!.grades!.flop).toEqual({ verdicts: ["Mistake"], loss: 1.5, exploitabilityPct: 0.1, ranges: ["a", "b"], at: 9 });
    expect(await putPloGrade("nope", "flop", { verdicts: [], loss: 0, exploitabilityPct: 0, ranges: ["", ""] })).toBe(false);
  });

  it("lists them under PLO, each street with what grades it, the Hold'em view's game picker linking there", async () => {
    open("?game=plo4");
    const games = await screen.findByRole("navigation", { name: "Game" });
    expect(within(games).getByRole("link", { name: "PLO" }).getAttribute("aria-current")).toBe("page");
    expect(within(screen.getByRole("list", { name: "Not for PLO" })).getByText("preflop grading")).toBeTruthy();
    await screen.findByText("No PLO hands kept yet.");

    fireEvent.change(screen.getByLabelText("PLO hand histories"), { target: { value: `${GG_PLO}\n\n\n${HOLDEM}` } });
    fireEvent.click(screen.getByRole("button", { name: "Import pasted" }));
    expect((await screen.findByRole("status", { name: "Import result" })).textContent).toMatch(/2 hands read: 1 new PLO hand kept, 1 skipped \(Not an Omaha hand/);
    const table = await screen.findByRole("table", { name: "PLO hands" });
    expect(table.textContent).toContain("KhQhJcTc");
    fireEvent.click(within(table).getByRole("button", { name: /2024/ }));
    const streets = screen.getByRole("list", { name: "Streets of hand #RC2049187654" });
    expect(streets.textContent).toMatch(/Preflop: ungraded\. PLO preflop isn't solved\./);
    const links = within(streets).getAllByRole("link", { name: "Solve it in Study to grade" });
    expect(links).toHaveLength(3);
    expect(links[0]!.getAttribute("href")).toMatch(/^\/study\?.*board=9h8c2d.*game=plo4.*hand=KhQhJcTc.*seat=1/);
  });

  it("shows a street graded on a solve, with what graded it", async () => {
    const { hands } = readOmahaFiles([GG_PLO], "t", 5);
    await addPloHands(hands);
    await putPloGrade(hands[0]!.id, "river", { verdicts: ["Best"], loss: 0, exploitabilityPct: 0.08, ranges: ["KQJT", "AAxx"] });
    open("?game=plo4");
    fireEvent.click(within(await screen.findByRole("table", { name: "PLO hands" })).getByRole("button", { name: /2024/ }));
    const streets = screen.getByRole("list", { name: "Streets of hand #RC2049187654" });
    expect(streets.textContent).toMatch(/River: Bestno EV given up, on a solve 0\.08% of the pot from equilibrium in its game, from your ranges \(OOP KQJT, IP AAxx\)/);
  });
});
