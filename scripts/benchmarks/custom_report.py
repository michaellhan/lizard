#!/usr/bin/env python3
"""A custom flop report of a library spot, solved live as the browser's Fast tier solves it, against the library's own
report of that spot (docs/ACCURACY.md, custom flop reports).

    custom_report.py --library DIR [--spot srp_btn_bb] [--size 25] [--out FILE]

DIR is an assembled library (scripts/library/assemble.py's stage or release: <spot>/report.json). The live side is
the worker's Fast Advisor (solver/gto/static/worker.js, with 4 or more threads as most browsers give it: the turn on
Accurate's tree, the river inside at 33/75/125%, the heads-up solve stopped once 0.2% of the pot from equilibrium from
its 300th iteration), with the library off, so every flop is solved, as a custom report solves a spot the library
doesn't store. It runs on one thread (a solve's numbers don't depend on the threads: gto/core.py threads), with time
enough for the settled stop to end each solve rather than the clock; the browser stops there too (300 iterations a
flop in the browser checks). It asks exactly what the page's report asks (web/src/features/reports/customReport.ts
solveFlop: the flop's root, then in position after the check) for the solver's representative flops.

Three comparisons, each over the report's columns (BB's check, in position's bet after the check and its size split,
BB's EV in bb and % of the pot, BB's equity):
  per flop: live against the library on the same flops (the live flop model's own error, no sampling);
  sampled: the library's own average over the set against its average over every flop it stores (sampling alone);
  report: the live report's average against the library's report (what a user of each sees: both together).
Over a minute of CPU: run it through gtosolver's .work/bin/slot.sh.
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))

from gto import core  # noqa: E402
from gto.advisor import Advisor  # noqa: E402
from gto.flop_library import all_flops, flop_name, representative_flops  # noqa: E402
from gto.solver import Config  # noqa: E402

# the spot as the page's report asks it (studyRequest of the hand with the flop dealt)
PREFLOP = {
    "srp_btn_bb": [("UTG", "fold"), ("HJ", "fold"), ("CO", "fold"), ("BTN", "raise", 2.5), ("SB", "fold"), ("BB", "call")],
    "srp_co_bb": [("UTG", "fold"), ("HJ", "fold"), ("CO", "raise", 2.5), ("BTN", "fold"), ("SB", "fold"), ("BB", "call")],
}


def fast_advisor() -> Advisor:
    """The worker's Fast Advisor with 4 or more threads (worker.js, THREADED), without the library."""
    raises = {"flop": [0.5], "turn": [0.75], "river": [0.75]}
    adv = Advisor(Config(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=32,
                         turn_buckets=True, bucket_river_step=3, river_classes=True, river_strength=32,
                         bet_sizes={"flop": [0.33, 0.75], "turn": [0.33, 0.75, 1.25], "river": [0.33, 0.75, 1.25]},
                         raise_sizes=raises),
                  # (the browser's 4 s default is never reached there: the settled stop ends a flop at ~1 s)
                  time_budget=120.0)
    adv.root_sizes = {"river": {"bet": [0.33, 0.75, 1.25, 2.5]}}
    adv.spare_prior = True
    adv.hu_settled = 0.2
    adv.expl_target = 0.2
    adv.cache_mb = 256
    adv.library = None
    adv.mw_library = None
    return adv


def state(spot: str, board: str, flop: list) -> dict:
    pre = [dict(pos=a[0], action=a[1], **({"to": a[2]} if len(a) > 2 else {})) for a in PREFLOP[spot]]
    return {"players": 6, "stack": 100, "board": board, "preflop": pre, "flop": flop, "turn": [], "river": [], "study": True}


def mix(res: dict, names: list) -> list:
    got = {a["action"]: a["freq"] for a in res.get("actions") or []}
    return [float(got.get(n, 0.0)) for n in names]


def columns(n: dict, ev, eq, pot: float) -> dict:
    """A flop's report columns: BB's check (root), in position's bet after the check, the share of it at 75%, BB's EV
    (bb and % of the pot) and equity."""
    root, chk = n.get(""), n.get("check")
    bet = None if chk is None else chk[1] + chk[2]
    return {
        "bb_check": root[0] if root else None,
        "ip_bet": bet,
        "ip_big_share": None if not bet else chk[2] / bet,
        "bb_ev": ev[0] if ev else None,
        "bb_ev_pct": 100 * ev[0] / pot if ev else None,
        "bb_eq": eq[0] if eq else None,
    }


def wavg(rows: list, key: str):
    xs = [(r["w"], r[key]) for r in rows if r[key] is not None]
    tot = sum(w for w, _ in xs)
    return sum(w * x for w, x in xs) / tot if tot else None


KEYS = ("bb_check", "ip_bet", "ip_big_share", "bb_ev", "bb_ev_pct", "bb_eq")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True, type=Path)
    ap.add_argument("--spot", default="srp_btn_bb", choices=sorted(PREFLOP))
    ap.add_argument("--size", default=25, type=int)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    rep = json.loads((a.library / a.spot / "report.json").read_text())
    names = rep["nodes"][""]
    chk_names = rep["nodes"]["check"]
    pot = float(rep["pot"])
    lib = {f["f"]: f for f in rep["flops"]}
    counts = {flop_name(k): c for k, c in all_flops().items()}
    lib_rows = [dict(f=f, w=float(x.get("w", counts[f])), **columns(x["n"], x.get("ev"), x.get("eq"), pot)) for f, x in lib.items()]

    adv = fast_advisor()
    flops = [flop_name(k) for k in representative_flops(a.size)]
    live, per = [], []
    t_all = time.time()
    for i, f in enumerate(flops):
        t0 = time.time()
        r = adv.advise(state(a.spot, f, []))
        c = adv.advise(state(a.spot, f, [{"pos": "BB", "action": "check"}]))
        sec = time.time() - t0
        sv = r.get("solver") or {}
        n = {"": mix(r, names), "check": mix(c, chk_names)}
        ev = [r["range_ev_bb"], r["pot_bb"] - r["range_ev_bb"]] if "range_ev_bb" in r else None
        eq = [r["range_eq"], r["opponent_eq"]] if "range_eq" in r else None
        row = dict(f=f, w=22100 / a.size, iterations=sv.get("iterations"), expl_pct=sv.get("exploitability_pct"),
                   seconds=round(sec, 2), source=r.get("source"), **columns(n, ev, eq, pot))
        live.append(row)
        lr = next(x for x in lib_rows if x["f"] == f)
        per.append({k: (None if row[k] is None or lr[k] is None else row[k] - lr[k]) for k in KEYS} | {"f": f})
        print(f"{i + 1}/{len(flops)} {f}: {row['iterations']} it, {row['expl_pct']}% pot, {sec:.1f}s, "
              f"check {row['bb_check']:.3f} (lib {lr['bb_check']:.3f}), ip bet {row['ip_bet']:.3f} (lib {lr['ip_bet']:.3f}), "
              f"EV {row['bb_ev']:.2f} (lib {lr['bb_ev']:.2f})", flush=True)

    lib_set = [x for x in lib_rows if x["f"] in set(flops)]
    for x in lib_set:
        x["w"] = 22100 / a.size

    def mean_abs(k):
        xs = [abs(p[k]) for p in per if p[k] is not None]
        return sum(xs) / len(xs) if xs else None

    def max_abs(k):
        xs = [abs(p[k]) for p in per if p[k] is not None]
        return max(xs) if xs else None

    out = {
        "spot": a.spot, "size": a.size, "flops": flops, "library_flops": len(lib_rows), "pot": pot,
        "engine": {"core": core.lib() is not None, "threads": core.threads(), "seconds": round(time.time() - t_all, 1),
                   "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1 << 20), 1)},
        "per_flop": {"mean_abs": {k: mean_abs(k) for k in KEYS}, "max_abs": {k: max_abs(k) for k in KEYS}, "rows": per},
        "averages": {
            "live_set": {k: wavg(live, k) for k in KEYS},
            "library_set": {k: wavg(lib_set, k) for k in KEYS},
            "library_all": {k: wavg(lib_rows, k) for k in KEYS},
        },
        "live": live,
    }
    av = out["averages"]
    out["sampling"] = {k: av["library_set"][k] - av["library_all"][k] for k in KEYS}
    out["report_diff"] = {k: av["live_set"][k] - av["library_all"][k] for k in KEYS}
    out["model_diff"] = {k: av["live_set"][k] - av["library_set"][k] for k in KEYS}
    text = json.dumps(out, indent=1)
    if a.out:
        a.out.write_text(text + "\n")
    print(json.dumps({k: out[k] for k in ("engine", "sampling", "model_diff", "report_diff")} | {"averages": av, "per_flop": {k: out["per_flop"][k] for k in ("mean_abs", "max_abs")}}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
