"""Cards, ranges and a hand evaluator, from the rules of Texas hold'em.

A card here is suit * 13 + rank, rank 0 being the deuce and 12 the ace, suits in the order s h d c. (The engine numbers
cards differently on purpose; the two only ever meet through strings such as "Ah".)

score(hands) gives each hand of five, six or seven cards one integer, higher beating lower and equal being a tie:
the category in the high bits, then the ranks that break ties within it, four bits each. It looks only at what the
rules look at: how many of each rank, how many of each suit, which ranks make a straight.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Sequence, Tuple

import numpy as np

RANKS = "23456789TJQKA"
SUITS = "shdc"

HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH = range(9)
CATEGORY_NAMES = ["high card", "pair", "two pair", "trips", "straight", "flush", "full house", "quads",
                  "straight flush"]
CATEGORY_SHIFT = 20


def card_id(text: str) -> int:
    return SUITS.index(text[1].lower()) * 13 + RANKS.index(text[0].upper())


def card_text(c: int) -> str:
    return RANKS[c % 13] + SUITS[c // 13]


def parse_board(text: str) -> List[int]:
    text = text.replace(" ", "")
    return [card_id(text[i:i + 2]) for i in range(0, len(text), 2)]


def combo_text(a: int, b: int) -> str:
    """A combo's name: the higher rank first, then by suit, so that one combo has one name."""
    a, b = sorted((a, b), key=lambda c: (c % 13, -(c // 13)), reverse=True)
    return card_text(a) + card_text(b)


def _combos_of_class(token: str) -> List[Tuple[int, int]]:
    """'AA', 'AKs', 'AKo', 'AK' (either) or an exact combo 'AhKd'."""
    if len(token) == 4:
        return [(card_id(token[:2]), card_id(token[2:]))]
    hi, lo = RANKS.index(token[0].upper()), RANKS.index(token[1].upper())
    kind = token[2].lower() if len(token) == 3 else ""
    out = []
    for s in range(4):
        for t in range(4):
            a, b = s * 13 + hi, t * 13 + lo
            if a == b or (hi == lo and s > t):
                continue
            if hi != lo and ((kind == "s" and s != t) or (kind == "o" and s == t)):
                continue
            out.append((a, b))
    return out


def parse_range(text: str, board: Sequence[int] = ()) -> Dict[str, float]:
    """'AA, KQs:0.5, 7h6h' -> {combo name: weight}, leaving out combos that hold a board card."""
    dead = set(board)
    out: Dict[str, float] = {}
    for raw in text.split(","):
        raw = raw.strip()
        if not raw:
            continue
        token, _, weight = raw.partition(":")
        for a, b in _combos_of_class(token.strip()):
            if a in dead or b in dead:
                continue
            out[combo_text(a, b)] = float(weight) if weight else 1.0
    return out


def combo_cards(name: str) -> Tuple[int, int]:
    return card_id(name[:2]), card_id(name[2:])


# 13-bit rank sets: the rank of the highest card, and the top rank of the highest straight (+1; 0: none)
_HIGHEST = np.zeros(1 << 13, dtype=np.int64) - 1
_STRAIGHT_TOP = np.zeros(1 << 13, dtype=np.int64)
for _m in range(1, 1 << 13):
    _HIGHEST[_m] = 12 - (format(_m, "013b").index("1"))
for _top in range(3, 13):                               # a five-high straight (A2345) up to ace-high
    _need = sum(1 << ((_top - k) % 13) for k in range(5)) if _top > 3 else 0b1000000001111
    for _m in range(1 << 13):
        if _m & _need == _need:
            _STRAIGHT_TOP[_m] = _top + 1


def _take_top(mask: np.ndarray, k: int) -> np.ndarray:
    """The k highest ranks in each rank set packed into four-bit fields (rank + 1), highest first."""
    out = np.zeros(len(mask), dtype=np.int64)
    mask = mask.copy()
    for _ in range(k):
        h = _HIGHEST[mask]
        out = (out << 4) | (h + 1)
        mask = mask & ~(np.int64(1) << np.maximum(h, 0))
    return out


def score(hands: np.ndarray) -> np.ndarray:
    """hands: (N, k) card ids, k >= 5 -> (N,) int64 scores."""
    hands = np.asarray(hands, dtype=np.int64)
    n, k = hands.shape
    rank, suit = hands % 13, hands // 13
    rows = np.arange(n)
    count = np.zeros((n, 13), dtype=np.int64)
    for j in range(k):
        count[rows, rank[:, j]] += 1
    bit = np.int64(1) << np.arange(13, dtype=np.int64)
    at_least = [None] + [((count >= c) * bit).sum(axis=1) for c in (1, 2, 3, 4)]
    has1, has2, has3, has4 = at_least[1:]

    suited = np.zeros((n, 4), dtype=np.int64)
    for j in range(k):
        suited[rows, suit[:, j]] |= np.int64(1) << rank[:, j]
    suit_counts = np.zeros((n, 4), dtype=np.int64)
    for j in range(k):
        suit_counts[rows, suit[:, j]] += 1
    flush_suit = suit_counts.argmax(axis=1)
    is_flush = suit_counts[rows, flush_suit] >= 5
    flush_ranks = np.where(is_flush, suited[rows, flush_suit], 0)

    out = np.full(n, -1, dtype=np.int64)

    def assign(where, category, tiebreak):
        out[where] = (category << CATEGORY_SHIFT) | tiebreak[where]

    # lowest category first, each better one overwriting
    assign(np.ones(n, dtype=bool), HIGH_CARD, _take_top(has1, 5))

    paired = has2 != 0
    pr = _HIGHEST[has2]
    no_top_pair = has1 & ~(np.int64(1) << np.maximum(pr, 0))
    second_pair_set = has2 & ~(np.int64(1) << np.maximum(pr, 0))
    two_pair = second_pair_set != 0
    assign(paired & ~two_pair, PAIR, ((pr + 1) << 12) | _take_top(no_top_pair, 3))
    p2 = _HIGHEST[second_pair_set]
    rest = no_top_pair & ~(np.int64(1) << np.maximum(p2, 0))
    assign(two_pair, TWO_PAIR, ((pr + 1) << 8) | ((p2 + 1) << 4) | _take_top(rest, 1))

    trip = _HIGHEST[has3]
    trips = has3 != 0
    no_trip = has1 & ~(np.int64(1) << np.maximum(trip, 0))
    assign(trips, TRIPS, ((trip + 1) << 8) | _take_top(no_trip, 2))

    st = _STRAIGHT_TOP[has1]
    assign(st > 0, STRAIGHT, st)
    assign(is_flush, FLUSH, _take_top(flush_ranks, 5))

    other_pair = _HIGHEST[has2 & ~(np.int64(1) << np.maximum(trip, 0))]
    full = trips & (other_pair >= 0)
    assign(full, FULL_HOUSE, ((trip + 1) << 4) | (other_pair + 1))

    quad = _HIGHEST[has4]
    quads = has4 != 0
    no_quad = has1 & ~(np.int64(1) << np.maximum(quad, 0))
    assign(quads, QUADS, ((quad + 1) << 4) | _take_top(no_quad, 1))

    sf = _STRAIGHT_TOP[flush_ranks]
    assign(sf > 0, STRAIGHT_FLUSH, sf)
    return out


def category(scores: np.ndarray) -> np.ndarray:
    return np.asarray(scores) >> CATEGORY_SHIFT


def all_combinations(n: int, k: int) -> np.ndarray:
    """Every k-subset of range(n) as a (C(n, k), k) array, in lexicographic order."""
    if k == 0:
        return np.zeros((1, 0), dtype=np.int16)
    parts = []
    for first in range(n - k + 1):
        tail = all_combinations(n - first - 1, k - 1)
        parts.append(np.column_stack([np.full(len(tail), first, dtype=np.int16), tail + first + 1]))
    return np.concatenate(parts)


def hands_with_board(hole: Iterable[Tuple[int, int]], board: Sequence[int]) -> np.ndarray:
    hole = np.array(list(hole), dtype=np.int64).reshape(-1, 2)
    b = np.tile(np.array(board, dtype=np.int64), (len(hole), 1))
    return np.concatenate([hole, b], axis=1)
