"""A heads-up game with some of a player's choices taken away: the reference's side of a node lock. No engine code.

A hold fixes one information set, a hand at a node on one board, to a mix m. In the sequence form that is
x(I, a) = m(a) x(parent of I), one linear equality per action but the last (the last follows from the infoset's row).
The polytopes stay polytopes, so the LP in lp.py applies as it stands: the holds are extra rows of E for the maximizer's
plan and, through the dual, of F for the minimizer's. Nothing else changes: `value_each_side` is the value of the
restricted game from each side.

`held_values` is the same restriction on the fixed-strategy side: a best response that may change only what isn't held.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .hu import HUGame, NAct, NDeal, NEnd
from .lp import Layout


@dataclass
class Hold:
    """`path`: the node's (HUGame). `rows`: its boards held (indices into node.boards). `hands`: indices into the
    player's hands. `mix`: one frequency per action in node order."""
    path: str
    rows: Sequence[int]
    hands: Sequence[int]
    mix: Sequence[float]


class LockedLayout(Layout):
    """The game's layout with its holds as rows of each player's constraints."""

    def __init__(self, game: HUGame, holds: Sequence[Hold], scale: Optional[float] = None):
        super().__init__(game, scale)
        self.holds = list(holds)
        self.nodes = {n.path: n for n in game.acts}
        self.parent_of = [dict(zip(self.first[p].tolist(), self.parents[p].tolist())) for p in (0, 1)]
        self.held_infosets = 0

    def _extra(self, p: int):
        """Rows, columns and values of the holds on p's sequences, row 0 first."""
        rows, cols, vals = [], [], []
        k = 0
        self.held_infosets = 0
        for h in self.holds:
            node = self.nodes[h.path]
            if node.player != p:
                continue
            table = self.seq_of[h.path]
            A = len(node.names)
            for b in h.rows:
                for i in h.hands:
                    f = int(table[b, i])
                    if f < 0:          # the hand holds a board card: no such infoset
                        continue
                    self.held_infosets += 1
                    par = self.parent_of[p][f]
                    for a in range(A - 1):
                        rows += [k, k]
                        cols += [f + a, par]
                        vals += [1.0, -float(h.mix[a])]
                        k += 1
        return k, rows, cols, vals

    def constraints(self, p: int):
        from scipy import sparse
        base = super().constraints(p)
        k, rows, cols, vals = self._extra(p)
        if not k:
            return base
        extra = sparse.coo_matrix((vals, (rows, cols)), shape=(k, base.shape[1])).tocsr()
        return sparse.vstack([base, extra], format="csr")


def held_table(game: HUGame, holds: Sequence[Hold]) -> Dict[str, Tuple[np.ndarray, np.ndarray]]:
    """{path: (mask (B, n), mix (B, A, n))} of the holds, a hold's hands on its rows."""
    nodes = {n.path: n for n in game.acts}
    out: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
    for h in holds:
        n = nodes[h.path]
        if h.path not in out:
            out[h.path] = (np.zeros((n.B, game.n[n.player]), dtype=bool), np.zeros(n.regret.shape))
        mask, mix = out[h.path]
        ix = np.ix_(list(h.rows), list(h.hands))
        mask[ix] = True
        for a, m in enumerate(h.mix):
            mix[np.ix_(list(h.rows), [a], list(h.hands))] = m
    return out


def apply_holds(game: HUGame, strat: Dict[str, np.ndarray], holds: Sequence[Hold]) -> Dict[str, np.ndarray]:
    """`strat` with the holds written in."""
    out = dict(strat)
    for path, (mask, mix) in held_table(game, holds).items():
        out[path] = np.where(mask[:, None, :], mix, out[path])
    return out


def held_values(game: HUGame, strat: Dict[str, np.ndarray], p: int, holds: Sequence[Hold]) -> float:
    """Player p's best response to `strat`, bb per dealt pair, playing the mix at p's held infosets: a separate walk from
    HUGame.walk, which is free everywhere."""
    o = 1 - p
    held = held_table(game, holds)

    def go(node, ro):
        if isinstance(node, NEnd):
            return (node.pay[p] @ ro[:, :, None])[:, :, 0]
        if isinstance(node, NDeal):
            B, K = ro.shape[0], node.K
            u = go(node.kid, (ro[:, None, :] * node.keep[o]).reshape(B * K, -1)).reshape(B, K, -1)
            return (u * node.keep[p]).sum(axis=1) / node.div
        if node.player == o:
            s = strat[node.path]
            u = 0.0
            for a, kid in enumerate(node.kids):
                u = u + go(kid, ro * s[:, a, :])
            return u
        us = np.stack([go(kid, ro) for kid in node.kids], axis=1)
        best = us.max(axis=1)
        if node.path in held:
            mask, mix = held[node.path]
            best = np.where(mask, (us * mix).sum(axis=1), best)
        return best

    return float(game.r0[p] @ go(game.root, game.r0[o][None, :])[0]) / game.pairs


def solve(game: HUGame, holds: Sequence[Hold], method: str = "highs-ds", tol: float = 1e-9,
          time_limit: Optional[float] = None) -> dict:
    """The restricted game's exact value and strategies (lp.solve), holds written back over what the plan reads as."""
    from . import lp
    layout = LockedLayout(game, holds)
    res = lp.solve(game, method=method, tol=tol, time_limit=time_limit, layout=layout)
    res["strategy"] = apply_holds(game, res["strategy"], holds)
    return res
