"""engine/pf_stored.py: Lizard's stored preflop games answered by the worker's own path (Advisor.advise with study and
preflop_solve, which Practice and Analyze ask, never with "run") from their files, as upstream's two are: a node with
pf_solve stored and done, never "pf_unsolved"; each file is its game's tree; and a game outside the grid is still offered
as unsolved. Seconds: it only reads files.

Run: .venv/bin/python -m unittest scripts/engine/test_pf_stored.py
"""
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import pf_stored  # noqa: E402
from gto import pf_study as PS  # noqa: E402
from gto.advisor import Advisor  # noqa: E402


def ask(players, stack, preflop=(), rake=0.0, cap=None, hero=None):
    seats = PS.Spec(players=players).positions()
    st = {"players": players, "stack": stack, "bb": 1.0, "street": "preflop", "board": "", "hole": "AhKd",
          "hero": hero or seats[0], "preflop": list(preflop), "study": True, "preflop_solve": True}
    if rake:
        st["rake"], st["rake_cap"] = rake, cap
    return Advisor().advise(st)


class StoredGames(unittest.TestCase):
    def test_grid_installed_beside_upstream(self):
        self.assertEqual(PS.STORED[:2], ("6max_100bb", "6max_100bb_r5c3"))
        self.assertEqual(len(pf_stored.KEYS), 5 * 11 * 2 - 2)
        self.assertFalse(set(pf_stored.KEYS) & set(pf_stored.UPSTREAM))
        pf_stored.install()   # (idempotent: a second import changes nothing)
        self.assertEqual(len(PS.STORED), 5 * 11 * 2)

    def test_every_file_is_its_games_tree(self):
        for spec in pf_stored.games():
            with self.subTest(spec.key):
                blob = PS._read_stored(spec.key)
                self.assertIsNotNone(blob, f"engine/pf/{spec.key}.bin is missing")
                PS.unpack(spec.game(), blob)    # raises where the tree doesn't match
                mbb = PS.stored_mbb(blob)
                self.assertIsNotNone(mbb)
                self.assertLess(mbb, PS.TARGET_MBB, "stored further from equilibrium than a live solve stops at")

    def test_answered_from_the_file(self):
        for players, stack, rake, cap in [(2, 100.0, 0.0, None), (4, 40.0, 0.05, 3.0), (6, 200.0, 0.0, None), (6, 100.0, 0.0, None)]:
            with self.subTest(players=players, stack=stack, rake=rake):
                a = ask(players, stack, rake=rake, cap=cap)
                self.assertEqual(a.get("study"), "node", a)
                self.assertTrue(a["pf_solve"]["stored"])
                self.assertTrue(a["pf_solve"]["done"])
                self.assertAlmostEqual(sum(x["freq"] for x in a["actions"]), 1.0, places=2)

    def test_outside_the_grid_is_unsolved(self):
        for players, stack in [(6, 90.0), (7, 100.0)]:
            with self.subTest(players=players, stack=stack):
                self.assertEqual(ask(players, stack)["study"], "pf_unsolved")


if __name__ == "__main__":
    unittest.main()
