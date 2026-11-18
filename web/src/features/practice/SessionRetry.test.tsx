// A retry of one of this session's decisions, open as that decision's re-check at Fast lands: it starts again, asked at
// Fast, so a pick graded on Quick's answer never sits beside Fast's grade as like for like (recheck.ts, review/retry.ts).
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { noLines } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance, SolveMode, SolveRequest } from "@/solver/types";
import { ReviewMistakes } from "./PracticeParts";
import { dealNext, decide, withVillain, type PracticeHand } from "./practice";
import { handAt, regraded } from "./recheck";
import { reviewed, type Reviewed } from "./review";

const prov = (source: Provenance["source"], mode: SolveMode): Provenance => ({ source, approximate: false, mode, transport: "worker", solverVersion: "test", partial: false, receivedAt: 0 });

// the big blind first to act on the flop: Quick says bet, Fast says check
const QUICK: AdvisorResponse = { street: "flop", pot_bb: 5, actions: [{ action: "check", freq: 0.05, ev_bb: 0.5 }, { action: "bet 33%", freq: 0.95, ev_bb: 2, amount_bb: 1.5 }] };
const FAST: AdvisorResponse = { street: "flop", pot_bb: 5, actions: [{ action: "check", freq: 0.7, ev_bb: 2.1 }, { action: "bet 33%", freq: 0.3, ev_bb: 2.08, amount_bb: 1.5 }] };

/** Your check on the flop, graded at Quick (a miss), and the same decision re-checked at Fast (Best). */
function entries(): { e0: Reviewed; e1: Reviewed } {
  let h: PracticeHand = {
    seed: 0,
    n: 4,
    players: 2,
    stack: 100,
    hero: "BB",
    hands: { SB: ["Ah", "Kh"], BB: ["Qd", "Qc"] },
    board: ["Kd", "7s", "2c", "9h", "3d"],
    shown: 0,
    lines: noLines(),
    decisions: [],
    result: null,
  };
  h = withVillain(withVillain(h, { pos: "SB", action: "raise", to: 2.5 }), { pos: "BB", action: "call" });
  h = dealNext(h, "flop");
  const r = decide(h, QUICK, 0, prov("live", "quick"));
  if ("error" in r) throw new Error(r.error);
  const e0 = reviewed(h, r.decision, h.n + 1);
  const out = regraded(handAt(r.hand, 0)!, r.decision, FAST, prov("live", "fast"));
  if ("why" in out) throw new Error(out.why);
  return { e0, e1: { ...e0, d: out.decision } };
}

function client() {
  const solve = vi.fn(async (req: SolveRequest) => ({ data: req.mode === "fast" ? FAST : QUICK, provenance: prov("live", req.mode ?? "quick") }));
  return { solve, getClient: async () => ({ solve }) as never };
}

const shown = (review: Reviewed[], getClient: () => Promise<never>) => (
  <MemoryRouter>
    <ReviewMistakes review={review} retry={{ getClient, onOpen: () => {} }} />
  </MemoryRouter>
);

describe("a retry open as its decision's re-check lands", () => {
  it("starts again at Fast, its Quick pick gone, and isn't asked again on a render that changes nothing", async () => {
    const { e0, e1 } = entries();
    expect(e0.d.provenance?.mode).toBe("quick");
    expect(e1.d.quick?.verdict).toBe(e0.d.grade!.verdict);
    const { solve, getClient } = client();
    const view = render(shown([e0], getClient));
    fireEvent.click(screen.getByRole("button", { name: /Hand 5 · flop/ }));
    fireEvent.click(screen.getByRole("button", { name: "Retry this decision" }));
    fireEvent.click(await screen.findByRole("button", { name: /^bet 33%/ }));
    expect(screen.getByText(/This time:/)).toBeTruthy();
    expect(solve.mock.calls.map(([q]) => q.mode)).toEqual(["quick"]);
    // (the same entry drawn again: nothing asked)
    view.rerender(shown([e0], getClient));
    expect(solve).toHaveBeenCalledTimes(1);

    // (the re-check lands: Fast's grade under the open retry)
    view.rerender(shown([e1], getClient));
    expect(screen.queryByText(/This time:/)).toBeNull();
    expect(screen.getByText(/re-checked at Fast, so the retry is asked at Fast too/)).toBeTruthy();
    await screen.findByRole("button", { name: /^bet 33%/ });
    expect(solve.mock.calls.map(([q]) => q.mode)).toEqual(["quick", "fast"]);
    fireEvent.click(screen.getByRole("button", { name: /^check$/ }));
    expect(screen.getByText(/Same kind of answer both times/)).toBeTruthy();
  });
});
