#!/usr/bin/env python3
"""The 3-way spots from another game's library (gtosolver's mw-all, gto-solver 5e7dbc8's game) against Lizard's live
3-way solve: what reading their stored entries gives up, on today's ranges.

For each spot of an assembled stage's mw_index.json (scripts/library/assemble.py; the stage holds the entries, so the
source build's directory isn't read here) and a few of its stored flops: the spot's preflop line set up with today's
charts (mw_library.spot_setup, this checkout's solver), those three ranges solved from the flop on Lizard's own
library game (mw_library.library_config(): the game a live Accurate 3-way flop and the published spots are solved on)
until settled, and each combo's mix at the STORED decisions priced by that solve's EVs (solver/scripts/
bench_mw_formats.py's price: the EV the read mix gives up against the solve's own mix, weighted by the acting
player's range, % of the pot). Read two ways: the spot's stored entry (built on its own game's charts and tree), and
the live Fast 3-way solve of today's ranges at --live-iters (what answers when no stored entry is read). One solve per
(spot, flop), single thread, about 0.6 GB.

    bench_mw_game.py --stage DIR [--spots a,b] [--flops 6] [--live-iters 200] [--json OUT.jsonl]
    bench_mw_game.py --report OUT.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver" / "scripts"))
sys.path.insert(0, str(ROOT / "solver"))
sys.path.insert(0, str(ROOT))

import bench_mw_formats as B  # noqa: E402  (imports gto.native first: BLAS on one thread)
from gto import flop_library as fl  # noqa: E402
from gto import mw_library as ML  # noqa: E402
from gto.cards import cards as parse_cards  # noqa: E402
import engine.mw_near  # noqa: E402,F401  (a spot on its own tree: its entries read by that tree)

# the flops of docs/ACCURACY.md section 28, then others of the spot's at random
FLOPS = ["KcTd5h", "AcQd5h", "KcQcJd", "QcTc3d", "JcTd4h", "AcJd3h"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", type=Path)
    ap.add_argument("--spots", default="", help="spot ids (default: every spot on its own tree)")
    ap.add_argument("--flops", type=int, default=6)
    ap.add_argument("--min-iters", type=int, default=200)
    ap.add_argument("--max-iters", type=int, default=800)
    ap.add_argument("--target", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--live-iters", type=int, default=200)
    ap.add_argument("--json", default="")
    ap.add_argument("--report", default="")
    a = ap.parse_args()
    if a.report:
        return report([json.loads(x) for x in open(a.report)])
    lib = ML.MWLibrary.from_dir(str(a.stage))
    idx = lib.index()
    want = [s for s in a.spots.split(",") if s]
    spots = [s for s in idx["spots"] if (s["id"] in want if want else s.get("tree"))]
    done = set()
    if a.json and os.path.exists(a.json):
        done = {(r["spot"], r["flop"]) for r in map(json.loads, open(a.json))}
    out = open(a.json, "a") if a.json else None
    plan = []
    for sp in spots:
        now = ML.spot_setup(sp["line"])
        names = [f for f in FLOPS if f in sp["flops"]]
        rest = sorted(f for f in sp["flops"] if f not in names)
        random.Random(a.seed).shuffle(rest)
        plan.append((sp, now, (names + rest)[:a.flops]))
    rows = []
    for i in range(a.flops):          # (round robin: every spot a flop at a time)
        for sp, now, names in plan:
            if i >= len(names) or (sp["id"], names[i]) in done:
                continue
            name = names[i]
            t0 = time.time()
            canon = parse_cards(name)
            e, iters, expl = B.truth(canon, now, a)
            stored = lib.entry(sp, name)
            if stored is None:
                print(f"{sp['id']} {name}: entry won't read", file=sys.stderr)
                continue
            lr, lx = B.live_read(canon, now, a.live_iters)
            fps_now = [fl.range_fp(r) for r in now["ranges"]]
            row = {"spot": sp["id"], "flop": name, "own_tree": bool(sp.get("tree")),
                   "same_ranges": fps_now == list(sp["fp"]), "iters": iters, "expl": round(expl, 4),
                   "stored_iters": int(stored["head"].get("iters", 0)),
                   "stored_expl": float(stored["head"].get("expl", 0.0)),
                   "stored": {"|".join(k): v for k, v in B.price(e, B.entry_read(stored), now["ranges"], canon).items()},
                   "live": {"|".join(k): v for k, v in B.price(e, lr, now["ranges"], canon).items()},
                   "live_expl": round(lx, 4), "secs": round(time.time() - t0, 1)}
            rows.append(row)
            print(json.dumps(row), flush=True)
            if out:
                out.write(json.dumps(row) + "\n")
                out.flush()
    report(rows)
    return 0


def report(rows) -> int:
    print("| Spot | Flops | Stored entry: mean (max) | Live Fast: mean (max) | Truth: iterations, % pot | "
          "Stored: iterations, % pot (own ranges) |")
    print("|---|---|---|---|---|---|")
    for sid in dict.fromkeys(r["spot"] for r in rows):
        rs = [r for r in rows if r["spot"] == sid]
        st = [v for r in rs for v in r["stored"].values()]
        lv = [v for r in rs for v in r["live"].values()]
        print(f"| {sid} | {len(rs)} | {np.mean(st):.3f} ({np.max(st):.3f}) | {np.mean(lv):.3f} ({np.max(lv):.3f}) | "
              f"{np.mean([r['iters'] for r in rs]):.0f}, {np.mean([r['expl'] for r in rs]):.3f} | "
              f"{np.mean([r['stored_iters'] for r in rs]):.0f}, {np.mean([r['stored_expl'] for r in rs]):.3f} |")
    st = [v for r in rows for v in r["stored"].values()]
    lv = [v for r in rows for v in r["live"].values()]
    if st:
        print(f"| all | {len(rows)} | {np.mean(st):.3f} ({np.max(st):.3f}) | {np.mean(lv):.3f} ({np.max(lv):.3f}) | | |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
