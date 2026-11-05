// Copy for AI's text: what's in it, what it says the numbers are, and how a clipboard fails. Nothing here reaches a network:
// the module has no fetch, and a test says so.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshHand } from "@/features/study/studyState";
import { describe as describeProvenance } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import { clipboardWhy, reviewedText, studyText, toClipboard } from "./copyForAi";
import type { Reviewed } from "./review";

const prov = (source: Provenance["source"], extra: Partial<Provenance> = {}): Provenance => ({ source, approximate: source === "charts", mode: "quick", transport: "worker", solverVersion: "t", partial: false, receivedAt: 0, ...extra });
const grade = { verdict: "Mistake", byEv: true, a: 1, best: 0, loss: 0.5, lossPct: 10, mixed: false } as unknown as NonNullable<Reviewed["d"]["grade"]>;
const flopSpot = (source: Provenance["source"], ev = true): Reviewed => ({
  n: 3,
  seat: "SB",
  players: 2,
  hole: ["Ah", "Kd"],
  board: ["Ks", "7d", "2c"],
  line: "BB checks",
  d: {
    street: "flop",
    move: { pos: "SB", action: "bet", to: 2 },
    chose: "bet 33%",
    grade,
    provenance: prov(source),
    mix: [
      { action: "check", freq: 0.4, ev: ev ? 2 : null },
      { action: "bet 33%", freq: 0.6, ev: ev ? 2.2 : null, amount: 1.6 },
    ],
    pot: 5,
    study: "p=2&s=100&pre=SB%3Ar2.5%2CBB%3Ac&b=Ks7d2c&flop=BB%3Ax",
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("reviewedText", () => {
  it("has the game, seats, stacks, cards, board, line, your pick, the mix with EVs, and the source in words", () => {
    const t = reviewedText(flopSpot("live"));
    expect(t).toContain("Game: No-limit hold'em, heads-up, blinds 0.5 and 1, starting stack 100bb");
    expect(t).toContain("Seats, first to act preflop first: BTN/SB, BB");
    expect(t).toContain("Stacks as the hand started: 100bb each");
    expect(t).toContain("You: BTN/SB, holding Ah Kd");
    expect(t).toContain("Board: Ks 7d 2c");
    expect(t).toContain("Line so far, preflop folds left out: SB raise 2.5, BB call, Ks7d2c, BB check");
    expect(t).toContain("Decision: flop, pot 5bb");
    expect(t).toMatch(/You took: bet 33%\. Lizard's grade: Mistake/);
    expect(t).toContain("- check: 40.0%, EV 2.00bb");
    expect(t).toContain("- bet 33% (1.6bb): 60.0%, EV 2.20bb");
    expect(t).toContain(`Source of these numbers: ${describeProvenance(prov("live"))}.`);
    expect(t).toContain("These numbers come from that source. A chatbot might reason about them wrongly, so check what it says against them.");
  });

  it("each seat's stack where they aren't all the same", () => {
    const t = studyText({ ...freshHand(2, 100), setup: { stacks: { SB: 40, BB: 120 } } }, { actions: [{ action: "check", freq: 1 }] } as never, prov("live"), null);
    expect(t).toContain("Stacks as the hand started: BTN/SB 40bb, BB 120bb");
  });

  it("calls the charts what they are: not a solve, with no EVs to quote", () => {
    const t = reviewedText(flopSpot("charts", false));
    expect(t).toContain("The preflop charts are approximate tables. They are not a solved answer, and they have no EVs.");
    expect(t).toContain("This answer has no EVs for this hand.");
    expect(t).not.toMatch(/EV \d/);
    expect(t).not.toMatch(/\bsolved answer\b(?<!not a solved answer)/);
  });

  it("calls the rules and an equity estimate fallbacks", () => {
    expect(reviewedText(flopSpot("rules", false))).toContain("These betting rules are a fallback. They are not a solved answer.");
    expect(reviewedText(flopSpot("equity", false))).toContain("This equity estimate is a fallback. It is not a solved answer.");
  });

  it("says what isn't known, where a spot didn't keep its line", () => {
    const e = flopSpot("live");
    const t = reviewedText({ ...e, d: { ...e.d, study: "" } });
    expect(t).toContain("Stacks as the hand started: not kept");
    expect(t).toContain("Line so far, preflop folds left out: BB checks");
    expect(t).toContain("Board: Ks 7d 2c");
  });
});

describe("studyText", () => {
  const hand = { ...freshHand(2, 100), board: "Ks7d2c" };
  const res = {
    study: "node",
    street: "flop" as const,
    actor: "BB",
    pot_bb: 5,
    actions: [
      { action: "check", freq: 0.5, ev_bb: 2 },
      { action: "bet 33%", freq: 0.5, ev_bb: 4, amount_bb: 1.6 },
    ],
    grid: { actions: ["check", "bet 33%"], cells: { AKs: { w: 1, f: [0.25, 0.75], ev: [1, 3] } } },
  };

  it("the picked class's mix, with the size", () => {
    const t = studyText(hand, res as never, prov("live"), "AKs");
    expect(t).toContain("You: BB, holding the hand class AKs");
    expect(t).toContain("- check: 25.0%, EV 1.00bb");
    expect(t).toContain("- bet 33% (1.6bb): 75.0%, EV 3.00bb");
    expect(t).not.toContain("You took");
  });

  it("the whole range's, said so, with nothing picked", () => {
    const t = studyText(hand, res as never, prov("live"), null);
    expect(t).toContain("no hand picked, so this is the whole range's mix");
    expect(t).toContain("- check: 50.0%, EV 2.00bb");
  });
});

describe("the clipboard", () => {
  it("writes the text", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await toClipboard("x");
    expect(writeText).toHaveBeenCalledWith("x");
  });

  it("says so where the page has none", async () => {
    vi.stubGlobal("navigator", {});
    await expect(toClipboard("x")).rejects.toThrow(/no clipboard here/);
  });

  it("says why a refusal was, in words", () => {
    expect(clipboardWhy(new DOMException("denied", "NotAllowedError"))).toMatch(/refused/);
    expect(clipboardWhy(new Error("boom"))).toBe("boom");
    expect(clipboardWhy("boom")).toBe("boom");
  });
});

describe("what it reaches", () => {
  it("has no network and no key in it", () => {
    const src = readFileSync(join(process.cwd(), "src/features/practice/copyForAi.ts"), "utf8");
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|api[_-]?key/i);
  });
});
