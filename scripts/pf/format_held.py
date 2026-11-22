"""The format-chart decisions a published flop library spot's ranges come from, as build_pf_formats.py's --hold.

    python scripts/pf/format_held.py            # prints the --hold argument

The library's spots (engine/pf_charts.py PUBLISHED) were solved on the ranges the charts gave when they were built; a
spot at another depth or table size (40bb, heads-up, 8-max) takes those ranges from the format charts' moves
(solver/gto/pf_format_data.py). A rebuild of the moves that changed them would leave the library's flops solved on
ranges the charts no longer give (scripts/engine/test_pf_charts.py LibrarySpots checks the fingerprints), so these
decisions keep their moves (docs/ACCURACY.md section 32). Every move entry pf_formats.moves reads on a published line,
for a player who reaches the flop, is listed.
"""
from __future__ import annotations
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "solver"))
sys.path.insert(0, ROOT)

from gto import pf_formats as PF  # noqa: E402
from gto import preflop as P  # noqa: E402

_CODE = {"f": "fold", "c": "call", "x": "check", "r": "raise"}


class _Keys(dict):
    def __init__(self, src, seen, path):
        super().__init__(src)
        self.seen, self.path = seen, path

    def get(self, key, default=None):
        if key in self:
            self.seen.add(self.path + (key,))
        return super().get(key, default)


class _Level(dict):
    def __init__(self, src, seen, path=()):
        super().__init__({k: (_Level(v, seen, path + (k,)) if len(path) == 0 else _Keys(v, seen, path + (k,)))
                          for k, v in src.items()})


def held(published=None) -> list:
    """(dimension, sub-key, line key) of every move entry read on a published spot's line."""
    if published is None:
        from engine.pf_charts import PUBLISHED as published
    seen = set()
    data = PF._data()
    PF._DATA = _Level(data, seen)
    try:
        for _sid, n, stack, line in published:
            acts = []
            for part in line.split(","):
                pos, code = part.split(":")
                act = _CODE[code[0]]
                acts.append({"pos": pos, "action": act, **({"to": float(code[1:])} if act == "raise" else {})})
            folded = {a["pos"] for a in acts if a["action"] == "fold"}
            table = P.Table(P.SEATS[n], 0.0, False, None, stack)
            for i, a in enumerate(acts):
                if a["pos"] in folded:
                    continue
                std = PF.std_actions(a["pos"], acts[:i])
                if std is not None:
                    PF.moves(a["pos"], std, table)
    finally:
        PF._DATA = data
    # a held depth's ante moves at the same decisions too: the chart with an ante adds both, and the depth game's own
    # choices between neighbours cancel in that sum only while both come from the same build
    ante = data.get("ante", {})
    seen |= {("ante", s, k) for d, s, k in list(seen) if d == "depth" and k in ante.get(s, {})}
    return sorted(seen)


def main():
    print(";".join(f"{d}/{s:g}/{k}" for d, s, k in held()))


if __name__ == "__main__":
    main()
