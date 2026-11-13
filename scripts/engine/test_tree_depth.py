"""engine/tree_depth.py through the real Advisor at the worker's Fast config: a request's `raises` sets how many sized
bets and raises a street its heads-up solves offer, `max_cells` the tree cap (clamped to the device's), both are put
back after the request, and a request with neither is answered as upstream answers it.

Small budgets: what's tested is the tree, not how far a solve converges.

Run: .venv/bin/python -m unittest scripts/engine/test_tree_depth.py
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "engine"))

from engine import tree_depth as td  # noqa: E402
from gto.advisor import MAX_CELLS  # noqa: E402
from test_study_lock import FAST, ON_FLOP, RIVER, advisor  # noqa: E402

BET = [{"pos": "BB", "action": "bet", "to": 3}]
THREE = BET + [{"pos": "BTN", "action": "raise", "to": 9}, {"pos": "BB", "action": "raise", "to": 22}]


def names(r):
    return [a.get("action") if isinstance(a, dict) else a for a in r.get("actions", [])]


class Parse(unittest.TestCase):
    def test_whole_numbers_in_range(self):
        for v, n in ((1, 1), (4, 4), ("3", 3), (2.0, 2)):
            self.assertEqual(td.parse({"raises": v})[0], n)
        for v in (0, 5, 2.5, "two", True):
            with self.assertRaises(ValueError):
                td.parse({"raises": v})

    def test_the_cap_is_clamped_to_the_device(self):
        self.assertEqual(td.parse({"max_cells": 1})[1], td.CELLS_MIN)
        self.assertEqual(td.parse({"max_cells": 10 ** 12})[1], td.NATIVE_MAX)
        with mock.patch.object(td.sys, "platform", "emscripten"):
            self.assertEqual(td.parse({"max_cells": 10 ** 12})[1], td.BROWSER_MAX)
            self.assertEqual(td.parse({"max_cells": 12_000_000})[1], 12_000_000)
        for v in (0, -5, "lots"):
            with self.assertRaises(ValueError):
                td.parse({"max_cells": v})

    def test_neither_key_is_nothing(self):
        self.assertEqual(td.parse({}), (None, None))

    def test_the_browser_cap_holds_the_default(self):
        self.assertLessEqual(MAX_CELLS, td.BROWSER_MAX)


class Fake:
    """The parts of an Advisor the cache helpers touch: kept solves of `mb` MB each, oldest first."""

    def __init__(self, sizes_mb, cut=None):
        self.cache_mb = 700.0
        self._cache, self._by_spot, self._mw_cache, self._mw_lines, self._held = {}, {}, {}, {}, {}
        for i, mb in enumerate(sizes_mb):
            sol = type("Sol", (), {})()
            if cut and i in cut:
                sol.trimmed = (1, 30_000_000, cut[i])
            self._cache[i] = sol
            self._by_spot[("spot", i)] = sol
            self._held[(self, "_cache", i)] = int(mb * 2 ** 20)


class Cache(unittest.TestCase):
    def test_a_raised_cap_forgets_the_solves_cut_under_a_smaller_one(self):
        a = Fake([100, 100, 100], cut={0: 12_000_000, 1: 24_000_000})
        self.assertEqual(td._forget_cut(a, 24_000_000), 1)
        self.assertEqual(sorted(a._cache), [1, 2])
        self.assertEqual(sorted(s[1] for s in a._by_spot), [1, 2])
        self.assertEqual(len(a._held), 2)

    def test_a_bigger_tree_in_the_browser_makes_room_first(self):
        a = Fake([300, 200, 150])   # 650 MB kept of 700
        self.assertEqual(td._make_room(a, 32_000_000), 0, "natively nothing goes")
        with mock.patch.object(td.sys, "platform", "emscripten"):
            self.assertEqual(td._make_room(a, MAX_CELLS), 0, "nor at upstream's cap")
            # 8M cells more at BYTES_PER_CELL: ~252 MB, so ~448 MB may stay: the oldest (300) goes
            self.assertEqual(td._make_room(a, 32_000_000), 1)
        self.assertEqual(sorted(a._cache), [1, 2])
        self.assertNotIn(("spot", 0), a._by_spot)

    def test_importing_again_wraps_upstream_once(self):
        import importlib
        from gto.advisor import Advisor
        importlib.reload(td)
        self.assertIs(td._upstream, Advisor._advise_at.upstream)
        self.assertFalse(hasattr(td._upstream, "upstream"))


class Requests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adv = advisor(FAST, 0.2)
        cls.adv.should_stop = lambda: False

    def ask(self, state, **more):
        before = self.adv.cfg, self.adv.max_cells, self.adv.cfg.max_raises
        r = self.adv.advise(dict(state, budget=1.0, prior_budget=0.5, **more))
        self.assertEqual((self.adv.cfg, self.adv.max_cells, self.adv.cfg.max_raises), before, "put back after")
        self.assertNotIn("error", r)
        return r

    def test_upstreams_cap_is_a_bet_and_a_raise(self):
        r = self.ask(RIVER, river=BET)
        self.assertNotIn("tree", r)
        self.assertTrue(any(n.startswith("raise to") for n in names(r)))
        r = self.ask(RIVER, river=THREE)
        self.assertEqual(names(r), ["fold", "call", "all-in"])

    def test_one_leaves_a_bet_only_call_fold_or_all_in(self):
        r = self.ask(RIVER, river=BET, raises=1)
        self.assertEqual(names(r), ["fold", "call", "all-in"])
        self.assertEqual(r["tree"], {"raises": 1})

    def test_four_offers_a_sized_four_bet(self):
        r = self.ask(RIVER, river=THREE, raises=4)
        self.assertIn("call", names(r))
        self.assertTrue(any(n.startswith("raise to") for n in names(r)), names(r))
        self.assertEqual(r["tree"], {"raises": 4})

    def test_a_bad_value_is_refused_in_words(self):
        r = self.adv.advise(dict(RIVER, river=BET, budget=1.0, raises=9))
        self.assertIn("raises must be a whole number from 1 to 4", r.get("error", ""))
        self.assertEqual(self.adv.cfg.max_raises, 2)

    def test_a_multiway_answer_says_nothing_of_it(self):
        """3- and 4-way solves keep their own menu and raise cap (multiway_solver.MWConfig), so their answer doesn't
        claim the request's."""
        for multiway, want in ((True, None), (False, {"raises": 3})):
            wrapped = td._wrapping(lambda adv, st, *a, multiway=multiway, **k: {"street": "flop", "multiway": multiway})
            self.assertEqual(wrapped(self.adv, {"raises": 3}).get("tree"), want)
        self.assertEqual(self.adv.cfg.max_raises, 2)

    def test_the_cap_cuts_the_tree_and_says_so(self):
        """A flop (no time cap on the flop: only max_cells) with five bet sizes, two raise sizes and four raises is past
        the smallest cap, so it's cut, with the note; under upstream's 24M it isn't."""
        menu = dict(raises=4, sizes={"flop": [25, 33, 50, 75, 125], "turn": [33, 75, 125], "river": [33, 75, 125],
                                     "raise": [50, 100]})
        r = self.ask(ON_FLOP, max_cells=1, **menu)
        self.assertEqual(r["tree"], {"raises": 4, "max_cells": td.CELLS_MIN})
        self.assertTrue([n for n in r["notes"] if n.startswith("flop: solved in a smaller game than the full one")], r["notes"])
        r = self.ask(ON_FLOP, **menu)
        self.assertFalse([n for n in r["notes"] if "smaller game than the full one" in n], r["notes"])

if __name__ == "__main__":
    unittest.main()
