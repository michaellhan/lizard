"""Lizard's repairs to the preflop charts as the advice serves them. solver/ is untouched: importing this module wraps
gto.pf_formats.moves. The worker imports it at start (scripts/pyodide/worker-edits.mjs), after the other engine patches.

1. 13 to 19bb. Above push/fold (Advisor's PUSH_FOLD_STACK, 12bb) and below the shallowest moved chart
   (pf_formats.MIN_DEPTH, 20bb), the charts were the 100bb ones, unmoved: the 6-max button opened 45.1% at 13 to 19bb
   as at 100bb, and 36.6% at 20bb. Those depths now play the 20bb game's moves (pf_formats.moves asked at 20bb).
   Advisor._priced re-prices the calls from 20bb to the table's depth, as it does from any chart's depth to the
   table's. The answer's note names the 20bb chart. The flop library has no spot at these depths.
"""
from __future__ import annotations

from gto import advisor as A
from gto import pf_formats as PF
from gto import preflop as P

# --------------------------------------------------------------------------------------------- 1. 13 to 19bb
SHALLOW = (A.PUSH_FOLD_STACK, PF.MIN_DEPTH)      # (push/fold at or below, the moved charts from)
_moves = PF.moves


def moves(hero, actions, positions):
    """pf_formats.moves, with a table between push/fold and 20bb asked at 20bb."""
    depth = float(getattr(positions, "depth", 100.0))
    if SHALLOW[0] < depth < SHALLOW[1] and isinstance(positions, P.Table):
        positions = P.at_depth(positions, SHALLOW[1])
    return _moves(hero, actions, positions)


def _clear():
    P._STRAT_CACHE.clear()
    A._PF_CACHE.clear()


def install():
    """The repairs in place (at import)."""
    PF.moves = moves
    _clear()


def uninstall():
    """The charts as upstream serves them (for a test's before, or a process that runs upstream's tests after)."""
    PF.moves = _moves
    _clear()


install()
