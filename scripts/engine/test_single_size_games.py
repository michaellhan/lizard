"""The single-size library's ante and straddle games (scripts/library/build_single_size.py --set games, engine/single_size.py)
through the real Advisor at the worker's Fast config, on a tiny library built here: one entry of the anted BTN vs BB spot
at a small iteration count, its ranges from a pf-ranges.json written here (what's tested is which ranges are played and
which entry is read, not the preflop solve; ReadsTheStoredGame checks the real preflop solve's ranges where W11's stored
game file is in engine/pf/).

A single-size request with the game's ante on the spot's line plays the spot's ranges (the preflop solve's, not the
charts') and reads its stored entry; the same line without the ante, or with another ante, doesn't; the answer names the
game and the ranges' source.

Run: .venv/bin/python -m unittest scripts/engine/test_single_size_games.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP = Path(tempfile.mkdtemp(prefix="single-size-games-test-"))
os.environ["SINGLE_SIZE_MAIN"] = str(TMP)  # (the build script's default output, never the real one)
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "engine"))
sys.path.insert(0, str(ROOT / "scripts" / "library"))

import numpy as np  # noqa: E402

import build_single_size as bss  # noqa: E402
from engine import single_size as ss  # noqa: E402
from gto import flop_library as fl  # noqa: E402
from gto.flop_library import FlopLibrary  # noqa: E402
from gto.pf_classes import CLASSES  # noqa: E402
from test_study_lock import FAST, advisor  # noqa: E402

FLOP = "Ac7d2h"
OPTS = {"min_iters": 40, "max_iters": 40, "check": 40, "target": 100.0}
SID = "ss_srp_btn_bb_ante"


def acts(*xs):
    return [{"pos": p, "action": a, **({"to": t} if t else {})} for p, a, t in xs]


SRP = acts(("UTG", "fold", 0), ("HJ", "fold", 0), ("CO", "fold", 0), ("BTN", "raise", 2.5), ("SB", "fold", 0),
           ("BB", "call", 0))


def fake_ranges() -> dict:
    """A pf-ranges.json for SID with ranges the charts don't have: the big blind every class at 0.6 but the top pairs
    (3bet away), the button the classes in the first 70% of CLASSES' order... any weights will do, as long as they aren't
    the charts'."""
    bb = [0 if c in ("AA", "KK", "QQ") else 6000 for c in CLASSES]
    btn = [10000 if i % 3 else 2500 for i in range(len(CLASSES))]
    return {"format": 1, "classes": list(CLASSES),
            "games": {"ante": {"key": bss.GAMES["ante"].pf_key, "sha1": "000000000000", "bytes": 0, "label": "test",
                               "model": "calibrated class-level model", "words": bss.GAMES["ante"].words,
                               **bss.GAMES["ante"].as_dict()}},
            "spots": {SID: {"game": "ante", "line": bss.BY_ID[SID].line, "seats": ["BB", "BTN"], "w": [bb, btn]}}}


class Games(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bss.load(ROOT / "solver")
        cls.lib_dir = TMP / "lib"
        cls.lib_dir.mkdir(parents=True)
        (cls.lib_dir / bss.PF_RANGES).write_text(json.dumps(fake_ranges()))
        bss._PF_OUT = cls.lib_dir
        bss._PF.clear()
        bss._SETUPS.pop(SID, None)
        bss.solve_one(cls.lib_dir, SID, FLOP, bss.BY_ID[SID].tree, OPTS)
        cls.idx = bss.write_index(cls.lib_dir, [bss.BY_ID[SID]])
        shutil.copyfile(cls.lib_dir / bss.INDEX, cls.lib_dir / ss.INDEX)

        def fetch(p):
            f = cls.lib_dir / p.split("?")[0]
            return f.read_bytes() if f.exists() else None
        cls.adv = advisor(FAST, 0.2)
        cls.adv.should_stop = lambda: False
        cls.adv.library = FlopLibrary(fetch)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TMP, ignore_errors=True)

    def spot(self):
        return next(s for s in self.idx["spots"] if s["id"] == SID)

    def ask(self, board=FLOP, **more):
        pct = self.spot()["sizes"][FLOP]
        st = dict(players=6, stack=100, preflop=SRP, study=True, board=board, budget=2.0, prior_budget=0.5,
                  single_size=True, sizes={"flop": [pct], "turn": [75], "river": [75]}, **more)
        return self.adv.advise(st)

    def test_the_index_row_names_the_game_and_its_ranges(self):
        s = self.spot()
        self.assertEqual(s["game"], {"players": 6, "stack": 100.0, "ante": 0.17, "straddle": False})
        self.assertEqual(s["pf"]["key"], "lz4_6max_100bb_a0.17_ch")
        self.assertEqual(s["pf_ranges"], fake_ranges()["spots"][SID]["w"])
        self.assertNotIn("base", s)
        self.assertEqual(s["label"], "BTN vs BB single-raised pot, 1bb big-blind ante (0.17bb a seat), single size")
        # the pot and stack are the advisor's replay with the ante (6 x 0.17 in the middle), the ranges the file's
        self.assertEqual((s["pot"], s["stack"]), (6.52, 97.33))
        self.assertEqual(s["fp"], [fl.range_fp(ss.class_range(w)) for w in s["pf_ranges"]])
        chart = fl.spot_setup(s["line"], 6, 100.0, 0.17)
        self.assertNotEqual(s["fp"][0], fl.range_fp(chart["full0"]))
        rep = json.loads((self.lib_dir / SID / "report.json").read_text())
        self.assertEqual(rep["game"]["ante"], 0.17)

    def test_the_games_request_plays_the_preflop_solves_ranges_and_reads_the_entry(self):
        r = self.ask(ante=0.17)
        self.assertNotIn("error", r)
        self.assertEqual(r["precomputed"]["spot"], SID)
        info = r["single_size"]
        self.assertTrue(info["stored"])
        self.assertEqual(info["game"]["spot"], SID)
        self.assertEqual(info["game"]["ante"], 0.17)
        self.assertEqual(info["ranges"]["key"], "lz4_6max_100bb_a0.17_ch")
        self.assertTrue(any("Lizard's stored preflop solve" in n for n in r.get("notes", [])))

    def test_a_later_street_stands_on_the_stored_flop_with_the_same_ranges(self):
        r = self.ask(ante=0.17, board=FLOP + "5s", flop=acts(("BB", "check", 0), ("BTN", "check", 0)))
        self.assertNotIn("error", r)
        self.assertEqual(r["single_size"]["flop"]["spot"], SID)
        self.assertIn("game", r["single_size"])

    def test_without_the_ante_or_with_another_the_charts_play(self):
        for more in ({}, {"ante": 0.2}):
            r = self.ask(**more)
            self.assertNotIn("error", r)
            self.assertNotIn("precomputed", r)
            self.assertNotIn("game", r["single_size"])
            self.assertFalse(any("Lizard's stored preflop solve" in n for n in r.get("notes", [])))

    def test_preflop_ranges_are_put_back(self):
        from gto import advisor as A
        before = A.preflop_ranges
        self.ask(ante=0.17)
        self.assertIs(A.preflop_ranges, before)

    def test_game_spot_matching(self):
        from gto import preflop as pf
        idx = {"spots": [self.spot()]}
        t = pf.Table(pf.SEATS[6], 0.17, False, None)
        self.assertEqual(ss.game_spot(idx, t, 100.0, {}, SRP)["id"], SID)
        self.assertIsNone(ss.game_spot(idx, t, 60.0, {}, SRP))
        self.assertIsNone(ss.game_spot(idx, t, 100.0, {"stacks": {"BB": 80}}, SRP))
        self.assertIsNone(ss.game_spot(idx, pf.Table(pf.SEATS[6], 0.0, True, None), 100.0, {}, SRP))
        self.assertIsNone(ss.game_spot(idx, t, 100.0, {}, SRP[:-1] + acts(("BB", "raise", 10))))
        self.assertEqual(ss._token({"pos": "BTN", "action": "raise", "to": 2.5}), "BTN:r2.5")
        self.assertEqual(ss._token({"pos": "BB", "action": "call"}), "BB:c")


class ReadsTheStoredGame(unittest.TestCase):
    """pf-ranges off the real stored games (W11's engine/pf/ files): each spot's raise sizes are the game's, its two
    ranges are the reach times the move, and the button's range is the preflop solve's own opening share."""

    def test_pf_ranges(self):
        pf_dir = Path(os.environ.get("LIZARD_PF_DIR") or ROOT / "engine" / "pf")  # (or a copy of W11's files)
        keys = {g.pf_key for g in bss.GAMES.values()}
        if not all((pf_dir / f"{k}.bin").exists() for k in keys):
            self.skipTest(f"W11's stored ante and straddle games aren't in {pf_dir}")
        bss.load(ROOT / "solver")
        out = TMP / "pf"
        bss.make_pf_ranges(out, pf_dir, bss.GAME_SPOTS)
        got = json.loads((out / bss.PF_RANGES).read_text())
        self.assertEqual(set(got["spots"]), {s.id for s in bss.GAME_SPOTS})
        btn = ss.class_range(got["spots"]["ss_srp_btn_bb_ante"]["w"][1])
        self.assertTrue(400 < btn.sum() < 900)   # (the button's open: about half the hands)
        self.assertTrue(np.all((btn >= 0) & (btn <= 1)))


if __name__ == "__main__":
    unittest.main()
