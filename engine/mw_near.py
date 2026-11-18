"""The 3-way library's spots after the charts moved under them: served as built, labelled approximate.

A 3-way library spot is found by the fingerprints of the three ranges entering the flop (gto/mw_library.py
MWLibrary.spot); each published spot's are those of the ranges its preflop line gave when it was built. When the
charts change, the same line gives other ranges and the spot is never found again: the charts' multiway calls moved on
2026-11-17 (b10afc8), which changed the big blind's range in all four spots, so since then every 3-way flop was
solved live (Quick in its small game) and the stored entries went unread.

This serves a spot's stored entries to a pot whose ranges are exactly what the spot's own preflop line gives today (the
same line at 6-max 100bb, so the same pot and stack), when today's ranges are near the ones it was built on: their
distances (gto/flop_approx.range_dist, half the L1 distance of the normalized ranges is the share of weight that
moved) sum to at most NEAR_DIST, and each built range holds at least NEAR_COVER of today's by weight (the entries hold
every hand, so nothing is left out). The answer carries `precomputed.borrowed` as a borrowed spot's does (the web's
provenance reads it as approximate and hides the stored solve's numbers, which are the built ranges'), with
`built` ({"commit", "date", "seats"}) and a text that says which ranges moved and by how much.

The built ranges come from engine/mw_built.py (scripts/library/mw_built_ranges.py recomputes them from the solver at
the build's commit and checks them against the published fingerprints; the entries store fingerprints, not ranges).
They also stand in for a stale spot wherever upstream reads a spot's own ranges (mw_library._spot_ranges, which
returns None when today's code no longer reproduces the fingerprints): 8- and 9-max pots borrowed as a spot's
(MWLibrary.borrow) and the stand-ins at once (MWLibrary.stand_in) measure their distance to what the entries were
solved on, not to nothing.

Measured (2026-11-18): today's ranges are 0.142-0.165 from the built ones (the big blind's alone: 7.1-8.2% of its
weight moved; each built range holds 96.6-98.5% of today's), under NEAR_DIST. Priced as
solver/scripts/bench_mw_formats.py prices a borrowed spot (today's ranges solved on the library's game until settled,
the stored mixes at the stored decisions priced by that solve's EVs): see docs/ACCURACY.md section 28.

The worker imports this module at start (scripts/pyodide/worker-edits.mjs); solver/ is untouched.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from gto import advisor as A
from gto import flop_library as fl
from gto import mw_library as ML

from engine import mw_built

# today's three ranges' distances to the built ones (flop_approx.range_dist, 0-2 each) sum to at most this: the four
# spots moved 0.142-0.165. Upstream borrows another table's pot at up to 0.5 (MW_BORROW_DIST), priced there at
# 0.015-0.046% of the pot given up up to 0.43; a spot whose ranges moved past 0.25 is left to the live solve until
# it's rebuilt.
NEAR_DIST = 0.25
NEAR_COVER = 0.9      # each of today's ranges' weight the built range holds at least (as MW_BORROW_COVER)

_NOW: dict = {}       # spot id -> today's setup of its line (spot_setup), or None
_BUILT: dict = {}     # spot id -> the built setup, or None


def built_setup(sp: dict) -> Optional[dict]:
    """A spot's setup as it was built (engine/mw_built.py): {seats, ranges, pot, stack, built}, or None where the file
    doesn't hold it or holds other fingerprints, pot or stack than the index's (another build)."""
    if sp["id"] not in _BUILT:
        b = mw_built.SPOTS.get(sp["id"])
        ok = b is not None and list(b["fp"]) == list(sp["fp"]) and \
            round(float(b["pot"]), 2) == round(float(sp["pot"]), 2) and \
            round(float(b["stack"]), 2) == round(float(sp["stack"]), 2) and \
            (not sp.get("seats") or list(sp["seats"]) == list(b["seats"]))
        _BUILT[sp["id"]] = {"seats": list(b["seats"]), "ranges": mw_built.ranges(sp["id"]), "pot": b["pot"],
                            "stack": b["stack"], "built": True} if ok else None
    return _BUILT[sp["id"]]


def now_setup(sp: dict) -> Optional[dict]:
    """The spot's line set up with today's charts (mw_library.spot_setup at 6-max 100bb), or None."""
    if sp["id"] not in _NOW:
        try:
            _NOW[sp["id"]] = ML.spot_setup(sp["line"])
        except Exception:   # noqa: BLE001 - (a line today's code can't replay: nothing to match)
            _NOW[sp["id"]] = None
    return _NOW[sp["id"]]


def stale(sp: dict) -> bool:
    """Today's charts no longer give the spot's published fingerprints (upstream's own check)."""
    return _spot_ranges.mw_near_upstream(sp) is None


def near_built(lib, ranges, pot: float, stack: float) -> Optional[dict]:
    """The stale spot these ranges are today's version of, near enough to serve (NEAR_DIST, NEAR_COVER), as
    MWLibrary.borrow answers ({"spot", "cover", "dist"}) plus "built"; None where none is."""
    from gto.flop_approx import range_cover, range_dist
    if len(ranges) != 3:
        return None
    fps = tuple(fl.range_fp(r) for r in ranges)
    key = ("built", fps, round(float(pot), 2), round(float(stack), 2))
    if key not in lib._borrow:
        best = None
        for sp in lib.index().get("spots", []):
            if round(float(sp["pot"]), 2) != key[2] or round(float(sp["stack"]), 2) != key[3] or not stale(sp):
                continue
            b, now = built_setup(sp), now_setup(sp)
            if b is None or now is None or now["seats"] != b["seats"] or \
                    tuple(fl.range_fp(r) for r in now["ranges"]) != fps:
                continue
            cover = tuple(range_cover(np.asarray(x), y) for x, y in zip(ranges, b["ranges"]))
            dist = tuple(range_dist(np.asarray(x), y) for x, y in zip(ranges, b["ranges"]))
            if min(cover) >= NEAR_COVER and sum(dist) <= NEAR_DIST:
                best = (sp["id"], cover, dist, list(b["seats"]))
        lib._borrow[key] = best
    got = lib._borrow[key]
    sp = got and next((x for x in lib.index().get("spots", []) if x["id"] == got[0]), None)
    if not sp:
        return None
    return {"spot": sp, "cover": got[1], "dist": got[2],
            "built": {"commit": mw_built.COMMIT, "date": mw_built.DATE, "seats": got[3]}}


def built_text(b: dict) -> str:
    """How a spot served as built differs from this pot, in words."""
    seats = b["built"]["seats"]
    moved = [(s, d / 2.0 * 100.0) for s, d in zip(seats, b["dist"]) if d > 1e-9]
    same = [s for s, d in zip(seats, b["dist"]) if d <= 1e-9]
    if not moved:
        diff = "the ranges are the same"
    else:
        diff = " and ".join(f"{s}'s range differs from this pot's by {m:.1f}% of its weight" for s, m in moved)
        if same:
            diff += f"; {' and '.join(same)}'s {'is' if len(same) == 1 else 'are'} the same"
    return f"this spot as built on the charts of {b['built']['date']}, which have changed since: {diff}"


# ----------------------------------------------------------------------------- the wraps (each reload-safe)
def _wrap_spot_ranges(upstream):
    def _spot_ranges(sp):
        st = upstream(sp)
        return st if st is not None else built_setup(sp)
    _spot_ranges.mw_near_upstream = upstream
    return _spot_ranges


def _wrap_pick(upstream):
    def _pick(self, ranges, pot, stack, players):
        spot, b = upstream(self, ranges, pot, stack, players)
        if spot is not None or not players:
            return spot, b
        n = near_built(self, ranges, pot, stack)
        return (n["spot"], n) if n else (None, None)
    _pick.mw_near_upstream = upstream
    return _pick


def _wrap_mark(upstream):
    def _mark(sol, b):
        if sol is None or not b or not b.get("built"):
            return upstream(sol, b)
        sol.borrowed = {"spot": b["spot"]["id"], "cover": [round(float(c), 4) for c in b["cover"]],
                        "dist": [round(float(d), 4) for d in b["dist"]], "built": dict(b["built"])}
        return sol      # (the library's own game, 6-max 100bb: no "6-max" before its label)
    _mark.mw_near_upstream = upstream
    return _mark


def _wrap_text(upstream):
    def borrowed_text(self):
        b = self.borrowed or {}
        return built_text(b) if b.get("built") else upstream(self)
    borrowed_text.mw_near_upstream = upstream
    return borrowed_text


def _wrap_lib_solution(upstream):
    """Advisor._mw_library_solution, its answer kept on the advisor (_mw_lib_last) for _mw_walk's note below."""
    def _mw_library_solution(self, *args, **kwargs):
        sol = upstream(self, *args, **kwargs)
        self._mw_lib_last = sol
        return sol
    _mw_library_solution.mw_near_upstream = upstream
    return _mw_library_solution


LIB_SRC = "through the precomputed 3-way solve ("


def _wrap_walk(upstream):
    """Advisor._mw_walk: a street narrowed through a spot served as built says so in its note ("...through the
    precomputed 3-way solve of this spot as built on the charts of <date> (N iterations, ...)"; provenance.ts's
    MW_PARTIAL_NOTE still reads it)."""
    def _mw_walk(self, ranges, before, board, st, stk, hero, hole, streets, notes, current=False):
        self._mw_lib_last = None
        n = len(notes)
        ok = upstream(self, ranges, before, board, st, stk, hero, hole, streets, notes, current)
        sol = getattr(self, "_mw_lib_last", None)
        b = getattr(sol, "borrowed", None) or {}
        if ok and b.get("built") and len(notes) > n and LIB_SRC in notes[-1]:
            notes[-1] = notes[-1].replace(
                LIB_SRC, f"through the precomputed 3-way solve of this spot as built on the charts of "
                         f"{b['built']['date']} (", 1)
        self._mw_lib_last = None
        return ok
    _mw_walk.mw_near_upstream = upstream
    return _mw_walk


_spot_ranges = _wrap_spot_ranges(getattr(ML._spot_ranges, "mw_near_upstream", ML._spot_ranges))
_pick = _wrap_pick(getattr(ML.MWLibrary._pick, "mw_near_upstream", ML.MWLibrary._pick))
_mark = _wrap_mark(getattr(ML.MWLibrary._mark, "mw_near_upstream", ML.MWLibrary._mark))
borrowed_text = _wrap_text(getattr(ML.LibraryMWSolution.borrowed_text, "mw_near_upstream",
                                   ML.LibraryMWSolution.borrowed_text))
_lib_solution = _wrap_lib_solution(getattr(A.Advisor._mw_library_solution, "mw_near_upstream",
                                           A.Advisor._mw_library_solution))
_walk = _wrap_walk(getattr(A.Advisor._mw_walk, "mw_near_upstream", A.Advisor._mw_walk))


def install() -> None:
    """Wraps mw_library and the Advisor (idempotent)."""
    ML._spot_ranges = _spot_ranges
    ML.MWLibrary._pick = _pick
    ML.MWLibrary._mark = staticmethod(_mark)
    ML.LibraryMWSolution.borrowed_text = borrowed_text
    A.Advisor._mw_library_solution = _lib_solution
    A.Advisor._mw_walk = _walk


install()
