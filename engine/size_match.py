"""A bet of the tree's own amount is read as the tree's size: Advisor._cfg_with_real_sizes no longer swaps it out.

The tree prices each bet size f of a street at max(round(f * pot * 2) / 2, 1.0) big blinds (gto/solver.py
TreeBuilder._decision: half-big-blind steps, never under the 1bb minimum), and the table plays that amount. But
Advisor._cfg_with_real_sizes reads a bet back as its share of the pot (amount / pot) and swaps it into the street's sizes
wherever that share is more than 15% off the nearest nominal size (_swap_nearest). In the heads-up limped pot (2bb) the
library's 33% bet is a 1bb bet, which reads back as 50%, 52% off 33%: the config took 0.5 in place of 0.33, its tree no
longer matched the stored one, and every decision after a 1bb flop bet there was solved live although the library holds
that very node (lp_sb_bb_2max, all 208 of its flops; the Practice QA sweep's issue E, docs/QA.md). The same happens to any
size the half-big-blind rounding moves more than 15% (33% of a 2.5bb pot is 1bb, 40%).

Here, while _cfg_with_real_sizes reads a street, a bet whose amount is the tree's own amount for one of the street's
configured sizes is matched to that size (the nearest such, by share) before _swap_nearest sees it, so nothing is swapped
and that size is marked taken, as an exact match would be. Every other bet, and every raise and all-in, goes to
_swap_nearest as before. (Raises aren't matched: the tree's raise to is the bet faced plus a share of the pot after the
call, rounded to half a big blind and at least a minimum raise; with the 50% and 75% raises configured that is always
more than a minimum raise, and the rounding is under 15% from the smallest postflop pot up.) Action amounts are never
rewritten (the bets bookkeeping after them reads them).

And where the walk through a solved tree (Advisor._tree_action_name) names a bet by its share ('bet 50%') and the tree
action it maps to puts in exactly that amount ('bet 33%', 1bb into 2bb), the bet is named as that tree action, so the
answer no longer carries the note "mapped 'bet 50%' to tree action 'bet 33%'" for the tree's own bet. Which action it
maps to is unchanged (gto.solver.match_action's, the nearest by share).

The worker imports it once at start, after engine.mw_quick (scripts/pyodide/worker-edits.mjs, declared in
solver/UPSTREAM.json); scripts/qa/advserver.py does the same. solver/ is untouched. Tests: scripts/engine/test_size_match.py.
"""
from __future__ import annotations

import contextvars
from typing import List, Optional

from gto import advisor as A
from gto.solver import match_action

_READING = contextvars.ContextVar("lizard_size_match", default=None)


def tree_bet(frac: float, pot: float) -> float:
    """The tree's bet for size `frac` into `pot` (gto/solver.py TreeBuilder._decision)."""
    return max(round(frac * pot * 2) / 2, 1.0)


def _swaps(st, oop: str, ip: str, stack: float) -> List[Optional[float]]:
    """The _swap_nearest calls _cfg_with_real_sizes makes for the street, in order: a bet's amount, None for the others
    (a raise, an all-in). Its own reading of the actions: who is in, the amount it takes, and a bet or raise of the whole
    stack read as an all-in."""
    out: List[Optional[float]] = []
    bets = [0.0, 0.0]
    for a in st.actions:
        if a["pos"] not in (oop, ip):
            continue
        p = 0 if a["pos"] == oop else 1
        act = a["action"]
        amt = a.get("amount") or a.get("to") if act == "bet" else a.get("to") or a.get("amount")
        if act in ("bet", "raise") and amt and (bets[p] + amt if act == "bet" else amt) >= stack - 1e-9:
            act = "all-in"
        if act == "bet" and amt:
            out.append(float(amt))
            bets[p] = float(amt)
        elif act == "raise" and amt:
            out.append(None)
            bets[p] = float(amt)
        elif act == "call":
            bets[p] = min(bets[1 - p], stack)
        elif act == "all-in":
            out.append(None)
            bets[p] = stack
    return out


def install() -> None:
    """Wraps Advisor._cfg_with_real_sizes, gto.advisor._swap_nearest and Advisor._tree_action_name (once)."""
    if getattr(A.Advisor._cfg_with_real_sizes, "_lizard_size_match", False):
        return
    cfg_real = A.Advisor._cfg_with_real_sizes
    swap = A._swap_nearest
    name_of = A.Advisor._tree_action_name

    def _cfg_with_real_sizes(self, st, oop, ip, stack):
        tok = _READING.set({"pot": float(st.pot_start), "swaps": _swaps(st, oop, ip, stack), "at": 0})
        try:
            return cfg_real(self, st, oop, ip, stack)
        finally:
            _READING.reset(tok)

    def _swap_nearest(sizes, frac, tol=0.15, fixed=None):
        r = _READING.get()
        if r is not None:
            amt = r["swaps"][r["at"]] if r["at"] < len(r["swaps"]) else None
            r["at"] += 1
            pot = r["pot"]
            # (this call is that bet's: its share of the street's pot is what _cfg_with_real_sizes passes)
            if amt is not None and sizes and frac > 0 and frac not in sizes and abs(frac * pot - amt) < 1e-6:
                same = [f for f in sizes if abs(tree_bet(f, pot) - amt) < 1e-6]
                if same:
                    frac = min(same, key=lambda f: abs(f - frac))
        return swap(sizes, frac, tol, fixed)

    def _tree_action_name(node, a, p, bets, pot, stack=float("inf")):
        name = name_of(node, a, p, bets, pot, stack)
        if a.get("action") != "bet" or not name.startswith("bet ") or name in node.names:
            return name
        amt = float(a.get("amount") or a.get("to") or 0.0)
        k = match_action(node.names, name)
        child = node.children[k] if 0 <= k < len(node.children) else None
        got = getattr(child, "bets", None)
        if node.names[k].startswith("bet ") and got is not None and abs(float(got[p]) - bets[p] - amt) < 1e-6:
            return node.names[k]
        return name

    _cfg_with_real_sizes._lizard_size_match = True
    _cfg_with_real_sizes.__doc__ = cfg_real.__doc__
    A.Advisor._cfg_with_real_sizes = _cfg_with_real_sizes
    A._swap_nearest = _swap_nearest
    A.Advisor._tree_action_name = staticmethod(_tree_action_name)


install()
