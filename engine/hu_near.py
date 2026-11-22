"""The heads-up library's spots after the charts moved under them: served as built, labelled approximate.

A heads-up library spot is found by the fingerprints of the two ranges entering the flop (gto/flop_library.py
FlopLibrary.spot); each published spot's are those of the ranges its preflop line gave when it was built. When the
charts change, the same line gives other ranges and the spot is never found again. The exactly enumerated class equity
table of 2026-11-22 (preflop model lz4, docs/ACCURACY.md section 31) moved the 200bb big blind's range at its edge
(K5o, 83s, T2s, 93s, 74o, K3s, J8s: 0.1-1.2% of a range's weight), which changed the fingerprints of all four published
200bb spots, built on 2026-11-13 to 16.

This is engine/mw_near.py for heads-up pots, on upstream's own borrowing: a pot whose ranges are exactly what a stale
spot's own preflop line gives today (the same line, game, pot and stack) reads that spot's entries as upstream reads
another table's spot as this one (flop_approx.near_exact, FlopLibrary.solution's `borrow`), when today's ranges are as
near the built ones as upstream borrows at: each built range holds at least flop_approx.NEAR_EXACT_COVER of today's by
weight, and their distances (range_dist) sum to at most NEAR_EXACT_DIST. The combos off the built ranges are left out
(upstream's borrow), your own hand off them solved live. The answer carries `precomputed.borrowed` with `built`
({"commit", "date", "seats"}) and a text that says which range moved and by how much; the web's provenance reads it as
approximate and hides the stored solve's numbers, which are the built ranges' (provenance.ts builtOf).

The built ranges come from engine/hu_built.py (scripts/library/hu_built_ranges.py recomputes them from the code at the
commit the spots still matched, eca8152, and checks them against the published fingerprints). They also stand in for a
stale spot wherever upstream reads a spot's own ranges (flop_approx._spot_ranges, None when today's code no longer
reproduces the fingerprints): another table's pots borrowed as the spot's, the flops read off stored ones near them,
and the turns read off the nearest spot that stores them.

Measured (2026-11-22): today's ranges are 0.000-0.024 from the built ones (each range; the four spots sum to 0.0015,
0.0028, 0.0223 and 0.0239), every built range holding all of today's weight; upstream borrows at up to 0.6.

The worker imports this module at start (scripts/pyodide/worker-edits.mjs), and only the worker: a local
`python -m gto.server` runs upstream's Advisor without it. solver/ is untouched.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from gto import flop_approx as FA
from gto import flop_library as fl

from engine import hu_built

_BUILT: dict = {}     # spot id -> the built setup, or None
_NOW: dict = {}       # spot id -> today's setup of its line, or None


def _game(sp: dict) -> dict:
    return {k: v for k, v in (sp.get("game") or {}).items() if k in ("players", "stack", "ante", "straddle")}


def now_setup(sp: dict) -> Optional[dict]:
    """The spot's line set up with today's charts (flop_library.spot_setup in its game), or None."""
    if sp["id"] not in _NOW:
        try:
            _NOW[sp["id"]] = fl.spot_setup(sp["line"], **_game(sp)) if sp.get("line") else None
        except Exception:   # noqa: BLE001 - (a line today's code can't replay: nothing to match)
            _NOW[sp["id"]] = None
    return _NOW[sp["id"]]


def built_setup(sp: dict) -> Optional[dict]:
    """A spot's setup as it was built: today's setup of its line with engine/hu_built.py's ranges in full0 and full1
    (and "built": True), or None where the file doesn't hold it or holds other fingerprints, pot, stack or seats than
    the index and today's line (another build)."""
    if sp["id"] not in _BUILT:
        b, now = hu_built.SPOTS.get(sp["id"]), now_setup(sp)
        ok = b is not None and now is not None and list(b["fp"]) == list(sp.get("fp") or ()) and \
            round(float(b["pot"]), 2) == round(float(sp["pot"]), 2) == round(float(now["pot"]), 2) and \
            round(float(b["stack"]), 2) == round(float(sp["stack"]), 2) == round(float(now["stack"]), 2) and \
            list(b["seats"]) == [now["oop"], now["ip"]]
        if ok:
            r0, r1 = hu_built.ranges(sp["id"])
            _BUILT[sp["id"]] = {**now, "full0": r0, "full1": r1, "built": True}
        else:
            _BUILT[sp["id"]] = None
    return _BUILT[sp["id"]]


def stale(sp: dict) -> bool:
    """Today's charts no longer give the spot's published fingerprints (upstream's own check)."""
    return _spot_ranges.hu_near_upstream(sp) is None


def near_built(lib, full0: np.ndarray, full1: np.ndarray, pot: float, stack: float) -> Optional[dict]:
    """The stale spot these ranges are today's version of, near enough to serve (NEAR_EXACT_COVER, NEAR_EXACT_DIST),
    as near_exact answers ({"spot", "cover", "dist"}) plus "built"; None where none is."""
    fps = (fl.range_fp(full0), fl.range_fp(full1))
    key = (fps, round(float(pot), 2), round(float(stack), 2))
    memo = lib.__dict__.setdefault("_hu_built", {})
    if key not in memo:
        best = None
        for sp in lib.index().get("spots", []):
            if round(float(sp["pot"]), 2) != key[1] or round(float(sp["stack"]), 2) != key[2] or \
                    sp["id"] not in hu_built.SPOTS or not stale(sp):
                continue
            b, now = built_setup(sp), now_setup(sp)
            if b is None or now is None or (fl.range_fp(now["full0"]), fl.range_fp(now["full1"])) != fps:
                continue
            cover = (FA.range_cover(full0, b["full0"]), FA.range_cover(full1, b["full1"]))
            dist = (FA.range_dist(full0, b["full0"]), FA.range_dist(full1, b["full1"]))
            if min(cover) >= FA.NEAR_EXACT_COVER and sum(dist) <= FA.NEAR_EXACT_DIST:
                best = (sp["id"], cover, dist, list(hu_built.SPOTS[sp["id"]]["seats"]))
        memo[key] = best
    got = memo[key]
    sp = got and next((x for x in lib.index().get("spots", []) if x["id"] == got[0]), None)
    if not sp:
        return None
    return {"spot": sp, "cover": got[1], "dist": got[2],
            "built": {"commit": hu_built.COMMIT, "date": hu_built.DATE, "seats": got[3]}}


def built_text(b: dict) -> str:
    """How a spot served as built differs from this pot, in words."""
    seats = list(b["built"]["seats"])
    moved = [(s, d / 2.0 * 100.0) for s, d in zip(seats, b["dist"]) if d > 1e-9]
    same = [s for s, d in zip(seats, b["dist"]) if d <= 1e-9]
    if not moved:
        diff = "the ranges are the same"
    else:
        diff = " and ".join(f"{s}'s range differs from this pot's by {m:.1f}% of its weight" for s, m in moved)
        if same:
            diff += f"; {' and '.join(same)}'s {'is' if len(same) == 1 else 'are'} the same"
    held = min(b["cover"]) * 100.0
    off = "" if held >= 99.95 else f"; {100.0 - held:.1f}% of a range off it is left out"
    return f"this spot as built on the charts of {b['built']['date']}, which have changed since: {diff}{off}"


# ----------------------------------------------------------------------------- the wraps (each reload-safe)
def _wrap_spot_ranges(upstream):
    def _spot_ranges(sp):
        st = upstream(sp)
        return st if st is not None else built_setup(sp)
    _spot_ranges.hu_near_upstream = upstream
    return _spot_ranges


def _wrap_near_exact(upstream):
    def near_exact(lib, full0, full1, pot, stack, players=6):
        got = upstream(lib, full0, full1, pot, stack, players)
        if got is not None or lib.spot(fl.range_fp(full0), fl.range_fp(full1), pot, stack) is not None:
            return got
        return near_built(lib, full0, full1, pot, stack)
    near_exact.hu_near_upstream = upstream
    return near_exact


def _wrap_solution(upstream):
    def solution(self, *args, borrow=None, **kwargs):
        sol = upstream(self, *args, borrow=borrow, **kwargs)
        if sol is not None and borrow and borrow.get("built") and sol.borrowed is not None:
            sol.borrowed = {**sol.borrowed, "built": dict(borrow["built"])}
        return sol
    solution.hu_near_upstream = upstream
    return solution


def _wrap_text(upstream):
    def borrowed_text(self):
        b = self.borrowed or {}
        return built_text(b) if b.get("built") else upstream(self)
    borrowed_text.hu_near_upstream = upstream
    return borrowed_text


_spot_ranges = _wrap_spot_ranges(getattr(FA._spot_ranges, "hu_near_upstream", FA._spot_ranges))
near_exact = _wrap_near_exact(getattr(FA.near_exact, "hu_near_upstream", FA.near_exact))
solution = _wrap_solution(getattr(fl.FlopLibrary.solution, "hu_near_upstream", fl.FlopLibrary.solution))
borrowed_text = _wrap_text(getattr(fl.LibrarySolution.borrowed_text, "hu_near_upstream",
                                   fl.LibrarySolution.borrowed_text))


def install() -> None:
    """Wraps flop_approx and flop_library (idempotent)."""
    FA._spot_ranges = _spot_ranges
    FA.near_exact = near_exact
    fl.FlopLibrary.solution = solution
    fl.LibrarySolution.borrowed_text = borrowed_text


def uninstall() -> None:
    """Upstream's back (tests)."""
    FA._spot_ranges = _spot_ranges.hu_near_upstream
    FA.near_exact = near_exact.hu_near_upstream
    fl.FlopLibrary.solution = solution.hu_near_upstream
    fl.LibrarySolution.borrowed_text = borrowed_text.hu_near_upstream


install()
