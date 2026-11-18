"""The preflop charts as served, with Lizard's repairs (engine/pf_charts.py):

- 13 to 19bb play the 20bb game's moves, not the 100bb charts unmoved (the 6-max button opened 45.1% at 15bb, as at
  100bb, and 36.6% at 20bb); 12bb is still push/fold. The flop library has no spot at those depths.

About 5 seconds. Run: .venv/bin/python -m unittest scripts/engine/test_pf_charts.py
"""
import contextlib
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from gto import advisor as A  # noqa: E402
from gto.pf_classes import CLASSES  # noqa: E402

LIBRARY = Path(os.environ.get("LIZARD_LIBRARY", ROOT / "library-build" / "lizard-library"))
ADV = A.Advisor()
COMBOS = {c: 6 if len(c) == 2 else 4 if c.endswith("s") else 12 for c in CLASSES}
FOLDS = lambda *ps: [{"pos": p, "action": "fold"} for p in ps]  # noqa: E731


PC = None


def setUpModule():
    """The repairs in place for this module's tests alone: unittest discover runs every test file in one process, and
    the others test the charts as upstream serves them."""
    global PC
    from engine import pf_charts
    PC = pf_charts
    PC.install()


def tearDownModule():
    PC.uninstall()


@contextlib.contextmanager
def unrepaired():
    """The charts as upstream serves them."""
    PC.uninstall()
    try:
        yield
    finally:
        PC.install()


def share(res, actions) -> float:
    g = res["grid"]
    names = g["actions"]
    tot = sum(c["w"] * COMBOS[k] for k, c in g["cells"].items())
    return sum(c["w"] * COMBOS[k] * sum(f for a, f in zip(names, c["f"]) if a in actions)
               for k, c in g["cells"].items()) / tot


def advise(n, stack, hero, pre, **kw):
    return ADV.advise(dict(players=n, hero=hero, hole="2c7d", board="", stack=stack, preflop=pre, **kw))


class Shallow(unittest.TestCase):
    def test_13_to_19bb_play_the_20bb_charts(self):
        btn = FOLDS("UTG", "HJ", "CO")
        at = {d: advise(6, d, "BTN", btn) for d in (12, 13, 15, 17, 19, 20)}
        with unrepaired():
            hundred = share(advise(6, 100, "BTN", btn), ("raise",))
            unmoved = share(advise(6, 15, "BTN", btn), ("raise",))
        self.assertAlmostEqual(unmoved, hundred, places=3)          # (what it was: the 100bb chart, 45.1%)
        self.assertGreater(hundred - share(at[20], ("raise",)), 0.05)
        for d in (13, 15, 17, 19):
            self.assertAlmostEqual(share(at[d], ("raise",)), share(at[20], ("raise",)), places=3, msg=f"{d}bb")
            self.assertTrue(any("the 20bb chart" in x for x in at[d]["notes"]), at[d]["notes"])
        self.assertEqual([a["action"] for a in at[12]["actions"]], ["all-in", "fold"])    # (push/fold as before)

    def test_the_big_blinds_defence_moves_with_depth(self):
        pre = FOLDS("UTG", "HJ", "CO") + [{"pos": "BTN", "action": "raise", "to": 2.5}] + FOLDS("SB")
        cont = {d: share(advise(6, d, "BB", pre), ("call", "all-in")) for d in (13, 15, 19, 20)}
        with unrepaired():
            old = share(advise(6, 15, "BB", pre), ("call", "all-in"))
        self.assertGreater(cont[15] - old, 0.03)       # (it defended the 100bb chart's way: 48.4% at 15bb)
        for d in (13, 15, 19):
            self.assertLess(abs(cont[d] - cont[20]), 0.01, f"{d}bb")

    def test_no_library_spot_is_at_these_depths(self):
        if not (LIBRARY / "index.json").exists():
            self.skipTest(f"no library index at {LIBRARY}")
        idx = json.loads((LIBRARY / "index.json").read_text())
        stacks = {float((s.get("game") or {}).get("stack", 100.0)) for s in idx["spots"]}
        self.assertFalse([d for d in stacks if PC.SHALLOW[0] < d < PC.SHALLOW[1]])


if __name__ == "__main__":
    unittest.main()
