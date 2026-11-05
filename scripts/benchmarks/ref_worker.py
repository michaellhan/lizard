"""One spot on the reference, in a process of its own: no engine code is imported here.

    python scripts/benchmarks/ref_worker.py SPOT OUT_PREFIX

Writes OUT_PREFIX.json (value, each side's best response, time, peak memory) and OUT_PREFIX.npz (the strategies).
"""
from __future__ import annotations

import json
import os
import resource
import sys
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import build  # noqa: E402
import spots  # noqa: E402
from refsolver import lp  # noqa: E402
from refsolver.hu import DCFR  # noqa: E402


def peak_rss_mb() -> float:
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return v / (1 << 20) if sys.platform == "darwin" else v / 1024


def solve_hu(spot: dict) -> tuple:
    t0 = time.time()
    game = build.hu_game(spot)
    built = time.time() - t0
    out = {"build_s": built, "acts": len(game.acts), "ends": len(game.ends), "pairs": game.pairs,
           "hands": [len(n) for n in game.deal.names], "method": spot["reference"]}
    if spot["reference"] == "lp":
        method = spot.get("lp_method", "highs-ds")
        t1 = time.time()
        res = lp.solve(game, method=method)
        out["solve_s"] = time.time() - t1
        strat = res["strategy"]
        out.update(lp_status=res["lp"], lp_rows=res["rows"], lp_cols=res["cols"], lp_nonzeros=res["nonzeros"],
                   lp_method=method, value_each_side=res["value_each_side"], tolerance="HiGHS feasibility 1e-9")
        t2 = time.time()
        if spot.get("bounds", True) and game.acts[0].B == 1 and game.acts[0].player == 0:
            out["frequency_bounds"] = lp.frequency_bounds(res, 0, "")
        out["bounds_s"] = time.time() - t2
        # the same game by the reference's own DCFR: the two methods share only the payoffs
        t3 = time.time()
        DCFR(game).run(spot["ref_iters"])
        g = game.gains(game.average())
        out["dcfr_check"] = {"iterations": spot["ref_iters"], "seconds": time.time() - t3, **g}
    else:
        t1 = time.time()
        DCFR(game).run(spot["ref_iters"])
        out["solve_s"] = time.time() - t1
        out["iterations"] = spot["ref_iters"]
        strat = game.average()
        out["tolerance"] = f"DCFR {spot['ref_iters']} iterations, no target; each side's gain below is the measure"
    out["gains"] = game.gains(strat)
    out["expected_rake"] = game.expected_rake(strat)
    return out, strat


def solve_mw(spot: dict) -> tuple:
    t0 = time.time()
    game = build.mw_game(spot)
    out = {"build_s": time.time() - t0, "acts": len(game.acts), "ends": len(game.ends), "deals": game.deals,
           "hands": game.n, "method": "cfr", "iterations": spot["ref_iters"],
           "tolerance": f"DCFR {spot['ref_iters']} iterations; three-way CFR has no equilibrium guarantee, the gains "
                        "below are the measure"}
    t1 = time.time()
    game.run_dcfr(spot["ref_iters"])
    out["solve_s"] = time.time() - t1
    strat = game.average()
    out["gains"] = game.gains(strat)
    out["expected_rake"] = game.expected_rake(strat)
    return out, strat


def main():
    name, prefix = sys.argv[1], sys.argv[2]
    spot = spots.get(name)
    t0 = time.time()
    out, strat = solve_mw(spot) if spot["kind"] == "mw" else solve_hu(spot)
    out["wall_s"] = time.time() - t0
    out["peak_rss_mb"] = peak_rss_mb()
    if any(m.startswith("gto") for m in sys.modules):
        raise AssertionError("the reference imported engine code")
    # hu.py silences numpy's float warnings (Accelerate raises them spuriously in matmul): so check the result here
    if not (all(np.isfinite(v).all() for v in strat.values()) and np.isfinite(out["gains"]["gain"]).all()):
        raise AssertionError("the reference produced a non-finite number")
    with open(prefix + ".json", "w") as f:
        json.dump(out, f)
    np.savez_compressed(prefix + ".npz", **{"s:" + k: v for k, v in strat.items()})


if __name__ == "__main__":
    main()
