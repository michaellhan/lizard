"""engine/single_size.py through the real Advisor at the worker's Fast config, on a tiny single-size library built here
by scripts/library/build_single_size.py (two entries at a small iteration count: what's tested is which entry is read,
not how far it converged): a request with `single_size` and the flop's own size reads the stored entry, one without is
answered as upstream answers it, and the library is put back after.

Run: .venv/bin/python -m unittest scripts/engine/test_single_size.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP = Path(tempfile.mkdtemp(prefix="single-size-test-"))
os.environ["SINGLE_SIZE_MAIN"] = str(TMP)  # (the build script's default output, never the real one)
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "engine"))
sys.path.insert(0, str(ROOT / "scripts" / "library"))

import build_single_size as bss  # noqa: E402
from engine import single_size as ss  # noqa: E402
from gto.flop_library import FlopLibrary  # noqa: E402
from test_study_lock import FAST, advisor  # noqa: E402

FLOP = "Ac7d2h"
OPTS = {"min_iters": 40, "max_iters": 40, "check": 40, "target": 100.0}


def acts(*xs):
    return [{"pos": p, "action": a, **({"to": t} if t else {})} for p, a, t in xs]


OPEN = acts(("UTG", "fold", 0), ("HJ", "fold", 0), ("CO", "fold", 0), ("BTN", "raise", 2.5), ("SB", "fold", 0))
SRP = OPEN + acts(("BB", "call", 0))
FOURBET = OPEN + acts(("BB", "raise", 10), ("BTN", "raise", 23), ("BB", "call", 0))


def names(r):
    return [a.get("action") if isinstance(a, dict) else a for a in r.get("actions", [])]


class SingleSize(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bss.load(ROOT / "solver")
        cls.lib_dir = TMP / "lib"
        for sid in ("ss_4bp_btn_bb", "ss_srp_btn_bb"):   # (river dealt with a turn file; the old tree)
            bss.solve_one(cls.lib_dir, sid, FLOP, bss.BY_ID[sid].tree, OPTS)
        cls.idx = bss.write_index(cls.lib_dir, [bss.BY_ID["ss_4bp_btn_bb"], bss.BY_ID["ss_srp_btn_bb"]])
        # as assemble.py stages it
        shutil.copyfile(cls.lib_dir / bss.INDEX, cls.lib_dir / ss.INDEX)
        cls.fetches = []

        def fetch(p):
            cls.fetches.append(p)
            f = cls.lib_dir / p.split("?")[0]
            return f.read_bytes() if f.exists() else None
        cls.adv = advisor(FAST, 0.2)
        cls.adv.should_stop = lambda: False
        cls.adv.library = FlopLibrary(fetch)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TMP, ignore_errors=True)

    def spot(self, sid):
        return next(s for s in self.idx["spots"] if s["id"] == sid)

    def ask(self, preflop, sid, board=FLOP, sizes=None, **more):
        pct = self.spot(sid)["sizes"][FLOP]
        st = dict(players=6, stack=100, preflop=preflop, study=True, board=board, budget=2.0, prior_budget=0.5,
                  single_size=True, sizes=sizes or {"flop": [pct], "turn": [75], "river": [75]}, **more)
        return self.adv.advise(st)

    def test_the_index_holds_each_flops_own_tree_and_size(self):
        s = self.spot("ss_4bp_btn_bb")
        key = s["flop_tree"][FLOP]
        self.assertEqual(s["trees"][key]["sizes"]["flop_bet"], [s["sizes"][FLOP] / 100])
        self.assertIs(s["turns"], True)
        o = self.spot("ss_srp_btn_bb")
        self.assertEqual(o["old"], [FLOP])
        self.assertTrue(o["flop_tree"][FLOP].endswith("-old"))
        self.assertNotIn("turns", o)
        self.assertEqual(s["label"], "BTN 4bet vs BB, single size")
        self.assertTrue(all(sp["single_size"] for sp in self.idx["spots"]))

    def test_a_single_size_request_reads_the_stored_entry(self):
        for pre, sid in ((FOURBET, "ss_4bp_btn_bb"), (SRP, "ss_srp_btn_bb")):
            r = self.ask(pre, sid)
            self.assertNotIn("error", r)
            self.assertEqual(r["precomputed"]["spot"], sid)
            info = r["single_size"]
            self.assertTrue(info["stored"])
            self.assertEqual(info["spot"], sid)
            self.assertEqual(info["flop"], {"spot": sid, "flop": FLOP, "pct": self.spot(sid)["sizes"][FLOP]})
            self.assertTrue(info["library"])
            self.assertEqual(len([a for a in names(r) if a != "check"]), 1)   # (one bet size)

    def test_the_library_is_put_back(self):
        lib, mw = self.adv.library, self.adv.mw_library
        self.ask(SRP, "ss_srp_btn_bb")
        self.assertIs(self.adv.library, lib)
        self.assertIs(self.adv.mw_library, mw)

    def test_another_size_is_solved_live(self):
        r = self.ask(SRP, "ss_srp_btn_bb", sizes={"flop": [140], "turn": [75], "river": [75]})
        self.assertNotIn("precomputed", r)
        self.assertFalse(r["single_size"]["stored"])
        self.assertNotIn("flop", r["single_size"])

    def test_a_flop_the_library_lacks_is_solved_live(self):
        r = self.ask(SRP, "ss_srp_btn_bb", board="Qs9h4c")
        self.assertNotIn("precomputed", r)
        self.assertFalse(r["single_size"]["stored"])
        self.assertTrue(r["single_size"]["library"])

    def test_a_later_street_stands_on_the_stored_flop(self):
        r = self.ask(SRP, "ss_srp_btn_bb", board=FLOP + "5s", flop=acts(("BB", "check", 0), ("BTN", "check", 0)))
        self.assertNotIn("error", r)
        self.assertFalse(r["single_size"]["stored"])
        self.assertEqual(r["single_size"]["flop"]["spot"], "ss_srp_btn_bb")

    def test_a_request_without_it_is_upstreams(self):
        r = self.adv.advise(dict(players=6, stack=100, preflop=SRP, study=True, board=FLOP, budget=1.0,
                                 prior_budget=0.5))
        self.assertNotIn("single_size", r)
        self.assertNotIn("precomputed", r)   # (the several-size library here has no index: nothing read)

    def test_parse(self):
        self.assertFalse(ss.parse({}))
        self.assertFalse(ss.parse({"single_size": False}))
        self.assertTrue(ss.parse({"single_size": True}))
        for v in ("yes", 1, {"x": 1}):
            with self.assertRaises(ValueError):
                ss.parse({"single_size": v})
        self.assertIn("error", self.adv.advise(dict(players=6, stack=100, preflop=SRP, board=FLOP, single_size="yes")))

    def test_a_missing_or_foreign_index_is_no_library(self):
        lib = ss.SingleSizeLibrary(lambda p: None)
        self.assertEqual(lib.index(), {"spots": []})
        lib = ss.SingleSizeLibrary(lambda p: json.dumps({"format": 2, "ss_format": 99, "spots": [{}]}).encode())
        self.assertEqual(lib.index(), {"spots": []})

    def test_one_reader_per_library(self):
        self.assertIs(ss.library_for(self.adv.library), ss.library_for(self.adv.library))
        self.assertIsNone(ss.library_for(None))


if __name__ == "__main__":
    unittest.main()
