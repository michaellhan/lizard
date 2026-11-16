"""The 3-way ranges a solve starts from after earlier actions on its street (solver/gto/advisor.py, Lizard patch of
2026-11-16): the current street is
narrowed through a solve of it from its start when someone bet before you (Advisor.mw_current_solve), that solve bets
the size made (_mw_sized), and a hand outside your range plays its best response (_best_response_mix).

The spot: 6-max 100bb, UTG opens 2.5, BTN and BB call; Qs7s6d, BB checks, UTG bets 4 into 8, BTN holds Kd7d. The rules
alone gave UTG's bet 60 combos where a solve of the flop bets 23, and the button's solve raised K7s at 100% for +1.39 bb.

Run: .venv/bin/python -m unittest scripts/engine/test_mw_narrowing.py   (about 30 s of CPU)
"""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))

import gto.advisor as A  # noqa: E402
from gto.advisor import MW_FAST_STREETS, MW4_FAST_STREETS, Advisor  # noqa: E402
from gto.solver import Config  # noqa: E402

PRE = [{"pos": "UTG", "action": "raise", "to": 2.5}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "fold"},
       {"pos": "BTN", "action": "call"}, {"pos": "SB", "action": "fold"}, {"pos": "BB", "action": "call"}]
FLOP = [{"pos": "BB", "action": "check"}, {"pos": "UTG", "action": "bet", "to": 4}]
BOARD = "Qs7s6d"
RAISES = {"flop": [0.5], "turn": [0.75], "river": [0.75]}
FAST = dict(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=32, turn_buckets=True,
            bucket_river_step=3, river_classes=True, river_strength=32,
            bet_sizes={"flop": [0.33, 0.75], "turn": [0.33, 0.75, 1.25], "river": [0.33, 0.75, 1.25]}, raise_sizes=RAISES)


def worker_fast() -> Advisor:
    """The browser worker's Fast advisor (solver/gto/static/worker.js), 3-way solves on every street, with each solve
    capped at a fixed number of iterations so the answer doesn't depend on machine load."""
    a = Advisor(Config(**FAST))
    a.root_sizes = {"river": {"bet": [0.33, 0.75, 1.25, 2.5]}}
    a.should_stop = lambda: False
    a.mw_solve_streets = ("flop", "turn", "river")
    a.mw_street_config = {k: dict(c) for k, c in MW_FAST_STREETS.items()}
    a.mw4_street_config = {k: dict(c) for k, c in MW4_FAST_STREETS.items()}
    a.mw4_quick_flop = None
    a.mw_nway_max = 5
    a.mw_max_iters = 100
    return a


class OffRange(unittest.TestCase):
    def test_a_hand_outside_the_range_plays_its_best_response(self):
        np.testing.assert_allclose(A._best_response_mix([0.0, 1.18, 1.27]), [0, 0, 1])
        np.testing.assert_allclose(A._best_response_mix([0.0, 1.2, 1.2]), [0, 0.5, 0.5])


class Sized(unittest.TestCase):
    def test_the_bet_made_takes_the_nearest_size(self):
        conf = dict(MW_FAST_STREETS["flop"])
        self.assertEqual(A._mw_sized(conf, "flop", FLOP, 8.0)["bet"]["flop"], [0.5, 0.75])
        # a third of the pot is the menu's own size: the menu stays
        self.assertIs(A._mw_sized(conf, "flop", [{"pos": "UTG", "action": "bet", "to": 2.64}], 8.0), conf)
        # an overbet replaces the bigger size; a check-through or an all-in keeps the menu
        self.assertEqual(A._mw_sized(conf, "flop", [{"pos": "UTG", "action": "bet", "to": 12}], 8.0)["bet"]["flop"],
                         [0.33, 1.5])
        self.assertIs(A._mw_sized(conf, "flop", [{"pos": "BB", "action": "check"}], 8.0), conf)
        self.assertIs(A._mw_sized(conf, "flop", [{"pos": "UTG", "action": "all-in"}], 8.0), conf)
        # a single size (the turn's) is replaced as a number
        self.assertEqual(A._mw_sized({"bet": {"flop": 0.33, "turn": 0.5}}, "turn",
                                     [{"pos": "UTG", "action": "bet", "to": 10}], 10.0)["bet"]["turn"], 1.0)


class TheSpot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adv = worker_fast()
        cls.res = cls.adv.advise(dict(players=6, stack=100, hero="BTN", hole="Kd7d", board=BOARD, preflop=PRE,
                                      flop=FLOP, budget=60, prior_budget=3))

    def test_narrowed_through_a_solve_of_the_flop(self):
        notes = self.res["notes"]
        self.assertTrue(any("ranges narrowed through a solve from the street's start" in n for n in notes), notes)
        self.assertFalse(any("multiway, ranges narrowed by simple betting rules" in n for n in notes), notes)
        self.assertTrue(self.res.get("solved"))

    def test_k7_is_not_a_pure_raise(self):
        acts = {a["action"]: a for a in self.res["actions"]}
        raise_ = next(a for n, a in acts.items() if n.startswith("raise"))
        self.assertLess(raise_["freq"], 1.0)
        self.assertGreater(acts["call"]["ev_bb"], raise_["ev_bb"])

    def test_a_quick_answer_keeps_the_rules(self):
        a = worker_fast()
        r = a.advise(dict(players=6, stack=100, hero="BTN", hole="Kd7d", board=BOARD, preflop=PRE, flop=FLOP,
                          budget=1.5, prior_budget=0.3, quick=True))
        self.assertFalse(any("a solve from the street's start" in n for n in r.get("notes", [])), r.get("notes"))

    def test_a_check_in_front_keeps_the_rules(self):
        a = worker_fast()
        r = a.advise(dict(players=6, stack=100, hero="UTG", hole="AhKh", board=BOARD, preflop=PRE, flop=FLOP[:1],
                          budget=4, prior_budget=3))
        self.assertFalse(any("a solve from the street's start" in n for n in r.get("notes", [])), r.get("notes"))


if __name__ == "__main__":
    unittest.main()
