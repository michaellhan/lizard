#!/usr/bin/env python3
"""The opener facing a 3bet in Lizard's preflop solve (engine/pf_solve.py), hand by hand: totals against the published
references (solver/tests/preflop_refs.py), every class against a local reference file (PokerData's 6-max 100bb solve,
personal-use licence: read from ~/Desktop/projects/poker-reference, never committed or shipped), and the hands played
out of order (pf_order.out_of_order).

    .venv/bin/python scripts/pf/vs3bet.py --stored lz2_6max_100bb_r5c3            # a stored game
    slot.sh .venv/bin/python scripts/pf/vs3bet.py --rake 0.05,0.5 --iters 700 \
        --params '{...}' --out runs.jsonl                                            # a solve (~3 min, ~0.75 GB)

Per-hand gap: for each class in the reference's opened range, half the sum of the absolute differences of its
4bet/call/fold frequencies (the share of the hand played differently), averaged over the classes weighted by the
reference's combos there (its open frequency times the class's combos).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path[:0] = [os.path.join(ROOT, "solver"), ROOT]

import numpy as np  # noqa: E402

REF_FILE = os.path.expanduser("~/Desktop/projects/poker-reference/pokerdata_6max_100bb_vs3bet.json")
# the published references' opener-vs-3bet spots (preflop_refs.py, 5% capped at 4bb): (fold, call, raise) of the range
REF_TOTALS = {("UTG", "BTN"): (0.570, 0.244, 0.187), ("HJ", "CO"): (0.636, 0.183, 0.181),
              ("CO", "BTN"): (0.640, 0.169, 0.192), ("CO", "BB"): (0.680, 0.224, 0.096),
              ("BTN", "SB"): (0.757, 0.139, 0.104), ("BTN", "BB"): (0.697, 0.200, 0.103),
              ("SB", "BB"): (0.636, 0.214, 0.150)}


def totals(grid: dict) -> tuple:
    """(open share of hands, 4bet, call) as shares of the opened range."""
    from gto.pf_classes import CLASSES, N_IN
    n = dict(zip(CLASSES, N_IN))
    w = sum(n[c] * r for c, (r, _, _) in grid.items())
    return (w / 1326.0, sum(n[c] * r * fb for c, (r, fb, _) in grid.items()) / w,
            sum(n[c] * r * ca for c, (r, _, ca) in grid.items()) / w)


def gap(grid: dict, ref: dict) -> float:
    """Per-hand gap (module doc) against the reference's {class: [reach, 4bet, call]}."""
    from gto.pf_classes import CLASSES, N_IN
    n = dict(zip(CLASSES, N_IN))
    num = den = 0.0
    for c, (rr, rf, rc) in ref.items():
        if rr <= 0.005:
            continue
        _, gf, gc = grid.get(c, (0.0, 0.0, 0.0))
        d = 0.5 * (abs(gf - rf) + abs(gc - rc) + abs((1 - gf - gc) - (1 - rf - rc)))
        num += n[c] * rr * d
        den += n[c] * rr
    return num / max(den, 1e-12)


def load_ref():
    if not os.path.exists(REF_FILE):
        return None
    with open(REF_FILE) as f:
        return json.load(f)["spots"]


def wrap(spec, g, iters: int):
    """A pf_solve.Solve around a game already solved (without building the game again)."""
    from engine import pf_solve as S
    s = object.__new__(S.Solve)
    s.spec, s.game, s.iters, s.seconds, s.target = spec, g, iters, 0.0, 0.0
    s.expl, s.expl_at, s.history, s.stored, s.cached, s.stored_mbb, s._vals = None, -1, {}, False, False, None, None
    return s


def report(solve, label: str) -> dict:
    from engine.pf_order import out_of_order, spots_vs_3bet, grid_vs_3bet
    ref = load_ref()
    out = {"label": label, "spots": {}}
    for o, t in spots_vs_3bet():
        g = grid_vs_3bet(solve, o, t)
        tot = totals(g)
        r = ref.get(f"{o}_vs_{t}") if ref else None
        rec = {"open": round(tot[0], 4), "fourbet": round(tot[1], 4), "call": round(tot[2], 4),
               "out_of_order": [x[0] for x in out_of_order({c: (fb, ca) for c, (rr, fb, ca) in g.items()
                                                            if rr > 0.05})]}
        if r:
            rg = {c: (v[0], v[1], v[2]) for c, v in r["hands"].items()}
            rt = totals(rg)
            rec.update({"ref_open": round(rt[0], 4), "ref_fourbet": round(rt[1], 4), "ref_call": round(rt[2], 4),
                        "gap": round(gap(g, r["hands"]), 4),
                        "ref_out_of_order": [x[0] for x in out_of_order({c: (fb, ca) for c, (rr, fb, ca) in rg.items()
                                                                         if rr > 0.05})]})
        if (o, t) in REF_TOTALS:
            f_, c_, r_ = REF_TOTALS[(o, t)]
            rec.update({"pub_fourbet": r_, "pub_call": c_})
        rec["grid"] = {c: [round(x, 3) for x in v] for c, v in g.items()}
        out["spots"][f"{o}_vs_{t}"] = rec
    sp = out["spots"].values()
    gaps = [s["gap"] for s in sp if "gap" in s]
    out["mean_gap"] = round(float(np.mean(gaps)), 4) if gaps else None
    out["out_of_order"] = sum(len(s["out_of_order"]) for s in sp)
    out["ref_out_of_order"] = sum(len(s.get("ref_out_of_order", [])) for s in sp)
    pubs = [s for s in sp if "pub_fourbet" in s]
    out["pub_mae"] = round(float(np.mean([abs(s["fourbet"] - s["pub_fourbet"]) + abs(s["call"] - s["pub_call"])
                                          for s in pubs]) / 2), 4)
    if ref:
        out["ref_tot_mae"] = round(float(np.mean([abs(s["fourbet"] - s["ref_fourbet"]) + abs(s["call"] - s["ref_call"])
                                                  for s in sp]) / 2), 4)
    return out


def print_report(r: dict):
    print(f"== {r['label']}")
    print(f"{'spot':12s} {'open':>5s} {'4bet':>5s} {'call':>5s} | {'PD 4b':>5s} {'PD ca':>5s} {'gap':>5s} | "
          f"{'pub4b':>5s} {'pubca':>5s} | out of order")
    for k, s in r["spots"].items():
        print(f"{k:12s} {s['open'] * 100:5.1f} {s['fourbet'] * 100:5.1f} {s['call'] * 100:5.1f} | "
              f"{s.get('ref_fourbet', float('nan')) * 100:5.1f} {s.get('ref_call', float('nan')) * 100:5.1f} "
              f"{s.get('gap', float('nan')) * 100:5.1f} | "
              f"{s.get('pub_fourbet', float('nan')) * 100:5.1f} {s.get('pub_call', float('nan')) * 100:5.1f} | "
              f"{' '.join(s['out_of_order'])}")
    print(f"mean per-hand gap {r['mean_gap'] * 100 if r['mean_gap'] is not None else float('nan'):.1f} pts; "
          f"totals vs PokerData {r.get('ref_tot_mae', float('nan')) * 100:.1f} pts; "
          f"totals vs published {r['pub_mae'] * 100:.1f} pts; out of order {r['out_of_order']} "
          f"(PokerData itself {r['ref_out_of_order']})", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stored", default="", help="a stored game's key (engine/pf/<key>.bin)")
    ap.add_argument("--rake", default="", help="rate,cap for a solve (none: no rake)")
    ap.add_argument("--iters", type=int, default=700)
    ap.add_argument("--params", default="", help="JSON list (or one dict) of engine.pf_model.Params fields "
                                                 "(default: engine/pf_calib.py's)")
    ap.add_argument("--out", default="", help="append each report as a JSON line")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    import gto.native  # noqa: F401
    from engine import pf_solve as S, pf_model as M
    reports = []
    if a.stored:
        sp = next(s for s in S.stored_games() if s.key == a.stored)
        reports.append(report(S.held(sp), a.stored))
    else:
        rake = tuple(float(x) for x in a.rake.split(",")) if a.rake else None
        plist = json.loads(a.params) if a.params else [None]
        plist = plist if isinstance(plist, list) else [plist]
        for p in plist:
            t0 = time.time()
            spec = S.Spec(6, (100.0,), rake=rake)
            mp = M.Params.of({**S.params().as_dict(), **p}) if p is not None else S.params()
            g = spec.game(model_params=mp)
            for t in range(1, a.iters + 1):
                g.iterate(t)
            r = report(wrap(spec, g, a.iters), f"solve rake {rake} {a.iters} it {json.dumps(p)}")
            r.update({"params": mp.as_dict(), "delta": p, "rake": rake, "iters": a.iters,
                      "seconds": round(time.time() - t0, 1)})
            reports.append(r)
            if a.out:
                with open(a.out, "a") as f:
                    f.write(json.dumps(r) + "\n")
            if not a.quiet:
                print_report(r)
    if a.stored:
        if a.out:
            with open(a.out, "a") as f:
                f.write(json.dumps(reports[0]) + "\n")
        print_report(reports[0])


if __name__ == "__main__":
    main()
