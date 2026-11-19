"""Lizard's repairs to the preflop charts as the advice serves them. solver/ is untouched: importing this module wraps
gto.pf_formats.moves, gto.preflop.strategy_for, gto.advisor._jam_range and _flat_ev, and Advisor._priced, _icm_open,
_push and _preflop_play. The worker imports it at start (scripts/pyodide/worker-edits.mjs), with the other engine patches. A local
server runs upstream without engine/, so there the charts are upstream's (13 to 19bb on the 100bb charts, hands out of
order as before).

1. 13 to 19bb. Above push/fold (Advisor's PUSH_FOLD_STACK, 12bb) and below the shallowest moved chart
   (pf_formats.MIN_DEPTH, 20bb), the charts were the 100bb ones, unmoved: the 6-max button opened 45.1% at 13 to 19bb
   as at 100bb, and 36.6% at 20bb. Those depths now play the 20bb game's moves (pf_formats.moves asked at 20bb).
   Advisor._priced re-prices the calls from 20bb to the table's depth, as it does from any chart's depth to the
   table's. The answer's note says so ("the 20bb chart, played at 15bb (the 100bb chart moved by solves of the 20bb
   game)"). The flop library has no spot at these depths.

2. Hand order. Over the audit's sweep of the charts as served (moved by pf_formats, re-priced by Advisor._priced, jams
   from push/fold), a hand continued less than one it dominates 6,267 times: by 0.25 or more, with both hands
   arriving at 5% or more. Most were by kicker (K4o continuing over K5o). At 469 nodes, AA or KK flatted over 60%
   while the next hand down raised more. Each node is now repaired as engine/pf_dominance.py says: continue
   frequency pooled along each family's chain where it breaks the order, and the premiums' raises pooled where a
   stronger hand raises less than its neighbour, each by the combos arriving at the node, so the range's mix is kept.

   The repair is applied to each node's own answer and goes no further. A node with no call to price (raising first
   in) is repaired as preflop.strategy_for gives it. The others are upstream's answer (Advisor._priced or _icm_open,
   priced against upstream's ranges: upstream()), then repaired. Pricing against the repaired ranges instead let one
   node's repair tip another's knife-edge re-draw: at 9-max 100bb a small blind squeezing more AA (0.09 to 0.71) had
   UTG's AKs fold 98.8% of the time where it had jammed 83%. And a hand that reaches a node only through an earlier
   repair, which upstream's re-draw never weighed there (6-max 200bb: J9s 3-betting 15% after pooling with JTs, then
   called a 5-bet 100% and with JTs went all-in for 200bb), plays the chart's own answer there (NEW_W). The jams
   (Advisor._push) are repaired too, and the jam range the later streets and the calls of it read (_jam_range) is the
   advice's own jams, so the advice and the ranges the later streets play are the same.

   The nodes that feed a published heads-up flop library spot are left as they were: the decisions of the players who
   reach its flop, on its line, at its table size and the decider's effective depth, with no ante or straddle, whatever
   a folded or deeper seat holds. So every spot's fingerprint holds (PUBLISHED; scripts/engine/test_pf_charts.py
   checks the list against the spots the repo builds, and against the library's index when there is one). Repaired,
   26 of the 57 would change (22 of the library's 53).

   Over the sweep (41,889 nodes): continue inversions 6,267 to 115, 77 of them at library nodes as before; premium
   flats 469 to 2, both at library nodes; raise inversions (not repaired outside the premiums) 2,151 to 851, 66 at
   library nodes. Away from them 38 continue inversions stay: 14 the big blind's check or raise over a heads-up limp
   (no fold to continue against), 24 facing an all-in (a call by equity against the jam range, as the ranges the
   later streets play read it). docs/ACCURACY.md section 18.9 has the measurements.

3. A short-stack jam's flat alternative. Where a raise would commit much of the stack, Advisor._push jams from the
   push/fold equilibrium with flatting as the alternative (advisor._flat_ev): the flat's EV times how often the chart
   continues with the hand, its raises included. So a hand the chart 3-bets took the whole flat's EV for its raising
   share too, though the jam stands in for that raise: the small blind at 20bb flatted 99 98.5% over a HJ open and
   97.2% over a CO's, and AJs 93.8% and 86.2%, where the stored preflop solve jams them by a fifth of the pot or more
   past its noise (docs/ACCURACY.md section 18.11). The flat's EV is now times how often the chart calls, so for its
   raising share a hand's jam is weighed against folding. What the jam doesn't take still calls, as upstream's _push
   serves it (the chart's continuing share that doesn't shove): a hand the chart only 3-bets, whose jam loses to
   folding, is served as a flat (over a 20bb HJ open without rake A2s-A5s, 65s, 76s, 98s and T9s, all inside the
   solve's noise there). Folding that share instead was measured and not kept: neither holding the call to the chart's
   call share nor folding only the combos the equilibrium never jams was better in every game. Nodes that feed a
   published flop library spot keep upstream's, as in 2, and so does upstream() (a node's answer before its repair).
"""
from __future__ import annotations

import contextlib
import re
from typing import Dict, Optional

import numpy as np

from gto import advisor as A
from gto import pf_formats as PF
from gto import pf_norake as NR
from gto import preflop as P
from gto.pf_classes import CLASS_OF, N_IN
from gto.ranges import N_COMBOS

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
# (id, players, stack in bb, line): the heads-up spots the repo builds (flop_library's SPOTS and FORMAT_SPOTS,
# scripts/library/build_breadth.py's SPOTS; test_pf_charts holds it to them): the library's 53, and four FORMAT_SPOTS
# it doesn't hold yet (HJ and UTG vs BB at 40bb and 200bb), left as they are so a build of them matches too
PUBLISHED = (
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
    ("srp_hj_bb_40bb", 6, 40.0, "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:c"),
    ("srp_utg_bb_40bb", 6, 40.0, "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:c"),
    ("srp_btn_bb_200bb", 6, 200.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"),
    ("srp_co_bb_200bb", 6, 200.0, "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c"),
    ("srp_sb_bb_200bb", 6, 200.0, "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c"),
    ("3bp_bb_btn_200bb", 6, 200.0, "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:c"),
    ("srp_hj_bb_200bb", 6, 200.0, "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:c"),
    ("srp_utg_bb_200bb", 6, 200.0, "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:c"),
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
    """Whether this chart node is one a published spot's ranges are made of (left unrepaired): its table size, the line,
    and the deciding player's effective depth (A._eff_stack), whatever a folded or deeper seat holds."""
    if getattr(positions, "ante", 0.0) or getattr(positions, "straddle", False):
        return False
    base = float(stack if stack is not None else P._depth(positions))
    depth = A._eff_stack(positions, hero, actions, base)
    return (len(positions or P.POSITIONS), round(depth, 2), hero, line_key(actions)) in FED


# ------------------------------------------------------------------------------------------------------ the wraps
_strategy_for = P.strategy_for
_priced = A.Advisor._priced
_icm_open = A.Advisor._icm_open
_push = A.Advisor._push
_preflop_play = A.Advisor._preflop_play
_jam_range = A._jam_range
_flat_ev = A._flat_ev
_SF_CACHE: Dict[tuple, tuple] = {}
# a class arriving at a node at least this much (its share of the class's combos) where upstream's ranges bring under it
# arrives only through a repair: upstream's re-draw there never weighed it, so it plays the chart's own answer
NEW_W = 0.01
# upstream's answers, apart from the served ones: Advisor's preflop cache (preflop_strategy, preflop_ranges) and the
# charts' (strategy_for's moves read the ranges replayed through the charts, e.g. _vs_4bet_range)
_UP = {"pf": {}, "strat": {}, "depth": 0}


@contextlib.contextmanager
def upstream():
    """Upstream's charts and their own caches, for a node's answer before its repair: 13 to 19bb still play the 20bb
    moves; no node is repaired."""
    if _UP["depth"]:
        yield
        return
    saved = (P.strategy_for, A.Advisor.__dict__["_priced"], A.Advisor.__dict__["_icm_open"], A._jam_range,
             A._flat_ev, A._PF_CACHE, P._STRAT_CACHE)
    P.strategy_for = _strategy_for
    A.Advisor._priced = staticmethod(_priced)
    A.Advisor._icm_open = staticmethod(_icm_open)
    A._jam_range = _jam_range
    A._flat_ev = _flat_ev
    A._PF_CACHE, P._STRAT_CACHE = _UP["pf"], _UP["strat"]
    _UP["depth"] = 1
    try:
        yield
    finally:
        _UP["depth"] = 0
        (P.strategy_for, A.Advisor._priced, A.Advisor._icm_open, A._jam_range, A._flat_ev, A._PF_CACHE,
         P._STRAT_CACHE) = saved


@contextlib.contextmanager
def _upstream_flat():
    """Upstream's flat alternative alone (a node that feeds a published spot), the rest as served."""
    saved = A._flat_ev
    A._flat_ev = _flat_ev
    try:
        yield
    finally:
        A._flat_ev = saved


def flat_ev(full, w, raiser, pot, to_call, behind=0.0):
    """advisor._flat_ev times how often the chart calls, not how often it continues (3. above): its raising share is
    the jam's, so it weighs nothing against it."""
    return _flat_ev({a: v for a, v in full.items() if a != "raise"}, w, raiser, pot, to_call, behind)


def _classes(v) -> np.ndarray:
    return np.bincount(CLASS_OF, weights=np.broadcast_to(np.asarray(v, float), CLASS_OF.shape),
                       minlength=len(N_IN)) / N_IN


def _arriving(hero, preflop, positions, stack):
    return A.preflop_ranges(preflop, positions, stack).get(hero)


def _repaired(out, chart, hero, preflop, positions, stack):
    """A node's upstream answer `out` repaired, by the combos the served ranges bring; a class only a repair brings
    (NEW_W) plays the chart's answer `chart` first."""
    arr = _arriving(hero, preflop, positions, stack)
    if arr is None:
        return repair(out)
    with upstream():
        up = _arriving(hero, preflop, positions, stack)
    if up is not None:
        new = (_classes(up) < NEW_W) & (_classes(arr) >= NEW_W)
        if new.any() and set(chart) == set(out):
            m = new[CLASS_OF]
            out = {a: np.where(m, np.broadcast_to(np.asarray(chart[a], float), m.shape),
                               np.broadcast_to(np.asarray(v, float), m.shape)) for a, v in out.items()}
    return repair(out, arr)


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
    """Upstream's re-priced answer, against upstream's ranges, then repaired. (`full` here is upstream's chart: a node
    with a call is one strategy_for leaves as it is.)"""
    with upstream():
        out = _priced(hero, preflop, positions, stack, st, full, notes, pool)
    if feeds_library(hero, preflop, positions, stack):
        return out
    return _repaired(out, full, hero, preflop, positions, stack)


def icm_open(hero, preflop, positions, stack, st, full, notes):
    """A tournament's raise first in: upstream's on upstream's chart, then repaired (every hand arrives)."""
    with upstream():
        out = _icm_open(hero, preflop, positions, stack, st, _strategy_for(hero, preflop, positions), notes)
    if feeds_library(hero, preflop, positions, stack):
        return out
    return repair(out, _arriving(hero, preflop, positions, stack))


def push(hero, preflop, positions, stack, st, jam, full, notes, pool=False, locks=()):
    """Advisor._push with the flat alternative of 3. above, then repaired (2.); what the jam doesn't take of the chart's
    continuing share calls, as upstream's does. A node that feeds a published spot is upstream's, its flat included."""
    if feeds_library(hero, preflop, positions, stack):
        with _upstream_flat():
            return _push(hero, preflop, positions, stack, st, jam, full, notes, pool, locks)
    out = _push(hero, preflop, positions, stack, st, jam, full, notes, pool, locks)
    return repair(out, _arriving(hero, preflop, positions, stack))


def advice_strategy(p, before, positions, stack):
    """advisor.preflop_strategy as p's own advice plays it: at a table without rake the chart is moved to no rake first
    (gto/pf_norake.py), as Advisor._preflop_play moves it, then priced. preflop_strategy moves only an exploit hero's
    chart (its `pool`), since the ranges entering the flop stay the charts' (the flop library's spots are keyed by them);
    a jam ends the betting, so a jam's range can be the jams the advice plays without moving any library spot."""
    pos = P.at_depth(positions, stack)

    def work():
        full = P.strategy_for(p, before, pos)
        nr = NR.chart(full, p, before, pos)
        if nr is full:
            return None
        st = A.replay_hand(pos, stack, {"preflop": before}, 1)[0]
        if "call" in nr and not st.closed and st.to_act == p:
            return A.Advisor._priced(p, before, pos, stack, st, nr, [], False)
        return nr

    out = A._pf_cached(A._pf_key("sn", p, before, pos, stack), work)
    return out if out is not None else A.preflop_strategy(p, before, positions, stack)


def jam_range(actions, ji, positions, stack, pool_except=None, locks=None):
    """An open- or 3bet-jam's range: the hands the advice jams there (Advisor._push, repaired), so the later streets
    and the calls of it read the jams the advice plays. Upstream's push/fold equilibrium here differed from the advice's
    by its flatting alternative (the chart's calls, not the re-priced ones) even unrepaired. Without rake it is the jams
    of the chart moved to no rake, as the advice plays them (advice_strategy). Later jams, the player pool's and a
    lock's are upstream's."""
    jammer, before = actions[ji]["pos"], actions[:ji]
    prev = A.replay_hand(positions, stack, {"preflop": before}, 1)[0]
    if pool_except is not None or locks or prev.n_raises > 1:
        return _jam_range(actions, ji, positions, stack, pool_except, locks)
    depth = A._eff_stack(positions, jammer, before, stack)
    full = advice_strategy(jammer, before, positions, depth)
    jam = A.replay_hand(positions, stack, {"preflop": actions[:ji + 1]}, 1)[0].bets[jammer]
    shove = A.Advisor._push(jammer, before, positions, stack, prev, jam, full, [], False, ()).get("raise")
    arr = A.preflop_ranges(before, positions, stack)
    rng = arr.get(jammer, np.ones(N_COMBOS))
    if shove is None:
        return _jam_range(actions, ji, positions, stack, pool_except, locks)
    share = float((rng * shove).sum() / max(rng.sum(), 1e-12))
    opp = [p for p in prev.order if p in prev.active and p != jammer]
    return rng * shove, [f"{jammer}'s {jam:g}bb jam range: push/fold equilibrium against {len(opp)} "
                         f"player{'s' * (len(opp) > 1)} left ({share:.0%} of their hands)"]


_SHALLOW_NOTE = re.compile(r"^preflop: the (.+?) chart \(the 100bb chart moved by solves of this game\)$")


def preflop_play(self, hero, hole, preflop, positions, stack, t0, pool=False, locks=()):
    """The preflop answer, its note saying when a 13 to 19bb table plays the 20bb chart."""
    res = _preflop_play(self, hero, hole, preflop, positions, stack, t0, pool, locks)
    depth = float(getattr(positions, "depth", stack))
    if SHALLOW[0] < depth < SHALLOW[1] and res.get("notes"):
        res["notes"] = [_SHALLOW_NOTE.sub(lambda m: f"preflop: the {m.group(1)} chart, played at {depth:g}bb (the 100bb "
                                          f"chart moved by solves of the {m.group(1)} game)", n) for n in res["notes"]]
    return res


def _clear():
    P._STRAT_CACHE.clear()
    A._PF_CACHE.clear()
    _SF_CACHE.clear()
    _UP["pf"].clear()
    _UP["strat"].clear()


def install():
    """The repairs in place (at import)."""
    PF.moves = moves
    P.strategy_for = strategy_for
    A._jam_range = jam_range
    A._flat_ev = flat_ev
    A.Advisor._priced = staticmethod(priced)
    A.Advisor._icm_open = staticmethod(icm_open)
    A.Advisor._push = staticmethod(push)
    A.Advisor._preflop_play = preflop_play
    _clear()


def uninstall():
    """The charts as upstream serves them (for a test's before, or a process that runs upstream's tests after)."""
    PF.moves = _moves
    P.strategy_for = _strategy_for
    A._jam_range = _jam_range
    A._flat_ev = _flat_ev
    A.Advisor._priced = staticmethod(_priced)
    A.Advisor._icm_open = staticmethod(_icm_open)
    A.Advisor._push = staticmethod(_push)
    A.Advisor._preflop_play = _preflop_play
    _clear()


install()
