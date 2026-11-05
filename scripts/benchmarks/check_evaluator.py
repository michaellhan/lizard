"""The reference hand evaluator against the published counts of hold'em hand ranks.

    python scripts/benchmarks/check_evaluator.py         # all 2,598,960 five-card and 133,784,560 seven-card hands

Five-card hands: 40 / 624 / 3,744 / 5,108 / 10,200 / 54,912 / 123,552 / 1,098,240 / 1,302,540 by category, 7,462
distinct values. Seven-card hands: 41,584 / 224,848 / 3,473,184 / 4,047,644 / 6,180,020 / 6,461,620 / 31,433,400 /
58,627,800 / 23,294,460, 4,824 distinct values. The distinct counts are what catch a kicker error. test_reference.py
runs the five-card half.
"""
from __future__ import annotations

import json
import os
import sys
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

from refsolver.cards import STRAIGHT_FLUSH, all_combinations, category, score  # noqa: E402

FIVE = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]
SEVEN = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584]
FIVE_DISTINCT, SEVEN_DISTINCT = 7462, 4824


def tally(scores, counts, seen):
    cats = category(scores)
    counts += np.bincount(cats, minlength=9)
    seen.append(np.unique(scores))


def count(k: int):
    """Every k-card hand, in pieces: the two lowest cards fixed, the rest from the cards above them."""
    counts = np.zeros(STRAIGHT_FLUSH + 1, dtype=np.int64)
    seen = []
    tails = all_combinations(50, k - 2)
    for a in range(52):
        for b in range(a + 1, 52):
            room = 52 - b - 1
            if room < k - 2:
                continue
            t = tails[tails.max(axis=1) < room] + b + 1 if room < 50 else tails + b + 1
            for i in range(0, len(t), 1 << 20):
                part = t[i:i + (1 << 20)]
                hands = np.column_stack([np.full(len(part), a), np.full(len(part), b), part])
                tally(score(hands), counts, seen)
            if len(seen) > 64:
                seen = [np.unique(np.concatenate(seen))]
    return counts, len(np.unique(np.concatenate(seen)))


def main():
    out = {}
    for k, want, distinct in ((5, FIVE, FIVE_DISTINCT), (7, SEVEN, SEVEN_DISTINCT)):
        t0 = time.time()
        got, nd = count(k)
        ok = got.tolist() == want and nd == distinct
        print(f"{k}-card: {int(got.sum()):,} hands, {nd} distinct values, {'match' if ok else 'MISMATCH'} "
              f"({time.time() - t0:.0f} s)")
        print("  by category:", got.tolist())
        out[str(k)] = {"hands": int(got.sum()), "by_category": got.tolist(), "distinct": nd, "match": ok}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "evaluator_counts.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    return 0 if all(v["match"] for v in out.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
