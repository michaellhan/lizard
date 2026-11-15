// Study's profile re-solve: the profile's numbers, words and link (profile.ts), and the panel: what it asks, what it
// refuses, the two answers side by side with the street's values and convergence, labelled an exploit re-solve.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeLockError, type SolverClient } from "@/solver/client";
import { PROFILE_ANSWER, PROFILE_BLOCK } from "@/solver/profileSolve.fixture";
import { provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse, ProfileSolveProgress, ProfileSolveRequest } from "@/solver/protocol";
import { SolverError, type SolveResult } from "@/solver/types";
import { convergenceWords, describeProfile, keepProfile, movedClasses, parseProfile, profileOf, profileParam, profilePreset, profileRefusal, valueRows } from "./profile";
import { ProfilePanel } from "./ProfilePanel";
import { freshHand, type StudyHand } from "./studyState";

afterEach(cleanup);

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "t", partial: false, now: 1 };

describe("profile.ts", () => {
  it("reads typed numbers, drops zeros and says what's wrong", () => {
    expect(profileOf({ fold: "-20", bluff: "0", fold_river: "10" })).toEqual({ profile: { fold: -20, fold_river: 10 }, problems: [] });
    expect(profileOf({ fold: "x", bet: "150" }).problems).toEqual(["Folds to bets: a number", "Bets must be -100 to 100"]);
    expect(profileOf({ fold: "0" }).profile).toBeNull();
    expect(profilePreset({ fold: -20, bluff: -50, raise: -50 })).toBe("station");
    expect(profilePreset({ fold: -20 })).toBeNull();
  });

  it("says a profile in words, the street keys too", () => {
    expect(describeProfile({ fold: 15, fold_river: -10, bluff: -60, bet: 30 })).toBe("folds +15 pts to a first bet, -10 pts more on the river, bluffs 60% less, bets 30% of its checks");
  });

  it("holds a profile in the link and reads it back, refusing what isn't one", () => {
    const p = { seat: "BTN", adj: { fold: -20, bluff: -50 }, streets: "hand" as const };
    expect(profileParam(p)).toBe("BTN:fold=-20,bluff=-50;hand");
    expect(parseProfile(profileParam(p))).toEqual(p);
    expect(parseProfile("BB:fold=15")).toEqual({ seat: "BB", adj: { fold: 15 }, streets: "street" });
    for (const bad of ["", "BB", "BB:", "BB:next_fold=20", "BB:fold=200", "BB:fold=0", "bb:fold=1"]) expect(parseProfile(bad)).toBeNull();
    expect(new URLSearchParams(keepProfile("p=6&s=100", "BB:fold=15")).get("prof")).toBe("BB:fold=15");
    expect(keepProfile("p=6", null)).toBe("p=6");
  });

  it("refuses where the engine would, in words", () => {
    expect(profileRefusal({ street: "preflop", actor: "BB", opponent: "BTN" }, false)).toMatch(/after the flop/);
    expect(profileRefusal({ street: "flop", multiway: true, actor: "BB" }, false)).toMatch(/heads-up/);
    expect(profileRefusal({ street: "flop", actor: "BB", opponent: "BTN" }, true)).toMatch(/cash games/);
    expect(profileRefusal({ street: "flop", actor: "BB", opponent: "BTN", fallback: "rules" }, false)).toMatch(/no tree/);
    expect(profileRefusal({ street: "river", actor: "BB", opponent: "BTN" }, false)).toBeNull();
  });

  it("puts the street's values side by side, with the best response computed apart and the convergence", () => {
    const rows = valueRows(PROFILE_BLOCK);
    expect(rows.map((r) => r.label)).toEqual([
      "BB at equilibrium (both play it)",
      "BB's equilibrium strategy against the profile",
      "BB's re-solved exploit against the profile",
      "BTN playing the profile, against the exploit",
    ]);
    expect(rows.map((r) => r.value)).toEqual(["0.95bb", "1.09bb", "2.61bb", "−2.61bb"]);
    expect(rows[2]!.note).toContain("a best response to the profile computed apart: 2.61bb");
    expect(convergenceWords(PROFILE_BLOCK)).toBe("BB's best response still gains 0.0003% of the pot against the profile after 300 iterations (0.1 s): the re-solve is that best response to within this.");
    const moved = movedClasses(PROFILE_BLOCK);
    expect(moved[0]!.cls).toBe("66");
    expect(moved.every((m) => m.moved >= 0.05)).toBe(true);
    expect(moved.map((m) => m.cls)).not.toContain("Q2s"); // (its play didn't move)
  });
});

const NODE: AdvisorResponse = {
  study: "node",
  street: "river",
  actor: "BB",
  opponent: "BTN",
  actions: PROFILE_BLOCK.actions.map((a, i) => ({ action: a, freq: PROFILE_BLOCK.eq.mix[i] })),
};
const HAND: StudyHand = { ...freshHand(), board: "Kd7c2h5s9d" };

type Asked = { req: ProfileSolveRequest; signal?: AbortSignal; onProgress?: (p: ProfileSolveProgress) => void };

function clientAnswering(answer: (a: Asked) => Promise<SolveResult<never>> | SolveResult<never>) {
  const asked: Asked[] = [];
  const client = {
    profileSolve: vi.fn(async (_state: unknown, req: ProfileSolveRequest, opts: Omit<Asked, "req">) => {
      const a = { req, ...opts };
      asked.push(a);
      return answer(a);
    }),
  } as unknown as SolverClient;
  return { client, asked };
}

const done = () => ({ data: PROFILE_ANSWER, provenance: provenanceOf(PROFILE_ANSWER, ctx) }) as unknown as SolveResult<never>;

function open(res = NODE, client: SolverClient = clientAnswering(done).client, kept: Parameters<typeof ProfilePanel>[0]["kept"] = null, onKeep = vi.fn()) {
  render(<ProfilePanel hand={HAND} res={res} mode="fast" getSolver={async () => client} kept={kept} onKeep={onKeep} />);
  fireEvent.click(screen.getByText("Exploit a profile (held across the tree, re-solved)"));
  return screen.queryByRole("form", { name: "The profile" });
}

describe("ProfilePanel", () => {
  it("starts on the opponent with the calling station, and re-solves with the numbers typed, keeping them", async () => {
    const { client, asked } = clientAnswering(done);
    const onKeep = vi.fn();
    const form = open(NODE, client, null, onKeep)!;
    expect(within(form).getByLabelText("Profiled seat")).toHaveValue("BTN");
    expect(within(form).getByLabelText("Profile preset")).toHaveValue("station");
    fireEvent.change(within(form).getByLabelText("… on the river ±"), { target: { value: "10" } });
    expect(within(form).getByLabelText("Profile preset")).toHaveValue("");
    expect(form).toHaveTextContent("BTN folds -20 pts to a first bet, +10 pts more on the river, bluffs 50% less, raises 50% less.");
    fireEvent.click(within(form).getByLabelText(/Hold it on the earlier streets too/));
    fireEvent.click(within(form).getByRole("button", { name: "Re-solve" }));
    const out = await screen.findByRole("region", { name: "Profile re-solve" });
    const want = { seat: "BTN", adj: { fold: -20, fold_river: 10, bluff: -50, raise: -50 }, streets: "hand" };
    expect(asked[0]!.req).toEqual(want);
    expect(onKeep).toHaveBeenCalledWith(want);
    expect(out).toHaveTextContent("Exploit re-solve: the opponent held to an assumed profile at every decision of theirs, the rest re-solved; not an equilibrium.");
    expect(out).toHaveTextContent("BB's range here (the exploit: re-solved against BTN's profile)");
    // equilibrium and exploit side by side, per action
    const bet250 = within(out).getAllByRole("row", { name: /^bet 250%/ })[0]!;
    expect(bet250).toHaveTextContent("0.0%");
    expect(bet250).toHaveTextContent("25.8%");
    expect(bet250).toHaveTextContent("16.05");
    expect(out).toHaveTextContent("BB's re-solved exploit against the profile");
    expect(out).toHaveTextContent("BB's best response still gains 0.0003% of the pot against the profile after 300 iterations");
    expect(out).toHaveTextContent(`Held at ${PROFILE_BLOCK.pinned.nodes} decisions of BTN's`);
    expect(out).toHaveTextContent("folds move by hand strength");
  });

  it("opens with a kept profile, on the actor too", () => {
    const form = open(NODE, undefined, { seat: "BB", adj: { fold: 15 }, streets: "street" })!;
    expect(within(form).getByLabelText("Profiled seat")).toHaveValue("BB");
    expect(within(form).getByLabelText("Folds to bets ±")).toHaveValue("15");
    expect(within(form).getByLabelText("Profile preset")).toHaveValue("overfolder");
  });

  it("won't run what isn't a profile", () => {
    const form = open()!;
    fireEvent.change(within(form).getByLabelText("Folds to bets ±"), { target: { value: "300" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Folds to bets must be -100 to 100.");
    expect(within(form).getByRole("button", { name: "Re-solve" })).toBeDisabled();
  });

  it("shows progress, stops, and gives a refusal's words", async () => {
    const { client, asked } = clientAnswering(
      (a) =>
        new Promise((_ok, no) => {
          a.onProgress?.({ study: "profile_progress", street: "river", iterations: 128, of: 1000, exploitability_pct: 0.31, seconds: 1 });
          a.signal?.addEventListener("abort", () => no(new SolverError("cancelled", "cancelled")));
        }),
    );
    const form = open(NODE, client)!;
    fireEvent.click(within(form).getByRole("button", { name: "Re-solve" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Re-solving the river: 128 of up to 1000 iterations, 0.31% of the pot…");
    fireEvent.click(within(form).getByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stopped.");
    expect(asked[0]!.signal?.aborted).toBe(true);
    cleanup();
    const refused = clientAnswering(() => {
      throw new NodeLockError("refused", "A tournament's payoffs aren't zero-sum.");
    });
    const f2 = open(NODE, refused.client)!;
    fireEvent.click(within(f2).getByRole("button", { name: "Re-solve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A tournament's payoffs aren't zero-sum.");
  });

  it("says why there's none on a preflop or multiway node, and nothing off a node", () => {
    expect(open({ ...NODE, street: "preflop" })).toBeNull();
    expect(screen.getByText(/re-solved after the flop/)).toBeInTheDocument();
    cleanup();
    const { container } = render(<ProfilePanel hand={HAND} res={{ study: "deal" }} mode="fast" getSolver={async () => clientAnswering(done).client} kept={null} onKeep={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
