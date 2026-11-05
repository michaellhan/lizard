// A kept mistake for tests: a flop spot graded against a live solve, due the day after it.
import type { MistakeRecord } from "@/data/db";
import type { Provenance } from "@/solver/types";

export const DAY_ONE = new Date(2026, 10, 2, 21, 30).getTime();

export const LIVE: Provenance = { source: "live", approximate: false, exploitabilityPct: 0.4, targetPct: 0.5, iterations: 500, mode: "quick", transport: "worker", solverVersion: "1.0", partial: false, receivedAt: 5 };
export const CHART: Provenance = { source: "charts", approximate: true, mode: "quick", transport: "worker", solverVersion: "1.0", partial: false, receivedAt: 5 };
export const STORED: Provenance = { source: "library", approximate: false, exploitabilityPct: 0.3, iterations: 800, librarySpot: "srp_btn_bb", mode: "quick", transport: "file", solverVersion: "library tree 7", partial: false, receivedAt: 5 };

export const mistake = (x: Partial<MistakeRecord> = {}): MistakeRecord => ({
  id: "hand|p=6&s=100|BTN|AhKd",
  from: "hand",
  sessionId: "practice-1",
  street: "flop",
  at: DAY_ONE,
  lastAt: DAY_ONE,
  updatedAt: DAY_ONE,
  times: 1,
  seat: "BTN",
  players: 6,
  game: "6-max 100bb",
  hole: ["Ah", "Kd"],
  board: ["2c", "7d", "Ts"],
  line: "BB checks",
  study: "p=6&s=100",
  ask: { via: "solver", state: { players: 6 } as never },
  chose: "check",
  mix: [
    { action: "check", freq: 0.1, ev: 4 },
    { action: "bet 33%", freq: 0.9, ev: 4.4, amount: 2 },
  ],
  pot: 5.5,
  grade: { a: 0, best: 1, verdict: "Mistake", ok: false, mixed: false, loss: 0.4, lossPct: 7.3, byEv: true },
  provenance: LIVE,
  step: 0,
  due: new Date(2026, 10, 3).getTime(),
  tries: [],
  ...x,
});

/** A preflop spot the charts graded: by frequency, no EV. */
export const chartMistake = (x: Partial<MistakeRecord> = {}): MistakeRecord =>
  mistake({
    id: "hand|p=6&s=100|CO|7h2d",
    street: "preflop",
    seat: "CO",
    hole: ["7h", "2d"],
    board: [],
    chose: "call",
    mix: [
      { action: "fold", freq: 0.97, ev: null },
      { action: "call", freq: 0.03, ev: null },
    ],
    pot: 3.5,
    grade: { a: 1, best: 0, verdict: "Inaccuracy", ok: false, mixed: false, loss: 0, lossPct: 0, byEv: false },
    provenance: CHART,
    ...x,
  });
