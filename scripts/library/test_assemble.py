"""Tests for assemble.py on tiny synthetic libraries (no solver import, no real data).

Run: .venv/bin/python -m unittest discover -s scripts/library
"""
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
TREE = {"sizes": {"flop_bet": [0.33]}, "model": {"version": 1}}
OLD_TREE = {"sizes": {"flop_bet": [0.33]}, "model": {"version": 0}}
NO_EXT = "/nonexistent/lizard-extend"  # (the default extension source is the main checkout's real build)


def h(b: bytes, n: int) -> str:
    return hashlib.sha1(b).hexdigest()[:n]


def turn_file(entry: bytes) -> bytes:
    head = json.dumps({"entry": h(entry, 12)}).encode()
    return b"GTOTN1" + zlib.compress(struct.pack("<I", len(head)) + head + b"\0" * 64)


def make_lib(root: Path, sid: str, fp: list, flops: dict, turns=True, game=None, extra=None, old=None,
             spots=()) -> dict:
    """A format-2 library with one spot (and `spots`, others already made); `flops` maps flop -> entry bytes (None:
    listed but missing); `old`: the flops listed on the old tree."""
    d = root / sid
    d.mkdir(parents=True)
    report = json.dumps({"spot": sid}).encode()
    (d / "report.json").write_bytes(report)
    (d / "ranges.json").write_text("{}")
    listed = {}
    for f, b in flops.items():
        if b is None:
            listed[f] = "0" * 10
            continue
        (d / f"{f}.bin").write_bytes(b)
        (d / f"{f}.turn.bin").write_bytes(turn_file(b))
        listed[f] = h(b, 10)
    spot = {"id": sid, "label": sid, "line": "SB:r3,BB:c", "seats": ["BB", "SB"], "fp": fp, "pot": 6.0,
            "stack": 97.0, "flops": listed, "turns": turns, "report": h(report, 10)}
    if game:
        spot["game"] = game
    if not turns:
        spot.pop("turns")
        for f in flops:
            (d / f"{f}.turn.bin").unlink(missing_ok=True)
    if old:
        spot["old_tree"], spot["old"] = OLD_TREE, sorted(old)
    for name, data in (extra or {}).items():
        (d / name).write_bytes(data)
    (root / "index.json").write_text(json.dumps({"format": 2, "tree": TREE, "spots": [*spots, spot]}))
    return spot


def run(*args) -> subprocess.CompletedProcess:
    if "--extend" not in args:
        args = (*args, "--extend", NO_EXT)
    return subprocess.run([sys.executable, str(HERE / "assemble.py"), *map(str, args)], capture_output=True, text=True)


class AssembleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base, self.hu, self.out = self.tmp / "base", self.tmp / "hu", self.tmp / "stage"
        make_lib(self.base, "srp_btn_bb", ["a", "b"], {"Ks7d2c": b"entry-1", "AhKd5s": b"entry-2"})
        make_lib(self.hu, "srp_sb_bb_2max", ["c", "d"], {"Qc9d8h": b"hu-1", "Td6c3h": b"hu-2", "Ac9d8h": None},
                 game={"players": 2, "stack": 100.0, "ante": 0.0, "straddle": False},
                 extra={"Jc5d2h.bin.tmp": b"partial", "8c7c6c.bin": b"unindexed"})

    def index(self) -> dict:
        return json.loads((self.out / "index.json").read_text())

    def test_merges_base_and_heads_up_copying_only_validated_indexed_files(self):
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu)
        self.assertEqual(r.returncode, 0, r.stderr)
        idx = self.index()
        self.assertEqual(idx["tree"], TREE)
        spots = {s["id"]: s for s in idx["spots"]}
        self.assertEqual(set(spots), {"srp_btn_bb", "srp_sb_bb_2max"})
        self.assertEqual(sorted(spots["srp_sb_bb_2max"]["flops"]), ["Qc9d8h", "Td6c3h"])  # the missing one dropped
        self.assertIs(spots["srp_sb_bb_2max"]["turns"], True)
        self.assertFalse((self.out / "srp_sb_bb_2max" / "Jc5d2h.bin.tmp").exists())
        self.assertFalse((self.out / "srp_sb_bb_2max" / "8c7c6c.bin").exists())
        self.assertTrue((self.out / ".nojekyll").exists())
        summary = json.loads((self.out / "lizard-library.json").read_text())
        self.assertEqual(summary["spots"]["srp_sb_bb_2max"]["flops"], 2)
        self.assertEqual(summary["spots"]["srp_sb_bb_2max"]["target"], 1755)  # BUILD_PLANS: extended to every flop
        self.assertEqual(summary["spots"]["srp_btn_bb"]["target"], 1755)

    def nuts_file(self, fp, flops) -> Path:
        d = self.tmp / "nuts"
        d.mkdir(exist_ok=True)
        (d / "srp_btn_bb.json").write_text(json.dumps({"format": 1, "nut_eq": 0.8, "fp": fp, "flops": flops}))
        return d

    def test_nut_shares_go_in_for_the_flops_listed_and_are_named_in_the_index(self):
        d = self.nuts_file(["a", "b"], {"Ks7d2c": [0.1, 0.2], "2h2d2c": [0.3, 0.4]})
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--nuts", d)
        self.assertEqual(r.returncode, 0, r.stderr)
        spots = {s["id"]: s for s in self.index()["spots"]}
        data = (self.out / "srp_btn_bb" / "nuts.json").read_bytes()
        self.assertEqual(spots["srp_btn_bb"]["nuts"], h(data, 10))
        self.assertEqual(json.loads(data)["flops"], {"Ks7d2c": [0.1, 0.2]})  # not a flop the index doesn't list
        self.assertNotIn("nuts", spots["srp_sb_bb_2max"])
        summary = json.loads((self.out / "lizard-library.json").read_text())
        self.assertEqual(summary["spots"]["srp_btn_bb"]["nuts"], 1)

    def test_nut_shares_for_other_ranges_are_left_out_and_the_publish_goes_on(self):
        d = self.nuts_file(["old", "ranges"], {"Ks7d2c": [0.1, 0.2]})
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--nuts", d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("nuts", {s["id"]: s for s in self.index()["spots"]}["srp_btn_bb"])
        self.assertFalse((self.out / "srp_btn_bb" / "nuts.json").exists())

    def test_a_spot_with_no_plan_gets_no_target(self):
        sys.path.insert(0, str(HERE))
        try:
            from assemble import planned_flops, target_of
        finally:
            sys.path.remove(str(HERE))
        plan = {"srp_sb_bb_2max": 552}
        self.assertIsNone(target_of("mw_new_spot", 185, plan))
        self.assertEqual(target_of("srp_sb_bb_2max", 378, plan), 552)
        self.assertEqual(target_of("srp_sb_bb_2max", 600, plan), 1755)  # extended past its plan to every flop
        real = planned_flops()  # the snapshot's SPOT_FLOPS, parsed from source, plus BUILD_PLANS
        self.assertEqual(len([k for k in real if not k.startswith("mw_")]), 20)
        self.assertEqual(target_of("srp_sb_bb_2max", 378, real), 1755)
        self.assertEqual(target_of("lp_sb_bb_2max", 168, real), 552)
        self.assertEqual(target_of("srp_hj_co", 552, real), 1755)  # BUILD_PLANS: build_srp_every_flop.py

    def test_a_corrupt_entry_or_turn_file_is_left_out(self):
        (self.hu / "srp_sb_bb_2max" / "Qc9d8h.bin").write_bytes(b"tampered")
        (self.hu / "srp_sb_bb_2max" / "Td6c3h.turn.bin").write_bytes(b"GTOTN1 not zlib")
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = next(s for s in self.index()["spots"] if s["id"] == "srp_sb_bb_2max")
        self.assertEqual(list(s["flops"]), ["Td6c3h"])
        self.assertNotIn("turns", s)  # its only turn file failed
        self.assertFalse((self.out / "srp_sb_bb_2max" / "Td6c3h.turn.bin").exists())

    def test_never_shrinks_below_the_previous_release(self):
        prev = self.tmp / "prev"
        self.assertEqual(run("--out", prev, "--base", self.base, "--hu", self.hu).returncode, 0)
        (self.hu / "srp_sb_bb_2max" / "report.json").write_text('{"changed": 1}')  # report no longer matches
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = next(s for s in self.index()["spots"] if s["id"] == "srp_sb_bb_2max")
        self.assertEqual(len(s["flops"]), 2)
        self.assertIn("kept the previous release", r.stdout)

    def test_an_unchanged_run_keeps_the_previous_summary_time(self):
        prev = self.tmp / "prev"
        self.assertEqual(run("--out", prev, "--base", self.base, "--hu", self.hu).returncode, 0)
        summary = json.loads((prev / "lizard-library.json").read_text())
        summary["assembledAt"] = "2000-01-01T00:00:00Z"
        (prev / "lizard-library.json").write_text(json.dumps(summary, indent=1))
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.out / "lizard-library.json").read_bytes(), (prev / "lizard-library.json").read_bytes())
        # a real change gets a new time
        hu2 = self.tmp / "hu2"
        make_lib(hu2, "srp_sb_bb_2max", ["c", "d"], {"Qc9d8h": b"hu-1", "Td6c3h": b"hu-2", "9c8d7h": b"hu-3"},
                 game={"players": 2, "stack": 100.0, "ante": 0.0, "straddle": False})
        out2 = self.tmp / "stage2"
        r = run("--out", out2, "--base", self.base, "--hu", hu2, "--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotEqual(json.loads((out2 / "lizard-library.json").read_text())["assembledAt"], "2000-01-01T00:00:00Z")

    def test_skips_a_source_on_another_tree(self):
        idx = json.loads((self.hu / "index.json").read_text())
        idx["tree"] = {"sizes": {"flop_bet": [0.5]}}
        (self.hu / "index.json").write_text(json.dumps(idx))
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([s["id"] for s in self.index()["spots"]], ["srp_btn_bb"])
        self.assertIn("tree differs", r.stdout)

    def test_refuses_to_write_into_a_source_or_a_foreign_directory(self):
        self.assertNotEqual(run("--out", self.hu / "x", "--base", self.base, "--hu", self.hu).returncode, 0)
        foreign = self.tmp / "foreign"
        foreign.mkdir()
        (foreign / "keep.txt").write_text("mine")
        self.assertNotEqual(run("--out", foreign, "--base", self.base, "--hu", self.hu).returncode, 0)
        self.assertTrue((foreign / "keep.txt").exists())
        self.assertNotEqual(run("--out", "/Users/mhan/Desktop/projects/gtosolver/.work/x", "--base", self.base,
                                "--hu", self.hu).returncode, 0)

    def test_sources_are_not_modified(self):
        before = {p: p.read_bytes() for p in self.hu.rglob("*") if p.is_file()}
        self.assertEqual(run("--out", self.out, "--base", self.base, "--hu", self.hu).returncode, 0)
        after = {p: p.read_bytes() for p in self.hu.rglob("*") if p.is_file()}
        self.assertEqual(before, after)


class ExtendTest(unittest.TestCase):
    """An extension source (build_srp_every_flop.py): base spots on more flops, the base's entries included."""

    BASE = {"Ks7d2c": b"entry-1", "AhKd5s": b"entry-2"}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base, self.hu, self.ext, self.out = (self.tmp / n for n in ("base", "hu", "ext", "stage"))
        other = make_lib(self.base, "srp_btn_bb", ["a", "b"], {"Qh8d4c": b"btn-1"})
        make_lib(self.base, "srp_hj_co", ["e", "f"], self.BASE, turns=False, old=self.BASE, spots=[other])
        make_lib(self.hu, "srp_sb_bb_2max", ["c", "d"], {"Qc9d8h": b"hu-1"},
                 game={"players": 2, "stack": 100.0, "ante": 0.0, "straddle": False})

    def make_ext(self, flops, fp=("e", "f"), sid="srp_hj_co", extra=None):
        return make_lib(self.ext, sid, list(fp), flops, turns=False, old=flops, extra=extra)

    def run_ext(self, *more):
        return run("--out", self.out, "--base", self.base, "--hu", self.hu, "--extend", self.ext, *more)

    def spot(self, sid="srp_hj_co") -> dict:
        return next(s for s in json.loads((self.out / "index.json").read_text())["spots"] if s["id"] == sid)

    def test_a_superset_replaces_the_base_spot_with_its_report_and_only_listed_files(self):
        self.make_ext({**self.BASE, "9c8d7h": b"new-1", "Jd5c2h": b"new-2"},
                      extra={"Tc6d3h.bin.tmp": b"partial", "8c7c6c.bin": b"unindexed"})
        r = self.run_ext()
        self.assertEqual(r.returncode, 0, r.stderr)
        s = self.spot()
        self.assertEqual(sorted(s["flops"]), sorted([*self.BASE, "9c8d7h", "Jd5c2h"]))
        self.assertEqual(sorted(s["old"]), sorted(s["flops"]))
        self.assertEqual((self.out / "srp_hj_co" / "report.json").read_bytes(),
                         (self.ext / "srp_hj_co" / "report.json").read_bytes())
        self.assertFalse((self.out / "srp_hj_co" / "8c7c6c.bin").exists())
        self.assertFalse((self.out / "srp_hj_co" / "Tc6d3h.bin.tmp").exists())
        self.assertEqual(len(self.spot("srp_btn_bb")["flops"]), 1)  # other base spots as they were
        summary = json.loads((self.out / "lizard-library.json").read_text())
        self.assertEqual(summary["spots"]["srp_hj_co"], {"flops": 4, "target": 1755, "game": None, "nuts": 0})
        self.assertIn({"kind": "extension build", "spots": {"srp_hj_co": 4}},
                      [{k: v for k, v in x.items() if k in ("kind", "spots")} for x in summary["sources"]])

    def test_a_source_missing_or_changing_a_base_flop_is_left_out(self):
        for flops in ({"Ks7d2c": b"entry-1", "9c8d7h": b"new-1", "Jd5c2h": b"new-2"},      # AhKd5s missing
                      {"Ks7d2c": b"entry-1", "AhKd5s": b"resolved", "9c8d7h": b"new-1"}):   # AhKd5s changed
            with self.subTest(flops=sorted(flops)):
                if self.ext.exists():
                    import shutil
                    shutil.rmtree(self.ext)
                self.make_ext(flops)
                r = self.run_ext()
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(self.spot()["flops"], {f: h(b, 10) for f, b in self.BASE.items()})
                self.assertIn("srp_hj_co: extension left out", r.stdout)
                self.assertEqual((self.out / "srp_hj_co" / "report.json").read_bytes(),
                                 (self.base / "srp_hj_co" / "report.json").read_bytes())

    def test_other_ranges_a_new_spot_or_no_more_flops_are_left_out(self):
        for kw, note in (({"fp": ("x", "y")}, "another spot"), ({"sid": "srp_new"}, "not a base spot"),
                         ({}, "no flops beyond")):
            with self.subTest(note=note):
                if self.ext.exists():
                    import shutil
                    shutil.rmtree(self.ext)
                self.make_ext({**self.BASE, **({"9c8d7h": b"new-1"} if kw else {})}, **kw)
                r = self.run_ext()
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(len(self.spot()["flops"]), 2)
                self.assertIn(note, r.stdout)
                self.assertFalse((self.out / "srp_new").exists())

    def test_a_copy_that_fails_its_hashes_falls_back_to_the_base(self):
        self.make_ext({**self.BASE, "9c8d7h": b"new-1"})
        (self.ext / "srp_hj_co" / "9c8d7h.bin").write_bytes(b"tampered")       # the only new flop fails its hash
        r = self.run_ext()
        self.assertEqual(r.returncode, 0, r.stderr)                          # (the stage's file check passed too)
        self.assertEqual(sorted(self.spot()["flops"]), sorted(self.BASE))
        self.assertIn("after copying", r.stdout)
        self.assertFalse((self.out / "srp_hj_co" / "9c8d7h.bin").exists())
        # a report rewritten since the index: the base too
        import shutil
        shutil.rmtree(self.ext)
        self.make_ext({**self.BASE, "9c8d7h": b"new-1"})
        (self.ext / "srp_hj_co" / "report.json").write_text('{"newer": 1}')
        r = self.run_ext()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sorted(self.spot()["flops"]), sorted(self.BASE))

    def test_an_extension_once_published_is_kept_when_the_source_goes(self):
        prev = self.tmp / "prev"
        self.make_ext({**self.BASE, "9c8d7h": b"new-1"})
        self.assertEqual(run("--out", prev, "--base", self.base, "--hu", self.hu, "--extend", self.ext).returncode, 0)
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--previous", prev)  # no source now
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.spot()["flops"]), 3)
        self.assertIn("kept the previous release", r.stdout)

    def test_the_extension_source_is_not_modified(self):
        self.make_ext({**self.BASE, "9c8d7h": b"new-1"})
        before = {p: p.read_bytes() for p in self.ext.rglob("*") if p.is_file()}
        self.assertEqual(self.run_ext().returncode, 0)
        self.assertEqual(before, {p: p.read_bytes() for p in self.ext.rglob("*") if p.is_file()})
        self.assertNotEqual(run("--out", self.ext / "x", "--base", self.base, "--hu", self.hu,
                                "--extend", self.ext).returncode, 0)


if __name__ == "__main__":
    unittest.main()
