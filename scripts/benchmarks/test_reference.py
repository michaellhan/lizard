"""The reference on games with known answers. Run from the repo root:

    python -m unittest discover -s scripts/benchmarks

Needs numpy only; the LP's tests skip without scipy (scripts/benchmarks/.venv has it). Under a minute, deterministic.
"""
from __future__ import annotations

import itertools
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np  # noqa: E402

from refsolver import cards as C  # noqa: E402
from refsolver import icm  # noqa: E402
from refsolver.hu import Chips, DCFR, HUGame, Holdem, Toy  # noqa: E402
from refsolver.mw import MWGame  # noqa: E402
from refsolver.rules import Act, HUSpec, Menu, MWSpec, hu_tree, mw_tree  # noqa: E402

try:
    import scipy  # noqa: F401
    from refsolver import locks, lp
except ImportError:
    locks = lp = None


def strip(cards):
    return C.parse_board(cards.replace(" ", ""))


def menu(bet, raises=(0.75,), max_raises=2, allin_spr=0.0):
    return Menu({s: list(bet) for s in ("flop", "turn", "river")}, {s: list(raises) for s in ("flop", "turn", "river")},
                max_raises, allin_spr)


def kuhn():
    """Kuhn poker as a one-street game: ante 1 each, one bet of 1, three cards, no raise."""
    tree = hu_tree(HUSpec(5, 2.0, 1.0, menu([0.5], (1.0,), 1)))
    return HUGame(Toy([[0, 1, 2], [0, 1, 2]], [[1, 1, 1], [1, 1, 1]], ~np.eye(3, dtype=bool)), tree)


class Independence(unittest.TestCase):
    def test_no_engine_imports(self):
        src = os.path.join(HERE, "refsolver")
        for name in os.listdir(src):
            if name.endswith(".py"):
                with open(os.path.join(src, name)) as f:
                    text = f.read()
                self.assertIsNone(re.search(r"^\s*(from|import)\s+(gto|solver|treys)\b", text, re.M), name)
        self.assertFalse([m for m in sys.modules if m == "gto" or m.startswith("gto.")])


class Evaluator(unittest.TestCase):
    def hand(self, text):
        return C.score(np.array([strip(text)]))[0]

    def test_five_card_counts(self):
        counts = np.zeros(9, dtype=np.int64)
        seen = []
        combos = C.all_combinations(52, 5)
        for i in range(0, len(combos), 1 << 20):
            s = C.score(combos[i:i + (1 << 20)])
            counts += np.bincount(C.category(s), minlength=9)
            seen.append(np.unique(s))
        self.assertEqual(counts.tolist(), [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40])
        self.assertEqual(len(np.unique(np.concatenate(seen))), 7462)

    def test_orderings(self):
        ladder = ["2c3d4h5s7c", "AcAd2h3s4c", "2c2d3h3s4c", "2c2d2h3s4c", "Ac2d3h4s5c", "2c3d4h5s6c", "2c3c4c5c7c",
                  "2c2d2h3s3c", "2c2d2h2s3c", "Ac2c3c4c5c", "TcJcQcKcAc"]
        scores = [self.hand(h) for h in ladder]
        self.assertEqual(scores, sorted(scores))
        self.assertEqual(len(set(scores)), len(scores))

    def test_seven_cards_use_the_best_five(self):
        self.assertEqual(self.hand("AcKdQhJsTc2d3h"), self.hand("AsKcQdJhTd2c3s"))       # both a broadway straight
        self.assertEqual(self.hand("KcKdKhQsQc2d2h"), self.hand("KcKdKhQsQc"))             # the better pair fills up
        self.assertEqual(self.hand("7c7d7h3s3c3d9h"), self.hand("7c7d7h3s3c"))             # two trips: a full house
        self.assertEqual(C.category(self.hand("AcAdAhAsKcKdKh")), C.QUADS)
        self.assertGreater(self.hand("2c3c4c5c6c7d8d"), self.hand("Ac2c3c4c5c7d8d"))       # six-high beats the steel wheel
        self.assertEqual(C.category(self.hand("Ac2d3h4s5c9dTd")), C.STRAIGHT)              # the wheel
        self.assertGreater(self.hand("2d3h4s5c6c9dTd"), self.hand("Ac2d3h4s5c9dTd"))       # six-high straight over it
        self.assertEqual(C.category(self.hand("AcKcQcJc9c8d7d")), C.FLUSH)

    def test_ranges(self):
        board = strip("Ks7d2c")
        r = C.parse_range("KK,AKs,76o:0.5,QhJh", board)
        self.assertEqual(len([k for k in r if k[0] == "K" and k[2] == "K"]), 3)       # one king gone from the deck
        self.assertEqual(len([k for k in r if k[0] == "A"]), 3)
        self.assertEqual(len([k for k in r if r[k] == 0.5]), 12 - 3)                  # the 7d is gone
        self.assertEqual(r["QhJh"], 1.0)


class Trees(unittest.TestCase):
    def test_sizes_round_to_the_half_blind(self):
        t = hu_tree(HUSpec(5, 9.0, 100.0, menu([0.33])))
        self.assertEqual(t.names, ["check", "bet 33%"])
        self.assertEqual(t.kids[1].inv, (4.5 + 3.0, 4.5))

    def test_all_in_replaces_a_bet_past_the_stack(self):
        t = hu_tree(HUSpec(5, 20.0, 10.0, menu([0.75])))
        self.assertEqual(t.names, ["check", "all-in"])
        self.assertEqual(t.kids[1].inv, (20.0, 10.0))
        self.assertEqual(t.kids[1].names, ["fold", "call"])          # nothing left to raise

    def test_street_ends_after_check_check_and_call(self):
        t = hu_tree(HUSpec(4, 20.0, 40.0, menu([0.5], (1.0,), 0)))
        self.assertEqual(type(t.kids[0].kids[0]).__name__, "Deal")
        self.assertEqual(type(t.kids[1].kids[1]).__name__, "Deal")

    def test_three_way_order_and_refund(self):
        t = mw_tree(MWSpec(3, 30.0, 60.0, [0.5]))
        self.assertEqual((t.player, t.kids[0].player, t.kids[0].kids[0].player), (0, 1, 2))
        check_through = t.kids[0].kids[0].kids[0]
        self.assertEqual((check_through.live, check_through.pot), ((0, 1, 2), 30.0))
        bet = t.kids[1]                                       # 0 bets 15; 1 and 2 fold: the bet comes back
        self.assertEqual(bet.player, 1)
        last = bet.kids[0]
        self.assertEqual(last.player, 2)
        lone = last.kids[0]
        self.assertEqual((lone.live, lone.pot, lone.c), ((0,), 30.0, (0.0, 0.0, 0.0)))


class Payoffs(unittest.TestCase):
    def test_rake(self):
        c = Chips(0.05, 3.0)
        self.assertAlmostEqual(c.rake((10.0, 10.0)), 1.0)
        self.assertAlmostEqual(c.rake((40.0, 40.0)), 3.0)                 # capped
        self.assertAlmostEqual(c.rake((25.0, 10.0)), 1.0)                 # the uncalled 15 isn't in the pot
        self.assertEqual(c.fold((25.0, 10.0), 1), (9.0, -10.0))
        self.assertEqual(c.show((10.0, 10.0))[0], (9.0, -10.0, -0.5))

    def test_all_in_on_the_turn_is_the_equity(self):
        """One hand each, both all-in: the value is the equity over the rivers, counted by hand with score()."""
        board = strip("Ks7d2c3h")
        a, b = "AsAh", "Kd7h"
        tree = hu_tree(HUSpec(4, 20.0, 10.0, menu([1.0])))
        game = HUGame(Holdem(board, [{a: 1.0}, {b: 1.0}]), tree)
        strat = game.uniform()
        for path in strat:                                            # bet, call
            n = next(x for x in game.acts if x.path == path)
            s = np.zeros_like(strat[path])
            s[:, n.names.index("all-in") if "all-in" in n.names else n.names.index("call")] = 1.0
            strat[path] = s
        held = set(C.combo_cards(a) + C.combo_cards(b)) | set(board)
        total = 0
        rivers = [c for c in range(52) if c not in held]
        for r in rivers:
            s0 = C.score(C.hands_with_board([C.combo_cards(a)], board + [r]))[0]
            s1 = C.score(C.hands_with_board([C.combo_cards(b)], board + [r]))[0]
            total += 20.0 if s0 > s1 else -20.0 if s0 < s1 else 0.0
        self.assertEqual(len(rivers), 44)
        self.assertAlmostEqual(game.value(strat, 0), total / len(rivers), places=10)


class KuhnPoker(unittest.TestCase):
    def test_dcfr_finds_the_value(self):
        g = kuhn()
        DCFR(g).run(4000)
        r = g.gains(g.average())
        self.assertAlmostEqual(r["value"][0], -1 / 18, places=3)
        self.assertLess(sum(r["gain"]), 2e-3)

    def test_best_response_by_enumeration(self):
        """Uniform play: NashConv 11/12. Each best response against every pure strategy, by plain enumeration."""
        g = kuhn()
        u = g.uniform()
        r = g.gains(u)
        self.assertAlmostEqual(sum(r["gain"]), 11 / 12, places=10)
        for p in (0, 1):
            nodes = [n for n in g.acts if n.player == p]
            best = -9.0
            infosets = [(n, h) for n in nodes for h in range(3)]
            for picks in itertools.product(*[range(len(n.names)) for n, _ in infosets]):
                s = {k: v.copy() for k, v in u.items()}
                for (n, h), a in zip(infosets, picks):
                    s[n.path][0, :, h] = 0.0
                    s[n.path][0, a, h] = 1.0
                best = max(best, g.value(s, p))
            self.assertAlmostEqual(best, r["br"][p], places=10)

    @unittest.skipIf(lp is None, "needs scipy")
    def test_lp_is_exact(self):
        g = kuhn()
        r = lp.solve(g)
        self.assertAlmostEqual(r["value_each_side"][0], -1 / 18, places=10)
        self.assertAlmostEqual(r["value_each_side"][1], 1 / 18, places=10)
        gains = g.gains(r["strategy"])["gain"]
        self.assertLess(max(abs(x) for x in gains), 1e-9)
        # player 1's family of equilibria: bets 4/3 alpha of the range for alpha in [0, 1/3]
        lo, hi = lp.frequency_bounds(r, 0, "")["all-in"]
        self.assertAlmostEqual(lo, 0.0, places=5)
        self.assertAlmostEqual(hi, 4 / 9, places=5)


def polar(rate=0.0, cap=None):
    board = strip("Ks7d2c3h9s")
    tree = hu_tree(HUSpec(5, 20.0, 20.0, menu([1.0])))
    return HUGame(Holdem(board, [{"7h7c": 1.0, "6h5h": 1.0}, {"KdQd": 1.0}]), tree, Chips(rate, cap))


@unittest.skipIf(lp is None, "needs scipy")
class LockedLP(unittest.TestCase):
    """The restricted game's LP (locks.py), against the same game by a route that shares no code with it: every pure
    plan of the free information sets, the minimax of that matrix."""

    def plans(self, game, p, held):
        """Each pure strategy of p, {path: (B, A, n)}, with `held` {(path, hand): mix} played as given."""
        slots = [(n, i) for n in game.acts if n.player == p for i in range(game.n[p]) if (n.path, i) not in held]
        for choice in itertools.product(*[range(len(n.names)) for n, _ in slots]):
            s = {n.path: np.zeros(n.regret.shape) for n in game.acts if n.player == p}
            for (n, i), a in zip(slots, choice):
                s[n.path][0, a, i] = 1.0
            for (path, i), mix in held.items():
                s[path][0, :, i] = mix
            yield s

    def minimax(self, game, held):
        """Player 0's value with its `held` infosets fixed, from the 2^k x 2^6 matrix."""
        from scipy.optimize import linprog
        mine = list(self.plans(game, 0, held))
        yours = list(self.plans(game, 1, {}))
        M = np.array([[game.value({**x, **y}, 0) for y in yours] for x in mine])
        m, k = M.shape
        res = linprog([0.0] * m + [-1.0], A_ub=np.hstack([-M.T, np.ones((k, 1))]), b_ub=np.zeros(k),
                      A_eq=[[1.0] * m + [0.0]], b_eq=[1.0], bounds=[(0, None)] * m + [(None, None)], method="highs-ds")
        return -res.fun

    def test_a_held_jack_bluff_by_matrix(self):
        game = kuhn()
        for mix in ((0.2, 0.8), (0.9, 0.1), (1.0, 0.0), (0.0, 1.0)):
            res = locks.solve(game, [locks.Hold("", [0], [0], mix)])
            self.assertAlmostEqual(res["value_each_side"][0], self.minimax(game, {("", 0): mix}), places=8)
            self.assertAlmostEqual(res["value_each_side"][0], -res["value_each_side"][1], places=8)
            self.assertTrue(np.array_equal(res["strategy"][""][0, :, 0], mix))

    def test_a_hold_can_only_cost_its_player(self):
        game = kuhn()
        free = lp.solve(game)["value_each_side"][0]
        for hand, mix in ((2, (1.0, 0.0)), (0, (0.0, 1.0)), (1, (0.0, 1.0))):
            held = locks.solve(game, [locks.Hold("", [0], [hand], mix)])["value_each_side"][0]
            self.assertLessEqual(held, free + 1e-9)

    def test_holding_the_equilibrium_changes_nothing(self):
        game = kuhn()
        res = lp.solve(game)
        node = next(n for n in game.acts if n.path == "")
        holds = [locks.Hold("", [0], [i], res["strategy"][""][0, :, i].tolist()) for i in range(game.n[0])]
        again = locks.solve(game, holds)
        self.assertEqual(len(node.names), 2)
        self.assertAlmostEqual(again["value_each_side"][0], res["value_each_side"][0], places=8)

    def test_holding_every_node_leaves_the_best_response(self):
        game = kuhn()
        rng = np.random.default_rng(5)
        holds = []
        for n in game.acts:
            if n.player == 0:
                for i in range(game.n[0]):
                    x = float(rng.random())
                    holds.append(locks.Hold(n.path, [0], [i], [x, 1 - x]))
        res = locks.solve(game, holds)
        fixed = locks.apply_holds(game, game.uniform(), holds)
        self.assertAlmostEqual(res["value_each_side"][1], game.value(fixed, 1, True), places=8)

    def test_held_values_is_the_restricted_best_response(self):
        game = kuhn()
        holds = [locks.Hold("", [0], [0], (0.5, 0.5))]
        res = locks.solve(game, holds)
        s = res["strategy"]
        self.assertAlmostEqual(locks.held_values(game, s, 0, holds), res["value_each_side"][0], places=8)
        self.assertAlmostEqual(locks.held_values(game, s, 1, holds), res["value_each_side"][1], places=8)
        self.assertGreaterEqual(game.value(s, 0, True), res["value_each_side"][0] - 1e-9)


class PolarRiver(unittest.TestCase):
    """A hand-solved river: the nuts or air against a bluff-catcher, one all-in of pot size. See invariants.polar_river."""

    def check(self, rate, cap):
        P, B = 20.0, 20.0
        rake = lambda pot: min(rate * pot, cap) if cap else rate * pot  # noqa: E731
        R0, R1 = rake(P), rake(P + 2 * B)
        b = B / (P + 2 * B - R1)
        c = (P - R0) / (P - R0 + B)
        x = b / (1 - b)
        v = (c * (P / 2 + B - R1) + (1 - c) * (P / 2 - R0) - P / 2) / 2
        g = polar(rate, cap)
        DCFR(g).run(6000)
        s = g.average()
        by = {n.path: n for n in g.acts}
        air = g.deal.names[0].index("6h5h")
        self.assertAlmostEqual(s[""][0, by[""].names.index("all-in"), air], x, delta=0.003)
        self.assertAlmostEqual(s["/all-in"][0, by["/all-in"].names.index("call"), 0], c, delta=0.003)
        self.assertAlmostEqual(g.value(s, 0), v, delta=0.01)

    def test_no_rake(self):
        self.check(0.0, None)

    def test_rake(self):
        self.check(0.05, None)

    def test_capped_rake(self):
        self.check(0.05, 2.0)

    def test_rake_leaves_the_table(self):
        g = polar(0.05)
        DCFR(g).run(500)
        s = g.average()
        self.assertAlmostEqual(g.value(s, 0) + g.value(s, 1), -g.expected_rake(s), places=10)

    @unittest.skipIf(lp is None, "needs scipy")
    def test_lp_refuses_rake(self):
        with self.assertRaises(ValueError):
            lp.solve(polar(0.05))

    @unittest.skipIf(lp is None, "needs scipy")
    def test_lp_and_dcfr_agree_on_a_turn(self):
        board = strip("Ks7d2c3h")
        tree = hu_tree(HUSpec(4, 20.0, 12.0, menu([0.75])))
        ranges = [C.parse_range("77,KQs,QJs", board), C.parse_range("AKs,JTs,99", board)]
        g = HUGame(Holdem(board, ranges), tree)
        r = lp.solve(g, method="highs-ipm")
        DCFR(g).run(3000)
        avg = g.gains(g.average())
        self.assertAlmostEqual(r["value_each_side"][0], avg["value"][0], delta=0.002)
        self.assertLess(max(abs(x) for x in g.gains(r["strategy"])["gain"]), 1e-6)


class ThreeWay(unittest.TestCase):
    def game(self, rate=0.0):
        board = strip("Ks7d2c3h9s")
        tree = mw_tree(MWSpec(3, 30.0, 60.0, [0.5]))
        ranges = [C.parse_range(x, board) for x in ("AdAh,QcQd", "AcKd,JcJd", "AsQh,TcTd")]
        return MWGame(board, ranges, tree, rate)

    def test_shares_by_hand(self):
        board = strip("Ks7d2c3h9s")
        tree = mw_tree(MWSpec(3, 30.0, 60.0, [0.5]))
        g = MWGame(board, [{"AdKh": 1.0}, {"AcKc": 1.0}, {"QdJd": 1.0}], tree)
        strat = g.uniform()
        always_check = {}
        for k, v in strat.items():
            always_check[k] = np.zeros_like(v)
            always_check[k][0, :] = 1.0
        self.assertAlmostEqual(g.value(always_check, 0), 15.0)        # the two kings chop
        self.assertAlmostEqual(g.value(always_check, 1), 15.0)
        self.assertAlmostEqual(g.value(always_check, 2), 0.0)

    def test_chips_are_conserved(self):
        for rate in (0.0, 0.05):
            g = self.game(rate)
            u = g.uniform()
            total = sum(g.value(u, p) for p in range(3))
            self.assertAlmostEqual(total, 30.0 - g.expected_rake(u), places=9)

    def test_gains_fall_and_are_never_negative(self):
        g = self.game()
        first = sum(g.gains(g.uniform())["gain"])
        g.run_dcfr(2000)
        r = g.gains(g.average())
        self.assertGreaterEqual(min(r["gain"]), -1e-9)
        self.assertLess(sum(r["gain"]), first / 50)


class PrizeEquity(unittest.TestCase):
    def test_by_hand(self):
        # 50 / 30 / 20 chips for 100 / 0: the chips' shares of first place
        self.assertEqual([round(x, 9) for x in icm.equities([50, 30, 20], [100])], [50.0, 30.0, 20.0])
        # for 60 / 40: A second after B (0.3 x 50/70) or after C (0.2 x 50/80)
        e = icm.equities([50, 30, 20], [60, 40])
        self.assertAlmostEqual(e[0], 60 * 0.5 + 40 * (0.3 * 50 / 70 + 0.2 * 50 / 80), places=9)
        self.assertAlmostEqual(sum(e), 100.0, places=9)

    def test_a_busted_player_keeps_the_place_it_took(self):
        self.assertAlmostEqual(icm.equities([60, 40, 0], [50, 30, 20])[2], 20.0)

    def test_winner_take_all_is_chips(self):
        p = icm.ICMPayoffs([40, 30, 30], [100], (0, 1), (10, 10))
        self.assertEqual([round(x, 9) for x in p.fold((25.0, 10.0), 1)], [10.0, -10.0])


if __name__ == "__main__":
    unittest.main()
