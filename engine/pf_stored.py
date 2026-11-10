"""Lizard's stored preflop solves: the games beyond upstream's two (pf_study.STORED, 6-max 100bb with no rake or 5%
capped at 3bb) that the worker can answer from a file at once, as it does those two.

Each is the same model and the same solve as upstream's (pf_study.Spec, pf_game's DCFR over the 169 classes, STORED_ITERS
iterations, packed by pf_study.pack), built by scripts/pf/build_stored.py into engine/pf/<key>.bin. The worker reads
them from the site's pf/ folder (scripts/build-solver-assets.mjs copies them there beside upstream's), natively from
engine/pf/. Importing this module adds them to pf_study.STORED and teaches pf_study._read_stored the native path; the
worker imports it once at start (scripts/pyodide/worker-edits.mjs). solver/ is untouched.

The grid: 2 to 6 players (7 and more don't fit in the browser, pf_study.BROWSER_PLAYERS), equal stacks at each depth in
DEPTHS, no ante or straddle, the engine's sizes, with no rake or with 5% capped at 3bb. web/src/solver/pfStored.ts lists
the same games for the page, and a test holds the two lists to the files.
"""
from __future__ import annotations
import os
import sys
from typing import List, Optional

from gto import pf_study as PS

PLAYERS = (2, 3, 4, 5, 6)
DEPTHS = (20.0, 25.0, 30.0, 40.0, 50.0, 60.0, 80.0, 100.0, 125.0, 150.0, 200.0)
RAKES = (None, (0.05, 3.0))
HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "pf")


def games() -> List[PS.Spec]:
    """Every game of the grid that upstream doesn't already store."""
    out = []
    for n in PLAYERS:
        for d in DEPTHS:
            for r in RAKES:
                s = PS.Spec(players=n, stack=d, rake=r)
                if s.key not in UPSTREAM:
                    out.append(s)
    return out


UPSTREAM = tuple(PS.STORED)
KEYS = tuple(s.key for s in games())
_upstream_read = PS._read_stored


def _read(key: str) -> Optional[bytes]:
    """Upstream's reader for its own games and, in the browser, for these too (the site's pf/ holds both); natively
    these from engine/pf/."""
    if key in KEYS and sys.platform != "emscripten":
        try:
            with open(os.path.join(DIR, key + ".bin"), "rb") as f:
                return f.read()
        except OSError:
            return None
    return _upstream_read(key)


def install() -> None:
    """Adds the grid to pf_study's stored games (idempotent)."""
    if PS._read_stored is not _read:
        PS.STORED = UPSTREAM + KEYS
        PS._read_stored = _read


install()
