// The Combos tab's "?": every worked example's answer is what combos.ts counts, and the panel opens from the quiz with its
// solutions folded until asked for.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { seeded } from "@/poker/table";
import { COMBO_EXAMPLES, EXAMPLE_FLOP, EXAMPLE_HERO } from "./ComboHelp";
import { ComboQuiz } from "./ComboQuiz";
import { countCombos, rangeCombos } from "./combos";

afterEach(cleanup);

describe("ComboHelp", () => {
  it.each(COMBO_EXAMPLES.map((e) => [e.q, e] as const))("%s: the stated answer is the count", (_, e) => {
    const counted = countCombos(rangeCombos(e.check.range)!, EXAMPLE_HERO, EXAMPLE_FLOP);
    const n = counted.filter((c) => c.state === e.check.state && (!e.check.cat || c.cat === e.check.cat)).reduce((s, c) => s + c.w, 0);
    expect(n).toBe(e.answer);
    expect(e.steps.join(" ")).toMatch(new RegExp(`\\b${e.answer}\\b`));
  });

  it("opens from the quiz's ?, the solutions folded", () => {
    render(<ComboQuiz rand={seeded(5)} />);
    expect(screen.queryByRole("region", { name: "How combos are counted" })).toBeNull();
    const button = screen.getByRole("button", { name: "How the counting works" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const help = screen.getByRole("region", { name: "How combos are counted" });
    expect(within(help).getByText(/you hold/)).toHaveTextContent("you hold A♠ K♣, the flop is 5♣ A♦ J♥");
    expect(within(help).getAllByText("Solution")).toHaveLength(COMBO_EXAMPLES.length);
    expect(within(help).getAllByRole("listitem").length).toBeGreaterThanOrEqual(COMBO_EXAMPLES.length);
    fireEvent.click(button);
    expect(screen.queryByRole("region", { name: "How combos are counted" })).toBeNull();
  });
});
