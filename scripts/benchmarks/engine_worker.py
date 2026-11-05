"""One spot on the engine, through its Python API, in a process of its own. The only benchmark file that imports gto.

    python scripts/benchmarks/engine_worker.py SPOT ITERATIONS OUT_PREFIX

Writes OUT_PREFIX.json (the tree as the engine built it, its own exploitability and values, time, peak memory) and
OUT_PREFIX.npz (its average strategies). The engine runs as the app natively runs it (the compiled core when it covers
the tree), single-threaded; GTO_CORE=0 in the environment runs it in numpy instead.

The Config turns off everything that makes the engine's tree smaller than the game: every turn and river is dealt
(n_turns, n_rivers_from_flop, leaf_* past the deck, turn_classes and river_classes off, no sampling), no buckets, and
depth covers every street. The app's own flop model (buckets, card classes) and river classes are therefore NOT what is
measured here; see docs/ACCURACY.md.
"""
from __future__ import annotations

import json
import os
import resource
import sys
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "solver"))
import numpy as np  # noqa: E402

from gto import core  # noqa: E402
from gto.cards import ALL_COMBOS, COMBO_INDEX, card, card_str  # noqa: E402
from gto.multiway_solver import MWConfig, MultiwaySolver  # noqa: E402
from gto.multiway_solver import Decision as MDecision  # noqa: E402
from gto.solver import Chance, Config, Decision, N_FULL, Terminal, solve  # noqa: E402

import spots  # noqa: E402  (plain data)
from refsolver.cards import parse_board, parse_range, card_text  # noqa: E402  (text of the spot only)

STREETS = ("flop", "turn", "river")


def peak_rss_mb() -> float:
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return v / (1 << 20) if sys.platform == "darwin" else v / 1024


def board_cards(spot) -> list:
    return [card(card_text(c)) for c in parse_board(spot["board"])]


def full_vector(rng: dict) -> np.ndarray:
    r = np.zeros(N_FULL)
    for name, w in rng.items():
        a, b = card(name[:2]), card(name[2:])
        r[COMBO_INDEX[(min(a, b), max(a, b))]] = w
    return r


def combo_names(active) -> list:
    return [card_str(ALL_COMBOS[i][0]) + card_str(ALL_COMBOS[i][1]) for i in active]


def hu_config(spot: dict, **more) -> Config:
    m = spot["menu"]
    return Config(bet_sizes={s: list(m["bets"]) for s in STREETS}, raise_sizes={s: list(m["raises"]) for s in STREETS},
                  max_raises=spot["max_raises"], allin_spr=spot["allin_spr"], depth=3, n_turns=49, n_rivers=None,
                  river_sample=None, n_rivers_from_flop=48, leaf_turns=49, leaf_rivers=None, leaf_rivers_flop=48,
                  river_play=False, turn_classes=False, later_sizes=None, river_classes=False,
                  rake_rate=spot.get("rake", 0.0), rake_cap=spot.get("cap"), **more)


def hu_ranges(spot: dict) -> tuple:
    refboard = parse_board(spot["board"])
    if spot.get("ranges_exact"):
        return full_vector(spot["ranges_exact"][0]), full_vector(spot["ranges_exact"][1])
    return full_vector(parse_range(spot["oop"], refboard)), full_vector(parse_range(spot["ip"], refboard))


def scalar(x) -> float:
    return float(np.ravel(x)[0])


def export_hu(root) -> tuple:
    """{path: description} of the tree and {path: (B, A, N) average strategy}, with the row boards as text."""
    tree, strat, rows = {}, {}, {}

    def walk(n, path):
        if isinstance(n, Decision):
            tree[path] = {"kind": "act", "player": int(n.player), "names": list(n.names), "street": len(n.boards[0])}
            strat[path] = n.avg_strategy().astype(np.float32)
            rows[path] = ["".join(card_str(c) for c in b) for b in n.boards]
            for name, kid in zip(n.names, n.children):
                walk(kid, f"{path}/{name}")
        elif isinstance(n, Chance):
            walk(n.child, path + "|")
        else:
            t = {"kind": n.kind, "inv": [scalar(n.inv[0]), scalar(n.inv[1])], "street": len(n.boards[0]),
                 "folder": None if n.folder is None else int(n.folder),
                 "rake": 0.0 if n.rake is None else scalar(n.rake)}
            if n.pay is not None:
                t["pay"] = [scalar(x) for x in n.pay]
            tree[path] = t

    walk(root, "")
    return tree, strat, rows


def run_hu(spot: dict, iters: int, cfg_more=None) -> tuple:
    board = board_cards(spot)
    r0, r1 = hu_ranges(spot)
    cfg = hu_config(spot, **(cfg_more or {}))
    t0 = time.time()
    sol = solve(board, r0, r1, spot["pot"], spot["stack"], bets=tuple(spot.get("bets0", (0.0, 0.0))),
                to_act=spot.get("to_act", 0), n_raises=spot.get("n_raises", 0), cfg=cfg, time_budget=1e9,
                max_iters=iters)
    wall = time.time() - t0
    s = sol.solver
    t1 = time.time()
    expl = sol.exploitability()
    expl_s = time.time() - t1
    a, b = sol.r0[None, :].astype(np.float32), sol.r1[None, :].astype(np.float32)
    s.sampling = False
    u = [s._cfr(sol.root, p, a, b, update=False, use_avg=True)[0] for p in (0, 1)]
    s.sampling = True
    pairs = float((s.compat_sum(sol.r1[None, :])[0] * sol.r0).sum())
    values = [float((u[0] * sol.r0).sum()) / pairs, float((u[1] * sol.r1).sum()) / pairs]
    tree, strat, rows = export_hu(sol.root)
    meta = {"iterations": int(sol.iters), "wall_s": wall, "iterate_s": float(sol.seconds), "exploitability_s": expl_s,
            "engine_exploitability_pct": float(expl), "engine_br_values": [float(x) for x in s.br_values[1:3]],
            "engine_values": values, "use_core": bool(s.use_core and core.lib() is not None), "cells": int(sol.cells),
            "n_nodes": int(sol.n_nodes), "pairs": pairs, "combos": combo_names(sol.ctx.active), "tree": tree,
            "rows": rows, "root_pot": float(sol.root.pot_now), "root_evs": sol.evs[:, sol.ctx.active].tolist()}
    return meta, strat, sol


def export_mw(s: MultiwaySolver) -> tuple:
    tree, strat = {}, {}

    def walk(n, path):
        if isinstance(n, MDecision):
            tree[path] = {"kind": "act", "player": int(n.player), "names": list(n.names), "street": 5}
            strat[path] = n.avg_strategy().astype(np.float32)
            for name, kid in zip(n.names, n.children):
                walk(kid, f"{path}/{name}")
        else:
            tree[path] = {"kind": n.kind, "live": [int(x) for x in n.live], "pot": float(n.pot),
                          "c": [float(x) for x in n.c], "rake": float(n.rake), "street": 5}

    walk(s.root, "")
    return tree, strat


def run_mw(spot: dict, iters: int) -> tuple:
    board = board_cards(spot)
    refboard = parse_board(spot["board"])
    ranges = [full_vector(parse_range(r, refboard)) for r in spot["ranges"]]
    cfg = MWConfig(bet={"flop": spot["bet"], "turn": spot["bet"], "river": list(spot["bet"])},
                   raise_frac=spot["raise_frac"], max_raises=spot["max_raises"], allin_spr=spot["allin_spr"],
                   rake_rate=spot.get("rake", 0.0), rake_cap=spot.get("cap"), later="deal", exact=True, depth=1)
    t0 = time.time()
    s = MultiwaySolver(board, ranges, spot["pot"], spot["stack"], cfg=cfg).run(iters=iters)
    wall = time.time() - t0
    t1 = time.time()
    gains = s.br_gains()
    expl_s = time.time() - t1
    tree, strat = export_mw(s)
    meta = {"iterations": int(s.iters), "wall_s": wall, "exploitability_s": expl_s, "tree": tree,
            "engine_nash_conv_pct": float(s.nash_conv()), "engine_gains": [float(x) for x in gains],
            "engine_values": [float(x) for x in s.values()], "use_core": s._core() is not None,
            "combos": combo_names(s.hands.active), "root_pot": float(s.root_pot()), "deals": float(s.total_mass())}
    return meta, strat, s


def main():
    name, iters, prefix = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    spot = spots.get(name)
    meta, strat, _ = run_mw(spot, iters) if spot["kind"] == "mw" else run_hu(spot, iters)
    meta["peak_rss_mb"] = peak_rss_mb()
    with open(prefix + ".json", "w") as f:
        json.dump(meta, f)
    np.savez_compressed(prefix + ".npz", **{"s:" + k: v for k, v in strat.items()})


if __name__ == "__main__":
    main()
