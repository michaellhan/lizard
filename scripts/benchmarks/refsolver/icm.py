"""Prize equity by Malmuth-Harville, by walking every finishing order: a player finishes next with probability its
share of the chips still unplaced. Exponential and plain on purpose; the rule, not a shortcut.

ICMPayoffs turns a heads-up pot's outcomes into chip equivalents: the change in prize equity from the start of the hand,
times chips in play over the prize pool, so that a winner-take-all is chips exactly. A split gives each player half the
pot, as the rules do. (The engine values a split as the mean of a win and a loss; docs/ACCURACY.md, section 14.)
"""
from __future__ import annotations

from typing import Dict, List, Sequence


def equities(stacks: Sequence[float], payouts: Sequence[float]) -> List[float]:
    alive = [i for i, s in enumerate(stacks) if s > 1e-12]
    eq = [0.0] * len(stacks)
    pay = list(payouts) + [0.0] * len(stacks)

    def place(left: List[int], k: int, chance: float):
        total = sum(stacks[i] for i in left)
        for i in left:
            q = chance * stacks[i] / total
            eq[i] += q * pay[k]
            rest = [j for j in left if j != i]
            if rest:
                place(rest, k + 1, q)

    if alive:
        place(alive, 0, 1.0)
    # a player with no chips finished below everyone still in: the places after theirs are its, shared if several bust
    dead = [i for i in range(len(stacks)) if i not in alive]
    if dead:
        share = sum(pay[len(alive):len(alive) + len(dead)]) / len(dead)
        for i in dead:
            eq[i] = share
    return eq


class ICMPayoffs:
    """stacks: every seat's chips at the start of the hand; `seats`: the two players' indices (OOP, IP); `inv0`: what
    each has in at the root of the solve, all of it from the start of the hand."""

    def __init__(self, stacks: Sequence[float], payouts: Sequence[float], seats, inv0):
        self.stacks, self.payouts, self.seats, self.inv0 = list(stacks), list(payouts), tuple(seats), tuple(inv0)
        self.base = equities(self.stacks, self.payouts)
        self.scale = sum(self.stacks) / sum(self.payouts)

    def _after(self, inv, share0: float):
        s = list(self.stacks)
        pot = inv[0] + inv[1]
        s[self.seats[0]] += share0 * pot - inv[0]
        s[self.seats[1]] += (1 - share0) * pot - inv[1]
        e = equities(s, self.payouts)
        return tuple((e[i] - self.base[i]) * self.scale for i in self.seats)

    def fold(self, inv, folder: int):
        return self._after(inv, 0.0 if folder == 0 else 1.0)

    def show(self, inv):
        win0 = self._after(inv, 1.0)
        win1 = self._after(inv, 0.0)
        tie = self._after(inv, 0.5)
        return (win0[0], win1[0], tie[0]), (win1[1], win0[1], tie[1])
