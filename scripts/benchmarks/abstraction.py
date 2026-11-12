"""What the app's flop abstraction costs: a bucketed flop solve's strategy, held hand by hand in the exact game.

A live flop solve doesn't play the game it is asked about. Under the flop's chance node it plays the turn by rank
classes, the turn and river by hand buckets, and the river cards by sample (docs/research/03 §2.5); the exploitability
its badge shows is measured inside that smaller game. This benchmark measures the distance the badge can't see, the way
upstream measured its library against an outside solver (solver/README.md, "Flops"; solver/scripts/
bench_flop_abstraction.py), but with Lizard's own exact mode as the full game, so it fits this machine:

  1. the abstract solve: the spot in one of the app's flop models (VARIANTS), natively, to a fixed iteration count;
  2. the exact solve: the same spot and menu with every turn and river card dealt, per combo (the benchmark's exact
     Config, docs/ACCURACY.md §14, checked there against an independent LP and DCFR), to EXACT_ITERS;
  3. for each player p, the exact game again with p's every flop decision held at the abstract solve's mix, combo by
     combo (engine/nodelock.py hold_strategy), and everything after the flop, p's own play included, re-solved:
         given_up[p] = value[p] in 2 - value[p] in 3, in % of the pot
     the EV p's bucketed flop strategy loses against every card dealt when both players play the turn and river
     perfectly. This is upstream's "EV given up" (bench_flop_abstraction.py), in our own exact game.

Beside it: the abstract solve's exploitability in its own game (what the app shows), and how far its flop frequencies
are from the exact solve's (range level, points; per combo, reach-weighted total variation).

Limits, said here and in docs/ACCURACY.md section 21: the exact game holds every turn and river per combo, which is about 34 bytes a
cell here, so the ranges are narrow (about 30 combos a player) and the tree has one raise a street. The app's buckets
then hold one or two combos each where real ranges put 10-20 in one; `fast-k8` plays 8 buckets to show which way that
pushes. The turn and river menu is one size (75%), the menu every live flop solve plays below the flop
(Config.later_sizes), so what's measured is the card and hand abstraction, not a smaller menu.

    SLOT=/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh   # while the precomputation builds run
    PY=scripts/benchmarks/.venv/bin/python
    $SLOT nice -n 10 $PY scripts/benchmarks/abstraction.py run                     # every spot and variant, resumable
    $SLOT nice -n 10 $PY scripts/benchmarks/abstraction.py run --spots srp-K72 --variants fast
    $PY scripts/benchmarks/abstraction.py table                                     # the tables, from the results

Each solve runs in a process of its own (`job`), one at a time, its peak memory recorded. Raw numbers go to
results/abstraction.json.
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import subprocess
import sys
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
os.environ.setdefault("GTO_THREADS", "1")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RESULTS = os.environ.get("ABSTRACTION_RESULTS", os.path.join(HERE, "results", "abstraction.json"))
CACHE = os.environ.get("ABSTRACTION_CACHE", os.path.join(HERE, "results", "abstraction"))          # the abstract solves' flop strategies (npz, untracked)

STREETS = ("flop", "turn", "river")
# The app's flop menu, and below the flop the one size every live flop solve plays there (Config.later_sizes).
MENU = dict(bet_sizes={"flop": [0.33, 0.75], "turn": [0.75], "river": [0.75]},
            raise_sizes={"flop": [0.5], "turn": [0.75], "river": [0.75]}, max_raises=1, allin_spr=2.5)
LATER = {"bet": {"turn": [0.75], "river": [0.75]}, "raise": {"turn": [0.75], "river": [0.75]}}
EXACT = dict(depth=3, n_turns=49, n_rivers=None, river_sample=None, n_rivers_from_flop=48, leaf_turns=49,
             leaf_rivers=None, leaf_rivers_flop=48, river_play=False, turn_classes=False, later_sizes=None,
             river_classes=False)
EXACT_ITERS = int(os.environ.get("ABSTRACTION_ITERS", 1000))   # (the env var: a smoke run's, never a result)

# The app's flop models (solver/gto/static/worker.js: the browser's Fast and Accurate; gto/flop_library.py
# library_config: the library's entries), with MENU's sizes, and the iterations each is solved to.
VARIANTS = {
    "fast": (dict(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=32,
                  turn_buckets=True, bucket_river_step=3, river_classes=True, river_strength=32), 400,
             "the browser's Fast: turn by rank class, turn and river by 32 hand buckets over every third river"),
    "accurate": (dict(n_turns=4, leaf_turns=4, leaf_rivers_flop=8, n_rivers_from_flop=8, river_classes=True,
                      river_buckets=64, turn_buckets=True, bucket_river_step=1, river_strength=32), 1000,
                 "the browser's Accurate: turn by rank class, turn and river by 64 hand buckets over every river"),
    "library": (dict(n_turns=4, leaf_turns=4, leaf_rivers_flop=8, n_rivers_from_flop=8, river_dealt=64), 300,
                "the flop library's model: turn by rank class per combo, the river dealt, 64 buckets on each card"),
    "fast-k8": (dict(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=8,
                     turn_buckets=True, bucket_river_step=3, river_classes=True, river_strength=8), 400,
                "Fast with 8 buckets: about the combos per bucket real ranges put in Fast's 32"),
    # one part of the model at a time, the rest exact
    "turn-classes": (dict(n_turns=49, leaf_turns=49, leaf_rivers_flop=48, n_rivers_from_flop=48, depth=3,
                          river_play=False, turn_classes=True), 1000,
                     "only the turn by rank class (per combo, every river dealt per combo)"),
    "river-strength": (dict(n_turns=49, leaf_turns=49, leaf_rivers_flop=48, turn_classes=False, river_strength=32,
                            river_strength_spr=0.0), 1000,
                       "only the river by 32 strength buckets without its card (every turn per combo)"),
}
SELF = "exact-self"   # the control: the exact solve's own flop held in the exact game (given up ~0, within convergence)

# Narrow on purpose (the module's docstring): about 30 combos a player, a mix of made hands, draws and air.
SPOTS = {
    "srp-K72": dict(board="Ks7d2c", pot=5.5, stack=97.5, what="single-raised pot, dry king-high, 100bb",
                    oop="77,22,K9s,QJs,JTs,98s,65s",
                    ip="AA,KK,AKs,KQs,QQ,A5s"),
    "srp-JT8": dict(board="JdTd8c", pot=5.5, stack=97.5, what="single-raised pot, wet two-tone, 100bb",
                    oop="88,T9s,97s,Q9s,AdXd,65s",
                    ip="AA,JJ,AJs,KQs,98s,KdQd,A5s"),
    "3bp-AJ3": dict(board="AhJd3c", pot=20.0, stack=80.0, what="3bet pot, ace-high, SPR 4",
                    oop="AA,KK,AKs,AQs,A5s,KQs,76s",
                    ip="AJo:0.5,QJs,JTs,TT,33,KJs"),
}


# ------------------------------------------------------------------------------------------------- the engine side

def _engine():
    sys.path.insert(0, os.path.join(ROOT, "solver"))
    sys.path.insert(0, ROOT)


def _ranges(spot):
    import numpy as np
    from gto.ranges import parse_range
    rs = []
    for text in (spot["oop"], spot["ip"]):
        # "AdXd": the ace of diamonds with any diamond (a nut flush draw's combos)
        parts, extra = [], []
        for p in text.split(","):
            if p.endswith("Xd") or p.endswith("Xh") or p.endswith("Xs") or p.endswith("Xc"):
                extra.append(p)
            else:
                parts.append(p)
        r = parse_range(",".join(parts)) if parts else np.zeros(1326)
        for p in extra:
            from gto.cards import COMBO_INDEX, card
            hi, s = card(p[:2]), p[1]
            for rank in "23456789TJQK":
                lo = card(rank + s)
                if lo != hi:
                    r[COMBO_INDEX[(min(hi, lo), max(hi, lo))]] = 1.0
        rs.append(r)
    return rs


def _config(variant):
    from gto.solver import Config
    if variant == "exact":
        return Config(**MENU, **EXACT)
    return Config(**MENU, later_sizes=LATER, **VARIANTS[variant][0])


def _peak_mb():
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return v / (1 << 20) if sys.platform == "darwin" else v / 1024


def _freqs(held, r_full):
    """{line: {action: range frequency}} of a street_strategy: each decision's mix over the hands that reach it, the
    player's root range (the board's combos out: a strategy's columns sum to 1 only on the solve's combos) times the
    player's own earlier actions on the line."""
    import numpy as np
    out = {}
    for line in sorted(held, key=len):
        names, s = held[line]
        reach = r_full * (s.sum(axis=0) > 0.5)
        for i in range(len(line)):
            if line[:i] in held:
                pn, ps = held[line[:i]]
                reach = reach * ps[pn.index(line[i])]
        w = reach / max(float(reach.sum()), 1e-12)
        out[" / ".join(line) or "root"] = dict(zip(names, (s @ w).round(5).tolist()))
    return out


def job(kind, spot_name, variant=None, player=None):
    """One solve, in this process: a JSON record on stdout."""
    _engine()
    import numpy as np
    from engine import nodelock as nl
    from gto.cards import cards as parse_cards
    from gto.solver import solve, tree_cells
    spot = SPOTS[spot_name]
    board = parse_cards(spot["board"])
    r0, r1 = _ranges(spot)
    pot, stack = spot["pot"], spot["stack"]
    t0 = time.time()
    if kind == "abstract":
        cfg, iters = _config(variant), int(os.environ.get("ABSTRACTION_ITERS", VARIANTS[variant][1]))
        sol = solve(board, r0, r1, pot, stack, cfg=cfg, time_budget=1e9, max_iters=iters)
        held = [nl.street_strategy(sol, p) for p in (0, 1)]
        os.makedirs(CACHE, exist_ok=True)
        arrays = {_ckey(p, line, names): s for p in (0, 1) for line, (names, s) in held[p].items()}
        np.savez_compressed(os.path.join(CACHE, f"{spot_name}_{variant}.npz"), **arrays)
        m = nl.measure_plain(sol)
        return dict(kind=kind, spot=spot_name, variant=variant, iterations=int(sol.iters), seconds=time.time() - t0,
                    cells=int(sol.cells) if hasattr(sol, "cells") else None, peak_mb=_peak_mb(),
                    own_exploitability_pct=m["exploitability_pct"], value=m["value"],
                    freqs=[_freqs(held[p], (r0, r1)[p]) for p in (0, 1)])
    cfg = _config("exact")
    cells = tree_cells(board, r0, r1, pot, stack, cfg=cfg)
    if kind == "exact":
        sol = nl.solve_locked(board, r0, r1, pot, stack, [], cfg=cfg, time_budget=1e9, max_iters=EXACT_ITERS)
        held = [nl.street_strategy(sol, p) for p in (0, 1)]
        os.makedirs(CACHE, exist_ok=True)
        np.savez_compressed(os.path.join(CACHE, f"{spot_name}_exact.npz"),
                            **{_ckey(p, line, names): s for p in (0, 1)
                               for line, (names, s) in held[p].items()})
        m = sol.measure()
        return dict(kind=kind, spot=spot_name, iterations=int(sol.iters), seconds=time.time() - t0, cells=int(cells),
                    peak_mb=_peak_mb(), value=m["value"], exploitability_pct=m["exploitability_pct"],
                    root_pot=m["root_pot"], combos=[int((r0 > 0).sum()), int((r1 > 0).sum())],
                    freqs=[_freqs(held[p], (r0, r1)[p]) for p in (0, 1)])
    # kind == "locked": the exact game with `player`'s flop held at the abstract solve's
    held = _load(spot_name, "exact" if variant == SELF else variant)[player]
    info = {}

    def seed(root, s):
        info["cells"] = nl.hold_strategy(s, held, player)

    sol = nl.solve_locked(board, r0, r1, pot, stack, [], cfg=cfg, time_budget=1e9, max_iters=EXACT_ITERS, seed=seed)
    m = sol.measure()
    return dict(kind=kind, spot=spot_name, variant=variant, player=player, iterations=int(sol.iters),
                seconds=time.time() - t0, cells=int(cells), peak_mb=_peak_mb(), held_cells=info.get("cells"),
                value=m["value"], exploitability_pct=m["exploitability_pct"], gain_held=m["gain_held"])


def _ckey(p, line, names):
    return f"p{p}#{'|'.join(line)}#{'|'.join(names)}"


def _load(spot_name, variant):
    """The cached street strategies: [player 0's, player 1's], each {line: (names, (A, N_FULL))}."""
    import numpy as np
    z = np.load(os.path.join(CACHE, f"{spot_name}_{variant}.npz"))
    out = [{}, {}]
    for key in z.files:
        p, line, names = key.split("#")
        out[int(p[1:])][tuple(line.split("|")) if line else ()] = (names.split("|"), z[key])
    return out


# ------------------------------------------------------------------------------------------------- the driver

def _read():
    if os.path.exists(RESULTS):
        with open(RESULTS) as f:
            return json.load(f)
    return {"runs": {}}


def _write(res):
    os.makedirs(os.path.dirname(RESULTS), exist_ok=True)
    with open(RESULTS + ".tmp", "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
    os.replace(RESULTS + ".tmp", RESULTS)


def _key(kind, spot, variant=None, player=None):
    return "/".join(str(x) for x in (kind, spot, variant, player) if x is not None)


def run(spot_names, variants, force=False):
    res = _read()
    res["config"] = dict(menu=MENU, later=LATER, exact=EXACT, exact_iters=EXACT_ITERS,
                         variants={k: dict(config=v[0], iterations=v[1], what=v[2]) for k, v in VARIANTS.items()},
                         spots=SPOTS)
    plan = []
    for s in spot_names:
        plan.append(("exact", s, None, None))
        for v in variants:
            plan += ([] if v == SELF else [("abstract", s, v, None)]) + [("locked", s, v, 0), ("locked", s, v, 1)]
    for kind, s, v, p in plan:
        k = _key(kind, s, v, p)
        if k in res["runs"] and not force and "error" not in res["runs"][k]:
            continue
        if kind == "locked" and not os.path.exists(os.path.join(CACHE, f"{s}_{'exact' if v == SELF else v}.npz")):
            print(f"{k}: the abstract solve's cache is missing, run it again with --force", flush=True)
            continue
        args = [sys.executable, os.path.abspath(__file__), "job", kind, s] + ([v] if v else []) + \
            ([str(p)] if p is not None else [])
        print(f"{k} ...", flush=True)
        out = subprocess.run(args, capture_output=True, text=True)
        if out.returncode != 0:
            print(out.stderr[-3000:], flush=True)
            res["runs"][k] = {"error": out.stderr[-1500:]}
        else:
            rec = json.loads(out.stdout.strip().splitlines()[-1])
            res["runs"][k] = rec
            print(f"  {rec.get('iterations')} iterations, {rec['seconds']:.0f} s, {rec['peak_mb']:.0f} MB", flush=True)
        res["measured"] = time.strftime("%Y-%m-%d")
        _write(res)


def summary(res):
    """Per spot and variant: each player's EV given up and the measures beside it."""
    runs, rows = res["runs"], []
    for s, spot in SPOTS.items():
        ex = runs.get(_key("exact", s))
        if not ex or "error" in ex:
            continue
        pot = ex["root_pot"]
        for v in [SELF] + list(VARIANTS):
            ab = runs.get(_key("abstract", s, v)) if v != SELF else \
                dict(ex, own_exploitability_pct=ex["exploitability_pct"])
            lk = [runs.get(_key("locked", s, v, p)) for p in (0, 1)]
            if not ab or "error" in ab or any(not x or "error" in x for x in lk):
                continue
            given = [(ex["value"][p] - lk[p]["value"][p]) / pot * 100 for p in (0, 1)]
            dev = []
            for p in (0, 1):
                worst = 0.0
                for line, mix in ex["freqs"][p].items():
                    other = ab["freqs"][p].get(line, {})
                    worst = max([worst] + [abs(other.get(a, 0) - f) * 100 for a, f in mix.items()])
                dev.append(worst)
            rows.append(dict(spot=s, variant=v, given_up=given, own=ab["own_exploitability_pct"],
                             exact_expl=ex["exploitability_pct"], locked_expl=[x["exploitability_pct"] for x in lk],
                             freq_dev=dev, iters=ab["iterations"], ab_mb=ab["peak_mb"], ex_mb=ex["peak_mb"],
                             lk_mb=max(x["peak_mb"] for x in lk), cells=ex["cells"], combos=ex["combos"]))
    return rows


def table(res):
    rows = summary(res)
    print("| Spot | Model | Iterations | Own game (% pot) | Given up OOP | Given up IP | Worst flop frequency gap, "
          "OOP / IP (points) | Exact solves' exploitability (% pot) |")
    print("|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['spot']} | {r['variant']} | {r['iters']} | {r['own']:.3f} | {r['given_up'][0]:.3f} | "
              f"{r['given_up'][1]:.3f} | {r['freq_dev'][0]:.1f} / {r['freq_dev'][1]:.1f} | "
              f"{r['exact_expl']:.3f}; held {r['locked_expl'][0]:.3f} / {r['locked_expl'][1]:.3f} |")
    print()
    print("| Spot | Combos OOP x IP | Exact cells (M) | Peak MB: exact, held, abstract |")
    print("|---|---|---|---|")
    seen = set()
    for r in rows:
        if r["spot"] in seen:
            continue
        seen.add(r["spot"])
        print(f"| {r['spot']} | {r['combos'][0]} x {r['combos'][1]} | {r['cells'] / 1e6:.1f} | "
              f"{r['ex_mb']:.0f}, {r['lk_mb']:.0f}, {r['ab_mb']:.0f} |")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--spots", default=",".join(SPOTS))
    r.add_argument("--variants", default=",".join([SELF] + list(VARIANTS)))
    r.add_argument("--force", action="store_true")
    j = sub.add_parser("job")
    j.add_argument("kind", choices=("abstract", "exact", "locked"))
    j.add_argument("spot")
    j.add_argument("rest", nargs="*")
    sub.add_parser("table")
    sub.add_parser("cells")
    a = ap.parse_args()
    if a.cmd == "run":
        run(a.spots.split(","), a.variants.split(","), a.force)
    elif a.cmd == "job":
        variant = a.rest[0] if a.rest else None
        player = int(a.rest[1]) if len(a.rest) > 1 else None
        print(json.dumps(job(a.kind, a.spot, variant, player)))
    elif a.cmd == "table":
        table(_read())
    elif a.cmd == "cells":
        _engine()
        from gto.cards import cards as parse_cards
        from gto.solver import tree_cells
        for s, spot in SPOTS.items():
            r0, r1 = _ranges(spot)
            c = tree_cells(parse_cards(spot["board"]), r0, r1, spot["pot"], spot["stack"], cfg=_config("exact"))
            print(s, int((r0 > 0).sum()), int((r1 > 0).sum()), f"{c / 1e6:.1f}M cells")


if __name__ == "__main__":
    main()
