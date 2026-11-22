"""Sweeps the preflop format charts (solver/gto/pf_formats.py: other depths, antes, table sizes, a straddle,
heads-up) for dominance inversions between neighbouring hand classes, and counts them.

    python scripts/engine/pf_format_inversions.py [--data PATH_TO_pf_format_data.py] [--list] [--min 0.25]

An inversion is a weaker class continuing (raise + call) at least --min more often than the class that dominates it:
the same top card with the next kicker up (K9s over KTs; the A5 / A6 step is left out, since wheel aces outplay A6),
the offsuit hand over its suited twin, or a pair over the next pair up. Every heads-up chart line (raise first in,
facing an open, the opener facing a 3bet, the 3bettor facing the 4bet, the opener facing the 5bet) of each game the
moves cover is played as the advice plays it (preflop.strategy_for). `base` counts the same inversions in the chart
the moves are added to (the 100bb chart of the decision), so `added` is what the moves bring.
"""
from __future__ import annotations
import argparse
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "solver"))
import numpy as np  # noqa: E402
from gto import pf_formats as PF  # noqa: E402
from gto import preflop as P  # noqa: E402
from gto.pf_classes import CLASS_INDEX, CLASS_OF, N_IN  # noqa: E402

RK = "23456789TJQKA"


def pairs() -> list:
    """(weaker, stronger) class index pairs the sweep checks, with a kind label."""
    out = []
    for i in range(len(RK) - 1):
        out.append(("pair", CLASS_INDEX[RK[i] * 2], CLASS_INDEX[RK[i + 1] * 2]))
    for hi in range(1, len(RK)):
        h = RK[hi]
        for s in "so":
            for k in range(hi - 1):
                lo, up = RK[k], RK[k + 1]
                if h == "A" and (lo, up) == ("5", "6"):
                    continue
                out.append(("kicker", CLASS_INDEX[h + lo + s], CLASS_INDEX[h + up + s]))
        for k in range(hi):
            out.append(("suited", CLASS_INDEX[h + RK[k] + "o"], CLASS_INDEX[h + RK[k] + "s"]))
    return out


PAIRS = pairs()
NAMES = {v: k for k, v in CLASS_INDEX.items()}


def lines(table) -> list:
    """(hero, actions) of every heads-up chart line at this table (raises only, folds implicit)."""
    order = table.preflop_order()
    out = []
    for i, h in enumerate(order):
        if h != order[-1]:
            out.append((h, []))
        for o in order[:i]:
            out.append((h, [o]))
        for t in order[i + 1:]:
            out.append((h, [h, t]))
            out.append((h, [h, t, h, t]))
        for o in order[:i]:
            out.append((h, [o, h, o]))
    res = []
    for h, rs in out:
        acts = [{"pos": p, "action": "raise"} for p in rs]
        if PF.line_key(h, acts) is not None:
            res.append((h, acts))
    return res


def cont(acts: dict) -> np.ndarray:
    """Per-class continuing frequency of a per-combo strategy."""
    c = sum(v for k, v in acts.items() if k not in ("fold", "check"))
    return np.bincount(CLASS_OF, weights=c, minlength=len(N_IN)) / N_IN


def inversions(c: np.ndarray, thr: float) -> list:
    return [(kind, w, s, float(c[w] - c[s])) for kind, w, s in PAIRS if c[w] - c[s] >= thr]


def games() -> list:
    """(label, Table) of every game the moves cover."""
    S = P.SEATS
    out = [(f"6max {d:g}bb", P.Table(S[6], 0.0, False, None, d)) for d in (20.0, 40.0, 60.0)]
    out += [(f"6max {d:g}bb ante", P.Table(S[6], PF.ANTE, False, None, d)) for d in PF.ANTE_DEPTHS]
    out += [(f"{n}-handed 100bb", P.Table(S[n], 0.0, False, None, 100.0)) for n in (7, 8, 9)]
    out += [("6max straddle", P.Table(S[6], 0.0, True, None, 100.0))]
    out += [(f"heads-up {d:g}bb", P.Table(S[2], 0.0, False, None, d)) for d in PF.HU_DEPTHS]
    return out


def base_chart(hero, std, positions):
    """The chart format_chart moves (preflop.format_chart's base), or None."""
    mv, cover = PF.moves(hero, std, positions)
    if mv is None:
        return None
    if cover.get("base") == "6max":
        m = lambda p: P._norm(P.chart_key(p, positions))
        return P._actions_at(m(hero), [dict(a, pos=m(a["pos"])) for a in std], P.Table(P.SEATS[6], 0.0, False, None, 100.0))
    return P._actions_at(hero, std, P.Table(list(positions), 0.0, positions.straddle, None, 100.0))


def load(path: str):
    spec = importlib.util.spec_from_file_location("_pf_data_sweep", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    PF._DATA = {dim: {sub: PF.decode(*packed) for sub, packed in sets.items()} for dim, sets in mod.DELTAS.items()}
    P._STRAT_CACHE.clear()


def sweep(thr: float, show: bool = False) -> dict:
    res = {}
    for label, table in games():
        n_dec = n_inv = n_base = n_added = 0
        kinds = {}
        for hero, acts in lines(table):
            if P.format_chart(hero, acts, table)[0] is None:
                continue
            n_dec += 1
            served = P.strategy_for(hero, acts, table)
            inv = inversions(cont(served), thr)
            b = base_chart(hero, acts, table)
            bset = set()
            if b is not None:
                bf = dict(b)
                tot = sum(bf.values())
                bf["fold"] = np.clip(1.0 - tot, 0.0, 1.0)
                bset = {(w, s) for _, w, s, _ in inversions(cont(P.monotone(bf)), thr)}
            for kind, w, s, d in inv:
                n_inv += 1
                kinds[kind] = kinds.get(kind, 0) + 1
                if (w, s) in bset:
                    n_base += 1
                else:
                    n_added += 1
                if show:
                    seq = ",".join(a["pos"] for a in acts)
                    tag = "base" if (w, s) in bset else "moves"
                    print(f"  {label:18s} {hero:5s}|{seq:16s} {NAMES[w]:>4s} {NAMES[s]:>4s} +{d:.2f} ({tag})")
        res[label] = dict(decisions=n_dec, inversions=n_inv, base=n_base, added=n_added, kinds=kinds)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=None, help="a pf_format_data.py to sweep (default: the module in solver/gto)")
    ap.add_argument("--min", type=float, default=0.25)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.data:
        load(a.data)
    res = sweep(a.min, a.list)
    tot = {k: 0 for k in ("decisions", "inversions", "base", "added")}
    print(f"{'game':18s} {'decisions':>9s} {'inversions':>10s} {'in base':>8s} {'by moves':>8s}  kinds")
    for label, r in res.items():
        print(f"{label:18s} {r['decisions']:9d} {r['inversions']:10d} {r['base']:8d} {r['added']:8d}  {r['kinds']}")
        for k in tot:
            tot[k] += r[k]
    print(f"{'total':18s} {tot['decisions']:9d} {tot['inversions']:10d} {tot['base']:8d} {tot['added']:8d}")


if __name__ == "__main__":
    main()
