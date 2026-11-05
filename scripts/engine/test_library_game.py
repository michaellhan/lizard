"""The library Lizard publishes holds spots of another game (scripts/library/assemble.py merges the heads-up builds into
the 6-max index), and each such spot's "game" in index.json is a dict. gto/flop_approx.near_exact read it as a format tag
up to gto-solver 9b907bd6, so a pot of those spots' pot and stack raised AttributeError, which the advisor swallows as "a
library that can't be read is no library": an 8- or 9-handed SB vs BB pot lost the 6-max spot it borrows and was solved
live, with nothing said. No solve and no library files: the index alone, a second of CPU.

Run: .venv/bin/python -m unittest discover -s scripts/engine
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "solver"))

from gto import flop_approx as fa  # noqa: E402
from gto import flop_library as fl  # noqa: E402

HEADS_UP = {"players": 2, "stack": 100.0, "ante": 0.0, "straddle": False}  # as index.json holds it
SPOTS = [
    {"id": "srp_sb_bb_2max", "pot": 6.0, "stack": 97.0, "game": HEADS_UP, "fp": ["a", "b"], "flops": {}, "tree": {}},
    {"id": "lp_sb_bb_2max", "pot": 2.0, "stack": 99.0, "game": HEADS_UP, "fp": ["c", "d"], "flops": {}, "tree": {}},
]


def library():
    raw = json.dumps({"format": 2, "tree": {}, "spots": SPOTS}).encode()
    return fl.FlopLibrary(lambda p: raw if p == "index.json" else b"")


class AnotherGamesSpot(unittest.TestCase):
    def test_near_exact_reads_the_dict(self):
        """Neither spot's ranges are these (no "line" to rebuild them from), so nothing is borrowed: what's pinned is
        that it gets that far, at every table size Lizard plays, the heads-up table's own included."""
        full = np.ones(1326)
        for players in (2, 6, 8, 9):
            for sp in SPOTS:
                with self.subTest(players=players, spot=sp["id"]):
                    fa._EXACT.clear()
                    self.assertIsNone(fa.near_exact(library(), full * 0.5, full * 0.25, sp["pot"], sp["stack"], players))
