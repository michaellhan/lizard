"""engine/pf_icm.py and engine/pf_icm_study.py: the preflop game solved in prize equity, and Study's tournament path.

What it checks:
- in chips it is pf_game's game exactly (same tree, same strategies), and a winner-take-all prize model is chips;
- the calibrated game (engine/pf_icm_calib.py, Study's and the stored spots' since 2026-11-17): winner-take-all is chips,
  its one-pass pricing of folded seats is pf_engine's loop, heads-up push/fold, a bust's bounty to the right seat;
- heads-up push/fold matches pf_classes.push_fold, and a bubble's push/fold matches the advisor's equilibrium in prize
  equity where the two models are the same game (no overcalls, folded seats paid nothing);
- it converges: exploitability, in mbb/hand of prize equity a seat, falls with iterations to well under a live solve's
  target on a short-stacked 3-handed bubble;
- the direction of ICM: on a bubble jams and calls tighten against chips, a satellite tightens them more, and a KO
  bounty widens a covering big blind's calls;
- Study's tournament preflop (Advisor.advise with study and preflop_solve): offered unsolved with the model named, run,
  then answered as a node with pf_icm, the tournament block and its notes; a table too big says why.

Run: .venv/bin/python -m unittest scripts/engine/test_pf_icm.py   (about a minute: route it through slot.sh)
"""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import pf_engine as E  # noqa: E402
from engine import pf_icm as I  # noqa: E402
from engine import pf_icm_calib as C  # noqa: E402
from engine import pf_icm_study as IS  # noqa: E402
from engine import pf_model as M  # noqa: E402
from gto import icm  # noqa: E402
from gto import pf_classes as PC  # noqa: E402
from gto import pf_game as G  # noqa: E402
from gto import pf_study as PS  # noqa: E402
from gto.advisor import Advisor  # noqa: E402
from gto.pf_classes import CLASS_OF, CLASSES, N_IN  # noqa: E402
from gto.preflop import SEATS  # noqa: E402

W = N_IN / N_IN.sum()          # a class's share of the 1326 combos


def run(g, iters):
    g.avg_power = 8.0
    for t in range(1, iters + 1):
        g.iterate(t)
    return g.average()


def freq(g, s, line, action):
    """The strategy's frequency per class of `action` at the node reached by `line` (action names from the root)."""
    nd = g.root
    for a in line:
        nd = nd.children[nd.names.index(a)]
    return s[g.dec_of[nd.index], nd.names.index(action)]


def pushfold(pos, stacks, pay=None, bounties=None, iters=1500, **kw):
    model = icm.Model(dict(zip(pos, stacks)), pay, bounties=bounties) if pay else None
    g = I.game(pos, stacks, [0.0] * len(pos), icm_model=model, pushfold=True, **kw)
    return g, run(g, iters)


def share(x):
    return float((W * x).sum())


class Tree(unittest.TestCase):
    def test_no_showdown_over_three_with_unequal_stacks(self):
        # a raise over players all in for less kept them in the pot: 6-max at these stacks once made four-way showdowns
        import random
        rnd = random.Random(1)
        cases = [(6, [25, 12, 40, 18, 30, 22])] + [(n, [rnd.choice([3, 6, 9, 12, 18, 25, 40]) for _ in range(n)])
                                                    for n in (3, 4, 5, 6, 7, 8) for _ in range(4)]
        for n, st in cases:
            with self.subTest(players=n, stacks=st):
                root = I.build(SEATS[n], st, [0.1] * n, max_players=3 if n <= 6 else 2)
                self.assertLessEqual(max(len(nd.active) for nd in G.walk(root) if nd.kind == "show"), 3)

    def test_short_seats_play_their_own_stack(self):
        root = I.build(["SB", "BB"], [5, 30], [0, 0])
        jam = root.children[root.names.index("all-in")]
        self.assertAlmostEqual(jam.line[-1][2], 5.0)       # the short stack's all-in is its stack
        self.assertNotIn("raise", jam.names)               # and the deep one can only call or fold


    def test_seven_or_more_nobody_cold_4bets(self):
        """From 7 players (cold4=False, as pf_engine): once the pot is raised twice, a seat that has put no chips in
        by choice can only fold; the opener and the 3bettor play on. 2 to 6 players keep every option."""
        def walk(root, line):
            nd = root
            for a in line:
                nd = nd.children[nd.names.index(a)]
            return nd
        pos = SEATS[8]
        cold = I.build(pos, [40] * 8, [0.12] * 8, max_players=2, cold4=False)
        full = I.build(pos, [40] * 8, [0.12] * 8, max_players=2)
        self.assertLess(sum(1 for _ in G.walk(cold)), sum(1 for _ in G.walk(full)) / 3)
        after = walk(cold, ["raise", "raise"])                       # UTG opens, the next seat 3bets
        self.assertEqual(after.names, ["fold"])
        opener = walk(cold, ["raise", "raise"] + ["fold"] * 6)
        self.assertIn("call", opener.names)
        self.assertGreater(len(walk(full, ["raise", "raise"]).names), 1)
        self.assertGreater(len(walk(cold, ["fold", "raise", "call"]).names), 1)    # a flat isn't a 3bet: still open
        self.assertTrue(IS.Spec(6, (40.0,) * 6, (0.0,) * 6, "").cold4)
        seven = IS.Spec(7, (40.0,) * 7, (0.0,) * 7, "")
        self.assertFalse(seven.cold4)
        self.assertIn(IS.LIMITS_7UP, seven.label())


class Chips(unittest.TestCase):
    def test_chips_is_pf_game(self):
        for n, st, ante in ((2, 30, 0.0), (3, 40, 0.1)):
            with self.subTest(players=n, stack=st):
                pos = SEATS[n]
                model = PS.flop_model(st)
                g0 = G.Game(G.build(pos, stack=st, sizes=G.Sizes(), max_players=3, ante=ante, sb_limp=False), pos, model, stack=st)
                r1 = I.build(pos, [st] * n, [ante] * n, sizes=G.Sizes(), max_players=3, sb_limp=False, jam_open=0)
                g1 = I.ICMGame(r1, pos, model, I.Chips([st] * n), stack=st)
                self.assertEqual(g0.N, g1.N)
                for t in range(1, 31):
                    g0.iterate(t)
                    g1.iterate(t)
                self.assertLess(np.abs(g0.average() - g1.average()).max(), 1e-9)
                self.assertAlmostEqual(g0.exploitability(), g1.exploitability(), places=9)

    def test_winner_take_all_is_chips(self):
        pos = SEATS[4]
        stacks, antes = [25, 12, 40, 18], [0.125] * 4
        gc = I.game(pos, stacks, antes)
        gw = I.game(pos, stacks, antes, icm_model=icm.Model(dict(zip(pos, stacks)), [100]))
        self.assertLess(np.abs(gc.pay - gw.pay)[gc.f_rows].max(), 1e-9)
        for t in range(1, 16):
            gc.iterate(t)
            gw.iterate(t)
        self.assertLess(np.abs(gc.average() - gw.average()).max(), 1e-8)


class Calibrated(unittest.TestCase):
    """engine/pf_icm_calib.py: pf_icm's tree on pf_engine's game with the calibrated flop values (Study's tournament
    solve and every stored spot since 2026-11-17)."""

    def test_winner_take_all_is_chips(self):
        # equal stacks (no side pots): the same solve
        pos = SEATS[4]
        stacks, antes = [20, 20, 20, 20], [0.125] * 4
        gc = C.game(pos, stacks, antes)
        gw = C.game(pos, stacks, antes, icm_model=icm.Model(dict(zip(pos, stacks)), [100]))
        for t in range(1, 16):
            gc.iterate(t)
            gw.iterate(t)
        self.assertLess(np.abs(gc.average() - gw.average()).max(), 1e-6)

    def test_winner_take_all_side_pots_are_chips_split_evenly(self):
        # uneven stacks: every outcome's utility is its chips, and a three-way all-in's side pot that the main pot's
        # winner can't take goes half to each of the two who can (chip EV splits it by their heads-up equity per class)
        pos = SEATS[4]
        stacks, antes = [25, 12, 40, 18], [0.125] * 4
        gc = C.game(pos, stacks, antes)
        gw = C.game(pos, stacks, antes, icm_model=icm.Model(dict(zip(pos, stacks)), [100]))
        self.assertLess(np.abs(gc.pay - gw.pay).max(), 1e-9)
        for x, y in zip(gc.hu, gw.hu):
            for j in range(5, 9):
                self.assertLess(np.abs(x[j] - y[j]).max(), 1e-9)
        rows, act, _, Uc, side, sx, sy = gc.three
        Uw = gw.three[3]
        self.assertTrue((side > 1e-12).any())
        for i in range(len(rows)):
            for k in range(3):
                extra = Uw[i, k] - Uc[i, k]                      # the side pot, which chip EV adds by equity
                self.assertAlmostEqual(extra.sum(), side[i], places=9)
                if side[i] > 1e-12:
                    elig = {sx[i], sy[i]}
                    if k in elig:
                        self.assertAlmostEqual(extra[k], side[i], places=9)
                    else:
                        for j in elig:
                            self.assertAlmostEqual(extra[j], side[i] / 2, places=9)

    def test_folded_seats_priced_in_one_pass_as_pf_engines_loop(self):
        # pf_engine.Game prices a heads-up pot's folded seats in a Python loop; pf_icm_calib.Game in one pass: the same
        # numbers (a push/fold tree, which pf_engine's three-action arrays hold)
        pos, stacks, pay = ["BTN", "SB", "BB"], [10.0, 14.0, 6.0], [50, 30, 20]
        model = icm.Model(dict(zip(pos, stacks)), pay)
        root = I.build(pos, stacks, [0.1] * 3, max_players=3, cold4=True, pushfold=True)
        p = M.load_params() or M.Params()
        at = lambda d: M.flop_model(max(10.0, min(250.0, d)), p)  # noqa: E731
        g0 = E.Game(root, pos, at, stacks, payoff=C.PrizePayoff(model, pos), ante=0.1)
        g1 = C.Game(I.build(pos, stacks, [0.1] * 3, max_players=3, cold4=True, pushfold=True), pos, at, stacks,
                    payoff=C.PrizePayoff(model, pos), ante=0.1)
        for t in range(1, 21):
            g0.iterate(t)
            g1.iterate(t)
        self.assertLess(np.abs(g0.average() - g1.average()).max(), 1e-9)

    def test_heads_up_matches_push_fold(self):
        for st in (5, 10):
            with self.subTest(stack=st):
                g = C.game(["SB", "BB"], [st, st], [0.0, 0.0], pushfold=True)
                s = run(g, 2500)
                jam = freq(g, s, [], "all-in")
                pf = PC.push_fold(np.ones(1326), np.ones(1326), st, 0.5, 1.0, 1.5, 1, iters=2500)
                pfc = np.bincount(CLASS_OF, weights=pf, minlength=169) / N_IN
                self.assertAlmostEqual(share(jam), share(pfc), delta=0.005)

    def test_a_bust_pays_its_bounty_to_the_seat_that_won_its_chips(self):
        pos, stacks = ["BTN", "SB", "BB"], [10.0, 20.0, 30.0]
        model = icm.Model(dict(zip(pos, stacks)), [50, 30, 20], bounties=icm.Bounties("ko", {p: 5.0 for p in pos}))
        pp = C.PrizePayoff(model, pos)
        put = np.array([10.0, 0.5, 10.0])
        self.assertEqual(pp.kos(put, np.array([-10.0, -0.5, 10.5])), [("BTN", {"BB": 1.0})])
        self.assertEqual(pp.kos(put, np.array([10.5, -0.5, -10.0])), [])       # BB lost 10 of its 30: no bust
        v = pp.values(put[None, :], np.array([[0.0, 0.0, 20.5]]), [[(0, 2)]])
        w = pp.values(put[None, :], np.array([[0.0, 0.0, 20.5]]), [[]])
        self.assertGreater(v[0, 2], w[0, 2])                                     # the bounty, in chip equivalents

    def test_study_solves_on_it(self):
        spec, why = IS.spec_of(Advisor(), {"players": 3, "bb": 1.0, "stack": 15, "payouts": [50, 30, 20]})
        self.assertIsNone(why)
        self.assertIsInstance(spec.game(), C.Game)
        self.assertIn("calibrated", IS.MODEL_NAME)


class PushFold(unittest.TestCase):
    def test_heads_up_matches_push_fold(self):
        for st in (5, 10):
            with self.subTest(stack=st):
                g, s = pushfold(["SB", "BB"], [st, st], iters=2500)
                jam = freq(g, s, [], "all-in")
                pf = PC.push_fold(np.ones(1326), np.ones(1326), st, 0.5, 1.0, 1.5, 1, iters=2500)
                pfc = np.bincount(CLASS_OF, weights=pf, minlength=169) / N_IN
                # one class at the jammer's indifference may be mixed differently by the two methods, up to its weight
                # (an offsuit class is 0.9% of hands): on the exact equity table at 5bb, 96o 16% here and 75% in
                # push_fold, both converged (the same at 10,000 iterations), 0.54 points of the range
                self.assertAlmostEqual(share(jam), share(pfc), delta=0.01)
                self.assertLess(share(np.abs(jam - pfc)), 0.01)

    def test_bubble_matches_the_advisors_equilibrium_in_the_same_game(self):
        # the advisor's push/fold in prize equity has one caller take the pot on and pays a folded seat nothing: the
        # same game here is no overcalls and no bystander term (I.ICMGame.bystanders)
        pos, stacks, pay = ["BTN", "SB", "BB"], [10, 10, 10], [50, 30, 20]
        g, s = pushfold(pos, stacks, pay, allin_players=2, max_players=2, bystanders=False, iters=2000)
        jam = freq(g, s, [], "all-in")
        r = Advisor().advise({"players": 3, "bb": 1.0, "stack": 10, "payouts": pay, "street": "preflop", "board": "",
                              "study": True, "preflop": []})
        j = r["grid"]["actions"].index("all-in")
        adv = np.array([r["grid"]["cells"][c]["f"][j] if c in r["grid"]["cells"] else 0.0 for c in CLASSES])
        self.assertAlmostEqual(share(jam), share(adv), delta=0.01)

    def test_folded_seats_gain_when_others_bust(self):
        # the full model pays a folded seat its range-average prize equity, which rises when the two left may bust each
        # other: so the button folds more than the advisor's model, which values folding at nothing
        pos, stacks, pay = ["BTN", "SB", "BB"], [10, 10, 10], [50, 30, 20]
        _, s0 = pushfold(pos, stacks, pay, allin_players=2, max_players=2, bystanders=False, iters=1500)
        g1, s1 = pushfold(pos, stacks, pay, iters=1500)
        self.assertLess(share(freq(g1, s1, [], "all-in")), share(freq(g1, s0, [], "all-in")) - 0.05)


class Convergence(unittest.TestCase):
    def test_exploitability_in_prize_equity_falls(self):
        pos, stacks = ["BTN", "SB", "BB"], [15, 9, 22]
        g = I.game(pos, stacks, [0.1] * 3, icm_model=icm.Model(dict(zip(pos, stacks)), [50, 30, 20]))
        g.avg_power = PS.AVG_POWER
        for t in range(1, 101):
            g.iterate(t)
        early = sum(g.exploitability(per_seat=True))
        for t in range(101, 801):
            g.iterate(t)
        late = g.exploitability(per_seat=True)
        self.assertLess(sum(late), early / 3)
        self.assertLess(1000 * max(late), PS.TARGET_MBB, [round(1000 * x, 3) for x in late])


class Direction(unittest.TestCase):
    POS, ST = ["BTN", "SB", "BB"], [10, 10, 10]

    def jams_and_calls(self, pay=None, **kw):
        g, s = pushfold(self.POS, self.ST, pay, **kw)
        return share(freq(g, s, [], "all-in")), share(freq(g, s, ["fold", "all-in"], "call"))

    def test_bubble_tightens_and_a_satellite_more(self):
        chips = self.jams_and_calls()
        bubble = self.jams_and_calls([50, 30, 20])
        sat = self.jams_and_calls([50, 50])
        self.assertLess(bubble[0], chips[0])
        self.assertLess(bubble[1], chips[1] - 0.05)
        self.assertLess(sat[1], bubble[1])
        self.assertLess(sat[0], bubble[0])
        # (winner takes all is chip EV, to the last bits of a float: the two sum in different orders)
        for a, b in zip(self.jams_and_calls([100]), chips):
            self.assertAlmostEqual(a, b, places=12)

    def test_a_ko_bounty_widens_a_covering_call(self):
        pos, stacks, pay = ["BTN", "SB", "BB"], [20, 8, 20], [60, 40]
        plain = pushfold(pos, stacks, pay)
        ko = pushfold(pos, stacks, pay, bounties=icm.Bounties("ko", {p: 20.0 for p in pos}))
        calls = [share(freq(g, s, ["fold", "all-in"], "call")) for g, s in (plain, ko)]
        self.assertGreater(calls[1], calls[0] + 0.02, calls)


def ask(st, pfs=True):
    base = {"bb": 1.0, "street": "preflop", "board": "", "hole": "AhKd", "preflop": [], "study": True, "preflop_solve": pfs}
    return Advisor().advise({**base, **st})


class Study(unittest.TestCase):
    def test_offered_run_and_answered(self):
        IS._HELD.clear()
        st = {"players": 3, "stack": 12, "stacks": {"BTN": 12, "SB": 7, "BB": 15}, "payouts": [50, 30, 20], "hero": "BTN"}
        a = ask(st)
        self.assertEqual(a.get("study"), "pf_unsolved", a)
        self.assertEqual(a["model"], IS.MODEL_NAME)
        p = ask(st, {"run": 6})
        self.assertEqual(p.get("study"), "pf_progress", p)
        n = ask(st)
        self.assertEqual(n.get("study"), "node", n)
        self.assertTrue(n["pf_icm"])
        self.assertEqual(n["solver"]["model"], IS.MODEL_NAME)
        self.assertIn("tournament", n)
        self.assertTrue(n["notes"][0].startswith("tournament: ICM"), n["notes"])
        self.assertTrue(any(x.startswith(IS.MODEL_NAME) for x in n["notes"]))
        self.assertAlmostEqual(sum(x["freq"] for x in n["actions"]), 1.0, places=2)
        # the line goes on: SB facing BTN's jam
        f = ask({**st, "hero": "SB", "preflop": [{"pos": "BTN", "action": "all-in", "to": 12}]})
        self.assertEqual(f.get("study"), "node", f)
        self.assertEqual(f["actor"], "SB")
        self.assertLessEqual(f["to_call_bb"], 7.0)

    def test_cash_is_not_taken(self):
        a = ask({"players": 6, "stack": 90})
        self.assertNotIn("pf_icm", a)

    def test_too_big_says_why(self):
        from unittest import mock
        nine = {"players": 9, "stack": 200, "payouts": [50, 30, 20]}
        # (since 2026-11-13 the 7-9 handed tree fits every table to 250bb under MAX_WORK: 9 at 200bb is 5,593 nodes)
        self.assertEqual(ask(nine).get("study"), "pf_unsolved")
        with mock.patch.object(IS, "MAX_WORK", 20_000):
            a = ask(nine)
            self.assertEqual(a.get("study"), "pf_none", a)
            self.assertIn("too big", a["reason"])
        a = ask({"players": 3, "stack": 400, "payouts": [50, 30, 20]})
        self.assertEqual(a.get("study"), "pf_none", a)
        self.assertTrue(a["reason"])


if __name__ == "__main__":
    unittest.main()
