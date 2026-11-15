#!/usr/bin/env python3
"""Lizard's preflop solve of a 6-max 100bb game at other raise sizes, measured against the published solves.

The same measure as docs/ACCURACY.md section 18.4 (scripts/pf/calibrate.py `measure`: pf_equilibrium.report's mean
absolute error over the 26 certain spots' published actions, spots out of tolerance, the 15 hand facts), solved at the
references' rake (5% capped at 4bb) for 700 iterations with the adopted calibration. pf_equilibrium walks a spot's
line by action, not size, so a game whose blind 3bets are to 10bb is scored on the references' 12bb spots as it plays
them: that is the question asked (how near the published solves is the game Practice would grade by).

    slot.sh .venv/bin/python scripts/pf/measure_tree.py --sizes '{"blind_3bet": 4.0}' --out runs.jsonl
"""
import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path[:0] = [os.path.join(ROOT, "solver"), os.path.join(ROOT, "solver", "scripts"), ROOT]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", default="{}", help="Spec sizes, e.g. '{\"blind_3bet\": 4.0}'")
    ap.add_argument("--iters", type=int, default=700)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    import gto.native  # noqa: F401
    from engine import pf_solve as P
    sys.path.insert(0, os.path.join(ROOT, "scripts", "pf"))
    from calibrate import measure, score, facts_off, RAKE
    sizes = tuple(sorted(json.loads(a.sizes).items()))
    spec = P.Spec(6, (100.0,), rake=RAKE, sizes=sizes)
    t0 = time.time()
    g = spec.game()
    g.solve(a.iters)
    m = measure(g)
    run = {"sizes": dict(sizes), "iters": a.iters, "seconds": round(time.time() - t0, 1),
           "mbb": 1000 * sum(g.exploitability(per_seat=True)) / g.n, **m}
    sc = score(run)
    run["score"] = sc
    run["facts_off_n"] = facts_off(run)
    print(f"{spec.key}: {sc['mae']:.2f} points, {sc['miss']}/{sc['n']} out, facts off {run['facts_off_n']}, "
          f"{run['mbb']:.2f} mbb, {run['seconds']}s", flush=True)
    if a.out:
        with open(a.out, "a") as f:
            f.write(json.dumps(run) + "\n")


if __name__ == "__main__":
    main()
