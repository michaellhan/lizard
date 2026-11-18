"""The 3-way library's spots served as built after the charts moved under them (engine/mw_near.py).

A fake library index of the four published spots (engine/mw_built.py's fingerprints, pot, stack and seats; no entries:
nothing here reads one), so this runs in about a second with no library download.

Run: .venv/bin/python -m unittest scripts/engine/test_mw_near.py
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from gto import flop_library as fl  # noqa: E402
from gto import mw_library as ML  # noqa: E402
from engine import mw_built, mw_near  # noqa: E402


def fake_library(spots=None):
    idx = {"format": ML.FORMAT, "tree": ML.tree_key(ML.library_config()),
           "spots": spots if spots is not None else [
               {"id": sid, "line": b["line"], "seats": b["seats"], "pot": b["pot"], "stack": b["stack"],
                "fp": b["fp"], "label": sid, "flops": {}} for sid, b in mw_built.SPOTS.items()]}
    raw = json.dumps(idx).encode()
    return ML.MWLibrary(lambda path: raw if path == ML.INDEX else None)


def today(sid):
    st = ML.spot_setup(mw_built.SPOTS[sid]["line"])
    return st["ranges"], st["pot"], st["stack"]


class ServedAsBuilt(unittest.TestCase):
    def setUp(self):
        mw_near._NOW.clear()
        mw_near._BUILT.clear()

    def test_todays_ranges_of_a_moved_spot_read_it_as_built(self):
        lib = fake_library()
        for sid in mw_built.SPOTS:
            with self.subTest(spot=sid):
                ranges, pot, stack = today(sid)
                self.assertIsNone(lib.spot([fl.range_fp(r) for r in ranges], pot, stack))   # (upstream misses it)
                spot, b = lib._pick(ranges, pot, stack, 6)
                self.assertEqual(spot["id"], sid)
                self.assertEqual(b["built"], {"commit": mw_built.COMMIT, "date": mw_built.DATE,
                                              "seats": mw_built.SPOTS[sid]["seats"]})
                self.assertLessEqual(sum(b["dist"]), mw_near.NEAR_DIST)
                self.assertGreaterEqual(min(b["cover"]), mw_near.NEAR_COVER)
                # (custom ranges, players None: never borrowed)
                self.assertEqual(lib._pick(ranges, pot, stack, None), (None, None))

    def test_other_ranges_are_not_read_as_it(self):
        lib = fake_library()
        ranges, pot, stack = today("mw_co_btn_bb")
        other = [np.asarray(r, dtype=float).copy() for r in ranges]
        other[0] = other[0] * 0.999      # (near, but not what the spot's line gives today)
        self.assertEqual(lib._pick(other, pot, stack, 6), (None, None))
        self.assertEqual(lib._pick(ranges, pot + 1.0, stack, 6), (None, None))

    def test_a_spot_whose_ranges_moved_too_far_is_left_to_the_live_solve(self):
        saved = mw_near.NEAR_DIST
        mw_near.NEAR_DIST = 0.1
        try:
            ranges, pot, stack = today("mw_co_btn_bb")
            self.assertEqual(fake_library()._pick(ranges, pot, stack, 6), (None, None))
        finally:
            mw_near.NEAR_DIST = saved

    def test_a_spot_today_reproduces_is_upstreams(self):
        """A spot whose fingerprints today's code gives is found by upstream's exact match, never as built."""
        sid = "mw_co_btn_bb"
        ranges, pot, stack = today(sid)
        b = mw_built.SPOTS[sid]
        lib = fake_library([{"id": sid, "line": b["line"], "seats": b["seats"], "pot": pot, "stack": stack,
                             "fp": [fl.range_fp(r) for r in ranges], "label": sid, "flops": {}}])
        spot, bw = lib._pick(ranges, pot, stack, 6)
        self.assertEqual(spot["id"], sid)
        self.assertIsNone(bw)

    def test_its_own_ranges_stand_in_where_upstream_reads_a_spots_ranges(self):
        sp = next(s for s in fake_library().index()["spots"] if s["id"] == "mw_btn_sb_bb")
        st = ML._spot_ranges(sp)
        self.assertIsNotNone(st)
        self.assertEqual([fl.range_fp(r) for r in st["ranges"]], sp["fp"])
        self.assertIsNone(ML._spot_ranges.mw_near_upstream(sp))     # (today's code alone no longer gives them)


class Labels(unittest.TestCase):
    def test_the_text_names_the_range_that_moved_and_by_how_much(self):
        b = {"built": {"commit": "5b49b94", "date": "2026-11-16", "seats": ["BB", "CO", "BTN"]},
             "dist": (0.1495, 0.0, 0.0), "cover": (0.9657, 1.0, 1.0)}
        self.assertEqual(mw_near.built_text(b), "this spot as built on the charts of 2026-11-16, which have changed "
                                                "since: BB's range differs from this pot's by 7.5% of its weight; CO "
                                                "and BTN's are the same")

    def test_a_spot_served_as_built_is_marked_without_another_tables_label(self):
        class Sol:
            label = "CO open, BTN and BB call"
            borrowed = None
        b = {"spot": {"id": "mw_co_btn_bb"}, "cover": (0.9657, 1.0, 1.0), "dist": (0.1495, 0.0, 0.0),
             "built": {"commit": "5b49b94", "date": "2026-11-16", "seats": ["BB", "CO", "BTN"]}}
        s = ML.MWLibrary._mark(Sol(), b)
        self.assertEqual(s.label, "CO open, BTN and BB call")
        self.assertEqual(s.borrowed["built"]["date"], "2026-11-16")
        self.assertEqual(s.borrowed["dist"], [0.1495, 0.0, 0.0])
        # (another table's pot keeps upstream's mark)
        s2 = ML.MWLibrary._mark(Sol(), {k: v for k, v in b.items() if k != "built"})
        self.assertTrue(s2.label.startswith("6-max "))
        self.assertNotIn("built", s2.borrowed)

    def test_the_solutions_text_is_the_built_text(self):
        sol = ML.LibraryMWSolution.__new__(ML.LibraryMWSolution)
        sol.borrowed = {"spot": "mw_co_btn_bb", "cover": [0.9657, 1.0, 1.0], "dist": [0.1495, 0.0, 0.0],
                        "built": {"commit": "5b49b94", "date": "2026-11-16", "seats": ["BB", "CO", "BTN"]}}
        self.assertTrue(sol.borrowed_text().startswith("this spot as built on the charts of 2026-11-16"))


if __name__ == "__main__":
    unittest.main()
