"""The node lock (engine/nodelock.py) against the restricted game's LP (refsolver/locks.py), by the benchmark's rules:
identical trees and input ranges, each side in its own process, every number that says "by the reference" from the
reference's own walker. This file imports no engine code at the top; only `worker` does, in its own process.

    /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh \\
        scripts/benchmarks/.venv/bin/python scripts/benchmarks/nodelock_bench.py        # everything
    python scripts/benchmarks/nodelock_bench.py --cases river-whole-root,turn-merged    # some; merged into the results
    python scripts/benchmarks/nodelock_bench.py --table                                 # the tables from the results

Needs numpy, treys and scipy (scripts/benchmarks/.venv). Raw numbers go to results/nodelock.json. A check that fails is
written down as failed; nothing here raises on a bad number.

  cases        a lock (whole range, class, single combo, one runout or all of them, both players) on a spot: the LP's
               value of the restricted game against the engine's, at each iteration count, and the engine's profile
               measured by the reference: each side's best response with its own locks held
  equilibrium  every hand at a node locked to the LP's equilibrium mix: the value must not move
  sign         read off the cases: with one player locked the other's value is at least its equilibrium value
  everywhere   every node of one player locked: the other's value is its best response to that fixed strategy
  spoiled      the engine solving the wrong lock, on purpose: the comparison should fail. A row "not caught" is the
               comparison having no power there, which is worth knowing: one runout of 48 barely moves the value
  parity       numpy (merged subtrees) against the compiled core (the original tree) on a lock the merge could lose
  warm         cold against a warm start from the unlocked solve
  overhead     the same tree with and without a lock: time per iteration
  abstraction  the app's own bucketed flop and classed turn: what is honoured and refused; no reference applies
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import subprocess
import sys
import tempfile
import time

for _v in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np  # noqa: E402

import build  # noqa: E402
import compare  # noqa: E402
import spots  # noqa: E402
from refsolver import locks as ref_locks  # noqa: E402
from refsolver.hu import NAct, NDeal  # noqa: E402
from refsolver.cards import RANKS, card_id, combo_cards  # noqa: E402

RESULTS = os.path.join(HERE, "results", "nodelock.json")
TOL_VALUE_PCT = compare.TOL_VALUE_PCT     # the benchmark's: 0.05% of the pot
TOL_EXPL_PCT = compare.TOL_EXPL_PCT
RIVER_ITERS, TURN_ITERS = (300, 3000, 30000), (300, 3000)


def lk(line, player, mix, hands="all") -> dict:
    return {"line": list(line), "player": player, "mix": mix, "hands": hands}


def cls(*names) -> dict:
    return {"classes": list(names)}


def one(*names) -> dict:
    return {"combos": list(names)}


BET = "bet 75%"
CASES = [
    # river-one-size
    ("river-whole-root", "river-one-size", [lk([], 0, {"check": 0.7, BET: 0.3})]),
    ("river-whole-facing-bet", "river-one-size", [lk([BET], 1, {"fold": 0.4, "call": 0.5, "raise to 52.5": 0.1})]),
    ("river-class-root", "river-one-size", [lk([], 0, {BET: 1.0}, cls("KQs"))]),
    ("river-class-ip-bets", "river-one-size", [lk(["check"], 1, {"check": 0.5, BET: 0.5}, cls("QQ", "98s"))]),
    ("river-combo-root", "river-one-size", [lk([], 0, {BET: 1.0}, one("QhJh"))]),
    ("river-combo-call", "river-one-size", [lk([BET], 1, {"fold": 1.0}, one("AhKd"))]),
    ("river-out-of-range", "river-one-size", [lk([], 0, {"check": 1.0}, {"classes": ["AA", "KQs"], "combos": ["2h3h"]})]),
    ("river-both-players", "river-one-size", [lk([], 0, {BET: 0.75, "check": 0.25}, cls("JTs", "T8s")),
                                              lk([BET], 1, {"call": 1.0}, cls("KQo"))]),
    # more sizes, ties, weights, all-ins
    ("two-sizes-whole-root", "river-two-sizes", [lk([], 0, {"check": 0.5, "bet 50%": 0.3, "bet 100%": 0.2})]),
    ("two-sizes-class", "river-two-sizes", [lk(["bet 100%"], 1, {"fold": 0.2, "call": 0.8}, cls("JJ"))]),
    ("two-sizes-combo", "river-two-sizes", [lk(["check", "bet 50%"], 0, {"fold": 0.1, "call": 0.1, "raise to 30": 0.8},
                                               one("7h7c"))]),
    ("low-spr-whole", "river-low-spr", [lk([], 0, {"check": 0.6, "all-in": 0.4})]),
    ("low-spr-class", "river-low-spr", [lk(["all-in"], 1, {"fold": 0.5, "call": 0.5}, cls("AKo"))]),
    ("flush-whole", "river-flush", [lk([], 0, {"check": 0.4, "bet 50%": 0.2, "bet 100%": 0.2, "all-in": 0.2})]),
    ("flush-combo", "river-flush", [lk(["check"], 1, {"all-in": 1.0}, one("Qh8h"))]),
    ("weighted-class", "river-weighted", [lk([], 0, {"check": 0.3, BET: 0.5, "all-in": 0.2}, cls("QQ", "T9s"))]),
    ("weighted-combo", "river-weighted", [lk([BET], 1, {"fold": 0.9, "call": 0.1}, one("AsQd"))]),
    ("ties-whole-facing-bet", "river-board-plays", [lk([BET], 1, {"fold": 0.6, "call": 0.3, "all-in": 0.1})]),
    # turn-one-size: every river dealt
    ("turn-whole-root", "turn-one-size", [lk([], 0, {"check": 0.6, BET: 0.4})]),
    ("turn-class-facing-bet", "turn-one-size", [lk([BET], 1, {"fold": 0.3, "call": 0.7}, cls("QQ"))]),
    ("turn-combo-root", "turn-one-size", [lk([], 0, {BET: 1.0}, one("QdJd"))]),
    # a river node, one runout: its subtree is merged with the same shape on the other turn line
    ("turn-merged", "turn-one-size", [lk([BET, "call", "As"], 0, {"check": 0.5, "all-in": 0.5})]),
    ("turn-merged-both-lines", "turn-one-size", [lk([BET, "call", "As"], 0, {"check": 0.5, "all-in": 0.5}),
                                                 lk(["check", BET, "call", "As"], 0, {"all-in": 1.0})]),
    # every river of one line, with a mix far from its play: the sibling line's rivers share the merged node
    ("turn-merged-every-river", "turn-one-size", [lk([BET, "call", "*"], 0, {"check": 0.2, "all-in": 0.8})]),
    # the same line, IP's answer to the river shove: both players reach the sibling line here, so a leak would show
    ("turn-merged-ip-folds", "turn-one-size", [lk([BET, "call", "*", "all-in"], 1, {"fold": 1.0})]),
    ("turn-river-all-runouts", "turn-one-size", [lk([BET, "call", "*"], 0, {"check": 0.8, "all-in": 0.2}, cls("76s"))]),
    ("turn-river-combo-runout", "turn-one-size", [lk(["check", "check", "9h", "check"], 1, {BET: 1.0}, one("JcTc"))]),
    # turn-low-spr: all-ins before the river
    ("low-turn-whole", "turn-low-spr", [lk([], 0, {"check": 0.7, "all-in": 0.3})]),
    ("low-turn-class", "turn-low-spr", [lk(["all-in"], 1, {"fold": 0.5, "call": 0.5}, cls("KQs"))]),
    ("low-turn-river-runout", "turn-low-spr", [lk(["check", "check", "2d"], 0, {"check": 0.2, "all-in": 0.8})]),
    ("low-turn-river-all", "turn-low-spr", [lk(["check", "check", "*", "check"], 1, {"check": 0.9, "all-in": 0.1}, one("AsQs"))]),
]


EQUILIBRIUM = {"river-one-size": ["", "/bet 75%", "/check"], "river-two-sizes": ["", "/bet 100%"], "river-flush": [""],
               "turn-one-size": ["", "/bet 75%"], "turn-low-spr": ["", "/all-in"]}
EVERYWHERE = (("river-one-size", 0, True, True), ("river-two-sizes", 1, True, True), ("river-flush", 0, False, True),
              ("turn-low-spr", 1, False, True), ("turn-one-size", 0, False, False))


# ---------------------------------------------------------------- locks as the reference reads them
def is_card(t: str) -> bool:
    return len(t) == 2 and t[0] in RANKS and t[1] in "shdc"


def path_of(line) -> str:
    out = ""
    for t in line:
        out += "|" if t == "*" or is_card(t) else "/" + t
    return out


def line_of(path: str) -> list:
    out = []
    for seg in path.split("/")[1:]:
        out.append(seg.rstrip("|"))
        out += ["*"] * (len(seg) - len(seg.rstrip("|")))
    return out


def class_of(name: str) -> str:
    """A hand's class, from the reference's cards: suit * 13 + rank."""
    a, b = combo_cards(name)
    hi, lo = max(a % 13, b % 13), min(a % 13, b % 13)
    if hi == lo:
        return RANKS[hi] * 2
    return RANKS[hi] + RANKS[lo] + ("s" if a // 13 == b // 13 else "o")


def holds_of(game, lock_list) -> tuple:
    """Reference holds of a case's locks, and how many hands they name that aren't in the range."""
    nodes = {n.path: n for n in game.acts}
    root_len = len(game.deal.board)
    holds, missing = [], 0
    for L in lock_list:
        path = path_of(L["line"])
        node = nodes[path]
        cards = [t for t in L["line"] if t == "*" or is_card(t)]
        rows = [i for i, b in enumerate(node.boards)
                if all(c == "*" or card_id(c) == b[root_len + j] for j, c in enumerate(cards))]
        names = game.deal.names[node.player]
        mix = L["mix"]
        vec = [mix.get(n, 0.0) for n in node.names] if isinstance(mix, dict) else list(mix)
        if L["hands"] == "all":
            hands = list(range(len(names)))
        else:
            want = set(L["hands"].get("classes", ()))
            exact = {compare.name_of(c) for c in L["hands"].get("combos", ())}
            hands = [i for i, n in enumerate(names) if class_of(n) in want or n in exact]
            found = {names[i] for i in hands}
            missing += sum(1 for c in exact if c not in found)
        holds.append(ref_locks.Hold(path, rows, hands, vec))
    return holds, missing


def held_infosets(game, holds) -> int:
    nodes = {n.path: n for n in game.acts}
    return sum(int(nodes[h.path].alive[np.ix_(list(h.rows), list(h.hands))].sum()) for h in holds)


def peak_rss_mb() -> float:
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return v / (1 << 20) if sys.platform == "darwin" else v / 1024


# ---------------------------------------------------------------- the reference's process: no engine code
def ref_job(case_path: str, out_prefix: str) -> None:
    with open(case_path) as f:
        case = json.load(f)
    spot = spots.get(case["spot"])
    game = build.hu_game(spot)
    holds, _ = holds_of(game, case["locks"])
    method = spot.get("lp_method", "highs-ds")
    t0 = time.time()
    res = ref_locks.solve(game, holds, method=method)
    out = {"lp_seconds": time.time() - t0, "method": method, "value_each_side": res["value_each_side"],
           "lp_status": res["lp"], "rows": res["rows"], "cols": res["cols"], "held_infosets": held_infosets(game, holds),
           "gains_held": [ref_locks.held_values(game, res["strategy"], p, holds) - game.value(res["strategy"], p)
                          for p in (0, 1)], "peak_rss_mb": peak_rss_mb()}
    if any(m == "gto" or m.startswith("gto.") for m in sys.modules):
        raise AssertionError("the reference imported engine code")
    with open(out_prefix + ".json", "w") as f:
        json.dump(out, f)
    np.savez_compressed(out_prefix + ".npz", **{"s:" + k: v for k, v in res["strategy"].items()})


# ---------------------------------------------------------------- the engine's process
def engine_setup():
    sys.path.insert(0, os.path.join(HERE, "..", ".."))
    import engine_worker as ew
    from engine import nodelock as nl
    return ew, nl


def solve_case(spot: dict, lock_list, iters: int, ew, nl, cfg_more=None, warm=None):
    board = ew.board_cards(spot)
    r0, r1 = ew.hu_ranges(spot)
    cfg = ew.hu_config(spot, **(cfg_more or {}))
    locks = [nl.Lock(tuple(L["line"]), L["player"], L["mix"], L["hands"]) for L in lock_list]
    return nl.solve_locked(board, r0, r1, spot["pot"], spot["stack"], locks, bets=tuple(spot.get("bets0", (0.0, 0.0))),
                           to_act=spot.get("to_act", 0), n_raises=spot.get("n_raises", 0), cfg=cfg, time_budget=1e9,
                           max_iters=iters, warm=warm)


def mix_check(sol) -> dict:
    """Every pinned cell's avg_strategy against what was pinned, as float32s and against the float64 asked for."""
    s = sol.solver
    worst32, worst64, cells = 0.0, 0.0, 0
    for a in sol.applied:
        node, rows, _, _ = s.resolve(a.lock.line)
        pin = s._pins[id(node)]
        got = node.avg_strategy()
        where = np.broadcast_to(pin.mask[:, None, :], got.shape)
        worst32 = max(worst32, float(np.abs(got - pin.mix)[where].max(initial=0.0)))
        want = np.array(a.mix)[None, :, None]
        keep = np.zeros(pin.mask.shape, dtype=bool)
        keep[rows] = pin.mask[rows]
        where = np.broadcast_to(keep[:, None, :], got.shape)
        same = np.isclose(pin.mix, want, atol=1e-6).all(axis=1)      # (another lock's cells at this node don't count)
        where = where & same[:, None, :]
        worst64 = max(worst64, float(np.abs(got - want)[where].max(initial=0.0)))
        cells += a.cells
    return {"max_error_float32": worst32, "max_error_vs_asked": worst64, "cells": cells}


def engine_job(case_path: str, iters: int, out_prefix: str) -> None:
    ew, nl = engine_setup()
    with open(case_path) as f:
        case = json.load(f)
    spot = spots.get(case["spot"])
    t0 = time.time()
    sol = solve_case(spot, case["locks"], iters, ew, nl)
    wall = time.time() - t0
    t1 = time.time()
    m = sol.measure()
    tree, strat, rows = ew.export_hu(sol.root)
    meta = {"iterations": int(sol.iters), "wall_s": wall, "iterate_s": float(sol.seconds), "measure_s": time.time() - t1,
            "measure": m, "tree": tree, "rows": rows, "combos": ew.combo_names(sol.ctx.active),
            "mix_check": mix_check(sol), "cells": sum(a.cells for a in sol.applied),
            "blocked": sum(a.blocked for a in sol.applied), "ignored": sum(a.ignored for a in sol.applied),
            "notes": sorted({n for a in sol.applied for n in a.notes}), "use_core": bool(ew.core.lib() is not None),
            "tree_cells": int(sol.cells), "peak_rss_mb": peak_rss_mb()}
    with open(out_prefix + ".json", "w") as f:
        json.dump(meta, f)
    np.savez_compressed(out_prefix + ".npz", **{"s:" + k: v for k, v in strat.items()})


# ---------------------------------------------------------------- comparing, here: reference code only
class Runner:
    def __init__(self, tmp: str):
        self.tmp, self.games, self.n = tmp, {}, 0

    def game(self, name: str):
        if name not in self.games:
            self.games[name] = build.hu_game(spots.get(name))
        return self.games[name]

    def call(self, *args, env=None) -> None:
        subprocess.check_call([sys.executable, os.path.abspath(__file__)] + [str(a) for a in args],
                              env=dict(os.environ, **(env or {})))

    def case_file(self, spot: str, lock_list) -> str:
        self.n += 1
        path = os.path.join(self.tmp, f"case{self.n}.json")
        with open(path, "w") as f:
            json.dump({"spot": spot, "locks": lock_list}, f)
        return path

    def reference(self, spot: str, lock_list) -> tuple:
        path = self.case_file(spot, lock_list)
        prefix = path[:-5] + "-ref"
        self.call("--job-ref", path, prefix)
        with open(prefix + ".json") as f:
            return json.load(f), np.load(prefix + ".npz")

    def engine(self, spot: str, lock_list, iters: int, env=None) -> tuple:
        path = self.case_file(spot, lock_list)
        prefix = f"{path[:-5]}-eng{iters}"
        self.call("--job-engine", path, iters, prefix, env=env)
        with open(prefix + ".json") as f:
            return json.load(f), np.load(prefix + ".npz")

    def judge(self, spot_name: str, lock_list, meta, npz, lp_values) -> dict:
        """One engine run against the reference: the tree, the value, and its profile by the reference's own walker."""
        game = self.game(spot_name)
        pot = spots.get(spot_name)["pot"]
        diff = compare.hu_tree_diff(game, meta["tree"], meta["rows"])
        out = {"iterations": meta["iterations"], "wall_s": meta["wall_s"], "iterate_s": meta["iterate_s"],
               "measure_s": meta["measure_s"], "peak_rss_mb": meta["peak_rss_mb"], "tree_identical": diff is None,
               "tree_cells": meta["tree_cells"], "mix_check": meta["mix_check"], "notes": meta["notes"]}
        if diff is not None:
            return dict(out, not_compared=diff, passed=False)
        holds, missing = holds_of(game, lock_list)
        profile = compare.engine_profile(game, meta, npz)
        value = [game.value(profile, p) for p in (0, 1)]
        held = [ref_locks.held_values(game, profile, p, holds) for p in (0, 1)]
        gains = [held[p] - value[p] for p in (0, 1)]
        e = meta["measure"]
        out.update(
            engine_value=e["value"], engine_expl_pct=e["exploitability_pct"], engine_gain_held=e["gain_held"],
            engine_lock_cost=e["lock_cost"], value_by_ref=value, gains_by_ref=gains,
            expl_by_ref_pct=(gains[0] + gains[1]) / 2 / pot * 100,
            value_gap_bb=abs(value[0] - lp_values[0]), value_gap_pct_pot=abs(value[0] - lp_values[0]) / pot * 100,
            engine_value_gap_pct_pot=abs(e["value"][0] - lp_values[0]) / pot * 100,
            cells_agree=meta["cells"] - meta["blocked"] == held_infosets(game, holds),
            ignored_agree=_ignored(lock_list, meta, missing, game))
        out["passed"] = bool(out["value_gap_pct_pot"] <= TOL_VALUE_PCT and out["expl_by_ref_pct"] <= TOL_EXPL_PCT and
                             out["mix_check"]["max_error_float32"] == 0.0 and out["mix_check"]["max_error_vs_asked"] < 2e-7
                             and out["cells_agree"])
        return out


def _ignored(lock_list, meta, missing, game) -> bool:
    """The engine's count of named hands outside the range, against this file's: combos named and absent, and each
    named class's combos (6, 4 or 12, minus those on the board and those absent) not in the range."""
    expect = missing
    for L in lock_list:
        if L["hands"] == "all":
            continue
        names = game.deal.names[L["player"]]
        for c in L["hands"].get("classes", ()):
            size = 6 if len(c) == 2 else 4 if c.endswith("s") else 12
            expect += size - sum(1 for n in names if class_of(n) == c)
    return bool(meta["ignored"] == expect)


def run_cases(r: Runner, chosen, data: dict) -> None:
    for name, spot, lock_list in chosen:
        t0 = time.time()
        ref, _ = r.reference(spot, lock_list)
        free = data["unlocked"].get(spot)
        if free is None:
            base, _ = r.reference(spot, [])
            free = data["unlocked"][spot] = {"value": base["value_each_side"], "lp_seconds": base["lp_seconds"],
                                             "rows": base["rows"], "peak_rss_mb": base["peak_rss_mb"]}
        runs = []
        for iters in (RIVER_ITERS if spot.startswith("river") else TURN_ITERS):
            meta, npz = r.engine(spot, lock_list, iters)
            runs.append(r.judge(spot, lock_list, meta, npz, ref["value_each_side"]))
        best = runs[-1]
        locked = {L["player"] for L in lock_list}
        # how far the lock moved the value: a small gap only says something next to this
        shift = abs(ref["value_each_side"][0] - free["value"][0]) / spots.get(spot)["pot"] * 100
        d = {"spot": spot, "locks": lock_list, "reference": ref, "unlocked_value": free["value"], "runs": runs,
             "lock_moved_value_pct_pot": shift,
             "passed": bool(best["passed"])}
        if len(locked) == 1:
            p = locked.pop()
            pot = spots.get(spot)["pot"]
            # the sign: the LP's exactly, and the engine's up to the tolerance
            d["sign"] = {"locked_player": p,
                         "unlocked_gain_lp_bb": ref["value_each_side"][1 - p] - free["value"][1 - p],
                         "unlocked_gain_engine_bb": best["value_by_ref"][1 - p] - free["value"][1 - p],
                         "passed": bool(ref["value_each_side"][1 - p] >= free["value"][1 - p] - 1e-7 and
                                        best["value_by_ref"][1 - p] >= free["value"][1 - p] - TOL_VALUE_PCT / 100 * pot)}
        data["cases"][name] = d
        print(f"{name}: gap {best.get('value_gap_pct_pot', float('nan')):.5f}% pot, expl "
              f"{best.get('expl_by_ref_pct', float('nan')):.5f}%, {'pass' if d['passed'] else 'FAIL'} "
              f"({time.time() - t0:.1f} s)", flush=True)


def eq_locks(game, strategy, paths) -> list:
    """Every hand at each node of `paths` locked to its mix in `strategy`."""
    out = []
    for n in game.acts:
        if n.path not in paths:
            continue
        s = strategy["s:" + n.path]
        for i, name in enumerate(game.deal.names[n.player]):
            mix = s[0, :, i] if n.B == 1 else None
            if mix is None or not n.alive[0, i]:
                continue
            mix = np.maximum(mix, 0.0)
            mix = (mix / mix.sum()).tolist()
            out.append(lk(line_of(n.path), n.player, mix, one(name)))
    return out


def run_equilibrium(r: Runner, data: dict) -> None:
    """Each node's hands locked to the LP's own equilibrium: x* stays feasible and the other player's best reply to it
    can't improve, so the restricted value is the value."""
    out = {}
    for spot, paths in EQUILIBRIUM.items():
        base, strat = r.reference(spot, [])
        game = r.game(spot)
        pot = spots.get(spot)["pot"]
        for path in paths:
            lock_list = eq_locks(game, strat, {path})
            ref, _ = r.reference(spot, lock_list)
            iters = RIVER_ITERS[1] if spot.startswith("river") else TURN_ITERS[-1]
            meta, npz = r.engine(spot, lock_list, iters)
            run = r.judge(spot, lock_list, meta, npz, base["value_each_side"])
            lp_shift = abs(ref["value_each_side"][0] - base["value_each_side"][0])
            key = f"{spot} {path or '(root)'}"
            out[key] = {"locks": len(lock_list), "lp_value": base["value_each_side"][0], "lp_shift_bb": lp_shift,
                        "lp_shift_pct_pot": lp_shift / pot * 100, "engine": run,
                        "passed": bool(lp_shift / pot * 100 <= 1e-5 and run["passed"])}
            print(f"equilibrium {key}: LP moved {lp_shift:.2e} bb, engine gap {run.get('value_gap_pct_pot', -1):.5f}% pot",
                  flush=True)
    data["equilibrium"] = out


def random_locks(game, p: int, per_combo: bool, seed: int) -> list:
    rng = np.random.default_rng(seed)
    out = []
    for n in game.acts:
        if n.player != p:
            continue
        line = line_of(n.path)
        if per_combo:
            for i, name in enumerate(game.deal.names[p]):
                mix = rng.dirichlet(np.ones(len(n.names))).tolist()
                out.append(lk(line, p, mix, one(name)))
        else:
            out.append(lk(line, p, rng.dirichlet(np.ones(len(n.names))).tolist()))
    return out


def run_everywhere(r: Runner, data: dict) -> None:
    """Every node of one player fixed: a one-player game, whose value is the other's best response to that strategy."""
    out = {}
    for spot, p, per_combo, use_lp in EVERYWHERE:
        game = r.game(spot)
        lock_list = random_locks(game, p, per_combo, 17 + p)
        holds, _ = holds_of(game, lock_list)
        fixed = ref_locks.apply_holds(game, game.uniform(), holds)
        br = game.value(fixed, 1 - p, True)
        pot = spots.get(spot)["pot"]
        iters = 3000
        meta, npz = r.engine(spot, lock_list, iters)
        run = r.judge(spot, lock_list, meta, npz, [br if p == 1 else -br, br if p == 0 else -br])
        e = meta["measure"]
        gap = abs(e["value"][1 - p] - br)
        ref = None
        if use_lp:
            ref, _ = r.reference(spot, lock_list)
        lp_gap = None if ref is None else abs(ref["value_each_side"][1 - p] - br)
        key = f"{spot} player {p} {'per combo' if per_combo else 'whole range'}"
        out[key] = {"locks": len(lock_list), "free_player_best_response": br, "engine_value": e["value"][1 - p],
                    "value_gap_bb": gap, "value_gap_pct_pot": gap / pot * 100, "lp_gap_bb": lp_gap,
                    "engine_expl_pct": e["exploitability_pct"], "expl_by_ref_pct": run.get("expl_by_ref_pct"),
                    "wall_s": meta["wall_s"], "mix_check": meta["mix_check"],
                    "passed": bool(gap / pot * 100 <= TOL_VALUE_PCT and (lp_gap is None or lp_gap < 1e-6) and
                                   run.get("expl_by_ref_pct", 9) <= TOL_EXPL_PCT)}
        print(f"everywhere {key}: gap {gap:.2e} bb, {'pass' if out[key]['passed'] else 'FAIL'}", flush=True)
    data["everywhere"] = out


def run_spoiled(r: Runner, data: dict) -> None:
    """The engine answers a different question from the LP's: each comparison must fail."""
    out = {}
    base = dict((n, (s, l)) for n, s, l in CASES)
    for key, name, wrong in (
            ("mix off by 0.05", "river-whole-root", [lk([], 0, {"check": 0.65, BET: 0.35})]),
            ("mix off by 0.05 on a turn", "turn-whole-root", [lk([], 0, {"check": 0.55, BET: 0.45})]),
            ("the pin leaks to the merged sibling line", "turn-merged",
             base["turn-merged"][1] + [lk(["check", BET, "call", "As"], 0, {"check": 0.5, "all-in": 0.5})]),
            ("every river's pin leaks to the merged sibling line", "turn-merged-ip-folds",
             base["turn-merged-ip-folds"][1] + [lk(["check", BET, "call", "*", "all-in"], 1, {"fold": 1.0})]),
            ("the lock does nothing", "turn-merged", [lk([], 0, {"check": 0.5, BET: 0.5}, one("2h3h"))]),
            ("the combo lock covers its class", "river-combo-root", [lk([], 0, {BET: 1.0}, cls("QJs"))]),
            ("all runouts in place of one", "low-turn-river-runout",
             [lk(["check", "check", "*"], 0, {"check": 0.2, "all-in": 0.8})])):
        spot, right = base[name]
        ref, _ = r.reference(spot, right)
        iters = 3000
        meta, npz = r.engine(spot, wrong, iters)
        run = r.judge(spot, right, meta, npz, ref["value_each_side"])
        caught = not (run.get("value_gap_pct_pot", 9) <= TOL_VALUE_PCT and run.get("expl_by_ref_pct", 9) <= TOL_EXPL_PCT)
        out[key] = {"case": name, "value_gap_pct_pot": run.get("value_gap_pct_pot"),
                    "expl_by_ref_pct": run.get("expl_by_ref_pct"), "caught": bool(caught)}
        print(f"spoiled {key}: gap {out[key]['value_gap_pct_pot']:.4f}% pot, expl {out[key]['expl_by_ref_pct']:.4f}%, "
              f"{'caught' if caught else 'NOT CAUGHT'}", flush=True)
    data["spoiled"] = out


def own_reach(game, strat: dict) -> dict:
    """{path: (share of each hand's own play reaching the node (B, n of the player to act), share of the opponent's
    range reaching it (B,))}, by the reference's tree."""
    out = {}

    def go(node, r):
        if isinstance(node, NDeal):
            B, K = r[0].shape[0], node.K
            go(node.kid, [(r[q][:, None, :] * node.keep[q]).reshape(B * K, -1) for q in (0, 1)])
        elif isinstance(node, NAct):
            p, base = node.player, game.r0
            with np.errstate(divide="ignore", invalid="ignore"):
                mine = np.nan_to_num(r[p] / base[p])
            out[node.path] = (mine, r[1 - p].sum(axis=1) / base[1 - p].sum())
            s = strat[node.path]
            for a, kid in enumerate(node.kids):
                nr = list(r)
                nr[p] = r[p] * s[:, a, :]
                go(kid, nr)

    go(game.root, [game.r0[0][None, :], game.r0[1][None, :]])
    return out


def reached_difference(game, a: dict, b: dict, floor: float = 1e-3) -> float:
    """The largest strategy difference over cells both players reach, at least `floor` of the time, in both profiles.
    A cell off the path has no strategy to speak of: its regrets are noise."""
    ra, rb = own_reach(game, a), own_reach(game, b)
    worst = 0.0
    for path, s in a.items():
        mine = np.minimum(ra[path][0], rb[path][0]) >= floor
        theirs = np.minimum(ra[path][1], rb[path][1]) >= floor
        cells = mine & theirs[:, None]
        if cells.any():
            worst = max(worst, float(np.abs(s - b[path]).max(axis=1)[cells].max()))
    return worst


def cross_play(game, a: dict, b: dict, holds, pot: float) -> list:
    """Each side's strategy from `a` against the other's from `b`, both ways: the largest gain either player has, in % of
    the pot. In a zero-sum game equilibria are interchangeable, so two profiles that differ only by which equilibrium
    they found stay as good when crossed: this is what tells that from one of them being wrong."""
    out = []
    for first, second in ((a, b), (b, a)):
        mixed = {n.path: (first if n.player == 0 else second)[n.path] for n in game.acts}
        gains = [ref_locks.held_values(game, mixed, p, holds) - game.value(mixed, p) for p in (0, 1)]
        out.append(max(gains) / pot * 100)
    return out


def run_parity(r: Runner, data: dict) -> None:
    """The core walks the original tree, numpy the merged one: a lock on one of two merged lines, both ways. Compared on
    what both reach, and against the same two walks with no lock."""
    out = {}
    base = dict((n, (s, l)) for n, s, l in CASES)
    for name, iters in (("turn-merged-both-lines", 1000), ("turn-river-all-runouts", 1000), ("river-both-players", 3000)):
        spot, lock_list = base[name]
        ref, _ = r.reference(spot, lock_list)
        core_m, core_z = r.engine(spot, lock_list, iters)
        np_m, np_z = r.engine(spot, lock_list, iters, env={"GTO_CORE": "0"})
        a, b = r.judge(spot, lock_list, core_m, core_z, ref["value_each_side"]), \
            r.judge(spot, lock_list, np_m, np_z, ref["value_each_side"])
        game = r.game(spot)
        worst = max(float(np.abs(core_z[k] - np_z[k]).max()) for k in core_z.files)
        pc, pn = compare.engine_profile(game, core_m, core_z), compare.engine_profile(game, np_m, np_z)
        reached = reached_difference(game, pc, pn)
        crossed = cross_play(game, pc, pn, holds_of(game, lock_list)[0], spots.get(spot)["pot"])
        free_c, free_n = r.engine(spot, [], iters), r.engine(spot, [], iters, env={"GTO_CORE": "0"})
        baseline = reached_difference(game, compare.engine_profile(game, *free_c), compare.engine_profile(game, *free_n))
        out[name] = {"iterations": iters, "core": {k: a.get(k) for k in ("wall_s", "value_gap_pct_pot", "expl_by_ref_pct")},
                     "numpy": {k: b.get(k) for k in ("wall_s", "value_gap_pct_pot", "expl_by_ref_pct")},
                     "largest_difference_any_cell": worst, "largest_difference_reached": reached,
                     "largest_difference_reached_unlocked": baseline, "cross_play_largest_gain_pct_pot": crossed,
                     "passed": bool(a["value_gap_pct_pot"] <= TOL_VALUE_PCT and b["value_gap_pct_pot"] <= TOL_VALUE_PCT and
                                    max(crossed) <= TOL_EXPL_PCT)}
        print(f"parity {name}: core {a['wall_s']:.3f} s, numpy {b['wall_s']:.3f} s, largest difference {worst:.2e}, on cells "
              f"reached {reached:.2e}, unlocked {baseline:.2e}, crossed {max(crossed):.5f}% pot", flush=True)
    data["parity"] = out


def warm_job(out_path: str) -> None:
    """Exploitability by iterations, cold and warm from the unlocked solve and from another lock; and time per iteration
    with and without a lock on one tree."""
    ew, nl = engine_setup()
    from gto.solver import solve
    spot = spots.get("turn-one-size")
    near = [lk([], 0, {"check": 0.6, BET: 0.4})]
    other = [lk([], 0, {"check": 0.5, BET: 0.5})]
    board = ew.board_cards(spot)
    r0, r1 = ew.hu_ranges(spot)
    base = solve(board, r0, r1, spot["pot"], spot["stack"], cfg=ew.hu_config(spot), time_budget=1e9, max_iters=3000)
    prior = solve_case(spot, other, 3000, ew, nl)
    out = {"warm": {}, "overhead": {}}
    for iters in (30, 100, 300, 1000):
        out["warm"][iters] = {"cold": solve_case(spot, near, iters, ew, nl).measure()["exploitability_pct"],
                              "warm_from_unlocked": solve_case(spot, near, iters, ew, nl, warm=base).measure()["exploitability_pct"],
                              "warm_from_another_lock": solve_case(spot, near, iters, ew, nl, warm=prior).measure()["exploitability_pct"]}
    iters = 3000
    t0 = time.time()
    plain = solve(board, r0, r1, spot["pot"], spot["stack"], cfg=ew.hu_config(spot), time_budget=1e9, max_iters=iters)
    t1 = time.time()
    held = solve_case(spot, near, iters, ew, nl)
    t2 = time.time()
    m = held.measure()
    t3 = time.time()
    plain.exploitability()
    t4 = time.time()
    out["overhead"] = {"spot": "turn-one-size", "iterations": iters, "unlocked_s": t1 - t0, "locked_s": t2 - t1,
                       "unlocked_exploitability_measure_s": t4 - t3, "locked_measure_s": t3 - t2,
                       "locked_exploitability_pct": m["exploitability_pct"], "peak_rss_mb": peak_rss_mb()}
    with open(out_path, "w") as f:
        json.dump(out, f, indent=1)


def abstraction_job(out_path: str) -> None:
    """The app's own configs (worker.js's Fast, numbers from there): what a lock does and what is refused. There is no
    reference for these abstractions: the numbers are the engine's own, in the abstract game."""
    ew, nl = engine_setup()
    from gto.cards import cards
    from gto.ranges import parse_range
    from gto.solver import Config, solve
    Lock = nl.Lock
    fast = dict(n_turns=3, leaf_turns=4, leaf_rivers_flop=4, n_rivers_from_flop=4, river_buckets=32, turn_buckets=True,
                bucket_river_step=3, river_classes=True, river_strength=32,
                bet_sizes={"flop": [0.33, 0.75], "turn": [0.33, 0.75, 1.25], "river": [0.33, 1.25]},
                raise_sizes={"flop": [0.5], "turn": [0.75], "river": [0.75]})
    r0 = parse_range("77-22,A9s-A2s,KTs-K5s,QTs-Q8s,J9s+,T8s+,97s+,86s+,75s+,65s,54s,ATo-A7o,KTo+,QTo+,JTo")
    r1 = parse_range("AA-77,AJs+,KQs,QJs,JTs,T9s,98s,AQo+,KQo")
    out = {}

    def attempt(name, sol_args, lock_list, iters):
        t0 = time.time()
        try:
            sol = nl.solve_locked(*sol_args, lock_list, cfg=Config(**fast), time_budget=1e9, max_iters=iters)
        except nl.LockError as e:
            out[name] = {"refused": type(e).__name__, "message": str(e)}
            print(f"{name}: refused: {e}", flush=True)
            return None
        wall = time.time() - t0
        t1 = time.time()
        m = sol.measure()
        out[name] = {"iterations": sol.iters, "wall_s": wall, "iterate_s": sol.seconds, "measure_s": time.time() - t1,
                     "measure": m, "tree_cells": int(sol.cells), "mix_check": mix_check(sol),
                     "notes": sorted({n for a in sol.applied for n in a.notes}),
                     "peak_rss_mb_so_far": peak_rss_mb()}
        print(f"{name}: {sol.iters} iterations {wall:.1f} s, exploitability {m['exploitability_pct']:.3f}% pot, "
              f"measure {out[name]['measure_s']:.1f} s", flush=True)
        return sol

    flop = (cards("Kd7c2h"), r0, r1, 6.0, 97.0)
    t0 = time.time()
    plain = solve(*flop, cfg=Config(**fast), time_budget=1e9, max_iters=300)
    out["flop, unlocked"] = {"iterations": plain.iters, "wall_s": time.time() - t0,
                             "exploitability_pct": plain.exploitability(), "tree_cells": int(plain.cells)}
    print(out["flop, unlocked"], flush=True)
    bets = [n for n in plain.root.names if n.startswith("bet")]
    lines = list(nl.lines(plain.root))
    turn = next(x for x in lines if len(x[0]) >= 3 and x[0][-1] == "*")
    attempt("flop, whole range at the root (per combo there)", flop,
            [Lock((), 0, {"check": 0.7, bets[0]: 0.3})], 300)
    attempt("flop, one class at the root", flop, [Lock((), 0, {"check": 1.0}, {"classes": ["65s"]})], 300)
    attempt("flop, whole range on the turn, every card (buckets)", flop,
            [Lock(turn[0], turn[1], [1.0 / len(turn[2])] * len(turn[2]))], 300)
    attempt("flop, a combo on the turn (buckets)", flop,
            [Lock(turn[0], turn[1], [1.0 / len(turn[2])] * len(turn[2]), {"combos": ["6h5h"]})], 0)
    board = cards("Kd7c2h5s")
    turn_args = (board, r0, r1, 20.0, 87.0)
    t0 = time.time()
    tp = solve(*turn_args, cfg=Config(**fast), time_budget=1e9, max_iters=300)
    out["turn, unlocked"] = {"iterations": tp.iters, "wall_s": time.time() - t0, "exploitability_pct": tp.exploitability(),
                             "tree_cells": int(tp.cells)}
    print(out["turn, unlocked"], flush=True)
    bets = [n for n in tp.root.names if n.startswith("bet")]
    tl = list(nl.lines(tp.root))
    river = next(x for x in tl if x[0] and x[0][-1] == "*")
    attempt("turn, whole range at the root", turn_args, [Lock((), 0, {"check": 0.7, bets[0]: 0.3})], 300)
    attempt("turn, one class at the root, river classes below", turn_args,
            [Lock((), 0, {"check": 1.0}, {"classes": ["65s"]})], 300)
    attempt("turn, whole range on the river, every class", turn_args,
            [Lock(river[0], river[1], [1.0 / len(river[2])] * len(river[2]))], 300)
    attempt("turn, a combo on the river (classes)", turn_args,
            [Lock(river[0], river[1], [1.0 / len(river[2])] * len(river[2]), {"combos": ["6h5h"]})], 0)
    with open(out_path, "w") as f:
        json.dump(out, f, indent=1)


def table(data: dict) -> str:
    rows = ["| Case | Spot | Locks | Iter | LP value OOP (bb) | Value gap (% pot) | Expl by ref (% pot) | Engine expl (% pot) | "
            "Mix error | Engine s | Engine MB | LP s | LP MB | Pass |", "|" + "---|" * 14]
    for name, _, _ in CASES:
        d = data["cases"].get(name)
        if not d:
            continue
        ref = d["reference"]
        for r in d["runs"]:
            if not r["tree_identical"]:
                rows.append(f"| {name} | not compared: {r['not_compared']} |" + " |" * 12)
                continue
            rows.append(f"| {name} | {d['spot']} | {len(d['locks'])} | {r['iterations']} | {ref['value_each_side'][0]:.4f} | "
                        f"{r['value_gap_pct_pot']:.5f} | {r['expl_by_ref_pct']:.5f} | {r['engine_expl_pct']:.5f} | "
                        f"{r['mix_check']['max_error_vs_asked']:.1e} | {r['wall_s']:.3f} | {r['peak_rss_mb']:.0f} | "
                        f"{ref['lp_seconds']:.1f} | {ref['peak_rss_mb']:.0f} | {'yes' if r['passed'] else 'NO'} |")
    return "\n".join(rows)


def machine(load_note: bool = True) -> dict:
    import platform

    def sh(*cmd):
        try:
            return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            return ""

    import scipy
    return {"platform": platform.platform(), "cpu": sh("sysctl", "-n", "machdep.cpu.brand_string"),
            "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
            "git_commit": sh("git", "-C", os.path.join(HERE, "..", ".."), "rev-parse", "HEAD"), "threads": 1,
            "load_note": "run niced through slot.sh beside other builds: times are a loaded machine's"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="")
    ap.add_argument("--only", default="", help="sections: cases,equilibrium,everywhere,spoiled,parity,warm,abstraction")
    ap.add_argument("--table", action="store_true")
    ap.add_argument("--job-ref", nargs=2)
    ap.add_argument("--job-engine", nargs=3)
    ap.add_argument("--job-warm")
    ap.add_argument("--job-abstraction")
    a = ap.parse_args()
    if a.job_ref:
        return ref_job(*a.job_ref)
    if a.job_engine:
        return engine_job(a.job_engine[0], int(a.job_engine[1]), a.job_engine[2])
    if a.job_warm:
        return warm_job(a.job_warm)
    if a.job_abstraction:
        return abstraction_job(a.job_abstraction)
    data = {"cases": {}, "unlocked": {}}
    if os.path.exists(RESULTS):
        with open(RESULTS) as fh:
            data = json.load(fh)
    if a.table:
        print(table(data))
        return None
    data["machine"] = machine()
    data["tolerances"] = {"value_pct_pot": TOL_VALUE_PCT, "exploitability_pct_pot": TOL_EXPL_PCT,
                          "mix_vs_asked": 2e-7, "reference": "HiGHS feasibility 1e-9"}
    sections = a.only.split(",") if a.only else ["cases", "equilibrium", "everywhere", "spoiled", "parity", "warm",
                                                 "abstraction"]
    t0 = time.time()

    def save():
        with open(RESULTS, "w") as fh:
            json.dump(data, fh, indent=1)

    with tempfile.TemporaryDirectory(prefix="lizard-lock-") as tmp:
        r = Runner(tmp)
        if "cases" in sections:
            want = set(a.cases.split(",")) if a.cases else None
            for c in CASES:
                if want is None or c[0] in want:
                    run_cases(r, [c], data)
                    save()
        for name, fn in (("equilibrium", run_equilibrium), ("everywhere", run_everywhere), ("spoiled", run_spoiled),
                         ("parity", run_parity)):
            if name in sections:
                fn(r, data)
                save()
        for name, flag in (("warm", "--job-warm"), ("abstraction", "--job-abstraction")):
            if name in sections:
                path = os.path.join(tmp, name + ".json")
                r.call(flag, path)
                with open(path) as f:
                    data[name] = json.load(f)
                save()
    data["last_run_s"] = time.time() - t0
    save()
    print(f"done in {data['last_run_s']:.0f} s")
    return None


if __name__ == "__main__":
    main()
