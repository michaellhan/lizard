"""The profile re-solve (engine/profile_solve.py) against an independent best response (docs/ACCURACY.md section 23).

With every decision of one player held to the profile, the restricted game's value for the other player is their best
response to that held strategy. The independent check is the engine's own best-response walk over the equilibrium
solve's tree with TendencyLock laid on during the walk (what gto/exploit.py's one-node answer computes, here at every
node), a code path apart from the re-solve's CFR and its pins.

    /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh \\
        .venv/bin/python scripts/benchmarks/profile_bench.py            # writes results/profile.json, prints tables

  exact     exact trees (every card dealt, per combo): rivers and a turn, 4 presets x both players, at several
            iteration counts: the re-solve's remaining gain (its convergence), its gap to the independent best
            response, and the pins against the walk's strategy
  spoiled   the re-solve run with the wrong profile and checked against the right one: the check should fail
  advisor   the app's own trees at the worker's Fast config (scripts/engine/test_study_lock.py FAST), through Study's
            request: the three values and the convergence the panel shows; no independent check of the abstraction
"""
from __future__ import annotations

import json
import os
import sys
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path[:0] = [os.path.join(ROOT, "solver"), ROOT, os.path.join(ROOT, "scripts", "engine")]

import numpy as np  # noqa: E402

from engine import profile_solve as ps  # noqa: E402
from engine import study_lock as sl  # noqa: E402
from gto.cards import cards  # noqa: E402
from gto.ranges import parse_range  # noqa: E402
from gto.solver import Config, solve  # noqa: E402

OUT = os.path.join(ROOT, "scripts", "benchmarks", "results", "profile.json")
STREETS = ("flop", "turn", "river")


def exact(bets=(0.5, 1.0), raises=(1.0,), max_raises=1) -> Config:
    return Config(bet_sizes={s: list(bets) for s in STREETS}, raise_sizes={s: list(raises) for s in STREETS},
                  max_raises=max_raises, allin_spr=0.0, depth=3, n_turns=49, n_rivers=None, river_sample=None,
                  n_rivers_from_flop=48, leaf_turns=49, leaf_rivers=None, leaf_rivers_flop=48, river_play=False,
                  turn_classes=False, later_sizes=None, river_classes=False)


SPOTS = {
    "river-2sizes": dict(board="2c7d9hJsKd", r0="KK,QQ,JJ,99,77,AJs,KQs,QJs,JTs,T9s,98s,65s,A5s",
                         r1="AA,KK,QQ,TT,88,AJs,KJs,QJs,JTs,T8s,87s,A4s,AKo", cfg=dict(), iters=(300, 1000, 3000)),
    "river-2raises": dict(board="Ah8d5c3s3h", r0="AK,AQ,AJ,88,55,76s,64s,KQs,QJs,T9s,K8s",
                          r1="AA,AK,AT,99,88,55,KQs,JTs,97s,64s,42s,22", cfg=dict(bets=(0.33, 0.75, 1.5), max_raises=2),
                          iters=(300, 1000, 3000)),
    "turn-1size": dict(board="2c7d9hJs", r0="KK,99,77,AJs,KQs,QJs,JTs,98s,65s", r1="AA,QQ,TT,KJs,QJs,T8s,87s,AKo",
                       cfg=dict(bets=(0.75,)), iters=(100, 400)),
}


def run_exact():
    rows = []
    for name, sp in SPOTS.items():
        board, r0, r1 = cards(sp["board"]), parse_range(sp["r0"]), parse_range(sp["r1"])
        t = time.time()
        eq = solve(board, r0, r1, 10.0, 40.0, cfg=exact(**sp["cfg"]), time_budget=1e9, max_iters=max(sp["iters"]))
        eq_s = time.time() - t
        asked = dict(board=tuple(board), r0=r0, r1=r1, pot=10.0, stack=40.0)
        for player in (0, 1):
            for preset, adj in ps.PRESETS.items():
                for iters in sp["iters"]:
                    t = time.time()
                    held = ps.solve_profile(eq, asked, player, adj, time_budget=1e9, max_iters=iters)
                    secs = time.time() - t
                    c = ps.br_check(eq, held, player, adj)
                    conv = ps.convergence(held)
                    rows.append(dict(spot=name, player=player, preset=preset, iterations=int(held.iters),
                                     gain_pct=conv["gain_pct"], gap_pct=c["gap_pct"], pins_pct=c["pins_pct"],
                                     held_gain_pct=abs(held.measure()["gain_held"][player]) / conv["root_pot"] * 100,
                                     value=c["value"], best_response=c["best_response"],
                                     eq_vs_profile=ps.eq_against_profile(eq, held), eq_value=ps.measure_plain(eq)["value"][1 - player],
                                     nodes=held.profile["nodes"], cells=held.profile["cells"], seconds=round(secs, 3),
                                     eq_seconds=round(eq_s, 3)))
                    print(f"{name:14s} p{player} {preset:10s} {iters:5d}: gain {conv['gain_pct']:.6f}% gap "
                          f"{c['gap_pct']:+.6f}% pins {c['pins_pct']:.2e}% {secs:.2f}s", flush=True)
    return rows


def run_spoiled():
    sp = SPOTS["river-2sizes"]
    board, r0, r1 = cards(sp["board"]), parse_range(sp["r0"]), parse_range(sp["r1"])
    eq = solve(board, r0, r1, 10.0, 40.0, cfg=exact(), time_budget=1e9, max_iters=3000)
    asked = dict(board=tuple(board), r0=r0, r1=r1, pot=10.0, stack=40.0)
    faults = [("station checked as nit", "station", ps.PRESETS["nit"]),
              ("fold -20 checked as fold -25", {"fold": -20}, {"fold": -25}),
              ("bluff -50 checked as bluff -45", {"bluff": -50}, {"bluff": -45}),
              ("the equilibrium (bet -1) checked as station", {"bet": -1}, ps.PRESETS["station"])]
    rows = []
    for label, ran, right in faults:
        ran = ps.PRESETS[ran] if isinstance(ran, str) else ran
        for player in (0, 1):
            held = ps.solve_profile(eq, asked, player, ran, time_budget=1e9, max_iters=3000)
            c = ps.br_check(eq, held, player, right)
            rows.append(dict(fault=label, player=player, gap_pct=c["gap_pct"], pins_pct=c["pins_pct"],
                             caught=bool(abs(c["gap_pct"]) > 0.01 or c["pins_pct"] > 0.01)))
            print(f"spoiled {label:44s} p{player}: gap {c['gap_pct']:+.4f}% pins {c['pins_pct']:.4f}%", flush=True)
    return rows


def run_advisor():
    from test_study_lock import FAST, ON_FLOP, ON_TURN, RIVER, advisor
    adv = advisor(FAST, 0.2)
    adv.should_stop = lambda: False
    rows = []
    for label, state, seat, more in (("river, BTN station", RIVER, "BTN", {}), ("river, BB nit", RIVER, "BB", {}),
                                     ("turn, BB station", ON_TURN, "BB", {}),
                                     ("turn, BB station, from the flop", ON_TURN, "BB", {"streets": "hand"}),
                                     ("flop, BB station", ON_FLOP, "BB", {}), ("flop, BTN maniac", ON_FLOP, "BTN", {})):
        adj = "nit" if "nit" in label else "maniac" if "maniac" in label else "station"
        ps.clear_cache()
        t = time.time()
        r = sl.answer(adv, dict(state, budget=8.0, prior_budget=3.0,
                                nodelock={"profile": dict(seat=seat, adj=adj, **more)}))
        secs = time.time() - t
        if "error" in r:
            rows.append(dict(spot=label, error=r["error"]))
            print(label, r["error"])
            continue
        p = r["profile_solve"]
        v, c = p["values"], p["convergence"]
        rows.append(dict(spot=label, exploiter=p["exploiter"], eq=v["eq"], eq_vs_profile=v["eq_vs_profile"],
                         exploit=v["exploit"], best_response=v["best_response"], root_pot=v["root_pot"],
                         gain_pct=c["gain_pct"], iterations=c["iterations"], nodes=p["pinned"]["nodes"],
                         streets=p["streets"], seconds=round(secs, 2)))
        print(f"{label:34s} eq {v['eq']:.3f} vs-profile {v['eq_vs_profile']:.3f} exploit {v['exploit']:.3f} "
              f"BR {v['best_response']:.3f} gain {c['gain_pct']:.4f}% {c['iterations']} it {secs:.1f}s", flush=True)
    return rows


def main():
    t0 = time.time()
    out = {"exact": run_exact(), "spoiled": run_spoiled(), "advisor": run_advisor(),
           "seconds": round(time.time() - t0, 1), "machine": os.uname().machine}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, default=float)
    ex = out["exact"]
    for spot in SPOTS:
        for it in SPOTS[spot]["iters"]:
            rs = [r for r in ex if r["spot"] == spot and r["iterations"] == it]
            if rs:
                print(f"{spot:14s} {it:5d} it: worst gain {max(r['gain_pct'] for r in rs):.6f}% worst |gap| "
                      f"{max(abs(r['gap_pct']) for r in rs):.6f}% worst pins {max(r['pins_pct'] for r in rs):.2e}% "
                      f"max {max(r['seconds'] for r in rs):.2f}s")
    print(f"done in {out['seconds']} s -> {OUT}")


if __name__ == "__main__":
    with np.errstate(all="ignore"):
        main()
