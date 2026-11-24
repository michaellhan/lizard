"""A prototype preflop solve closer to a full one (W14, 2026-11-24): every hand on its own, card removal across seats,
on the stored games' tree. Measured against the published 6-max 100bb solves and the current solver (lz4) by
scripts/pf/measure_full.py (docs/ACCURACY.md section 35). Nothing in the site uses it: engine/pf_solve.py, its stored
games and its answers are unchanged.

What the current solver (engine/pf_engine.py on upstream's pf_game) does, and what this changes:

* **Hands.** lz4 plays the 169 classes; each seat's range is 169 weights. Here every seat holds one of the 1,326 combos,
  with its own regrets and strategy (`level="combo"`), and every card-removal sum is taken combo by combo against the
  other seat's combos (exact: COMPAT, two combos meet only when they share no card). `level="class"` runs the same
  game on 169 classes (PAIR_COMPAT), which is what lz4 does for the pairwise sums.
* **Card removal across seats.** lz4 removes cards between the hand being valued and each other seat on its own: at a
  showdown between a and c with folders f, a's value for its class i is prod_f m_f(i) * sum_j r_c(j) PAIR_COMPAT[i, j]
  U(i, j), so c's range is the one it reached with, as if the folders had held nothing. With `cross=True` the live
  opponents' ranges are weighed by the folders' hands too: the exact weight of a deal is
  prod_q r_q(x_q) prod_{q<s} compat(x_q, x_s), and summed over each folder's hand given the two live hands h and c that is
  prod_f m_f(h, c); to first order m_f(h, c) = m_f(h) m_f(c) / M_f (engine/bunching.py's F(h), and its section in
  docs/ACCURACY.md measures the pair term J / (F1 F2) left out at 0.3-0.4% RMS). So each live opponent's reach is
  multiplied by rho(c) = prod_f m_f(c), normalised to a mean of 1 over that opponent's own range (the overall chance the
  others' hands are disjoint is taken as the same at every terminal, as lz4 takes it: only the shift between combos
  enters). The same at a three-way flop and a three-way all-in, each live opponent weighed by the folders. Left out:
  folder-folder collisions in m_f(h) (each folder's mass against the hand alone), the folders' own ranges re-weighed by
  the live hands, and the two live opponents' collision with each other in a three-way pot (the product form's).
* **The tree** is the stored games' (engine/pf_solve.Spec.build, pf_engine.build), node for node, and so are the
  terminal payoffs, the rake, the flop values (engine/pf_model.py's calibrated library model by default, any
  pf_model.Params) and the solve (DCFR, regrets discounted t^1.5 / 0.5, the average at t^8 as pf_study): this module
  wraps an engine.pf_engine.Game and reads its tree and terminal tables.

What it doesn't take: unequal stacks' side pots in a three-way pot, a nonlinear payoff (prize equity), a game rooted
inside the tree. Those raise.

Memory: everything a seat holds per node is float32, and the values go up the tree a depth at a time (two depths
held), so the 6-max tree (11,010 nodes, 5,470 decisions) at 1,326 combos needs regrets, the average and the current
strategy (3 x 87 MB), each edge's reach and its card-removal mass (2 x 58 MB) and two depths of values (~200 MB): 799 MB
peak resident with the interpreter and an exploitability pass, 1.15-1.26 s an iteration on a loaded machine (about 15
times `level="class"`, which peaks at 234 MB and takes 0.08 s); docs/ACCURACY.md section 35.

Within a class every combo is the same hand up to a relabelling of the suits, and nothing in the game tells the suits
apart, so a solve that starts even keeps every combo of a class on one strategy (measured: the spread is float32
rounding). The combo level is still what makes the pairwise sums exact for a strategy that does tell them apart (a
node-locked or exploitative one), and what any later step (suit-aware flop values, the exact pair term) needs.
"""
from __future__ import annotations

import os
import sys
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from gto import pf_game as G
from gto.cards import ALL_COMBOS
from gto.pf_classes import CLASS_OF, N_IN, PAIR_COMPAT, equity_matrix

from . import pf_engine as E

NC = len(ALL_COMBOS)            # 1,326
KC = len(N_IN)                  # 169
CHUNK = 384                     # rows a card-removal product takes at once (bounds its temporaries)
TCHUNK = 256                    # terminals valued at once
# Pyodide's numpy has no BLAS: its products go through einsum's own loop there (as pf_game._mm); PF_FULL_NO_BLAS=1 does
# the same natively, which is how scripts/pf/measure_full.py estimates a browser's time without a browser
NO_BLAS = sys.platform == "emscripten" or os.environ.get("PF_FULL_NO_BLAS") == "1"


def _mm(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.einsum("ij,jk->ik", a, b) if NO_BLAS else a @ b


def _bmm(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """(X, B, k) x (X, k, m) -> (X, B, m)."""
    return np.einsum("xbk,xkm->xbm", a, b) if NO_BLAS else np.matmul(a, b)


# ----------------------------------------------------------------------------- the two levels
class ClassSpace:
    """169 classes, card removal by PAIR_COMPAT (lz4's)."""
    name = "class"
    K = KC

    def __init__(self, dtype=np.float32):
        self.dtype = dtype
        self.prior = (N_IN / N_IN.sum()).astype(dtype)
        self.cls = np.arange(KC)
        self._pc = PAIR_COMPAT.astype(dtype)
        self._m: Dict[tuple, np.ndarray] = {}

    def cmass(self, R: np.ndarray) -> np.ndarray:
        """(B, K): the weight of R's hands that share no card with each hand."""
        return _mm(R, self._pc)

    def smul(self, key, S: np.ndarray, R: np.ndarray, transpose: bool = False) -> np.ndarray:
        """(B, K): sum over R's hands c sharing no card with hand h of R(c) S[class h, class c] (S.T with transpose)."""
        k = (key, transpose)
        M = self._m.get(k)
        if M is None:
            St = S.T if transpose else S
            M = self._m[k] = (PAIR_COMPAT * St).T.astype(self.dtype)
        return _mm(R, M)

    def to_class(self, X: np.ndarray) -> np.ndarray:
        return X


class ComboSpace:
    """1,326 combos, card removal exact (COMPAT), class-level payoffs (an equity or pot-share matrix between classes)
    applied to each combo pair. The sums are taken without the (1326, 1326) product: for a payoff S between classes,
    sum_c R(c) compat(h, c) S[i, j(c)] = sum_j S[i, j] R_j - sum_{x in h} sum_j S[i, j] R_{x, j} + S[i, i] R(h), R_j the
    class's weight and R_{x, j} that of its combos holding card x (25 classes hold a card's rank, 1 to 3 combos each)."""
    name = "combo"
    K = NC

    def __init__(self, dtype=np.float32):
        self.dtype = dtype
        cb = np.array(ALL_COMBOS)
        self.c1, self.c2 = cb[:, 0], cb[:, 1]
        self.cls = CLASS_OF
        self.prior = np.full(NC, 1.0 / NC, dtype)
        inc = np.zeros((NC, 52), dtype)
        inc[np.arange(NC), self.c1] = 1
        inc[np.arange(NC), self.c2] = 1
        self.inc = inc
        # each card's 51 combos (card sums by a gather, not a (1326, 52) product), the combos in class order and each
        # class's first (class sums by reduceat)
        self.by_card = np.array([np.nonzero(inc[:, x])[0] for x in range(52)])          # (52, 51)
        self.order = np.argsort(CLASS_OF, kind="stable")
        self.starts = np.searchsorted(CLASS_OF[self.order], np.arange(KC))
        ci = np.zeros((NC, KC), dtype)
        ci[np.arange(NC), CLASS_OF] = 1
        self.ci = ci
        # per card x: the 25 classes holding its rank (J[x, k]) and their combos holding x (A3[x, k, :3], NC = none)
        J = np.zeros((52, 25), int)
        A3 = np.full((52, 25, 3), NC, int)
        for x in range(52):
            holds = [i for i in range(NC) if x in (self.c1[i], self.c2[i])]
            classes = sorted({int(CLASS_OF[i]) for i in holds})
            assert len(classes) == 25
            for k, j in enumerate(classes):
                J[x, k] = j
                cs = [i for i in holds if CLASS_OF[i] == j]
                A3[x, k, :len(cs)] = cs
        self.J, self.A3 = J, A3.reshape(52 * 25, 3)
        # per combo h: its two cards' rows in Q (card x, class of h), flattened (x * KC + i)
        self.q1 = self.c1 * KC + CLASS_OF
        self.q2 = self.c2 * KC + CLASS_OF
        self._m: Dict[tuple, tuple] = {}

    def card_sums(self, R: np.ndarray) -> np.ndarray:
        """(B, 52): the weight of R's combos holding each card."""
        return R[:, self.by_card].sum(-1)

    def class_sums(self, R: np.ndarray) -> np.ndarray:
        return np.add.reduceat(R[:, self.order], self.starts, axis=1)

    def cmass(self, R: np.ndarray) -> np.ndarray:
        cs = self.card_sums(R)                              # (B, 52): weight holding each card
        out = R + R.sum(1, keepdims=True)
        out -= cs[:, self.c1]
        out -= cs[:, self.c2]
        return out

    def _mats(self, key, S, transpose):
        k = (key, transpose)
        m = self._m.get(k)
        if m is None:
            St = np.asarray(S.T if transpose else S, float)
            SJ = np.ascontiguousarray(np.transpose(St[:, self.J], (1, 2, 0))).astype(self.dtype)   # (52, 25, KC)
            m = self._m[k] = (np.ascontiguousarray(St.T).astype(self.dtype), SJ,
                              St[CLASS_OF, CLASS_OF].astype(self.dtype))
        return m

    def smul(self, key, S: np.ndarray, R: np.ndarray, transpose: bool = False) -> np.ndarray:
        StT, SJ, diag = self._mats(key, S, transpose)
        out = np.empty_like(R)
        for b0 in range(0, R.shape[0], CHUNK):
            r = R[b0:b0 + CHUNK]
            p1 = _mm(self.class_sums(r), StT)               # (B, KC): sum_j S[i, j] R_j
            rp = np.concatenate([r, np.zeros((r.shape[0], 1), r.dtype)], 1)
            rx = rp[:, self.A3].sum(-1).reshape(r.shape[0], 52, 25)        # (B, 52, 25): R_{x, j}
            Q = _bmm(np.ascontiguousarray(np.transpose(rx, (1, 0, 2))), SJ)  # (52, B, KC)
            Qf = np.transpose(Q, (1, 0, 2)).reshape(r.shape[0], 52 * KC)
            out[b0:b0 + CHUNK] = p1[:, self.cls] - Qf[:, self.q1] - Qf[:, self.q2] + diag * r
        return out

    def to_class(self, X: np.ndarray) -> np.ndarray:
        """Mean over each class's combos (last axis)."""
        sh = X.shape
        return (self.class_sums(X.reshape(-1, NC)) / N_IN.astype(X.dtype)).reshape(sh[:-1] + (KC,))


# ----------------------------------------------------------------------------- the game
class FullGame:
    """engine.pf_engine.Game `cg`'s tree and terminal tables, solved at `level` ("combo" or "class") with card removal
    across seats (`cross`). DCFR as pf_game.Game.iterate; `cg` is left as built (class_game() writes its average)."""

    def __init__(self, cg: E.Game, level: str = "combo", cross: bool = True, dtype=np.float32):
        if not cg.payoff.linear or getattr(cg, "fold_split", None):
            raise ValueError("chip payoff only")
        if cg.three is not None and np.any(cg.three[4] > 1e-12):
            raise ValueError("a three-way side pot (unequal stacks) isn't taken")
        if cg.root is not cg.nodes_all[0] or cg.root.line:
            raise ValueError("the whole tree only")
        self.cg, self.cross, self.dtype = cg, bool(cross), dtype
        self.space = ComboSpace(dtype) if level == "combo" else ClassSpace(dtype)
        self.level = self.space.name
        K = self.K = self.space.K
        self.n, self.N = cg.n, cg.N
        self.avg_power = float(getattr(cg, "avg_power", 1.0))
        n, N = self.n, self.N
        # src[k, q]: the row of each seat's reach at node k (the edge where it last acted; N + q: its prior)
        src = np.empty((N, n), np.int64)
        src[0] = N + np.arange(n)
        for k in range(1, N):
            src[k] = src[cg.parent[k]]
            src[k, cg.player[cg.dec_of[cg.parent[k]]]] = k
        self.src = src
        self.lvl_pos = np.empty(N, np.int64)
        for d, idx in enumerate(cg.by_depth):
            self.lvl_pos[idx] = np.arange(len(idx))
        D = len(cg.dec)
        self.regret = np.zeros((D, 3, K), dtype)
        self.ssum = np.zeros((D, 3, K), dtype)
        self.valid = cg.valid
        # terminals by depth in batches of TCHUNK, and each heads-up group's / the three-way table's rows by batch
        tdepth = cg.depth[cg.terms]
        bid = np.empty(len(cg.terms), np.int64)            # each terminal's batch
        tpos = np.empty(len(cg.terms), np.int64)           # its row in the batch
        self.tb: List[List[int]] = [[] for _ in range(cg.maxd + 1)]
        batches = []
        for d in range(cg.maxd + 1):
            rows = np.nonzero(tdepth == d)[0]
            for b0 in range(0, len(rows), TCHUNK):
                r = rows[b0:b0 + TCHUNK]
                bid[r] = len(batches)
                tpos[r] = np.arange(len(r))
                self.tb[d].append(len(batches))
                batches.append(r)
        self.t_rows = batches
        self.hu: List[List[tuple]] = [[] for _ in batches]
        eq = equity_matrix()
        uniq: Dict[bytes, int] = {}                        # groups with the same pot shares share one key (a cache)
        for gi0, (gk, _S, rows, a, c, wa, ka, wc, kc) in enumerate(cg.hu):
            S = eq if gk == ("allin",) else cg._model(gk[-1]).share(gk[:-1])
            gi = uniq.setdefault(np.ascontiguousarray(S, float).tobytes(), len(uniq))
            for bi in np.unique(bid[rows]):
                m = bid[rows] == bi
                self.hu[bi].append((gi, S, tpos[rows[m]], a[m], c[m], *(np.asarray(v[m], dtype)[:, None]
                                                                         for v in (wa, ka, wc, kc))))
        self.n_shares = len(uniq)
        self.three: List[Optional[tuple]] = [None] * len(batches)
        if cg.three is not None:
            rows, act, fac, U = cg.three[:4]
            for bi in np.unique(bid[rows]):
                m = bid[rows] == bi
                self.three[bi] = (tpos[rows[m]], act[m], fac[m].astype(dtype), U[m].astype(dtype))
        self.eq = eq
        self.corr = np.asarray(G.three_way_corr(), dtype)[self.space.cls]
        self.pay = cg.pay.astype(dtype)

    # -------------------------------------------------------------- strategies, reaches and masses
    def _rows(self, g: np.ndarray, strat) -> np.ndarray:
        """(G, 3, K): decision rows g of `strat`: "cur" (regret matching on the regrets), "avg" (the average), or an
        array (D, 3, K). Taken a depth at a time, so no whole-tree copy of a strategy is held."""
        if not isinstance(strat, str):
            return strat[g]
        x = np.maximum(self.regret[g], 0) if strat == "cur" else self.ssum[g].copy()
        x *= self.valid[g][:, :, None]
        tot = x.sum(1, keepdims=True)
        uni = (self.valid[g] / self.valid[g].sum(1, keepdims=True))[:, :, None].astype(self.dtype)
        return np.where(tot > 1e-30, x / np.maximum(tot, 1e-38), uni)

    def current(self) -> np.ndarray:
        return self._rows(np.arange(len(self.cg.dec)), "cur")

    def average(self) -> np.ndarray:
        return self._rows(np.arange(len(self.cg.dec)), "avg")

    def down(self, strat="cur", skip: int = -1) -> np.ndarray:
        """(N + n, K): row k the reach of the seat that acted into node k, row N + q seat q's prior."""
        cg = self.cg
        R = np.empty((self.N + self.n, self.K), self.dtype)
        R[0] = self.space.prior
        R[self.N:] = self.space.prior
        for d in range(1, cg.maxd + 1):
            idx = cg.by_depth[d]
            par = cg.parent[idx]
            pd = cg.dec_of[par]
            pl = cg.player[pd]
            u, inv = np.unique(pd, return_inverse=True)
            f = self._rows(u, strat)[inv, cg.act[idx]]
            if skip >= 0:
                f[pl == skip] = 1.0
            R[idx] = R[self.src[par, pl]] * f
        return R

    def masses(self, R: np.ndarray) -> np.ndarray:
        """space.cmass row block by row block (its temporaries bounded)."""
        out = np.empty_like(R)
        for b0 in range(0, R.shape[0], 2048):
            out[b0:b0 + 2048] = self.space.cmass(R[b0:b0 + 2048])
        return out

    # -------------------------------------------------------------- terminal values
    def _terms(self, bi: int, R: np.ndarray, Mv: np.ndarray) -> np.ndarray:
        """(T_b, n, K): every seat's counterfactual value at the terminals of batch bi."""
        cg, sp = self.cg, self.space
        rows = self.t_rows[bi]
        nodes = cg.terms[rows]
        S_ = self.src[nodes]                                    # (L, n)
        m = Mv[S_]                                              # (L, n, K)
        n = self.n
        out = np.empty_like(m)
        pay = self.pay[rows]
        for q in range(n):                                      # each seat: the others' masses, times its payoff
            others = [r for r in range(n) if r != q]
            acc = m[:, others[0]] * pay[:, q:q + 1]
            for r in others[1:]:
                acc *= m[:, r]
            out[:, q] = acc
        del acc
        act = cg.t_active[rows]
        fold_f = np.prod(m, axis=1, where=~act[:, :, None])      # (L, K): the folders' masses against each hand
        del m

        def live(li, seat):
            r = R[S_[li, seat]]
            if not self.cross:
                return r
            f = fold_f[li]
            tot = r.sum(1, keepdims=True)
            mean = (r * f).sum(1, keepdims=True) / np.maximum(tot, 1e-30)
            return r * np.where(mean > 1e-30, f / np.maximum(mean, 1e-30), 1.0)

        for gi, S, li, a, c, wa, ka, wc, kc in self.hu[bi]:
            ra, rc = live(li, a), live(li, c)
            ff = fold_f[li]
            win_a = sp.smul(gi, S, rc)
            win_c = sp.cmass(ra) - sp.smul(gi, S, ra, transpose=True)
            out[li, a] = (wa * win_a + ka * sp.cmass(rc)) * ff
            out[li, c] = (wc * win_c + kc * sp.cmass(ra)) * ff
        th = self.three[bi]
        if th is not None:
            li, actk, fac, U = th
            T3 = np.arange(len(li))
            own = [live(li, actk[:, k]) for k in range(3)]
            er = [sp.smul("eq", self.eq, own[k]) for k in range(3)]
            ms = [sp.cmass(own[k]) for k in range(3)]
            ff = fold_f[li]
            shares, masses = [], []
            for k in range(3):
                o = [j for j in range(3) if j != k]
                shares.append(self.corr * er[o[0]] * er[o[1]])
                masses.append(ms[o[0]] * ms[o[1]])
            tot = sum((own[k] * shares[k]).sum(1) for k in range(3))
            mass = sum((own[k] * masses[k]).sum(1) for k in range(3)) / 3
            norm = np.where(tot > 1e-30, mass / np.maximum(tot, 1e-30), 1.0)[:, None]
            for k in range(3):
                o = [j for j in range(3) if j != k]
                win = shares[k] * norm * fac[:, k][:, None]
                u_win = U[T3, k, k][:, None]
                u_lose = U[:, o, k].mean(1)[:, None]
                out[li, actk[:, k]] = ((u_win - u_lose) * win + u_lose * masses[k]) * ff
        return out

    # -------------------------------------------------------------- the pass up
    def up(self, R: np.ndarray, strat="cur", update: bool = False, br: int = -1) -> np.ndarray:
        """Each seat's counterfactual values at the root (n, K), a depth at a time (two depths held); with `update` the
        regrets and the average; `br`: that seat best-responds."""
        cg = self.cg
        Mv = self.masses(R)
        if getattr(self, "_vbuf", None) is None:
            # two depths' values, allocated once (a fresh array a depth fragments the heap: +0.2 GB resident)
            mx = max(len(x) for x in cg.by_depth) + 1
            self._vbuf = [np.empty((mx, self.n, self.K), self.dtype) for _ in range(2)]
        nxt = None
        for d in range(cg.maxd, -1, -1):
            L = len(cg.by_depth[d])
            V = self._vbuf[d % 2][:L + 1]
            V[L] = 0.0                                          # the dummy child
            for bi in self.tb[d]:
                V[self.lvl_pos[cg.terms[self.t_rows[bi]]]] = self._terms(bi, R, Mv)
            gd = cg.dec_by_depth[d]
            for c0 in range(0, len(gd), 256):
                g = gd[c0:c0 + 256]
                nodes = cg.dec[g]
                ch = cg.ch[g]
                cpos = np.where(ch < self.N, self.lvl_pos[np.minimum(ch, self.N - 1)], nxt.shape[0] - 1)
                p = cg.player[g]
                Gi = np.arange(len(g))
                out = nxt[cpos[:, 0]] + nxt[cpos[:, 1]] + nxt[cpos[:, 2]]      # (G, n, K): the dummy row is 0
                vp = np.stack([nxt[cpos[:, a], p] for a in range(3)], 1)        # (G, 3, K)
                s = self._rows(g, strat)
                ev = (s * vp).sum(1)
                if br >= 0:
                    best = np.where(self.valid[g][:, :, None], vp, -np.inf).max(1)
                    out[Gi, p] = np.where((p == br)[:, None], best, ev)
                else:
                    out[Gi, p] = ev
                if update:
                    vp -= ev[:, None, :]
                    vp *= self.valid[g][:, :, None]
                    self.regret[g] += vp
                    s *= R[self.src[nodes, p]][:, None, :]
                    self.ssum[g] += s
                V[self.lvl_pos[nodes]] = out
            nxt = V
        return nxt[0].copy()

    # -------------------------------------------------------------- the solve
    def iterate(self, t: int):
        R = self.down("cur")
        # the average weighs iteration s by s^avg_power (pf_game.Game's), kept as sum_s (s / t)^p x_s so float32 holds it
        self.ssum *= self.dtype(((t - 1) / t) ** self.avg_power)
        self.up(R, "cur", update=True)
        del R
        pa = t ** 1.5 / (t ** 1.5 + 1)
        neg = self.regret < 0
        self.regret *= self.dtype(pa)
        self.regret[neg] *= self.dtype(0.5 / pa)

    def solve(self, iters: int, start: int = 1, every: int = 0, log=None):
        for t in range(start, start + iters):
            self.iterate(t)
            if every and t % every == 0 and log:
                log(t)
        return self

    def values(self, strat=None) -> np.ndarray:
        """Each seat's EV, bb a hand, under `strat` (the average by default)."""
        s = "avg" if strat is None else strat
        V0 = self.up(self.down(s), s)
        return (V0 * self.space.prior).sum(1)

    def exploitability(self, per_seat: bool = False, strat="avg"):
        """What each seat gains by best-responding to the others' averages, bb a hand (pf_game.Game.exploitability's
        measure, in this game)."""
        gains = []
        for p in range(self.n):
            R = self.down(strat, skip=p)
            v0 = self.up(R, strat)[p]
            v1 = self.up(R, strat, br=p)[p]
            gains.append(float(((v1 - v0) * self.space.prior).sum()))
        return gains if per_seat else sum(gains)

    # -------------------------------------------------------------- reading it
    def average_class(self) -> np.ndarray:
        """(D, 3, 169) float64: the average strategy per class (the mean of its combos' at the combo level)."""
        D = len(self.cg.dec)
        a = np.empty((D, 3, KC))
        for c0 in range(0, D, 512):                         # a block of decisions at a time
            g = np.arange(c0, min(c0 + 512, D))
            a[g] = self.space.to_class(self._rows(g, "avg").astype(np.float64))
        return a / np.maximum(a.sum(1, keepdims=True), 1e-300)

    def class_spread(self) -> float:
        """The most any action's frequency differs between two combos of a class at a reached node (0 at the class
        level)."""
        if self.level != "combo":
            return 0.0
        R = self.down("avg")
        cg = self.cg
        out = 0.0
        groups = [np.nonzero(N_IN == k)[0] for k in (4, 6, 12)]          # suited, pairs, offsuit classes
        cols = [np.concatenate([np.nonzero(CLASS_OF == j)[0] for j in grp]) for grp in groups]
        for c0 in range(0, len(cg.dec), 512):
            g = np.arange(c0, min(c0 + 512, len(cg.dec)))
            a = self._rows(g, "avg")
            reach = R[self.src[cg.dec[g], cg.player[g]]]                  # (G, K)
            for grp, col in zip(groups, cols):
                k = len(col) // len(grp)
                x = a[:, :, col].reshape(len(g), 3, len(grp), k)
                live = reach[:, col].reshape(len(g), len(grp), k).min(2) > 1e-9  # (G, classes)
                sp = (x.max(3) - x.min(3)).max(1)                           # (G, classes)
                if live.any():
                    out = max(out, float(sp[live].max()))
        return out

    def class_game(self) -> E.Game:
        """The wrapped class-level game with this solve's average strategy as its own (so pf_equilibrium.report,
        scripts/pf/vs3bet.py and pf_solve.Solve read it). Its exploitability() is in lz4's game, not this one."""
        self.cg.ssum = self.average_class()
        self.cg.regret = np.zeros_like(self.cg.ssum)
        return self.cg

    def memory_mb(self) -> float:
        """The arrays this solve keeps (regrets, average), MB; a pass adds its reaches, masses and two depths."""
        return (self.regret.nbytes + self.ssum.nbytes) / 2 ** 20


def game(spec, level: str = "combo", cross: bool = True, model_params=None, dtype=np.float32) -> FullGame:
    """The prototype on engine.pf_solve.Spec `spec`'s game (the stored games' tree and flop values)."""
    from gto import pf_study as PS
    cg = spec.game(model_params=model_params)
    cg.avg_power = PS.AVG_POWER
    return FullGame(cg, level=level, cross=cross, dtype=dtype)
