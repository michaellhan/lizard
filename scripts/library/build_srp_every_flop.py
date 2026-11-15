#!/usr/bin/env python3
"""Builds the five single-raised 6-max spots that the published base stops at 552 flops (srp_hj_co, srp_btn_sb,
srp_utg_hj, srp_co_sb, srp_utg_btn) out to every flop (1,755), into a source directory that assemble.py merges.

The base's 552 entries of these spots were solved on flop_library.old_tree() (the river bet blind on the turn's boards)
without turn files; solver/scripts/build_flop_library.py solves only on the current tree (the river dealt, about 7x the
CPU). So this wrapper (solver/ stays as imported) solves the missing flops the way the 552 were: the same tree
(old_tree(), the hash in every entry's head), the same sizes and model, the same accuracy (build_flop_library's
defaults: 200 iterations, then every 100 until under 0.15% of the pot, at most 1,000) and no turn files, writing each
entry with build_flop_library.write_entry. Each spot's folder is seeded with the base's 552 entries (copied, each
checked against the base index's hash), so the source's index.json and report.json, written by build_flop_library's
own write_index, cover the whole spot (the 552 and every flop built so far, all listed as the spot's "old"), and
assemble.py takes a source spot only when it holds every base flop unchanged.

Order: per spot, the 876 flops representative_flops(1656) adds to the 552 first (an odd multiple of 552 holds it, so
the spot passes through a systematic sample of the flop space), then the other 327; within each group a stride through
the texture order, so a partial spot is spread over textures.

Resumable: an entry already in --out on the old tree for the spot's ranges is kept; run again with the same arguments.
The index is rewritten every --index-every entries and at the end of each spot.

    build_srp_every_flop.py --dry-run                      # what is left, per spot
    build_srp_every_flop.py --spots srp_hj_co --limit 2    # a measurement
    scripts/library/srp_every_flop.sh start|stop|status    # the detached build (through `heavy`)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main_checkout() -> Path:
    """The main checkout (this file may run from a worktree): the parent of git's common directory."""
    try:
        d = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--path-format=absolute", "--git-common-dir"],
                           capture_output=True, text=True, check=True).stdout.strip()
        return Path(d).parent
    except (OSError, subprocess.CalledProcessError):
        return ROOT


MAIN = main_checkout()
SPOTS = ["srp_hj_co", "srp_btn_sb", "srp_utg_hj", "srp_co_sb", "srp_utg_btn"]
OUT = MAIN / "library-build" / "sources" / "srp-every-flop"
BASE = MAIN / "solver" / "gto" / "static" / "flop_library"
STEP = 0.6180339887  # golden-ratio stride

bfl = fl = None  # build_flop_library and gto.flop_library, imported from --solver


def load(solver: Path) -> None:
    global bfl, fl
    sys.path.insert(0, str(solver / "scripts"))
    sys.path.insert(0, str(solver))
    import build_flop_library as b  # noqa: E402  (imports gto.native first: BLAS on one thread)
    bfl, fl = b, b.fl


def spread(names: list) -> list:
    """names (in texture order) by a golden-ratio stride, so any prefix is spread over the textures."""
    n = len(names)
    keyed = sorted(range(n), key=lambda i: (i * STEP) % 1.0)
    return [names[i] for i in keyed]


def order(base_flops: set) -> list:
    """Every flop not in the base: representative_flops(1656)'s first, then the rest, each group spread."""
    from gto.cards import cards_str
    allf = [cards_str(f) for f in fl.representative_flops(1755)]
    rep = {cards_str(f) for f in fl.representative_flops(1656)}
    first = [f for f in allf if f in rep and f not in base_flops]
    rest = [f for f in allf if f not in rep and f not in base_flops]
    return spread(first) + spread(rest)


def solve_old(job):
    """build_flop_library.solve_entry on the old tree (the river blind), without turn files. Returns a progress line."""
    solver, sid, line, fmt, name, out, a = job
    if bfl is None:
        load(Path(solver))
    from gto.cards import cards as parse_cards
    from gto.solver import solve
    import resource
    s = bfl._setup(line, fl.Format(**fmt))
    meta = dict(bfl._meta(sid, s), board=name, tree=fl.old_tree())
    t0 = time.time()
    cfg = fl.library_config()  # no pot and stack: the river blind (old_tree())
    sol = solve(parse_cards(name), s["full0"], s["full1"], s["pot"], s["stack"], cfg=cfg, time_budget=1e9,
                max_iters=a["min_iters"])
    expl = sol.exploitability()
    while expl > a["target"] and sol.iters < a["max_iters"]:
        sol.extend(1e9, max_iters=min(sol.iters + a["check"], a["max_iters"]))
        expl = sol.exploitability()
    data, _ = bfl.write_entry(out, sid, name, sol, meta, with_turns=False)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20  # bytes on macOS
    return (f"{sid} {name} iters={sol.iters} expl={expl:.3f}% secs={time.time() - t0:.0f} bytes={len(data)}"
            f" peak_mb={rss:.0f}")


def seed(base: Path, out: Path, sid: str, meta: dict, write: bool = True) -> set:
    """Copy the base's entries of a spot into out (each checked against the base index's hash, and on the old tree for
    the spot's ranges now); returns the base's flops."""
    idx = json.loads((base / "index.json").read_bytes())
    sp = next((s for s in idx["spots"] if s["id"] == sid), None)
    if sp is None:
        sys.exit(f"{sid}: not in the base index {base}")
    if sp["fp"] != meta["fp"] or float(sp["pot"]) != float(meta["pot"]) or float(sp["stack"]) != float(meta["stack"]):
        sys.exit(f"{sid}: the base's ranges, pot or stack differ from the solver's now; not building")
    if sorted(sp.get("old", [])) != sorted(sp["flops"]) or fl.tree_hash(sp["old_tree"]) != fl.tree_hash(fl.old_tree()):
        sys.exit(f"{sid}: the base's entries are not all on old_tree(); this wrapper builds only that case")
    if not write:
        return set(sp["flops"])
    d = out / sid
    d.mkdir(parents=True, exist_ok=True)
    copied = 0
    for flop, h in sp["flops"].items():
        dst = d / f"{flop}.bin"
        if dst.exists() and hashlib.sha1(dst.read_bytes()).hexdigest()[:10] == h:
            continue
        data = (base / sid / f"{flop}.bin").read_bytes()
        if hashlib.sha1(data).hexdigest()[:10] != h:
            sys.exit(f"{sid}/{flop}: the base entry fails its index hash")
        tmp = dst.with_suffix(".bin.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, dst)
        copied += 1
    if copied:
        print(f"{sid}: seeded {copied} base entries", flush=True)
    return set(sp["flops"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spots", default=",".join(SPOTS))
    ap.add_argument("--solver", type=Path, default=ROOT / "solver", help="the solver snapshot to run")
    ap.add_argument("--base", type=Path, default=BASE)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0, help="solve at most this many entries this run")
    ap.add_argument("--index-every", type=int, default=20)
    ap.add_argument("--min-iters", type=int, default=200)
    ap.add_argument("--max-iters", type=int, default=1000)
    ap.add_argument("--check", type=int, default=100)
    ap.add_argument("--target", type=float, default=0.15)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    load(a.solver.resolve())
    want = [s for s in a.spots.split(",") if s]
    bad = [s for s in want if s not in SPOTS]
    if bad:
        ap.error(f"{bad}: this wrapper builds only {SPOTS}")
    out = a.out.resolve()
    if out == BASE.resolve() or BASE.resolve() in out.parents or "gtosolver" in out.parts:
        sys.exit(f"refusing: --out {out}")
    every = fl.all_spots()
    by_id = {s[0]: bfl._spot(s) for s in every}
    opts = {"min_iters": a.min_iters, "max_iters": a.max_iters, "check": a.check, "target": a.target}
    old = fl.old_tree()
    jobs = []
    for sid in want:
        _, label, line, fmt = by_id[sid]
        meta = bfl._meta(sid, bfl._setup(line, fmt))
        if bfl.old_tree(meta) is None:
            sys.exit(f"{sid}: the spot's tree now is the old tree; build it with build_flop_library.py instead")
        base_flops = seed(a.base, out, sid, meta, write=not a.dry_run)
        todo = [nm for nm in order(base_flops) if not bfl.current(str(out / sid / f"{nm}.bin"), meta, old)]
        print(f"{sid}: {len(base_flops)} base + {1755 - len(base_flops) - len(todo)} built, {len(todo)} to solve",
              flush=True)
        jobs += [(str(a.solver.resolve()), sid, line, fmt.as_dict(), nm, str(out), opts) for nm in todo]
    if a.dry_run:
        print(f"{len(jobs)} entries to solve; --dry-run: nothing solved")
        return 0
    if a.limit:
        jobs = jobs[: a.limit]
    print(f"{len(jobs)} entries to solve, {a.jobs} processes, out {out}", flush=True)
    t0, done = time.time(), 0
    last = None
    if jobs:
        # a new process per entry: a worker's heap keeps part of each solve, which adds to the next one's peak
        with mp.get_context("spawn").Pool(a.jobs, maxtasksperchild=1) as pool:
            for msg in pool.imap_unordered(solve_old, jobs):
                done += 1
                el = time.time() - t0
                print(f"[{done}/{len(jobs)} {el / 60:.0f} min, ~{el / done * (len(jobs) - done) / 3600:.1f} h left] "
                      f"{msg}", flush=True)
                sid = msg.split()[0]
                if done % a.index_every == 0 or (last and sid != last):
                    bfl.write_index(str(out), every)
                last = sid
    if os.path.isdir(out):
        bfl.write_index(str(out), every)
    return 0


if __name__ == "__main__":
    sys.exit(main())
