"""Lizard's repairs to the preflop charts as the advice serves them. solver/ is untouched: importing this module wraps
gto.pf_formats.moves, gto.preflop.strategy_for and gto.advisor.Advisor._priced, _icm_open and _push. The worker imports it
at start (scripts/pyodide/worker-edits.mjs), after the other engine patches.

1. 13 to 19bb. Above push/fold (Advisor's PUSH_FOLD_STACK, 12bb) and below the shallowest moved chart
   (pf_formats.MIN_DEPTH, 20bb), the charts were the 100bb ones, unmoved: the 6-max button opened 45.1% at 13 to 19bb
   as at 100bb, and 36.6% at 20bb. Those depths now play the 20bb game's moves (pf_formats.moves asked at 20bb).
   Advisor._priced re-prices the calls from 20bb to the table's depth, as it does from any chart's depth to the
   table's. The answer's note names the 20bb chart. The flop library has no spot at these depths.

2. Hand order. Over the audit's sweep of the charts as served (moved by pf_formats, re-priced by Advisor._priced, jams
   from push/fold), a hand continued less than one it dominates 6,267 times: by 0.25 or more, with both hands
   arriving at 5% or more. Most were by kicker (K4o continuing over K5o). At 469 nodes, AA or KK flatted over 60%
   while the next hand down raised more. Each node is now repaired as engine/pf_dominance.py says: continue
   frequency pooled along each family's chain where it breaks the order, and the premiums' raises pooled where a
   stronger hand raises less than its neighbour, each by the combos arriving at the node, so the range's mix is kept.
   A node with no call to price (raising first in) is repaired as preflop.strategy_for gives it, the others as
   Advisor._priced, _icm_open or _push answer them, so the advice and the ranges the later streets play are the same.

   The nodes that feed a published heads-up flop library spot are left as they were: the decisions of the players who
   reach its flop, on its line, at its table size and depth, with no ante or straddle. So every spot's fingerprint
   holds (PUBLISHED; scripts/engine/test_pf_charts.py checks the list against the library's index when there is one).
   Repaired, 22 of the 53 spots would change.

   Left over the same sweep after the repair (2026-11-18): 108 continue inversions, 70 of them at those library nodes,
   14 at the big blind's check or raise over a heads-up limp (no fold to continue against), and 24 facing an all-in,
   where the call is by equity against the jam (Advisor._vs_jam, and preflop_ranges the same way inline, so repairing
   the advice alone would split it from the ranges; each within 1.3% equity). 2 premium flats, both at library nodes
   (8-max 100bb, the big blind's KK over UTG's and UTG1's opens).
"""
from __future__ import annotations

from typing import Dict, Optional

from gto import advisor as A
from gto import pf_formats as PF
from gto import preflop as P

from .pf_dominance import repair

# --------------------------------------------------------------------------------------------- 1. 13 to 19bb
SHALLOW = (A.PUSH_FOLD_STACK, PF.MIN_DEPTH)      # (push/fold at or below, the moved charts from)
_moves = PF.moves


def moves(hero, actions, positions):
    """pf_formats.moves, with a table between push/fold and 20bb asked at 20bb."""
    depth = float(getattr(positions, "depth", 100.0))
    if SHALLOW[0] < depth < SHALLOW[1] and isinstance(positions, P.Table):
        positions = P.at_depth(positions, SHALLOW[1])
    return _moves(hero, actions, positions)


# ------------------------------------------------------------------------- the nodes that feed published library spots
PUBLISHED = (    # (id, players, stack in bb, line): the flop library's heads-up spots (library index.json)
    ("srp_btn_bb", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"),
    ("srp_co_bb", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c"),
    ("3bp_bb_btn", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:c"),
    ("srp_sb_bb", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c"),
    ("3bp_btn_co", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:r7.5,SB:f,BB:f,CO:c"),
    ("srp_hj_bb", 6, 100.0, "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:c"),
    ("srp_utg_bb", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:c"),
    ("3bp_sb_btn", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:r10,BB:f,BTN:c"),
    ("srp_hj_co", 6, 100.0, "UTG:f,HJ:r2.5,CO:c,BTN:f,SB:f,BB:f"),
    ("srp_btn_sb", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:c,BB:f"),
    ("srp_utg_hj", 6, 100.0, "UTG:r2.5,HJ:c,CO:f,BTN:f,SB:f,BB:f"),
    ("srp_co_sb", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:c,BB:f"),
    ("srp_utg_btn", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:c,SB:f,BB:f"),
    ("3bp_sb_co", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:r10,BB:f,CO:c"),
    ("3bp_hj_utg", 6, 100.0, "UTG:r2.5,HJ:r7.5,CO:f,BTN:f,SB:f,BB:f,UTG:c"),
    ("3bp_bb_co", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:r10,CO:c"),
    ("3bp_co_hj", 6, 100.0, "UTG:f,HJ:r2.5,CO:r7.5,BTN:f,SB:f,BB:f,HJ:c"),
    ("3bp_bb_sb", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:r10,SB:c"),
    ("srp_sb_bb_2max", 2, 100.0, "SB:r3,BB:c"),
    ("lp_sb_bb_2max", 2, 100.0, "SB:c,BB:x"),
    ("srp_btn_bb_40bb", 6, 40.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"),
    ("srp_co_bb_40bb", 6, 40.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c"),
    ("srp_sb_bb_40bb", 6, 40.0, "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c"),
    ("3bp_bb_btn_40bb", 6, 40.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:c"),
    ("srp_btn_bb_200bb", 6, 200.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"),
    ("srp_co_bb_200bb", 6, 200.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c"),
    ("srp_sb_bb_200bb", 6, 200.0, "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c"),
    ("3bp_bb_btn_200bb", 6, 200.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:c"),
    ("srp_hj_sb", 6, 100.0, "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:c,BB:f"),
    ("srp_co_btn", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:f"),
    ("srp_utg_sb", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:c,BB:f"),
    ("3bp_btn_utg", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:r7.5,SB:f,BB:f,UTG:c"),
    ("3bp_sb_utg", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:r10,BB:f,UTG:c"),
    ("3bp_bb_hj", 6, 100.0, "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:r10,HJ:c"),
    ("3bp_sb_hj", 6, 100.0, "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:r10,BB:f,HJ:c"),
    ("3bp_bb_utg", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:r10,UTG:c"),
    ("srp_btn_bb_8max", 8, 100.0, "UTG:f,UTG1:f,LJ:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"),
    ("srp_sb_bb_8max", 8, 100.0, "UTG:f,UTG1:f,LJ:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c"),
    ("srp_co_bb_8max", 8, 100.0, "UTG:f,UTG1:f,LJ:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c"),
    ("srp_utg_bb_8max", 8, 100.0, "UTG:r2.5,UTG1:f,LJ:f,HJ:f,CO:f,BTN:f,SB:f,BB:c"),
    ("srp_hj_bb_8max", 8, 100.0, "UTG:f,UTG1:f,LJ:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:c"),
    ("4bp_utg_hj", 6, 100.0, "UTG:r2.5,HJ:r7.5,CO:f,BTN:f,SB:f,BB:f,UTG:r17.25,HJ:c"),
    ("4bp_hj_co", 6, 100.0, "UTG:f,HJ:r2.5,CO:r7.5,BTN:f,SB:f,BB:f,HJ:r17.25,CO:c"),
    ("4bp_co_btn", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:r7.5,SB:f,BB:f,CO:r17.25,BTN:c"),
    ("4bp_utg_btn", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:r7.5,SB:f,BB:f,UTG:r17.25,BTN:c"),
    ("4bp_utg_sb", 6, 100.0, "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:r10,BB:f,UTG:r23,SB:c"),
    ("4bp_btn_sb", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:r10,BB:f,BTN:r23,SB:c"),
    ("4bp_btn_bb", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:r23,BB:c"),
    ("4bp_sb_bb", 6, 100.0, "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:r10,SB:r23,BB:c"),
    ("4bp_co_sb", 6, 100.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:r10,BB:f,CO:r23,SB:c"),
    ("srp_lj_bb_8max", 8, 100.0, "UTG:f,UTG1:f,LJ:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:c"),
    ("srp_utg1_bb_8max", 8, 100.0, "UTG:f,UTG1:r2.5,LJ:f,HJ:f,CO:f,BTN:f,SB:f,BB:c"),
    ("srp_utg_utg1_8max", 8, 100.0, "UTG:r2.5,UTG1:c,LJ:f,HJ:f,CO:f,BTN:f,SB:f,BB:f"),
)
_CODE = {"f": "fold", "c": "call", "x": "check", "r": "raise"}


def _tok(pos: str, action: str, to=None) -> Optional[tuple]:
    """A move as the key reads it; None for a fold (folds change no one's range or price)."""
    if action == "fold":
        return None
    if action in ("raise", "all-in", "bet"):
        return (pos, "raise", round(float(to or 0.0), 2))
    return (pos, "call" if action == "call" else "check")


def line_key(actions) -> tuple:
    """A preflop line as a node key: its moves but the folds."""
    out = []
    for a in actions:
        t = _tok(str(a["pos"]), a["action"], a.get("to", a.get("amount")))
        if t is not None:
            out.append(t)
    return tuple(out)


def fed_nodes(published=PUBLISHED) -> frozenset:
    """{(players, depth, hero, line_key)}: each decision on a spot's line by a player who reaches its flop."""
    out = set()
    for _, n, stack, line in published:
        acts = []
        for part in line.split(","):
            pos, code = part.split(":")
            act = _CODE[code[0]]
            acts.append({"pos": pos, "action": act, **({"to": float(code[1:])} if act == "raise" else {})})
        for i, a in enumerate(acts):
            if a["action"] != "fold":
                out.add((n, float(stack), a["pos"], line_key(acts[:i])))
    return frozenset(out)


FED = fed_nodes()


def feeds_library(hero: str, actions, positions, stack: Optional[float] = None) -> bool:
    """Whether this chart node is one a published spot's ranges are made of (left unrepaired)."""
    if getattr(positions, "ante", 0.0) or getattr(positions, "straddle", False):
        return False
    stacks = getattr(positions, "stacks", None)
    if stacks and len({round(float(v), 2) for v in stacks.values()}) > 1:
        return False
    depth = float(stack if stack is not None else getattr(positions, "depth", 100.0))
    return (len(positions or P.POSITIONS), round(depth, 2), hero, line_key(actions)) in FED


# ------------------------------------------------------------------------------------------------------ the wraps
_strategy_for = P.strategy_for
_priced = A.Advisor._priced
_icm_open = A.Advisor._icm_open
_push = A.Advisor._push
_SF_CACHE: Dict[tuple, tuple] = {}


def _arriving(hero, preflop, positions, stack):
    return A.preflop_ranges(preflop, positions, stack).get(hero)


def strategy_for(hero, actions, positions=None):
    """preflop.strategy_for repaired where it is the node's answer: a node with no call to price (raising first in,
    the big blind's option over limps), where hero has not acted, so every hand arrives. The others are repaired as
    Advisor._priced answers them."""
    full = _strategy_for(hero, actions, positions)
    if "call" in full or feeds_library(hero, actions, positions):
        return full
    key = (hero, tuple((a["pos"], a["action"], a.get("to"), a.get("amount")) for a in actions),
           tuple(positions or P.POSITIONS), getattr(positions, "ante", 0.0), getattr(positions, "straddle", False),
           P.chart_depth(positions), P._depth(positions), P.stacks_key(positions))
    hit = _SF_CACHE.get(key)
    if hit is None or any(a is not b for a, b in zip(hit[0], full.values())) or len(hit[0]) != len(full):
        if len(_SF_CACHE) > 4096:
            _SF_CACHE.clear()
        hit = (tuple(full.values()), repair(full))
        _SF_CACHE[key] = hit
    return dict(hit[1])


def priced(hero, preflop, positions, stack, st, full, notes, pool=False):
    out = _priced(hero, preflop, positions, stack, st, full, notes, pool)
    if feeds_library(hero, preflop, positions, stack):
        return out
    return repair(out, _arriving(hero, preflop, positions, stack))


def icm_open(hero, preflop, positions, stack, st, full, notes):
    out = _icm_open(hero, preflop, positions, stack, st, full, notes)
    if feeds_library(hero, preflop, positions, stack):
        return out
    return repair(out, _arriving(hero, preflop, positions, stack))


def push(hero, preflop, positions, stack, st, jam, full, notes, pool=False, locks=()):
    out = _push(hero, preflop, positions, stack, st, jam, full, notes, pool, locks)
    if feeds_library(hero, preflop, positions, stack):
        return out
    return repair(out, _arriving(hero, preflop, positions, stack))


def _clear():
    P._STRAT_CACHE.clear()
    A._PF_CACHE.clear()
    _SF_CACHE.clear()


def install():
    """The repairs in place (at import)."""
    PF.moves = moves
    P.strategy_for = strategy_for
    A.Advisor._priced = staticmethod(priced)
    A.Advisor._icm_open = staticmethod(icm_open)
    A.Advisor._push = staticmethod(push)
    _clear()


def uninstall():
    """The charts as upstream serves them (for a test's before, or a process that runs upstream's tests after)."""
    PF.moves = _moves
    P.strategy_for = _strategy_for
    A.Advisor._priced = staticmethod(_priced)
    A.Advisor._icm_open = staticmethod(_icm_open)
    A.Advisor._push = staticmethod(_push)
    _clear()


install()
