"""A browser flop model closer to the library's: the river dealt by card class inside a flop solve.

Upstream's flop library plays the turn per combo (one card per rank class) and deals the river: every river card under
each turn line, played on each card by `Config.river_dealt` buckets of strength there (gto/solver.py
TreeBuilder._river_dealt, flop_library.library_config). The browser's Fast and Accurate play the river blind instead:
by strength buckets without its card in single-raised pots (Config.river_strength, Ctx.river_table), on the turn's
boards in 3bet pots. docs/ACCURACY.md section 21 measured that blind river as most of what their flop strategies give up
against the full game. Dealing every river card is what makes the library's model too big for the browser (46 cards
under each of ~600 turn lines, each entered per combo: 6-18M cells and 0.7-1.3 GB on a single-raised flop).

With `Config.river_dealt` set together with `river_classes`, this module deals the river inside a flop solve as one
card per class (Ctx.turn_classes on the turn's board: one rank's cards, except that a suit with two or more board cards
has its own card per rank; 13 rivers on a turn with no two cards of a suit, ~24 with one flush suit, where dealing plays
46), each class standing for its cards as upstream's turn classes do. Upstream's builder never reads river_classes in a
flop solve, and the browser's Fast and Accurate configs set it (for their turn solves) without river_dealt, so nothing
upstream builds changes: only a config with both gets this.

Two ways, by the turn:

* **The turn by hand buckets** (`turn_buckets`, Fast's and Accurate's turn): the river is upstream's river-strength entry
  (RiverEntry, its decisions K wide, its X, E and kappa tables per turn board), with tables that deal the card. Its
  buckets are (class, strength) pairs: on each class's card each player's root range splits into `river_dealt` equal
  shares by equity there against the other's (Ctx.river_card_table, upstream's dealt-river buckets), and a turn bucket
  enters bucket (c, r) with the root-weighted share of its combos that land in r on c's card, times sqrt(n_c / (avail -
  4)): n_c the class's cards the combo leaves live, avail - 4 the rivers a pair of hands leaves. E and kappa are block
  diagonal (a showdown or a fold pays only within one card), so a pair of hands meets on class c with weight
  sqrt(n_c n'_c) / (avail - 4), the share of the rivers that class stands for (exactly where neither hand holds one of
  the class's cards; the two hands' live counts' geometric mean where one does): a chance node over the classes, each
  player seeing the card (its bucket says which), without a chance node in bucket space, which the compiled core
  doesn't have. The game stays zero-sum (E[1] = -E[0].T, kappa[1] = kappa[0].T, each block upstream's). The entry is
  (classes x river_dealt) wide, the most classes over the solve's turn boards; a turn with fewer classes leaves the
  rest of its columns empty (no reach). It replaces the blind river where upstream plays one, at a root stack to pot of
  Config.river_strength_spr (8) or more: below it (3bet pots) the river stays on the turn's boards by river_buckets,
  which on section 21's 3bet spot gave up less than 8 buckets on each card did (section 34).
* **The turn per combo** (no turn buckets, the library's turn): upstream's dealt river (a chance node, a bucket entry
  under each card) with one card per class in place of every card, weighted as upstream's turn classes are
  (TreeBuilder._turn_classes). Rows under one chance node need the same number of children, so a turn with fewer classes
  is padded with children of weight zero. Too big for the browser (section 34 of docs/ACCURACY.md); measured natively.

Measured, not shipped (docs/ACCURACY.md section 34): on section 21's narrow spots 8 buckets a card took the dry flop's
cost from 2.2% of the pot to 0.4-0.7, but not the two-tone one's (5.4 to 5.8 for in position), and dealt in the 3bet
pot too it gave up more there (hence the stack-to-pot gate above). On real ranges (section 24's report against the
library) it moved Accurate's flop further from the library's, at 6-16x the time an iteration. Nothing imports it but
scripts/benchmarks (abstraction.py, custom_report.py) and its test (scripts/engine/test_flop_model.py): the worker
doesn't, and outside engine/ the bundle doesn't carry it. solver/ is untouched.
"""
from __future__ import annotations

import numpy as np

from gto import solver as S

_street_over = S.TreeBuilder._street_over
_river_dealt0 = S.TreeBuilder._river_dealt
_river_table = S.Ctx.river_table
_table_request = S.Ctx.table_request


def dealt_by_class(cfg) -> bool:
    """A flop solve's river dealt by class over the turn's hand buckets (the module's docstring)."""
    return bool(getattr(cfg, "river_dealt", None) and getattr(cfg, "river_classes", False)
                and getattr(cfg, "turn_buckets", False) and getattr(cfg, "river_buckets", None))


def width(ctx, flop, dead) -> int:
    """The bucketed river's width in a flop solve: river_dealt times the most river classes over its turn boards."""
    w = getattr(ctx, "_dealt_width", None)
    if w is None:
        most = 0
        for t, _ in ctx.turn_classes(tuple(flop), dead):
            most = max(most, len(ctx.turn_classes(tuple(flop) + (t,), dead)))
        w = ctx._dealt_width = most * ctx.cfg.river_dealt
    return w


def _street_over_dealt(self, boards, pot, stack, bets, inv, allin):
    """TreeBuilder._street_over, with the river after a bucketed turn dealt by class (the module's docstring)."""
    cfg = self.cfg
    if not (dealt_by_class(cfg) and cfg.river_play and self.root_street_len == 3 and len(boards[0]) == 4
            and not self._blind and self._width and self.root_spr >= cfg.river_strength_spr):
        return _street_over(self, boards, pot, stack, bets, inv, allin)
    new_pot = pot + bets[0] + bets[1]
    new_stack = stack - max(bets)
    if allin or new_stack <= 1e-9 or len(boards[0]) - self.root_street_len + 1 < cfg.depth:
        return _street_over(self, boards, pot, stack, bets, inv, allin)
    outer = self._width
    self._blind, self._width, self._kind = True, width(self.ctx, boards[0][:3], self.dead), "r"
    try:
        d = self._decision(boards, new_pot, new_stack, (0.0, 0.0), 0, 0, inv, False)
    finally:
        self._blind, self._width, self._kind = False, outer, "b"
    return S.RiverEntry(boards, d, outer)


def _class_weight(ctx, c, cards_):
    """Per combo: the class's cards it leaves live (none if it holds the card played), as TreeBuilder._turn_classes."""
    return (len(cards_) - ctx.member[list(cards_)].sum(axis=0)) * (1.0 - ctx.member[c])


def dealt_table(ctx, board, dead, outer):
    """Ctx.river_table's (X, E, kappa) for a turn board with the river dealt by class (the module's docstring)."""
    board = tuple(board)
    key = ("rdealt", board, outer)
    T = ctx._stacks.get(key)
    if T is not None:
        return T
    K = ctx.cfg.river_dealt
    W = width(ctx, board[:3], dead)
    n = ctx.n
    cls = ctx.turn_classes(board, dead)
    avail = sum(1 for c in range(52) if c not in dead and c not in board)
    E = np.zeros((W, W))
    kap = np.zeros((W, W))
    Xc = np.zeros((2, n, W))                                       # per combo
    for k, (c, cards_) in enumerate(cls):
        ids, Ek, kk = ctx.river_card_table(board + (c,), dead, K)
        lo = k * K
        E[lo:lo + K, lo:lo + K] = Ek[0]
        kap[lo:lo + K, lo:lo + K] = kk[0]
        s = np.sqrt(_class_weight(ctx, c, cards_) / max(avail - 4, 1))
        for q in (0, 1):
            on = ids[q] < K
            Xc[q, np.flatnonzero(on), lo + ids[q][on]] = s[on]
    if outer:
        tids = ctx.bucket_table(board, dead, outer)[0]
        r = ctx._river_reach(board)
        X = np.zeros((2, outer, W))
        for q in (0, 1):
            Q = np.zeros((outer + 1, W))
            np.add.at(Q, tids[q], r[q][:, None] * Xc[q])
            wt = np.bincount(tids[q], weights=r[q], minlength=outer + 1)
            X[q] = (Q / np.maximum(wt, 1e-300)[:, None])[:outer]
    else:
        X = Xc
    T = (X.astype(np.float32), np.stack([E, -E.T]).astype(np.float32), np.stack([kap, kap.T]).astype(np.float32))
    ctx._stacks[key] = T
    return T


def _river_table_dealt(self, board, dead, K, outer):
    if dealt_by_class(self.cfg) and self.root_len == 3:
        return dealt_table(self, board, dead, outer)
    return _river_table(self, board, dead, K, outer)


def _table_request_dealt(self, kind, board, dead, K=0, outer=None):
    if kind == "river" and dealt_by_class(self.cfg) and self.root_len == 3:
        return None          # (built here, in numpy: not one of the core's tables)
    return _table_request(self, kind, board, dead, K, outer)


def _river_dealt(self, boards, pot, stack, inv):
    """TreeBuilder._river_dealt (the turn per combo), by card class when the config sets river_classes."""
    if not getattr(self.cfg, "river_classes", False):
        return _river_dealt0(self, boards, pot, stack, inv)
    ctx = self.ctx
    cls = [ctx.turn_classes(b, self.dead) for b in boards]
    K = max(len(c) for c in cls)
    child_boards = []
    masks = None if self.dry else np.zeros((len(boards) * K, ctx.n), dtype=np.float32)
    umasks = None if self.dry else np.zeros_like(masks)
    for bi, b in enumerate(boards):
        for ki in range(K):
            if ki >= len(cls[bi]):
                child_boards.append(b + (cls[bi][0][0],))      # (padding: weight zero)
                continue
            c, cards_ = cls[bi][ki]
            child_boards.append(b + (c,))
            if self.dry:
                continue
            live = _class_weight(ctx, c, cards_)
            masks[bi * K + ki] = live / len(cards_)
            umasks[bi * K + ki] = live
    self._width = self.cfg.river_dealt
    try:
        child = S.BucketEntry(child_boards, self._decision(child_boards, pot, stack, (0.0, 0.0), 0, 0, inv, False))
    finally:
        self._width = None
    self.n_nodes += 1
    if self.dry:
        return None
    avail = sum(1 for c in range(52) if c not in self.dead and c not in boards[0])
    return S.Chance(boards, K, masks, child, avail, umasks=umasks)


S.TreeBuilder._street_over = _street_over_dealt
S.TreeBuilder._river_dealt = _river_dealt
S.Ctx.river_table = _river_table_dealt
S.Ctx.table_request = _table_request_dealt
