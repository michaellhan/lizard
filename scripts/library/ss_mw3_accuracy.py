"""docs/ACCURACY.md section 38: the 3-way single-size set measured on a sample.

For each (spot, flop) of the sample (--flops flops of representative_flops(184), spread over its order, on each of the
set's spots) four 3-way flop games from the flop's start, every hand (mw_library.solve_all):

  ref     the multi-size answer, settled: the 3-way library's tree (flop bets 33 and 75%, gto/mw_library.library_config)
          with the set's size added where it isn't one of them, by build_single_size.MW3_OPTS (to a mean best-response
          gain of 0.1% of the pot, at most 800 iterations);
  stored  the set's entry: the one-size tree (build_single_size.mw3_cfg) by the same MW3_OPTS, as the build solves it;
  live    the live one-size answer Study gives on a flop the set doesn't hold: the advisor's Fast 3-way flop game
          (advisor.MW_FAST_STREETS: 12 hand buckets, every third river) with the one size (engine/single_size.py puts it
          there), FAST_ITERS iterations (what the browser's Fast reaches in its budget: solver/gto/static/worker.js);
  live_ms the live multi-size answer Study gives without the single-size source: the same Fast game on its own flop bets
          (advisor.MW_FLOP_BETS, 33 and 75%), FAST_ITERS iterations (a baseline: what the live abstraction alone moves).

At the flop's stored decisions (first to act, checked to once and twice) each answer's mix is priced by ref's EVs
against ref's own mix, weighted by the acting range (section 35's measure), as % of the pot: what playing it in the
multi-size game gives up. Also each player's value against ref's (mean |change|, % of the pot), the bet frequency (all
bets) at those decisions, and live against stored: the mean total-variation distance of the mixes (weighted by reach)
and the values' mean |change|. One JSON line a (spot, flop) to library-build/runs/ss-mw3/accuracy.jsonl (resumable),
then the table.

Run (over a minute of CPU: through slot.sh, from a folder of this worktree):
  .../gtosolver/.work/bin/slot.sh .venv/bin/python scripts/library/ss_mw3_accuracy.py [--flops 2] [--spots ID ...]
"""
import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import build_single_size as bss  # noqa: E402

FAST_ITERS = 200


def stored_nodes(sol, ml, Decision):
    """{path: (names, actor's reach, EVs, mix)} at the stored decisions."""
    out = {}
    for path in ml.STORED:
        try:
            node, R = ml._reach(sol, path)
        except (ValueError, IndexError):
            continue
        if isinstance(node, Decision):
            out[path] = (list(node.names), R[node.player, 0].copy(), sol.action_evs(node, R),
                         node.avg_strategy()[0].copy())
    return out


def priced(ref: dict, got: dict, pot: float, np):
    """(mean give % of the pot over the decisions, worst, bet frequency of `got`, bet frequency of ref) with `got`'s
    mixes on ref's actions (an action ref lacks: SystemExit)."""
    gives, bets, rbets = [], [], []
    for path, (rn, reach, evs, mix) in ref.items():
        if path not in got:
            continue
        gn, _, _, gmix = got[path]
        mapped = np.zeros_like(mix)
        for k, nm in enumerate(gn):
            if nm not in rn:
                raise SystemExit(f"{path}: {nm} isn't on the multi-size menu ({rn})")
            mapped[rn.index(nm)] = gmix[k]
        tot = max(float(reach.sum()), 1e-12)
        own = (mix * evs).sum(axis=0)
        theirs = (mapped * evs).sum(axis=0)
        gives.append(float(((own - theirs) * reach).sum() / tot / pot * 100))
        bet = [i for i, nm in enumerate(rn) if nm.startswith("bet") or nm == "all-in"]
        bets.append(float((mapped[bet].sum(axis=0) * reach).sum() / tot))
        rbets.append(float((mix[bet].sum(axis=0) * reach).sum() / tot))
    n = max(len(gives), 1)
    return sum(gives) / n, max(gives or [0.0]), sum(bets) / n, sum(rbets) / n


def tv(a: dict, b: dict) -> float:
    """Mean total-variation distance between two answers' mixes on the same tree (weighted by a's reach)."""
    out = []
    for path, (an, reach, _, amix) in a.items():
        if path not in b or b[path][0] != an:
            continue
        tot = max(float(reach.sum()), 1e-12)
        out.append(float((0.5 * abs(amix - b[path][3]).sum(axis=0) * reach).sum() / tot))
    return sum(out) / max(len(out), 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--flops", type=int, default=2)
    ap.add_argument("--spots", nargs="*")
    ap.add_argument("--solver", type=Path, default=ROOT / "solver")
    a = ap.parse_args()
    bss.load(a.solver)
    bss.use_set("mw3")
    import numpy as np
    from gto import advisor as A
    from gto import mw_library as ml
    from gto.cards import cards as parse_cards
    from gto.multiway_solver import Decision, MWConfig
    spots = [bss.BY_ID[i] for i in a.spots] if a.spots else bss.MW3_SPOTS
    frac = bss.MW3_FLOP_PCT / 100
    out = bss.RUN / "accuracy.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if out.exists():
        for ln in out.read_text().splitlines():
            try:
                r = json.loads(ln)
                if r.get("pct") == bss.MW3_FLOP_PCT:
                    done.add((r["spot"], r["flop"]))
            except (ValueError, KeyError):
                pass
    rep = bss.flops(184)
    step = len(rep) // a.flops
    # (offset from the size sample's flops, step // 2: the size was chosen on those)
    sample = [rep[i * step + step // 4] for i in range(a.flops)]
    ref_bets = sorted({0.33, 0.75, frac})
    fast = dict(A.MW_FAST_STREETS["flop"])
    for s in spots:
        st = bss.setup(s)
        for name in sample:
            if (s.id, name) in done:
                continue
            board = parse_cards(name)
            t0 = time.time()
            rc = ml.library_config()
            rc.bet = dict(rc.bet, flop=ref_bets)
            R, rexpl = bss.mw_solve(board, st, rc, bss.MW3_OPTS)
            pot, rv, r_iters = R.root_pot(), R.values(), int(R.iters)
            ref = stored_nodes(R, ml, Decision)
            R = None
            S, sexpl = bss.mw_solve(board, st, bss.mw3_cfg(frac), bss.MW3_OPTS)
            sv, s_iters = S.values(), int(S.iters)
            stored = stored_nodes(S, ml, Decision)
            S = None
            res = {}
            for key, bets in (("live", {"flop": [frac], "turn": 0.5, "river": 0.5}), ("live_ms", dict(A.MW_FLOP_BETS))):
                cfg = MWConfig(**{**fast, "bet": bets})
                L = ml.solve_all(board, st["ranges"], st["pot"], st["stack"], cfg=cfg)
                L.run(iters=FAST_ITERS)
                lexpl = float(L.br_gains().mean() / L.root_pot() * 100)
                res[key] = (stored_nodes(L, ml, Decision), L.values(), lexpl)
                L = None
            row = {"spot": s.id, "flop": name, "pct": bss.MW3_FLOP_PCT, "ref_iters": r_iters, "ref_expl": round(rexpl, 4),
                   "ref_bets": [round(x * 100) for x in ref_bets]}
            g, gm, b, rb = priced(ref, stored, pot, np)
            row["stored"] = {"give": round(g, 4), "give_max": round(gm, 4), "bet": round(b, 3), "ref_bet": round(rb, 3),
                             "dv": round(float(np.abs(sv - rv).mean() / pot * 100), 4), "iters": s_iters,
                             "expl": round(sexpl, 4)}
            for key in ("live", "live_ms"):
                nodes, lv, lexpl = res[key]
                g, gm, b, _ = priced(ref, nodes, pot, np)
                row[key] = {"give": round(g, 4), "give_max": round(gm, 4), "bet": round(b, 3),
                            "dv": round(float(np.abs(lv - rv).mean() / pot * 100), 4), "iters": FAST_ITERS,
                            "expl": round(lexpl, 4)}
            nodes, lv, _ = res["live"]
            row["live"]["tv_stored"] = round(tv(stored, nodes), 4)
            row["live"]["dv_stored"] = round(float(np.abs(lv - sv).mean() / pot * 100), 4)
            row["secs"] = round(time.time() - t0, 1)
            with out.open("a") as fh:
                fh.write(json.dumps(row) + "\n")
            print(f"  {s.id} {name}: ref {r_iters} its {rexpl:.3f}%; stored give {row['stored']['give']:.3f} "
                  f"dv {row['stored']['dv']:.3f} bet {row['stored']['bet']:.2f}/{row['stored']['ref_bet']:.2f}; live give "
                  f"{row['live']['give']:.3f} tv {row['live']['tv_stored']:.3f}; live multi-size give "
                  f"{row['live_ms']['give']:.3f} ({row['secs']:.0f} s)", flush=True)
    rows = [json.loads(ln) for ln in out.read_text().splitlines() if ln.strip()]
    rows = [r for r in rows if r.get("pct") == bss.MW3_FLOP_PCT]
    if not rows:
        return 0

    def mean(key, f):
        xs = [r[key][f] for r in rows if f in r.get(key, {})]
        return sum(xs) / max(len(xs), 1)
    print(f"{len(rows)} (spot, flop) pairs at {bss.MW3_FLOP_PCT:g}%: answer | give (% pot) mean, worst | |value change| "
          f"mean | bet freq | gain")
    for key in ("stored", "live", "live_ms"):
        print(f"  {key:<8} {mean(key, 'give'):.4f} {max(r[key]['give_max'] for r in rows):.4f} {mean(key, 'dv'):.4f} "
              f"{mean(key, 'bet'):.3f} {mean(key, 'expl'):.3f}")
    print(f"  ref bet freq {mean('stored', 'ref_bet'):.3f}; live vs stored: mix TV {mean('live', 'tv_stored'):.4f}, "
          f"|value change| {mean('live', 'dv_stored'):.4f}% pot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
