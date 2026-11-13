// The Combos tab: a question dealt from a sample range, answered by a click or a key, explained, kept in the record (kv),
// the counts opened first marking the answer as helped, a typed range, and the record cleared.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { kvGet, kvSet } from "@/data/db";
import { seeded } from "@/poker/table";
import { ComboQuiz } from "./ComboQuiz";
import { PracticePage } from "./PracticePage";
import { categoryLabel, fmtCount, makeQuestion, readStats, SAMPLE_RANGES, STATS_KEY } from "./combos";

/** The question ComboQuiz deals first on this seed (it draws the range, then the question, from the same stream). */
function firstQuestion(seed: number) {
  const r = seeded(seed);
  return makeQuestion(SAMPLE_RANGES[Math.floor(r() * SAMPLE_RANGES.length)]!, r)!;
}

afterEach(async () => {
  cleanup();
  await kvSet(STATS_KEY, null);
});

const choices = () => within(screen.getByRole("group", { name: "Choices" })).getAllByRole("button");
const askedCell = () => screen.getByRole("cell", { name: "?" });

describe("ComboQuiz", () => {
  it("deals a hand, a flop and a range, and grades a choice with the classes that make the answer", async () => {
    render(<ComboQuiz rand={seeded(5)} />);
    expect(within(screen.getByRole("group", { name: "Your cards" })).getAllByRole("img")).toHaveLength(2);
    expect(within(screen.getByRole("group", { name: "Board" })).getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText(/of 1,326 combos/)).toBeInTheDocument();
    expect(screen.getByText(/A sample range typed for this quiz, not from a chart or a solve\./)).toBeInTheDocument();
    expect(screen.getByText(/Exact counts, made in this page/)).toBeInTheDocument();
    expect(screen.getByText(/^How many/)).toBeInTheDocument();
    expect(choices()).toHaveLength(4);

    // the right one, read off the counts table once answered: answer with a key, then check
    fireEvent.keyDown(window, { key: "1" });
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/^(Right\.|Not quite: it's [\d.]+\.)/);
    expect(choices().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole("button", { name: /Next question/ })).toHaveFocus();
    await waitFor(async () => expect(readStats(await kvGet(STATS_KEY)).recent).toHaveLength(1));
    expect(screen.getByRole("region", { name: "Combo record" })).toHaveTextContent(/Questions\s*1/);

    // the next question on N, unanswered again
    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() => expect(choices().some((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("marks a right answer as helped when the counts were opened first, and hides the asked count till then", async () => {
    const q = firstQuestion(11);
    render(<ComboQuiz rand={seeded(11)} />);
    expect(screen.getByText(new RegExp(categoryLabel(q.cat).toLowerCase()))).toBeInTheDocument();
    const details = screen.getByText(/Show the other counts/).closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(askedCell()).toBeInTheDocument();
    fireEvent.click(choices().find((b) => b.textContent!.slice(1) === fmtCount(q.answer))!);
    expect(await screen.findByRole("status")).toHaveTextContent("Right, with the counts open.");
    expect(screen.queryByRole("cell", { name: "?" })).toBeNull();
    await waitFor(async () => expect(readStats(await kvGet(STATS_KEY)).total).toEqual({ correct: 0, assisted: 1, wrong: 0 }));
  });

  it("explains a wrong choice that counts your blockers too", async () => {
    // a seed whose first question is about what they can have, with combos your hand takes out
    const seed = [...Array(200).keys()].find((n) => {
      const q = firstQuestion(n);
      return q.bucket === "live" && q.tally.hand[q.cat] > 0 && q.options.includes(q.answer + q.tally.hand[q.cat]);
    })!;
    const q = firstQuestion(seed);
    render(<ComboQuiz rand={seeded(seed)} />);
    fireEvent.click(choices().find((b) => b.textContent!.slice(1) === fmtCount(q.answer + q.tally.hand[q.cat]))!);
    expect(await screen.findByRole("status")).toHaveTextContent(`Not quite: it's ${fmtCount(q.answer)}. That counts the combos your hand takes out as well.`);
    await waitFor(async () => expect(readStats(await kvGet(STATS_KEY)).total.wrong).toBe(1));
  });

  it("deals from a typed range and says when text isn't one", async () => {
    render(<ComboQuiz rand={seeded(2)} />);
    fireEvent.change(screen.getByLabelText("Their range"), { target: { value: "typed" } });
    const input = screen.getByLabelText("Range text");
    fireEvent.change(input, { target: { value: "AK, zz" } });
    expect(screen.getByText("That doesn't read as a range.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this range" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "QQ+, AKs" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this range" }));
    expect(screen.getByText("The range you typed.")).toBeInTheDocument();
    expect(screen.getByText("QQ+, AKs")).toBeInTheDocument();
  });

  it("clears the record after asking", async () => {
    render(<ComboQuiz rand={seeded(3)} />);
    fireEvent.click(choices()[2]!);
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Clear the record" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Clear the record?" })).getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("region", { name: "Combo record" })).toHaveTextContent(/Questions\s*0/);
    await waitFor(async () => expect(readStats(await kvGet(STATS_KEY)).recent).toHaveLength(0));
  });

  it("is Practice's third tab", async () => {
    render(
      <MemoryRouter initialEntries={["/practice?tab=combos"]}>
        <PracticePage pace={0} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: "Combos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "practice-panel-combos");
    expect(within(screen.getByRole("tabpanel")).getByRole("group", { name: "Choices" })).toBeInTheDocument();
  });
});
