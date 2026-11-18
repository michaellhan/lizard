#!/usr/bin/env python3
"""Lizard's limp trees against the published solves that give limping shares (solver/tests/preflop_refs.py).

Three references say how often a seat limps:
  - gtopreflop.com, 6-max 100bb at 5% capped at 4bb: the small blind folded to raises 43.4% and limps 2.3%;
  - thinkgto.com (GTO Ranges+), the same game: the small blind raises 33.1% and limps 20.5%;
  - GTO Wizard's heads-up 50bb (chip EV, 0.12bb ante): the small blind folds 4%, raises 64% (limps about 32%, derived),
    and the big blind raises 34% of its limps.
The first two disagree with each other by 18 points on the limp, so a 6-max small blind's limp has no single published
figure to meet. This solves the trees that have the limp (the 6-max game with the small blind's complete, `sb_limp`,
at the references' rake; heads-up, where the limp is always in the tree, at 50bb with the 0.12bb ante) and prints the
shares beside them, with the 26-spot score of the 6-max game (scripts/pf/calibrate.py `measure`) to show the complete
costs the rest nothing. The 6-max tree with limps from every seat (`open_limps`) needs about 2.1 GB to solve, over this
machine's 1 GB a process, and no reference gives limping shares for the seats before the blinds, so it isn't run.

    slot.sh .venv/bin/python scripts/pf/measure_limps.py [--iters 1500]
"""
import argparse
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path[:0] = [os.path.join(ROOT, "solver"), os.path.join(ROOT, "solver", "scripts"), ROOT]


def shares(solve, line):
    r = solve.node(line)
    return {a["action"]: round(a["freq"] * 100, 1) for a in r["actions"]}, r.get("actor")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=1500)
    a = ap.parse_args()
    import gto.native  # noqa: F401
    from gto import pf_study as PS
    from engine import pf_solve as P
    sys.path.insert(0, os.path.join(ROOT, "scripts", "pf"))
    from calibrate import measure, score, facts_off, RAKE
    fold = lambda *seats: [{"pos": p, "action": "fold"} for p in seats]  # noqa: E731
    games = [
        ("6-max 100bb, 5%/4bb, the small blind may complete", P.Spec(6, (100.0,), rake=RAKE, sb_limp=True),
         [("SB folded to", fold("UTG", "HJ", "CO", "BTN"), "gtopreflop raise 43.4 limp 2.3; thinkgto raise 33.1 limp 20.5"),
          ("BB vs the SB's complete", fold("UTG", "HJ", "CO", "BTN") + [{"pos": "SB", "action": "call"}], "no reference")]),
        ("6-max 100bb, 5%/4bb, no complete (the stored tree)", P.Spec(6, (100.0,), rake=RAKE),
         [("SB folded to", fold("UTG", "HJ", "CO", "BTN"), "raise-only solves 43.5")]),
        ("heads-up 50bb, 0.12bb ante, no rake", P.Spec(2, (50.0,), ante=0.12),
         [("SB first in", [], "GTO Wizard fold 4 raise 64 limp ~32 (derived)"),
          ("BB vs the SB's limp", [{"pos": "SB", "action": "call"}], "GTO Wizard raise 34")]),
    ]
    for name, spec, reads in games:
        t0 = time.time()
        print(f"== {name}: {spec.key}, {spec.nodes()} nodes, about {spec.estimate_mb():.0f} MB", flush=True)
        g = spec.game()
        for k in range(1, a.iters + 1):
            g.iterate(k)
        s = P.Solve(spec, PS.pack(g))
        s.measure()
        print(f"  {a.iters} iterations, {time.time() - t0:.0f}s, {s.mbb:.3f} mbb/hand a seat", flush=True)
        for what, line, ref in reads:
            got, actor = shares(s, line)
            print(f"  {what} ({actor}): " + ", ".join(f"{k} {v}%" for k, v in got.items()) + f"   [{ref}]", flush=True)
        if spec.players == 6:
            m = measure(g)
            run = {"refs": m["refs"], "facts": m["facts"]}
            sc = score(run)
            print(f"  26 spots: {sc['mae']:.2f} points, {sc['miss']}/{sc['n']} out, facts off {facts_off(run)}", flush=True)
            print(f"  ref 'SB first in (raise + limp)' as pf_equilibrium reads it: {m['refs'].get('SB first in (raise + limp)')}", flush=True)


if __name__ == "__main__":
    main()
