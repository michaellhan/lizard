"""Bigger heads-up trees on request: more raises a street and a tree-size cap per device.

Upstream's heads-up solves play at most `Config.max_raises` raises a street (2: bet, raise, re-raise, then call, fold
or all-in) and cut any new tree past `Advisor.max_cells` (24M cells, gto/advisor.py MAX_CELLS) by the TRIMS levels
until it fits. A request can now ask for:

- "raises": the most sized bets and raises a street, 1 to RAISES_MAX (Config.max_raises: past it a player facing a bet
  may only fold, call or go all-in). Upstream's 2 is a bet and a raise, with the re-raise all-in only; 3 adds a sized
  re-raise (a 3-bet), 4 a sized 4-bet, as deep GTO Wizard trees have. It holds for every heads-up solve the request
  runs (this street's and the earlier streets' narrowing solves). The tree grows with it (on a turn with five bet and
  three raise sizes over two wide ranges: 7.0M cells at 1, 39M at 2, 55M at 3, 56M at 4), so a big menu with a high
  cap is cut to the device's cap like any other tree, and the answer's note says how (Advisor._trim_note).
- "max_cells": the most cells a new tree may have, clamped to CAPS for where it runs: the browser's worker has a
  2 GB heap that also holds the solves kept for reuse (worker.js cache_mb 700), so it goes no higher than
  BROWSER_MAX; natively NATIVE_MAX. A turn's cell costs 33 bytes at a solve's peak, natively, on top of
  about 47 MB (scripts/benchmarks/tree_depth.py: 801 MB at 24M, 1,052 MB at 32M); a flop's about 51, but no flop menu
  the page allows builds past 19M. Pyodide's heap ran ~10% under native (advisor.py, above MAX_CELLS).

Neither changes the multiway solves, preflop, or a flop library answer (the library's trees are stored with their own
raise cap, flop_library.tree_key, so a different cap is solved live). The answer says what it was asked under
(`tree`), so the page can label it.

The worker imports this module at start (scripts/pyodide/worker-edits.mjs, declared in solver/UPSTREAM.json); it
wraps Advisor._advise_at, and leaves a request without either key exactly as upstream answers it. solver/ is
untouched.
"""
from __future__ import annotations

import sys
from typing import Optional

from gto import advisor as A

RAISES_MIN, RAISES_MAX = 1, 4
CELLS_MIN = 2_000_000
BROWSER_MAX = 32_000_000
NATIVE_MAX = 64_000_000
BYTES_PER_CELL = 33   # a turn's cell at a solve's peak, natively (scripts/benchmarks/tree_depth.py memory, 2026-11-11): the
                      # trees past MAX_CELLS are turns, a flop's tree staying under it


def cells_max() -> int:
    """The largest tree a request may ask for where this runs."""
    return BROWSER_MAX if sys.platform == "emscripten" else NATIVE_MAX


def parse(state: dict) -> tuple:
    """(raises or None, max_cells or None) from a request, or ValueError with words for the page."""
    raises = state.get("raises")
    cap = state.get("max_cells")
    if raises is not None:
        whole = (isinstance(raises, int) and not isinstance(raises, bool)) or \
            (isinstance(raises, float) and raises.is_integer()) or (isinstance(raises, str) and raises.strip().isdigit())
        if not whole or not RAISES_MIN <= int(raises) <= RAISES_MAX:
            raise ValueError(f"raises must be a whole number from {RAISES_MIN} to {RAISES_MAX}, got {raises!r}")
        raises = int(raises)
    if cap is not None:
        try:
            c = int(float(cap))
        except (TypeError, ValueError):
            raise ValueError(f"max_cells must be a number of cells, got {cap!r}")
        if c <= 0:
            raise ValueError(f"max_cells must be a number of cells, got {cap!r}")
        cap = max(CELLS_MIN, min(cells_max(), c))
    return raises, cap


def _forget_cut(adv, cap: int) -> int:
    """Drops the cached heads-up solves whose trees were cut under a smaller cap than `cap` (Advisor._solve_cached:
    sol.trimmed = (level, full, cap)): their cache key leaves the cap out, so a device cap raised since would otherwise
    keep answering from the smaller tree. How many went."""
    gone = 0
    for key, sol in list(adv._cache.items()):
        t = getattr(sol, "trimmed", None)
        if t and t[2] is not None and t[2] < cap:
            del adv._cache[key]
            adv._held.pop((adv, "_cache", key), None)
            for s in [s for s, v in adv._by_spot.items() if v is sol]:
                del adv._by_spot[s]
            gone += 1
    return gone


def _make_room(adv, cap: int) -> int:
    """Before a solve under a cap past upstream's MAX_CELLS in the browser, the least recently used kept solves go
    until what's kept and the bigger tree's extra memory fit where the kept solves alone did (cache_mb): the worker's
    heap is 2 GB, and a kept solve only goes when a new one is kept, after it's built (Advisor._keep). How many went."""
    if sys.platform != "emscripten" or cap <= A.MAX_CELLS:
        return 0
    room = adv.cache_mb * 2 ** 20 - (cap - A.MAX_CELLS) * BYTES_PER_CELL
    gone = 0
    while adv._held and sum(adv._held.values()) > room:
        owner, store, key = next(iter(adv._held))
        del adv._held[(owner, store, key)]
        sol = getattr(owner, store).pop(key, None)
        for d, of in ((owner._by_spot, lambda v: v), (owner._mw_lines, lambda v: v[0])):
            for s in [s for s, v in d.items() if of(v) is sol]:
                del d[s]
        gone += 1
    return gone


_upstream = getattr(A.Advisor._advise_at, "upstream", A.Advisor._advise_at)   # (imported again: still upstream's)


def _wrapping(upstream):
    """Advisor._advise_at over `upstream`, held in this closure rather than a module global, so importing this module
    again (importlib.reload) over another module's wrap can't turn the chain into a loop."""
    def _advise_at(self, state, *args, **kwargs):
        try:
            raises, cap = parse(state)
        except ValueError as e:
            return {"error": str(e)}
        # (a cap higher than the last request's: the solves cut under that one are dropped, so this one solves the bigger tree)
        now = cap if cap is not None else self.max_cells
        if now and now > getattr(self, "_tree_cap", now):
            _forget_cut(self, now)
        self._tree_cap = now
        if raises is None and cap is None:
            return upstream(self, state, *args, **kwargs)
        saved = self.cfg, self.max_cells
        try:
            if raises is not None:
                self.cfg = self.cfg.copy()
                self.cfg.max_raises = raises
            if cap is not None:
                self.max_cells = cap
                _make_room(self, cap)
            res = upstream(self, state, *args, **kwargs)
        finally:
            self.cfg, self.max_cells = saved
        # (said only on a heads-up answer: a 3- or 4-way solve keeps its own menu and raise cap, multiway_solver.MWConfig)
        if isinstance(res, dict) and "error" not in res and not res.get("multiway"):
            res["tree"] = {**({"raises": raises} if raises is not None else {}),
                           **({"max_cells": cap} if cap is not None else {})}
        return res

    _advise_at.upstream = upstream
    return _advise_at


_advise_at = _wrapping(_upstream)


def install() -> None:
    """Wraps Advisor._advise_at (idempotent)."""
    A.Advisor._advise_at = _advise_at


install()
