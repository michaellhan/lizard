"""The reference has to be right before anything is compared with it: toys worked by hand, the pot-limit tree read off by
hand, and zero-sum and bracket checks.

Run: .venv/bin/python -m unittest scripts/engine/test_plo_river_reference.py
"""
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

from plo_river_reference import Game, build_tree, measure, respond, solve_cfr_plus, spots  # noqa: E402

VALUE, AIR, CATCHER = "QhTh4c3c", "6s5s4h3d", "AsAc8s8c"


def spot(oop, ip, pot=10, bet=100):
    return {"name": "toy", "board": "2c7d9hJsKd", "oop": oop, "ip": ip, "pot": pot, "stack": 100, "bets": [bet], "raises": [], "raiseCap": 0, "allIn": False}


def paths(nodes, kind):
    return {n["path"] for n in nodes if n["kind"] == kind}


class Polarised(unittest.TestCase):
    def solved(self, bet):
        game = Game(spot(f"{VALUE},{AIR}", CATCHER, bet=bet))
        strategy, _ = solve_cfr_plus(game, 1e-3)
        return game, strategy

    def test_a_pot_size_bet_bluffs_a_third_and_is_called_half_the_time(self):
        game, s = self.solved(100)
        by = {n["path"]: i for i, n in enumerate(game.nodes)}
        self.assertAlmostEqual(s[by[""]][1][1], 0.5, places=2)  # air bets half its combos: 1 in 3 of the bets
        self.assertAlmostEqual(s[by[""]][1][0], 1.0, places=2)  # value always bets
        self.assertAlmostEqual(s[by["b1000"]][1][0], 0.5, places=2)  # P / (P + B)
        self.assertAlmostEqual(measure(game, s)["value"], 7.5 - 5, places=2)

    def test_a_half_pot_bet_bluffs_a_quarter_and_is_called_two_thirds(self):
        game, s = self.solved(50)
        by = {n["path"]: i for i, n in enumerate(game.nodes)}
        self.assertAlmostEqual(s[by[""]][1][1], 1 / 3, places=2)
        self.assertAlmostEqual(s[by["b500"]][1][0], 2 / 3, places=2)


class Blocking(unittest.TestCase):
    def test_a_catcher_holding_a_card_of_the_value_hand_only_meets_bluffs(self):
        # the catcher with the four of clubs can't be up against the value hand: it calls everything. Worked by hand:
        # the other catcher calls 1/3, air bets 1/3, value earns 35/3, over three matchups
        game = Game(spot(f"{VALUE},{AIR}", "AsAc8s4c,AdAh8d8h", bet=50))
        self.assertEqual(game.compat.sum(), 3)
        s, _ = solve_cfr_plus(game, 1e-3)
        by = {n["path"]: i for i, n in enumerate(game.nodes)}
        self.assertAlmostEqual(s[by["b500"]][1][0], 1, places=2)
        self.assertAlmostEqual(s[by["b500"]][1][1], 1 / 3, places=2)
        self.assertAlmostEqual(s[by[""]][1][1], 1 / 3, places=2)
        self.assertAlmostEqual(measure(game, s)["value"], (35 / 3) / 3 - 5, places=2)


class Tree(unittest.TestCase):
    def test_half_and_pot_with_one_raise(self):
        nodes = build_tree(2000, 10000, [50, 100], [100], 1, True)
        root = nodes[0]
        self.assertEqual(root["tokens"], ["x", "b1000", "b2000"])
        by = {n["path"]: n for n in nodes}
        # bet 10 into 20: pot 30, call 10 (40), raise 40, to 50
        self.assertEqual(by["b1000"]["tokens"], ["f", "c", "r5000"])
        # the cap is reached: fold or call
        self.assertEqual(by["b1000.r5000"]["tokens"], ["f", "c"])
        # a pot bet of 20: pot 40, call 20 (60), raise 60, to 80
        self.assertEqual(by["b2000"]["tokens"], ["f", "c", "r8000"])

    def test_a_short_stack_is_all_in_where_the_limit_reaches_it(self):
        by = {n["path"]: n for n in build_tree(2000, 1300, [50, 100], [100], 2, True)}
        self.assertEqual(by[""]["tokens"], ["x", "b1000", "b1300"])  # 13 behind: the pot bet is all-in
        self.assertEqual(by["b1000"]["tokens"], ["f", "c", "r1300"])  # all-in for less than a full raise
        self.assertEqual(by["b1000.r1300"]["tokens"], ["f", "c"])
        self.assertEqual(by["b1300"]["tokens"], ["f", "c"])  # nothing left to raise with

    def test_a_deep_stack_has_no_all_in_a_pot_bet_cant_reach(self):
        self.assertEqual(build_tree(2000, 10000, [50], [], 0, True)[0]["tokens"], ["x", "b1000"])

    def test_a_small_bet_is_lifted_to_a_big_blind(self):
        self.assertEqual(build_tree(300, 10000, [10], [], 0, False)[0]["tokens"], ["x", "b100"])


class Spots(unittest.TestCase):
    def test_every_spot_brackets_its_value_and_stays_zero_sum(self):
        for s in spots():
            game = Game(s)
            strategy, _ = solve_cfr_plus(game, 0.5, 400)
            m = measure(game, strategy)
            self.assertLessEqual(m["lower"], m["value"] + 1e-9, s["name"])
            self.assertLessEqual(m["value"], m["upper"] + 1e-9, s["name"])
            second = game.root_value(1, respond(game, strategy, 0, 1, game.weights[0], False))
            self.assertAlmostEqual(m["value"], -second, places=9, msg=s["name"])


if __name__ == "__main__":
    unittest.main()
