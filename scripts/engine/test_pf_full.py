"""engine/pf_full.py, the full-tree preflop prototype (W14; docs/ACCURACY.md section 36).

- The combo level's card-removal sums equal the (1326, 1326) products they stand for.
- Without card removal across seats it is lz4's game exactly: at the class level every value and regret of an iteration
  is pf_engine.Game's (float64), and at the combo level every combo of a class gets its class's value.
- Across seats: the live opponents' reaches are re-weighed by the folders and nothing else moves (a seat's values at a
  terminal without folders are unchanged), the combo and class levels agree, and a short solve of it converges.

About 3-4 s. Run: .venv/bin/python -m unittest scripts/engine/test_pf_full.py
"""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

import gto.native  # noqa: E402,F401
from gto.pf_classes import CLASS_OF, COMPAT, equity_matrix  # noqa: E402
from engine import pf_full as F, pf_solve as P  # noqa: E402

RAKE = (0.05, 4.0)


def random_strategy(fg, seed=1):
    """A random strategy, the same for every combo of a class (so both levels play one game)."""
    rng = np.random.default_rng(seed)
    s = rng.random((len(fg.cg.dec), 3, 169)) * fg.valid[:, :, None]
    s /= s.sum(1, keepdims=True)
    return s if fg.level == "class" else s[:, :, CLASS_OF]


class CardRemoval(unittest.TestCase):
    def test_combo_sums_are_the_products(self):
        sp = F.ComboSpace(np.float64)
        rng = np.random.default_rng(3)
        R = rng.random((5, F.NC)) * (rng.random((5, F.NC)) < 0.4)
        S = rng.random((169, 169))
        Sx = S[CLASS_OF][:, CLASS_OF]
        want = R @ (COMPAT * Sx).T
        self.assertLess(float(np.abs(sp.smul("s", S, R) - want).max()), 1e-10)
        self.assertLess(float(np.abs(sp.smul("s", S, R, transpose=True) - R @ (COMPAT * Sx)).max()), 1e-10)
        self.assertLess(float(np.abs(sp.cmass(R) - R @ COMPAT).max()), 1e-10)
        eq = equity_matrix()
        self.assertLess(float(np.abs(sp.smul("eq", eq, R) - R @ (COMPAT * eq[CLASS_OF][:, CLASS_OF]).T).max()), 1e-10)


class SameAsLz4(unittest.TestCase):
    SPEC = P.Spec(3, (40.0,), rake=RAKE)

    def test_class_level_is_pf_engine(self):
        fg = F.game(self.SPEC, level="class", cross=False, dtype=np.float64)
        cg = P.Spec(3, (40.0,), rake=RAKE).game()
        s = random_strategy(fg)
        V = cg._up(cg._down(s), s)
        self.assertLess(float(np.abs(fg.up(fg.down(s), s) - V[0]).max()), 1e-10)
        # three iterations: the same regrets and average
        cg.avg_power = fg.avg_power
        for t in (1, 2, 3):
            fg.iterate(t)
            cg.iterate(t)
        self.assertLess(float(np.abs(fg.regret - cg.regret).max()), 1e-9)
        self.assertLess(float(np.abs(fg.average() - cg.average()).max()), 1e-9)

    def test_combo_level_is_the_class_game(self):
        fc = F.game(self.SPEC, level="class", cross=False, dtype=np.float64)
        fx = F.game(self.SPEC, level="combo", cross=False, dtype=np.float64)
        s = random_strategy(fc)
        vc = fc.up(fc.down(s), s)
        vx = fx.up(fx.down(s[:, :, CLASS_OF]), s[:, :, CLASS_OF])
        self.assertLess(float(np.abs(vx - vc[:, CLASS_OF]).max()), 1e-10)


class AcrossSeats(unittest.TestCase):
    def test_levels_agree_and_heads_up_is_untouched(self):
        spec = P.Spec(3, (40.0,), rake=RAKE)
        fc = F.game(spec, level="class", cross=True, dtype=np.float64)
        fx = F.game(spec, level="combo", cross=True, dtype=np.float64)
        s = random_strategy(fc)
        vc = fc.up(fc.down(s), s)
        vx = fx.up(fx.down(s[:, :, CLASS_OF]), s[:, :, CLASS_OF])
        self.assertLess(float(np.abs(vx - vc[:, CLASS_OF]).max()), 1e-10)
        # it moves the values (3-handed: the button's fold re-weighs the blinds' showdowns)
        f0 = F.game(spec, level="class", cross=False, dtype=np.float64)
        v0 = f0.up(f0.down(s), s)
        self.assertGreater(float(np.abs(vc - v0).max()), 1e-4)
        # heads-up there are no folders: nothing moves
        hu = P.Spec(2, (40.0,))
        a = F.game(hu, level="class", cross=True, dtype=np.float64)
        b = F.game(hu, level="class", cross=False, dtype=np.float64)
        s2 = random_strategy(a)
        self.assertLess(float(np.abs(a.up(a.down(s2), s2) - b.up(b.down(s2), s2)).max()), 1e-12)

    def test_short_solve_converges_and_combos_stay_together(self):
        fx = F.game(P.Spec(3, (40.0,), rake=RAKE), level="combo", cross=True)
        fx.solve(60)
        e60 = fx.exploitability()
        fx.solve(140, start=61)
        e200 = fx.exploitability()
        self.assertLess(e200, e60)
        self.assertLess(e200, 0.02)          # bb a hand, three seats summed (lz4 at 200 iterations: 0.0143)
        self.assertLess(fx.class_spread(), 1e-3)


if __name__ == "__main__":
    unittest.main()
