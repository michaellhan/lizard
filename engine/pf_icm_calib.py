"""A tournament's preflop in prize equity on Lizard's calibrated preflop solver: engine/pf_icm.py's tournament tree (each
seat's own stack and ante, a jam beside the open at 25bb or less, the small blind's complete, the 7-9 handed cut) played
by engine/pf_engine.py's game (pot layers, each heads-up flop valued at its own effective depth) with
engine/pf_model.py's calibrated flop values, every outcome paid by the tournament's prize model (icm.Model:
Malmuth-Harville, field stand-ins, bounties by the proportional model) through pf_engine's pluggable payoff.

engine/pf_icm.py's own game (ICMGame) is upstream's class-level game with upstream's library flop model; this one keeps
its tree and its prize model and changes the flop values to the calibrated ones the cash solve uses (engine/pf_solve.py,
docs/ACCURACY.md 18.4: 2.85 -> 2.01 points mean error against 26 published cash spots) and the heads-up flop's depth to
the pot's own effective stack (pf_icm values every flop at the table's second-deepest stack). docs/ACCURACY.md 20.7
measures the two side by side.

Nothing here edits pf_engine, pf_model or pf_calib (workstream W2's): PrizePayoff is a pf_engine payoff (its
`utility(delta, node)` and `linear`), and Game subclasses pf_engine.Game only to price the folded seats of a heads-up pot
in one pass (pf_engine loops over them in Python, which is slow on a 9-handed tree; the numbers are the same).

How each outcome is priced (pf_engine's nonlinear path): a fold pays the pot to the one left; a heads-up pot each of its
two winners, a folded seat paid its prize equity by the chance the pot goes each way over the two ranges; a three-way pot
each of its main-pot winners (a two-player side pot to the main pot's winner where eligible, else to the deeper of the
two others). A bust pays its bounty to the seat that won the busted player's last chips: of the seats still holding chips
and in as deep as the busted one, the one that gained most.
"""
from __future__ import annotations

from typing import Optional, Sequence

import numpy as np

from gto import pf_game as G
from gto.pf_classes import PAIR_COMPAT

from engine import pf_engine as E
from engine import pf_icm as I
from engine import pf_model as M

MODEL_TAG = "lzicm1"        # in the stored key: a change to this game or the calibration bumps it
BUST_EPS = 1e-6
_EQUITY_TAG = None


def equity_tag() -> str:
    """The class equity table's own id (sha1 of gto/pf_equity.py's data, 12 hex): in the stored key too, so a solve
    stored on another table (pf_classes.equity_matrix: the flops' and all-ins' equities) is never loaded on this one."""
    global _EQUITY_TAG
    if _EQUITY_TAG is None:
        import hashlib
        from gto.pf_equity import DATA
        _EQUITY_TAG = "eq" + hashlib.sha1("".join(DATA).encode()).hexdigest()[:12]
    return _EQUITY_TAG


class PrizePayoff:
    """pf_engine's payoff for a tournament: each seat's chip result at an outcome priced by icm.Model.value (chip
    equivalents of prize equity; a winner-take-all is chips exactly), memoized by the outcome."""
    linear = False

    def __init__(self, model, positions: Sequence[str]):
        if list(model.seats) != list(positions):
            raise ValueError("the prize model's seats aren't the table's")
        self.model = model
        self.positions = list(positions)
        self.stacks = np.array([model.stacks[p] for p in positions], dtype=float)
        self.bounty = model.bounty
        self._memo = {}

    def kos(self, put: np.ndarray, delta: np.ndarray) -> list:
        """[(busted seat, {winner seat: 1})] of an outcome: a seat in the pot left with no chips, to the seat that won
        its last chips (of those still holding chips and in at least as deep, the one that gained most)."""
        end = self.stacks + delta
        out = []
        for p in range(len(self.positions)):
            if put[p] > 0 and end[p] <= BUST_EPS and delta[p] < 0:
                cands = [q for q in range(len(self.positions)) if q != p and end[q] > BUST_EPS and put[q] >= put[p] - 1e-9]
                if cands:
                    w = max(cands, key=lambda q: delta[q])
                    if delta[w] > 0:
                        out.append((self.positions[p], {self.positions[w]: 1.0}))
        return out

    def utility(self, delta: np.ndarray, node: G.Node) -> np.ndarray:
        put = np.asarray(node.inv, dtype=float)
        key = (tuple(np.round(put, 9)), tuple(np.round(delta, 9)))
        v = self._memo.get(key)
        if v is None:
            kos = [self.kos(put, delta)] if self.bounty is not None else None
            with np.errstate(all="ignore"):
                v = self._memo[key] = self.model.value_batch(put[None, :], (put + delta)[None, :], kos)[0]
        return v

    def values(self, puts: np.ndarray, wons: np.ndarray, kos) -> np.ndarray:
        """pf_icm.Prizes.values: outcomes (m, n) of chips put in and won, kos [[(busted, winner) seat indexes]]."""
        if not len(puts):
            return np.zeros((0, len(self.positions)))
        k = None
        if self.bounty is not None:
            k = [[(self.positions[b], {self.positions[w]: 1.0}) for b, w in ko] for ko in kos]
        with np.errstate(all="ignore"):
            return self.model.value_batch(puts, wons, k)


class Chips(E.ChipPayoff):
    """pf_engine's chip payoff with pf_icm.Chips' values (chips won less those put in)."""
    bounty = None

    def values(self, puts: np.ndarray, wons: np.ndarray, kos) -> np.ndarray:
        return wons - puts


class Game(E.Game):
    """pf_engine.Game with up to four actions a node (pf_icm's tree: fold, the complete or a call, the open and the jam
    beside it; pf_game.Game's arrays hold three) and the folded seats of a heads-up pot priced in one pass (the same
    numbers as pf_engine's loop)."""

    def __init__(self, root: G.Node, positions: Sequence[str], model_at, stacks: Sequence[float],
                 rake=None, payoff=None, ante: float = 0.0):
        self.stacks = np.asarray(stacks, float)
        self.ante = float(ante)
        self.model_at = model_at
        self.payoff = payoff or E.ChipPayoff()
        self._models = {}
        # pf_game.Game.__init__, with A the most children a node has
        self.root, self.positions, self.model, self.stack, self.rake = (
            root, list(positions), self._model(float(self.stacks.min())), float(self.stacks.max()), rake)
        self.root_reach = np.tile(G.PRIOR, (len(self.positions), 1))
        self.n = len(self.positions)
        self.post_rank = G.post_rank(self.positions)
        nodes, parent, act, depth = [root], [-1], [-1], [0]
        i = 0
        while i < len(nodes):
            for a, c in enumerate(nodes[i].children):
                nodes.append(c); parent.append(i); act.append(a); depth.append(depth[i] + 1)
            i += 1
        self.nodes_all = nodes
        for k, nd in enumerate(nodes):
            nd.index = k
        N = self.N = len(nodes)
        self.parent, self.act, self.depth = np.array(parent), np.array(act), np.array(depth)
        self.dec = np.array([k for k, nd in enumerate(nodes) if nd.kind == "dec"])
        self.dec_of = -np.ones(N, dtype=int)
        self.dec_of[self.dec] = np.arange(len(self.dec))
        D = len(self.dec)
        self.A = max(3, max(len(nodes[k].children) for k in self.dec))
        self.player = np.array([nodes[k].player for k in self.dec])
        self.ch = np.full((D, self.A), N, dtype=int)
        for d, k in enumerate(self.dec):
            for a, c in enumerate(nodes[k].children):
                self.ch[d, a] = c.index
        self.valid = self.ch < N
        K = len(G.PRIOR)
        self.regret = np.zeros((D, self.A, K))
        self.ssum = np.zeros((D, self.A, K))
        self.maxd = int(self.depth.max())
        self.by_depth = [np.nonzero(self.depth == d)[0] for d in range(self.maxd + 1)]
        self.dec_by_depth = [self.dec_of[x][self.dec_of[x] >= 0] for x in self.by_depth]
        self._prep_terminals()

    def _prep_terminals(self):
        super()._prep_terminals()
        fs = self.fold_split
        n = self.n
        if fs:
            self._fs_rows = np.array([x[0] for x in fs])
            self._fs_a = np.array([x[1] for x in fs])
            self._fs_c = np.array([x[2] for x in fs])
            self._fs_ua = np.array([x[3] for x in fs])                  # (F, n)
            self._fs_uc = np.array([x[4] for x in fs])
            self._fs_gk = [x[5] for x in fs]
            # the folded seats of each row (everyone but a and c)
            mask = np.ones((len(fs), n), dtype=bool)
            mask[np.arange(len(fs)), self._fs_a] = False
            mask[np.arange(len(fs)), self._fs_c] = False
            self._fs_mask = mask
            self._fs_groups = {}
            for i, gk in enumerate(self._fs_gk):
                self._fs_groups.setdefault(gk, []).append(i)
            self._fs_groups = {gk: np.array(ix) for gk, ix in self._fs_groups.items()}
        self.fold_split = []           # (pf_engine's loop then does nothing: _term_values below prices them)

    def _term_values(self, reach: np.ndarray, V: np.ndarray):
        super()._term_values(reach, V)
        if not getattr(self, "_fs_groups", None):
            return
        T = self.terms
        RT = reach[T]
        m = self._masses(reach)[T]
        Sof = {gk: S for gk, S, *_ in self.hu}
        rows = self._fs_rows
        p = np.empty(len(rows))
        for gk, ix in self._fs_groups.items():
            S = Sof[gk]
            r = rows[ix]
            ra, rc = RT[r, self._fs_a[ix]], RT[r, self._fs_c[ix]]           # (F', K)
            tot = np.einsum("fi,ij,fj->f", ra, PAIR_COMPAT, rc)
            win = np.einsum("fi,ij,fj->f", ra, S, rc)
            p[ix] = np.where(tot > 1e-300, win / np.maximum(tot, 1e-300), 0.5)
        mr = m[rows]                                                       # (F, n, K)
        n = self.n
        for q in range(n):
            sel = self._fs_mask[:, q]
            if not sel.any():
                continue
            others = [x for x in range(n) if x != q]
            prod = np.prod(mr[sel][:, others, :], axis=1)                  # (F', K)
            val = p[sel] * self._fs_ua[sel, q] + (1 - p[sel]) * self._fs_uc[sel, q]
            V[T[rows[sel]], q] = val[:, None] * prod


def game(positions: Sequence[str], stacks: Sequence[float], antes: Sequence[float] = (), icm_model=None,
         max_players: Optional[int] = None, cold4: Optional[bool] = None, params: Optional[M.Params] = None,
         **kw) -> Game:
    """The tournament table's game on the calibrated solver: in prize equity with `icm_model` (icm.Model over these
    seats), else in chips. The tree is pf_icm.build's (its sizes, jam beside the open, complete, cold4 rule)."""
    n = len(positions)
    mp = max_players if max_players is not None else (3 if n <= 6 else 2)
    c4 = cold4 if cold4 is not None else n <= 6
    antes = list(antes) if len(antes) else [0.0] * n
    root = I.build(positions, stacks, antes, max_players=mp, cold4=c4, **kw)
    payoff = PrizePayoff(icm_model, positions) if icm_model is not None else Chips()
    p = params if params is not None else (M.load_params() or M.Params())
    from gto import pf_study as PS
    g = Game(root, list(positions), lambda d: M.flop_model(max(10.0, min(250.0, d)), p), list(stacks), rake=None,
             payoff=payoff, ante=float(max(antes) if antes else 0.0))
    g.avg_power = PS.AVG_POWER
    return g
