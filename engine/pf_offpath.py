"""The preflop solves' answers off their own path: a hand class a player never brings to a later node of theirs plays its
best response there, not the fold pf_study.pack stores for it.

pf_study.pack stores every class a player never brings to a node (its reach there under PACK_ZERO) as folding there, and
pf_study.Solve._values reads the node EVs off that stored strategy. So a move a class never makes was valued as that move
and then folding at every later decision of its own: at heads-up 100bb the stored solve never limps T8s, so its limp EV
was the limp, then a fold to the big blind's 3.5bb iso-raise (44.6% of the time), 0.352bb against its raise's 1.0, and
Practice graded the chart's 99% limp a 0.65bb Blunder; AA's limp read 1.19bb, barely above the 0.863 of QTo, which does
limp. The model's own value of the move is a best response at those later nodes, against the others' strategies there.

What changes: values() here (Solve._values / _at, through answering()) fills, at each player's own decision nodes, the
classes with no reach there with the best of the node's moves for them, instead of the stored mix. Their reach is 0, so
no other player's value changes, and neither do the solve's mixes, its on-path EVs or the range's EV: only the EV of a
move for a class that doesn't make it. A seat's line to a node is filled only where the solve trained the others against
it: every move of that seat's own on the way made by at least UNTRAINED_SHARE of the range it had there (the seats behind
a move no one makes never learned to answer it, and web/src/features/practice/pfGrade.ts untrainedMoves leaves such a
move to the chart by the EV pattern the stored fold gives it, which stays as it was); and the best response takes only
moves the solve trained at that node (one made by UNTRAINED_SHARE of the range there), a fold, or a move that ends the
betting. Solving, exploitability and the stored files are untouched (pf_game.Game._up runs as it did for those).

Used by engine/pf_solve.py's and engine/pf_icm_study.py's Solve (the worker's preflop solve and its tournament one);
solver/ is untouched. Tests: scripts/engine/test_pf_engine.py (OffPathValues).
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import numpy as np

from gto import pf_game as G

# web/src/features/practice/pfGrade.ts UNTRAINED_SHARE: a move under this share of the range at its node is one the seats
# behind it never trained against (scripts/engine/test_pf_offpath.py holds the two equal)
UNTRAINED_SHARE = 0.005
# pf_study.pack's: a class with this reach or less at a node is stored folding there (its mix is arbitrary)
PACK_ZERO = 1e-7


def _shape(g: G.Game):
    """Per game, once: (fold (D, A): the action is a fold; ends (N + 1,): the node is a terminal, no decision after it)."""
    got = getattr(g, "_offpath_shape", None)
    if got is None:
        nodes = g.nodes_all
        fold = np.zeros(g.ch.shape, bool)
        for d, k in enumerate(g.dec):
            for a, nm in enumerate(nodes[k].names):
                fold[d, a] = nm == "fold"
        ends = np.zeros(g.N + 1, bool)
        ends[:g.N] = [nd.kind != "dec" for nd in nodes]
        got = g._offpath_shape = (fold, ends)
    return got


def trained(g: G.Game, reach: np.ndarray) -> np.ndarray:
    """(N + 1, n) bool: whether each seat's own line to each node is one the solve trained the others against, every move
    of the seat's own on the way made by at least UNTRAINED_SHARE of the range it had where it made it (row N, the
    tree's dummy child, False)."""
    mass = reach.sum(-1)                                          # (N, n): the share of each seat's hands here
    tr = np.zeros((g.N + 1, g.n), bool)
    tr[0] = True
    for d in range(1, g.maxd + 1):
        idx = g.by_depth[d]
        par = g.parent[idx]
        tr[idx] = tr[par]
        pl = g.player[g.dec_of[par]]
        before = mass[par, pl]
        tr[idx, pl] = tr[par, pl] & (before > 0) & (mass[idx, pl] >= UNTRAINED_SHARE * before)
    return tr


def values(g: G.Game, reach: np.ndarray, strat: np.ndarray, V=None) -> np.ndarray:
    """pf_game.Game._up(reach, strat) (each seat's counterfactual values, (N + 1, n, K)) with the classes a seat never
    brings to a node of its own, on a line the solve trained, playing their best response there (see the module's doc)."""
    fold, ends = _shape(g)
    tr = trained(g, reach)
    if V is None:
        V = np.zeros((g.N + 1, g.n, G.K))
        with np.errstate(all="ignore"):
            g._term_values(reach, V)
    for d in range(g.maxd, -1, -1):
        gg = g.dec_by_depth[d]
        if len(gg) == 0:
            continue
        nodes = g.dec[gg]
        ch = g.ch[gg]                                             # (Gn, A)
        Vc = V[ch]                                                # (Gn, A, n, K)
        p = g.player[gg]
        rows = np.arange(len(gg))
        vp = Vc[rows, :, p]                                       # (Gn, A, K)
        out = Vc.sum(1)
        played = (strat[gg] * vp).sum(1)
        # (the moves a best response may take here: a fold, one that ends the betting, or one the solve trained)
        ok = g.valid[gg] & (fold[gg] | ends[ch] | tr[ch, p[:, None]])
        best = np.where(ok[:, :, None], vp, -np.inf).max(1)
        fill = (reach[nodes, p] <= PACK_ZERO) & (tr[nodes, p] & ok.any(1))[:, None]
        out[rows, p] = np.where(fill, best, played)
        V[nodes] = out
    return V


@contextmanager
def answering(g: G.Game) -> Iterator[None]:
    """While a node's answer is worked out: the game's value pass (Game._up without update or br, as pf_study.Solve's
    _values and _at call it) is values(); a pass that updates regrets or best-responds (solving, exploitability) is
    Game._up's own. Re-entrant (_at calls _values)."""
    if "_up" in g.__dict__:
        yield
        return
    own = type(g)._up

    def up(reach, strat, t=0, update=False, br=-1, V=None):
        if update or br >= 0:
            return own(g, reach, strat, t, update, br, V)
        return values(g, reach, strat, V)

    g._up = up
    try:
        yield
    finally:
        del g.__dict__["_up"]


class OffPathValues:
    """A pf_study.Solve whose answers read values() (mixed in ahead of it)."""

    def _values(self):
        with answering(self.game):
            return super()._values()

    def _at(self, k: int):
        with answering(self.game):
            return super()._at(k)
