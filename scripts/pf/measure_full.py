#!/usr/bin/env python3
"""Measure the full-tree preflop prototype (engine/pf_full.py) against the published 6-max 100bb solves and the
current solver (lz4, engine/pf_solve.py's game): docs/ACCURACY.md section 35. Every solve through the shared CPU slot,
one per process:

    slot.sh .venv/bin/python scripts/pf/measure_full.py solve --engine lz4 --iters 1500 --save-at 700 --out DIR/lz4
    slot.sh .venv/bin/python scripts/pf/measure_full.py solve --engine combo --cross 1 --iters 1500 --save-at 700 \\
        --out DIR/combo_x
    .venv/bin/python scripts/pf/measure_full.py compare DIR/lz4_700.npz DIR/combo_x_700.npz ... --base DIR/lz4_700.npz
    slot.sh .venv/bin/python scripts/pf/measure_full.py pairterm DIR/combo_x_1500.npz --out DIR/pairterm.json
    .venv/bin/python scripts/pf/measure_full.py shares DIR/lz4_1500.npz --out DIR/shares_lz4_1500.json

`solve` writes <out>_<iters>.npz (the class-level average strategy, (decisions, 3, 169)) and <out>.json (time per
iteration, peak resident memory, exploitability in its own game at each save). `compare` reads them into the class-level
game and reports each against the references (pf_equilibrium.report: mean error in points, spots out, hand facts off),
the opener facing a 3bet (scripts/pf/vs3bet.py: out of order, and the per-hand gap where the local reference file is),
the distance per node to --base (half the L1 distance of the class strategies, weighted by the acting seat's class
reach), and each strategy's exploitability in the other model's game (what a seat gains against it by best-responding,
in the class-level game with and without removal across seats). `pairterm` measures what the first-order removal across
seats leaves out at the heads-up showdowns of a solve (module doc of `pairterm`). `shares` reports how often a saved
strategy's hands end folded before the flop, at a heads-up flop or all-in, or at a three-way flop.

Game: 6-max 100bb, the references' rake (5% capped at 4bb), the stored games' tree (pf_solve.Spec), engine/pf_calib.py's
flop values (--params default: upstream's library model, pf_model.Params()).
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path[:0] = [os.path.join(ROOT, "solver"), os.path.join(ROOT, "solver", "scripts"), ROOT,
                os.path.dirname(os.path.abspath(__file__))]

import numpy as np  # noqa: E402

RAKE = (0.05, 4.0)


def spec_of(a):
    from engine import pf_solve as S
    return S.Spec(a.players, (a.stack,), rake=RAKE if a.rake else None)


def params_of(name):
    from engine import pf_model as M
    return M.Params() if name == "default" else None


def peak_mb() -> float:
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / 2 ** 20 if sys.platform == "darwin" else r / 1024


# ----------------------------------------------------------------------------- solve
def cmd_solve(a):
    import gto.native  # noqa: F401
    from gto import pf_study as PS
    from engine import pf_full as F
    spec = spec_of(a)
    saves = sorted({int(x) for x in a.save_at.split(",") if x} | {a.iters})
    t0 = time.time()
    if a.engine == "lz4":
        g = spec.game(model_params=params_of(a.params))
        g.avg_power = PS.AVG_POWER
        avg = g.average
        expl = lambda: g.exploitability(per_seat=True)  # noqa: E731
        step = g.iterate
        mem = (g.regret.nbytes + g.ssum.nbytes) / 2 ** 20
    else:
        fg = F.game(spec, level=a.engine, cross=bool(a.cross), model_params=params_of(a.params))
        avg = fg.average_class
        expl = lambda: fg.exploitability(per_seat=True)  # noqa: E731
        step = fg.iterate
        mem = fg.memory_mb()
    build = time.time() - t0
    # lz4 has no removal across seats, whatever --cross says
    rec = {"engine": a.engine, "cross": a.engine != "lz4" and bool(a.cross), "params": a.params, "game": spec.key,
           "build_s": round(build, 2), "kept_mb": round(mem, 1), "saves": {}}
    t_iter, t = 0.0, 0
    for it in saves:
        t1 = time.time()
        while t < it:
            t += 1
            step(t)
        t_iter += time.time() - t1
        t2 = time.time()
        e = expl()
        out = f"{a.out}_{it}.npz"
        np.savez_compressed(out, avg=np.asarray(avg(), float))
        s = {"iters": it, "s_per_iter": round(t_iter / it, 4), "mbb_seat": round(1000 * sum(e) / len(e), 3),
             "mbb_per_seat": [round(1000 * x, 3) for x in e], "expl_s": round(time.time() - t2, 1),
             "peak_mb": round(peak_mb(), 1), "file": os.path.basename(out)}
        if a.engine == "combo":
            s["class_spread"] = fg.class_spread()
        rec["saves"][str(it)] = s
        print(json.dumps(s), flush=True)
    rec["seconds"] = round(time.time() - t0, 1)
    with open(a.out + ".json", "w") as f:
        json.dump(rec, f, indent=1)


# ----------------------------------------------------------------------------- compare
def load_into(spec, path, params=None):
    """The class-level game (pf_engine.Game) holding a saved average strategy."""
    from gto import pf_study as PS
    g = spec.game(model_params=params)
    g.avg_power = PS.AVG_POWER
    g.ssum = np.load(path)["avg"]
    g.regret = np.zeros_like(g.ssum)
    return g


def node_distance(gA, gB) -> dict:
    """Half the L1 distance between two class strategies at every decision (the share of the acting seat's range played
    differently), each class weighted by the acting seat's reach there in gB; nodes weighted by how often gB plays their
    line (the seats' reach totals multiplied), and summarised over the nodes played in over 1% of hands."""
    sA, sB = gA.average(), gB.average()
    R = gB.reach()
    w = R[gB.dec, gB.player]                                # (D, 169): the acting seat's class weights
    d_cls = 0.5 * np.abs(sA - sB).sum(1)                    # (D, 169)
    node_w = np.prod(R[gB.dec].sum(2), axis=1)              # how often the line is played (seats' reaches multiplied)
    node_d = (d_cls * w).sum(1) / np.maximum(w.sum(1), 1e-300)
    big = node_w > 0.01 * node_w[0]
    order = np.argsort(-node_w)

    def row(k):
        return (" ".join(f"{m[0]}:{m[1]}" for m in gB.nodes_all[gB.dec[k]].line) or "first in",
                gB.positions[gB.player[k]], round(float(node_w[k] / node_w[0]), 4), round(float(node_d[k]), 4))

    k_max = int(np.flatnonzero(big)[np.argmax(node_d[big])])
    return {"mean_reach_weighted": round(float((node_d * node_w).sum() / node_w.sum()), 4),
            "nodes_over_1pct": int(big.sum()),
            "mean_over_1pct": round(float(node_d[big].mean()), 4),
            "max_over_1pct": round(float(node_d[big].max()), 4),
            "max_node": row(k_max),                         # where that maximum is: line, seat, reach, distance
            "top_nodes": [row(k) for k in order[:12]]}


def ref_report(g, spec, iters) -> dict:
    import pf_equilibrium as P
    rows, (mae, n_miss), hands, nb = P.report(g)
    out = {"mae_points": round(mae * 100, 3), "spots_out": n_miss,
           "facts_off": nb, "facts": len(hands),
           "refs": {name: {k: round(float(v), 4) for k, v in got.items()} for name, got, want, bad, unc in rows if not unc},
           "facts_detail": {name: round(float(v), 3) for name, action, v, lo, hi, ok in hands}}
    import vs3bet
    r = vs3bet.report(vs3bet.wrap(spec, g, iters), "")
    out["vs3bet"] = {"mean_gap": r.get("mean_gap"), "out_of_order": sum(len(s["out_of_order"]) for s in r["spots"].values()),
                     "pub_mae": r.get("pub_mae")}
    return out


def cmd_compare(a):
    import gto.native  # noqa: F401
    from engine import pf_full as F
    spec = spec_of(a)
    base = load_into(spec, a.base, params_of(a.params)) if a.base else None
    res = {}
    for path in a.runs:
        name = os.path.basename(path)[:-4]
        g = load_into(spec, path, params_of(a.params))
        iters = int(name.rsplit("_", 1)[1])
        rec = ref_report(g, spec, iters)
        if base is not None and os.path.abspath(path) != os.path.abspath(a.base):
            rec["vs_base"] = node_distance(g, base)
        # exploitability in each class-level model (mbb/hand a seat): lz4's (no removal across seats) and with it
        rec["mbb_in_lz4_game"] = round(1000 * g.exploitability() / g.n, 3)
        fx = F.FullGame(g, level="class", cross=True, dtype=np.float64)
        avg = g.ssum / np.maximum(g.ssum.sum(1, keepdims=True), 1e-300)
        rec["mbb_in_cross_game"] = round(1000 * fx.exploitability(strat=avg) / g.n, 3)
        res[name] = rec
        print(name, json.dumps({k: v for k, v in rec.items() if k not in ("refs", "facts_detail")}), flush=True)
    if a.out:
        with open(a.out, "w") as f:
            json.dump(res, f, indent=1)


# ----------------------------------------------------------------------------- terminal shares
def cmd_shares(a):
    """How often a saved strategy's hands end in each kind of terminal: folds before a flop, heads-up flops, heads-up
    all-ins and three-way flops (or more). Each terminal weighs the product of the seats' class reaches there over the
    root's (the class-level game, no card removal across seats), as node_distance weighs lines."""
    import gto.native  # noqa: F401
    spec = spec_of(a)
    g = load_into(spec, a.run, params_of(a.params))
    R = g.reach()                                           # (N, n, 169)
    w = np.prod(R.sum(2), axis=1)
    w = w / w[0]
    tot = {"fold": 0.0, "hu_flop": 0.0, "hu_allin": 0.0, "multiway_flop": 0.0, "multiway_allin": 0.0}
    for k in g.terms:
        nd = g.nodes_all[k]
        if nd.kind == "fold":
            kind = "fold"
        else:
            kind = ("hu_" if len(nd.active) == 2 else "multiway_") + ("allin" if nd.allin else "flop")
        tot[kind] += float(w[k])
    out = {"run": os.path.basename(a.run), "shares": {k: round(v, 5) for k, v in tot.items()},
           "total": round(sum(tot.values()), 6)}
    print(json.dumps(out))
    if a.out:
        with open(a.out, "w") as f:
            json.dump(out, f, indent=1)


# ----------------------------------------------------------------------------- the pair term
def cmd_pairterm(a):
    """At the heads-up showdowns (flops and all-ins) a solve reaches most, each live hand's expected result (bb, per unit
    of the deal's weight) three ways: lz4's (the opponent's range as it reached, folders ignored), the prototype's (the
    opponent's combos weighed by rho(c) = prod_f m_f(c)), and exact in the folders' removal given both live hands
    (prod_f m_f(h, c), m_f(h, c) = M_f - rem_f(h) - rem_f(c) + the folder's weight on combos holding one card of each;
    folder-folder collisions still left out). Reported: the reach-weighted mean and RMS of |approx - exact| per live hand,
    over the terminals, and the same per terminal."""
    import gto.native  # noqa: F401
    from gto.pf_classes import CLASS_OF, COMPAT
    from engine import pf_full as F
    spec = spec_of(a)
    g = load_into(spec, a.run, params_of(a.params))
    fg = F.FullGame(g, level="combo", cross=True, dtype=np.float64)
    avg = g.ssum / np.maximum(g.ssum.sum(1, keepdims=True), 1e-300)
    strat = avg[:, :, CLASS_OF]
    R = fg.down(strat)
    Mv = fg.masses(R)
    sp = fg.space
    cmp = COMPAT.astype(float)
    c1, c2 = sp.c1, sp.c2
    cg = fg.cg
    cand = []
    for gi, (gk, _S, rows, aa, cc, wa, ka, wc, kc) in enumerate(cg.hu):
        for j, r in enumerate(rows):
            node = cg.terms[r]
            S_ = fg.src[node]
            w = float(np.prod([R[S_[q]].sum() for q in range(fg.n)]))
            cand.append((w, gi, j))
    cand.sort(reverse=True)
    eq = fg.eq
    out = []
    tot = {"lz4": [0.0, 0.0], "cross": [0.0, 0.0]}
    wsum = 0.0
    for w, gi, j in cand[:a.terminals]:
        gk, _S, rows, aa, cc, wa, ka, wc, kc = cg.hu[gi]
        r = rows[j]
        node = cg.terms[r]
        S_ = fg.src[node]
        act = cg.t_active[r]
        folders = [q for q in range(fg.n) if not act[q]]
        Sm = eq if gk == ("allin",) else cg._model(gk[-1]).share(gk[:-1])
        Sx = Sm[CLASS_OF][:, CLASS_OF]                       # (h, c) aggressor's pot share
        P = np.ones((F.NC, F.NC))
        rho_c = np.ones(F.NC)
        for f in folders:
            rf = R[S_[f]]
            Mf = rf.sum()
            rem = Mf - Mv[S_[f]]
            Fm = np.zeros((52, 52))
            Fm[c1, c2] = rf
            Fm[c2, c1] = rf
            X = Fm[c1][:, c1] + Fm[c1][:, c2] + Fm[c2][:, c1] + Fm[c2][:, c2]
            P *= Mf - rem[:, None] - rem[None, :] + X
            rho_c *= Mv[S_[f]]
        rec = {"line": " ".join(f"{p}:{x}" for p, x, _ in cg.nodes_all[node].line), "weight": w, "allin": gk == ("allin",)}
        for side, (me, op, wm, km, sh) in {"a": (aa[j], cc[j], wa[j], ka[j], Sx), "c": (cc[j], aa[j], wc[j], kc[j], 1 - Sx.T)}.items():
            rm, ro = R[S_[me]], R[S_[op]]
            ff = np.prod([Mv[S_[f]] for f in folders], axis=0)
            hw = rm * ff * (cmp @ ro)                        # hero hand's weight at this terminal
            if hw.sum() <= 0:
                continue
            res = {}
            for kind, wt in (("lz4", cmp * ro[None, :]), ("cross", cmp * (ro * rho_c)[None, :]), ("exact", cmp * P * ro[None, :])):
                den = wt.sum(1)
                res[kind] = np.where(den > 0, wm * (wt * sh).sum(1) / np.maximum(den, 1e-300) + km, 0.0)
            hwn = hw / hw.sum()
            for kind in ("lz4", "cross"):
                d = np.abs(res[kind] - res["exact"])
                rec[f"{side}_{kind}_mean_bb"] = round(float((hwn * d).sum()), 5)
                rec[f"{side}_{kind}_rms_bb"] = round(float(np.sqrt((hwn * d ** 2).sum())), 5)
                tot[kind][0] += w * float((hwn * d).sum())
                tot[kind][1] += w * float((hwn * d ** 2).sum())
            wsum += w
        out.append(rec)
        print(json.dumps(rec), flush=True)
    summary = {k: {"mean_bb": round(v[0] / wsum, 5), "rms_bb": round(float(np.sqrt(v[1] / wsum)), 5)} for k, v in tot.items()}
    print("summary", json.dumps(summary))
    if a.out:
        with open(a.out, "w") as f:
            json.dump({"summary": summary, "terminals": out}, f, indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("solve", "compare", "pairterm", "shares"):
        p = sub.add_parser(name)
        p.add_argument("--players", type=int, default=6)
        p.add_argument("--stack", type=float, default=100.0)
        p.add_argument("--rake", type=int, default=1)
        p.add_argument("--params", default="calibrated", choices=("calibrated", "default"))
        if name == "solve":
            p.add_argument("--engine", choices=("lz4", "class", "combo"), required=True)
            p.add_argument("--cross", type=int, default=1)
            p.add_argument("--iters", type=int, default=1500)
            p.add_argument("--save-at", default="700")
            p.add_argument("--out", required=True)
        elif name == "compare":
            p.add_argument("runs", nargs="+")
            p.add_argument("--base")
            p.add_argument("--out")
        elif name == "pairterm":
            p.add_argument("run")
            p.add_argument("--terminals", type=int, default=40)
            p.add_argument("--out")
        else:
            p.add_argument("run")
            p.add_argument("--out")
    a = ap.parse_args()
    {"solve": cmd_solve, "compare": cmd_compare, "pairterm": cmd_pairterm, "shares": cmd_shares}[a.cmd](a)


if __name__ == "__main__":
    main()
