"""Betting trees, from a description of what each player may do.

Who acts, when a street closes, what a fold or a showdown pays and how an uncalled bet comes back are rules of poker.
Which sizes are on the menu and how they round are not: `Menu` and the sizing in _hu_options and _mw_options restate the
engine's choices (read from gto/solver.py TreeBuilder._decision and gto/multiway_solver.py _actions), and the benchmark
compares the resulting tree with the engine's node by node (compare.py), so a slip here shows as a tree mismatch and the
spot is reported as not compared rather than silently compared on different trees.

Chips: `inv[p]` is what player p has in the pot in total, the pot at the root counted half each heads-up. A node's
children are in the order the engine lists them; the benchmark checks that too.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

STREET = {3: "flop", 4: "turn", 5: "river"}
EPS = 1e-9


@dataclass
class Menu:
    bets: Dict[str, List[float]]            # fractions of the pot, by street
    raises: Dict[str, List[float]]          # raise by this fraction of the pot after calling, by street
    max_raises: int = 2                     # bets and raises a street before only call, fold or all-in remain
    allin_spr: float = 2.5                  # all-in on the menu when the stack behind is at most this many pots


class Act:
    __slots__ = ("player", "names", "kids", "inv", "pot_now", "street_len")

    def __init__(self, player, names, kids, inv, pot_now, street_len):
        self.player, self.names, self.kids, self.inv = player, names, kids, inv
        self.pot_now, self.street_len = pot_now, street_len


class Fold:
    """Heads-up: `folder` gave up. Three-way: see End."""
    __slots__ = ("folder", "inv")

    def __init__(self, folder, inv):
        self.folder, self.inv = folder, inv


class Show:
    __slots__ = ("inv",)

    def __init__(self, inv):
        self.inv = inv


class Deal:
    """The next card comes; `kid` is the betting that follows it, the same on every card."""
    __slots__ = ("kid",)

    def __init__(self, kid):
        self.kid = kid


class End:
    """A three-way river ending: the players `live` contest `pot` chips; `c[p]` is what p put in from the root."""
    __slots__ = ("live", "pot", "c")

    def __init__(self, live, pot, c):
        self.live, self.pot, self.c = live, pot, c


def _half_bb(x: float) -> float:
    """Sizes round to the half big blind (as Python rounds: ties to even)."""
    return round(x * 2) / 2


@dataclass
class HUSpec:
    board_len: int
    pot: float                      # in the middle before this street's bets
    stack: float                    # each player's chips behind at the start of this street
    menu: Menu
    bets: Tuple[float, float] = (0.0, 0.0)      # chips already bet this street
    to_act: int = 0
    n_raises: int = 0
    inv: Optional[Tuple[float, float]] = None   # default: half the pot each, plus the bets


def _hu_options(menu: Menu, street: str, pot_now: float, stack: float, bets, p: int, n_raises: int):
    """[(name, player p's bet on this street afterwards)] when p may bet or raise, after the check or call."""
    me, them = bets[p], bets[1 - p]
    left = stack - me
    out: List[Tuple[str, float]] = []
    if them <= me + EPS:                                    # nothing to call: check or bet
        names = set()
        jam = False
        for f in menu.bets[street]:
            size = max(_half_bb(f * pot_now), 1.0)
            if size >= left - EPS:
                if not jam and left > 0:
                    jam = True
                    out.append(("all-in", me + left))
                continue
            name = f"bet {int(round(f * 100))}%"
            if name not in names:
                names.add(name)
                out.append((name, me + size))
        if not jam and left > 0 and left <= menu.allin_spr * pot_now:
            out.append(("all-in", me + left))
        return out
    to_call = min(them - me, left)
    if left <= to_call + EPS:
        return out                                          # calling is all p has
    after_call = pot_now + to_call
    offered, over = [], False
    if n_raises < menu.max_raises:
        for f in menu.raises[street]:
            to = max(them + _half_bb(f * after_call), 2 * them - me)
            if to >= stack - EPS:
                over = True
            elif to not in offered:
                offered.append(to)
                out.append((f"raise to {to:g}", to))
    if over or not offered or left <= menu.allin_spr * pot_now:
        out.append(("all-in", stack))
    return out


def hu_tree(spec: HUSpec):
    inv0 = spec.inv if spec.inv is not None else (spec.pot / 2 + spec.bets[0], spec.pot / 2 + spec.bets[1])

    def runout(street_len, inv):
        return Show(inv) if street_len == 5 else Deal(runout(street_len + 1, inv))

    def close(street_len, pot, stack, bets, inv, shoved):
        if street_len == 5:
            return Show(inv)
        behind = stack - max(bets)
        if shoved or behind <= EPS:
            return runout(street_len, inv)
        return Deal(decide(street_len + 1, pot + sum(bets), behind, (0.0, 0.0), 0, 0, inv, False))

    def decide(street_len, pot, stack, bets, p, n_raises, inv, opener_checked):
        pot_now = pot + sum(bets)
        me, them = bets[p], bets[1 - p]
        names, kids = [], []

        def put(new_me):
            nb = list(bets); nb[p] = new_me
            ninv = list(inv); ninv[p] += new_me - me
            return tuple(nb), tuple(ninv)

        options = _hu_options(spec.menu, STREET[street_len], pot_now, stack, bets, p, n_raises)
        if them <= me + EPS:
            names.append("check")
            if opener_checked or p == 1:
                kids.append(close(street_len, pot, stack, bets, inv, False))
            else:
                kids.append(decide(street_len, pot, stack, bets, 1, n_raises, inv, True))
        else:
            names.append("fold")
            kids.append(Fold(p, inv))
            nb, ninv = put(me + min(them - me, stack - me))
            names.append("call")
            kids.append(close(street_len, pot, stack, nb, ninv, them >= stack - EPS))
        for name, to in options:
            nb, ninv = put(to)
            names.append(name)
            kids.append(decide(street_len, pot, stack, nb, 1 - p, n_raises + 1, ninv, False))
        return Act(p, names, kids, inv, pot_now, street_len)

    checked = spec.to_act == 1 and spec.bets[0] == spec.bets[1] == 0 and spec.n_raises == 0
    return decide(spec.board_len, spec.pot, spec.stack, spec.bets, spec.to_act, spec.n_raises, inv0, checked)


@dataclass
class MWSpec:
    """A river with three players (or more) acting in seat order, 0 first. `bet` and `raise_frac` as in the engine's
    MWConfig: one or more bet fractions of the pot, a raise of raise_frac of the pot after calling."""
    n_players: int
    pot: float
    stack: float
    bet: Sequence[float]
    raise_frac: float = 0.75
    max_raises: int = 2
    allin_spr: float = 1.5


def _mw_options(spec: MWSpec, pot_now: float, bets, p: int, n_raises: int, folded):
    """[(name, p's bet afterwards, a raise?)] for p's turn."""
    top = max(bets)
    left = spec.stack - bets[p]
    someone_can_act = any(i != p and i not in folded and bets[i] < spec.stack - EPS for i in range(spec.n_players))
    out = []
    if top <= bets[p] + EPS:
        out.append(("check", bets[p], False))
        if someone_can_act and left > EPS:
            jam, seen = left <= spec.allin_spr * pot_now, set()
            for f in sorted(spec.bet):
                size = max(_half_bb(f * pot_now), 1.0)
                if size >= left - EPS:
                    jam = True
                elif size not in seen:
                    seen.add(size)
                    out.append((f"bet {int(round(f * 100))}%", bets[p] + size, True))
            if jam:
                out.append(("all-in", spec.stack, True))
        return out
    out.append(("fold", None, False))
    out.append(("call", min(top, spec.stack), False))
    if left > top - bets[p] + EPS and someone_can_act:
        jam = left <= spec.allin_spr * pot_now
        if n_raises < spec.max_raises:
            to = top + _half_bb(spec.raise_frac * (pot_now + top - bets[p]))
            if to < spec.stack - EPS:
                out.append((f"raise to {to:g}", to, True))
            else:
                jam = True
        if jam:
            out.append(("all-in", spec.stack, True))
    return out


def mw_tree(spec: MWSpec):
    n = spec.n_players

    def end(bets, c, folded):
        """The street is over: chips nobody matched go back to their bettor."""
        live = tuple(i for i in range(n) if i not in folded)
        c2 = list(c)
        order = sorted(range(n), key=lambda i: -bets[i])
        extra = bets[order[0]] - bets[order[1]]
        if extra > EPS:
            c2[order[0]] -= extra
        return End(live, spec.pot + sum(bets) - max(extra, 0.0) if extra > EPS else spec.pot + sum(bets), tuple(c2))

    def decide(p, bets, c, pending, folded, n_raises):
        pot_now = spec.pot + sum(bets)
        names, kids = [], []
        for name, to, raised in _mw_options(spec, pot_now, bets, p, n_raises, folded):
            nb, nc, nf = list(bets), list(c), set(folded)
            if name == "fold":
                nf.add(p)
            else:
                nc[p] += to - bets[p]
                nb[p] = to
            todo = set(pending) - {p}
            if raised:
                todo = {i for i in range(n) if i != p and i not in nf and nb[i] < spec.stack - EPS}
            if len(nf) == n - 1 or not todo:
                kids.append(end(nb, nc, nf))
            else:
                q = next((p + k) % n for k in range(1, n + 1) if (p + k) % n in todo)
                kids.append(decide(q, nb, nc, todo, nf, n_raises + int(raised)))
            names.append(name)
        return Act(p, names, kids, tuple(c), pot_now, 5)

    return decide(0, [0.0] * n, [0.0] * n, set(range(n)), set(), 0)
