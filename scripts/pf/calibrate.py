#!/usr/bin/env python3
"""Calibrate engine/pf_model.py's corrections against the published 6-max 100bb solves (solver/tests/preflop_refs.py),
with a held-out check.

Every evaluation solves the 6-max 100bb game at the references' rake (5% capped at 4bb) with the model's parameters
and records the solve's fold/call/raise shares at every reference and its hand facts (pf_equilibrium.report, the same
measure docs/research/03 section 4 and solver/docs/preflop_research.md sections 6-9 used). Run through the shared CPU
slot (one solve is ~2 minutes and ~0.75 GB):

    slot.sh python scripts/pf/calibrate.py eval --params '[{}, {"d1_ip": 0.02}]' --out runs.jsonl
    python scripts/pf/calibrate.py fit --runs runs.jsonl          # Gauss-Newton step from the runs (no solving)
    python scripts/pf/calibrate.py cv --runs runs.jsonl --fit0 '{...}' --fit1 '{...}'   # the held-out error
    python scripts/pf/calibrate.py write --runs runs.jsonl --params '{...}' --fit0 .. --fit1 ..  # engine/pf_calib.py

`fit` linearises the shares around a base run from one-at-a-time perturbations of each parameter (finite differences),
then takes a damped, ridge-regularised least-squares step on the certain references' shares. It also fits on
one half of the references (a fixed split by spot, stratified by kind of spot) and reports the other half, so the
held-out error is known before anything is adopted. The hand facts are never fitted: they are a held-out check.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path[:0] = [os.path.join(ROOT, "solver"), os.path.join(ROOT, "solver", "scripts"), ROOT]

import numpy as np  # noqa: E402

RAKE = (0.05, 4.0)          # the references' (tests/preflop_refs.py RK)
ITERS = 700                 # pf_study's 6-max raked solves stop about here (1.1-1.5 mbb/hand a seat)


def solve(params: dict, iters: int = ITERS, rake=RAKE, players: int = 6, stack: float = 100.0):
    """The game solved with engine.pf_model's corrections `params` (a dict of Params fields)."""
    import gto.native  # noqa: F401
    from gto import pf_game as G, pf_study as PS
    from engine.pf_model import CalibratedModel, Params
    spec = PS.Spec(players, stack, rake=rake)
    root, pos = spec.build()
    g = G.Game(root, pos, CalibratedModel(Params.of(params), PS.depth_scale(stack)), stack=stack, rake=rake)
    g.avg_power = PS.AVG_POWER
    g.solve(iters)
    return g


def measure(g) -> dict:
    """The solve at every reference ({name: {action: share}}) and hand fact ({name: share})."""
    import pf_equilibrium as P
    rows, (mae, n_miss), hands, nb = P.report(g)
    return {"refs": {name: {k: round(float(v), 5) for k, v in got.items()} for name, got, want, bad, unc in rows},
            "facts": {name: round(float(v), 5) for name, action, v, lo, hi, ok in hands},
            "mae": mae, "miss": n_miss, "facts_off": nb}


# ----------------------------------------------------------------------------- scoring (no solving)
def certain_refs():
    from tests.preflop_refs import REFS
    return [r for r in REFS if not r["uncertain"]]


KIND = {"open": 0, "vs_open": 1, "vs_3bet": 2}


def kind_of(r) -> str:
    n = r["line"].count("raise")
    return "open" if n == 0 else "vs_open" if n == 1 else "vs_3bet"


def fold_of(r) -> int:
    """A fixed split of the certain references into two halves, alternating within each kind of spot (in
    tests/preflop_refs.py order), so each half has opens, spots facing an open and spots facing a 3bet."""
    rs = [x for x in certain_refs() if kind_of(x) == kind_of(r)]
    return [x["name"] for x in rs].index(r["name"]) % 2


def vec(run: dict, refs=None):
    """(shares, wanted, tolerance, ref index) over the certain references' published actions."""
    refs = refs or certain_refs()
    y, w, tol, idx = [], [], [], []
    for i, r in enumerate(refs):
        got = run["refs"].get(r["name"], {})
        for k, v in r["want"].items():
            y.append(got.get(k, 0.0)); w.append(v); tol.append(r["tol"]); idx.append(i)
    return np.array(y), np.array(w), np.array(tol), np.array(idx)


def score(run: dict, names=None) -> dict:
    """Mean absolute error in points and spots outside tolerance, over the certain references (or those named)."""
    refs = [r for r in certain_refs() if names is None or r["name"] in names]
    y, w, tol, idx = vec(run, refs)
    err = np.abs(y - w)
    out = {i for i in set(idx.tolist()) if (err[idx == i] > tol[idx == i] + 1e-9).any()}
    return {"mae": float(err.mean() * 100), "miss": len(out), "n": len(refs)}


def facts_off(run: dict) -> int:
    from tests.preflop_refs import HANDS
    return sum(not (h[5] - 1e-9 <= run["facts"][h[0]] <= h[6] + 1e-9) for h in HANDS)


# ----------------------------------------------------------------------------- commands
def cmd_eval(a):
    plist = json.loads(a.params)
    for p in plist:
        t0 = time.time()
        g = solve(p, a.iters)
        m = measure(g)
        mbb = 1000 * sum(g.exploitability(per_seat=True)) / g.n if a.expl else None
        rec = {"params": p, "iters": a.iters, "seconds": round(time.time() - t0, 1), "mbb": mbb, **m}
        with open(a.out, "a") as f:
            f.write(json.dumps(rec) + "\n")
        print(f"{json.dumps(p)}: {m['mae'] * 100:.2f} points, {m['miss']} out, facts off {m['facts_off']}, "
              f"{rec['seconds']}s", flush=True)


def load_runs(path):
    with open(path) as f:
        return [json.loads(x) for x in f if x.strip()]


def cmd_fit(a):
    from engine.pf_model import Params
    runs = [r for r in load_runs(a.runs) if r["iters"] == a.iters]
    base_p = Params.of(json.loads(a.base)) if a.base else Params()
    bv = base_p.vector()
    key = lambda p: tuple(np.round(Params.of(p).vector(), 6))
    by = {key(r["params"]): r for r in runs}
    base = by.get(tuple(np.round(bv, 6)))
    if base is None:
        sys.exit("no run at the base parameters")
    free = a.free.split(",") if a.free else list(Params.NAMES)
    J, step = [], []
    for n in free:
        j = Params.NAMES.index(n)
        cands = [r for r in runs if np.count_nonzero(np.abs(Params.of(r["params"]).vector() - bv) > 1e-9) == 1
                 and abs(Params.of(r["params"]).vector()[j] - bv[j]) > 1e-9]
        if not cands:
            sys.exit(f"no one-at-a-time run for {n}")
        r = cands[0]
        h = Params.of(r["params"]).vector()[j] - bv[j]
        J.append((vec(r)[0] - vec(base)[0]) / h)
        step.append(abs(h))
    J = np.array(J).T                       # (shares, params)
    y0, w, tol, idx = vec(base)
    refs = certain_refs()
    folds = np.array([fold_of(refs[i]) for i in idx])
    scale = np.array(step)                  # parameters in units of their perturbation
    Js = J * scale

    def step_on(mask):
        A = Js[mask]
        b = (w - y0)[mask]
        # ridge on the scaled parameters: a step of one perturbation costs as much as `ridge` squared points
        lam = a.ridge ** 2 * len(b) / 1e4
        x = np.linalg.solve(A.T @ A + lam * np.eye(A.shape[1]), A.T @ b)
        return x * a.damp

    def report(x, mask, label):
        pred = y0 + Js @ x
        e = np.abs(pred - w)[mask].mean() * 100
        e0 = np.abs(y0 - w)[mask].mean() * 100
        print(f"  {label:28s} base {e0:.2f} -> predicted {e:.2f} points")

    print(f"base {json.dumps(base_p.as_dict())}: {score(base)['mae']:.2f} points, {score(base)['miss']} out, "
          f"facts off {facts_off(base)}")
    for fold in (0, 1):
        x = step_on(folds == fold)
        print(f"fit on half {fold}:")
        report(x, folds == fold, f"half {fold} (fitted)")
        report(x, folds != fold, f"half {1 - fold} (held out)")
        print("  params", json.dumps({n: round(float(bv[Params.NAMES.index(n)] + x[i] * scale[i]), 4)
                                      for i, n in enumerate(free)}))
    x = step_on(np.ones(len(w), bool))
    print("fit on all:")
    report(x, np.ones(len(w), bool), "all (fitted)")
    new = bv.copy()
    for i, n in enumerate(free):
        new[Params.NAMES.index(n)] += x[i] * scale[i]
    print("  next params", json.dumps(Params.of(new).as_dict()))


def cmd_show(a):
    for r in load_runs(a.runs):
        s = score(r)
        h = [score(r, {x["name"] for x in certain_refs() if fold_of(x) == f}) for f in (0, 1)]
        print(f"{r['iters']:5d} {s['mae']:.2f} pts {s['miss']:2d}/{s['n']} out, facts off {facts_off(r):2d}, "
              f"halves {h[0]['mae']:.2f}/{h[1]['mae']:.2f}  {json.dumps(r['params'])}")


def run_at(runs, params: dict) -> dict:
    from engine.pf_model import Params
    want = np.round(Params.of(params).vector(), 6)
    for r in runs:
        if np.array_equal(np.round(Params.of(r["params"]).vector(), 6), want):
            return r
    sys.exit(f"no run at {json.dumps(params)}")


def held_out(runs, fit0: dict, fit1: dict) -> dict:
    """The cross-validated error: each half's references scored in the solve fitted on the other half."""
    names = [{x["name"] for x in certain_refs() if fold_of(x) == f} for f in (0, 1)]
    r0, r1 = run_at(runs, fit0), run_at(runs, fit1)        # fitted on half 0, on half 1
    merged = {"refs": {**{k: v for k, v in r1["refs"].items() if k in names[0]},
                       **{k: v for k, v in r0["refs"].items() if k in names[1]}}}
    return {"held_out": score(merged), "half0_from_fit1": score(r1, names[0]), "half1_from_fit0": score(r0, names[1])}


def cmd_cv(a):
    runs = load_runs(a.runs)
    base = run_at(runs, json.loads(a.base) if a.base else {})
    cv = held_out(runs, json.loads(a.fit0), json.loads(a.fit1))
    print(f"base {score(base)['mae']:.2f} points ({score(base)['miss']} out); held out {cv['held_out']['mae']:.2f} "
          f"points ({cv['held_out']['miss']} out): half 0 from the half-1 fit {cv['half0_from_fit1']['mae']:.2f}, "
          f"half 1 from the half-0 fit {cv['half1_from_fit0']['mae']:.2f}")


def cmd_write(a):
    """engine/pf_calib.py: the adopted parameters and what they were measured at (from the runs file)."""
    from engine.pf_model import Params
    runs = load_runs(a.runs)
    p = Params.of(json.loads(a.params))
    r, base = run_at(runs, p.as_dict()), run_at(runs, {})
    cv = held_out(runs, json.loads(a.fit0), json.loads(a.fit1)) if a.fit0 else None
    meas = {"refs": "solver/tests/preflop_refs.py certain references (6-max 100bb, 5% capped at 4bb)",
            "iterations": r["iters"], "spots": score(r)["n"],
            "base_mae_points": round(score(base)["mae"], 2), "base_out": score(base)["miss"],
            "base_facts_off": facts_off(base),
            "mae_points": round(score(r)["mae"], 2), "out": score(r)["miss"], "facts_off": facts_off(r),
            "facts": len(r["facts"])}
    if cv:
        meas["held_out_mae_points"] = round(cv["held_out"]["mae"], 2)
        meas["held_out_base_points"] = round(score(base)["mae"], 2)
    body = (
        '"""Generated by scripts/pf/calibrate.py write: engine/pf_model.py\'s calibrated corrections (Params), and what they\n'
        'were measured at against the published 6-max 100bb solves (docs/ACCURACY.md section 18.4). Don\'t edit by hand."""\n'
        f"PARAMS = {json.dumps(p.as_dict(), indent=4)}\n\n"
        f"MEASURED = {json.dumps(meas, indent=4)}\n")
    out = os.path.join(ROOT, "engine", "pf_calib.py")
    with open(out, "w") as f:
        f.write(body.replace(": true", ": True").replace(": false", ": False").replace(": null", ": None"))
    print(f"wrote {out}: {json.dumps(meas)}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("eval")
    e.add_argument("--params", required=True, help="JSON list of Params dicts")
    e.add_argument("--iters", type=int, default=ITERS)
    e.add_argument("--out", required=True)
    e.add_argument("--expl", action="store_true", help="also measure exploitability (~10 s more)")
    f = sub.add_parser("fit")
    f.add_argument("--runs", required=True)
    f.add_argument("--base", default="", help="JSON Params dict of the base run (default: none)")
    f.add_argument("--free", default="", help="comma-separated parameters to fit (default: all with runs)")
    f.add_argument("--iters", type=int, default=ITERS)
    f.add_argument("--ridge", type=float, default=1.0)
    f.add_argument("--damp", type=float, default=1.0)
    s = sub.add_parser("show")
    s.add_argument("--runs", required=True)
    c = sub.add_parser("cv")
    c.add_argument("--runs", required=True)
    c.add_argument("--base", default="")
    c.add_argument("--fit0", required=True, help="JSON Params dict fitted on half 0")
    c.add_argument("--fit1", required=True, help="JSON Params dict fitted on half 1")
    w = sub.add_parser("write")
    w.add_argument("--runs", required=True)
    w.add_argument("--params", required=True, help="JSON Params dict adopted (a run at it must be in --runs)")
    w.add_argument("--fit0", default="")
    w.add_argument("--fit1", default="")
    a = ap.parse_args()
    {"eval": cmd_eval, "fit": cmd_fit, "show": cmd_show, "cv": cmd_cv, "write": cmd_write}[a.cmd](a)


if __name__ == "__main__":
    main()
