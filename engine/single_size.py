"""The single-size library's reader: a request with "single_size" reads its flop from ss_index.json (Lizard's
single-size library, scripts/library/build_single_size.py) instead of the library's index.json.

The single-size library holds the heads-up 6-max 100bb lines on a set of representative flops, each flop solved with one
bet size at every flop node, the size chosen per flop by the solver's automatic sizing (docs/single-size-library.md).
So a spot's flops are solved on different trees (a 33% flop, a 75% one), which the advisor's FlopLibrary can't list in
one index: it keeps one tree per spot (FlopLibrary.tree), and keys spots by ranges, pot and stack, where the library
already holds the several-size spot of the same line. Hence the separate index, read here by SingleSizeLibrary: a
FlopLibrary whose spot trees are per flop (the index's `flop_tree` -> `trees`).

The page sends a single-size request with that flop's size as the request's own flop size ("sizes": {"flop": [pct],
"turn": [75], "river": [75]}: web/src/library/singleSize.ts), so the advisor's tree is the stored one and
FlopLibrary.solution's checks (the tree's sizes, the entry's tree hash, its ranges) pass as for any library flop; a
flop the single-size library doesn't hold is solved live on the same one-size tree, and later streets live at one size
(75%, the library model's), with the stored turn file read where the flop line has one.

The worker imports this module at start (scripts/pyodide/worker-edits.mjs, declared in solver/UPSTREAM.json); it wraps
Advisor._advise_at, and a request without "single_size" is answered exactly as before. solver/ is untouched.
"""
from __future__ import annotations

import json
from typing import Optional

from gto import advisor as A
from gto import flop_library as fl
from gto.cards import cards_str

INDEX = "ss_index.json"
SS_FORMAT = 1


class SingleSizeLibrary(fl.FlopLibrary):
    """FlopLibrary over ss_index.json: each flop of a spot has its own tree (the size chosen for it)."""

    def __init__(self, fetch):
        super().__init__(fetch)
        self._flop: Optional[str] = None   # (the flop solution() is reading: tree() has no flop argument)
        self.read: list = []   # the entries read during a request ({spot, flop, pct}): the flop of a turn's answer too

    def index(self) -> dict:
        if self._index is None:
            try:
                raw = self._fetch(INDEX)
            except Exception:   # noqa: BLE001  (no file: no single-size library)
                raw = None
            idx = {}
            if raw:
                try:
                    idx = json.loads(raw.decode() if isinstance(raw, (bytes, bytearray)) else raw)
                except ValueError:
                    idx = {}
            if idx.get("format") != fl.FORMAT or idx.get("ss_format") != SS_FORMAT:
                idx = {"spots": []}
            self._index = idx
            for s in idx.get("spots", []):
                self._spots[(s["fp"][0], s["fp"][1], round(float(s["pot"]), 2), round(float(s["stack"]), 2))] = s
        return self._index

    def entry_tree(self, spot: dict, name: str) -> dict:
        key = (spot.get("flop_tree") or {}).get(name)
        return (spot.get("trees") or {}).get(key) or {}

    def tree(self, spot: dict) -> dict:
        return self.entry_tree(spot, self._flop) if self._flop else {}

    def solution(self, full0, full1, board, r0, r1, pot, stack, cfg, borrow=None, need=(), unraked=False):
        if len(board) != 3:
            return None
        self._flop = cards_str(fl.canonical(board)[0])
        try:
            # (no borrowing another table's spot: the single-size library is 6-max 100bb only, read exactly or not)
            got = None if borrow else super().solution(full0, full1, board, r0, r1, pot, stack, cfg, need=need,
                                                       unraked=unraked)
        finally:
            flop, self._flop = self._flop, None
        if got is not None:
            spot = self.spot(fl.range_fp(full0), fl.range_fp(full1), pot, stack) or {}
            self.read.append({"spot": spot.get("id"), "flop": flop, "pct": (spot.get("sizes") or {}).get(flop)})
        return got


_LIBS: dict = {}


def library_for(lib) -> Optional[SingleSizeLibrary]:
    """The single-size library beside a FlopLibrary (the same files, through its fetch), kept per library."""
    if lib is None or not hasattr(lib, "_fetch"):
        return None
    got = _LIBS.get(id(lib))
    if got is None or got[0] is not lib:
        got = (lib, SingleSizeLibrary(lib._fetch))
        _LIBS[id(lib)] = got
    return got[1]


def parse(state: dict) -> bool:
    v = state.get("single_size")
    if v in (None, False):
        return False
    if v is not True:
        raise ValueError("single_size: true or absent")
    return True


_upstream = getattr(A.Advisor._advise_at, "single_size_upstream", A.Advisor._advise_at)


def _wrapping(upstream):
    """Advisor._advise_at over `upstream`, held in this closure (importing this module again can't loop the chain)."""
    def _advise_at(self, state, *args, **kwargs):
        try:
            asked = parse(state)
        except ValueError as e:
            return {"error": str(e)}
        if not asked:
            return upstream(self, state, *args, **kwargs)
        ss = library_for(self.library)
        saved = self.library, self.mw_library
        # (the 3-way library holds several-size solves: a single-size request at 3 players is solved live)
        self.library, self.mw_library = ss, None
        if ss is not None:
            ss.read = []
        try:
            res = upstream(self, state, *args, **kwargs)
        finally:
            self.library, self.mw_library = saved
        if isinstance(res, dict) and "error" not in res and "skipped" not in res:
            pre = res.get("precomputed") if isinstance(res.get("precomputed"), dict) else None
            spot = pre.get("spot") if pre else None
            read = ss.read[-1] if ss is not None and ss.read else None
            sizes = state.get("sizes") if isinstance(state.get("sizes"), dict) else None
            # stored: this answer is the single-size library's entry; flop: the flop it was read from (a later street's
            # answer stands on that flop's stored solve, solved live from there at the same one size)
            res["single_size"] = {"stored": bool(spot and str(spot).startswith("ss_")),
                                  **({"spot": spot} if spot else {}),
                                  **({"flop": read} if read else {}),
                                  **({"sizes": sizes} if sizes else {}),
                                  "library": ss is not None and bool(ss.index().get("spots"))}
        return res

    _advise_at.single_size_upstream = upstream
    return _advise_at


_advise_at = _wrapping(_upstream)


def install() -> None:
    """Wraps Advisor._advise_at (idempotent)."""
    A.Advisor._advise_at = _advise_at


install()
