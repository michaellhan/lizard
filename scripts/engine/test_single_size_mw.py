"""The 3-way single-size set (build_single_size.py --set mw3, engine/single_size.py SingleSizeMWLibrary) through the real
Advisor at the worker's Fast config, with the worker's charts (engine/pf_charts.py) and 3-way patches (engine/mw_near.py)
installed, on a tiny set built here (one 3-way entry and one heads-up entry at a small iteration count: what's tested is
which entry is read and which tree the live solves play, not how far they converged).

Run: .venv/bin/python -m unittest scripts/engine/test_single_size_mw.py   (about a minute: a live 3-way flop solve)
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP = Path(tempfile.mkdtemp(prefix="single-size-mw-test-"))
os.environ["SINGLE_SIZE_MAIN"] = str(TMP)  # (the build script's default output, never the real one)
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "engine"))
sys.path.insert(0, str(ROOT / "scripts" / "library"))

import build_single_size as bss  # noqa: E402
from gto.flop_library import FlopLibrary  # noqa: E402
from test_study_lock import FAST, advisor  # noqa: E402

FLOP = "Ac7d2h"
OPTS = {"min_iters": 40, "max_iters": 40, "check": 40, "target": 100.0}
SID = "ss_mw_btn_sb_bb"


def acts(*xs):
    return [{"pos": p, "action": a, **({"to": t} if t else {})} for p, a, t in xs]


MW = acts(("UTG", "fold", 0), ("HJ", "fold", 0), ("CO", "fold", 0), ("BTN", "raise", 2.5), ("SB", "call", 0),
          ("BB", "call", 0))
FOURBET = acts(("UTG", "fold", 0), ("HJ", "fold", 0), ("CO", "fold", 0), ("BTN", "raise", 2.5), ("SB", "fold", 0),
               ("BB", "raise", 10), ("BTN", "raise", 23), ("BB", "call", 0))


def names(r):
    return [a.get("action") if isinstance(a, dict) else a for a in r.get("actions", [])]


def setUpModule():
    global PF_CHARTS, ss
    bss.load(ROOT / "solver")
    bss.worker_charts()
    from engine import pf_charts as PF_CHARTS   # (the worker's charts, as the build's)
    import engine.mw_near  # noqa: F401  (the worker's 3-way patches, imported before single_size as the worker does)
    from engine import single_size as ss


def tearDownModule():
    PF_CHARTS.uninstall()
    shutil.rmtree(TMP, ignore_errors=True)


class SingleSizeMW(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lib_dir = TMP / "lib"
        bss.solve_one(cls.lib_dir, SID, FLOP, "mw", OPTS)
        bss.solve_one(cls.lib_dir, "ss_4bp_btn_bb", FLOP, "dealt", OPTS)
        cls.idx = bss.write_index(cls.lib_dir, [bss.BY_ID[SID], bss.BY_ID["ss_4bp_btn_bb"]])
        shutil.copyfile(cls.lib_dir / bss.INDEX, cls.lib_dir / ss.INDEX)   # (as assemble.py stages it)

        def fetch(p):
            f = cls.lib_dir / p.split("?")[0]
            return f.read_bytes() if f.exists() else None
        cls.adv = advisor(FAST, 0.2)
        cls.adv.should_stop = lambda: False
        cls.adv.library = FlopLibrary(fetch)
        cls.adv.mw_budget = 3.0
        from gto.advisor import MW_FAST_STREETS   # (as solver/gto/static/worker.js sets Fast up)
        cls.adv.mw_solve_streets = ("flop", "turn", "river")
        cls.adv.mw_street_config = {s: dict(c) for s, c in MW_FAST_STREETS.items()}

    def spot(self, sid):
        return next(s for s in self.idx["spots"] if s["id"] == sid)

    def ask(self, board=FLOP, flop=(), pct=None, **more):
        pct = pct if pct is not None else self.spot(SID)["sizes"][FLOP]
        st = dict(players=6, stack=100, preflop=MW, flop=list(flop), study=True, board=board, budget=2.0,
                  prior_budget=0.5, single_size=True, sizes={"flop": [pct], "turn": [50], "river": [50]}, **more)
        return self.adv.advise(st)

    def test_the_index_row_is_a_3_way_one(self):
        s = self.spot(SID)
        self.assertEqual(s["players"], 3)
        self.assertEqual(len(s["fp"]), 3)
        self.assertEqual(s["seats"], ["SB", "BB", "BTN"])
        self.assertEqual(s["sizes"], {FLOP: bss.MW3_FLOP_PCT})
        key = s["flop_tree"][FLOP]
        self.assertEqual(s["trees"][key]["bet"], {"flop": [bss.MW3_FLOP_PCT / 100], "turn": 0.5, "river": 0.5})
        self.assertEqual(s["conv"]["iters"], 40)
        self.assertEqual(s["label"], "BTN open, SB and BB call, 3-way single size")
        self.assertNotIn("report", s)

    def test_the_fingerprints_are_the_worker_charts(self):
        from gto import flop_library as fl
        from gto import mw_library as ml
        st = ml.spot_setup(self.spot(SID)["line"])
        self.assertEqual([fl.range_fp(r) for r in st["ranges"]], self.spot(SID)["fp"])

    def test_a_3_way_single_size_request_reads_the_stored_entry(self):
        for flop, actor in (((), "SB"), (acts(("SB", "check", 0)), "BB"), (acts(("SB", "check", 0), ("BB", "check", 0)), "BTN")):
            r = self.ask(flop=flop)
            self.assertNotIn("error", r)
            self.assertEqual(r["actor"], actor)
            self.assertEqual(r["precomputed"]["spot"], SID)
            info = r["single_size"]
            self.assertTrue(info["stored"])
            self.assertEqual(info["players"], 3)
            self.assertEqual(info["spot"], SID)
            self.assertEqual(info["flop"], {"spot": SID, "flop": FLOP, "pct": bss.MW3_FLOP_PCT})
            self.assertEqual(info["conv"]["iters"], 40)
            self.assertFalse(info["nash"])
            self.assertEqual(info["tree"]["flop_pct"], bss.MW3_FLOP_PCT)
            self.assertEqual(len([a for a in names(r) if a != "check"]), 1)   # (one bet size)
            note = next(n for n in r["notes"] if n.startswith("precomputed 3-way solve ("))
            self.assertIn("3-way single-size tree, one bet of", note)
            self.assertNotIn("33 and 75", note)
            ss_note = r["notes"][0]
            self.assertTrue(ss_note.startswith("single size: 3-way single-size tree: one bet size a node"), ss_note)
            self.assertIn("after 40 iterations", ss_note)
            self.assertIn("no Nash guarantee", ss_note)

    def test_the_advisor_is_put_back(self):
        lib, mw, cfg, msc = self.adv.library, self.adv.mw_library, self.adv.cfg, self.adv.mw_street_config
        bets = dict(self.adv.cfg.bet_sizes)
        self.ask()
        self.assertIs(self.adv.library, lib)
        self.assertIs(self.adv.mw_library, mw)
        self.assertIs(self.adv.cfg, cfg)
        self.assertIs(self.adv.mw_street_config, msc)
        self.assertEqual(self.adv.cfg.bet_sizes, bets)

    def test_a_flop_the_set_lacks_is_solved_live_on_the_one_size_tree(self):
        r = self.ask(board="Qs9h4c")
        self.assertNotIn("error", r)
        self.assertFalse(r.get("precomputed"))
        self.assertFalse(r["single_size"]["stored"])
        self.assertEqual(r["single_size"]["players"], 3)
        self.assertEqual(len([a for a in names(r) if a != "check"]), 1)
        self.assertTrue(any(f"one bet size ({bss.MW3_FLOP_PCT:.0f}% pot)" in n for n in r["notes"]), r["notes"])
        self.assertIn("solved live on the same tree", r["notes"][0])
        self.assertNotIn("iterations", r["notes"][0])

    def test_a_turn_stands_on_the_stored_flop(self):
        r = self.ask(board=FLOP + "Kd", flop=acts(("SB", "check", 0), ("BB", "check", 0), ("BTN", "check", 0)))
        self.assertNotIn("error", r)
        self.assertEqual(r["street"], "turn")
        info = r["single_size"]
        self.assertFalse(info["stored"])
        self.assertEqual(info["players"], 3)
        self.assertEqual(info["flop"]["spot"], SID)
        self.assertEqual(info["conv"]["iters"], 40)
        self.assertLessEqual(len([a for a in names(r) if a != "check"]), 1)   # (one turn size, 50%)
        self.assertTrue(r["notes"][0].startswith("single size: 3-way single-size tree"), r["notes"])

    def test_the_heads_up_rows_are_read_as_before(self):
        pct = self.spot("ss_4bp_btn_bb")["sizes"][FLOP]
        r = self.adv.advise(dict(players=6, stack=100, preflop=FOURBET, study=True, board=FLOP, budget=2.0,
                                 prior_budget=0.5, single_size=True, sizes={"flop": [pct], "turn": [75], "river": [75]}))
        self.assertEqual(r["precomputed"]["spot"], "ss_4bp_btn_bb")
        self.assertNotIn("players", r["single_size"])

    def test_mw_spot(self):
        from gto import preflop as pf
        idx = {"spots": [{"id": "x", "players": 3, "line": "A", "aliases": [{"line": "B"}]},
                         {"id": "y", "line": "C"}]}
        six = pf.Table(pf.SEATS[6])
        tok = lambda line: [{"pos": p.split(":")[0], "action": {"f": "fold", "c": "call"}[p.split(":")[1][0]]} if
                            p.split(":")[1][0] in "fc" else {"pos": p.split(":")[0], "action": "raise",
                                                            "to": float(p.split(":")[1][1:])} for p in line.split(",")]
        line = self.spot(SID)["line"]
        idx["spots"][0]["line"] = line
        self.assertEqual(ss.mw_spot(idx, six, 100.0, {}, tok(line))["id"], "x")
        idx["spots"][0]["aliases"] = [{"line": line}]
        idx["spots"][0]["line"] = "other"
        self.assertEqual(ss.mw_spot(idx, six, 100.0, {}, tok(line))["id"], "x")   # (an alias line)
        self.assertIsNone(ss.mw_spot(idx, six, 80.0, {}, tok(line)))
        self.assertIsNone(ss.mw_spot(idx, six, 100.0, {"ranges": {"BB": "AA"}}, tok(line)))
        self.assertIsNone(ss.mw_spot(idx, pf.Table(pf.SEATS[6], 0.17), 100.0, {}, tok(line)))
        self.assertIsNone(ss.mw_spot(idx, pf.Table(pf.SEATS[6], 0.0, False, (0.05, 3.0)), 100.0, {}, tok(line)))
        self.assertIsNone(ss.mw_spot({"spots": [{"id": "y", "line": line}]}, six, 100.0, {}, tok(line)))

    def test_a_missing_index_holds_no_3_way_rows(self):
        self.assertEqual(ss.SingleSizeMWLibrary(lambda p: None).index()["spots"], [])
        lib = ss.SingleSizeMWLibrary(lambda p: json.dumps({"format": 2, "ss_format": 1, "spots": [
            {"id": "a", "fp": ["1", "2"], "pot": 5.5, "stack": 97.5}]}).encode())
        self.assertEqual(lib.index()["spots"], [])


if __name__ == "__main__":
    unittest.main()
