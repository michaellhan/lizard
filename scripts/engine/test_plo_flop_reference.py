"""The flop reference has to be right before anything is compared with it: checked down it's the exact equity over every
turn and river, rake comes off the winner as the rules say, a sample's exactly normalised weights add to one for every
matchup, any strategy's best responses bracket the value, and a solve closes the bracket.

Run: .venv/bin/python -m unittest scripts/engine/test_plo_flop_reference.py
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plo_flop_reference import NONE, POT, FlopGame, Strategy, averaged, measure, pick, solve_cfr_plus  # noqa: E402
from plo_reference import DECK, UNITS, equity_exact, parse  # noqa: E402

BOARD = "Js9s4d"
A, B = "AhAdKhKd", "Tc9c8h7h"


def spot(oop, ip, flop=NONE, turn=NONE, river=NONE, pot=10, stack=40, **extra):
    return {"name": "toy", "board": BOARD, "oop": oop, "ip": ip, "pot": pot, "stack": stack, "flopSizes": flop, "turnSizes": turn, "riverSizes": river, **extra}


def equity(a, b):
    e = equity_exact([parse(a), parse(b)], parse(BOARD))
    return e["shares"][0] / UNITS / e["boards"]


class NoBetting(unittest.TestCase):
    def test_checked_down_is_the_equity_over_every_turn_and_river(self):
        game = FlopGame(spot(A, B))
        m = measure(game, averaged(Strategy(game)))
        self.assertAlmostEqual(m["value"], 10 * equity(A, B) - 5, places=9)
        self.assertAlmostEqual(m["values"][1], -m["value"], places=9)
        self.assertAlmostEqual(m["upper"], m["value"], places=9)

    def test_swapping_the_seats_turns_the_value_over(self):
        here = measure(g := FlopGame(spot(A, B)), averaged(Strategy(g)))["value"]
        there = measure(g := FlopGame(spot(B, A)), averaged(Strategy(g)))["value"]
        self.assertAlmostEqual(here, -there, places=9)

    def test_rake_comes_off_the_winner_and_a_tie_splits_it(self):
        # checked down for a pot of 10 at 5%, capped at 0.3: the winner's 5 is 4.7, a tie costs each 0.15
        game = FlopGame(spot(A, B, rake={"pct": 5, "cap": 0.3}))
        m = measure(game, averaged(Strategy(game)))
        e = equity(A, B)
        self.assertAlmostEqual(m["values"][0], 5 * (2 * e - 1) - 0.3 * e, places=9)
        self.assertAlmostEqual(m["values"][1], 5 * (1 - 2 * e) - 0.3 * (1 - e), places=9)


class Samples(unittest.TestCase):
    def test_the_pick_spreads_suits_and_ranks(self):
        off = [c for c in DECK if c not in parse(BOARD)]
        got = pick(off, 12)
        self.assertEqual(len(set(got)), 12)
        self.assertEqual(sorted(sum(1 for c in got if c[1] == s) for s in "shdc"), [3, 3, 3, 3])
        self.assertEqual(len({c[0] for c in got}), 12)
        self.assertEqual(len({c[0] for c in pick(off, 16)}), 13)
        self.assertEqual(pick(off, None), off)
        self.assertEqual(pick(off, 49), off)

    def test_exact_weights_add_to_one_and_the_solvers_nearly(self):
        s = spot("AhAdKhKd,6s5s3h2h,QcQdJcTc", "Tc9c8h7h,QsQhJhTd", turnSample=10, riverSample=10)
        exact = FlopGame(s, exact=True)
        np.testing.assert_allclose(exact.w_turn.sum(axis=0), exact.compat, atol=1e-12)
        np.testing.assert_allclose(exact.w_tr.sum(axis=(0, 1)), exact.compat, atol=1e-12)
        split = FlopGame(s)
        off = np.abs(split.w_turn.sum(axis=0) - split.compat).max()
        self.assertLess(off, 0.1)

    def test_on_the_whole_deck_the_split_weights_are_exact(self):
        s = spot(A, B, turnSample=49, riverSample=48)
        game = FlopGame(s)
        self.assertFalse(game.turn_sampled)
        np.testing.assert_allclose(game.w_tr.sum(axis=(0, 1)), game.compat, atol=1e-12)


class Bracket(unittest.TestCase):
    def test_a_solve_closes_the_bracket(self):
        game = FlopGame(spot(f"{A},6s5s3h2h", B, POT, POT, NONE))
        m0 = measure(game, averaged(Strategy(game)))
        self.assertLessEqual(m0["lower"], m0["value"] + 1e-9)
        self.assertLessEqual(m0["value"], m0["upper"] + 1e-9)
        strategy, _ = solve_cfr_plus(game, 1e-2)
        m = measure(game, strategy)
        self.assertLessEqual(m["pct"], 1e-2)
        self.assertLessEqual(m["lower"], m["value"] + 1e-9)
        self.assertLessEqual(m["value"], m["upper"] + 1e-9)


if __name__ == "__main__":
    unittest.main()
