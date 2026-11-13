#!/usr/bin/env python3
"""Each stored flop's nut share, for the Reports page's Nut adv column: library-build/nuts/<spot>.json.

No library file holds a hand's equity, so a nut share can't be read from what the builds store. This works it out from
<spot>/ranges.json, with no solve: the solver's own range_equities, and the definition Study's breakdown uses (a range's
weight at NUT_EQ or more against the other range, over its weight with an equity). It reads the assembled stage, and
assemble.py publishes the result as <spot>/nuts.json.

The owner chose to keep this off the CPU while a heads-up build runs, so it refuses while a build_flop_library.py writes
into one of assemble.py's heads-up sources (--now goes ahead, for a few flops by hand). A spot short of its target gets the
flops it has: a stopped build may never reach its target (the limped one stopped on 2026-11-03), and flops it adds later
get theirs on a later run. Stopped or killed, it takes up where it stopped: a flop's share depends only on its board and
the two ranges, so nothing is done twice. About 0.13 s a flop on one core.

Usage: nuts.py [--stage library-build/stage] [--out library-build/nuts] [--spot ID] [--limit N] [--now]
Exit status 0 with nothing to do or all of it done, 3 when it won't run yet.
"""
from __future__ import annotations

import os

for v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(v, "1")  # one core, with the builds' machine in mind

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "solver"))

from gto.breakdown import NUT_EQ, range_equities  # noqa: E402
from gto.cards import cards as parse_cards  # noqa: E402
from gto.flop_library import MEMBER_FULL  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assemble import HU_SOURCES  # noqa: E402

FORMAT = 1
SAVE_EVERY = 50  # flops between saves, so a stop loses a few seconds of work


def share(eq: np.ndarray, w: np.ndarray) -> float:
    """solver/gto/breakdown.py side()'s nut share: weight at NUT_EQ or more over weight with an equity."""
    idx = np.nonzero(w > 1e-9)[0]
    m = ~np.isnan(eq[idx])
    return round(float(w[idx][m & (eq[idx] >= NUT_EQ)].sum() / max(w[idx][m].sum(), 1e-12)), 3)


def flop_nuts(flop: str, full0: np.ndarray, full1: np.ndarray) -> list[float]:
    """[out of position, in position]: each range's nut share on this flop, its blocked combos taken out as a report's are."""
    board = parse_cards(flop)
    bm = np.prod([1.0 - MEMBER_FULL[c] for c in board], axis=0)
    w0, w1 = full0 * bm, full1 * bm
    e0, e1 = range_equities(board, w0, w1)
    return [share(e0, w0), share(e1, w1)]


def is_build(cmd: str) -> bool:
    """A command line that's a heads-up library build: build_flop_library.py writing into one of assemble.py's heads-up
    sources. Not any process named like one: the preflop project's hu-solver, a preflop solve, once held this step back
    for days."""
    return "build_flop_library.py" in cmd and any(re.search(rf"{re.escape(str(d))}(/|\s|$)", cmd) for d in HU_SOURCES)


def build_running() -> bool:
    out = subprocess.run(["ps", "-axww", "-o", "command="], capture_output=True, text=True).stdout
    return any(is_build(line) for line in out.splitlines())


def why_not_yet(stage: Path) -> str | None:
    """Why the step must wait, or None."""
    if build_running():
        return "a heads-up build is running"
    return None if (stage / "index.json").exists() else f"no {stage / 'index.json'}"


def load(path: Path, fp: list[str]) -> dict:
    """What's done for these ranges. Other ranges' shares are no use, and a file that won't read is started afresh."""
    try:
        old = json.loads(path.read_bytes())
        if old.get("format") == FORMAT and old.get("nut_eq") == NUT_EQ and old.get("fp") == fp:
            return old
    except (OSError, ValueError):
        pass
    return {"format": FORMAT, "nut_eq": NUT_EQ, "fp": fp, "flops": {}}


def save(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({**data, "flops": dict(sorted(data["flops"].items()))}, separators=(",", ":")))
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", type=Path, default=ROOT / "library-build" / "stage")
    ap.add_argument("--out", type=Path, default=ROOT / "library-build" / "nuts")
    ap.add_argument("--spot", action="append", help="only this spot (repeatable)")
    ap.add_argument("--limit", type=int, help="at most this many flops in all")
    ap.add_argument("--now", action="store_true", help="don't wait for the builds")
    a = ap.parse_args()

    if not a.now and (why := why_not_yet(a.stage)):
        print(f"nuts: not yet, {why}")
        return 3
    a.out.mkdir(parents=True, exist_ok=True)
    spots = json.loads((a.stage / "index.json").read_bytes())["spots"]
    done, t0 = 0, time.time()
    for s in spots:
        if a.spot and s["id"] not in a.spot:
            continue
        rp = a.stage / s["id"] / "ranges.json"
        if not rp.exists() or len(s.get("seats", [])) != 2:
            continue
        ranges = json.loads(rp.read_bytes())
        if ranges.get("fp") != s.get("fp"):
            print(f"nuts: {s['id']}: ranges.json isn't the index's, left out")
            continue
        full0, full1 = (np.asarray(w, dtype=np.float64) / 10000 for w in ranges["w"])
        path = a.out / f"{s['id']}.json"
        data = load(path, s["fp"])
        todo = [f for f in sorted(s["flops"]) if f not in data["flops"]]
        for i, f in enumerate(todo):
            if a.limit is not None and done >= a.limit:
                break
            data["flops"][f] = flop_nuts(f, full0, full1)
            done += 1
            if (i + 1) % SAVE_EVERY == 0:
                save(path, data)
        save(path, data)
        print(f"nuts: {s['id']}: {len(data['flops'])} of {len(s['flops'])} flops")
    print(f"nuts: {done} flops in {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
