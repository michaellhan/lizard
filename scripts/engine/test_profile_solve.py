"""engine/profile_solve.py: a player profile held at every decision of theirs, the rest re-solved.

On exact trees (every card dealt, per combo) small enough to run in seconds: the pins are the profile's rule laid on the
equilibrium at every decision of the profiled player, the re-solve's value for the other player is an independent best
response's to that strategy (Solver._best_response with TendencyLock laid on during the walk), and the held player
can't gain. Then through the real Advisor at the worker's Fast config: Study's answer, Exploit practice's advice and the
opponent's move read off the same re-solve, and what's refused is refused in words.

Run: .venv/bin/python -m unittest scripts/engine/test_profile_solve.py
"""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine import nodelock as nl  # noqa: E402
from engine import profile_solve as ps  # noqa: E402
from engine import study_lock as sl  # noqa: E402
from engine import exploit_play as xp  # noqa: E402
from engine.nodelock import LockError  # noqa: E402
from gto import advisor as A  # noqa: E402
from gto.cards import cards  # noqa: E402
from gto.exploit import TendencyLock  # noqa: E402
from gto.ranges import parse_range  # noqa: E402
from gto.solver import Config, Decision, solve  # noqa: E402
from test_study_lock import FAST, HAND, ON_FLOP, ON_TURN, RIVER, advisor  # noqa: E402
from test_exploit_play import SPOT, STATION  # noqa: E402

STREETS = ("flop", "turn", "river")


def exact(bets=(0.5, 1.0), raises=(1.0,), max_raises=1) -> Config:
    return Config(bet_sizes={s: list(bets) for s in STREETS}, raise_sizes={s: list(raises) for s in STREETS},
                  max_raises=max_raises, allin_spr=0.0, depth=3, n_turns=49, n_rivers=None, river_sample=None,
                  n_rivers_from_flop=48, leaf_turns=49, leaf_rivers=None, leaf_rivers_flop=48, river_play=False,
                  turn_classes=False, later_sizes=None, river_classes=False)


R_BOARD = cards("2c7d9hJsKd")
R_OOP = parse_range("KK,QQ,JJ,99,77,AJs,KQs,QJs,JTs,T9s,98s,65s,A5s")
R_IP = parse_range("AA,KK,QQ,TT,88,AJs,KJs,QJs,JTs,T8s,87s,A4s,AKo")
T_BOARD = cards("2c7d9hJs")
T_OOP = parse_range("KK,99,77,AJs,KQs,QJs,JTs,98s,65s")
T_IP = parse_range("AA,QQ,TT,KJs,QJs,T8s,87s,AKo")


def spot(board, r0, r1, iters, **cfg):
    eq = solve(board, r0, r1, 10.0, 40.0, cfg=exact(**cfg), time_budget=1e9, max_iters=iters)
    return eq, dict(board=tuple(board), r0=r0, r1=r1, pot=10.0, stack=40.0)


class Checked(unittest.TestCase):
    def test_presets_and_bounds(self):
        self.assertEqual(ps.check_profile({"fold": -20, "bluff": 0}), {"fold": -20.0})
        for bad, says in (({}, "numbers"), ({"next_fold": 30}, "no key"), ({"fold": 101}, "between"),
                          ({"bet": "x"}, "number"), ({"fold": 0}, "nothing to exploit"), ({"raise": True}, "number")):
            with self.assertRaises(LockError) as e:
                ps.check_profile(bad)
            self.assertIn(says, str(e.exception))
        self.assertEqual(set(ps.PRESETS), {"station", "nit", "maniac", "overfolder"})


class AgainstABestResponse(unittest.TestCase):
    """The ACCURACY check (docs/ACCURACY.md section 25): with every decision of one player held, the restricted game's
    value for the other is their best response to the held strategy."""

    @classmethod
    def setUpClass(cls):
        cls.river = spot(R_BOARD, R_OOP, R_IP, 2000)
        cls.turn = spot(T_BOARD, T_OOP, T_IP, 400, bets=(0.75,))

    def check(self, eq, asked, player, adj, iters, gap):
        held = ps.solve_profile(eq, asked, player, adj, time_budget=1e9, max_iters=iters)
        c = ps.br_check(eq, held, player, adj)
        # the pins are the strategy the independent best response faces (float32 rounding)
        self.assertLess(c["pins_pct"], 1e-4, c)
        # the re-solve is that best response, to its convergence
        self.assertLess(abs(c["gap_pct"]), gap, c)
        m = held.measure()
        self.assertLess(abs(m["gain_held"][player]), 1e-4 * m["root_pot"])     # the held player can't move
        self.assertGreaterEqual(c["value"], ps.eq_against_profile(eq, held) - 1e-4 * m["root_pot"])
        return held, c

    def test_river_every_preset_either_seat(self):
        eq, asked = self.river
        for player in (0, 1):
            for name, adj in ps.PRESETS.items():
                with self.subTest(player=player, preset=name):
                    self.check(eq, asked, player, adj, 2000, 0.001)

    def test_turn_with_every_river_dealt(self):
        eq, asked = self.turn
        for player in (0, 1):
            for name in ("station", "nit", "maniac"):
                with self.subTest(player=player, preset=name):
                    held, _ = self.check(eq, asked, player, ps.PRESETS[name], 400, 0.01)
                    lines = [x for x in nl.lines(held.root) if x[1] == player]
                    self.assertEqual(held.profile["nodes"], len(lines))    # every decision of theirs held

    def test_a_custom_profile(self):
        eq, asked = self.river
        self.check(eq, asked, 1, {"fold": 35, "bet": -40}, 2000, 0.001)

    def test_the_pin_at_the_root_is_the_rule_on_the_equilibrium(self):
        eq, asked = self.river
        adj = ps.PRESETS["maniac"]
        held = ps.solve_profile(eq, asked, 0, adj, time_budget=1e9, max_iters=200)
        want = TendencyLock(eq.ctx, 0, adj)(eq.root, eq.root.avg_strategy(), np.asarray(eq.r0, float)[None, :])
        got = held.root.avg_strategy()
        live = np.asarray(eq.r0) > 0
        np.testing.assert_allclose(got[0][:, live], want[0][:, live], atol=2e-6)
        self.assertGreater(np.abs(want[0] - eq.root.avg_strategy()[0])[:, live].max(), 0.1)   # (it moved)

    def test_merged_lines_keep_their_own_mixes(self):
        """Two turn lines that reach rivers of one shape share merged subtrees: each line's river node holds the mix
        recorded for it, not its sibling's."""
        eq, asked = self.turn
        held = ps.solve_profile(eq, asked, 1, ps.PRESETS["nit"], time_budget=1e9, max_iters=150)
        pins = held.solver._pins
        checked = 0
        stack = [held.root]
        while stack:
            n = stack.pop()
            if isinstance(n, Decision):
                if n.player == 1 and len(n.boards[0]) == 5:
                    pin = pins[id(n)]
                    s = n.avg_strategy()
                    m = np.broadcast_to(pin.mask[:, None, :], s.shape)
                    np.testing.assert_allclose(s[m], pin.mix[m], atol=2e-6)
                    checked += 1
                stack.extend(n.children)
            elif hasattr(n, "child"):
                stack.append(n.child)
        self.assertGreater(checked, 4)

    def test_cold_and_warm_starts_reach_the_same_exploit(self):
        eq, asked = self.turn
        adj = ps.PRESETS["station"]
        warm = ps.convergence(ps.solve_profile(eq, asked, 0, adj, time_budget=1e9, max_iters=300))
        cold = ps.convergence(ps.solve_profile(eq, asked, 0, adj, time_budget=1e9, max_iters=300, warm=False))
        self.assertAlmostEqual(warm["value"][1], cold["value"][1], delta=1e-3 * warm["root_pot"])


class Shared(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ps.clear_cache()
        cls.adv = advisor(FAST, 0.2)
        cls.adv.should_stop = lambda: False

    def study(self, state, seat, adj="station", **more):
        return sl.answer(self.adv, dict(state, budget=2.0, prior_budget=1.0,
                                        nodelock={"profile": dict(seat=seat, adj=adj, **more)}))


class Study(Shared):
    def test_a_river_node_both_sides_and_three_values(self):
        r = self.study(RIVER, "BTN")
        self.assertNotIn("error", r)
        self.assertEqual((r["study"], r["street"], r["actor"], r["kind"]), ("profile", "river", "BB", "profile re-solve"))
        p = r["profile_solve"]
        self.assertEqual((p["seat"], p["player"], p["exploiter"], p["seats"]), ("BTN", 1, "BB", ["BB", "BTN"]))
        self.assertEqual(p["actions"], ["check", "bet 33%", "bet 75%", "bet 125%", "bet 250%"])
        for side in ("eq", "exploit"):
            self.assertAlmostEqual(sum(p[side]["mix"]), 1.0, places=5)
            self.assertEqual(len(p[side]["ev"]), 5)
        v = p["values"]
        self.assertEqual(v["player"], 0)
        self.assertGreaterEqual(v["exploit"], v["eq_vs_profile"] - 0.01)
        self.assertAlmostEqual(v["exploit"], -v["profiled"]["exploited"], places=3)
        self.assertLess(p["convergence"]["gain_pct"], 0.2)
        self.assertEqual(p["streets_held"], "street")
        self.assertEqual([s["street"] for s in p["streets"]], ["river"])
        self.assertTrue(p["classes"])
        self.assertIn("not an equilibrium", r["label"])

    def test_the_profiled_player_acting_on_screen(self):
        r = self.study(RIVER, "BB", "nit")
        p = r["profile_solve"]
        self.assertTrue(p["actor_profiled"])
        self.assertEqual(p["exploiter"], "BTN")
        # the nit bets less than equilibrium: its weak hands and every hand by a quarter
        self.assertGreater(p["exploit"]["mix"][0], p["eq"]["mix"][0])

    def test_a_turn_held_from_the_flop(self):
        here = self.study(ON_TURN, "BB", streets="street")["profile_solve"]
        hand = self.study(ON_TURN, "BB", streets="hand")["profile_solve"]
        self.assertEqual([s["street"] for s in here["streets"]], ["turn"])
        self.assertEqual([s["street"] for s in hand["streets"]], ["flop", "turn"])
        self.assertEqual(hand["streets_held"], "hand")
        self.assertIn("ranges entering this street", hand["scope"])

    def test_a_flop(self):
        r = self.study(ON_FLOP, "BB", {"fold": 25})
        self.assertNotIn("error", r)
        self.assertEqual(r["profile_solve"]["streets"][0]["street"], "flop")
        self.assertGreater(r["profile_solve"]["pinned"]["nodes"], 10)

    def test_one_street_shares_one_re_solve(self):
        self.study(RIVER, "BTN", "maniac")
        n = len(ps._CACHE)
        self.study(RIVER, "BTN", "maniac")
        self.assertEqual(len(ps._CACHE), n)

    def test_refused_in_words(self):
        for state, seat, adj, kind, says in (
                (dict(HAND, board=""), "BB", "station", "refused", "after the flop"),
                (RIVER, "CO", "station", "refused", "isn't in this heads-up pot"),
                (RIVER, "BTN", {"next_fold": 30}, "invalid", "no key"),
                (RIVER, "BTN", "fish", "invalid", "No preset"),
                (RIVER, "BTN", {"fold": 0}, "invalid", "nothing to exploit")):
            with self.subTest(says=says):
                r = self.study(state, seat, adj)
                self.assertEqual(r.get("lock_error"), kind, r)
                self.assertIn(says, r["error"])

    def test_multiway_and_tournament(self):
        pre = [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "raise", "to": 2.5},
               {"pos": "BTN", "action": "call"}, {"pos": "SB", "action": "fold"}, {"pos": "BB", "action": "call"}]
        r = self.study(dict(HAND, preflop=pre, board="Kd7c2h"), "BB")
        self.assertEqual(r["lock_error"], "refused")
        self.assertIn("heads-up", r["error"])
        st = dict(RIVER, payouts=[50, 30, 20], stacks=dict(UTG=100, HJ=100, CO=100, BTN=100, SB=100, BB=100))
        r = self.study(st, "BTN")
        self.assertEqual(r["lock_error"], "refused", r)
        self.assertIn("cash games", r["error"])
        self.assertNotIn("_solve_cached", self.adv.__dict__)
        self.assertNotIn("_from_library", self.adv.__dict__)


class Practice(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ps.clear_cache()
        cls.adv = advisor(FAST)
        cls.adv.time_budget, cls.adv.prior_budget = 2, 1
        cls.adv.should_stop = lambda: False

    def test_seats_to_players(self):
        self.assertEqual(ps.player_of({"players": 6}, "BB", "BTN"), 0)
        self.assertEqual(ps.player_of({"players": 6}, "BTN", "BB"), 1)
        self.assertEqual(ps.player_of({"players": 2}, "SB", "BB"), 1)      # heads-up the button acts last
        with self.assertRaises(LockError):
            ps.player_of({"players": 6}, "BB", "BB")

    def test_advice_is_the_re_solve_and_the_move_is_its_profile(self):
        st = dict(SPOT, flop=[{"pos": "BB", "action": "check"}])
        r = sl.answer(self.adv, dict(st, nodelock={"profile": {"seat": "BB", "adj": STATION}, "advise": True}))
        self.assertNotIn("error", r)
        self.assertEqual(r["locked"], {"BB": {k: float(v) for k, v in STATION.items()}})
        self.assertEqual(r["profile_solve"]["streets"], ["flop"])
        for a in r["actions"]:
            self.assertIn("gto_freq", a)
            self.assertIn("gto_ev", a)
        self.assertAlmostEqual(sum(a["freq"] for a in r["actions"]), 1.0, delta=0.005)
        self.assertTrue(r["notes"][0].startswith("profile re-solve"))
        # BB's move after BTN bets, read off the very re-solve (the cache) at BB's node
        seen = {}
        orig = A.Advisor._actor_move

        def spy(self_, sol, node, r0, r1, hole, p, street):
            seen.update(sol=sol, node=node, p=p)
            return orig(self_, sol, node, r0, r1, hole, p, street)
        A.Advisor._actor_move = spy
        try:
            n = len(ps._CACHE)
            m = xp.play(self.adv, dict(SPOT, locks={"BB": STATION}, profile_solve=True), "BB", "Qc9c", seed=3)
        finally:
            A.Advisor._actor_move = orig
        self.assertEqual(len(ps._CACHE), n)                      # no new re-solve: the advice's
        self.assertTrue(m["profile"], m)
        self.assertTrue(m["resolved"])
        self.assertEqual(seen["sol"].profile["player"], seen["p"])
        col = int(np.nonzero(seen["sol"].ctx.active == A.COMBO_INDEX[tuple(sorted(A.parse_cards("Qc9c")))])[0][0])
        want = seen["node"].avg_strategy()[0][:, col]
        self.assertEqual([a["freq"] for a in m["actions"]], [round(float(f), 3) for f in want])
        self.assertNotIn("_solve_cached", self.adv.__dict__)
        self.assertIs(A.Advisor._actor_move, orig)

    def test_a_bad_profile_plays_the_equilibrium_and_says_so(self):
        m = xp.play(self.adv, dict(SPOT, locks={"BB": {"fold": 120}}, profile_solve=True), "BB", "Qc9c", seed=3)
        self.assertFalse(m["profile"])
        self.assertIn("between", m["profile_why"])


if __name__ == "__main__":
    unittest.main()
