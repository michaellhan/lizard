"""The exact equilibrium of a zero-sum heads-up game, by the sequence-form linear program (von Stengel 1996; Koller,
Megiddo & von Stengel 1996), solved with HiGHS through scipy. Needs scipy (scripts/benchmarks/.venv); nothing else here
does.

For the maximizer's realization plan x (Ex = e, x >= 0) the minimizer's best reply is min_y x'Ay over Fy = f, y >= 0,
whose dual is max_q f'q over F'q <= A'x. So

    max f'q   subject to   Ex = e,  x >= 0,  F'q - A'x <= 0,  q free.

A sequence is a hand and the player's own actions so far, in a row of the public tree. Every hand's first sequences
hang off the one empty sequence, and A carries the chance of the deal and of the cards. The LP is solved once from each
side, which gives both strategies and the value twice.

Rake and prize-equity payoffs are not zero-sum and this LP does not apply to them: `solve` refuses.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from .hu import HUGame, NAct, NDeal, NEnd


class Layout:
    """The sequences of both players, and the payoff matrix to player 0 on them."""

    def __init__(self, game: HUGame, scale: Optional[float] = None):
        self.game = game
        self.n_seq = [1, 1]                       # sequence 0: the empty one
        self.parents: List[list] = [[], []]       # per player: the parent sequence of each information set
        self.first: List[list] = [[], []]         # ... its first sequence
        self.acts: List[list] = [[], []]          # ... how many actions it has
        self.seq_of: Dict[str, np.ndarray] = {}   # path -> (B, n) first sequence of the infoset, -1 where none
        rows, cols, vals = [], [], []
        w0, w1 = game.r0
        self.scale = scale if scale is not None else self._scale()

        def walk(node, S0, S1):
            S = [S0, S1]
            if isinstance(node, NEnd):
                b, i, j = np.nonzero(node.pay[0])
                if len(b):
                    rows.append(S0[b, i]); cols.append(S1[b, j])
                    vals.append(node.pay[0][b, i, j] * w0[i] * w1[j] * node.chance)
                return
            if isinstance(node, NDeal):
                B, K = S0.shape[0], node.K
                walk(node.kid,
                     np.where(node.keep[0], S0[:, None, :], -1).reshape(B * K, -1),
                     np.where(node.keep[1], S1[:, None, :], -1).reshape(B * K, -1))
                return
            p = node.player
            A = len(node.names)
            bs, hs = np.nonzero(node.alive)
            first = self.n_seq[p] + A * np.arange(len(bs))
            self.n_seq[p] += A * len(bs)
            self.parents[p].append(S[p][bs, hs])
            self.first[p].append(first)
            self.acts[p].append(np.full(len(bs), A))
            table = np.full(node.alive.shape, -1, dtype=np.int64)
            table[bs, hs] = first
            self.seq_of[node.path] = table
            for a, kid in enumerate(node.kids):
                Sa = np.where(table >= 0, table + a, -1)
                walk(kid, Sa if p == 0 else S0, Sa if p == 1 else S1)

        walk(game.root, np.zeros((1, game.n[0]), dtype=np.int64), np.zeros((1, game.n[1]), dtype=np.int64))
        for p in (0, 1):
            for name in ("parents", "first", "acts"):
                lst = getattr(self, name)[p]
                getattr(self, name)[p] = np.concatenate(lst) if lst else np.zeros(0, dtype=np.int64)
        self.rows, self.cols, self.vals = np.concatenate(rows), np.concatenate(cols), np.concatenate(vals)
        if (self.rows < 0).any() or (self.cols < 0).any():
            raise AssertionError("a payoff on a hand with no sequence")

    def _scale(self) -> float:
        """Makes A's entries a few units at most, for the solver's tolerances."""
        g = self.game
        biggest = max(float(np.abs(e.pay[0]).max()) for e in g.ends)
        return g.n[0] * g.n[1] / max(biggest, 1e-12) / max(float(g.r0[0].max() * g.r0[1].max()), 1e-12)

    def matrix(self, maximizer: int):
        """(n_seq[max], n_seq[min]) payoff to the maximizer, scaled (per unit of the deal's total weight)."""
        from scipy import sparse
        m = sparse.coo_matrix((self.vals, (self.rows, self.cols)), shape=tuple(self.n_seq)).tocsr()
        m = m * (self.scale / self.game.pairs)
        return m if maximizer == 0 else (-m).T.tocsr()

    def constraints(self, p: int):
        """E for player p: row 0 x_0 = 1, then one row per information set: its sequences sum to its parent's."""
        from scipy import sparse
        first, acts, parent = self.first[p], self.acts[p], self.parents[p]
        k = len(first)
        total = int(acts.sum())
        rr = np.repeat(np.arange(1, k + 1), acts)
        cc = np.concatenate([f + np.arange(a) for f, a in zip(first, acts)]) if k else np.zeros(0, dtype=np.int64)
        rows = np.concatenate([[0], rr, np.arange(1, k + 1)])
        cols = np.concatenate([[0], cc, parent])
        vals = np.concatenate([[1.0], np.ones(total), -np.ones(k)])
        return sparse.coo_matrix((vals, (rows, cols)), shape=(k + 1, self.n_seq[p])).tocsr()


def _program(layout: Layout, maximizer: int):
    from scipy import sparse
    A = layout.matrix(maximizer)
    E = layout.constraints(maximizer)
    F = layout.constraints(1 - maximizer)
    nx, nq = E.shape[1], F.shape[0]
    ub = sparse.hstack([-A.T, F.T], format="csr")
    eq = sparse.hstack([E, sparse.csr_matrix((E.shape[0], nq))], format="csr")
    c = np.zeros(nx + nq)
    c[nx] = -1.0
    bounds = [(0.0, None)] * nx + [(None, None)] * nq
    e = np.zeros(E.shape[0])
    e[0] = 1.0
    return c, ub, eq, e, bounds, nx


def _read_strategy(layout: Layout, p: int, x: np.ndarray) -> Dict[str, np.ndarray]:
    """Behaviour strategies from a realization plan; uniform where the plan never gets there."""
    x = np.maximum(x, 0.0)
    out = {}
    for n in layout.game.acts:
        if n.player != p:
            continue
        A = len(n.names)
        t = layout.seq_of[n.path]
        s = np.full((n.B, A, t.shape[1]), 1.0 / A)
        bs, hs = np.nonzero(t >= 0)
        seqs = t[bs, hs][:, None] + np.arange(A)[None, :]
        vals = x[seqs]
        tot = vals.sum(axis=1, keepdims=True)
        share = np.where(tot > 1e-13, vals / np.where(tot > 1e-13, tot, 1.0), 1.0 / A)
        s[bs, :, hs] = share
        out[n.path] = s
    return out


def solve(game: HUGame, method: str = "highs-ds", tol: float = 1e-9, time_limit: Optional[float] = None,
          layout: Optional[Layout] = None) -> dict:
    """Both players' exact strategies and the value to player 0 from each side's LP. `layout`: in place of the game's
    own (locks.LockedLayout: a game with some of its strategies fixed)."""
    from scipy.optimize import linprog
    if not game.zero_sum():
        raise ValueError("the payoffs are not zero-sum: the LP does not apply")
    layout = layout or Layout(game)
    strategy: Dict[str, np.ndarray] = {}
    values = [None, None]
    status = []
    plans = [None, None]
    for p in (0, 1):
        c, ub, eq, e, bounds, nx = _program(layout, p)
        options = dict(primal_feasibility_tolerance=tol, dual_feasibility_tolerance=tol)
        if method == "highs-ipm":
            options["ipm_optimality_tolerance"] = 1e-10
        if time_limit is not None:
            options["time_limit"] = time_limit
        res = linprog(c, A_ub=ub, b_ub=np.zeros(ub.shape[0]), A_eq=eq, b_eq=e, bounds=bounds, method=method,
                      options=options)
        status.append({"status": int(res.status), "message": str(res.message)[:120], "iterations": int(res.nit or 0)})
        if res.x is None:
            raise RuntimeError(f"LP failed for player {p}: {res.message}")
        plans[p] = res.x[:nx]
        values[p] = float(-res.fun) / layout.scale
        strategy.update(_read_strategy(layout, p, res.x[:nx]))
    return {"strategy": strategy, "value_each_side": values, "lp": status, "layout": layout, "plans": plans,
            "rows": [int(_program(layout, p)[1].shape[0] + _program(layout, p)[2].shape[0]) for p in (0, 1)],
            "cols": [int(_program(layout, p)[1].shape[1]) for p in (0, 1)],
            "nonzeros": int(len(layout.vals))}


def frequency_bounds(result: dict, player: int, path: str, slack: float = 1e-7) -> Dict[str, tuple]:
    """How far the range's frequency of each action at a node can move among equilibria.

    `player` must act at `path`, and only at the root of a line it alone has steered (the frequency is linear in the
    plan there): over every optimal plan (value within `slack` of the pot-free optimum, in LP units) the smallest and
    largest share of the range taking each action. A strategy whose frequency falls inside this interval differs from
    the LP's vertex only within the equilibrium set, as far as this frequency can tell."""
    from scipy.optimize import linprog
    layout: Layout = result["layout"]
    game = layout.game
    node = next(n for n in game.acts if n.path == path)
    if node.player != player or node.B != 1:
        raise ValueError("frequency_bounds: the node's own player, on one board")
    c, ub, eq, e, bounds, nx = _program(layout, player)
    v = result["value_each_side"][player] * layout.scale
    from scipy import sparse
    floor = sparse.csr_matrix(([1.0], ([0], [nx])), shape=(1, ub.shape[1]))
    ub2 = sparse.vstack([ub, -floor], format="csr")
    b2 = np.concatenate([np.zeros(ub.shape[0]), [-(v - slack)]])
    w = game.r0[player] / game.r0[player].sum()
    t = layout.seq_of[path][0]
    out = {}
    for a, name in enumerate(node.names):
        obj = np.zeros(ub.shape[1])
        keep = t >= 0
        obj[t[keep] + a] = w[keep]
        lo = linprog(obj, A_ub=ub2, b_ub=b2, A_eq=eq, b_eq=e, bounds=bounds, method="highs-ds")
        hi = linprog(-obj, A_ub=ub2, b_ub=b2, A_eq=eq, b_eq=e, bounds=bounds, method="highs-ds")
        out[name] = (float(lo.fun) if lo.x is not None else None, float(-hi.fun) if hi.x is not None else None)
    return out
