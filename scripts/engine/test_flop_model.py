"""The river dealt by class inside a flop solve (scripts/benchmarks/flop_model.py).

A small single-raised flop (about 30 combos a player) with Fast's flop model and the river dealt by class over its turn
buckets: the tables are zero-sum and block diagonal, each combo's class weights cover every river it leaves live, a solve
runs to a small exploitability in its own game, and a config without river_dealt builds upstream's tree, cell for cell.
A few seconds, under 300 MB.

Run: .venv/bin/python -m unittest scripts/engine/test_flop_model.py
"""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("GTO_THREADS", "1")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT / "scripts" / "benchmarks"))   # (beside the benchmarks that use it)

import numpy as np  # noqa: E402

from gto import solver as S  # noqa: E402
from gto.cards import cards  # noqa: E402
from gto.ranges import parse_range  # noqa: E402
import flop_model as FM  # noqa: E402

BOARD = tuple(cards("Ks7d2c"))
R0 = parse_range("KQs,QQ,JJ,98s,A2s,KJs,77,T9s")
R1 = parse_range("AKs,99,KTo,QJs,JTs,22,A7s,65s")
SIZES = dict(bet_sizes={"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]},
             raise_sizes={"flop": [0.5], "turn": [0.75], "river": [0.75]})
FAST = dict(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=32, turn_buckets=True,
            bucket_river_step=3, river_classes=True, river_strength=32)


def cfg(**kw):
    return S.Config(**SIZES, **dict(FAST, **kw))


class DealtTables(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        c = cfg(river_dealt=4)
        ctx, active, r0, r1, dead = S._spot(BOARD, R0, R1, c, ())
        tb = S.TreeBuilder(ctx, dead=list(dead))
        root = tb.build(BOARD, 5.5, 97.5)
        ctx.root_reach = (r0[active], r1[active])
        cls.solver = S.Solver(ctx, root, dead)
        cls.solver.run(r0[active], r1[active], time_budget=1e9, max_iters=2)
        cls.ctx, cls.dead = ctx, dead
        cls.tables = {k: v for k, v in ctx._stacks.items() if isinstance(k, tuple) and k and k[0] == "rdealt"}

    def test_built(self):
        self.assertTrue(self.tables, "no river dealt by class in the tree")

    def test_zero_sum_block_diagonal(self):
        K = 4
        for (_, board, outer), (X, E, kap) in self.tables.items():
            W = FM.width(self.ctx, board[:3], self.dead)
            self.assertEqual(E.shape, (2, W, W))
            self.assertEqual(X.shape[2], W)
            np.testing.assert_array_equal(E[1], -E[0].T)
            np.testing.assert_array_equal(kap[1], kap[0].T)
            blocks = np.kron(np.eye(W // K), np.ones((K, K))) > 0
            self.assertEqual(float(np.abs(E[0][~blocks]).max(initial=0.0)), 0.0)
            self.assertEqual(float(np.abs(kap[0][~blocks]).max(initial=0.0)), 0.0)
            self.assertTrue(np.isfinite(X).all() and (X >= 0).all())

    def test_class_weights_cover_the_rivers(self):
        # a combo's class weights add up to the rivers it leaves live (avail - 2): every river is some class's card. A
        # combo holding a class's played card skips that class, as upstream's turn classes do (TreeBuilder._turn_classes)
        ctx = self.ctx
        board = next(iter(self.tables))[1]
        avail = sum(1 for c in range(52) if c not in self.dead and c not in board)
        cls = ctx.turn_classes(board, self.dead)
        total = sum(FM._class_weight(ctx, c, cs) for c, cs in cls)
        live = ctx.member[list(board)].sum(axis=0) == 0
        clear = live & (ctx.member[[c for c, _ in cls]].sum(axis=0) == 0)
        self.assertTrue(clear.any())
        np.testing.assert_allclose(total[clear], avail - 2)
        self.assertTrue((total[live] <= avail - 2).all())


class Solves(unittest.TestCase):
    def test_solve_settles(self):
        sol = S.solve(BOARD, R0, R1, 5.5, 97.5, cfg=cfg(river_dealt=4), time_budget=1e9, max_iters=300)
        self.assertLess(float(sol.exploitability()), 1.0)      # % of the pot, in its own game

    def test_upstream_tree_without_river_dealt(self):
        patched = S.tree_cells(BOARD, R0, R1, 5.5, 97.5, cfg=cfg())
        saved = (S.TreeBuilder._street_over, S.TreeBuilder._river_dealt, S.Ctx.river_table, S.Ctx.table_request)
        try:
            S.TreeBuilder._street_over, S.TreeBuilder._river_dealt = FM._street_over, FM._river_dealt0
            S.Ctx.river_table, S.Ctx.table_request = FM._river_table, FM._table_request
            upstream = S.tree_cells(BOARD, R0, R1, 5.5, 97.5, cfg=cfg())
        finally:
            S.TreeBuilder._street_over, S.TreeBuilder._river_dealt, S.Ctx.river_table, S.Ctx.table_request = saved
        self.assertEqual(patched, upstream)
        self.assertGreater(S.tree_cells(BOARD, R0, R1, 5.5, 97.5, cfg=cfg(river_dealt=4)), patched)

    def test_low_spr_keeps_upstreams_river(self):
        # below river_strength_spr (a 3bet pot) the river stays on the turn's boards, river_dealt or not
        self.assertEqual(S.tree_cells(BOARD, R0, R1, 20.0, 80.0, cfg=cfg(river_dealt=4)),
                         S.tree_cells(BOARD, R0, R1, 20.0, 80.0, cfg=cfg()))


if __name__ == "__main__":
    unittest.main()
