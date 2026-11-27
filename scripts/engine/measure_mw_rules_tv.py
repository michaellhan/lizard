"""How far the betting rules' multiway narrowing (solver/gto/advisor.py _narrow_street) is from a 3-way solve: each
line of a solve from the flop's start that ends in a bet, a raise or a call, the solve's range for the player who made
it against the range the rules narrow it to, in total variation, weighted by how often the line comes up (lines under
MIN_LINE left out: the solve's range there is barely played). With a sweep of the rules' softening (NARROW_SOFT, the
weight off-rule hands keep, and OFF_RULE_MAX, their largest share of the range), patched here only.

Why (2026-11-16): UTG's half-pot bet into BTN and BB on Qs7s6d was 60 combos by the rules, 40% of them hands the rules
check, where a settled solve of the flop bets 23, and the button's solve raised K7s at 100% on those ranges. Whatever
the softening, the rules' bet ranges stay far from the solve's, so the advisor now narrows such a street through a
solve of it (Advisor.mw_current_solve) and the softening is unchanged.

Fixed iterations, so the numbers don't depend on machine load. About 4 min of CPU: run it through the CPU slot
    /Users/mhan/projects/gtosolver/.work/bin/slot.sh .venv/bin/python scripts/engine/measure_mw_rules_tv.py
"""
import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))

import gto.advisor as A  # noqa: E402
from gto import preflop as pf  # noqa: E402
from gto.cards import cards  # noqa: E402
from gto.multiway_solver import Decision, MultiwaySolver, MWConfig  # noqa: E402

FOLDS = ("UTG", "HJ", "CO", "BTN", "SB", "BB")


def pre(opener, callers):
    out, opened = [], False
    for p in FOLDS:
        if p == opener:
            out.append({"pos": p, "action": "raise", "to": 2.5}); opened = True
        elif opened and p in callers:
            out.append({"pos": p, "action": "call"})
        elif p not in callers:
            out.append({"pos": p, "action": "fold"})
    return out


SPOTS = {"UTG vs BTN, BB": pre("UTG", ("BTN", "BB")), "CO vs BTN, BB": pre("CO", ("BTN", "BB")),
         "BTN vs SB, BB": pre("BTN", ("SB", "BB"))}
FLOPS = ["Qs7s6d", "Kh8d3c", "Ah9s9d", "Tc9c8d", "5s4h2d", "JdJc4s"]
MIN_LINE = 0.02
GRID_SOFT = [0.3, 0.15, 0.08, 0.0]
GRID_CAP = [0.4, 0.2, 0.1]


def tv(a, b):
    return 0.5 * float(np.abs(a / a.sum() - b / b.sum()).sum())


def kind(name):
    k = name.split()[0]
    return "raise" if k == "all-in" else k


def lines(sol, players, max_len=4):
    """(actions, player index, solve's range for that player after the line, the line's share) for each line from the
    root that ends in a bet, raise or call."""
    out = []

    def walk(node, R, acts, share):
        if not isinstance(node, Decision) or len(acts) >= max_len:
            return
        p = node.player
        sg = node.avg_strategy()[0]
        for i, nm in enumerate(node.names):
            r = R[p] * sg[i]
            sh = share * float(r.sum() / max(R[p].sum(), 1e-12))
            if sh < MIN_LINE:
                continue
            k = kind(nm)
            a = {"pos": players[p], "action": k}
            if k in ("bet", "raise"):
                a["to"] = float(node.amounts[i])
            R2 = R.copy(); R2[p] = r
            if k in ("bet", "raise", "call"):
                out.append((acts + [a], p, sol.expand(r), sh))
            walk(node.children[i], R2, acts + [a], sh)
    walk(sol.root, sol.reach0[:, 0, :].copy(), [], 1.0)
    return out


def solve_all(iters):
    cases = []
    table = pf.Table(pf.SEATS[6])
    for name, pa in SPOTS.items():
        R = A.preflop_ranges(pa, table, 100.0)
        st0 = A.replay_hand(table, 100.0, {"preflop": pa, "flop": []}, 2)[1]
        players = [p for p in st0.order if p in st0.players_start]
        for f in FLOPS:
            b = cards(f)
            cfg = MWConfig(**A.MW_FAST_STREETS["flop"])
            sol = MultiwaySolver(b, [R[p] for p in players], st0.pot_start, 97.5, cfg=cfg).run(iters=iters)
            expl = float(sol.br_gains().mean() / sol.root_pot() * 100)
            ls = lines(sol, players)
            print(f"{name} {f}: {sol.iters} iterations, {expl:.2f}% pot, {len(ls)} lines", flush=True)
            cases.append((name, pa, R, b, ls))
    return cases


def score(cases, table):
    agg, call, w_agg, w_call = 0.0, 0.0, 0.0, 0.0
    for name, pa, R, b, ls in cases:
        for acts, p, solved, sh in ls:
            st = A.replay_hand(table, 100.0, {"preflop": pa, "flop": acts}, 2)[1]
            rs = {q: R[q].copy() for q in st.players_start}
            A._narrow_street(rs, b, st, 100.0)
            pos = acts[-1]["pos"]
            d = tv(solved, rs[pos] * (A._street_info(tuple(b))[0] >= 0))
            if acts[-1]["action"] == "call":
                call += d * sh; w_call += sh
            else:
                agg += d * sh; w_agg += sh
    return agg / max(w_agg, 1e-12), call / max(w_call, 1e-12)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=150)
    args = ap.parse_args()
    table = pf.Table(pf.SEATS[6])
    cases = solve_all(args.iters)
    base = (A.NARROW_SOFT, A.OFF_RULE_MAX)
    a0, c0 = score(cases, table)
    print(f"\nthe rules as they are (NARROW_SOFT {base[0]}, OFF_RULE_MAX {base[1]}): bets and raises {a0:.3f}, calls {c0:.3f}")
    print("softening swept (bets and raises; calls):")
    for soft in GRID_SOFT:
        row = []
        for cap in GRID_CAP:
            A.NARROW_SOFT, A.OFF_RULE_MAX = soft, cap
            a, c = score(cases, table)
            row.append(f"cap {cap:.2f}: {a:.3f}; {c:.3f}")
        print(f"  soft {soft:.2f}  " + "  ".join(row), flush=True)
    A.NARROW_SOFT, A.OFF_RULE_MAX = base

if __name__ == "__main__":
    main()
