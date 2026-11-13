import { describe, expect, it } from "vitest";
import { runJob, startJob, type RiverRequest } from "@/engine/plo/river/run";
import { parseIds } from "@/engine/plo/cards";
import { act, EMPTY_PLAY_TALLY, startPlay, tallyPlay, type Play, type PlayContext } from "./playHand";

/** A seeded generator, so a run is the same every time. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function solved(request: RiverRequest): Promise<Omit<PlayContext, "rand">> {
  const job = startJob(request);
  const { result } = await runJob(job, { pause: () => Promise.resolve() });
  return { result: result!, band: undefined, ask: (path) => Promise.resolve(job.riverView(path)) };
}

const TURN: RiverRequest = {
  oop: "QhTh4c3c,6s5s4h3d,KsKd5c5d",
  ip: "AsAc8s8c,Th9h8d7d",
  board: "2c7d9hJs",
  pot: 10,
  stacks: [40, 40],
  sizes: { bets: [100], raises: [], raiseCap: 0, allIn: false },
  riverSizes: { bets: [100], raises: [], raiseCap: 0, allIn: false },
  targetPct: 0.5,
  seconds: 20,
};

/** Plays a hand to its end, your action chosen by `choose`. */
async function playOut(ctx: PlayContext, choose: (p: Play) => number, hero?: 0 | 1): Promise<Play> {
  let p = (await startPlay(ctx, hero))!;
  for (let guard = 0; !p.end && !p.broken && guard < 20; guard++) p = await act(p, choose(p), ctx);
  return p;
}

describe("a PLO hand played on a solve", () => {
  it("plays a turn through its river, every decision of yours graded, to a fold or a showdown", async () => {
    const base = await solved(TURN);
    const rand = lcg(7);
    const ctx = { ...base, rand };
    let tally = EMPTY_PLAY_TALLY;
    let rivers = 0;
    for (let h = 0; h < 30; h++) {
      const p = await playOut(ctx, (q) => Math.floor(rand() * q.node!.actions.length));
      expect(p.broken).toBeUndefined();
      expect(p.end).not.toBeNull();
      const end = p.end!;
      // dealt clear of each other
      expect(new Set([...p.cards].flatMap((c) => [c])).size).toBe(2);
      // your decisions graded, the solve's not
      for (const l of p.log) {
        if (l.seat === p.hero) expect(l.grade ?? l.why).toBeTruthy();
        else expect(l.grade).toBeNull();
      }
      if (end.how === "showdown") expect(parseIds(end.board)).toHaveLength(5);
      if (p.log.some((l) => l.street === "river")) rivers++;
      // you can't win more than the pot nor lose more than your stack
      expect(end.net).toBeLessThanOrEqual(end.pot);
      expect(end.net).toBeGreaterThanOrEqual(-40);
      tally = tallyPlay(tally, p);
    }
    expect(tally.hands).toBe(30);
    expect(tally.decisions).toBeGreaterThan(0);
    expect(rivers).toBeGreaterThan(0);
  });

  it("settles a fold: the folder loses what went in, the bettor's unmatched bet comes back", async () => {
    const base = await solved(TURN);
    const rand = lcg(3);
    // you check or fold whenever you can: what you lose is only what you'd put in before (nothing on this street)
    for (let h = 0; h < 10; h++) {
      const p = await playOut({ ...base, rand }, (q) => Math.max(0, q.node!.actions.findIndex((a) => a.kind === "fold" || a.kind === "check")), 0);
      if (p.end!.how === "fold" && p.end!.winner === 1) expect(p.end!.net).toBe(-p.put[0]);
      if (p.end!.winner === 0 && p.end!.how === "fold") expect(p.end!.net).toBeGreaterThanOrEqual(10);
    }
  });

  it("plays a flop through its turn and river, each asked of the solve", async () => {
    const base = await solved({
      oop: "AsAhKsKh,AdAcKdKc",
      ip: "JhTh9c8c,QcJc9d8d",
      board: "Js9s4d",
      pot: 10,
      stacks: [30, 30],
      sizes: { bets: [100], raises: [], raiseCap: 0, allIn: false },
      turnSizes: { bets: [100], raises: [], raiseCap: 0, allIn: false },
      riverSizes: { bets: [100], raises: [], raiseCap: 0, allIn: false },
      targetPct: 1,
      seconds: 20,
    });
    const rand = lcg(11);
    let streets = 0;
    for (let h = 0; h < 6; h++) {
      // you check and call: the hand goes as far as the solve's own seat lets it
      const p = await playOut({ ...base, rand }, (q) => Math.max(0, q.node!.actions.findIndex((a) => a.kind === "check" || a.kind === "call")));
      expect(p.broken).toBeUndefined();
      expect(p.end).not.toBeNull();
      streets = Math.max(streets, new Set(p.log.map((l) => l.street)).size);
    }
    expect(streets).toBe(3);
  });
});
