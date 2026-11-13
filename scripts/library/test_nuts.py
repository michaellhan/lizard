"""Tests for nuts.py: its share is Study's, it waits while a heads-up build runs, and it never does a flop twice.

Run: .venv/bin/python -m unittest discover -s scripts/library
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

import nuts  # noqa: E402
from gto.breakdown import side  # noqa: E402
from gto.cards import ALL_COMBOS  # noqa: E402

FP = ["aaaa", "bbbb"]


def stage(root: Path, spots=None, summary=None) -> Path:
    """A one-spot stage with two narrow ranges, as integer weights in 1/10000."""
    s = root / "stage"
    (s / "x").mkdir(parents=True)
    w0 = [10000 if i % 40 == 0 else 0 for i in range(len(ALL_COMBOS))]
    w1 = [5000 if i % 40 == 7 else 0 for i in range(len(ALL_COMBOS))]
    (s / "x" / "ranges.json").write_text(json.dumps({"format": 1, "id": "x", "fp": FP, "w": [w0, w1]}))
    flops = {"Kd7c2h": "h", "As9s4d": "h"}
    (s / "index.json").write_text(json.dumps({"spots": spots or [{"id": "x", "seats": ["BB", "BTN"], "fp": FP, "flops": flops}]}))
    (s / "lizard-library.json").write_text(json.dumps({"spots": summary or {"x": {"flops": 2, "target": 2}}}))
    return s


def run(*args, building=False):
    with mock.patch.object(nuts, "build_running", return_value=building), mock.patch.object(sys, "argv", ["nuts.py", *map(str, args)]):
        return nuts.main()


class Share(unittest.TestCase):
    def test_a_share_is_the_one_studys_breakdown_gives(self):
        from gto.breakdown import range_equities
        from gto.cards import cards
        from gto.flop_library import MEMBER_FULL

        board = cards("Kd7c2h")
        rng = np.random.default_rng(1)
        full0, full1 = rng.random(1326) * (rng.random(1326) < 0.2), rng.random(1326) * (rng.random(1326) < 0.2)
        got = nuts.flop_nuts("Kd7c2h", full0, full1)
        bm = np.prod([1.0 - MEMBER_FULL[c] for c in board], axis=0)
        w0, w1 = full0 * bm, full1 * bm
        e0, e1 = range_equities(board, w0, w1)
        self.assertEqual(got, [side(board, w0, "a", eq=e0)["nuts"], side(board, w1, "b", eq=e1)["nuts"]])
        self.assertTrue(all(0 <= x <= 1 for x in got))


class Run(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.root = Path(d.name)
        self.out = self.root / "nuts"

    def test_it_waits_while_a_build_runs(self):
        s = stage(self.root)
        self.assertEqual(run("--stage", s, "--out", self.out, building=True), 3)
        self.assertFalse(self.out.exists())

    def test_a_spot_short_of_its_target_gets_the_flops_it_has_with_no_build_running(self):
        s = stage(self.root, summary={"x": {"flops": 2, "target": 552}})
        self.assertEqual(run("--stage", s, "--out", self.out), 0)
        self.assertEqual(sorted(json.loads((self.out / "x.json").read_bytes())["flops"]), ["As9s4d", "Kd7c2h"])

    def test_only_a_heads_up_library_build_counts_as_one(self):
        lib, lp = (str(d) for d in nuts.HU_SOURCES)
        self.assertTrue(nuts.is_build(f".venv/bin/python scripts/build_flop_library.py --format 2max --out {lib} --turn-evs"))
        self.assertTrue(nuts.is_build(f"python scripts/build_flop_library.py --spots lp_sb_bb_2max --out {lp}"))
        self.assertFalse(nuts.is_build("./target/release/hu-solver --dir runs/hu --tree B --rounds 17"))
        self.assertFalse(nuts.is_build(f"python scripts/build_flop_library.py --out {lib}-552"))
        self.assertFalse(nuts.is_build(f"python scripts/library/assemble.py --hu {lib}"))

    def test_it_writes_every_flop_and_does_none_twice(self):
        s = stage(self.root)
        self.assertEqual(run("--stage", s, "--out", self.out), 0)
        d = json.loads((self.out / "x.json").read_bytes())
        self.assertEqual(sorted(d["flops"]), ["As9s4d", "Kd7c2h"])
        self.assertEqual((d["format"], d["nut_eq"], d["fp"]), (1, 0.8, FP))
        with mock.patch.object(nuts, "flop_nuts", side_effect=AssertionError("done twice")):
            self.assertEqual(run("--stage", s, "--out", self.out), 0)

    def test_a_stop_takes_up_where_it_stopped_and_new_ranges_start_afresh(self):
        s = stage(self.root)
        run("--stage", s, "--out", self.out, "--limit", "1")
        self.assertEqual(len(json.loads((self.out / "x.json").read_bytes())["flops"]), 1)
        run("--stage", s, "--out", self.out)
        self.assertEqual(len(json.loads((self.out / "x.json").read_bytes())["flops"]), 2)
        idx = json.loads((s / "index.json").read_bytes())
        idx["spots"][0]["fp"] = ["cccc", "dddd"]
        (s / "index.json").write_text(json.dumps(idx))
        r = json.loads((s / "x" / "ranges.json").read_bytes())
        r["fp"] = ["cccc", "dddd"]
        (s / "x" / "ranges.json").write_text(json.dumps(r))
        run("--stage", s, "--out", self.out, "--limit", "1")
        d = json.loads((self.out / "x.json").read_bytes())
        self.assertEqual((d["fp"], len(d["flops"])), (["cccc", "dddd"], 1))

    def test_a_spot_of_three_players_or_with_other_ranges_is_left_out(self):
        s = stage(self.root, spots=[{"id": "x", "seats": ["SB", "BB", "BTN"], "fp": FP, "flops": {"Kd7c2h": "h"}}])
        run("--stage", s, "--out", self.out)
        self.assertFalse((self.out / "x.json").exists())
        idx = {"spots": [{"id": "x", "seats": ["BB", "BTN"], "fp": ["other", "fp"], "flops": {"Kd7c2h": "h"}}]}
        (s / "index.json").write_text(json.dumps(idx))
        run("--stage", s, "--out", self.out)
        self.assertFalse((self.out / "x.json").exists())


if __name__ == "__main__":
    unittest.main()
