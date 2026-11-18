"""The hand evaluator's golden file (web/src/poker/evaluate.golden.txt): 10,000 pairs of hold'em hands on one board, each
judged by treys (an independent evaluator), so web/src/poker/evaluate.golden.test.ts checks rank7 against it with no
Python in CI. Seeded: the same file every run. Run from the repo root with the project's venv:
    .venv/bin/python scripts/poker/make_eval_golden.py
Each line: board, hand a, hand b, who wins (1 a, -1 b, 0 a split), and each hand's class by treys (1 straight flush ...
9 high card; 0 a royal flush)."""
import random
from pathlib import Path

from treys import Card, Evaluator

RANKS = "23456789TJQKA"
DECK = [r + s for r in RANKS for s in "shdc"]
OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "poker" / "evaluate.golden.txt"
N = 10000

# hands the random deals rarely reach: wheels, the board playing, counterfeits, kickers, quads and full houses on board
EDGE = [
    ("Ah2d3c4s9h", "5dKc", "6dKd"),
    ("As2s3s4s9h", "5sKc", "KsQs"),
    ("AhKdQcJs2h", "Td3c", "Tc4c"),
    ("9h9d5c5sKh", "Ac2d", "QcQd"),
    ("9h9d5c5s4h", "4c2d", "Ac3d"),
    ("AhKhQhJhTh", "2c3d", "9h8c"),
    ("7h7d7c7s2h", "Ac3d", "KcQd"),
    ("7h7d7c7sAh", "Kc3d", "QcQd"),
    ("8h8d8cKsKh", "AcAd", "Kc2d"),
    ("8h8d8c2s2h", "AcAd", "8s3d"),
    ("AhQh9h5h2c", "Kh3d", "JhTh"),
    ("6h5h4h3h2c", "2hKd", "7h8h"),
    ("KhQdJcTs2h", "Ad3c", "9c8d"),
    ("KsKdQcQsJh", "Jd2c", "Ac2d"),
    ("QsKdJcTd9s", "AcQc", "8h8d"),
    ("5s2sAh7c9d", "7d3d", "Kh4h"),
]


def main() -> None:
    ev = Evaluator()
    rnd = random.Random(20261118)
    lines = []

    def add(board, a, b):
        bc = [Card.new(c) for c in board]
        sa = ev.evaluate([Card.new(c) for c in a], bc)
        sb = ev.evaluate([Card.new(c) for c in b], bc)
        win = (sa < sb) - (sa > sb)  # treys: lower is better
        lines.append(f"{''.join(board)} {''.join(a)} {''.join(b)} {win} {ev.get_rank_class(sa)} {ev.get_rank_class(sb)}")

    split = lambda s: [s[i:i + 2] for i in range(0, len(s), 2)]
    for board, a, b in EDGE:
        add(split(board), split(a), split(b))
    while len(lines) < N:
        d = DECK[:]
        rnd.shuffle(d)
        x = rnd.random()
        if x < 0.6:
            pool = d
        elif x < 0.8:
            # (flushes: one suit, with some others)
            suit = rnd.choice("shdc")
            pool = [c for c in d if c[1] == suit or rnd.random() < 0.3]
        else:
            # (straights, wheels, pairs: few ranks)
            ranks = set(rnd.sample(RANKS, 6))
            pool = [c for c in d if c[0] in ranks or rnd.random() < 0.15]
        if len(pool) < 9:
            continue
        add(pool[:5], pool[5:7], pool[7:9])
    OUT.write_text("\n".join(lines) + "\n")
    print(f"{len(lines)} pairs -> {OUT}")


if __name__ == "__main__":
    main()
