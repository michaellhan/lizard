"""A heads-up game laid out over its public boards, with its own payoffs, regret minimizer and best response.

Every betting node carries one row per public board that can reach it, and one column per hand, so that a whole street
of cards is walked in one numpy operation. (This is the natural layout of range-vs-range CFR; the engine happens to use
it too, so this file's independence is of code and of arithmetic, not of the idea. The sequence-form LP in lp.py is a
different method on the same payoffs.)

Payoffs, written from the rules. A player has inv[p] in the pot. A fold: the folder loses what it put in, the other wins
that, less rake, and gets any uncalled chips back. A showdown: the best hand wins the other's chips less rake, a tie
gives each half the pot less rake. Rake is rate x the pot that was contested (without an uncalled bet), up to the cap.

Values are per dealt pair of hands: chips won or lost, on average over the deals with weight r0[i] r1[j] for the pairs
that share no card. A next card is equally likely among those neither hand holds nor the board shows: 52 - board - 4.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .cards import combo_cards, hands_with_board, score
from .rules import Act, Deal, Fold, Show

np.seterr(invalid="ignore", divide="ignore", over="ignore")  # (Accelerate's matmul raises these spuriously on macOS;
                                                             # ref_worker checks every result is finite)


class Chips:
    """Terminal values in chips, with rake."""

    def __init__(self, rate: float = 0.0, cap: Optional[float] = None):
        self.rate, self.cap = rate, cap

    def rake(self, inv) -> float:
        contested = 2 * min(inv)                # an uncalled bet goes back first
        r = self.rate * contested
        return r if self.cap is None else min(r, self.cap)

    def fold(self, inv, folder: int):
        """(value to 0, value to 1)."""
        winner = 1 - folder
        out = [0.0, 0.0]
        out[folder] = -inv[folder]
        out[winner] = inv[folder] - self.rake(inv)
        return tuple(out)

    def show(self, inv):
        """((0 wins, 0 loses, tie) to player 0, (1 wins, 1 loses, tie) to player 1). The stakes are level by then."""
        i, r = inv[0], self.rake(inv)
        return (i - r, -i, -r / 2), (i - r, -i, -r / 2)


class Holdem:
    """The deal: hands and weights per player on a known board."""

    def __init__(self, board: Sequence[int], ranges: Sequence[Dict[str, float]]):
        self.board = tuple(board)
        self.names = [sorted(r) for r in ranges]
        self.weights = [np.array([r[n] for n in names], dtype=np.float64) for r, names in zip(ranges, self.names)]
        self.hands = [[combo_cards(n) for n in names] for names in self.names]
        a, b = self.hands
        self.compat = np.array([[len({x[0], x[1], y[0], y[1]}) == 4 for y in b] for x in a], dtype=bool).reshape(len(a), len(b))
        self._held = [np.zeros((len(h), 52), dtype=bool) for h in self.hands]
        for p, hs in enumerate(self.hands):
            for i, (x, y) in enumerate(hs):
                self._held[p][i, x] = self._held[p][i, y] = True

    def next_cards(self, board) -> List[int]:
        return [c for c in range(52) if c not in board]

    def runouts(self, board_len: int) -> int:
        """How many next cards are live for any pair of hands."""
        return 52 - board_len - 4

    def alive(self, boards, p: int) -> np.ndarray:
        """(B, n): the hand holds no board card."""
        cards = np.array(boards, dtype=np.int64)
        return ~self._held[p][:, cards].any(axis=2).T

    def outcomes(self, boards) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(B, n0, n1) booleans: 0 beats 1, 1 beats 0, tie, for pairs that can be dealt on the board."""
        B = len(boards)
        win, lose, tie = [np.zeros((B, len(self.hands[0]), len(self.hands[1])), dtype=bool) for _ in range(3)]
        al = [self.alive(boards, 0), self.alive(boards, 1)]
        for k, b in enumerate(boards):
            s0 = score(hands_with_board(self.hands[0], b))
            s1 = score(hands_with_board(self.hands[1], b))
            ok = self.compat & al[0][k][:, None] & al[1][k][None, :]
            win[k] = (s0[:, None] > s1[None, :]) & ok
            lose[k] = (s0[:, None] < s1[None, :]) & ok
            tie[k] = (s0[:, None] == s1[None, :]) & ok
        return win, lose, tie

    def mass(self, boards) -> np.ndarray:
        al = [self.alive(boards, 0), self.alive(boards, 1)]
        return self.compat[None, :, :] & al[0][:, :, None] & al[1][:, None, :]


class Toy(Holdem):
    """A deal without cards: hands with fixed strengths, one board, `compat` saying which pairs can be dealt."""

    def __init__(self, strengths: Sequence[Sequence[float]], weights: Sequence[Sequence[float]], compat: np.ndarray):
        self.board = ()
        self.strengths = [np.array(s, dtype=np.float64) for s in strengths]
        self.weights = [np.array(w, dtype=np.float64) for w in weights]
        self.names = [[f"h{i}" for i in range(len(s))] for s in strengths]
        self.compat = np.array(compat, dtype=bool)

    def alive(self, boards, p):
        return np.ones((len(boards), len(self.strengths[p])), dtype=bool)

    def outcomes(self, boards):
        s0, s1 = self.strengths[0][:, None], self.strengths[1][None, :]
        return tuple(((x & self.compat)[None, :, :]) for x in (s0 > s1, s0 < s1, s0 == s1))

    def mass(self, boards):
        return self.compat[None, :, :]


class NAct:
    __slots__ = ("player", "names", "kids", "path", "B", "boards", "alive", "chance", "regret", "ssum", "street_len")


class NEnd:
    __slots__ = ("kind", "path", "pay", "mass", "inv", "rake", "chance", "folder", "boards", "values")


class NDeal:
    __slots__ = ("kid", "path", "K", "keep", "div", "boards")


class HUGame:
    def __init__(self, deal: Holdem, tree, payoffs=None):
        self.deal = deal
        self.payoffs = payoffs or Chips()
        self.n = [len(w) for w in deal.weights]
        self.r0 = [w.copy() for w in deal.weights]
        self.acts: List[NAct] = []
        self.ends: List[NEnd] = []
        self._outcomes: Dict[int, tuple] = {}
        self.root = self._expand(tree, [deal.board], "", 1.0)
        self.pairs = float(self.r0[0] @ deal.compat.astype(np.float64) @ self.r0[1])

    def _expand(self, node, boards, path, chance):
        if isinstance(node, Act):
            n = NAct()
            n.player, n.names, n.path, n.boards, n.B = node.player, node.names, path, boards, len(boards)
            n.street_len = node.street_len
            n.alive = self.deal.alive(boards, node.player)
            n.chance = chance
            A = len(node.names)
            n.regret = np.zeros((n.B, A, self.n[node.player]))
            n.ssum = np.zeros((n.B, A, self.n[node.player]))
            self.acts.append(n)
            n.kids = [self._expand(k, boards, f"{path}/{nm}", chance) for k, nm in zip(node.kids, node.names)]
            return n
        if isinstance(node, Deal):
            n = NDeal()
            cards = [self.deal.next_cards(b) for b in boards]
            n.K = len(cards[0])
            n.path, n.boards = path, boards
            child = [b + (c,) for b, cs in zip(boards, cards) for c in cs]
            n.keep = [self.deal.alive(child, 0).reshape(len(boards), n.K, -1),
                      self.deal.alive(child, 1).reshape(len(boards), n.K, -1)]
            n.div = float(self.deal.runouts(len(boards[0])))
            n.kid = self._expand(node.kid, child, path + "|", chance / n.div)
            return n
        n = NEnd()
        n.path, n.boards, n.inv, n.chance = path, boards, node.inv, chance
        rake = getattr(self.payoffs, "rake", None)
        n.rake = rake(node.inv) if rake else 0.0
        n.mass = self.deal.mass(boards)
        if isinstance(node, Fold):
            n.kind, n.folder = "fold", node.folder
            v0, v1 = self.payoffs.fold(node.inv, node.folder)
            n.values = (v0, v1)
            pay0, pay1 = v0 * n.mass.astype(np.float64), v1 * n.mass.astype(np.float64)
        else:
            n.kind, n.folder = "show", None
            key = id(boards)
            if key not in self._outcomes:
                self._outcomes[key] = (boards,) + self.deal.outcomes(boards)    # (boards kept: the id stays taken)
            _, win, lose, tie = self._outcomes[key]
            (w0, l0, t0), (w1, l1, t1) = self.payoffs.show(node.inv)
            n.values = (w0, l0, t0, w1, l1, t1)
            pay0 = w0 * win.astype(np.float64) + l0 * lose + t0 * tie
            pay1 = w1 * lose.astype(np.float64) + l1 * win + t1 * tie
        n.pay = [pay0, pay1.transpose(0, 2, 1)]
        self.ends.append(n)
        return n

    # ---------------------------------------------------------------- walking a fixed strategy
    def uniform(self) -> Dict[str, np.ndarray]:
        return {n.path: np.full(n.regret.shape, 1.0 / len(n.names)) for n in self.acts}

    def average(self) -> Dict[str, np.ndarray]:
        out = {}
        for n in self.acts:
            tot = n.ssum.sum(axis=1, keepdims=True)
            out[n.path] = np.where(tot > 0, n.ssum / np.where(tot > 0, tot, 1.0), 1.0 / len(n.names))
        return out

    def walk(self, strat, p: int, best: bool, q: Optional[dict] = None, lock=None):
        """(n_p,) counterfactual values at the root for player p, the opponent on `strat`, and p on `strat` too or,
        with `best`, best-responding. `q`: filled with {path: (B, A, n_p)} action values at p's nodes."""
        o = 1 - p

        def go(node, ro):
            if isinstance(node, NEnd):
                return (node.pay[p] @ ro[:, :, None])[:, :, 0]
            if isinstance(node, NDeal):
                B, K = ro.shape[0], node.K
                ro2 = (ro[:, None, :] * node.keep[o]).reshape(B * K, -1)
                u = go(node.kid, ro2).reshape(B, K, -1)
                return (u * node.keep[p]).sum(axis=1) / node.div
            s = strat[node.path] if lock is None or node.path not in lock else lock[node.path]
            if node.player == o:
                u = 0.0
                for a, kid in enumerate(node.kids):
                    u = u + go(kid, ro * s[:, a, :])
                return u
            us = np.stack([go(kid, ro) for kid in node.kids], axis=1)
            if q is not None:
                q[node.path] = us
            return us.max(axis=1) if best else (us * s).sum(axis=1)

        return go(self.root, self.r0[o][None, :])[0]

    def value(self, strat, p: int, best: bool = False, lock=None) -> float:
        """Player p's value, bb per dealt pair."""
        return float(self.r0[p] @ self.walk(strat, p, best, lock=lock)) / self.pairs

    def reaches(self, strat) -> Dict[str, list]:
        """{path: [r0 (B, n0), r1 (B, n1)]}: each player's chance of playing to the node, per board and hand, the
        deal's weight included."""
        out: Dict[str, list] = {}

        def go(node, r):
            if isinstance(node, NEnd):
                out[node.path] = r
                return
            if isinstance(node, NDeal):
                B, K = r[0].shape[0], node.K
                out[node.path] = r
                go(node.kid, [(r[p][:, None, :] * node.keep[p]).reshape(B * K, -1) for p in (0, 1)])
                return
            out[node.path] = r
            s = strat[node.path]
            for a, kid in enumerate(node.kids):
                r2 = list(r)
                r2[node.player] = r[node.player] * s[:, a, :]
                go(kid, r2)

        go(self.root, [self.r0[0][None, :], self.r0[1][None, :]])
        return out

    def expected_rake(self, strat) -> float:
        reach = self.reaches(strat)
        total = 0.0
        for e in self.ends:
            if e.rake:
                r0, r1 = reach[e.path]
                total += e.rake * e.chance * float(np.einsum("bi,bij,bj->", r0, e.mass.astype(np.float64), r1))
        return total / self.pairs

    def gains(self, strat) -> dict:
        """What each player gains by best-responding: the exact measure of how far a profile is from equilibrium. In
        a zero-sum game br[0] + br[1] is the usual exploitability; with rake or prize equity, gains[p] = br[p] -
        value[p] is what stays well defined (their sum is NashConv)."""
        v = [self.value(strat, 0), self.value(strat, 1)]
        br = [self.value(strat, 0, True), self.value(strat, 1, True)]
        return {"value": v, "br": br, "gain": [br[0] - v[0], br[1] - v[1]]}

    def zero_sum(self) -> bool:
        return all(np.allclose(e.pay[0], -e.pay[1].transpose(0, 2, 1)) for e in self.ends)


class DCFR:
    """Discounted CFR with alternating updates (Brown & Sandholm 2019): positive regrets x t^a / (t^a + 1), negative x
    t^b / (t^b + 1), the average strategy's weights x (t / (t + 1))^g. In float64. Defaults are the paper's: 1.5, 0, 2."""

    def __init__(self, game: HUGame, alpha: float = 1.5, beta: float = 0.0, gamma: float = 2.0):
        self.game, self.alpha, self.beta, self.gamma = game, alpha, beta, gamma
        self.t = 0

    @staticmethod
    def _match(regret):
        pos = np.maximum(regret, 0.0)
        tot = pos.sum(axis=1, keepdims=True)
        return np.where(tot > 0, pos / np.where(tot > 0, tot, 1.0), 1.0 / regret.shape[1])

    def _pass(self, p: int):
        o = 1 - p
        g = self.game

        def go(node, rp, ro):
            if isinstance(node, NEnd):
                return (node.pay[p] @ ro[:, :, None])[:, :, 0]
            if isinstance(node, NDeal):
                B, K = ro.shape[0], node.K
                u = go(node.kid, (rp[:, None, :] * node.keep[p]).reshape(B * K, -1),
                       (ro[:, None, :] * node.keep[o]).reshape(B * K, -1)).reshape(B, K, -1)
                return (u * node.keep[p]).sum(axis=1) / node.div
            s = self._match(node.regret)
            if node.player == o:
                u = 0.0
                for a, kid in enumerate(node.kids):
                    u = u + go(kid, rp, ro * s[:, a, :])
                return u
            us = np.stack([go(kid, rp * s[:, a, :], ro) for a, kid in enumerate(node.kids)], axis=1)
            u = (us * s).sum(axis=1)
            node.regret += us - u[:, None, :]
            node.ssum += rp[:, None, :] * s
            return u

        go(g.root, g.r0[p][None, :], g.r0[o][None, :])

    def run(self, iters: int):
        g = self.game
        for _ in range(iters):
            self.t += 1
            t = float(self.t)
            for p in (0, 1):
                self._pass(p)
            ap, bn = t ** self.alpha, t ** self.beta
            ap, bn = ap / (ap + 1), bn / (bn + 1)
            av = (t / (t + 1)) ** self.gamma
            for n in g.acts:
                n.regret *= np.where(n.regret > 0, ap, bn)
                n.ssum *= av
        return self
