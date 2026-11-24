"""Tests for assemble.py on tiny synthetic libraries (no solver import, no real data).

Run: .venv/bin/python -m unittest discover -s scripts/library
"""
import hashlib
import json
import re
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
NO_MW = "/nonexistent/lizard-mw"  # (and so is the default 3-way source)


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


NO_FORMATS = Path(tempfile.mkdtemp()) / "none"  # (never the real library-build/sources/depths)
G40 = {"players": 6, "stack": 40.0, "ante": 0.0, "straddle": False}


MW_TREE = {"bet": {"flop": [0.33, 0.75]}, "version": 1}
MW_NAMES = ["check", "bet 33%", "bet 75%"]


def mw_entry(flop: str, tag: float = 0.5) -> bytes:
    """A 3-way entry as gto/flop_library.pack frames it: GTOFL3, then zlib(u32 header length, header, body)."""
    nodes = [{"path": p, "player": i, "names": MW_NAMES, "fold0": False, "freqs": [tag, 1 - tag, 0.0], "combos": 9.0}
             for i, p in enumerate([[], ["check"], ["check", "check"]])]
    hb = json.dumps({"board": flop, "format": 2, "players": 3, "nodes": nodes}).encode()
    return b"GTOFL3" + zlib.compress(struct.pack("<I", len(hb)) + hb + b"\1" * 32)


def make_mw(root: Path, spots: dict, tree=None, fp=None) -> dict:
    """A 3-way library (mw_index.json, format 1): `spots` maps id -> {flop: entry bytes (None: listed, missing)}."""
    idx = {"format": 1, "tree": tree or MW_TREE, "spots": []}
    for sid, flops in spots.items():
        listed = {}
        for f, b in flops.items():
            if b is None:
                listed[f] = "0" * 10
                continue
            (root / sid).mkdir(parents=True, exist_ok=True)
            (root / sid / f"{f}.bin").write_bytes(b)
            listed[f] = h(b, 10)
        idx["spots"].append({"id": sid, "label": sid, "line": "BTN:r2.5,SB:c,BB:c", "seats": ["SB", "BB", "BTN"],
                             "fp": fp or ["x", "y", "z"], "pot": 7.5, "stack": 97.5, "flops": listed})
    root.mkdir(parents=True, exist_ok=True)
    (root / "mw_index.json").write_text(json.dumps(idx))
    return idx


NO_BREADTH = Path(tempfile.gettempdir()) / "assemble-test-no-breadth"  # (never created: no breadth source)
NO_SS = Path(tempfile.gettempdir()) / "assemble-test-no-single-size"  # (nor the single-size library's)
NO_SS_GAMES = Path(tempfile.gettempdir()) / "assemble-test-no-ss-games"  # (nor its ante and straddle games')


def run(*args) -> subprocess.CompletedProcess:
    if "--extend" not in args:
        args = (*args, "--extend", NO_EXT)
    if "--mw" not in args:
        args = (*args, "--mw", NO_MW)
    if "--formats" not in args:
        args = (*args, "--formats", NO_FORMATS)
    if "--breadth" not in args:
        args = (*args, "--breadth", NO_BREADTH)
    if "--single-size" not in args:
        args = (*args, "--single-size", NO_SS)
    if "--ss-games" not in args:
        args = (*args, "--ss-games", NO_SS_GAMES)
    return subprocess.run([sys.executable, str(HERE / "assemble.py"), *map(str, args)], capture_output=True, text=True)


def add_spot(root: Path, sid: str, fp: list, flops: dict, pot=6.0, turns=True) -> dict:
    """One more spot in root's library (make_lib's, keeping the spots already in its index)."""
    idx = json.loads((root / "index.json").read_text()) if (root / "index.json").exists() else None
    spot = make_lib(root, sid, fp, flops, turns=turns)
    spot["pot"] = pot
    spots = (idx["spots"] if idx else []) + [spot]
    (root / "index.json").write_text(json.dumps({"format": 2, "tree": TREE, "spots": spots}))
    return spot


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
        self.assertEqual(len([k for k in real if not k.startswith("mw_") and not re.search(r"_\d+bb$", k)]), 20)
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

    def test_a_depth_build_is_taken_hash_checked_with_its_game(self):
        depths = self.tmp / "depths"
        make_lib(depths, "srp_btn_bb_40bb", ["e", "f"], {"Ks7d2c": b"d40-1", "AhKd5s": b"d40-2", "Qc9d8h": b"d40-3"},
                 game=G40, extra={"Td6c3h.bin": b"solved after the index"})
        (depths / "srp_btn_bb_40bb" / "Qc9d8h.bin").write_bytes(b"tampered")
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--formats", depths)
        self.assertEqual(r.returncode, 0, r.stderr)
        spots = {s["id"]: s for s in self.index()["spots"]}
        s = spots["srp_btn_bb_40bb"]
        self.assertEqual(s["game"], G40)
        self.assertEqual(sorted(s["flops"]), ["AhKd5s", "Ks7d2c"])  # the tampered one left out
        self.assertFalse((self.out / "srp_btn_bb_40bb" / "Td6c3h.bin").exists())  # not in the index
        self.assertEqual(s["fp"], ["e", "f"])
        self.assertEqual(set(spots), {"srp_btn_bb", "srp_sb_bb_2max", "srp_btn_bb_40bb"})
        summary = json.loads((self.out / "lizard-library.json").read_text())
        self.assertEqual(summary["spots"]["srp_btn_bb_40bb"], {"flops": 2, "target": 184, "game": G40, "nuts": 0})
        self.assertEqual([x["kind"] for x in summary["sources"]], ["base", "heads-up build", "format build"])
        self.assertIn("srp_btn_bb_40bb", r.stdout)
        self.assertIn("6-max 40bb", r.stdout)

    def test_a_depth_build_never_replaces_another_sources_spot_or_the_default_games(self):
        depths = self.tmp / "depths"
        make_lib(depths, "srp_btn_bb", ["a", "b"], {"Ks7d2c": b"other-1", "AhKd5s": b"other-2", "2h2d2c": b"x"})
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--formats", depths)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = next(s for s in self.index()["spots"] if s["id"] == "srp_btn_bb")
        self.assertEqual(sorted(s["flops"]), ["AhKd5s", "Ks7d2c"])
        self.assertEqual((self.out / "srp_btn_bb" / "Ks7d2c.bin").read_bytes(), b"entry-1")
        self.assertIn("not another game's spot of its own", r.stdout)

    def test_a_depth_spot_never_shrinks_below_the_previous_release(self):
        depths, prev = self.tmp / "depths", self.tmp / "prev"
        make_lib(depths, "3bp_bb_btn_40bb", ["g", "h"], {"Ks7d2c": b"3b-1", "AhKd5s": b"3b-2"}, game=G40)
        self.assertEqual(run("--out", prev, "--base", self.base, "--hu", self.hu, "--formats", depths).returncode, 0)
        (depths / "3bp_bb_btn_40bb" / "AhKd5s.bin").unlink()  # (a rebuild under way)
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--formats", depths, "--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = next(s for s in self.index()["spots"] if s["id"] == "3bp_bb_btn_40bb")
        self.assertEqual(sorted(s["flops"]), ["AhKd5s", "Ks7d2c"])
        self.assertEqual(s["game"], G40)
        self.assertIn("3bp_bb_btn_40bb: kept the previous release", r.stdout)

    def test_the_depth_builds_are_a_default_source_with_planned_targets(self):
        sys.path.insert(0, str(HERE))
        try:
            import assemble
            from depths_build import BATCHES
        finally:
            sys.path.remove(str(HERE))
        self.assertIn(assemble.SOURCES / "depths", assemble.FORMAT_SOURCES)
        plan = assemble.planned_flops()
        for b in BATCHES:
            for sid in b.spots:
                self.assertEqual(plan[sid], b.flops)
                self.assertEqual(assemble.target_of(sid, 3, plan), b.flops)
        self.assertEqual(plan["srp_btn_bb"], 1755)  # the default game's still from SPOT_FLOPS

    def test_sources_are_not_modified(self):
        before = {p: p.read_bytes() for p in self.hu.rglob("*") if p.is_file()}
        self.assertEqual(run("--out", self.out, "--base", self.base, "--hu", self.hu).returncode, 0)
        after = {p: p.read_bytes() for p in self.hu.rglob("*") if p.is_file()}
        self.assertEqual(before, after)


    # ------------------------------------------------------------------ breadth sources (build_breadth.py)
    def breadth(self) -> Path:
        b = self.tmp / "breadth"
        add_spot(b, "4bp_hj_co", ["e", "f"], {"Ks7d2c": b"4b-1", "Qh8d3c": b"4b-2"}, pot=36.0)
        add_spot(b, "srp_btn_bb_8max", ["g", "h"], {"Ks7d2c": b"8m-1"}, pot=5.5, turns=False)
        (b / "plan.json").write_text(json.dumps({"spots": {"4bp_hj_co": 552, "srp_btn_bb_8max": 552}}))
        return b

    def test_breadth_spots_go_in_with_their_plan(self):
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--breadth", self.breadth())
        self.assertEqual(r.returncode, 0, r.stderr)
        spots = {s["id"]: s for s in self.index()["spots"]}
        self.assertEqual(sorted(spots["4bp_hj_co"]["flops"]), ["Ks7d2c", "Qh8d3c"])
        self.assertIs(spots["4bp_hj_co"]["turns"], True)
        self.assertNotIn("turns", spots["srp_btn_bb_8max"])
        self.assertTrue((self.out / "4bp_hj_co" / "Qh8d3c.turn.bin").exists())
        summary = json.loads((self.out / "lizard-library.json").read_text())
        self.assertEqual(summary["spots"]["4bp_hj_co"]["target"], 552)
        self.assertEqual(next(x for x in summary["sources"] if x["kind"] == "breadth build")["spots"],
                         {"4bp_hj_co": 2, "srp_btn_bb_8max": 1})

    def test_a_breadth_spot_another_source_holds_is_left_to_it(self):
        b = self.breadth()
        add_spot(b, "srp_btn_bb_copy", ["a", "b"], {"Ks7d2c": b"other", "2c2d2h": b"more", "3c3d3h": b"x"})
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--breadth", b)
        self.assertEqual(r.returncode, 0, r.stderr)
        ids = [s["id"] for s in self.index()["spots"]]
        self.assertNotIn("srp_btn_bb_copy", ids)
        self.assertIn("srp_btn_bb holds these ranges", r.stdout)

    def test_breadth_spots_stop_short_of_the_file_cap(self):
        sys.path.insert(0, str(HERE))
        try:
            import assemble
        finally:
            sys.path.remove(str(HERE))
        self.out.mkdir()
        for i in range(5):
            (self.out / f"f{i}").write_text("x")
        old = assemble.MAX_FILES
        try:  # 5 files staged + 6 for 4bp_hj_co (2 entries, 2 turn files, report, ranges) fit; the 8-max spot's 3 don't
            assemble.MAX_FILES = 5 + 6 + assemble.BREADTH_RESERVE + 2
            log = []
            merged, summary = assemble.add_breadth(self.breadth(), self.out, [], TREE, log)
        finally:
            assemble.MAX_FILES = old
        self.assertEqual([s["id"] for s in merged], ["4bp_hj_co"])
        self.assertEqual(summary["spots"], {"4bp_hj_co": 2})
        self.assertTrue(any("srp_btn_bb_8max: left out" in x and "file cap" in x for x in log), log)
        self.assertFalse((self.out / "srp_btn_bb_8max").exists())

    def test_a_breadth_spot_grows_over_its_previous_release_and_never_shrinks(self):
        prev = self.tmp / "prev"
        b = self.breadth()
        self.assertEqual(run("--out", prev, "--base", self.base, "--hu", self.hu, "--breadth", b).returncode, 0)
        b2 = self.tmp / "breadth2"
        add_spot(b2, "4bp_hj_co", ["e", "f"], {"Ks7d2c": b"4b-1", "Qh8d3c": b"4b-2", "9c5d2h": b"4b-3"}, pot=36.0)
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--breadth", b2, "--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        spots = {s["id"]: s for s in self.index()["spots"]}
        self.assertEqual(len(spots["4bp_hj_co"]["flops"]), 3)
        self.assertEqual(len(spots["srp_btn_bb_8max"]["flops"]), 1)  # gone from the source: kept from the release
        self.assertFalse(any(p.name.endswith(".held") for p in self.out.iterdir()))
        # a breadth copy that fails validation keeps the previous release's
        out3 = self.tmp / "stage3"
        (b2 / "4bp_hj_co" / "9c5d2h.bin").write_bytes(b"tampered")
        (b2 / "4bp_hj_co" / "Qh8d3c.bin").write_bytes(b"tampered")
        r = run("--out", out3, "--base", self.base, "--hu", self.hu, "--breadth", b2, "--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = next(s for s in json.loads((out3 / "index.json").read_text())["spots"] if s["id"] == "4bp_hj_co")
        self.assertEqual(sorted(s["flops"]), ["Ks7d2c", "Qh8d3c"])
        self.assertEqual((out3 / "4bp_hj_co" / "Qh8d3c.bin").read_bytes(), b"4b-2")


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

class MultiwayTest(unittest.TestCase):
    """The 3-way spots: the base's mw_index.json plus a 3-way build's finished flops (--mw)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base, self.hu, self.mw, self.out = (self.tmp / n for n in ("base", "hu", "mw", "stage"))
        make_lib(self.base, "srp_btn_bb", ["a", "b"], {"Ks7d2c": b"entry-1"})
        make_mw(self.base, {"mw_btn_sb_bb": {"Kc7d2h": mw_entry("Kc7d2h"), "4c3c2c": mw_entry("4c3c2c")},
                            "mw_co_btn_bb": {"Kc7d2h": mw_entry("Kc7d2h")}})
        self.hu.mkdir()

    def stage(self, *extra) -> subprocess.CompletedProcess:
        return run("--out", self.out, "--base", self.base, "--hu", self.hu, "--mw", self.mw, *extra)

    def mw_index(self, root=None) -> dict:
        return {s["id"]: s for s in json.loads(((root or self.out) / "mw_index.json").read_text())["spots"]}

    def test_a_builds_finished_flops_join_the_published_spot_checked_by_hash(self):
        make_mw(self.mw, {"mw_btn_sb_bb": {"Kc7d2h": mw_entry("Kc7d2h", 0.9), "9c8d7h": mw_entry("9c8d7h", 0.2),
                                           "Qc9d8h": mw_entry("Qc9d8h"), "Td6c3h": None}})
        (self.mw / "mw_btn_sb_bb" / "Qc9d8h.bin").write_bytes(b"tampered")
        (self.mw / "mw_btn_sb_bb" / "Jc5d2h.bin.tmp").write_bytes(b"partial")
        (self.mw / "mw_btn_sb_bb" / "8c7c6c.bin").write_bytes(mw_entry("8c7c6c"))  # not in its index yet
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        spots = self.mw_index()
        btn = spots["mw_btn_sb_bb"]
        self.assertEqual(sorted(btn["flops"]), ["4c3c2c", "9c8d7h", "Kc7d2h"])
        self.assertEqual(btn["flops"]["Kc7d2h"], h(mw_entry("Kc7d2h"), 10))  # the base's entry wins a flop both hold
        self.assertEqual((self.out / "mw_btn_sb_bb" / "Kc7d2h.bin").read_bytes(), mw_entry("Kc7d2h"))
        for f in ("Qc9d8h", "Td6c3h", "8c7c6c", "Jc5d2h"):
            self.assertFalse(any((self.out / "mw_btn_sb_bb").glob(f + "*")), f)
        self.assertEqual(len(spots["mw_co_btn_bb"]["flops"]), 1)
        summary = json.loads((self.out / "lizard-library.json").read_text())
        self.assertEqual(summary["multiway"], {"mw_btn_sb_bb": 3, "mw_co_btn_bb": 1})
        self.assertEqual(summary["multiwayTargets"], {"mw_btn_sb_bb": 1755, "mw_co_btn_bb": 1755})
        src = next(x for x in summary["sources"] if x["kind"] == "3-way build")
        self.assertEqual(src["spots"], {"mw_btn_sb_bb": 1})
        self.assertIn("2 3-way flop(s)", r.stdout)

    def test_each_spot_gets_its_entries_mixes_in_one_file_named_by_hash(self):
        make_mw(self.mw, {"mw_btn_sb_bb": {"9c8d7h": mw_entry("9c8d7h", 0.2)}})
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        btn = self.mw_index()["mw_btn_sb_bb"]
        data = (self.out / "mw_btn_sb_bb" / "heads.json").read_bytes()
        self.assertEqual(btn["heads"], h(data, 10))
        heads = json.loads(data)
        self.assertEqual(heads["format"], 1)
        self.assertEqual(heads["nodes"], {"": MW_NAMES, "check": MW_NAMES, "check|check": MW_NAMES})
        self.assertEqual(sorted(heads["flops"]), sorted(btn["flops"]))
        self.assertEqual(heads["flops"]["9c8d7h"]["check"], [0.2, 0.8, 0.0])

    def test_a_header_that_wont_read_means_no_heads_file_not_a_failed_publish(self):
        make_mw(self.mw, {"mw_btn_sb_bb": {"9c8d7h": b"GTOFL3 not zlib"}})
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        btn = self.mw_index()["mw_btn_sb_bb"]
        self.assertNotIn("heads", btn)
        self.assertFalse((self.out / "mw_btn_sb_bb" / "heads.json").exists())
        self.assertIn("no heads.json", r.stdout)
        self.assertTrue(self.mw_index()["mw_co_btn_bb"].get("heads"))

    def test_a_source_on_another_tree_or_game_or_spot_is_left_out(self):
        for kw, note in (({"tree": {"bet": {"flop": [0.5]}, "version": 1}}, "tree differs"),
                         ({"fp": ["x", "y", "other"]}, "other ranges"),):
            mw = self.tmp / f"mw-{note[:5]}"
            make_mw(mw, {"mw_btn_sb_bb": {"9c8d7h": mw_entry("9c8d7h")}}, **kw)
            r = run("--out", self.out, "--base", self.base, "--hu", self.hu, "--mw", mw)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(len(self.mw_index()["mw_btn_sb_bb"]["flops"]), 2)
            self.assertIn(note, r.stdout)
        make_mw(self.mw, {"mw_new_spot": {"9c8d7h": mw_entry("9c8d7h")}})
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("mw_new_spot", self.mw_index())
        self.assertFalse((self.out / "mw_new_spot").exists())

    def test_a_complete_rebuild_on_new_ranges_replaces_the_spot_whole(self):
        """The charts moved under a spot (b10afc8): its rebuild on today's ranges replaces it once it holds every flop
        the published spot does, entries, fingerprints and all; a partial one, or one failing a hash, is left out."""
        base_bytes = (self.base / "mw_btn_sb_bb" / "Kc7d2h.bin").read_bytes()
        new_fp = ["x", "y2", "z"]
        rb = self.tmp / "rebuild"
        make_mw(rb, {"mw_btn_sb_bb": {"Kc7d2h": mw_entry("Kc7d2h", 0.7)}}, fp=new_fp)   # partial: 4c3c2c to go
        r = self.stage("--mw", rb)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.mw_index()["mw_btn_sb_bb"]["fp"], ["x", "y", "z"])
        self.assertIn("1 to go", r.stdout)
        flops = {"Kc7d2h": mw_entry("Kc7d2h", 0.7), "4c3c2c": mw_entry("4c3c2c", 0.6), "9c8d7h": mw_entry("9c8d7h")}
        make_mw(rb, {"mw_btn_sb_bb": flops}, fp=new_fp)
        (rb / "mw_btn_sb_bb" / "9c8d7h.bin").write_bytes(b"tampered")
        r = self.stage("--mw", rb)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.mw_index()["mw_btn_sb_bb"]["fp"], ["x", "y", "z"])
        self.assertIn("the published spot kept", r.stdout)
        (rb / "mw_btn_sb_bb" / "9c8d7h.bin").write_bytes(mw_entry("9c8d7h"))
        r = self.stage("--mw", rb)
        self.assertEqual(r.returncode, 0, r.stderr)
        btn = self.mw_index()["mw_btn_sb_bb"]
        self.assertEqual(btn["fp"], new_fp)
        self.assertEqual(btn["flops"], {f: h(b, 10) for f, b in sorted(flops.items())})
        for f, b in flops.items():
            self.assertEqual((self.out / "mw_btn_sb_bb" / f"{f}.bin").read_bytes(), b)
        self.assertEqual(sorted(p.name for p in (self.out / "mw_btn_sb_bb").glob("*.bin")),
                         sorted(f"{f}.bin" for f in flops))
        self.assertIn("replaced by the rebuild", r.stdout)
        # the base's files (hard-linked into the stage) are untouched
        self.assertEqual((self.base / "mw_btn_sb_bb" / "Kc7d2h.bin").read_bytes(), base_bytes)
        self.assertEqual(len(self.mw_index()["mw_co_btn_bb"]["flops"]), 1)
        self.assertFalse(any(p.name.startswith(".") for p in self.out.iterdir() if p.name != ".nojekyll"
                             and p.name != ".lizard-stage"))

    def test_a_spot_never_shrinks_below_the_previous_release(self):
        make_mw(self.mw, {"mw_btn_sb_bb": {"9c8d7h": mw_entry("9c8d7h"), "Qc9d8h": mw_entry("Qc9d8h")}})
        prev = self.tmp / "prev"
        self.assertEqual(run("--out", prev, "--base", self.base, "--hu", self.hu, "--mw", self.mw).returncode, 0)
        self.assertEqual(len(self.mw_index(prev)["mw_btn_sb_bb"]["flops"]), 4)
        (self.mw / "mw_index.json").unlink()  # the build's output gone
        r = self.stage("--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        btn = self.mw_index()["mw_btn_sb_bb"]
        self.assertEqual(len(btn["flops"]), 4)
        self.assertIn("mw_btn_sb_bb: kept the previous release (4 flops)", r.stdout)
        self.assertEqual(btn["heads"], self.mw_index(prev)["mw_btn_sb_bb"]["heads"])
        r = self.stage("--previous", prev, "--allow-shrink")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.mw_index()["mw_btn_sb_bb"]["flops"]), 2)

    def test_the_source_is_not_modified_and_an_unchanged_run_keeps_the_summary_time(self):
        make_mw(self.mw, {"mw_btn_sb_bb": {"9c8d7h": mw_entry("9c8d7h")}})
        before = {p: p.read_bytes() for p in self.mw.rglob("*") if p.is_file()}
        prev = self.tmp / "prev"
        self.assertEqual(run("--out", prev, "--base", self.base, "--hu", self.hu, "--mw", self.mw).returncode, 0)
        self.assertEqual(before, {p: p.read_bytes() for p in self.mw.rglob("*") if p.is_file()})
        r = self.stage("--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.out / "lizard-library.json").read_bytes(), (prev / "lizard-library.json").read_bytes())
        self.assertNotEqual(run("--out", self.mw / "x", "--base", self.base, "--hu", self.hu, "--mw", self.mw).returncode, 0)

    def test_the_build_order_spreads_each_group_of_flops(self):
        sys.path.insert(0, str(HERE))
        try:
            from build_mw_every_flop import spread
        finally:
            sys.path.remove(str(HERE))
        self.assertEqual(sorted(spread(1203)), list(range(1203)))
        self.assertEqual(spread(8), [0, 4, 2, 6, 1, 5, 3, 7])
        first = spread(1000)[:10]  # an early stop leaves an even sample, not one corner
        self.assertTrue(max(first) > 800 and min(first) < 100)


def make_ss(root: Path, spots: dict, order=None, target=552) -> dict:
    """A single-size build (build_single_size.py's ss-index.json): `spots` maps id -> {flop: (entry bytes, size %)};
    each flop's tree keyed by its size, a turn file with every entry, a report row per flop."""
    idx = {"format": 2, "ss_format": 1, "spots": []}
    for sid, flops in spots.items():
        d = root / sid
        d.mkdir(parents=True, exist_ok=True)
        listed, sizes, trees, ft = {}, {}, {}, {}
        for f, (b, pct) in flops.items():
            (d / f"{f}.bin").write_bytes(b)
            (d / f"{f}.turn.bin").write_bytes(turn_file(b))
            listed[f], sizes[f], ft[f] = h(b, 10), pct, f"b{pct:g}"
            trees[f"b{pct:g}"] = {"sizes": {"flop_bet": [pct / 100]}, "model": {"version": 1}}
        report = json.dumps({"id": sid, "flops": [{"f": f, "w": 10.0} for f in flops], "single_size": True}).encode()
        (d / "report.json").write_bytes(report)
        (d / "ranges.json").write_text("{}")
        idx["spots"].append({"id": sid, "base": sid[3:], "label": sid, "line": "BTN:r2.5,BB:c", "seats": ["BB", "BTN"],
                             "fp": [sid, "x"], "pot": 5.5, "stack": 97.5, "flops": listed, "sizes": sizes,
                             "trees": trees, "flop_tree": ft, "turns": True, "report": h(report, 10),
                             "single_size": True})
    root.mkdir(parents=True, exist_ok=True)
    (root / "ss-index.json").write_text(json.dumps(idx))
    (root / "plan.json").write_text(json.dumps({"spots": {sid: target for sid in spots}, "phases": [184, target],
                                                "flops": order or []}))
    return idx


class SingleSizeTest(unittest.TestCase):
    """The single-size library (--single-size): its own ss_index.json, every spot on the same flops."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base, self.hu, self.ss, self.out = (self.tmp / n for n in ("base", "hu", "ss", "stage"))
        make_lib(self.base, "srp_btn_bb", ["a", "b"], {"Ks7d2c": b"entry-1"})
        self.hu.mkdir()
        # 10 spots: Kc7d2h and 8c7c6c on all of them, Ah9d4c on 9 (90%: in), 5c4d2h on 1 (out)
        spots = {f"ss_srp_{i}": {"Kc7d2h": (b"k%d" % i, 25.0), "8c7c6c": (b"e%d" % i, 75.0)} for i in range(10)}
        for i in range(9):
            spots[f"ss_srp_{i}"]["Ah9d4c"] = (b"a%d" % i, 33.0)
        spots["ss_srp_0"]["5c4d2h"] = (b"5-0", 50.0)
        make_ss(self.ss, spots, order=["8c7c6c", "Kc7d2h", "Ah9d4c", "5c4d2h"])

    def stage(self, *extra, out=None) -> subprocess.CompletedProcess:
        return run("--out", out or self.out, "--base", self.base, "--hu", self.hu, "--single-size", self.ss, *extra)

    def ss_index(self, root=None) -> dict:
        return json.loads(((root or self.out) / "ss_index.json").read_text())

    def index(self) -> dict:
        return json.loads((self.out / "index.json").read_text())

    def test_every_spot_goes_in_on_the_flops_most_spots_hold(self):
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        idx = self.ss_index()
        spots = {s["id"]: s for s in idx["spots"]}
        self.assertEqual(len(spots), 10)
        self.assertEqual(sorted(spots["ss_srp_0"]["flops"]), ["8c7c6c", "Ah9d4c", "Kc7d2h"])  # (5c4d2h: 1 of 10)
        self.assertEqual(sorted(spots["ss_srp_9"]["flops"]), ["8c7c6c", "Kc7d2h"])
        self.assertEqual(idx["flops"], ["8c7c6c", "Kc7d2h"])  # (the flops every spot holds, in the build's order)
        self.assertEqual(spots["ss_srp_0"]["sizes"], {"8c7c6c": 75.0, "Kc7d2h": 25.0, "Ah9d4c": 33.0})
        self.assertEqual(set(spots["ss_srp_0"]["trees"]), {"b25", "b75", "b33"})
        self.assertFalse((self.out / "ss_srp_0" / "5c4d2h.bin").exists())
        self.assertTrue((self.out / "ss_srp_0" / "Ah9d4c.turn.bin").exists())
        # the report is cut to the staged flops, its weights rescaled, its hash in the index
        rb = (self.out / "ss_srp_0" / "report.json").read_bytes()
        self.assertEqual(spots["ss_srp_0"]["report"], h(rb, 10))
        rows = json.loads(rb)["flops"]
        self.assertEqual(sorted(x["f"] for x in rows), ["8c7c6c", "Ah9d4c", "Kc7d2h"])
        self.assertAlmostEqual(sum(x["w"] for x in rows), 40.0, places=2)
        self.assertNotIn("ss_srp_0", [s["id"] for s in self.index()["spots"]])  # (not in index.json)
        summary = json.loads((self.out / "lizard-library.json").read_text())
        self.assertEqual(summary["singleSize"]["spots"]["ss_srp_0"], 3)
        self.assertEqual(summary["singleSize"]["target"], 552)
        self.assertEqual(summary["singleSize"]["flops"], ["8c7c6c", "Kc7d2h"])

    def test_no_build_means_no_ss_index(self):
        r = run("--out", self.out, "--base", self.base, "--hu", self.hu)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse((self.out / "ss_index.json").exists())
        self.assertNotIn("singleSize", json.loads((self.out / "lizard-library.json").read_text()))

    def test_a_non_single_size_id_is_left_out(self):
        idx = json.loads((self.ss / "ss-index.json").read_text())
        idx["spots"][1]["id"] = "srp_btn_bb"
        (self.ss / "ss-index.json").write_text(json.dumps(idx))
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("srp_btn_bb", [s["id"] for s in self.ss_index()["spots"]])
        self.assertIn("not a single-size id", r.stdout)

    def test_flops_stop_at_the_byte_budget_in_the_build_order(self):
        sys.path.insert(0, str(HERE))
        try:
            import assemble
        finally:
            sys.path.remove(str(HERE))
        self.out.mkdir()
        old = assemble.SS_BYTES
        try:  # the reports, ranges and one flop's entries and turn files fit, not two
            per_flop = sum(p.stat().st_size for p in self.ss.glob("*/8c7c6c*.bin"))
            fixed = sum(p.stat().st_size for p in self.ss.glob("*/*.json"))
            assemble.SS_BYTES = fixed + per_flop + 10
            log = []
            idx, summary = assemble.add_single_size(self.ss, self.out, set(), None, False, 0, log)
        finally:
            assemble.SS_BYTES = old
        self.assertEqual(sorted(idx["spots"][0]["flops"]), ["8c7c6c"])
        self.assertEqual(idx["flops"], ["8c7c6c"])
        self.assertTrue(any("1 of 3 complete flops fit" in x for x in log), log)

    def test_a_spot_never_shrinks_below_the_previous_release(self):
        prev = self.tmp / "prev"
        self.assertEqual(self.stage(out=prev).returncode, 0)
        idx = json.loads((self.ss / "ss-index.json").read_text())
        for s in idx["spots"]:  # (a rebuilt source lost a flop)
            s["flops"].pop("Ah9d4c", None)
            (self.ss / s["id"] / "Ah9d4c.bin").unlink(missing_ok=True)
        (self.ss / "ss-index.json").write_text(json.dumps(idx))
        r = self.stage("--previous", prev)
        self.assertEqual(r.returncode, 0, r.stderr)
        spots = {s["id"]: s for s in self.ss_index()["spots"]}
        self.assertEqual(sorted(spots["ss_srp_3"]["flops"]), ["8c7c6c", "Ah9d4c", "Kc7d2h"])
        self.assertIn("ss_srp_3: kept the previous release", r.stdout)
        self.assertEqual(spots["ss_srp_3"]["report"], h((self.out / "ss_srp_3" / "report.json").read_bytes(), 10))

    def test_a_kept_copy_that_would_pass_the_file_cap_stops_the_publish(self):
        sys.path.insert(0, str(HERE))
        try:
            import assemble
        finally:
            sys.path.remove(str(HERE))
        prev = self.tmp / "prev"
        self.assertEqual(self.stage(out=prev).returncode, 0)
        self.out.mkdir()
        old = assemble.MAX_FILES
        try:  # the stage nearly full: no flop fits, and the previous release's copies don't either
            assemble.MAX_FILES = 1000 + assemble.LATE_FILES + 4
            with self.assertRaises(SystemExit) as cm:
                assemble.add_single_size(self.ss, self.out, set(), prev, False, 1000, [])
        finally:
            assemble.MAX_FILES = old
        self.assertIn("would pass the", str(cm.exception))

    def test_the_source_is_not_modified(self):
        before = {p: p.read_bytes() for p in self.ss.rglob("*") if p.is_file()}
        self.assertEqual(self.stage().returncode, 0)
        self.assertEqual(before, {p: p.read_bytes() for p in self.ss.rglob("*") if p.is_file()})


class SingleSizeGamesTest(unittest.TestCase):
    """The single-size ante and straddle games (--ss-games, build_single_size.py --set games): their spots go into the
    same ss_index.json beside the 100bb ones, on their own flops, the 100bb spots' `flops` left theirs."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.base, self.hu, self.ss, self.games, self.out = (
            self.tmp / n for n in ("base", "hu", "ss", "games", "stage"))
        make_lib(self.base, "srp_btn_bb", ["a", "b"], {"Ks7d2c": b"entry-1"})
        self.hu.mkdir()
        make_ss(self.ss, {"ss_srp_btn_bb": {"Kc7d2h": (b"k", 25.0), "8c7c6c": (b"e", 75.0)}},
                order=["8c7c6c", "Kc7d2h"])
        g = {"ss_srp_btn_bb_ante": {"5c4d2h": (b"a5", 33.0), "6c5d2h": (b"a6", 25.0)},
             "ss_srp_co_bb_ante": {"5c4d2h": (b"c5", 33.0), "6c5d2h": (b"c6", 33.0)},
             "ss_srp_btn_utg_straddle": {"5c4d2h": (b"s5", 33.0)}}
        idx = make_ss(self.games, g, order=["5c4d2h", "6c5d2h"], target=1755)
        for s in idx["spots"]:
            s.pop("base")
            straddle = s["id"].endswith("straddle")
            s["game"] = {"players": 6, "stack": 100.0, "ante": 0.0 if straddle else 0.17, "straddle": straddle}
            s["pf"] = {"key": "lz4_6max_100bb_s_ch" if straddle else "lz4_6max_100bb_a0.17_ch", "sha1": "x",
                       "model": "m", "words": "w"}
            s["pf_ranges"] = [[1] * 169, [1] * 169]
        (self.games / "ss-index.json").write_text(json.dumps(idx))

    def stage(self, *extra) -> subprocess.CompletedProcess:
        return run("--out", self.out, "--base", self.base, "--hu", self.hu, "--single-size", self.ss,
                   "--ss-games", self.games, *extra)

    def test_the_games_join_the_index_on_their_own_flops(self):
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        idx = json.loads((self.out / "ss_index.json").read_text())
        spots = {s["id"]: s for s in idx["spots"]}
        self.assertEqual(set(spots), {"ss_srp_btn_bb", "ss_srp_btn_bb_ante", "ss_srp_co_bb_ante",
                                      "ss_srp_btn_utg_straddle"})
        self.assertEqual(idx["flops"], ["8c7c6c", "Kc7d2h"])  # (the 100bb spots' own)
        self.assertEqual(spots["ss_srp_btn_bb_ante"]["game"]["ante"], 0.17)
        self.assertIn("pf_ranges", spots["ss_srp_btn_bb_ante"])
        # 6c5d2h: 2 of 3 game spots (67%, under SS_SHARE_PCT): left out; 5c4d2h on all three
        self.assertEqual(sorted(spots["ss_srp_btn_bb_ante"]["flops"]), ["5c4d2h"])
        self.assertTrue((self.out / "ss_srp_btn_bb_ante" / "5c4d2h.bin").exists())
        self.assertFalse((self.out / "ss_srp_btn_bb_ante" / "6c5d2h.bin").exists())
        summary = json.loads((self.out / "lizard-library.json").read_text())["singleSize"]
        self.assertEqual(summary["games"]["target"], 1755)
        self.assertEqual(summary["games"]["flops"], {"a0.17": ["5c4d2h"], "s": ["5c4d2h"]})
        self.assertEqual(summary["games"]["game"]["ss_srp_btn_utg_straddle"]["straddle"], True)
        self.assertEqual(summary["spots"], {"ss_srp_btn_bb": 2})
        kinds = [x["kind"] for x in json.loads((self.out / "lizard-library.json").read_text())["sources"]]
        self.assertIn("single-size games build", kinds)

    def test_a_spot_without_a_game_or_its_ranges_is_left_out_of_the_games(self):
        idx = json.loads((self.games / "ss-index.json").read_text())
        idx["spots"][0].pop("game")
        idx["spots"][1].pop("pf_ranges")
        (self.games / "ss-index.json").write_text(json.dumps(idx))
        r = self.stage()
        self.assertEqual(r.returncode, 0, r.stderr)
        ids = [s["id"] for s in json.loads((self.out / "ss_index.json").read_text())["spots"]]
        self.assertEqual(ids, ["ss_srp_btn_bb", "ss_srp_btn_utg_straddle"])
        self.assertIn("not a game spot", r.stdout)

    def test_a_game_spot_kept_from_the_previous_release_shrinks_rather_than_pass_the_file_cap(self):
        sys.path.insert(0, str(HERE))
        try:
            import assemble
        finally:
            sys.path.remove(str(HERE))
        prev = self.tmp / "prev"
        r = run("--out", prev, "--base", self.base, "--hu", self.hu, "--single-size", self.ss, "--ss-games", self.games)
        self.assertEqual(r.returncode, 0, r.stderr)
        pg = [s for s in json.loads((prev / "ss_index.json").read_text())["spots"] if s.get("game")]
        self.assertEqual(len(pg), 3)
        per = assemble.spot_files(pg[0])
        self.out.mkdir()
        old = assemble.MAX_FILES
        try:  # a source before the games grew: the stage holds 1000 files, room for no flop and one kept copy
            assemble.MAX_FILES = 1000 + assemble.LATE_FILES + per
            log = []
            idx, _ = assemble.add_single_size(self.games, self.out, set(), prev, False, 1000, log, games=True)
        finally:
            assemble.MAX_FILES = old
        self.assertEqual([s["id"] for s in idx["spots"]], [pg[0]["id"]])
        self.assertEqual(sorted(idx["spots"][0]["flops"]), sorted(pg[0]["flops"]))
        self.assertTrue(any(f"{pg[0]['id']}: kept the previous release" in x for x in log), log)
        for s in pg[1:]:
            self.assertTrue(any(f"{s['id']}: shrinks from 1 flops" in x and "file cap" in x for x in log), log)
            self.assertFalse((self.out / s["id"]).exists())
        self.assertLessEqual(sum(1 for p in self.out.rglob("*") if p.is_file()), per)  # (within the cap)

    def test_the_games_alone(self):
        r = self.stage("--single-size", NO_SS)
        self.assertEqual(r.returncode, 0, r.stderr)
        idx = json.loads((self.out / "ss_index.json").read_text())
        self.assertEqual(idx["flops"], [])
        self.assertEqual(len(idx["spots"]), 3)


if __name__ == "__main__":
    unittest.main()
