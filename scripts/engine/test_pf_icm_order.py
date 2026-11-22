"""Hand order raising first in, in the stored tournament preflop solves (engine/pf_icm/*.bin), as the page reads them
(engine/pf_icm_study.Solve.node): no hand opens 0.25 or more less often than the hand below it in its family (the pairs,
each high card's kickers, each offsuit hand below its suited twin; engine/pf_dominance.py) where the solve's own EVs back
it, the weaker hand's best EV over folding 0.05bb or more above the stronger's. Ties and near-ties played purely either
way (the EVs within 0.05bb) are a solve's to make.

Before 2026-11-18 the presets were solved on upstream's flop model (pf_study.flop_model), whose join at a library range's
edge valued a class just outside it above its neighbours inside: 240 such first-in inversions in 59 of the 115 presets
(the Early preset's hijack opened QTo and folded QJo). On the calibrated model (engine/pf_model.py) there are none, and
this holds it there.

About 15 seconds (every preset). Run: .venv/bin/python -m unittest scripts/engine/test_pf_icm_order.py
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

from engine import pf_dominance as D  # noqa: E402
from engine import pf_icm_stored as ST  # noqa: E402
from engine import pf_icm_study as IS  # noqa: E402
from gto.advisor import Advisor  # noqa: E402
from gto.pf_classes import CLASSES  # noqa: E402

GAP, DEV, WMIN = 0.25, 0.05, 0.05
EV_BACKED_FIRST_IN = 1        # the count this holds (a model or solver change that adds some must say why)
# The one (2026-11-22, W1's chip EV set): "Final table, 5 left, 10bb average, chip leader on the button, chip EV", the
# hijack at 7.5bb jams Q6s 48% (all-in EV 0.000bb over folding, indifferent) and folds Q7s (all-in -0.058bb), 0.008bb
# past DEV. Solved to 4x STORED_ITERS (6,000 iterations) the spot, its 2.58 mbb and both EVs come out the same to the
# third decimal: a converged feature of the class-level model at this depth, not a solve stopped early. Not a page bug:
# both grades follow the EVs, and the gap is under the grade's own noise.


def first_in(sv, order) -> list:
    """(hero, node) for each seat that can raise first in: everyone before it folded."""
    out = []
    for i, hero in enumerate(order[:-1]):
        node = sv.node([{"pos": p, "action": "fold"} for p in order[:i]])
        if node.get("study") == "node" and node.get("actor") == hero:
            out.append((hero, node))
    return out


def inversions(node) -> list:
    """[(weaker, stronger, EV-backed)] at a node the page grades (not rough)."""
    if node.get("rough"):
        return []
    g = node["grid"]
    names = g["actions"]
    if "fold" not in names:
        return []
    f = names.index("fold")
    out = []
    for wk, st in D.pairs():
        a, b = g["cells"].get(CLASSES[wk]), g["cells"].get(CLASSES[st])
        if not a or not b or a["w"] < WMIN or b["w"] < WMIN or not a.get("ev") or not b.get("ev"):
            continue
        if (1 - a["f"][f]) - (1 - b["f"][f]) < GAP:
            continue
        best = lambda c: max(e - c["ev"][f] for i, e in enumerate(c["ev"]) if i != f)  # noqa: E731
        out.append((CLASSES[wk], CLASSES[st], best(a) - best(b) >= DEV))
    return out


class FirstIn(unittest.TestCase):
    def test_no_ev_backed_inversion_raising_first_in(self):
        adv = Advisor()
        man = json.loads(Path(ST.MANIFEST).read_text())
        self.assertEqual(len(man), len(ST.ALL))
        backed, nodes = [], 0
        for e in man:
            spec, why = IS.spec_of(adv, {**e["request"], "bb": 1.0, "street": "preflop", "board": ""})
            self.assertIsNotNone(spec, why)
            sv = IS.Solve(spec, Path(ST.DIR, e["key"] + ".bin").read_bytes())
            order = list(sv.game.positions)
            for hero, node in first_in(sv, order):
                nodes += 1
                backed += [(e["name"], hero, wk, st) for wk, st, ev in inversions(node) if ev]
        self.assertGreater(nodes, 400)
        self.assertLessEqual(len(backed), EV_BACKED_FIRST_IN, backed[:5])


if __name__ == "__main__":
    unittest.main()
