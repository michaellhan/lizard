"""The turn reference has to be right before anything is compared with it: a game with no betting is the exact equity over
the 40 river cards, any strategy's best responses bracket the value from both sides, and a solve closes the bracket.

Run: .venv/bin/python -m unittest scripts/engine/test_plo_turn_reference.py
"""
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

from plo_reference import UNITS, equity_exact, parse  # noqa: E402
from plo_turn_reference import NONE, Strategy, TurnGame, averaged, measure, solve_cfr_plus  # noqa: E402

BOARD = "2c7d9hJs"
A, B = "QhTh4c3c", "AsAc8s8c"


def spot(oop, ip, turn=NONE, river=NONE, pot=10, stack=50):
    return {"name": "toy", "board": BOARD, "oop": oop, "ip": ip, "pot": pot, "stack": stack, "turnSizes": turn, "riverSizes": river}


class NoBetting(unittest.TestCase):
    def test_checked_down_is_the_equity_over_every_river(self):
        game = TurnGame(spot(A, B))
        self.assertEqual(game.matchups, 1)
        m = measure(game, averaged(Strategy(game)))
        e = equity_exact([parse(A), parse(B)], parse(BOARD))
        self.assertEqual(e["boards"], 40)
        equity = e["shares"][0] / UNITS / e["boards"]
        self.assertAlmostEqual(m["value"], 10 * equity - 5, places=9)
        # nobody can deviate: both best responses are the value itself
        self.assertAlmostEqual(m["upper"], m["value"], places=9)
        self.assertAlmostEqual(m["lower"], m["value"], places=9)

    def test_swapping_the_seats_turns_the_value_over(self):
        here = measure(g := TurnGame(spot(A, B)), averaged(Strategy(g)))["value"]
        there = measure(g := TurnGame(spot(B, A)), averaged(Strategy(g)))["value"]
        self.assertAlmostEqual(here, -there, places=9)

    def test_hands_that_meet_nothing_are_dropped(self):
        game = TurnGame(spot(f"{A},AsKd5c5d", B))  # As is in IP's only hand
        self.assertEqual(len(game.hands[0]), 1)


class Bracket(unittest.TestCase):
    SIZES = {"bets": [100], "raises": [], "raiseCap": 0, "allIn": False}

    def game(self):
        return TurnGame(spot(f"{A},6s5s4h3d", f"{B},Tc9c8d7h", self.SIZES, self.SIZES))

    def test_any_strategy_is_bracketed_from_both_sides(self):
        game = self.game()
        m = measure(game, averaged(Strategy(game)))
        self.assertLessEqual(m["lower"], m["value"] + 1e-9)
        self.assertLessEqual(m["value"], m["upper"] + 1e-9)
        self.assertGreater(m["pct"], 1)  # checking and calling at random is far off

    def test_a_solve_closes_the_bracket(self):
        game = self.game()
        strategy, t = solve_cfr_plus(game, 1e-2)
        m = measure(game, strategy)
        self.assertLessEqual(m["pct"], 1e-2)
        self.assertLessEqual(m["upper"] - m["lower"], 2 * 1e-4 * game.pot + 1e-9)
        self.assertLessEqual(m["lower"], m["value"] + 1e-9)
        self.assertLessEqual(m["value"], m["upper"] + 1e-9)


if __name__ == "__main__":
    unittest.main()
