"""A three- or four-way river, by brute force over triples (quadruples) of hands, from the rules.

Terminal values come from a full (n0, n1, n2[, n3]) table: each live hand's share of the pot, split among the best live
hands, for every triple (quadruple) that shares no card: card removal exact for every player at once, where the
engine's four-way solve removes cards pair by pair (multiway_solver._term_pw). There is no LP for three players and no equilibrium guarantee for CFR; what is
exact here is the best response, so a profile's distance from equilibrium is measured exactly whichever way it was
found. Values are chips relative to the start of the river (a player's value is its share of the pot, less rake, less
what it put in), so the players' values add up to the pot less the rake.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence

import numpy as np

from .cards import combo_cards, hands_with_board, score
from .rules import Act, End


class MAct:
    __slots__ = ("player", "names", "kids", "path", "regret", "ssum")


class MEnd:
    __slots__ = ("path", "tables", "live", "pot", "c", "rake")


class MWGame:
    def __init__(self, board: Sequence[int], ranges: Sequence[Dict[str, float]], tree, rate: float = 0.0,
                 cap: Optional[float] = None):
        self.board = tuple(board)
        self.names = [sorted(r) for r in ranges]
        self.np = len(ranges)
        if self.np not in (3, 4):
            raise ValueError("three or four players")
        self.weights = [np.array([r[n] for n in names]) for r, names in zip(ranges, self.names)]
        self.hands = [[combo_cards(n) for n in names] for names in self.names]
        self.scores = [score(hands_with_board(h, self.board)) for h in self.hands]
        self.n = [len(h) for h in self.hands]
        self.rate, self.cap = rate, cap
        N = self.np
        mask = np.ones(tuple(self.n), dtype=bool)
        for p in range(N):
            for q in range(p + 1, N):
                pq = np.array([[len({*x, *y}) == 4 for y in self.hands[q]] for x in self.hands[p]])
                shape = [1] * N
                shape[p], shape[q] = self.n[p], self.n[q]
                mask = mask & pq.reshape(shape)
        self.mask = mask
        self.deals = self._contract(self.mask.astype(np.float64), self.weights)
        self.acts: List[MAct] = []
        self.ends: List[MEnd] = []
        self.root = self._expand(tree, "")

    @staticmethod
    def _contract(T, rs) -> float:
        """T (one axis a player, in order) contracted with every player's vector."""
        for r in reversed(rs):
            T = T @ r
        return float(T)

    def rake(self, pot: float) -> float:
        r = self.rate * pot
        return r if self.cap is None else min(r, self.cap)

    def _shares(self, live) -> List[np.ndarray]:
        """Each player's share of a pot the players `live` contest, for every triple."""
        grids = np.meshgrid(*[self.scores[p] for p in range(self.np)], indexing="ij")
        best = np.max([grids[p] for p in live], axis=0)
        top = [grids[p] == best if p in live else np.zeros(best.shape, dtype=bool) for p in range(self.np)]
        count = sum(t.astype(np.int64) for t in top)
        return [t / count for t in top]

    def _expand(self, node, path):
        if isinstance(node, Act):
            n = MAct()
            n.player, n.names, n.path = node.player, node.names, path
            shape = (len(node.names), self.n[node.player])
            n.regret, n.ssum = np.zeros(shape), np.zeros(shape)
            self.acts.append(n)
            n.kids = [self._expand(k, f"{path}/{nm}") for k, nm in zip(node.kids, node.names)]
            return n
        e = MEnd()
        e.path, e.live, e.pot, e.c = path, node.live, node.pot, node.c
        e.rake = self.rake(node.pot)
        shares = self._shares(node.live)
        net = node.pot - e.rake
        m = self.mask.astype(np.float64)
        # each player's table with its own axis first
        e.tables = [np.moveaxis((shares[p] * net - node.c[p]) * m, p, 0) for p in range(self.np)]
        self.ends.append(e)
        return e

    def _end_value(self, e: MEnd, p: int, r) -> np.ndarray:
        T = e.tables[p]
        for q in reversed([i for i in range(self.np) if i != p]):
            T = T @ r[q]
        return T

    def walk(self, strat, p: int, best: bool = False, q_out: Optional[dict] = None) -> np.ndarray:
        def go(node, r):
            if isinstance(node, MEnd):
                return self._end_value(node, p, r)
            s = strat[node.path]
            if node.player != p:
                u = 0.0
                for a, kid in enumerate(node.kids):
                    r2 = list(r)
                    r2[node.player] = r[node.player] * s[a]
                    u = u + go(kid, r2)
                return u
            us = np.stack([go(kid, r) for kid in node.kids])
            if q_out is not None:
                q_out[node.path] = us
            return us.max(axis=0) if best else (us * s).sum(axis=0)

        return go(self.root, list(self.weights))

    def value(self, strat, p: int, best: bool = False) -> float:
        return float(self.weights[p] @ self.walk(strat, p, best)) / self.deals

    def gains(self, strat) -> dict:
        v = [self.value(strat, p) for p in range(self.np)]
        br = [self.value(strat, p, True) for p in range(self.np)]
        return {"value": v, "br": br, "gain": [b - x for b, x in zip(br, v)]}

    def expected_rake(self, strat) -> float:
        total = 0.0
        reach = self.reaches(strat)
        for e in self.ends:
            if e.rake:
                r = reach[e.path]
                total += e.rake * self._contract(self.mask.astype(np.float64), r)
        return total / self.deals

    def reaches(self, strat) -> Dict[str, list]:
        out: Dict[str, list] = {}

        def go(node, r):
            out[node.path] = r
            if isinstance(node, MEnd):
                return
            s = strat[node.path]
            for a, kid in enumerate(node.kids):
                r2 = list(r)
                r2[node.player] = r[node.player] * s[a]
                go(kid, r2)

        go(self.root, list(self.weights))
        return out

    def average(self) -> Dict[str, np.ndarray]:
        out = {}
        for n in self.acts:
            tot = n.ssum.sum(axis=0, keepdims=True)
            out[n.path] = np.where(tot > 0, n.ssum / np.where(tot > 0, tot, 1.0), 1.0 / len(n.names))
        return out

    def uniform(self) -> Dict[str, np.ndarray]:
        return {n.path: np.full(n.regret.shape, 1.0 / len(n.names)) for n in self.acts}

    def run_dcfr(self, iters: int, alpha: float = 1.5, beta: float = 0.0, gamma: float = 2.0, start: int = 0):
        """Discounted CFR, one player's update at a time."""
        def match(reg):
            pos = np.maximum(reg, 0.0)
            tot = pos.sum(axis=0, keepdims=True)
            return np.where(tot > 0, pos / np.where(tot > 0, tot, 1.0), 1.0 / reg.shape[0])

        def go(node, r, p):
            if isinstance(node, MEnd):
                return self._end_value(node, p, r)
            s = match(node.regret)
            if node.player != p:
                u = 0.0
                for a, kid in enumerate(node.kids):
                    r2 = list(r)
                    r2[node.player] = r[node.player] * s[a]
                    u = u + go(kid, r2, p)
                return u
            us = []
            for a, kid in enumerate(node.kids):
                r2 = list(r)
                r2[p] = r[p] * s[a]
                us.append(go(kid, r2, p))
            us = np.stack(us)
            u = (us * s).sum(axis=0)
            node.regret += us - u
            node.ssum += r[p] * s
            return u

        for t in range(start + 1, start + iters + 1):
            for p in range(self.np):
                go(self.root, list(self.weights), p)
            ap, bn = t ** alpha, t ** beta
            ap, bn = ap / (ap + 1), bn / (bn + 1)
            av = (t / (t + 1)) ** gamma
            for n in self.acts:
                n.regret *= np.where(n.regret > 0, ap, bn)
                n.ssum *= av
        return self
