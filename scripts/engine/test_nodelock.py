"""engine/nodelock.py on spots small enough to run in seconds with or without the compiled core, numpy and treys being all
it needs: what a lock rejects, what it refuses, where it lands (one line of a merged subtree, the windows), what comes
back, and closed forms. The value of the restricted game against an LP is scripts/benchmarks/nodelock_bench.py's.

Lives here and not in scripts/benchmarks because it imports gto, and test_reference.py's independence test needs that
process free of it.

Run: .venv/bin/python -m unittest scripts/engine/test_nodelock.py
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import nodelock as nl  # noqa: E402
from engine.nodelock import Lock, LockError, LockRefused, _float32_mix, solve_locked  # noqa: E402
from gto import core  # noqa: E402
from gto.cards import card, card_str, cards  # noqa: E402
from gto.ranges import parse_range  # noqa: E402
from gto.solver import CFR_SCHEMES, Cancelled, Config, Decision, solve  # noqa: E402

STREETS = ("flop", "turn", "river")
BET = "bet 100%"
POT, STACK = 10.0, 100.0


def exact(bets=(1.0,), raises=(), max_raises=0, **more) -> Config:
    """Every card dealt, per combo: the benchmark's config."""
    return Config(**{**dict(bet_sizes={s: list(bets) for s in STREETS}, raise_sizes={s: list(raises) for s in STREETS},
                            max_raises=max_raises, allin_spr=0.0, depth=3, n_turns=49, n_rivers=None, river_sample=None,
                            n_rivers_from_flop=48, leaf_turns=49, leaf_rivers=None, leaf_rivers_flop=48, river_play=False,
                            turn_classes=False, later_sizes=None, river_classes=False), **more})


# A polar river: OOP has KK (a set, 3 combos) and 65s (air, 4 combos), IP has QQ, which beats the air only. Nothing blocks.
BOARD = cards("2c7d9hJsKd")
OOP, IP = parse_range("KK,65s"), parse_range("QQ")
VALUE, AIR = 3 / 7, 4 / 7


CALLS = [Lock((BET,), 1, {"call": 0.3, "fold": 0.7})]
HELD = _float32_mix(np.array([0.7, 0.3, 0.0]))[:, None]


def polar(locks, iters=2000, **more):
    return solve_locked(BOARD, OOP, IP, POT, STACK, locks, cfg=exact(**more), time_budget=1e9, max_iters=iters)


# A turn of a few hands: two turn lines reach a river with the same shape, so the merge shares their subtrees.
TURN = cards("Ks7d2c3h")
T_OOP, T_IP = parse_range("77,KQs"), parse_range("AKs,QQ")
LINE_A = ("bet 100%", "call", "As")
LINE_B = ("check", "bet 100%", "call", "As")


def turn(locks, iters=120, **more):
    return solve_locked(TURN, T_OOP, T_IP, 20.0, 40.0, locks, cfg=exact(**more), time_budget=1e9, max_iters=iters)


class ClosedForm(unittest.TestCase):
    """A pot-sized bet with P = B = 10: equilibrium bets the value and 1.5 air combos, QQ calls half: OOP earns 15 with
    the value and 0 with the air, 45/7 a deal. Those are shares of the pot; the engine's values are net of the half each
    player started with, so `values` puts it back and they add to the pot."""

    def values(self, sol):
        m = sol.measure()
        self.assertAlmostEqual(m["value"][0] + m["value"][1], 0.0, places=4)
        self.assertLess(m["exploitability_pct"], 0.05)
        for k in ("value", "best_response_held", "best_response_free"):
            m[k] = [x + POT / 2 for x in m[k]]
        return m

    def test_an_empty_lock_is_the_equilibrium(self):
        m = self.values(polar([]))
        self.assertAlmostEqual(m["value"][0], 45 / 7, places=2)
        self.assertEqual(m["lock_cost"], [0.0, 0.0])

    def test_always_folding_gives_every_hand_the_pot(self):
        m = self.values(polar([Lock((BET,), 1, {"fold": 1.0})]))
        self.assertAlmostEqual(m["value"][0], POT, places=3)

    def test_always_calling_stops_the_bluffs(self):
        sol = polar([Lock((BET,), 1, {"call": 1.0})])
        m = self.values(sol)
        self.assertAlmostEqual(m["value"][0], VALUE * 20, places=3)
        names, _, s = sol.strategy_at(())
        self.assertEqual(names, ["check", BET])
        air = sol.ctx.active.tolist()
        self.assertGreater(s[0, 1, :].max(), 0.99)                # the value bets
        self.assertLess(s[0, 1, :].min(), 0.01)                   # the air doesn't
        self.assertEqual(len(air), s.shape[2])

    def test_a_locked_range_that_only_bets_is_called(self):
        m = self.values(polar([Lock((), 0, {BET: 1.0})]))
        self.assertAlmostEqual(m["value"][1], AIR * 20 - VALUE * 10, places=3)

    def test_the_air_never_bluffing_is_folded_to(self):
        m = self.values(polar([Lock((), 0, {"check": 1.0}, {"classes": ["65s"]})]))
        self.assertAlmostEqual(m["value"][0], VALUE * 10, places=3)
        # free of its lock OOP would bluff every air hand into the folds
        self.assertAlmostEqual(m["best_response_free"][0], 10.0, places=3)
        self.assertAlmostEqual(m["lock_cost"][0], 10.0 - VALUE * 10, places=3)
        self.assertAlmostEqual(m["lock_cost"][1], 0.0, places=6)

    def test_one_air_combo_held_back_changes_nothing(self):
        m = self.values(polar([Lock((), 0, {"check": 1.0}, {"combos": ["6h5h"]})]))
        self.assertAlmostEqual(m["value"][0], 45 / 7, places=2)

    def test_too_few_bluffs_left_is_not_the_equilibrium(self):
        """Three of four air combos held back leaves 1 bluff a value 3: under the 1.5 it takes, so IP folds."""
        m = self.values(polar([Lock((), 0, {"check": 1.0}, {"combos": ["6h5h", "6s5s", "6c5c"]})]))
        self.assertAlmostEqual(m["value"][0], VALUE * 10 + 1 / 7 * 10, places=3)

    def test_the_lock_can_cost_only_its_player(self):
        """The player's best response with its lock dropped is never worse than with it held."""
        for lock in (Lock((), 0, {BET: 0.5, "check": 0.5}), Lock((BET,), 1, {"call": 0.2, "fold": 0.8})):
            m = polar([lock]).measure()
            for p in (0, 1):
                self.assertGreaterEqual(m["lock_cost"][p], -1e-5)

    def test_every_node_of_one_player_is_the_others_best_response(self):
        """OOP fixed everywhere with a mix by hand: IP's value is read off by hand."""
        s = polar([Lock((), 0, {BET: 0.25, "check": 0.75})] +
                  [Lock(line, 0, {"call": 1.0}, {"classes": ["KK"]}) for line in (("check", BET), (BET, "all-in"))] +
                  [Lock(line, 0, {"fold": 1.0}, {"classes": ["65s"]}) for line in (("check", BET), (BET, "all-in"))])
        # a bet (the range's shape unchanged): QQ calls, 20 from the air and -10 from the value. A check: QQ checks behind,
        # taking the pot from the air, 0 from the value; betting would lose 10 more to the value and win no more.
        m = self.values(s)
        self.assertAlmostEqual(m["value"][1], .25 * (AIR * 20 - VALUE * 10) + .75 * AIR * 10, places=3)


class Rejected(unittest.TestCase):
    def refused(self, lock, says):
        with self.assertRaises(LockError) as e:
            polar([lock], iters=1)
        self.assertRegex(str(e.exception), says)

    def test_a_mix_that_doesnt_sum_to_one(self):
        self.refused(Lock((), 0, {"check": 0.5, BET: 0.4}), "sum to 1")
        self.refused(Lock((), 0, {"check": 0.5, BET: 0.6}), "sum to 1")
        self.refused(Lock((), 0, {}), "sum to 1")

    def test_a_mix_within_the_tolerance_is_taken(self):
        self.assertTrue(polar([Lock((), 0, {"check": 0.5, BET: 0.5 + 1e-10})], iters=1).applied[0].cells)

    def test_a_mix_with_a_bad_number(self):
        self.refused(Lock((), 0, {"check": float("nan"), BET: 1.0}), "finite")
        self.refused(Lock((), 0, {"check": float("inf"), BET: 1.0}), "finite")
        self.refused(Lock((), 0, {"check": -0.5, BET: 1.5}), "at least 0")
        self.refused(Lock((), 0, ["half", "half"]), "numbers")

    def test_a_mix_of_the_wrong_shape(self):
        self.refused(Lock((), 0, [1.0]), "1 frequencies for 2")
        self.refused(Lock((), 0, {"raise": 1.0}), "no action 'raise'")

    def test_a_line_that_isnt_there(self):
        self.refused(Lock(("bet 50%",), 1, {"call": 1.0}), r"no action 'bet 50%'.*'check', 'bet 100%'")
        self.refused(Lock((BET, "fold", "check"), 0, {"check": 1.0}), "the hand is over")
        self.refused(Lock((BET, "fold"), 0, {"check": 1.0}), "ends the hand")

    def test_the_wrong_player(self):
        self.refused(Lock((), 1, {"check": 1.0}), "player 0 acts there")

    def test_a_scope_that_isnt_one(self):
        self.refused(Lock((), 0, {"check": 1.0}, "KK"), "hands:")
        self.refused(Lock((), 0, {"check": 1.0}, {}), "hands:")
        self.refused(Lock((), 0, {"check": 1.0}, {"players": ["KK"]}), "hands:")
        self.refused(Lock((), 0, {"check": 1.0}, {"classes": ["KK+"]}), "bad class")
        self.refused(Lock((), 0, {"check": 1.0}, {"combos": ["KhKh"]}), "bad combo")
        self.refused(Lock((), 0, {"check": 1.0}, {"combos": ["Kx2h"]}), "bad combo")
        self.refused(Lock((), 0, {"check": 1.0}, {"classes": [], "combos": []}), "names no hands")

    def test_two_locks_on_a_hand_must_agree(self):
        with self.assertRaisesRegex(LockError, "different mixes"):
            polar([Lock((), 0, {"check": 1.0}), Lock((), 0, {BET: 1.0}, {"classes": ["KK"]})], iters=1)
        sol = polar([Lock((), 0, {"check": 1.0}), Lock((), 0, {"check": 1.0}, {"classes": ["KK"]})], iters=1)
        self.assertEqual(sol.applied[1].cells, 3)

    def test_a_chance_node_needs_a_card_or_all_of_them(self):
        with self.assertRaisesRegex(LockError, "name a card"):
            turn([Lock(("check", "check", "check"), 0, {"check": 1.0})], iters=1)
        with self.assertRaisesRegex(LockError, "ends at a chance node"):
            turn([Lock(LINE_A[:2], 0, {"check": 1.0})], iters=1)
        with self.assertRaisesRegex(LockError, "isn't a card of this tree"):
            turn([Lock(("bet 100%", "call", "Ks"), 0, {"check": 1.0})], iters=1)


class Hands(unittest.TestCase):
    def test_hands_outside_the_range_are_ignored_and_counted(self):
        sol = polar([Lock((), 0, {"check": 1.0}, {"classes": ["AA"], "combos": ["KhKs", "Kd2h", "2h3h"]})], iters=10)
        a = sol.applied[0]
        self.assertEqual((a.cells, a.ignored), (1, 6 + 2))
        self.assertIn("3h2h", a.ignored_hands)

    def test_a_board_card_in_a_named_class_is_counted_too(self):
        a = polar([Lock((), 0, {"check": 1.0}, {"classes": ["KK"]})], iters=1).applied[0]
        self.assertEqual((a.cells, a.ignored), (3, 3))

    def test_none_in_range_says_so_and_changes_nothing(self):
        sol = polar([Lock((), 0, {"check": 1.0}, {"classes": ["AA"]})])
        self.assertEqual(sol.applied[0].cells, 0)
        self.assertIn("changes nothing", sol.applied[0].notes[0])
        self.assertAlmostEqual(sol.measure()["value"][0], 45 / 7 - POT / 2, places=2)

    def test_a_dead_card_isnt_a_hand(self):
        dead = cards("6h")
        sol = solve_locked(BOARD, OOP, IP, POT, STACK, [Lock((), 0, {"check": 1.0}, {"classes": ["65s"]})], cfg=exact(),
                           time_budget=1e9, max_iters=2, dead=dead)
        self.assertEqual((sol.applied[0].cells, sol.applied[0].ignored), (3, 1))

    def test_a_lock_on_one_combo_leaves_the_others_free(self):
        sol = polar([Lock((), 0, {BET: 0.25, "check": 0.75}, {"combos": ["KhKs"]})])
        s = sol.strategy_at(())[2][0]
        pinned = np.flatnonzero(np.isclose(s[1], 0.25, atol=1e-6))
        self.assertEqual(len(pinned), 1)
        self.assertGreater((s[1] > 0.99).sum(), 1)


class Mix(unittest.TestCase):
    def test_avg_strategy_gives_the_mix_back(self):
        mix = np.array([0.1, 0.7, 0.2])
        locks = [Lock((BET,), 1, mix.tolist())]
        for iters in (1, 7, 64, 65, 500):
            sol = polar(locks, iters=iters)
            names, _, s = sol.strategy_at((BET,))
            self.assertEqual(names, ["fold", "call", "all-in"])
            hands = np.flatnonzero(sol.r1 > 0)
            self.assertTrue((s[0][:, hands] == _float32_mix(mix)[:, None]).all(), iters)
            self.assertLess(np.abs(s[0][:, hands] - mix[:, None]).max(), 1e-7)

    def test_awkward_mixes_add_to_one_in_float32(self):
        rng = np.random.default_rng(3)
        for n in (2, 3, 5, 7):
            for _ in range(3000):
                m = rng.dirichlet(np.ones(n) * 0.3)
                m = m / m.sum()
                got = _float32_mix(m)
                s = np.float32(0.0)
                for x in got:
                    s = s + x
                self.assertEqual(s, 1.0)
                self.assertLess(np.abs(got - m).max(), 4e-7)

    def test_zeros_stay_zero_and_ones_stay_one(self):
        self.assertEqual(_float32_mix(np.array([0.0, 1.0, 0.0])).tolist(), [0.0, 1.0, 0.0])

    def test_the_strategy_played_stays_on_the_mix_between_the_pins(self):
        """Regret matching's strategy, read at the point of a slice furthest from its pin: the last iteration before it."""
        sol = polar(CALLS, iters=nl.PIN_EVERY)
        s = sol.solver
        node = s.resolve((BET,))[0]
        pin = s._pins[id(node)]
        drift = []
        real = s.pin

        def spy():
            drift.append(np.abs(node.strategy() - pin.mix)[:, :, pin.mask[0]].max())
            real()
        s.pin = spy
        s.run(sol.r0, sol.r1, time_budget=1e9, max_iters=nl.PIN_EVERY * 6)
        s.pin = real
        self.assertTrue(drift)
        self.assertLess(max(drift), 1e-5)

    def test_every_regret_scheme_holds_it(self):
        for name in CFR_SCHEMES:
            sol = polar(CALLS, iters=300, cfr=name)
            m = sol.measure()
            hands = np.flatnonzero(sol.r1 > 0)
            self.assertTrue((sol.strategy_at((BET,))[2][0][:, hands] == HELD).all(),
                            name)
            # the value bets and the air, folded to 70% for -30%: 7 - 3 = +4 over checking's 0: both always bet
            self.assertAlmostEqual(m["value"][0] + POT / 2, VALUE * (0.7 * 10 + 0.3 * 20) + AIR * 4, delta=0.1, msg=name)


class Merged(unittest.TestCase):
    """The likeliest silent bug: both lines' rows live in one merged Decision, whose regrets a pin must not reach whole."""

    def locked(self, **more):
        return turn([Lock(LINE_A, 0, {"check": 1.0})], **more)

    def test_the_two_lines_share_a_merged_node(self):
        s = self.locked(iters=1).solver
        a, b = s.resolve(LINE_A)[0], s.resolve(LINE_B)[0]
        self.assertEqual(a.names, b.names)
        self.assertIsNot(a, b)
        merged = next(m for m, members in s._groups if len(members) == 2).child
        self.assertTrue(np.shares_memory(merged.regret, a.regret))
        self.assertTrue(np.shares_memory(merged.regret, b.regret))
        self.assertFalse(np.shares_memory(a.regret, b.regret))
        self.assertEqual(merged.B, a.B + b.B)

    def test_only_the_named_line_is_held(self):
        sol = self.locked()
        s = sol.solver
        a, b = s.resolve(LINE_A), s.resolve(LINE_B)
        self.assertEqual(int(s._pins[id(a[0])].mask.sum()), sol.applied[0].cells)
        self.assertNotIn(id(b[0]), s._pins)
        self.assertLess(np.abs(b[0].regret).max(), 2.0 ** 30)
        self.assertGreater(np.abs(a[0].regret).max(), 2.0 ** 30)
        hands = np.flatnonzero(sol.r0 > 0)
        self.assertTrue((sol.strategy_at(LINE_A)[2][0][0][hands] == 1.0).all())
        played = sol.strategy_at(LINE_B)[2][0]
        self.assertGreater(played[1, hands].max(), 0.2)     # the sibling still bets something on that card

    def test_only_the_named_runout_is_held(self):
        sol = self.locked()
        s = sol.solver
        node, rows, _, _ = s.resolve(LINE_A)
        pin = s._pins[id(node)]
        self.assertEqual(rows, np.flatnonzero(pin.mask.any(axis=1)).tolist())
        self.assertEqual(len(rows), 1)
        self.assertGreater(node.B, 40)

    def test_the_walk_over_merged_nodes_agrees_with_the_walk_over_the_originals(self):
        """The core runs on the original tree, numpy on the merged one."""
        if core.lib() is None:
            self.skipTest("no compiled core here")
        locks = [Lock(LINE_A, 0, {"check": 1.0})]
        native = turn(locks, iters=30)
        with mock.patch.object(nl.LockedSolver, "use_core", False, create=True):
            original = nl.LockedSolver.__init__

            def plain(self, *a):
                original(self, *a)
                self.use_core = False
            with mock.patch.object(nl.LockedSolver, "__init__", plain):
                merged = turn(locks, iters=30)
        self.assertEqual(native.iters, merged.iters)
        mn, mm = native.measure(), merged.measure()
        self.assertAlmostEqual(mn["value"][0], mm["value"][0], places=3)
        self.assertAlmostEqual(mn["best_response_held"][1], mm["best_response_held"][1], places=3)

    def test_all_runouts_cover_every_row_a_hand_can_be_on(self):
        sol = turn([Lock(LINE_A[:2] + ("*",), 0, {"check": 1.0})], iters=2)
        a = sol.applied[0]
        self.assertEqual(a.rows, a.rows_total)
        self.assertGreater(a.blocked, 0)              # a combo's own river: no reach there, pinned all the same


class Windows(unittest.TestCase):
    def test_a_whole_range_lock_pins_the_range_and_no_more(self):
        sol = polar([Lock((), 0, {"check": 1.0})], iters=2)
        self.assertEqual(sol.applied[0].cells, 7)

    def test_with_and_without_windows_agree(self):
        lock = [Lock((), 0, {"check": 1.0}, {"classes": ["KQs"]}), Lock(LINE_A, 0, {"check": 1.0})]
        on = turn(lock)
        with mock.patch("gto.solver.WINDOWS", False):
            off = turn(lock)
        self.assertAlmostEqual(on.measure()["value"][0], off.measure()["value"][0], places=2)


class Warm(unittest.TestCase):
    def warm(self, prior):
        return solve_locked(BOARD, OOP, IP, POT, STACK, CALLS, cfg=exact(), time_budget=1e9, max_iters=300, warm=prior)

    def check(self, sol):
        hands = np.flatnonzero(sol.r1 > 0)
        self.assertTrue((sol.strategy_at((BET,))[2][0][:, hands] == HELD).all())
        self.assertLess(sol.measure()["exploitability_pct"], 0.2)

    def test_from_an_unlocked_solve(self):
        self.check(self.warm(solve(BOARD, OOP, IP, POT, STACK, cfg=exact(), time_budget=1e9, max_iters=300)))

    def test_from_the_same_lock(self):
        self.check(self.warm(polar(CALLS, iters=300)))

    def test_from_another_lock_leaves_no_pin_behind(self):
        prior = polar([Lock((), 0, {"check": 1.0}), Lock(("check", BET), 0, {"fold": 1.0})], iters=300)
        sol = self.warm(prior)
        self.check(sol)
        s = sol.solver
        root = s.resolve(())[0]
        self.assertNotIn(id(root), s._pins)
        self.assertLess(np.abs(root.regret).max(), 2.0 ** 30)
        hands = np.flatnonzero(sol.r0 > 0)
        self.assertGreater(sol.strategy_at(())[2][0][1, hands].min(), 0.95)    # the old lock checked; folded to, all bet

    def test_the_warm_regret_of_a_lock_on_a_hand_scope_only_there(self):
        prior = polar([Lock((), 0, {BET: 1.0}, {"classes": ["KK"]})], iters=100)
        s = solve_locked(BOARD, OOP, IP, POT, STACK, [Lock((), 0, {BET: 1.0}, {"classes": ["65s"]})], cfg=exact(),
                         time_budget=1e9, max_iters=100, warm=prior).solver
        root = s.resolve(())[0]
        pin = s._pins[id(root)]
        self.assertLess(np.abs(root.regret[:, :, ~pin.mask[0]]).max(), 2.0 ** 30)


class Extending(unittest.TestCase):
    def test_extend_keeps_the_pins(self):
        sol = polar(CALLS, iters=100)
        sol.extend(time_budget=1e9, max_iters=200)
        self.assertEqual(sol.iters, 200)
        hands = np.flatnonzero(sol.r1 > 0)
        self.assertTrue((sol.strategy_at((BET,))[2][0][:, hands] == HELD).all())
        self.assertLess(sol.measure()["exploitability_pct"], 0.5)

    def test_cancelling_leaves_the_sums_pinned(self):
        calls = []

        def stop():
            calls.append(1)
            if len(calls) > 3:
                raise Cancelled()
            return False

        with self.assertRaises(Cancelled) as e:
            solve_locked(BOARD, OOP, IP, POT, STACK, CALLS, cfg=exact(),
                         time_budget=1e9, max_iters=5000, should_stop=stop)
        sol = e.exception.sol
        hands = np.flatnonzero(sol.r1 > 0)
        self.assertTrue((sol.strategy_at((BET,))[2][0][:, hands] == HELD).all())


class Measure(unittest.TestCase):
    def test_exploitability_is_the_restricted_games(self):
        """A lock far off equilibrium: the unlocked measure would be large, the restricted one small."""
        sol = polar([Lock((), 0, {BET: 1.0})])
        m = sol.measure()
        self.assertLess(m["exploitability_pct"], 0.01)
        self.assertGreater(m["best_response_free"][0] - m["best_response_held"][0], 1.0)
        self.assertAlmostEqual(sol.exploitability(), m["exploitability_pct"], places=6)

    def test_a_bad_answer_is_measured_as_one(self):
        self.assertGreater(polar(CALLS, iters=1).measure()["exploitability_pct"], 1)

    def test_the_numpy_walk_measures_the_same(self):
        sol = polar([Lock((), 0, {"check": 1.0}, {"classes": ["65s"]})])
        m = sol.measure()
        with mock.patch.object(core, "evaluate", return_value=None):
            n = sol.measure()
        for k in ("value", "best_response_held", "best_response_free"):
            self.assertTrue(np.allclose(m[k], n[k], atol=1e-3), k)

    def test_a_report_says_what_it_is(self):
        r = polar([Lock((), 0, {"check": 1.0}, {"classes": ["65s"]})], iters=5).report()
        self.assertEqual((r["kind"], r["game"]), ("node-locked equilibrium", "restricted"))
        self.assertIn("not the unlocked equilibrium", r["label"])
        self.assertEqual(r["locks"][0]["actions"], ["check", BET])
        import json
        json.dumps(r)

    def test_rake_runs_and_nobody_can_gain_much(self):
        sol = polar([Lock((), 0, {BET: 0.5, "check": 0.5})], rake_rate=0.05, rake_cap=3.0)
        m = sol.measure()
        self.assertGreaterEqual(min(m["gain_held"]), -0.02)
        self.assertLess(m["exploitability_pct"], 0.1)


class Abstraction(unittest.TestCase):
    """A small app-like tree: which cells exist is the solver's; a lock can fix them or say why not."""
    F = cards("Kd7c2h")
    O, I = parse_range("KQs,76s,65s"), parse_range("QQ,AKs")

    def flop(self, locks, iters=4, **more):
        cfg = Config(**{**dict(bet_sizes={s: [1.0] for s in STREETS}, raise_sizes={s: [] for s in STREETS}, max_raises=0,
                               allin_spr=0.0), **more})
        return solve_locked(self.F, self.O, self.I, 6.0, 30.0, locks, cfg=cfg, time_budget=1e9, max_iters=iters)

    def bucketed_line(self, sol):
        s = sol.solver
        for line, p, names in nl.lines(sol.root):
            node = s.resolve(line)[0]
            if isinstance(node, Decision) and node.bucketed:
                return line, p, names
        self.fail("no bucketed node")

    BUCKETS = dict(n_turns=3, n_rivers_from_flop=3, leaf_turns=3, leaf_rivers_flop=3, turn_buckets=True, river_buckets=8)

    def test_buckets_refuse_hands_and_take_the_whole_range(self):
        sol = self.flop([], **self.BUCKETS)
        line, p, names = self.bucketed_line(sol)
        scope = {"combos": ["KhQh"]} if p == 0 else {"classes": ["QQ"]}
        with self.assertRaisesRegex(LockRefused, "hand buckets"):
            self.flop([Lock(line, p, [1.0] + [0.0] * (len(names) - 1), scope)], **self.BUCKETS)
        held = self.flop([Lock(line, p, [1.0] + [0.0] * (len(names) - 1))], **self.BUCKETS)
        a = held.applied[0]
        self.assertTrue(any("buckets" in n for n in a.notes))
        got = held.strategy_at(line)[2]
        self.assertTrue((got[:, 0] == 1.0).all())

    def test_a_turn_card_of_a_class_is_named_by_its_played_card(self):
        kw = dict(turn_classes=True, n_turns=49, n_rivers_from_flop=2, leaf_turns=49, leaf_rivers_flop=2)
        sol = self.flop([], iters=1, **kw)
        s = sol.solver
        node = s.resolve(("check", "check", "*"))[0]
        classes = s.ctx.turn_classes(self.F, s.dead)
        played, members = next((p, c) for p, c in classes if len(c) > 1)
        other = next(c for c in members if c != played)
        from gto.cards import card_str
        with self.assertRaisesRegex(LockError, f"played as {card_str(played)}"):
            self.flop([Lock(("check", "check", card_str(other)), 0, [1.0, 0.0])], iters=1, **kw)
        held = self.flop([Lock(("check", "check", card_str(played)), 0, [1.0, 0.0])], iters=1, **kw)
        self.assertRegex(held.applied[0].notes[0], "stands for its class")
        self.assertEqual(held.applied[0].rows, 1)
        self.assertLess(held.applied[0].rows, node.B + 1)


class HoldStrategy(unittest.TestCase):
    """street_strategy and hold_strategy: a whole street of one player's play, combo by combo, from one solve laid on
    another (scripts/benchmarks/abstraction.py's measure of the flop abstraction)."""
    F = cards("Kd7c2h")
    O, I = parse_range("KQs,76s,65s,22"), parse_range("QQ,AKs,A2s")
    POT, STACK = 6.0, 9.0      # (the stack under two bets: the turn and river end in all-ins, a small tree)
    BUCKETS = dict(turn_classes=True, n_turns=3, n_rivers_from_flop=3, leaf_turns=3, leaf_rivers_flop=3,
                   turn_buckets=True, river_buckets=4, later_sizes=None)

    def exact_flop(self, locks=(), seed=None, iters=200):
        return solve_locked(self.F, self.O, self.I, self.POT, self.STACK, list(locks), cfg=exact(bets=(0.5,)),
                            time_budget=1e9, max_iters=iters, seed=seed)

    def abstract_flop(self, iters=200):
        cfg = Config(**{**dict(bet_sizes={s: [0.5] for s in STREETS}, raise_sizes={s: [] for s in STREETS},
                               max_raises=0, allin_spr=0.0), **self.BUCKETS})
        return solve(self.F, self.O, self.I, self.POT, self.STACK, cfg=cfg, time_budget=1e9, max_iters=iters)

    def held(self, source, p, iters=200):
        info = {}

        def seed(root, s):
            info["cells"] = nl.hold_strategy(s, nl.street_strategy(source, p), p)

        sol = self.exact_flop(seed=seed, iters=iters)
        return sol, info["cells"]

    def test_the_street_has_every_decision_of_the_player_and_no_more(self):
        sol = self.exact_flop(iters=2)
        for p in (0, 1):
            got = nl.street_strategy(sol, p)
            want = {line for line, q, _ in nl.lines(sol.root) if q == p and "*" not in line}
            self.assertEqual(set(got), want)
            for names, s in got.values():
                self.assertEqual(s.shape, (len(names), 1326))
                on = s.sum(axis=0) > 0
                self.assertTrue(np.allclose(s.sum(axis=0)[on], 1.0, atol=1e-5))
                self.assertEqual(int(on.sum()), sol.ctx.n)

    def test_holding_an_equilibrium_moves_no_value(self):
        free = self.exact_flop(iters=400)
        v = free.measure()["value"]
        for p in (0, 1):
            sol, cells = self.held(free, p, iters=400)
            m = sol.measure()
            self.assertGreater(cells, 0)
            self.assertAlmostEqual(m["value"][p], v[p], delta=0.003 * self.POT)
            self.assertLess(m["exploitability_pct"], 0.3)

    def test_the_held_mix_comes_back_combo_by_combo(self):
        src = self.abstract_flop(iters=50)
        want = nl.street_strategy(src, 0)
        sol, _ = self.held(src, 0, iters=30)
        got = nl.street_strategy(sol, 0)
        for line, (names, s) in want.items():
            on = s.sum(axis=0) > 0
            self.assertTrue(np.allclose(got[line][1][:, on], s[:, on], atol=1e-6), line)

    def test_a_held_player_cant_gain_and_its_opponent_cant_lose(self):
        """With one player's flop fixed at another game's answer, that player's restricted-game value is at most its
        equilibrium value, and the other's at least theirs (a zero-sum game: a restriction can only cost its player)."""
        free = self.exact_flop(iters=400).measure()["value"]
        src = self.abstract_flop()
        tol = 0.003 * self.POT
        for p in (0, 1):
            m = self.held(src, p, iters=400)[0].measure()
            self.assertLessEqual(m["value"][p], free[p] + tol)
            self.assertGreaterEqual(m["value"][1 - p], free[1 - p] - tol)
            self.assertLess(m["exploitability_pct"], 0.3)

    def test_a_missing_or_different_decision_is_refused(self):
        src = nl.street_strategy(self.exact_flop(iters=2), 0)
        line = next(iter(src))
        short = {k: v for k, v in src.items() if k != line}
        with self.assertRaisesRegex(LockError, "no strategy given"):
            self.exact_flop(seed=lambda root, s: nl.hold_strategy(s, short, 0), iters=1)
        names, s = src[line]
        renamed = {**src, line: (list(reversed(names)), s)}
        with self.assertRaisesRegex(LockError, "aren't the tree's"):
            self.exact_flop(seed=lambda root, s: nl.hold_strategy(s, renamed, 0), iters=1)
        extra = {**src, ("bet 999%",): (names, s)}
        with self.assertRaisesRegex(LockError, "not a decision"):
            self.exact_flop(seed=lambda root, s: nl.hold_strategy(s, extra, 0), iters=1)

    def test_it_wont_hold_over_another_lock(self):
        src = nl.street_strategy(self.exact_flop(iters=2), 0)
        with self.assertRaisesRegex(LockError, "already locked"):
            self.exact_flop([Lock((), 0, {"check": 1.0})], seed=lambda root, s: nl.hold_strategy(s, src, 0), iters=1)


class RiverClasses(unittest.TestCase):
    def solve(self, locks):
        return solve_locked(TURN, T_OOP, T_IP, 20.0, 40.0, locks, cfg=exact(river_classes=True), time_budget=1e9, max_iters=3)

    def test_a_hand_under_river_classes_is_refused(self):
        with self.assertRaisesRegex(LockRefused, "river class"):
            self.solve([Lock(("check", "check", "*"), 0, [1.0, 0.0], {"classes": ["77"]})])

    def test_the_whole_range_under_them_is_honoured(self):
        a = self.solve([Lock(("check", "check", "*"), 0, [1.0, 0.0])]).applied[0]
        self.assertEqual(a.rows, a.rows_total)

    def test_a_hand_above_them_is_honoured_and_noted(self):
        sol = self.solve([Lock((), 0, [1.0, 0.0], {"classes": ["KQs"]})])
        self.assertRegex(sol.applied[0].notes[-1], "symmetric")


class OneStreetBack(unittest.TestCase):
    """lift, runout_token and street_moves: a later street's lock held from an earlier root, so the earlier street
    re-solves around it (engine/study_lock.py reach "back"). The reference for the value is nodelock_bench.py's
    turn-merged cases (a river lock held from the turn's root, against an LP: within 0.05% of the pot); here, on an
    exact flop small enough for seconds, what must hold whatever the lock: the restricted game is solved (exploitability
    under 0.3% of the pot), the lock can cost only its player (0.3% of the pot), and the flop moves."""
    F = cards("Kd7c2h")
    O, I = parse_range("KQs,76s,65s,22"), parse_range("QQ,AKs,A2s")
    POT, STACK = 6.0, 9.0

    def flop(self, locks=(), iters=400, **more):
        return solve_locked(self.F, self.O, self.I, self.POT, self.STACK, list(locks), cfg=exact(bets=(0.5,), **more),
                            time_budget=1e9, max_iters=iters)

    def test_lift_puts_the_earlier_line_in_front(self):
        lk = Lock(("As", "check"), 1, {"check": 1.0}, {"classes": ["QQ"]})
        up = nl.lift(lk, ("check", "check"))
        self.assertEqual(up.line, ("check", "check", "As", "check"))
        self.assertEqual((up.player, up.mix, up.hands), (1, lk.mix, lk.hands))

    def test_a_dealt_card_is_its_own_token(self):
        sol = self.flop(iters=1)
        self.assertEqual(nl.runout_token(sol, ("check", "check"), card("As")), ("As", []))
        with self.assertRaisesRegex(LockError, "doesn't end where a card is dealt"):
            nl.runout_token(sol, ("check",), card("As"))
        with self.assertRaisesRegex(LockError, "no action"):
            nl.runout_token(sol, ("bet 999%",), card("As"))

    def test_a_card_of_a_class_is_its_played_card_with_a_note(self):
        sol = self.flop(iters=1, turn_classes=True)
        classes = sol.ctx.turn_classes(self.F, sol.solver.dead)
        played, members = next((p, c) for p, c in classes if len(c) > 1)
        other = next(c for c in members if c != played)
        token, notes = nl.runout_token(sol, ("check", "check"), other)
        self.assertEqual(token, card_str(played))
        self.assertRegex(notes[0], f"{card_str(other)} is played as {card_str(played)}")
        self.assertEqual(nl.runout_token(sol, ("check", "check"), played), (card_str(played), []))

    def test_a_turn_lock_moves_the_flop_and_the_flop_is_solved_around_it(self):
        free = self.flop()
        # OOP never bets the turn after the flop goes check-check, on every turn card
        held = self.flop([Lock(("check", "check", "*"), 0, {"check": 1.0})])
        m, v = held.measure(), free.measure()["value"]
        tol = 0.003 * self.POT
        self.assertLess(m["exploitability_pct"], 0.3)
        self.assertLessEqual(m["value"][0], v[0] + tol)
        self.assertGreaterEqual(m["value"][1], v[1] - tol)
        moves = nl.street_moves(free, held)
        self.assertEqual({tuple(x["line"]) for x in moves}, {(), ("check",), ("bet 50%",), ("bet 50%", "all-in"),
                                                              ("check", "bet 50%"), ("check", "bet 50%", "all-in")})
        for x in moves:
            for mix in (x["unlocked"], x["locked"]):
                if mix is not None:
                    self.assertAlmostEqual(sum(mix), 1.0, delta=1e-5)
        root = next(x for x in moves if x["line"] == [])
        self.assertEqual(root["share"], [1.0, 1.0])
        # IP, checked to, takes the free card more or bets more: something on the flop moves by a point or more
        self.assertGreater(max(x["moved"] or 0 for x in moves), 1.0, moves)

    def test_an_empty_lock_moves_nothing(self):
        a, b = self.flop(iters=200), self.flop(iters=200)
        self.assertTrue(all((x["moved"] or 0) < 1e-6 for x in nl.street_moves(a, b)))


if __name__ == "__main__":
    unittest.main()
