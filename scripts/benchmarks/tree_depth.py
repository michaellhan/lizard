"""How big a heads-up tree gets with more sizes and raises a street, and what it costs in memory: the numbers behind
engine/tree_depth.py's caps (BROWSER_MAX, the page's Phone / Standard / Large, web/src/solver/treeDepth.ts).

  cells   tree_cells (a walk, no arrays) for the worker's Fast and Accurate configs over two wide single-raised ranges,
          on a flop, a turn and a river root, for four menus, at a raise cap of 1 to 4 (Config.max_raises)
  memory  one solve each of trees from about 3M to MEMORY_MAX cells, a few iterations, in its own process: its peak
          resident memory, and the bytes a cell from two sizes' difference (the process's own ~100 MB taken out)

Both write results/tree_depth.json. Native CPython and numpy, one thread; Pyodide's heap ran ~10% under native on the
same tree (advisor.py, above MAX_CELLS: 472 MB against 527), so these are an upper bound for the browser.

  .venv/bin/python scripts/benchmarks/tree_depth.py cells
  slot.sh .venv/bin/python scripts/benchmarks/tree_depth.py memory     # ~1 GB at most, a few minutes
"""
from __future__ import annotations

import json
import os
import resource
import subprocess
import sys
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "GTO_THREADS"):
    os.environ.setdefault(_v, "1")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "solver"))
RESULTS = os.environ.get("TREE_DEPTH_RESULTS", os.path.join(HERE, "results", "tree_depth.json"))
MEMORY_MAX = 26_000_000   # (this Mac's rule: a process under ~1 GB)

# BTN open vs BB defend, 100bb
BB = "22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,64s+,53s+,43s,A2o+,K8o+,Q9o+,J9o+,T8o+,98o"
BTN = "22+,A2s+,K2s+,Q2s+,J4s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o"
ROOTS = {"flop": ("Ks7d2c", 5.5, 97.5), "turn": ("Ks7d2c5h", 11.0, 92.0), "river": ("Ks7d2c5h9s", 22.0, 86.0)}
MENUS = {   # (bets, raises), the same every street
    "app": ([0.33, 0.75], [0.5]),
    "3x3": ([0.33, 0.75, 1.25], [0.5, 1.0, 2.0]),
    "5x3": ([0.25, 0.33, 0.5, 0.75, 1.25], [0.5, 1.0, 2.0]),
    "5x5": ([0.25, 0.33, 0.5, 0.75, 1.25], [0.33, 0.5, 0.75, 1.0, 2.0]),
}
# the worker's (solver/gto/static/worker.js; scripts/engine/test_study_lock.py FAST and ACCURATE)
SPEEDS = {
    "fast": dict(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=32, turn_buckets=True,
                 bucket_river_step=3, river_classes=True, river_strength=32),
    "accurate": dict(n_turns=4, leaf_turns=4, leaf_rivers_flop=8, n_rivers_from_flop=8, river_classes=True,
                     river_buckets=64, turn_buckets=True, bucket_river_step=1, river_strength=32),
}
# the trees whose memory is measured: (speed, street, menu, raise cap), smallest first
# (a turn's tree is the same at either speed: both deal every river per combo there)
MEASURED = [("fast", "turn", "3x3", 1), ("fast", "turn", "5x3", 1), ("fast", "turn", "3x3", 2),
            ("fast", "flop", "5x5", 4), ("fast", "turn", "3x3", 3)]


def _config(speed, menu, raises):
    from gto.solver import Config
    bets, rs = MENUS[menu]
    return Config(**SPEEDS[speed], bet_sizes={s: list(bets) for s in ROOTS}, raise_sizes={s: list(rs) for s in ROOTS},
                  max_raises=raises)


def _ranges():
    from gto.ranges import parse_range
    return parse_range(BB), parse_range(BTN)


def cells():
    from gto.cards import cards
    from gto.solver import tree_cells
    r0, r1 = _ranges()
    out = {}
    for speed in SPEEDS:
        for street, (board, pot, stack) in ROOTS.items():
            for menu in MENUS:
                row = []
                for raises in (1, 2, 3, 4):
                    row.append(int(tree_cells(cards(board), r0, r1, pot, stack, cfg=_config(speed, menu, raises))))
                out[f"{speed}/{street}/{menu}"] = row
                print(f"{speed:9s}{street:6s}{menu:5s}" + "".join(f"{c / 1e6:9.1f}" for c in row), flush=True)
    return dict(combos=[int((r0 > 0).sum()), int((r1 > 0).sum())], cells=out)


def one(speed, street, menu, raises):
    """A solve of that tree, 3 iterations, in this process: {cells, peak_mb, seconds}."""
    from gto.cards import cards
    from gto.solver import solve, tree_cells
    r0, r1 = _ranges()
    board, pot, stack = ROOTS[street]
    cfg = _config(speed, menu, int(raises))
    n = tree_cells(cards(board), r0, r1, pot, stack, cfg=cfg)
    t0 = time.time()
    solve(cards(board), r0, r1, pot, stack, cfg=cfg, time_budget=1e9, max_iters=3)
    return dict(cells=int(n), seconds=round(time.time() - t0, 1),
                peak_mb=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2 ** 20, 1))


def memory():
    from gto.cards import cards
    from gto.solver import tree_cells
    r0, r1 = _ranges()
    rows = []
    for speed, street, menu, raises in MEASURED:
        board, pot, stack = ROOTS[street]
        n = tree_cells(cards(board), r0, r1, pot, stack, cfg=_config(speed, menu, raises))
        if n > MEMORY_MAX:
            print(f"{speed}/{street}/{menu}/{raises}: {n / 1e6:.1f}M cells, past {MEMORY_MAX / 1e6:.0f}M: not run", flush=True)
            continue
        out = subprocess.run([sys.executable, os.path.abspath(__file__), "one", speed, street, menu, str(raises)],
                             capture_output=True, text=True)
        if out.returncode:
            print(out.stderr[-2000:], flush=True)
            continue
        rec = dict(json.loads(out.stdout.strip().splitlines()[-1]), speed=speed, street=street, menu=menu, raises=raises)
        rows.append(rec)
        print(f"{speed}/{street}/{menu}/{raises}: {rec['cells'] / 1e6:.1f}M cells, {rec['peak_mb']:.0f} MB, "
              f"{rec['seconds']:.0f} s", flush=True)
    rows.sort(key=lambda r: r["cells"])
    # bytes a cell: the slope through the smallest and largest tree (what a cell adds, the process's own memory out)
    lo, hi = rows[0], rows[-1]
    slope = (hi["peak_mb"] - lo["peak_mb"]) * 2 ** 20 / max(hi["cells"] - lo["cells"], 1)
    base = lo["peak_mb"] - lo["cells"] * slope / 2 ** 20
    return dict(trees=rows, bytes_per_cell=round(slope, 1), base_mb=round(base, 1),
                at={str(c): round(base + c * slope / 2 ** 20) for c in (12_000_000, 24_000_000, 32_000_000)})


def _save(key, value):
    res = {}
    if os.path.exists(RESULTS):
        with open(RESULTS) as f:
            res = json.load(f)
    res[key] = value
    res["measured"] = time.strftime("%Y-%m-%d")
    os.makedirs(os.path.dirname(RESULTS), exist_ok=True)
    with open(RESULTS, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "cells"
    if cmd == "one":
        print(json.dumps(one(*sys.argv[2:6])))
    elif cmd == "cells":
        _save("cells", cells())
    elif cmd == "memory":
        m = memory()
        print(json.dumps({k: v for k, v in m.items() if k != "trees"}))
        _save("memory", m)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
