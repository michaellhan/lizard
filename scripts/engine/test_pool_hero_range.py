"""The local patch to solver/gto/advisor.py from upstream 36fb5f5b (see solver/UPSTREAM.json): against a typical player
(opponents "pool"), hero's own range on later streets is the one their preflop advice plays, not the chart's. The
pool-priced calls the advice adds (Advisor._priced's pool) are in it, so a hand the advice said to call enters the flop
in range instead of as a hand nobody expects. GTO mode keeps the chart's range.

The hand that found it upstream: 8-handed 100bb, UTG opens to 6, UTG1 and LJ fold, HJ calls, CO calls 66 (the pool
advice calls about 85%; the chart folds it).

Run: .venv/bin/python -m unittest scripts/engine/test_pool_hero_range.py
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from gto.advisor import preflop_ranges  # noqa: E402
from gto.cards import ALL_COMBOS, hand_class  # noqa: E402
from gto.native import advisor  # noqa: E402
from gto.preflop import SEATS  # noqa: E402

F = lambda p: {"pos": p, "action": "fold"}  # noqa: E731
OPEN = [{"pos": "UTG", "action": "raise", "to": 6}, F("UTG1"), F("LJ"), {"pos": "HJ", "action": "call"}]
PRE = OPEN + [{"pos": "CO", "action": "call"}, F("BTN"), F("SB"), F("BB")]
SIXES = [i for i, c in enumerate(ALL_COMBOS) if hand_class(c) == "66"]


class TestPoolHeroRange(unittest.TestCase):
    def test_hero_range_holds_the_calls_the_pool_advice_gives(self):
        pre = advisor("fast").advise({"players": 8, "hero": "CO", "hole": "6c6s", "board": "", "preflop": OPEN,
                                      "stack": 100, "opponents": "pool"})
        call = {a["action"]: a["freq"] for a in pre["actions"]}["call"]
        self.assertGreater(call, 0.5)
        r = preflop_ranges(PRE, SEATS[8], 100.0, "CO")["CO"]
        self.assertAlmostEqual(float(np.mean(r[SIXES])), call, places=2)

    def test_gto_mode_keeps_the_chart_range(self):
        # (equilibrium: the chart's range, where 66 folds)
        self.assertLess(float(np.mean(preflop_ranges(PRE, SEATS[8], 100.0)["CO"][SIXES])), 0.05)


if __name__ == "__main__":
    unittest.main()
