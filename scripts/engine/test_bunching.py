"""engine/bunching.py: the folders' card moments against brute force over every deal of small fold ranges (exact for
one and two folders, sampled within its stated error for three), the next card's odds the same way, the fold ranges a
line gives (charts and the preflop solve), and the Advisor's wrap through real solves at the worker's Fast config.

Small budgets: what's tested is which ranges a solve gets and what the answer says, not how far it converges.

Run: .venv/bin/python -m unittest scripts/engine/test_bunching.py   (pytest runs it too)
"""
import itertools
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "engine"))

import engine.tree_depth  # noqa: E402,F401  (as the worker loads it: bunching wraps tree_depth's wrap)
from engine import bunching as B  # noqa: E402
from gto import advisor as A  # noqa: E402
from gto import preflop as pf  # noqa: E402
from gto.cards import ALL_COMBOS, cards  # noqa: E402

N = B.N


def sparse(rng, k, avoid=()):
    """A fold range of k random combos with random weights, none holding a card of `avoid`."""
    live = np.nonzero(B.live_mask(avoid))[0]
    w = np.zeros(N)
    w[rng.choice(live, size=k, replace=False)] = rng.uniform(0.2, 1.0, size=k)
    return w


def brute(folds, dead=()):
    """Every deal of the folders' hands (no card twice, none dead), weighted by their folds: (p1, p2, F, next card)."""
    dead = set(dead)
    supports = [[i for i in np.nonzero(w)[0] if not (set(ALL_COMBOS[i]) & dead)] for w in folds]
    p1, p2, z = np.zeros(52), np.zeros((52, 52)), 0.0
    for deal in itertools.product(*supports):
        held = [c for i in deal for c in ALL_COMBOS[i]]
        if len(set(held)) != len(held):
            continue
        wt = float(np.prod([w[i] for w, i in zip(folds, deal)]))
        z += wt
        for a in held:
            p1[a] += wt
            for b in held:
                p2[a, b] += wt
    p1, p2 = p1 / z, p2 / z
    F = np.array([0.0 if set(cb) & dead else 1.0 - p1[cb[0]] - p1[cb[1]] + p2[cb[0], cb[1]] for cb in ALL_COMBOS])
    left = 52 - len(dead) - 2 * len(folds)
    nxt = np.array([0.0 if c in dead else (1.0 - p1[c]) / left for c in range(52)])
    return p1, p2, F, nxt


class AgainstBruteForce(unittest.TestCase):
    def test_one_folder_exact(self):
        rng = np.random.default_rng(1)
        dead = cards("Kd7c2h")
        w = sparse(rng, 60)
        p1, p2, F, nxt = brute([w], dead)
        m = B.moments([w], dead)
        self.assertIsNone(m.samples)
        np.testing.assert_allclose(m.p1, p1, atol=1e-12)
        np.testing.assert_allclose(m.p2, p2, atol=1e-12)
        np.testing.assert_allclose(m.factor(dead), F, atol=1e-12)
        np.testing.assert_allclose(B.card_odds(m, dead), nxt, atol=1e-12)

    def test_two_folders_exact(self):
        rng = np.random.default_rng(2)
        dead = cards("AsTd9d")
        folds = [sparse(rng, 50), sparse(rng, 40)]
        p1, p2, F, nxt = brute(folds, dead)
        m = B.moments(folds, dead)
        self.assertIsNone(m.samples)
        np.testing.assert_allclose(m.p1, p1, atol=1e-12)
        np.testing.assert_allclose(m.p2, p2, atol=1e-12)
        np.testing.assert_allclose(m.factor(dead), F, atol=1e-12)
        np.testing.assert_allclose(B.card_odds(m, dead), nxt, atol=1e-12)
        self.assertAlmostEqual(float(B.card_odds(m, dead).sum()), 1.0, places=12)

    def test_three_folders_sampled_within_its_error(self):
        rng = np.random.default_rng(3)
        dead = cards("8h8c3s")
        folds = [sparse(rng, 18), sparse(rng, 16), sparse(rng, 14)]
        _, _, F, nxt = brute(folds, dead)
        m = B.moments(folds, dead, samples=60_000, seed=7)
        self.assertEqual(m.samples, 60_000)
        f, se = m.factor(dead), m.stderr(dead)
        live = F > 0
        z = np.abs(f - F)[live] / np.maximum(se[live], 1e-9)
        # (1,225 live combos: a stated standard error that's right puts almost all within 4.5 of them, and the mean
        # error near 0.8 of one)
        self.assertLess(z.max(), 4.5)
        self.assertLess(float(np.mean(z)), 1.0)
        self.assertLess(float(np.abs(B.card_odds(m, dead) - nxt).max()), 0.002)

    def test_the_sampler_agrees_with_the_exact_sums(self):
        rng = np.random.default_rng(4)
        dead = cards("QcJc4d")
        folds = [sparse(rng, 300), sparse(rng, 400)]
        ex = B.moments(folds, dead)
        mc = B.moments(folds, dead, exact_max=0, samples=40_000, seed=3)
        self.assertEqual(mc.samples, 40_000)
        live = ex.factor(dead) > 0
        z = np.abs(mc.factor(dead) - ex.factor(dead))[live] / mc.stderr(dead)[live]
        self.assertLess(z.max(), 4.5)

    def test_even_folds_leave_every_combo_alike(self):
        dead = cards("Kd7c2h")
        m = B.moments([np.ones(N)], dead)
        f = m.factor(dead)
        live = f > 0
        n = 49
        np.testing.assert_allclose(f[live], (n - 2) * (n - 3) / (n * (n - 1)), atol=1e-12)
        np.testing.assert_allclose(B.card_odds(m, dead)[[c for c in range(52) if c not in dead]], 1 / n, atol=1e-12)

    def test_no_folders_is_no_change(self):
        dead = cards("Kd7c2h")
        m = B.moments([], dead)
        np.testing.assert_array_equal(m.factor(dead), B.live_mask(dead))

    def test_folds_that_cant_all_be_held(self):
        one = np.zeros(N)
        one[0] = 1.0   # (the same combo for both)
        with self.assertRaises(ValueError):
            B.moments([one, one.copy()])
        with self.assertRaises(ValueError):
            B.moments([one, one.copy(), one.copy()], samples=1000)
        with self.assertRaises(ValueError):
            B.moments([one], dead=list(ALL_COMBOS[0]))

    def test_sampling_is_reproducible(self):
        rng = np.random.default_rng(5)
        folds = [sparse(rng, 200) for _ in range(3)]
        a, b = B.moments(folds, seed=11, samples=5000), B.moments(folds, seed=11, samples=5000)
        np.testing.assert_array_equal(a.p2, b.p2)

    def test_scaled_keeps_the_least_blocked_combo_as_it_was(self):
        r = np.zeros(N)
        r[:10] = 1.0
        f = np.linspace(0.5, 1.0, N)
        w, m = B.scaled(r, f)
        self.assertAlmostEqual(float(w.max()), 1.0)
        self.assertAlmostEqual(m, float(f[9]))
        self.assertTrue(np.all(w[10:] == 0))


PRE = [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "fold"},
       {"pos": "BTN", "action": "raise", "to": 2.5}, {"pos": "SB", "action": "fold"}, {"pos": "BB", "action": "call"}]
UTG_BB = [{"pos": "UTG", "action": "raise", "to": 2.5}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "fold"},
          {"pos": "BTN", "action": "fold"}, {"pos": "SB", "action": "fold"}, {"pos": "BB", "action": "call"}]
THREE = [{"pos": "UTG", "action": "fold"}, {"pos": "HJ", "action": "fold"}, {"pos": "CO", "action": "fold"},
         {"pos": "BTN", "action": "raise", "to": 2.5}, {"pos": "SB", "action": "call"}, {"pos": "BB", "action": "call"}]


def table(n=6, stack=100.0):
    return pf.at_depth(pf.Table(pf.SEATS[n], 0.0, False, None), stack)


class TheFolds(unittest.TestCase):
    def test_charts_fold_ranges_are_the_range_there_times_the_fold(self):
        pre = A._norm_actions(PRE, 1.0)
        f = B.chart_folds(pre, table(), 100.0)
        self.assertEqual(list(f), ["UTG", "HJ", "CO", "SB"])
        utg = A.preflop_strategy("UTG", [], table(), 100.0)
        np.testing.assert_allclose(f["UTG"], utg["fold"])
        # (the small blind folds from a full range, facing the button's open)
        sb = A.preflop_strategy("SB", pre[:4], table(), 100.0)
        np.testing.assert_allclose(f["SB"], sb["fold"])
        # (a later folder's range is what the earlier folds left it: HJ folds after UTG folded, all its hands there)
        self.assertTrue(np.all(f["HJ"] <= 1.0) and f["HJ"].sum() > 900)

    def test_solve_fold_ranges_from_the_stored_game(self):
        pre = A._norm_actions(PRE, 1.0)
        f = B.solve_folds({"players": 6, "stack": 100}, pre)
        self.assertEqual(list(f), ["UTG", "HJ", "CO", "SB"])
        from gto.pf_classes import CLASS_OF, CLASSES
        aa = CLASSES.index("AA")
        self.assertEqual(float(f["UTG"][CLASS_OF == aa].max()), 0.0)   # (nobody folds aces first in)
        self.assertGreater(f["UTG"].sum(), 900)

    def test_the_solve_unavailable_falls_back_to_the_charts_and_says_why(self):
        pre = A._norm_actions(PRE, 1.0)
        with self.assertRaises(B.Unavailable):
            B.solve_folds({"players": 6, "stack": 100, "ante": 0.37}, pre)   # (no stored game, none run)
        plan = B.plan_for({"players": 6, "stack": 100, "ante": 0.37}, "solve", pre, table(), 100.0, cards("Kd7c2h"))
        self.assertEqual((plan.source, plan.asked), ("charts", "solve"))
        self.assertIn("isn't stored or solved yet", plan.why)

    def test_nobody_folded(self):
        with self.assertRaises(B.Unavailable):
            B.plan_for({"players": 2}, "charts", A._norm_actions([{"pos": "SB", "action": "raise", "to": 2.5},
                                                                  {"pos": "BB", "action": "call"}], 1.0),
                       table(2), 100.0, cards("Kd7c2h"))

    def test_parse(self):
        self.assertIsNone(B.parse({}))
        self.assertIsNone(B.parse({"bunching": False}))
        self.assertIsNone(B.parse({"bunching": "off"}))
        self.assertEqual(B.parse({"bunching": True}), "charts")
        self.assertEqual(B.parse({"bunching": "Solve"}), "solve")
        with self.assertRaises(ValueError):
            B.parse({"bunching": "both"})


class TheWrap(unittest.TestCase):
    """Through Advisor.advise, as the worker asks."""

    @classmethod
    def setUpClass(cls):
        from test_study_lock import FAST, advisor
        cls.adv = advisor(FAST, 0.3)
        cls.adv.should_stop = lambda: False
        cls.seen = []
        upstream = A.Advisor._postflop

        def spy(adv, hero, hole, board, stack, streets, positions, *a, **k):
            pr = A.preflop_ranges(streets["preflop"], positions, stack)
            cls.seen.append(({p: v.copy() for p, v in pr.items()}, adv.library, adv.mw_library))
            return upstream(adv, hero, hole, board, stack, streets, positions, *a, **k)
        cls.upstream_postflop = upstream
        A.Advisor._postflop = spy

    @classmethod
    def tearDownClass(cls):
        A.Advisor._postflop = cls.upstream_postflop

    def ask(self, line, board="Kd7c2h", **more):
        self.seen.clear()
        return self.adv.advise(dict(players=6, stack=100, preflop=line, board=board, study=True, budget=0.6,
                                    prior_budget=0.3, **more))

    def test_off_is_upstream(self):
        r = self.ask(PRE)
        self.assertNotIn("error", r)
        self.assertNotIn("bunching", r)
        ranges, _, _ = self.seen[0]
        np.testing.assert_array_equal(ranges["BTN"], B._upstream_ranges(A._norm_actions(PRE, 1.0), table(), 100.0)["BTN"])

    def test_heads_up_flop_solved_on_the_weighted_ranges(self):
        sentinel = object()
        self.adv.library = self.adv.mw_library = sentinel
        try:
            r = self.ask(PRE, bunching="charts")
        finally:
            self.adv.library = self.adv.mw_library = None
        self.assertNotIn("error", r)
        b = r["bunching"]
        self.assertEqual(b["source"], "charts")
        self.assertEqual([f["seat"] for f in b["folders"]], ["UTG", "HJ", "CO", "SB"])
        self.assertEqual(set(b["seats"]), {"BTN", "BB"})
        self.assertEqual((b["method"], b["samples"], b["runouts"]), ("sampled", B.SAMPLES, "dealt evenly"))
        self.assertLess(b["stderr_pct"], 0.5)
        self.assertEqual(b["next_card"]["street"], "turn")
        aces = next(x for x in b["next_card"]["by_rank"] if x["rank"] == "A")
        self.assertGreater(aces["p"], aces["even"])   # (the folds are short of aces)
        self.assertTrue(r["notes"][0].startswith("bunching: the ranges are weighed by the hands UTG, HJ, CO, SB folded"))
        ranges, lib, mwlib = self.seen[0]
        self.assertIsNone(lib)
        self.assertIsNone(mwlib)
        pre = A._norm_actions(PRE, 1.0)
        plain = B._upstream_ranges(pre, table(), 100.0)
        plan = B.plan_for({}, "charts", pre, table(), 100.0, cards("Kd7c2h"))
        for p in ("BTN", "BB"):
            np.testing.assert_allclose(ranges[p], plan.weigh(plain[p]))
            self.assertLessEqual(float(ranges[p].max()), 1.0 + 1e-12)
        live = B.live_mask(cards("Kd7c2h"))
        kept = ranges["BTN"] / np.where(plain["BTN"] * live > 0, plain["BTN"], np.inf)
        i_aq = ALL_COMBOS.index(tuple(sorted(cards("AsQh"))))
        i_54 = ALL_COMBOS.index(tuple(sorted(cards("5s4s"))))
        self.assertGreater(kept[i_aq], kept[i_54] * 1.05)   # (high cards kept more than the low ones the folds hold)
        # and put back after the request
        self.assertIs(A.preflop_ranges, B._upstream_ranges)
        self.assertIs(self.adv.library, None)

    def test_library_put_back_after(self):
        sentinel = object()
        self.adv.library = sentinel
        try:
            self.ask(PRE, bunching=True)
            self.assertIs(self.adv.library, sentinel)
        finally:
            self.adv.library = None

    def test_a_three_way_flop(self):
        # (the worker's 3-way settings: the 3-player solver from the flop on, Fast's smaller flop game)
        saved = self.adv.mw_solve_streets, self.adv.mw_street_config
        self.adv.mw_solve_streets = ("flop", "turn", "river")
        self.adv.mw_street_config = {s: dict(c) for s, c in A.MW_FAST_STREETS.items()}
        try:
            r = self.ask(THREE, bunching="charts", board="9h6d2c")
        finally:
            self.adv.mw_solve_streets, self.adv.mw_street_config = saved
        self.assertNotIn("error", r)
        self.assertEqual(set(r["bunching"]["seats"]), {"BTN", "SB", "BB"})
        self.assertEqual([f["seat"] for f in r["bunching"]["folders"]], ["UTG", "HJ", "CO"])
        self.assertTrue(r.get("multiway"))

    def test_from_the_preflop_solve(self):
        r = self.ask(UTG_BB, bunching="solve", board="Ts8s3d")
        self.assertNotIn("error", r)
        self.assertEqual(r["bunching"]["source"], "solve")
        self.assertNotIn("asked", r["bunching"])
        self.assertEqual([f["seat"] for f in r["bunching"]["folders"]], ["HJ", "CO", "BTN", "SB"])

    def test_a_later_street_narrows_from_the_same_weighted_flop_ranges(self):
        flop = [{"pos": "BB", "action": "check"}, {"pos": "BTN", "action": "bet", "to": 2}, {"pos": "BB", "action": "call"}]
        r = self.ask(PRE, bunching="charts", board="Kd7c2h5s", flop=flop)
        self.assertNotIn("error", r)
        self.assertEqual(r["bunching"]["conditioned_on"], "the flop")
        self.assertEqual(r["bunching"]["next_card"]["street"], "river")

    def test_a_custom_range_is_weighted_too(self):
        r = self.ask(PRE, bunching="charts", ranges={"BTN": "22+,A2s+,KTs+,ATo+"})
        self.assertNotIn("error", r)
        self.assertIn("BTN", r["bunching"]["seats"])
        self.assertTrue(any("custom one" in n for n in r["notes"]))

    def test_nobody_folded_says_off(self):
        r = self.adv.advise(dict(players=2, stack=100, preflop=[{"pos": "SB", "action": "raise", "to": 2.5},
                                                                {"pos": "BB", "action": "call"}],
                                 board="Kd7c2h", study=True, budget=0.5, prior_budget=0.3, bunching=True))
        self.assertNotIn("error", r)
        self.assertIn("nobody folded", r["bunching"]["off"])

    def test_a_bad_value_is_an_error(self):
        self.assertIn("bunching must be", self.ask(PRE, bunching="lots")["error"])


if __name__ == "__main__":
    unittest.main()
