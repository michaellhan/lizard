"""Solves Lizard's stored preflop games and writes each to engine/pf/<key>.bin, as upstream's
solver/scripts/build_pf_study.py does its two: STORED_ITERS iterations of the same DCFR, the average strategy packed
by pf_study.pack with the stored (quantized) strategy's exploitability in its header.

    .venv/bin/python scripts/pf/build_stored.py [--keys K1,K2] [--iters 1500] [--missing] [--log engine/pf/built.jsonl]
    .venv/bin/python scripts/pf/build_stored.py --engine        # Lizard's preflop solver's grid (engine/pf_solve.py)

Without --engine: upstream's class-level model's grid (engine/pf_stored.py, keys like 6max_100bb). With it: the grid of
engine/pf_solve.py (its calibrated model, engine/pf_calib.py; keys like lz1_6max_100bb, logged to lz1_built.jsonl), the
one the worker answers Study's, Practice's and Analyze's preflop solve from.

One process, one thread (gto.native holds BLAS to one). A 6-max game takes about 3 minutes natively, fewer players far
less. Route the whole grid through the shared CPU slot (gtosolver/.work/bin/slot.sh). Each game appends a line to the
log: key, iterations, seconds, the stored strategy's mbb/hand a seat, and bytes.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "solver"))
sys.path.insert(0, ROOT)
import gto.native  # noqa: F401,E402
from gto import pf_study as PS  # noqa: E402
from engine import pf_stored, pf_solve  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", default="")
    ap.add_argument("--iters", type=int, default=PS.STORED_ITERS)
    ap.add_argument("--missing", action="store_true", help="only games with no file yet")
    ap.add_argument("--log", default="")
    ap.add_argument("--engine", action="store_true", help="engine/pf_solve.py's grid (the calibrated model)")
    a = ap.parse_args()
    if a.engine:
        specs = {s.key: s for s in pf_solve.stored_games()}
        Solve = pf_solve.Solve
        a.log = a.log or os.path.join(pf_solve.STORE_DIR, pf_solve.MODEL_TAG + "_built.jsonl")
    else:
        specs = {s.key: s for s in pf_stored.games()}
        Solve = PS.Solve
        a.log = a.log or os.path.join(pf_stored.DIR, "built.jsonl")
    keys = a.keys.split(",") if a.keys else list(specs)
    os.makedirs(pf_stored.DIR, exist_ok=True)
    # fewest players first: the quick games land before the 6-max ones
    keys.sort(key=lambda k: (specs[k].players, specs[k].stack, specs[k].rake is not None))
    for key in keys:
        spec = specs[key]
        out = os.path.join(pf_stored.DIR, key + ".bin")
        if a.missing and os.path.exists(out):
            continue
        g = spec.game()
        t0 = time.time()
        for t in range(1, a.iters + 1):
            g.iterate(t)
        s = Solve(spec, PS.pack(g))
        s.measure()
        blob = PS.pack(g, s.mbb)
        with open(out, "wb") as f:
            f.write(blob)
        line = {"key": key, "iterations": a.iters, "seconds": round(time.time() - t0, 1), "mbb": round(s.mbb, 3),
                "bytes": len(blob)}
        with open(a.log, "a") as f:
            f.write(json.dumps(line) + "\n")
        print(json.dumps(line), flush=True)


if __name__ == "__main__":
    main()
