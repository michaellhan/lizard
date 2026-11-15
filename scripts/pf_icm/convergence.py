#!/usr/bin/env python3
"""docs/ACCURACY.md 20.3: the prize-equity preflop game's exploitability by iterations (mbb/hand of prize equity a seat,
the mean over seats, and the worst seat), on the tables the section names, with the game's default sizes (pf_icm.Sizes)
and Study's averaging (pf_study.AVG_POWER).

    /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh .venv/bin/python scripts/pf_icm/convergence.py [--only NAME]

About 4 minutes of CPU in all, the 6-max tables most of it (0.7 GB each): run it through the shared slot.
"""
import argparse
import os
import sys
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "solver"))
sys.path.insert(0, ROOT)
from engine import pf_icm as I           # noqa: E402
from gto import icm                      # noqa: E402
from gto import pf_study as PS           # noqa: E402
from gto.preflop import SEATS            # noqa: E402

P3 = [50, 30, 20]
# (name, stacks in seat order, ante a seat, payouts or None for chips, checkpoints, build options)
TABLES = (
    ("3-handed 15/9/22bb, 0.1bb ante, 50/30/20", (15, 9, 22), 0.1, P3, (100, 200, 400, 800), {}),
    ("Sit & go bubble: CO 24, BTN 16, SB 9, BB 18bb, 0.25bb ante, 50/30/20", (24, 16, 9, 18), 0.25, P3, (500, 1000, 2000), {}),
    ("The same in chips", (24, 16, 9, 18), 0.25, None, (500, 2000), {}),
    ("The same in chips at equal 24bb", (24,) * 4, 0.25, None, (300, 1200), {}),
    ("The same in chips, heads-up pots only", (24, 16, 9, 18), 0.25, None, (300, 1200), {"max_players": 2, "allin_players": 1}),
    ("6-max, 20bb each, 0.125bb ante, 50/30/20", (20,) * 6, 0.125, P3, (100, 300, 600), {}),
    ("6-max, 25/12/40/18/30/22bb, 50/30/20", (25, 12, 40, 18, 30, 22), 0.0, P3, (100, 300, 600), {}),
    ("6-max, 20bb each, in chips", (20,) * 6, 0.125, None, (600,), {}),
    ("6-max, 25/12/40/18/30/22bb, in chips", (25, 12, 40, 18, 30, 22), 0.0, None, (600,), {}),
)


def measure(name, stacks, ante, pay, checks, kw):
    pos = list(SEATS[len(stacks)])
    model = icm.Model(dict(zip(pos, stacks)), pay) if pay else None
    g = I.game(pos, list(stacks), [ante] * len(pos), icm_model=model, **kw)
    g.avg_power = PS.AVG_POWER
    t0, out, t = time.time(), [], 0
    for c in checks:
        while t < c:
            t += 1
            g.iterate(t)
        e = g.exploitability(per_seat=True)
        out.append((c, 1000 * sum(e) / len(e), 1000 * max(e), pos[max(range(len(e)), key=lambda i: e[i])]))
    print(f"{name}: {g.N} nodes, {time.time() - t0:.0f} s; "
          + ", ".join(f"{m:.3g} at {c} (worst {w:.3g}, {p})" for c, m, w, p in out), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    sz = I.Sizes()
    print(f"sizes: open {sz.open:g}bb, SB {sz.sb_open:g}x, small_open {sz.small_open}, jam beside the open from {I.JAM_OPEN:g}bb")
    for row in TABLES:
        if not a.only or a.only.lower() in row[0].lower():
            measure(*row)


if __name__ == "__main__":
    main()
