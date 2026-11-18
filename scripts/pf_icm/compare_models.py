"""The tournament preflop on upstream's class-level game (engine/pf_icm.py ICMGame, upstream's library flop model) against
the same tree on Lizard's calibrated solver (engine/pf_icm_calib.py: pf_engine's game, pf_model's calibrated flop values),
docs/ACCURACY.md 20.7.

1. Chip EV against the published tournament references in solver/tests/preflop_refs.py FORMAT_REFS that the tournament
   tree plays (Poker Academy's 40bb MTT, 9-handed with a 1bb big-blind ante and 2.3bb opens; GTO Wizard's heads-up 50bb
   with a 0.12bb ante): each model's fold / call / raise shares at the reference's node against the published ones.
2. Prize equity: how far the two models' strategies are apart on spots of the final-table set (first-in raise and jam
   shares by seat, and the big blind's defence against the button), and each one's distance from its own equilibrium.

    /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh .venv/bin/python scripts/pf_icm/compare_models.py [iters] [refs|icm|all]

Writes scripts/pf_icm/compare_models.json, or compare_models_refs.json / compare_models_icm.json for one part.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

import gto.native  # noqa: E402,F401  (BLAS on one thread)
from gto import icm  # noqa: E402
from gto import pf_game as G  # noqa: E402
from gto.preflop import SEATS  # noqa: E402
from solver.tests.preflop_refs import FORMAT_REFS  # noqa: E402

from engine import pf_icm as I  # noqa: E402
from engine import pf_icm_calib as C  # noqa: E402
from engine import pf_icm_stored as ST  # noqa: E402

ITERS = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
REF_NAMES = ("40bb MTT SB vs CO open", "40bb MTT SB vs BTN open", "HU 50bb SB first in", "HU 50bb BB vs SB limp")


def make(which, pos, stacks, antes, model=None, sizes=None):
    n = len(pos)
    kw = {"sizes": sizes} if sizes else {}
    if which == "old":
        g = I.game(pos, list(stacks), list(antes), icm_model=model, cold4=n <= 6, **kw)
    else:
        g = C.game(pos, list(stacks), list(antes), icm_model=model, **kw)
    g.avg_power = 8.0
    return g


def solve(g, iters=ITERS):
    t0 = time.time()
    for t in range(1, iters + 1):
        g.iterate(t)
    e = g.exploitability(per_seat=True)
    return g.average(), 1000 * sum(e) / len(e), time.time() - t0


def shares(g, s, nd):
    d = g.dec_of[nd.index]
    out = {}
    for a, nm in enumerate(nd.names):
        key = {"all-in": "raise"}.get(nm, nm)
        out[key] = out.get(key, 0.0) + float((s[d, a] * G.PRIOR).sum() / G.PRIOR.sum())
    return out


def refs():
    rows = []
    for r in FORMAT_REFS:
        if r["name"] not in REF_NAMES:
            continue
        n = r["players"]
        pos = list(SEATS[n])
        stacks = [r["stack"]] * n
        antes = [r["ante"]] * n
        sizes = I.Sizes(open=2.3) if "MTT" in r["name"] else None
        line = []
        for part in [x.strip() for x in r["line"].split(",") if x.strip()]:
            bits = part.split()
            line.append((bits[0], bits[1]))
        row = {"name": r["name"], "hero": r["hero"], "want": r["want"], "source": r["source"]}
        for which in ("old", "new"):
            g = make(which, pos, stacks, antes, sizes=sizes)
            s, mbb, sec = solve(g)
            # (the hero's node: walk the line, every seat not named folding, then fold round to the hero)
            nd = g.root
            for p, a in line:
                while g.positions[nd.player] != p:
                    nd = nd.children[nd.names.index("fold")]
                nd = nd.children[nd.names.index(a)]
            while g.positions[nd.player] != r["hero"]:
                nd = nd.children[nd.names.index("fold")]
            got = shares(g, s, nd)
            err = {k: round(100 * (got.get(k, 0.0) - v), 1) for k, v in r["want"].items()}
            row[which] = {"got": {k: round(v, 3) for k, v in got.items()}, "err_points": err,
                          "mae_points": round(float(np.mean([abs(x) for x in err.values()])), 2),
                          "mbb": round(mbb, 3), "seconds": round(sec, 1), "nodes": g.N}
            print(r["name"], which, row[which], flush=True)
        rows.append(row)
    return rows


def icm_spots():
    out = []
    spots = [s for s in ST.FINAL_TABLE_SET if s[1] in (3, 5, 6, 9) and ("15bb" in s[0] or "30bb" in s[0])
             and "equal" not in s[0]] + [s for s in ST.STAGES if s[0] in ("Sit & go bubble", "Final-table bubble")]
    for name, n, stacks, pay, field, ante in spots:
        pos = list(SEATS[n])
        a = ST.stage_ante(n) if ante is None else ante
        others = [field[1]] * field[0] if field else []
        model = icm.Model(dict(zip(pos, stacks)), pay, others)
        res = {}
        for which in ("old", "new"):
            g = make(which, pos, stacks, [a] * n, model=model)
            s, mbb, sec = solve(g)
            first = {}
            nd = g.root
            while nd.kind == "dec" and "fold" in nd.names and len(first) < n - 1:
                first[g.positions[nd.player]] = {k: round(v, 3) for k, v in shares(g, s, nd).items()}
                nd = nd.children[nd.names.index("fold")]
            res[which] = {"first_in": first, "mbb": round(mbb, 3), "seconds": round(sec, 1), "nodes": g.N}
        diffs = []
        for p in res["old"]["first_in"]:
            o, nw = res["old"]["first_in"][p], res["new"]["first_in"].get(p, {})
            diffs.append(abs(o.get("raise", 0) - nw.get("raise", 0)))
        res["name"] = name
        res["first_in_raise_diff_points"] = {"mean": round(100 * float(np.mean(diffs)), 2),
                                             "max": round(100 * float(np.max(diffs)), 2)}
        print(name, res["first_in_raise_diff_points"], "mbb", res["old"]["mbb"], res["new"]["mbb"],
              "s", res["old"]["seconds"], res["new"]["seconds"], flush=True)
        out.append(res)
    return out


if __name__ == "__main__":
    which = sys.argv[2] if len(sys.argv) > 2 else "all"
    out = {"iterations": ITERS}
    if which in ("all", "refs"):
        out["refs"] = refs()
    if which in ("all", "icm"):
        out["icm"] = icm_spots()
    Path(__file__).with_name(f"compare_models{'' if which == 'all' else '_' + which}.json").write_text(
        json.dumps(out, indent=1) + "\n")
