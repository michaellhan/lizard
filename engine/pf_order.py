"""Hand order in a preflop strategy: the classes a strategy continues with (4bet or call) less often than a weaker class
of the same family, by more than a tolerance.

Families, weakest first: the pairs from 77 (77 ... AA), and the suited hands of each high card from T to A with a
kicker of 7 or better (K7s ... KQs). A solve keeps these in order, give or take mixing: PokerData's 6-max 100bb solve
(the opener facing a 3bet, all 15 seat pairs) has none out of order at 20 points. Below them a solve does not: 22
continues more than 33-55 from some seats, 66 more than 77 out of position, and the weakest suited hands of a high card
(K6s, A5s-A3s) 4bet as bluffs, so those are left out. A model whose flop values are off by class can play the families
out of order (the 6-max 100bb lz2 game's UTG facing a BTN 3bet: 99 folded 85% while 88 called 66%).
"""
from __future__ import annotations

from typing import Dict, List, Tuple

RANKS = "23456789TJQKA"
TOL = 0.20
LOW_PAIR, LOW_KICKER = "7", "7"


def families() -> List[List[str]]:
    out = [[r + r for r in RANKS[RANKS.index(LOW_PAIR):]]]
    for hi in "TJQKA":
        out.append([hi + lo + "s" for lo in RANKS[RANKS.index(LOW_KICKER):RANKS.index(hi)]])
    return out


def out_of_order(grid: Dict[str, Tuple[float, float]], tol: float = TOL) -> List[Tuple[str, str]]:
    """[(class, weaker class it trails)] over the classes in grid ({class: (4bet, call)}, the classes the player holds
    there): each class continuing less often than some weaker class of its family by more than tol."""
    out = []
    for fam in families():
        seen = [(c, sum(grid[c])) for c in fam if c in grid]
        for i, (c, v) in enumerate(seen):
            worse = [(w, x) for w, x in seen[:i] if x - v > tol]
            if worse:
                out.append((c, max(worse, key=lambda t: t[1])[0]))
    return out


# ----------------------------------------------------------------------------- the opener facing a 3bet (6-max)
SEATS6 = ("UTG", "HJ", "CO", "BTN", "SB", "BB")


def spots_vs_3bet() -> List[Tuple[str, str]]:
    """Every (opener, 3bettor) pair at 6-max: 15."""
    return [(o, t) for i, o in enumerate(SEATS6[:-1]) for t in SEATS6[i + 1:]]


def line_vs_3bet(opener: str, three: str) -> List[dict]:
    """The Study line to the opener facing three's 3bet, everyone else folding."""
    i, j = SEATS6.index(opener), SEATS6.index(three)
    return ([{"pos": p, "action": "fold"} for p in SEATS6[:i]] + [{"pos": opener, "action": "raise"}]
            + [{"pos": p, "action": "fold"} for p in SEATS6[i + 1:j]] + [{"pos": three, "action": "raise"}]
            + [{"pos": p, "action": "fold"} for p in SEATS6[j + 1:]])


def grid_vs_3bet(solve, opener: str, three: str) -> Dict[str, Tuple[float, float, float]]:
    """{class: (reach, 4bet, call)} at the opener's node of a 6-max solve (pf_solve.Solve; raise and all-in
    together)."""
    res = solve.node(line_vs_3bet(opener, three))
    if res.get("study") != "node":
        raise RuntimeError(f"{opener} vs {three}: {res}")
    names = res["grid"]["actions"]
    out = {}
    for c, cell in res["grid"]["cells"].items():
        f = dict(zip(names, cell["f"]))
        out[c] = (cell["w"], f.get("raise", 0.0) + f.get("all-in", 0.0), f.get("call", 0.0))
    return out


def out_of_order_vs_3bet(solve, min_reach: float = 0.05) -> Dict[str, List[Tuple[str, str]]]:
    """out_of_order at every opener-facing-a-3bet node of a 6-max solve, over the classes opened at least min_reach:
    {"UTG_vs_BTN": [(class, weaker class it trails)], ...} (spots with none left out)."""
    out = {}
    for o, t in spots_vs_3bet():
        g = grid_vs_3bet(solve, o, t)
        bad = out_of_order({c: (fb, ca) for c, (r, fb, ca) in g.items() if r > min_reach})
        if bad:
            out[f"{o}_vs_{t}"] = bad
    return out
