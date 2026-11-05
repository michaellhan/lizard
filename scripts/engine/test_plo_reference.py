"""The reference has to be right before anything is compared with it: the published frequencies of five-card poker, every
one of the 2,598,960 hands (about 8 s), and PLO's rule, each trap worked by hand.

Run: .venv/bin/python -m unittest scripts/engine/test_plo_reference.py
"""
import sys
import unittest
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plo_reference import DECK, Mulberry32, best_plo, equity_exact, parse, rank5, side_pots  # noqa: E402


def v(hole, board):
    return best_plo(parse(hole), parse(board))


class FiveCards(unittest.TestCase):
    def test_every_hand_counts_as_published(self):
        counts = [0] * 9
        distinct = set()
        for hand in combinations(DECK, 5):
            value = rank5(hand)
            counts[value[0]] += 1
            distinct.add(value)
        # high card, pair, two pair, trips, straight, flush, full house, quads, straight flush (royals among them)
        self.assertEqual(counts, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40])
        self.assertEqual(len(distinct), 7462)


class TwoAndThree(unittest.TestCase):
    def test_four_of_a_suit_in_the_hand_is_only_a_flush_with_three_on_the_board(self):
        self.assertEqual(v("AsKsQsJs", "2s7s9sTd3c")[0], 5)
        self.assertEqual(v("AsKsQsJs", "2s7sTd3c9h")[0], 0)  # two on the board: no flush, however many in the hand

    def test_a_four_flush_board_needs_two_in_the_hand(self):
        self.assertEqual(v("Js9d8c7h", "As Ks Qs 2s 3d")[0], 0)  # one spade: no flush
        self.assertEqual(v("Js9s8c7h", "As Ks Qs 2s 3d"), (5, 14, 13, 12, 11, 9))

    def test_a_straight_takes_two_from_the_hand(self):
        self.assertNotEqual(v("8cJdJhQs", "4h5s6d7cKd")[0], 4)  # one card to it (a low one would make its own, with the 4-5-6)
        self.assertEqual(v("8c9d2h3s", "4h5s6d7cKd"), (4, 9))

    def test_the_board_never_plays(self):
        self.assertEqual(v("2c3d4h5h", "AsKsQsJsTs")[0], 0)  # a royal on the board, and ace-high in the hand
        self.assertEqual(v("AdAc2h3h", "7c7d7h7sKd")[0], 6)  # aces full, not quads
        self.assertEqual(v("Ad2c3h4h", "7c7d7h7sKd"), (3, 7, 14, 4))  # three sevens, the kickers both from the hand

    def test_trips_on_a_paired_board(self):
        self.assertEqual(v("9sAd3c4c", "9c9d5h2sKd"), (3, 9, 14, 13))

    def test_board_two_pair(self):
        # three board cards can't hold both pairs: no two pair from the board, a king in the hand no full house
        self.assertEqual(v("Ah2c3d4s", "KsKdQcQd7h"), (1, 13, 14, 12, 4))
        self.assertEqual(v("Kh2c3d4s", "KsKdQcQd7h"), (3, 13, 12, 4))
        self.assertEqual(v("KhQh3d4s", "KsKdQcQd7h"), (6, 13, 12))


class Counting(unittest.TestCase):
    def test_outs_on_a_turn(self):
        # one spade in the hand: a spade gives no flush. Two aces and two queens are the only rivers ahead of the set
        e = equity_exact([parse("AsAhQcQd"), parse("2h2d5c6c")], parse("2s7s9sKd"))
        self.assertEqual((e["boards"], e["wins"]), (40, [4, 36]))

    def test_a_runner_runner_royal(self):
        # 41 cards left, 820 boards: the kings' quads lose only to the jack and ten of spades together
        e = equity_exact([parse("Kc2d3h4c"), parse("AsQs9d9c")], parse("KsKhKd"))
        self.assertEqual((e["boards"], e["wins"]), (820, [819, 1]))


class Pots(unittest.TestCase):
    def test_layers(self):
        self.assertEqual(
            side_pots({"A": 30, "B": 70, "C": 70, "D": 50}, {"A", "B", "C"}),
            [{"amount": 120, "eligible": ["A", "B", "C"]}, {"amount": 100, "eligible": ["B", "C"]}],
        )
        # a folded seat's chips over the live seats' fall to the top pot
        self.assertEqual(side_pots({"A": 20, "B": 40, "C": 60}, {"A", "B"}), [{"amount": 60, "eligible": ["A", "B"]}, {"amount": 60, "eligible": ["B"]}])


class Rng(unittest.TestCase):
    def test_mulberry32_as_web_src_poker_table_ts_seeded(self):
        # the first three of seeded(1), read off the TypeScript
        r = Mulberry32(1)
        self.assertEqual([round(r(), 10) for _ in range(3)], [0.6270739406, 0.0027357212, 0.52744704])


if __name__ == "__main__":
    unittest.main()
