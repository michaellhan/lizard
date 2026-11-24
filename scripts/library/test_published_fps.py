"""The charts can't move under a published library spot unnoticed.

A library spot is found by the fingerprints of the ranges its preflop line gives entering the flop (heads-up
FlopLibrary.spot, 3-way MWLibrary.spot), so a change to the charts or to how ranges are replayed makes the same line
miss its spot: the hand is solved live with nothing said. b10afc8 (2026-11-17) did that to all four 3-way spots. This
recomputes every published spot's fingerprints (scripts/library/published_fps.json, written from the published
indexes by scripts/library/published_fps.py) from today's code, with no library download: about a second.

A spot listed "stale" (today's code knowingly gives other ranges) is held to its "now" fingerprints instead, so a further
change still fails, and must still be served as built: a 3-way spot through engine/mw_near.py (engine/mw_built.py
reproduces its published fingerprints and today's ranges are within NEAR_DIST / NEAR_COVER of them), a heads-up one
through engine/hu_near.py (engine/hu_built.py, within upstream's own borrowing bars flop_approx.NEAR_EXACT_DIST /
NEAR_EXACT_COVER).

Run: .venv/bin/python -m unittest discover -s scripts/library -p test_published_fps.py
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from gto import flop_approx as FA  # noqa: E402
from gto import flop_library as fl  # noqa: E402
from gto import mw_library as ML  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "published_fps.json"


def setUpModule():
    # the ranges as the browser worker serves them: engine/pf_charts.py's repaired charts (installed at import, after
    # tree_depth; it leaves every heads-up spot's line as it was and moves the 3-way big blind's range by 1-3 combos)
    global PF_CHARTS
    from engine import pf_charts as PF_CHARTS
    PF_CHARTS.install()


def tearDownModule():
    PF_CHARTS.uninstall()
SPOTS = json.loads(FIXTURE.read_text())["spots"]
FIX = ("rebuild the spot with the build that made it (docs/DEPLOYMENT.md section 2; 3-way: MW_REBUILD=1 "
       "scripts/library/mw_every_flop.sh start, \"Rebuilding the 3-way spots after a chart change\") and publish it, "
       "or, if the change is deliberate and the spot is still served or knowingly dropped, update the fixture: "
       ".venv/bin/python scripts/library/published_fps.py --reason \"why\"")


def today(sp):
    game = {k: v for k, v in (sp.get("game") or {}).items() if k in ("players", "stack", "ante", "straddle")}
    if sp["kind"] == "mw":
        st = ML.spot_setup(sp["line"], **game)
        return st["seats"], [fl.range_fp(r) for r in st["ranges"]], st["pot"], st["stack"], st["ranges"]
    st = fl.spot_setup(sp["line"], **game)
    return ([st["oop"], st["ip"]], [fl.range_fp(st["full0"]), fl.range_fp(st["full1"])], st["pot"], st["stack"],
            [st["full0"], st["full1"]])


class PublishedSpots(unittest.TestCase):
    def test_every_spot_still_gets_its_ranges(self):
        self.assertGreaterEqual(sum(s["kind"] == "hu" for s in SPOTS), 1)
        self.assertGreaterEqual(sum(s["kind"] == "mw" for s in SPOTS), 1)
        for sp in SPOTS:
            with self.subTest(spot=sp["id"]):
                seats, fps, pot, stack, _ = today(sp)
                want = sp.get("now") or sp["fp"]
                self.assertEqual(fps, want, f"{sp['id']} ({sp['line']}, {sp.get('game') or '6-max 100bb'}): today's "
                                            f"charts give its seats the fingerprints {fps}, where the published spot "
                                            f"was built on {sp['fp']}" + (f" and the fixture accepted {sp['now']} "
                                                                           f"({sp['stale']})" if sp.get("now") else "")
                                 + f". The library won't find this spot for its own hand any more: {FIX}.")
                self.assertEqual(seats, sp["seats"], f"{sp['id']}: seats {seats}, published {sp['seats']}: {FIX}")
                self.assertAlmostEqual(pot, sp["pot"], places=2, msg=f"{sp['id']}: pot {pot}: {FIX}")
                self.assertAlmostEqual(stack, sp["stack"], places=2, msg=f"{sp['id']}: stack {stack}: {FIX}")

    def test_a_stale_spot_is_served_as_built(self):
        from engine import hu_built, mw_built, mw_near
        files = {"mw": (mw_built, "mw_built", mw_near.NEAR_DIST, mw_near.NEAR_COVER),
                 "hu": (hu_built, "hu_built", FA.NEAR_EXACT_DIST, FA.NEAR_EXACT_COVER)}
        for sp in [s for s in SPOTS if s.get("now")]:
            with self.subTest(spot=sp["id"]):
                mod, name, near_dist, near_cover = files[sp["kind"]]
                if sp["kind"] == "mw":
                    near_dist = mw_near.near_dist(sp["id"])     # (a spot's own measured distance, if it has one)
                built = mod.ranges(sp["id"])
                self.assertIsNotNone(built, f"{sp['id']}: engine/{name}.py doesn't hold it "
                                            f"(scripts/library/{name}_ranges.py): {FIX}")
                self.assertEqual([fl.range_fp(r) for r in built], sp["fp"],
                                 f"{sp['id']}: engine/{name}.py's ranges aren't the published ones")
                _, _, _, _, now = today(sp)
                dist = [FA.range_dist(np.asarray(x), y) for x, y in zip(now, built)]
                cover = [FA.range_cover(np.asarray(x), y) for x, y in zip(now, built)]
                self.assertLessEqual(sum(dist), near_dist, f"{sp['id']}: today's ranges are {sum(dist):.3f} "
                                                           f"from the built ones: {FIX}")
                self.assertGreaterEqual(min(cover), near_cover, f"{sp['id']}: cover {cover}: {FIX}")

    def test_built_ranges_reproduce_their_index(self):
        """engine/mw_built.py's and engine/hu_built.py's spots are published ones, with their seats, pot and stack (a
        3-way spot from another game's build, with a `source`, may be assembled and not yet published)."""
        from engine import hu_built, mw_built
        built = [("mw", sid, b, mw_built.ranges(sid)) for sid, b in mw_built.SPOTS.items()] + \
                [("hu", sid, b, hu_built.ranges(sid)) for sid, b in hu_built.SPOTS.items()]
        for kind, sid, b, rs in built:
            pub = {s["id"]: s for s in SPOTS if s["kind"] == kind}
            with self.subTest(spot=sid):
                if sid not in pub and b.get("source"):
                    # (another game's spot, assembled but not yet published: published_fps.py lists it once it is)
                    self.assertEqual([fl.range_fp(r) for r in rs], b["fp"])
                    continue
                self.assertIn(sid, pub)
                self.assertEqual(b["fp"], pub[sid]["fp"])
                self.assertEqual(b["seats"], pub[sid]["seats"])
                self.assertEqual((b["pot"], b["stack"]), (pub[sid]["pot"], pub[sid]["stack"]))
                self.assertEqual([fl.range_fp(r) for r in rs], b["fp"])


if __name__ == "__main__":
    unittest.main()
