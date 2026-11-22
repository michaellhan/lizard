"""The heads-up library's spots served as built after the charts moved under them (engine/hu_near.py).

A fake library index of the published heads-up spots (scripts/library/published_fps.json's lines, games, pots, stacks
and fingerprints; no entries: nothing here reads one), so this runs in about a second with no library download. The
last class asks the worker's advisor (scripts/qa/advserver.py) for a 200bb flop and reads the real library; it skips
without library-build/lizard-library (or QA_LIBRARY).

Run: .venv/bin/python -m unittest scripts/engine/test_hu_near.py
"""
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from gto import flop_approx as FA  # noqa: E402
from gto import flop_library as fl  # noqa: E402
from engine import hu_built, hu_near  # noqa: E402

FIXTURE = ROOT / "scripts" / "library" / "published_fps.json"
LIB = os.environ.get("QA_LIBRARY") or next(
    (str(p) for p in (ROOT / "library-build" / "lizard-library", ROOT.parents[2] / "library-build" / "lizard-library")
     if (p / "index.json").is_file()), str(ROOT / "library-build" / "lizard-library"))


def setUpModule():
    # the ranges as the worker serves them (engine/pf_charts.py, which leaves every heads-up spot's line as it was)
    global PF_CHARTS
    from engine import pf_charts as PF_CHARTS
    PF_CHARTS.install()
    hu_near.install()


def tearDownModule():
    PF_CHARTS.uninstall()


def published():
    return [s for s in json.loads(FIXTURE.read_text())["spots"] if s["kind"] == "hu"]


def fake_library():
    idx = {"format": fl.FORMAT, "spots": [{"id": s["id"], "line": s["line"], "game": s["game"], "pot": s["pot"],
                                           "stack": s["stack"], "fp": s["fp"], "label": s["id"], "flops": {}}
                                          for s in published()]}
    raw = json.dumps(idx).encode()
    return fl.FlopLibrary(lambda path: raw if path == "index.json" else None)


def today(sid):
    sp = next(s for s in published() if s["id"] == sid)
    game = {k: v for k, v in (sp["game"] or {}).items() if k in ("players", "stack", "ante", "straddle")}
    st = fl.spot_setup(sp["line"], **game)
    return st["full0"], st["full1"], st["pot"], st["stack"]


class ServedAsBuilt(unittest.TestCase):
    def setUp(self):
        hu_near._NOW.clear()
        hu_near._BUILT.clear()
        FA._SETUPS.clear()
        FA._EXACT.clear()

    def test_todays_ranges_of_a_moved_spot_read_it_as_built(self):
        lib = fake_library()
        self.assertEqual(sorted(hu_built.SPOTS), sorted(s["id"] for s in published() if s.get("now")))
        for sid, b in hu_built.SPOTS.items():
            with self.subTest(spot=sid):
                r0, r1, pot, stack = today(sid)
                self.assertIsNone(lib.spot(fl.range_fp(r0), fl.range_fp(r1), pot, stack))   # (upstream misses it)
                self.assertIsNone(FA.near_exact.hu_near_upstream(lib, r0, r1, pot, stack, 6))
                ne = FA.near_exact(lib, r0, r1, pot, stack, 6)
                self.assertEqual(ne["spot"]["id"], sid)
                self.assertEqual(ne["built"], {"commit": hu_built.COMMIT, "date": hu_built.DATE, "seats": b["seats"]})
                self.assertGreaterEqual(min(ne["cover"]), FA.NEAR_EXACT_COVER)
                self.assertLess(sum(ne["dist"]), 0.03)              # (0.0015-0.0239 measured; upstream's bar is 0.6)

    def test_a_spot_today_still_matches_is_upstreams(self):
        lib = fake_library()
        r0, r1, pot, stack = today("srp_btn_bb")
        self.assertIsNotNone(lib.spot(fl.range_fp(r0), fl.range_fp(r1), pot, stack))
        self.assertIsNone(FA.near_exact(lib, r0, r1, pot, stack, 6))

    def test_other_ranges_are_not_read_as_it(self):
        lib = fake_library()
        r0, r1, pot, stack = today("srp_sb_bb_200bb")
        self.assertIsNone(FA.near_exact(lib, r0 * 0.999, r1, pot, stack, 6))   # (near, but not the line's today)
        self.assertIsNone(FA.near_exact(lib, r0, r1, pot + 1.0, stack, 6))

    def test_a_spot_whose_ranges_moved_too_far_is_left_to_the_live_solve(self):
        saved = FA.NEAR_EXACT_DIST
        FA.NEAR_EXACT_DIST = 0.01
        try:
            r0, r1, pot, stack = today("srp_sb_bb_200bb")      # (0.0239 apart)
            self.assertIsNone(FA.near_exact(fake_library(), r0, r1, pot, stack, 6))
        finally:
            FA.NEAR_EXACT_DIST = saved

    def test_upstream_reads_a_stale_spots_built_ranges(self):
        sp = next(s for s in fake_library().index()["spots"] if s["id"] == "3bp_bb_btn_200bb")
        self.assertIsNone(FA._spot_ranges.hu_near_upstream(sp))
        st = FA._spot_ranges(sp)
        self.assertTrue(st["built"])
        self.assertEqual([fl.range_fp(st["full0"]), fl.range_fp(st["full1"])], sp["fp"])
        self.assertEqual([st["oop"], st["ip"]], hu_built.SPOTS[sp["id"]]["seats"])

    def test_the_solution_says_it_was_built_on_older_charts(self):
        b = {"spot": "srp_sb_bb_200bb", "cover": (1.0, 1.0), "dist": (0.0, 0.0239),
             "built": {"commit": "eca8152", "date": "2026-11-16", "seats": ["SB", "BB"]}}

        def upstream(self, *a, borrow=None, **k):
            return SimpleNamespace(borrowed={"spot": borrow["spot"], "cover": list(borrow["cover"]),
                                             "dist": list(borrow["dist"])})
        sol = hu_near._wrap_solution(upstream)(None, borrow=b)
        self.assertEqual(sol.borrowed["built"], b["built"])
        text = fl.LibrarySolution.borrowed_text(sol)
        self.assertEqual(text, "this spot as built on the charts of 2026-11-16, which have changed since: BB's range "
                               "differs from this pot's by 1.2% of its weight; SB's is the same")
        other = SimpleNamespace(borrowed={"spot": "x", "cover": [0.98, 1.0], "dist": [0.1, 0.2]})
        self.assertIn("this table's ranges differ from that spot's", fl.LibrarySolution.borrowed_text(other))

    def test_installed_once(self):
        f = FA.near_exact
        hu_near.install()
        self.assertIs(FA.near_exact, f)
        self.assertEqual(FA.near_exact.hu_near_upstream.__module__, "gto.flop_approx")


@unittest.skipUnless(os.path.isfile(os.path.join(LIB, "index.json")), f"no flop library at {LIB}")
class TheWorkersAnswer(unittest.TestCase):
    """srp_sb_bb_200bb asked as the worker asks it (scripts/qa/advserver.py imports engine.hu_near where it does)."""

    @classmethod
    def setUpClass(cls):
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

    def test_the_200bb_small_blinds_flop_reads_its_spot_as_built(self):
        idx = json.loads(Path(LIB, "index.json").read_text())
        sp = next(s for s in idx["spots"] if s["id"] == "srp_sb_bb_200bb")
        board = sorted(sp["flops"])[0] if isinstance(sp.get("flops"), dict) and sp["flops"] else None
        if board is None:
            board = sorted(p.stem for p in Path(LIB, sp["id"]).glob("*.bin") if "." not in p.stem)[0]
        pre = [{"pos": p, "action": "fold"} for p in ("UTG", "HJ", "CO", "BTN")] + \
              [{"pos": "SB", "action": "raise", "to": 3}, {"pos": "BB", "action": "call"}]
        r = json.loads(self.answer(dict(players=6, stack=200, hero="SB", hole="AsKd", board=board, turn=[],
                                        river=[], flop=[], preflop=pre, speed="fast", budget=1.5, prior_budget=0.3,
                                        quick=True), None))
        self.assertTrue(r.get("precomputed"), r.get("notes"))
        self.assertEqual(r["precomputed"]["spot"], "srp_sb_bb_200bb")
        b = r["precomputed"].get("borrowed") or {}
        self.assertEqual(b.get("built", {}).get("commit"), hu_built.COMMIT, r["precomputed"])
        self.assertIn("as built on the charts of 2026-11-16", b.get("text", ""))


if __name__ == "__main__":
    unittest.main()
