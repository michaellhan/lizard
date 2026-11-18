"""Quick answers in 3-way pots (engine/mw_quick.py): the street advised on is narrowed through a short solve behind a
bet, a Quick request's solves are kept apart from Fast's, a repeated request narrows as the first did, a rare earlier
heads-up line is solved again, and a Quick 3-way flop answer says its small game is approximate.

The narrowing tests stub the solves (they record what was asked and stop), so they run in about a second; the two
real solves below are capped at mw_max_iters iterations, so their answers don't depend on machine load (a few seconds).

Run: .venv/bin/python -m unittest scripts/engine/test_mw_quick.py
"""
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import gto.advisor as A  # noqa: E402
from gto import multiway_solver as MW  # noqa: E402
from engine import mw_quick as MQ  # noqa: E402
from test_mw_narrowing import BOARD, FLOP, PRE, worker_fast  # noqa: E402

QUICK = dict(players=6, stack=100, hero="BTN", hole="Kd7d", board=BOARD, preflop=PRE, flop=FLOP, budget=1.5,
             prior_budget=0.3, quick=True)
FAST = dict(players=6, stack=100, hero="BTN", hole="Kd7d", board=BOARD, preflop=PRE, flop=FLOP, budget=8,
            prior_budget=3)


class Stop(Exception):
    pass


def stubbed():
    """worker_fast() whose street solves only record their budget and game (and narrow nothing: the rules do), and
    whose node solve stores its line as upstream's does, then stops (the catch-all answers by the rules)."""
    a = worker_fast()
    a.calls, a.lines = [], []

    def street_solve(board, ranges, st, stk, acts=(), budget=None):
        a.calls.append({"street": st.name, "budget": budget, "buckets": a.mw_street_config[st.name].get("buckets"),
                        "quick": a._quick})
        return None

    def node_solve(hero, hole, board, ranges, remaining, cur, stk, t0, notes, line=None, positions=None):
        a.lines.append(line)
        a._mw_lines[line] = (object(), list(remaining), 0.0)
        raise Stop()

    a._mw_street_solve = street_solve
    a._multiway_solve = node_solve
    return a


class Keys(unittest.TestCase):
    def test_a_quick_requests_lines_are_its_own(self):
        args = ((1, 2, 3), "BTN", (5, 9), {"BTN": 97.5}, {"flop": FLOP}, "flop", 2)
        plain = A._mw_line(*args)
        tok = MQ._QUICK.set(True)
        try:
            self.assertEqual(A._mw_line(*args), plain + ("quick",))
        finally:
            MQ._QUICK.reset(tok)
        self.assertEqual(A._mw_line(*args), plain)


class Narrowing(unittest.TestCase):
    def test_a_quick_answer_narrows_behind_a_bet_in_the_quick_game(self):
        a = stubbed()
        settled, checks = A.MW_SETTLED, A.MW_CHECKS
        a.street_stop = []
        solve = a._mw_street_solve
        a._mw_street_solve = lambda *args, **kw: a.street_stop.append((A.MW_SETTLED, A.MW_CHECKS)) or solve(*args, **kw)
        a.advise(dict(QUICK))
        # (it stops once followed fully: at 0.5% of the pot on the flop, checked more often; put back after)
        self.assertEqual(a.street_stop, [(A.PRIOR_TRUST["flop"][0], MQ.QUICK_CHECKS)])
        self.assertEqual((A.MW_SETTLED, A.MW_CHECKS), (settled, checks))
        self.assertEqual(len(a.calls), 1, a.calls)
        c = a.calls[0]
        self.assertEqual(c["street"], "flop")
        self.assertAlmostEqual(c["budget"], max(0.3, MQ.QUICK_NARROW["flop"]))
        self.assertEqual(c["buckets"], A.MW_QUICK_FLOP["buckets"])
        self.assertFalse(c["quick"])     # (upstream's walk skips the solve at Quick: unset for it, then put back)
        self.assertEqual(a.mw_street_config["flop"], A.MW_FAST_STREETS["flop"])
        self.assertEqual(a.lines[0][-1], "quick")

    def test_fast_after_quick_at_the_same_node_still_narrows(self):
        a = stubbed()
        a.advise(dict(QUICK))
        a.advise(dict(FAST))
        self.assertEqual(len(a.calls), 2, a.calls)
        self.assertEqual(a.calls[1]["buckets"], A.MW_FAST_STREETS["flop"]["buckets"])
        self.assertAlmostEqual(a.calls[1]["budget"], max(3, A.MW_CURRENT_NARROW * 8))
        self.assertEqual(a.lines[0], a.lines[1] + ("quick",))

    def test_a_repeated_request_narrows_as_the_first_did(self):
        a = stubbed()
        a.advise(dict(FAST))
        a.advise(dict(FAST))
        self.assertEqual(len(a.calls), 2, a.calls)
        # (the node's own line, hidden from the walk, is kept for the opponents' moves and later streets)
        self.assertIn(a.lines[0], a._mw_lines)

    def test_no_budget_keeps_the_rules(self):
        saved = MQ.QUICK_NARROW
        MQ.QUICK_NARROW = {}
        try:
            a = stubbed()
            a.advise(dict(QUICK))
        finally:
            MQ.QUICK_NARROW = saved
        self.assertEqual(a.calls, [])


class Rare(unittest.TestCase):
    def test_a_quick_answer_solves_a_rare_earlier_line_again_on_its_own_budget(self):
        a = worker_fast()
        a._quick, a.prior_budget = True, 0.3
        seen = []
        a._solve_cached = lambda board, r0, r1, pot, eff, budget, **kw: seen.append(budget) or "solve"
        a._expl = lambda sol: 0.1
        st = types.SimpleNamespace(pot_start=5.5, name="flop")
        resolve = a._rare_resolver((1, 2, 3), st, 97.5, None)
        self.assertIsNotNone(resolve)
        self.assertEqual(resolve(None, None, (0.0, 1.81), 1, 0), ("solve", 1.0))
        self.assertEqual(seen, [MQ.QUICK_RARE])
        self.assertEqual((a.prior_budget, a._quick), (0.3, True))

    def test_a_re_solve_short_of_settled_is_dropped(self):
        """A re-solve its 0.5 s left unsettled (trust under 1: the play after the line partly the rules') isn't taken,
        so off_solution doesn't say "resolved" and the line stays the rules', as before."""
        a = worker_fast()
        a._quick, a.prior_budget = True, 0.3
        a._solve_cached = lambda board, r0, r1, pot, eff, budget, **kw: "solve"
        a._expl = lambda sol: 3.0     # (the flop's trust_of: 0.44)
        resolve = a._rare_resolver((1, 2, 3), types.SimpleNamespace(pot_start=5.5, name="flop"), 97.5, None)
        self.assertIsNone(resolve(None, None, (0.0, 1.81), 1, 0))
        self.assertEqual(a.prior_budget, 0.3)

    def test_off_it_keeps_the_rules(self):
        saved, MQ.QUICK_RARE = MQ.QUICK_RARE, 0.0
        try:
            a = worker_fast()
            a._quick = True
            self.assertIsNone(a._rare_resolver((1, 2, 3), types.SimpleNamespace(pot_start=5.5, name="flop"), 97.5,
                                               None))
        finally:
            MQ.QUICK_RARE = saved


class BuildDeadline(unittest.TestCase):
    def test_a_narrowing_too_slow_to_build_leaves_the_rules(self):
        """The narrowing solve's tables not built by QUICK_BUILD of its seconds: dropped (the rules narrow, as before),
        a note says so, and gto.multiway_solver is left as it was."""
        real = MW.MultiwaySolver
        saved = MQ.QUICK_BUILD
        MQ.QUICK_BUILD = 1e-9
        try:
            a = worker_fast()
            seen = []

            def node_solve(hero, hole, board, ranges, remaining, cur, stk, t0, notes, line=None, positions=None):
                seen.extend(notes)
                raise Stop()
            a._multiway_solve = node_solve
            a.advise(dict(QUICK))
        finally:
            MQ.QUICK_BUILD = saved
        self.assertIs(MW.MultiwaySolver, real)
        self.assertIsNone(a._mwq_deadline)
        self.assertTrue(any(n.startswith("flop: a quick answer's narrowing solve of this street wasn't built in")
                            for n in seen), seen)
        self.assertTrue(any(n.startswith("flop: multiway, ranges narrowed by simple betting rules") for n in seen), seen)

    def test_only_a_quick_narrowing_gets_the_deadline(self):
        """The street solve's MultiwaySolver gets `deadline` while a quick answer narrows (_mwq_deadline), not
        otherwise (Fast's narrowing, and upstream's other solves)."""
        real, got = MW.MultiwaySolver, []

        def record(*args, **kwargs):
            got.append(kwargs.get("deadline"))
            raise Stop()
        st = types.SimpleNamespace(name="flop", order=["BB", "UTG", "BTN"], players_start=["BB", "UTG", "BTN"],
                                   pot_start=8.0, inv_start={"BB": 2.5, "UTG": 2.5, "BTN": 2.5})
        stk = {"BB": 100.0, "UTG": 100.0, "BTN": 100.0}
        a = worker_fast()
        MW.MultiwaySolver = record
        try:
            for dl in (None, 123.0):
                a._mwq_deadline = dl
                with self.assertRaises(Stop):
                    a._mw_street_solve(A.parse_cards(BOARD), {}, st, stk, acts=FLOP, budget=1.0)
                self.assertIs(MW.MultiwaySolver, record)
        finally:
            MW.MultiwaySolver = real
        self.assertEqual(got, [None, 123.0])


class Solved(unittest.TestCase):
    def test_a_quick_turn_behind_a_bet_is_narrowed_through_a_solve(self):
        """UTG, BTN and BB check the flop; BB checks the turn and UTG bets 5.5: the turn's ranges come from a solve
        of it from its start in the quick game (capped at 100 iterations, so its budget is raised to reach them)."""
        saved = MQ.QUICK_NARROW
        MQ.QUICK_NARROW = {**saved, "turn": 60.0}
        try:
            a = worker_fast()
            r = a.advise(dict(players=6, stack=100, hero="BTN", hole="Kh7h", board=BOARD + "2h", preflop=PRE,
                              flop=[{"pos": "BB", "action": "check"}, {"pos": "UTG", "action": "check"},
                                    {"pos": "BTN", "action": "check"}],
                              turn=[{"pos": "BB", "action": "check"}, {"pos": "UTG", "action": "bet", "to": 5.5}],
                              budget=1.5, prior_budget=0.3, quick=True))
        finally:
            MQ.QUICK_NARROW = saved
        notes = r.get("notes", [])
        self.assertTrue(any(n.startswith("turn: 3-way, ranges narrowed through a solve from the street's start (")
                            for n in notes), notes)
        self.assertTrue(any(n.startswith("turn: a quick answer's narrowing solve of this street ran") for n in notes),
                        notes)
        self.assertFalse(any(n.startswith("flop, turn: multiway") or n.startswith("turn: multiway") for n in notes),
                         notes)

    def test_a_quick_3way_flop_answer_is_marked_approximate(self):
        """BTN opens, SB and BB call; 9h8d3c, SB first: solved in the quick game, which says so."""
        a = worker_fast()
        pre = [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "fold"},
               {"pos": "BTN", "action": "raise", "to": 2.5}, {"pos": "SB", "action": "call"},
               {"pos": "BB", "action": "call"}]
        q = a.advise(dict(players=6, stack=100, hero="SB", hole="Tc9c", board="9h8d3c", preflop=pre, budget=1.5,
                          prior_budget=0.3, quick=True))
        self.assertTrue(q.get("solved"), q.get("notes"))
        self.assertIs(q["solver"].get("approximate"), True)
        # (its own reason: no target_pct, so not "short of its target")
        self.assertEqual(q["solver"].get("approximate_reason"), MQ.QUICK_FLOP_REASON)
        self.assertNotIn("target_pct", q["solver"])
        self.assertIn(MQ.QUICK_FLOP_NOTE, q["notes"])


if __name__ == "__main__":
    unittest.main()
