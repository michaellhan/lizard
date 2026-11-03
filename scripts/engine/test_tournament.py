"""What Lizard reads from the engine's tournament answer (web/src/solver/provenance.ts tournamentModelOf,
web/src/features/study/TournamentPanel.tsx), checked on the engine itself: the note's wording for each model, a
bubble factor of null where a chip won gains nothing, and satellites (flat payouts), which the engine has no tests for
(ROADMAP Phase 7). The prize model only (gto/icm.py through advisor._tournament): no solve, a second of CPU.

Run: .venv/bin/python -m unittest discover -s scripts/engine
"""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "solver"))

from gto.advisor import _tournament, _tournament_info  # noqa: E402

SIX = ["UTG", "HJ", "CO", "BTN", "SB", "BB"]


def info(state, hero="UTG", stack=20.0, stacks=None):
    model = _tournament(state, SIX, stack, stacks or {}, 1.0)
    return model, (_tournament_info(model, hero, SIX, "preflop", named=True) if model else None)


class TournamentNotes(unittest.TestCase):
    def test_icm(self):
        _, t = info({"payouts": [50, 30, 20]})
        self.assertTrue(t["note"].startswith("tournament: ICM, UTG's prize equity 16.7% of what's left to pay"))
        self.assertEqual(sorted(t["bubble_factors"]), sorted(SIX[1:]))
        self.assertTrue(all(v is not None and v > 1 for v in t["bubble_factors"].values()))

    def test_one_prize_is_no_tournament_without_bounties(self):
        self.assertIsNone(info({"payouts": [100]})[0])
        self.assertIsNone(info({})[0])

    def test_winner_take_all_with_bounties(self):
        bounties = {"format": "ko", "seats": {p: 10 for p in SIX}}
        _, t = info({"payouts": [100], "bounties": bounties})
        self.assertIn("winner-take-all", t["note"])
        self.assertEqual(t["bounties"]["format"], "ko")

    def test_no_payouts_with_bounties_is_chip_ev(self):
        _, t = info({"bounties": {"format": "mystery", "envelope": 5}})
        self.assertTrue(t["note"].startswith("tournament: no payouts"))

    def test_a_large_field_says_how_it_was_modelled(self):
        _, t = info({"payouts": [30, 20, 14, 10.5, 8, 6.5, 5, 3.5, 2.5], "field": {"players": 48, "chips": 1440}})
        self.assertIn("ICM (54 players modelled by 12)", t["note"])
        _, t = info({"payouts": [50, 30, 20], "field": {"players": 6, "chips": 120}})
        self.assertNotIn("modelled by", t["note"])


class Satellites(unittest.TestCase):
    """Flat payouts: finite bubble factors on a satellite's bubble, null (a chip won gains nothing) once every seat
    left is paid; never a crash."""

    def test_the_bubble(self):
        _, t = info({"payouts": [1] * 5}, stacks={"CO": 8})
        bf = t["bubble_factors"]
        self.assertTrue(all(v is not None and math.isfinite(v) for v in bf.values()))
        # far above a top-heavy structure's: a chip lost costs several times what one won gains
        self.assertGreater(min(bf[p] for p in SIX[1:] if p != "CO"), 5)
        self.assertAlmostEqual(sum(info({"payouts": [1] * 5}, hero=p, stacks={"CO": 8})[1]["equity_share"] for p in SIX), 1, places=3)

    def test_every_seat_left_paid(self):
        for places in (6, 9):
            _, t = info({"payouts": [1] * places})
            self.assertAlmostEqual(t["equity_share"], 1 / 6, places=3)
            self.assertEqual(set(t["bubble_factors"].values()), {None})

    def test_a_locked_seat(self):
        # 5 seats for 6: the 60bb stack against three 5bb stacks is all but sure of a seat (a fifth of the prizes)
        _, t = info({"payouts": [1] * 5}, hero="BTN", stacks={"BTN": 60, "SB": 5, "BB": 5, "UTG": 5})
        self.assertTrue(0.199 < t["equity_share"] <= 0.2)
        self.assertTrue(all(v is not None and 1 < v < 10 for v in t["bubble_factors"].values()))


if __name__ == "__main__":
    unittest.main()
