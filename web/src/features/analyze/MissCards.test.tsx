// Your misses one at a time (MissCards.tsx): worst first, the verdict, the answer and why shown at once, the arrows and the
// buttons moving between them, and Escape and Finish closing.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { missesOf } from "./report";
import { decisionBrief } from "./DecisionTables";
import { MissCards, whyLine } from "./MissCards";

const hand = (id: string, hole: string) => ({ id, site: "PokerStars", number: id, played: "2026-11-08 13:35", players: 6, hole, board: "", text: "" }) as unknown as HandRecord;
const dec = (id: string, verdict: string, action: string, evLossBb: number | null, over: Partial<DecisionRecord> = {}) =>
  ({ id, handId: id, street: "preflop", pos: "CO", action, verdict, evLossBb, situation: "RFI", source: "charts", label: "Preflop charts", matched: "raise", freq: 0, best: "fold", bestFreq: 1, mix: [["raise", 0, null], ["fold", 1, null]], ...over }) as unknown as DecisionRecord;

const ds = [dec("a", "Best", "fold", null), dec("b", "Mistake", "raise to 2.5", null), dec("c", "Blunder", "call", 1.5, { matched: "call", best: "fold", mix: [["call", 0, -1.5], ["fold", 1, 0]], source: "library", label: "Precomputed solution · srp_btn_bb", lossPct: 12 })];
const byId = new Map(["a", "b", "c"].map((id, k) => [id, hand(id, ["AhKd", "Qs7s", "9c9d"][k]!)]));

function show(k = 0) {
  const setK = vi.fn();
  const onClose = vi.fn();
  const misses = missesOf(ds);
  const r = render(
    <MemoryRouter>
      <MissCards misses={misses} byId={byId} k={k} setK={setK} onClose={onClose} />
    </MemoryRouter>,
  );
  return { ...r, setK, onClose, misses };
}

describe("MissCards", () => {
  it("deals the misses worst first, with what you did, how bad, the answer and why all shown at once", () => {
    const { misses } = show();
    expect(misses.map((d) => d.id)).toEqual(["c", "b"]); // the Blunder, then the Mistake; the Best isn't a miss
    const box = screen.getByRole("region", { name: "Your misses" });
    expect(within(box).getByRole("heading")).toHaveTextContent("Miss 1 of 2");
    expect(within(box).queryByRole("button", { name: "Show the answer" })).toBeNull();
    const answer = within(box).getByRole("group", { name: "The answer" });
    expect(answer).toHaveTextContent("You played call");
    expect(answer).toHaveTextContent("Blunder");
    expect(answer).toHaveTextContent("−1.5bb · 12% of the pot");
    expect(answer).toHaveTextContent("Fold is worth 0bb with this hand, 1.5bb more than call, which is never played.");
    expect(within(answer).getByRole("table", { name: "The answer for your hand" })).toHaveTextContent("call(you)0.0%-1.5bbfold100.0%0bb");
    expect(within(box).queryByRole("link", { name: "Open the hand" })).toBeNull();
  });

  it("says why in a line: by EV what the best is worth over yours, by frequency how often each is played", () => {
    expect(whyLine(ds[2]!)).toBe("Fold is worth 0bb with this hand, 1.5bb more than call, which is never played.");
    expect(whyLine(ds[1]!)).toBe("With this hand fold is played 100.0% of the time and raise is never played.");
    expect(whyLine(dec("d", "Inaccuracy", "bet 3", 0.4, { matched: "bet 3", mix: [["check", 0.7, 1.2], ["bet 3", 0.3, 0.8]] }))).toBe(
      "Check is worth 1.2bb with this hand, 0.4bb more than bet 3, which is played 30.0% of the time.",
    );
    expect(whyLine(dec("e", "Mistake", "fold", null, { matched: undefined, mix: [], best: "raise", bestFreq: 0.8 }))).toBe("The answer most often raise (80.0%).");
  });

  it("names the grade's best, says a rare play at one decimal, and what of the loss is past the answer's noise", () => {
    // (the top EV is a bet the hand never makes, a hair over the check it plays: the grade's best is the check)
    const d = dec("f", "Mistake", "fold", 0.6, {
      street: "flop",
      matched: "fold",
      source: "library",
      label: "Precomputed solution · srp_btn_bb",
      lossPct: 9.1,
      best: "check",
      noise: 0.13,
      past: 0.47,
      basis: { source: "library", flopPot: 6.5 },
      mix: [["fold", 0.004, 0], ["check", 0.9, 0.58], ["bet 2", 0.096, 0.6]],
    });
    // (the gap said is the one the card shows, against the top EV, and the check the hand plays is named beside it)
    expect(whyLine(d)).toBe("Bet 2 is worth 0.6bb with this hand, 0.6bb more than fold, which is played 0.4% of the time. The answer mostly plays check (90.0%), within its noise of that.");
    const r = render(
      <MemoryRouter>
        <MissCards misses={[d]} byId={new Map([["f", hand("f", "7c2d")]])} k={0} setK={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );
    const answer = within(r.container).getByRole("group", { name: "The answer" });
    expect(answer).toHaveTextContent("−0.6bb · 9.1% of the pot · 0.47bb past the answer's noise");
    expect(within(answer).getByRole("row", { name: /check/ })).toHaveClass("text-accent");
    // (the one-line brief: the grade's best, and the top EV the loss is measured against beside it)
    expect(decisionBrief({ ...d, bestFreq: 0.9 })).toBe("0.6bb lost (9.1% of the pot), 0.47bb past the answer's noise, best check 90% (top EV bet 2)");
    // (a loss shown larger than the noise shown, by too little to grade, is "just past" it, not "within")
    const hair = { ...d, bestFreq: 0.9, verdict: "Correct" as const, evLossBb: 0.12, lossPct: 2.2, noise: 0.11, past: 0, freq: 0.004, mix: [["fold", 0.004, 3], ["check", 0.9, 3.12], ["bet 2", 0.096, 3.1]] as DecisionRecord["mix"] };
    expect(decisionBrief(hair)).toBe("0.12bb lost (2.2% of the pot), just past the answer's noise, too little to grade, not counted, best check 90%");
    expect(decisionBrief({ ...hair, evLossBb: 0.11 })).toMatch(/, within the answer's noise, not counted/);
    // (a record kept before then names the top EV, as it did)
    expect(whyLine({ ...d, basis: undefined, noise: undefined })).toBe("Bet 2 is worth 0.6bb with this hand, 0.6bb more than fold, which is played 0.4% of the time.");
    // (within a verdict, the miss with more past the noise comes first, whatever was measured; a record kept before: its loss)
    const wide = { ...d, id: "w", evLossBb: 0.9, noise: 0.6, past: 0.3 };
    const old = { ...d, id: "o", evLossBb: 0.4, noise: undefined, past: undefined };
    expect(missesOf([wide, d, old]).map((x) => x.id)).toEqual(["f", "o", "w"]);
  });

  it("moves by the arrows and the buttons, and closes by Escape or Finish", () => {
    const first = show();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(first.setK).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(window, { key: "ArrowLeft" }); // (the first card has none before it)
    expect(first.setK).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(first.setK).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const last = show(1);
    expect(screen.getByRole("heading")).toHaveTextContent("Miss 2 of 2");
    expect(screen.getByRole("region", { name: "Your misses" })).toHaveTextContent("You played raise to 2.5");
    expect(screen.getByRole("group", { name: "The answer" })).toHaveTextContent("Graded by the preflop charts (by frequency, not a solve)");
    fireEvent.click(screen.getByRole("button", { name: "← Previous" }));
    expect(last.setK).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(last.onClose).toHaveBeenCalledTimes(1);
  });
});
