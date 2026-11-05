// A node lock's answer, as engine/study_lock.py gives it, for the tests.
import type { AdvisorResponse, NodeLockBlock } from "./protocol";

export const BLOCK: NodeLockBlock = {
  line: ["check"],
  seat: "BTN",
  player: 1,
  seats: ["BB", "BTN"],
  actions: ["check", "bet 33%", "bet 75%"],
  mix: [0.5, 0.5, 0],
  hands: "all",
  cells: 300,
  ignored: 0,
  ignored_hands: [],
  words: "BTN holds check 50.0%, bet 33% 50.0% (whole range)",
  share_held: 1,
  untrained: true,
  root_pot: 5.5,
  locked: {
    iterations: 300,
    root_pot: 5.5,
    value: [-0.7052, 0.7052],
    exploitability_pct: 0.0697,
    best_response_held: [-0.7, 0.71],
    gain_held: [0.005, 0.005],
    best_response_free: [-0.7, 16.38],
    lock_cost: [0, 15.67],
    seconds: 1.5,
  },
  unlocked: { iterations: 300, root_pot: 5.5, value: [-0.8055, 0.8055], exploitability_pct: 0.0898, best_response: [-0.8, 0.81], gain: [0.005, 0.005] },
  changes: [
    { at: "before", line: [], seat: "BB", player: 0, actions: ["check", "bet 33%", "bet 75%"], unlocked: [1, 0, 0], locked: [1, 0, 0], reach: { unlocked: 1, locked: 1 } },
    { at: "locked", line: ["check"], seat: "BTN", player: 1, actions: ["check", "bet 33%", "bet 75%"], unlocked: [0.283, 0.571, 0.146], locked: [0.5, 0.5, 0], reach: { unlocked: 1, locked: 1 } },
    { at: "after", line: ["check", "bet 33%"], seat: "BB", player: 0, actions: ["fold", "call", "raise to 7"], unlocked: [0.385, 0.478, 0.137], locked: [0.349, 0.459, 0.191], reach: { unlocked: 0.571, locked: 0.5 } },
    { at: "after", line: ["check", "bet 75%"], seat: "BB", player: 0, actions: ["fold", "call", "raise to 11"], unlocked: [0.514, 0.414, 0.072], locked: null, reach: { unlocked: 0.146, locked: 0 } },
  ],
  abstraction: "At this node every hand has its own strategy. Below it the turn is played as one card per class.",
  scope: "The lock is on this street's solve.",
};

export const ANSWER: AdvisorResponse = {
  study: "nodelock",
  street: "flop",
  actor: "BTN",
  node_lock: BLOCK,
  solver: { iterations: 300, solve_seconds: 1.5, exploitability_pct: 0.0697, target_pct: 0.2 },
  notes: ["The flop is solved live here."],
};
