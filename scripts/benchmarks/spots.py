"""The benchmark's spots, as plain data both sides read: no engine or reference objects here.

A spot is a board, two or three ranges (refsolver.cards.parse_range's text), the pot and stacks, a size menu, and which
reference it gets: "lp" (exact, zero-sum heads-up) or "cfr" (the reference's DCFR, for raked games, where the LP doesn't
apply, and for three-way rivers). The ranges are narrow because the point is exact comparison, not realism.
"""
from __future__ import annotations

from typing import Dict, List, Optional

ONE = {"bets": [0.75], "raises": [0.75]}
TWO = {"bets": [0.5, 1.0], "raises": [0.5, 1.0]}
R_OOP = "99,77,33,K9s,K7s,AKs,KQs,QJs,JTs,T8s,65s,54s"
R_IP = "AKo,KQo,KJo,KTs,A9s,QQ,JJ,98s,87s,AJs"


def hu(name, board, oop, ip, pot, stack, menu, reference="lp", engine_iters=(300, 3000, 30000), ref_iters=20000,
       max_raises=2, allin_spr=0.0, rake=0.0, cap=None, what="", **extra) -> dict:
    return dict(name=name, kind="hu", board=board, oop=oop, ip=ip, pot=pot, stack=stack, menu=menu, reference=reference,
                engine_iters=list(engine_iters), ref_iters=ref_iters, max_raises=max_raises, allin_spr=allin_spr,
                rake=rake, cap=cap, what=what, **extra)


def mw(name, board, ranges, pot, stack, bet, reference="cfr", engine_iters=(300, 3000, 30000), ref_iters=30000,
       raise_frac=0.75, max_raises=2, allin_spr=0.0, rake=0.0, cap=None, what="") -> dict:
    return dict(name=name, kind="mw", board=board, ranges=ranges, pot=pot, stack=stack, bet=bet, reference=reference,
                engine_iters=list(engine_iters), ref_iters=ref_iters, raise_frac=raise_frac, max_raises=max_raises,
                allin_spr=allin_spr, rake=rake, cap=cap, what=what)


RIVER_BOARD = "Ks7d2c3h9s"
TURN_OOP, TURN_IP = "77,33,K3s,KQs,QJs,76s", "AKs,KJs,QQ,JTs,98s"
SPOTS: List[dict] = [
    hu("river-one-size", RIVER_BOARD, R_OOP, R_IP, 20, 60, ONE, what="dry river, one bet and raise size"),
    hu("river-two-sizes", RIVER_BOARD, R_OOP, R_IP, 20, 60, TWO, allin_spr=2.5,
       what="dry river, two sizes, all-in on the menu"),
    hu("river-low-spr", RIVER_BOARD, R_OOP, R_IP, 40, 16, ONE, what="stack under the pot: all-ins and folds"),
    hu("river-flush", "Ah9h4h7c2d", "KhQh,JhTh,AsKs,AdQd,99,44,77,Kh9c,QhJs,Th9d,Ts9c,As4c",
       "AcKc,KsKh,Qh8h,6h5h,Jh8h,AcQc,AsTs,8h8d,9c8c,Ac9d", 20, 40, TWO, allin_spr=2.5,
       what="monotone river: flush blockers"),
    hu("river-board-plays", "5c6d7h8s9c", "JTs,J9o:0.5,TT,JJ,AA,KK,Ts9d,AsKs,AhQh,T7s",
       "T9s,QQ,AdKd,AcTc,TsJh,AsQd,KdQc,Td8c,T4s", 20, 40, ONE,
       what="straight on the board: many ties, a higher straight wins"),
    hu("river-weighted", "KcKd7s7h2c", "AA:0.5,KQs,QQ:0.25,JJ,A7s:0.75,87s,T9s:0.5,K2s,76s,65s:0.4",
       "KJs:0.5,AQo:0.33,QQ,TT:0.6,99,A2s,22:0.1,AKo:0.2", 20, 50, ONE, allin_spr=2.5,
       what="double-paired board, fractional weights"),
    hu("river-app-menu", RIVER_BOARD,
       "AA,KK,QQ,JJ,TT,99,88,77,AKs,AQs,AJs,ATs,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,AKo,AQo,KQo",
       "AK,AQ,AJs,ATs,A9s,KQ,KJ,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,76s,99,88,77,66,55,44,33,22",
       20, 90, {"bets": [0.33, 0.75, 1.25, 2.5], "raises": [0.75]}, allin_spr=2.5, engine_iters=(300, 3000, 10000),
       lp_method="highs-ipm", bounds=False, ref_iters=3000, what="wider river with the app's river menu"),
    hu("river-rake-5pct-cap2", RIVER_BOARD, R_OOP, R_IP, 20, 60, ONE, reference="cfr", rake=0.05, cap=2.0,
       what="river-one-size with 5% rake capped at 2 bb: the cap binds on any called bet"),
    hu("river-rake-5pct-nocap", RIVER_BOARD, R_OOP, R_IP, 20, 60, ONE, reference="cfr", rake=0.05,
       what="river-one-size with 5% rake and no cap"),
    hu("turn-one-size", "Ks7d2c3h", TURN_OOP,
       TURN_IP, 20, 40, ONE, engine_iters=(300, 3000), ref_iters=6000, lp_method="highs-ipm",
       what="turn, every river dealt, one size"),
    hu("turn-rake", "Ks7d2c3h", TURN_OOP,
       TURN_IP, 20, 40, ONE, reference="cfr", rake=0.05, cap=3.0,
       engine_iters=(300, 3000), ref_iters=6000, what="turn-one-size with 5% rake capped at 3 bb"),
    hu("turn-low-spr", "Qh8d3c5s", "QJs,88,33,JTs,A5s,76s",
       "AQs,KQs,55,T9s,KJs", 30, 18, ONE, engine_iters=(300, 3000), ref_iters=6000, lp_method="highs-ipm",
       what="turn with all-ins before the river: equity run-outs"),
    hu("flop-tiny", "Ks7d2c", "KQs,77,A2s,98s", "AKs,KJo,QQ,JTs", 20, 14, ONE, reference="cfr",
       engine_iters=(300, 3000), ref_iters=3000, what="flop, every turn and river dealt, low stack, tiny ranges"),
    mw("3way-river-one-size", RIVER_BOARD, ["KQs,QQ,JJ,98s,A2s,KJs", "AKs,99,77,QJs,JTs,KTo", "KTs,TT,AQs,87s,A3s,76s"],
       30, 60, [0.5], what="three-way river, one size, one raise"),
    mw("3way-river-low-spr", RIVER_BOARD, ["KQs,QQ,JJ,98s,A2s,KJs", "AKs,99,77,QJs,JTs,KTo", "KTs,TT,AQs,87s,A3s,76s"],
       30, 20, [0.5], allin_spr=1.5, what="three-way river, stacks under the pot, all-ins"),
    mw("3way-river-rake", RIVER_BOARD, ["KQs,QQ,JJ,98s,A2s,KJs", "AKs,99,77,QJs,JTs,KTo", "KTs,TT,AQs,87s,A3s,76s"],
       30, 60, [0.5], rake=0.05, cap=3.0, what="three-way river with 5% rake capped at 3 bb"),
]
BY_NAME: Dict[str, dict] = {s["name"]: s for s in SPOTS}


def get(name: str) -> dict:
    return BY_NAME[name]
