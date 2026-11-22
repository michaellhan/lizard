"""The local patches to solver/gto/advisor.py of 2026-11-17 (see solver/UPSTREAM.json).

1. Preflop equity against several ranges (_preflop_equity_multi_calc) takes its board-sampling error out by control
   variates (_multi_control): before, the BB over a CO open and a BTN call at 100bb called T8o 36% and J9o 87% but
   T9o 7% and 98o 0%, because the one 400-board sample read T8o (24.4% over many samples) at 25.7% and T9o (26.6%)
   at 24.9%.
2. A short-stack jam's flat alternative (_flat_ev) is worth the flat times how often the chart continues with the
   hand: a sliver of a call no longer weighs as a whole flat, which had the button at 40bb over UTG and HJ jamming
   A7s 87% and folding A8s and A9s.

Run: .venv/bin/python -m unittest scripts/engine/test_pf_mw_equity.py
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from gto import advisor as A  # noqa: E402
from gto.cards import ALL_COMBOS, hand_class  # noqa: E402
from gto.preflop import SEATS, Table  # noqa: E402

F = lambda p: {"pos": p, "action": "fold"}  # noqa: E731
CO_BTN = [F("UTG"), F("HJ"), {"pos": "CO", "action": "raise", "amount": 2.5}, {"pos": "BTN", "action": "call"}, F("SB")]
FIRST = {}
for i, c in enumerate(ALL_COMBOS):
    FIRST.setdefault(hand_class(c), i)


class TestMultiwayEquity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        arr = A.preflop_ranges(CO_BTN, Table(SEATS[6], 0.0, False, None, 100.0), 100.0)
        cls.villains = [arr["CO"], arr["BTN"]]
        cls.eq = A._preflop_equity_multi(cls.villains)

    def test_kickers_in_order(self):
        e = lambda h: self.eq[FIRST[h]]  # noqa: E731
        for strong, weak in (("T9o", "T8o"), ("T8o", "T7o"), ("J9o", "J8o"), ("J9o", "T9o"), ("98o", "97o")):
            self.assertGreater(e(strong), e(weak), (strong, weak))

    def test_near_a_larger_sample(self):
        # against the mean of 12 other 400-board samples, without the correction (sd of that mean ~0.4 points)
        ref = {"JTo": 0.2897, "T9o": 0.2665, "T8o": 0.2441, "J9o": 0.2766, "98o": 0.2517, "76o": 0.2197}
        for h, v in ref.items():
            self.assertAlmostEqual(self.eq[FIRST[h]], v, delta=0.012, msg=h)

    def test_the_big_blinds_calls_follow_equity(self):
        res = A.Advisor().study({"players": 6, "board": "", "stack": 100, "preflop": CO_BTN})
        g = res["grid"]
        fold = g["actions"].index("fold")
        cont = lambda h: 1.0 - g["cells"][h]["f"][fold]  # noqa: E731
        self.assertGreaterEqual(cont("T9o"), cont("T8o"))
        self.assertGreaterEqual(cont("J9o"), cont("T9o"))
        self.assertGreaterEqual(cont("JTo"), cont("J9o"))


class TestFlatAlternative(unittest.TestCase):
    def test_scaled_by_how_often_the_chart_continues(self):
        n = len(ALL_COMBOS)
        raiser = np.ones(n)
        rng = np.ones(n)
        full = {"call": np.full(n, 1.0), "raise": np.zeros(n)}
        whole = A._flat_ev(full, rng, raiser, 6.5, 1.5, 30.0)
        full_sliver = {"call": np.full(n, 0.02), "raise": np.zeros(n)}
        sliver = A._flat_ev(full_sliver, rng, raiser, 6.5, 1.5, 30.0)
        on = whole > 0
        self.assertTrue(on.any())
        np.testing.assert_allclose(sliver[on], 0.02 * whole[on], rtol=1e-6)

    def test_button_jams_in_order_at_40bb(self):
        line = [{"pos": "UTG", "action": "raise", "amount": 2.5}, {"pos": "HJ", "action": "call"}, F("CO")]
        res = A.Advisor().study({"players": 6, "board": "", "stack": 40, "preflop": line})
        g = res["grid"]
        jam = g["actions"].index("all-in")
        # A7s jammed 87% while A8s and A9s, each holding a sliver of a call, folded as whole flats. With the flat scaled
        # (the test above) the equilibrium still jams one marginal class among near-equal ones: A8s 89% on the
        # 3,000-board equity table, A7s 83% on the exact one (docs/ACCURACY.md sections 26 and 31); never more than one
        self.assertLessEqual(sum(g["cells"][h]["f"][jam] > 0.5 for h in ("A9s", "A8s", "A7s")), 1)


if __name__ == "__main__":
    unittest.main()
