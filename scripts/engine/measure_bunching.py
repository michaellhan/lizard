"""What bunching changes (docs/ACCURACY.md, Bunching): solves of a few spots with and without it, and what the model
leaves out.

1. Strategy and EV. Each spot's flop solved twice at the worker's Accurate config (its tree, 0.1% of the pot as the
   target, a 40 s budget), once on the even deal and once with `bunching` from the charts' folds, every library put
   aside both times (so the two differ only in the ranges). Read at the first actor's root and at the last actor's
   node after checks: the range's action frequencies, each hand class's frequencies and EV (combo-weighted mean of the
   absolute change), the node's EV in bb; and the solve's time, iterations and distance from equilibrium. For scale,
   the same spot without bunching at the worker's Fast config: how far a speed apart moves the same numbers.
2. The separable approximation: the exact weight of a pair of hands (BTN's h1, BB's h2) is J = P(no folder holds a card
   of h1 or h2); the solver gets F(h1) F(h2). Over sampled folder deals, the ratio J / (F1 F2), normalised to its
   range-weighted mean (a constant doesn't change a solve), weighted by the two ranges.
3. The next card's odds the folds give against the even deal (what the solves still deal evenly).

Run (over a minute of CPU): /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh .venv/bin/python \
    scripts/engine/measure_bunching.py [--quick]
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "solver"), str(ROOT), str(ROOT / "scripts" / "engine")]

import engine.tree_depth  # noqa: E402,F401
from engine import bunching as B  # noqa: E402
from gto import advisor as A  # noqa: E402
from gto import preflop as pf  # noqa: E402
from gto.cards import ALL_COMBOS, cards  # noqa: E402
from gto.solver import Config  # noqa: E402
from test_study_lock import ACCURATE, FAST  # noqa: E402

QUICK = "--quick" in sys.argv


def line(opener, callers, n=6):
    seats = pf.SEATS[n]
    out, opened = [], False
    for s in seats:
        if s == opener:
            out.append({"pos": s, "action": "raise", "to": 2.5})
            opened = True
        elif opened and s in callers:
            out.append({"pos": s, "action": "call"})
        elif s in callers:
            raise ValueError(s)
        else:
            out.append({"pos": s, "action": "fold"})
    # (seats before the opener fold first; the blinds after it)
    return out


SPOTS = [
    ("UTG vs BB", line("UTG", ["BB"]), "Kd7c2h"),
    ("UTG vs BB", line("UTG", ["BB"]), "8h6d4c"),
    ("BTN vs BB", line("BTN", ["BB"]), "Kd7c2h"),
    ("BTN vs BB", line("BTN", ["BB"]), "8h6d4c"),
    ("BTN vs SB, BB (3-way)", line("BTN", ["SB", "BB"]), "Kd7c2h"),
]
if QUICK:
    SPOTS = SPOTS[2:3]


def make(cfg, target):
    a = A.Advisor(Config(**cfg))
    a.root_sizes = {"river": {"bet": [0.33, 0.75, 1.25, 2.5]}}
    a.expl_target = target
    a.hu_settled = 0.3 if cfg is FAST else None
    a.should_stop = lambda: False
    a.mw_solve_streets = ("flop", "turn", "river")
    if cfg is FAST:
        a.mw_street_config = {s: dict(c) for s, c in A.MW_FAST_STREETS.items()}
    return a


def ask(adv, pre, board, flop=(), budget=40.0, **more):
    t = time.perf_counter()
    r = adv.advise(dict(players=6, stack=100, preflop=pre, board=board, flop=list(flop), study=True, budget=budget,
                        prior_budget=budget / 2, **more))
    r["_seconds"] = time.perf_counter() - t
    if "error" in r:
        raise RuntimeError(r["error"])
    return r


def class_size(name):
    return 6 if len(name) == 2 else (4 if name.endswith("s") else 12)


def node_ev(r):
    return sum(a["freq"] * (a.get("ev_bb") or 0.0) for a in r["actions"])


def compare(off, on, base=None):
    """Range frequencies (points), class frequencies and EVs (combo-weighted mean |change|), node EV."""
    acts = [a["action"] + ("" if a.get("amount_bb") is None else f" {a['amount_bb']}") for a in off["actions"]]
    f_off = {k: a["freq"] for k, a in zip(acts, off["actions"])}
    acts_on = [a["action"] + ("" if a.get("amount_bb") is None else f" {a['amount_bb']}") for a in on["actions"]]
    f_on = {k: a["freq"] for k, a in zip(acts_on, on["actions"])}
    rng = {k: (round(100 * f_off.get(k, 0), 1), round(100 * f_on.get(k, 0), 1)) for k in dict.fromkeys(acts + acts_on)}
    co, cn = off["grid"]["cells"], on["grid"]["cells"]
    dfreq = dev = wsum = 0.0
    for name, c in co.items():
        d = cn.get(name)
        if d is None or not c["w"]:
            continue
        w = c["w"] * class_size(name)
        dfreq += w * 0.5 * sum(abs(x - y) for x, y in zip(c["f"], d["f"]))
        dev += w * abs(c["evm"] - d["evm"])
        wsum += w
    return {"range": rng, "class_freq_pts": round(100 * dfreq / wsum, 2), "class_ev_bb": round(dev / wsum, 3),
            "node_ev_bb": (round(node_ev(off), 3), round(node_ev(on), 3))}


def solve_info(r):
    s = r.get("solver") or {}
    return {"seconds": round(r["_seconds"], 1), "iterations": s.get("iterations"),
            "expl_pct": s.get("exploitability_pct")}


def nodes(adv, pre, board, **more):
    root = ask(adv, pre, board, **more)
    after = []
    acting = [root["actor"]]
    r = root
    # the checks to the last seat (the preflop raiser, last to act on the flop)
    for _ in range(4):
        after.append({"pos": r["actor"], "action": "check"})
        r = ask(adv, pre, board, flop=after, **more)
        acting.append(r["actor"])
        if r["actor"] == next(a["pos"] for a in pre if a["action"] == "raise"):
            break
    return root, r, acting


def strategy():
    out = []
    for name, pre, board in SPOTS:
        row = {"spot": name, "board": board}
        acc_off, acc_on, fast = make(ACCURATE, 0.1), make(ACCURATE, 0.1), make(FAST, 0.3)
        t = time.perf_counter()
        r0, l0, who = nodes(acc_off, pre, board)
        row["off_total_s"] = round(time.perf_counter() - t, 1)
        t = time.perf_counter()
        r1, l1, _ = nodes(acc_on, pre, board, bunching="charts")
        row["on_total_s"] = round(time.perf_counter() - t, 1)
        rf, lf, _ = nodes(fast, pre, board)
        row["root_actor"], row["last_actor"] = who[0], who[-1]
        row["root"] = compare(r0, r1)
        row["last"] = compare(l0, l1)
        row["root_fast_vs_accurate"] = compare(r0, rf)
        row["last_fast_vs_accurate"] = compare(l0, lf)
        row["solve_off"], row["solve_on"], row["solve_fast"] = solve_info(r0), solve_info(r1), solve_info(rf)
        b = r1["bunching"]
        row["bunching"] = {k: b[k] for k in ("folders", "seats", "method", "samples", "stderr_pct")}
        row["most_moved"] = b["next_card"]["most_moved"]
        out.append(row)
        print(json.dumps(row), flush=True)
    return out


def separable(pre_line, board, samples=400_000, pairs=3000, seed=7):
    """J / (F1 F2) over sampled folder deals, for pairs of hands from the two remaining ranges."""
    pre = A._norm_actions(pre_line, 1.0)
    positions = pf.at_depth(pf.Table(pf.SEATS[6], 0.0, False, None), 100.0)
    flop = cards(board)
    folds = B.chart_folds(pre, positions, 100.0)
    plain = B._upstream_ranges(pre, positions, 100.0)
    left = [p for p in plain if p not in folds]
    live = B.live_mask(flop)
    rng = np.random.default_rng(seed)
    # folder deals: rejection sampling as moments() does, keeping each deal's held cards as a 52-bit mask
    held = []
    probs = [w * live / (w * live).sum() for w in folds.values()]
    while sum(len(h) for h in held) < samples:
        draws = [rng.choice(B.N, size=20_000, p=p) for p in probs]
        m = np.zeros((20_000, 52), bool)
        ok = np.ones(20_000, bool)
        for d in draws:
            a, b = B.CA[d], B.CB[d]
            ok &= ~m[np.arange(20_000), a] & ~m[np.arange(20_000), b]
            m[np.arange(20_000), a] = True
            m[np.arange(20_000), b] = True
        held.append(m[ok])
    H = np.concatenate(held)[:samples]
    r1, r2 = (plain[p] * live for p in left[:2])
    i1 = rng.choice(B.N, size=pairs, p=r1 / r1.sum())
    i2 = rng.choice(B.N, size=pairs, p=r2 / r2.sum())
    keep = np.array([not (set(ALL_COMBOS[a]) & set(ALL_COMBOS[b])) for a, b in zip(i1, i2)])
    i1, i2 = i1[keep], i2[keep]
    halves = (H[: samples // 2], H[samples // 2:])

    def ratio(h, j1, j2):
        f1 = ~(h[:, B.CA[j1]] | h[:, B.CB[j1]])
        f2 = ~(h[:, B.CA[j2]] | h[:, B.CB[j2]])
        return (f1 & f2).mean(0) / (f1.mean(0) * f2.mean(0))
    ra, rb = [], []
    for k in range(0, len(i1), 250):
        j1, j2 = i1[k:k + 250], i2[k:k + 250]
        ra.append(ratio(halves[0], j1, j2))
        rb.append(ratio(halves[1], j1, j2))
    ra, rb = np.concatenate(ra), np.concatenate(rb)
    ra, rb = ra / ra.mean(), rb / rb.mean()
    both = (ra + rb) / 2
    # each half's sampling noise is independent, so the halves' covariance is the true spread's square
    true_rms = float(np.sqrt(max(0.0, np.mean((ra - 1) * (rb - 1)))))
    noise_rms = float(np.sqrt(np.mean((ra - rb) ** 2) / 4))
    return {"spot": " vs ".join(left[:2]), "board": board, "pairs": int(keep.sum()), "samples": int(len(H)),
            "rms_pct": round(100 * true_rms, 3), "noise_rms_pct": round(100 * noise_rms, 3),
            "observed_p95_abs_pct": round(100 * float(np.quantile(np.abs(both - 1), 0.95)), 3)}


def odds(pre_line, board):
    pre = A._norm_actions(pre_line, 1.0)
    positions = pf.at_depth(pf.Table(pf.SEATS[6], 0.0, False, None), 100.0)
    t = time.perf_counter()
    plan = B.plan_for({}, "charts", pre, positions, 100.0, cards(board))
    s = time.perf_counter() - t
    info = plan.info({}, cards(board))
    nc = info["next_card"]
    by = sorted(nc["by_rank"], key=lambda x: -abs(x["p"] / x["even"] - 1))
    return {"board": board, "plan_s": round(s, 2), "method": info["method"],
            "ranks": [(x["rank"], round(100 * x["p"], 2), round(100 * x["even"], 2)) for x in by[:4]],
            "most_moved": nc["most_moved"]}


if __name__ == "__main__":
    res = {"separable": [], "odds": []}
    for name, pre, board in SPOTS:
        res["separable"].append(separable(pre, board))
        print(json.dumps(res["separable"][-1]), flush=True)
        res["odds"].append(odds(pre, board))
        print(json.dumps(res["odds"][-1]), flush=True)
    res["strategy"] = strategy()
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else None
    if out:
        out.write_text(json.dumps(res, indent=1))
