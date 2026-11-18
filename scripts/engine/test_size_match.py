"""A bet of the tree's own amount is read as the tree's size (engine/size_match.py).

The heads-up limped pot is 2bb; the library's 33% flop bet there is 1bb (gto/solver.py rounds to half a big blind, never
under 1bb), which reads back as 50% of the pot. Advisor._cfg_with_real_sizes swapped 0.5 in for 0.33 (more than 15% off),
so the line left the stored tree and every later decision was solved live (docs/QA.md, issue E: 2max-100bb hand 3).

Run: .venv/bin/python -m unittest scripts/engine/test_size_match.py   (about 10 s; the library tests skip without
library-build/lizard-library, or QA_LIBRARY pointing at a library)
"""
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

import engine.size_match as SM  # noqa: E402
import gto.advisor as A  # noqa: E402
from gto.advisor import Advisor, StreetState  # noqa: E402
from gto.solver import Config  # noqa: E402

# (the checkout's library-build, or the main checkout's from a worktree under .claude/worktrees)
LIB = os.environ.get("QA_LIBRARY") or next(
    (str(p) for p in (ROOT / "library-build" / "lizard-library", ROOT.parents[2] / "library-build" / "lizard-library")
     if (p / "index.json").is_file()), str(ROOT / "library-build" / "lizard-library"))


def advisor() -> Advisor:
    """The worker's flop and raise sizes (scripts/qa/advserver.py, the library's tree)."""
    return Advisor(Config(bet_sizes={"flop": [0.33, 0.75], "turn": [0.33, 0.75, 1.25], "river": [0.33, 0.75, 1.25]},
                          raise_sizes={"flop": [0.5], "turn": [0.75], "river": [0.75]}))


def flop(pot, *actions) -> StreetState:
    return StreetState(name="flop", order=["BB", "SB"], players_start=["BB", "SB"], pot_start=pot,
                       inv_start={"BB": pot / 2, "SB": pot / 2}, actions=list(actions))


def bet(pos, to):
    return {"pos": pos, "action": "bet", "to": to}


class TheTreesOwnBet(unittest.TestCase):
    def setUp(self):
        self.adv = advisor()

    def sizes(self, st):
        cfg = self.adv._cfg_with_real_sizes(st, "BB", "SB", 99.0)
        return cfg.bet_sizes["flop"], cfg.raise_sizes["flop"], cfg.keep_sizes

    def test_the_trees_bet_amounts(self):
        self.assertEqual(SM.tree_bet(0.33, 2.0), 1.0)    # 0.66, lifted to the 1bb minimum
        self.assertEqual(SM.tree_bet(0.75, 2.0), 1.5)
        self.assertEqual(SM.tree_bet(0.33, 2.5), 1.0)    # 0.825, to the half big blind
        self.assertEqual(SM.tree_bet(0.33, 6.0), 2.0)

    def test_a_1bb_bet_into_the_limped_pot_is_the_33_percent_size(self):
        bets, raises, keep = self.sizes(flop(2.0, {"pos": "BB", "action": "check"}, bet("SB", 1)))
        self.assertEqual(bets, [0.33, 0.75])
        self.assertEqual(keep["bet"], [0.33])
        self.assertEqual(raises, [0.5])

    def test_the_big_blinds_own_1bb_lead_is_too(self):
        bets, _, keep = self.sizes(flop(2.0, bet("BB", 1)))
        self.assertEqual(bets, [0.33, 0.75])
        self.assertEqual(keep["bet"], [0.33])

    def test_the_raise_over_it_reads_the_real_bet(self):
        # 1bb faced, raise to 3: (3 - 1) / (2 + 1 + 1) = 50% of the pot after the call, the tree's raise
        bets, raises, keep = self.sizes(flop(2.0, {"pos": "BB", "action": "check"}, bet("SB", 1),
                                             {"pos": "BB", "action": "raise", "to": 3}))
        self.assertEqual(bets, [0.33, 0.75])
        self.assertEqual(raises, [0.5])
        self.assertEqual(keep, {"bet": [0.33], "raise": [0.5], "aggr": 2})

    def test_the_half_big_blind_rounding_is_the_trees_size(self):
        # 33% of 2.5bb is 0.825, 1bb in the tree: 40% of the pot, 21% off 33%
        bets, _, keep = self.sizes(flop(2.5, bet("BB", 1)))
        self.assertEqual(bets, [0.33, 0.75])
        self.assertEqual(keep["bet"], [0.33])

    def test_a_bet_off_the_trees_amounts_is_still_swapped_in(self):
        bets, _, keep = self.sizes(flop(2.0, bet("BB", 1.2)))     # 60%: no size of the tree's bets 1.2bb
        self.assertEqual(bets, [0.33, 0.6])
        self.assertEqual(keep["bet"], [0.6])
        bets, _, _ = self.sizes(flop(10.0, bet("BB", 5)))          # 50% of 10bb: 5bb is no size's amount
        self.assertEqual(bets, [0.5, 0.75])

    def test_a_shove_is_read_as_before(self):
        bets, _, _ = self.sizes(flop(2.0, bet("BB", 99)))
        self.assertEqual(bets[0], 0.33)
        self.assertGreater(bets[1], 40)

    def test_swap_nearest_outside_a_street_read_is_upstreams(self):
        sizes = [0.33, 0.75]
        A._swap_nearest(sizes, 0.5)
        self.assertEqual(sizes, [0.5, 0.75])

    def test_the_walk_takes_the_trees_bet_of_that_amount(self):
        # 33% and 66% into 2bb are 1bb and 1.5bb; a 1bb bet reads back as 50%, nearer 66% than 33% by share, so
        # match_action alone walked it down the 1.5bb bet while the street's read kept 0.33 for it
        from types import SimpleNamespace as N
        node = N(names=["check", "bet 33%", "bet 66%"], children=[N(bets=[0.0, 0.0]), N(bets=[0.0, 1.0]), N(bets=[0.0, 1.5])])
        name = A.Advisor._tree_action_name
        self.assertEqual(name(node, bet("SB", 1), 1, [0.0, 0.0], 2.0), "bet 33%")
        self.assertEqual(name(node, bet("SB", 1.5), 1, [0.0, 0.0], 2.0), "bet 66%")
        self.assertEqual(name(node, bet("SB", 1.2), 1, [0.0, 0.0], 2.0), "bet 60%")    # no tree bet of 1.2bb: upstream's name
        # two tree bets of the same amount: the nearer by share
        two = N(names=["bet 20%", "bet 33%"], children=[N(bets=[0.0, 1.0]), N(bets=[0.0, 1.0])])
        self.assertEqual(name(two, bet("SB", 1), 1, [0.0, 0.0], 2.0), "bet 33%")
        self.assertEqual(name(node, {"pos": "SB", "action": "raise", "to": 3}, 1, [0.0, 1.0], 2.0), "raise to 3")

    def test_custom_sizes_answer_the_1bb_bet_as_the_1bb_bet(self):
        # Practice's "Your own bet sizes" 33 and 66 in the heads-up limped pot: facing 1bb, call 1 and the raise over 1bb
        # (it was call 1.5 and raise to 4, the 1.5bb bet's, with the note "mapped 'bet 50%' to tree action 'bet 66%'")
        adv = Advisor(Config(bet_sizes={"flop": [0.33, 0.66], "turn": [0.33, 0.75], "river": [0.33, 0.75]},
                             raise_sizes={"flop": [0.5], "turn": [0.75], "river": [0.75]}))
        r = adv.advise(dict(players=2, stack=100, hero="BB", hole="4s8c", board="Kd7h2c", turn=[], river=[],
                            flop=[{"pos": "BB", "action": "check"}, bet("SB", 1)],
                            preflop=[{"pos": "SB", "action": "call"}, {"pos": "BB", "action": "check"}],
                            speed="fast", budget=1.0, prior_budget=0.3, quick=True))
        self.assertFalse([n for n in r["notes"] if "tree action" in n], r["notes"])
        self.assertEqual([(a["action"], a.get("amount_bb")) for a in r["actions"]], [("fold", None), ("call", 1.0), ("raise to 3", 3.0)])

    def test_installed_once(self):
        f = A.Advisor._cfg_with_real_sizes
        SM.install()
        self.assertIs(A.Advisor._cfg_with_real_sizes, f)
        self.assertTrue(getattr(f, "_lizard_size_match", False))


@unittest.skipUnless(os.path.isfile(os.path.join(LIB, "index.json")), f"no flop library at {LIB}")
class TheLimpedLibrarySpot(unittest.TestCase):
    """lp_sb_bb_2max (SB limps, BB checks; 208 flops, 5c3sAh and 3c2h2d among them), asked as the worker asks it
    (scripts/qa/advserver.py, which imports engine.size_match where the worker does)."""

    @classmethod
    def setUpClass(cls):
        # imported afresh with the library: advserver reads QA_LIBRARY and QA_NOLIB at import, and test_qa_advserver.py
        # imports it without the library
        sys.path.insert(0, str(ROOT / "scripts" / "qa"))
        sys.modules.pop("advserver", None)
        was = {k: os.environ.get(k) for k in ("QA_LIBRARY", "QA_NOLIB")}
        os.environ["QA_LIBRARY"] = LIB
        os.environ.pop("QA_NOLIB", None)
        try:
            import advserver
        finally:
            for k, v in was.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        sys.modules.pop("advserver", None)
        cls.answer = staticmethod(advserver.answer)

    def ask(self, hero, hole, board, flop_):
        st = dict(players=2, stack=100, hero=hero, hole=hole, board=board, turn=[], river=[], flop=flop_,
                  preflop=[{"pos": "SB", "action": "call"}, {"pos": "BB", "action": "check"}],
                  speed="fast", budget=1.5, prior_budget=0.3, quick=True)
        return json.loads(self.answer(st, None))

    def test_the_big_blind_facing_the_1bb_bet_reads_the_library(self):
        r = self.ask("BB", "4s8c", "5c3sAh", [{"pos": "BB", "action": "check"}, bet("SB", 1)])
        self.assertTrue(r.get("precomputed"), r["notes"])
        self.assertEqual(r["precomputed"]["spot"], "lp_sb_bb_2max")
        self.assertFalse([n for n in r["notes"] if "to tree action" in n])
        self.assertEqual([a["action"] for a in r["actions"]], ["fold", "call", "raise to 3"])

    def test_and_after_the_raise_over_it(self):
        r = self.ask("SB", "4h6d", "5c3sAh", [{"pos": "BB", "action": "check"}, bet("SB", 1),
                                              {"pos": "BB", "action": "raise", "to": 3}])
        self.assertTrue(r.get("precomputed"), r["notes"])

    def test_the_small_blind_facing_the_big_blinds_1bb_lead_reads_it(self):
        # (on 5c3sAh the big blind leads 5% of its range, a rare line solved again from there; on 3c2h2d it doesn't)
        r = self.ask("SB", "4h6d", "3c2h2d", [bet("BB", 1)])
        self.assertTrue(r.get("precomputed"), r["notes"])
        r = self.ask("SB", "4h6d", "5c3sAh", [bet("BB", 1)])
        self.assertEqual([o["action"] for o in r.get("off_solution") or []], ["bet 33%"])


if __name__ == "__main__":
    unittest.main()
