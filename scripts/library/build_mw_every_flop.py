#!/usr/bin/env python3
"""Build the 3-way library's spots out to every flop, into a source directory scripts/library/assemble.py merges.

The published 3-way spots (solver/gto/mw_library.py SPOTS, built by solver/scripts/build_mw_library.py) hold 185
flops each: flop_library.representative_flops(184) and Kc7d2h. This solves the rest of the 1,755 canonical flops for
the same spots with the same code and settings, so every entry is one the upstream build would have written:
solver/scripts/build_mw_library.py's own solve_entry (mw_library.solve_all on mw_library.library_config(), the
spot's ranges from mw_library.spot_setup, its defaults: at least 200 iterations, then 100 at a time until the mean
best-response gain is under 0.1% of the pot, at most 800) and its current() check of a finished entry (the same
ranges and tree). Nothing in solver/ is changed; it is imported from --solver.

Order: flop by flop, all spots on each flop, so the spots grow together; the flops of representative_flops(552)
first (the next sample the heads-up builds use), then the rest of the 1,755, each group spread over the flop
textures (a bit-reversed walk of its texture order) so a part-built group is an even sample of it.

Resumable: an entry is written to <spot>/<flop>.bin.tmp and renamed, so a stop (kill, reboot) loses at most the
entries being solved; a restart keeps every finished entry that is current() and solves the rest. mw_index.json
(mw_library's format, the spots' fingerprints, pot, stack, seats and each flop's sha1[:10]) is rewritten after every
entry, by rename, so it never lists a file that isn't whole. progress.json holds counts, mean seconds and an ETA.

    build_mw_every_flop.py --out DIR [--solver solver/] [--base DIR] [--jobs 2] [--spots a,b] [--limit N] [--plan]

--base: the published library whose mw_index.json lists flops not to solve again (default: --solver's
gto/static/flop_library). Run it through `heavy` (scripts/library/mw_every_flop.sh does, detached).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import signal
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPOT_IDS = ["mw_co_btn_bb", "mw_btn_sb_bb", "mw_hj_ip_bb", "mw_utg_btn_bb"]  # the published spots
TIERS = (552, 1755)
MAX_TASKS = 20  # entries a worker solves before it is replaced (keeps its memory from creeping)


def spread(n: int) -> list[int]:
    """0..n-1 in bit-reversed order: every prefix is spread evenly over the range."""
    bits = max(1, (n - 1).bit_length())
    out = []
    for i in range(1 << bits):
        r = int(format(i, f"0{bits}b")[::-1], 2)
        if r < n:
            out.append(r)
    return out


def flop_order(fl, cards_str, have: set[str]) -> list[str]:
    """Every canonical flop not in `have`: representative_flops(552)'s first, then the rest, each spread."""
    order: list[str] = []
    seen = set(have)
    for n in TIERS:
        tier = [cards_str(f) for f in fl.representative_flops(n)]
        if n >= 1755:
            tier = [cards_str(f) for f in sorted(fl.all_flops(), key=fl._texture)]
        new = [f for f in tier if f not in seen]
        order += [new[i] for i in spread(len(new))]
        seen |= set(new)
    return order


def sha10(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()[:10]


class Index:
    """mw_index.json of the out directory, kept in memory and rewritten by rename."""

    def __init__(self, out: Path, ml, spots, metas, tree):
        self.out, self.ml, self.spots, self.metas, self.tree = out, ml, spots, metas, tree
        self.flops: dict[str, dict[str, str]] = {sid: {} for sid, _, _ in spots}

    def add(self, sid: str, flop: str):
        self.flops[sid][flop] = sha10(self.out / sid / f"{flop}.bin")

    def write(self):
        idx = {"format": self.ml.FORMAT, "tree": self.tree, "spots": []}
        for sid, label, line in self.spots:
            if self.flops[sid]:
                s = self.metas[sid]
                idx["spots"].append({"id": sid, "label": label, "line": line, "seats": s["seats"], "fp": s["fp"],
                                     "pot": s["pot"], "stack": s["stack"], "flops": dict(sorted(self.flops[sid].items()))})
        tmp = self.out / (self.ml.INDEX + ".tmp")
        tmp.write_text(json.dumps(idx, separators=(",", ":")))
        os.replace(tmp, self.out / self.ml.INDEX)


def write_progress(out: Path, d: dict):
    tmp = out / "progress.json.tmp"
    tmp.write_text(json.dumps(d, indent=1))
    os.replace(tmp, out / "progress.json")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--solver", type=Path, default=ROOT / "solver")
    ap.add_argument("--base", type=Path, help="published library (default: SOLVER/gto/static/flop_library)")
    ap.add_argument("--spots", default=",".join(SPOT_IDS))
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0, help="solve at most this many entries this run")
    ap.add_argument("--plan", action="store_true", help="print what is left and exit")
    a = ap.parse_args(argv)
    solver = a.solver.resolve()
    sys.path.insert(0, str(solver / "scripts"))
    sys.path.insert(0, str(solver))
    import build_mw_library as bml  # noqa: E402  (imports gto.native first: BLAS on one thread)
    from gto import flop_library as fl, mw_library as ml  # noqa: E402
    from gto.cards import cards_str  # noqa: E402

    base = (a.base or solver / "gto" / "static" / "flop_library").resolve()
    out = a.out.resolve()
    if out == base or base in out.parents:
        sys.exit(f"refusing: --out {out} is inside the published library {base}")
    want = [x for x in a.spots.split(",") if x]
    spots = [s for s in ml.SPOTS if s[0] in want]
    if len(spots) != len(want):
        sys.exit(f"unknown spot in {want}; known: {[s[0] for s in ml.SPOTS]}")
    tree = ml.tree_key(ml.library_config())
    bidx = json.loads((base / ml.INDEX).read_text())
    if bidx.get("format") != ml.FORMAT or bidx.get("tree") != tree:
        sys.exit(f"{base / ml.INDEX}: format or tree differs from this solver's; not building")
    bflops = {s["id"]: set(s["flops"]) for s in bidx["spots"]}
    metas = {}
    for sid, _, line in spots:
        metas[sid] = bml._meta(sid, bml._setup(line))
        bs = next((s for s in bidx["spots"] if s["id"] == sid), None)
        if bs is not None and (bs["fp"] != metas[sid]["fp"] or abs(bs["pot"] - metas[sid]["pot"]) > 1e-9
                               or abs(bs["stack"] - metas[sid]["stack"]) > 1e-9):
            sys.exit(f"{sid}: this solver's ranges, pot or stack differ from the published spot's; not building")

    out.mkdir(parents=True, exist_ok=True)
    index = Index(out, ml, spots, metas, tree)
    common = set.intersection(*(bflops.get(sid, set()) for sid, _, _ in spots))
    jobs = []
    for flop in flop_order(fl, cards_str, common):
        for sid, _, line in spots:
            if flop in bflops.get(sid, set()):
                continue
            p = out / sid / f"{flop}.bin"
            if bml.current(str(p), metas[sid]):
                index.add(sid, flop)
            else:
                jobs.append((sid, line, flop, str(out), {"min_iters": 200, "max_iters": 800, "check": 100, "target": 0.1}))
    for sid, _, _ in spots:  # stray .tmp files of a stopped run
        for t in (out / sid).glob("*.bin.tmp") if (out / sid).is_dir() else []:
            t.unlink()
    have = sum(len(v) for v in index.flops.values())
    total = have + len(jobs)
    if a.limit:
        jobs = jobs[: a.limit]
    print(f"{time.strftime('%F %T')} {have} entries on disk, {total - have} to solve ({len(spots)} spots), "
          f"{len(jobs)} this run on {a.jobs} processes; solver {solver}", flush=True)
    if a.plan:
        print("next:", ", ".join(f"{j[0]}/{j[2]}" for j in jobs[:12]))
        return 0
    index.write()
    started = time.time()
    prog = {"pid": os.getpid(), "started": time.strftime("%FT%T"), "total": total, "done": have, "this_run": 0,
            "left": total - have, "mean_wall_s": None, "eta": None, "updated": None}
    write_progress(out, prog)
    if not jobs:
        print("nothing to solve", flush=True)
        return 0

    pool = mp.get_context("spawn").Pool(a.jobs, maxtasksperchild=MAX_TASKS)

    def stop(signum, _frame):
        print(f"{time.strftime('%F %T')} signal {signum}: stopping (finished entries are kept)", flush=True)
        pool.terminate()
        index.write()
        os._exit(1)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    n = 0
    for msg in pool.imap_unordered(bml.solve_entry, jobs):
        n += 1
        sid, flop = msg.split()[:2]
        index.add(sid, flop)
        index.write()
        el = time.time() - started
        per = el / n
        left = len(jobs) - n
        prog.update(done=have + n, this_run=n, left=total - have - n, mean_wall_s=round(per, 1),
                    eta=time.strftime("%FT%T", time.localtime(time.time() + per * left)) if left else None,
                    updated=time.strftime("%FT%T"))
        write_progress(out, prog)
        print(f"{time.strftime('%F %T')} [{have + n}/{total}, {per:.0f} s/entry, ~{per * left / 3600:.1f} h left] {msg}",
              flush=True)
    pool.close()
    pool.join()
    print(f"{time.strftime('%F %T')} done: {have + n}/{total}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
