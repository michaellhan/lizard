"""A spot's description (spots.py) as a reference game. Reference code only."""
from __future__ import annotations

from refsolver.cards import parse_board, parse_range
from refsolver.hu import Chips, Holdem, HUGame
from refsolver.mw import MWGame
from refsolver.rules import HUSpec, Menu, MWSpec, hu_tree, mw_tree

STREETS = ("flop", "turn", "river")


def menu_of(spot: dict) -> Menu:
    m = spot["menu"]
    return Menu({s: list(m["bets"]) for s in STREETS}, {s: list(m["raises"]) for s in STREETS}, spot["max_raises"],
                spot["allin_spr"])


def hu_game(spot: dict, payoffs=None) -> HUGame:
    board = parse_board(spot["board"])
    ranges = spot.get("ranges_exact") or [parse_range(spot["oop"], board), parse_range(spot["ip"], board)]
    tree = hu_tree(HUSpec(len(board), spot["pot"], spot["stack"], menu_of(spot), tuple(spot.get("bets0", (0.0, 0.0))),
                          spot.get("to_act", 0), spot.get("n_raises", 0)))
    return HUGame(Holdem(board, ranges), tree, payoffs or Chips(spot.get("rake", 0.0), spot.get("cap")))


def mw_game(spot: dict) -> MWGame:
    board = parse_board(spot["board"])
    ranges = [parse_range(r, board) for r in spot["ranges"]]
    tree = mw_tree(MWSpec(3, spot["pot"], spot["stack"], spot["bet"], spot["raise_frac"], spot["max_raises"],
                          spot["allin_spr"]))
    return MWGame(board, ranges, tree, spot.get("rake", 0.0), spot.get("cap"))
