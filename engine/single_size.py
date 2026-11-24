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

The ante and straddle games (build_single_size.py --set games, W13 of docs/GAP_PLAN.md): a spot with `game` (6-max 100bb
with a 0.17bb ante a seat, or a 2bb straddle from UTG) was built on the ranges entering the flop from Lizard's stored
preflop solve of that game (engine/pf_solve.py; the index's `pf_ranges`, by class), not the charts. A single-size
request in that game on that exact line plays those ranges (game_spot, then A.preflop_ranges swapped for the request
only, as engine/bunching.py does), so the entry's fingerprint matches and is read; the answer's `single_size` names the
game and the ranges' source, and a note says the ranges aren't the charts'. Any other ante, a straddle with an ante,
stacks or ranges of the hand's own: no game spot, the charts play as before.

The 3-way set (build_single_size.py --set mw3, W15): rows with `players: 3` hold 3-way pots of 6-max 100bb on one bet size
a node (one fixed flop size, 33%, tied within noise with 25 and 50% on a sample: the engine's automatic sizing is heads-up only), solved by the
3-player CFR (gto/multiway_solver.py) in the 3-way library's entry format (the flop's first decisions, every hand). A
single-size request whose hand plays one of those lines (or an alias) at 6-max 100bb with no setup of its own (mw_spot)
reads them through SingleSizeMWLibrary in place of the 3-way library: the request's custom sizes are taken off (upstream
reads a 3-way library only without them) and put where the 3-way solves read their tree instead (mw_street_config: the
flop's one size, the turn and river 50%), so a flop it doesn't hold, a line behind a bet and a later street are solved
live on the same one-size tree; a street that goes heads-up bets the turn's and river's one size (the request's). The
answer's `single_size` says `players: 3`, the tree, and the stored solve's iterations and mean best-response gain (with
three players not a distance from equilibrium: three-player CFR has no Nash guarantee); the precomputed solve's note
names the one-size tree.

The worker imports this module at start (scripts/pyodide/worker-edits.mjs, declared in solver/UPSTREAM.json); it wraps
Advisor._advise_at, and a request without "single_size" is answered exactly as before. solver/ is untouched.
"""
from __future__ import annotations

import json
from typing import Optional

import numpy as np

from gto import advisor as A
from gto import flop_library as fl
from gto import mw_library as ML
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
                if int(s.get("players") or 2) != 2:
                    continue   # (a 3-way row: SingleSizeMWLibrary's)
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


def read_index(fetch) -> dict:
    """ss_index.json through `fetch`, {"spots": []} where there is none or it isn't this format."""
    try:
        raw = fetch(INDEX)
    except Exception:   # noqa: BLE001  (no file: no single-size library)
        raw = None
    idx = {}
    if raw:
        try:
            idx = json.loads(raw.decode() if isinstance(raw, (bytes, bytearray)) else raw)
        except ValueError:
            idx = {}
    if not isinstance(idx, dict) or idx.get("format") != fl.FORMAT or idx.get("ss_format") != SS_FORMAT:
        idx = {"spots": []}
    return idx


class SingleSizeMWLibrary(ML.MWLibrary):
    """The 3-way set: an MWLibrary over ss_index.json's rows with `players: 3`, each flop's entry checked against that
    flop's own tree (the row's `flop_tree` -> `trees`), the spot found by its three ranges' fingerprints, pot and stack
    exactly. Nothing is borrowed for another table, read off other flops or stood in for another pot: a pot or flop it
    doesn't hold is solved live on the same one-size tree."""

    def __init__(self, fetch):
        super().__init__(fetch)
        self.read: list = []   # the entries read during a request ({spot, flop, pct, iters, expl})

    def index(self) -> dict:
        if self._index is None:
            spots = [s for s in read_index(self._fetch).get("spots", []) if int(s.get("players") or 2) == 3]
            # (upstream checks the index's tree for its model version and rake; each entry is checked by its own tree)
            self._index = {"format": ML.FORMAT, "tree": {"version": ML.MODEL_VERSION}, "spots": spots}
            for s in spots:
                self._spots[(tuple(s["fp"]), round(float(s["pot"]), 2), round(float(s["stack"]), 2))] = s
        return self._index

    def entry(self, spot: dict, name: str):
        tree = (spot.get("trees") or {}).get((spot.get("flop_tree") or {}).get(name))
        if not isinstance(tree, dict):
            return None
        idx = self.index()
        saved = idx.get("tree")
        idx["tree"] = tree
        try:
            return super().entry(spot, name)
        finally:
            idx["tree"] = saved

    def _pick(self, ranges, pot, stack, players):
        return self.spot([fl.range_fp(r) for r in ranges], pot, stack), None

    def borrow(self, *a, **k):
        return None

    def stand_in(self, *a, **k):
        return None

    def near(self, *a, **k):
        return None

    def solution(self, ranges, board, pot, stack, rake=False, players=None):
        got = super().solution(ranges, board, pot, stack, rake=rake, players=players)
        if got is not None:
            spot = self.spot([fl.range_fp(r) for r in ranges], pot, stack) or {}
            name = cards_str(fl.canonical(board)[0])
            rec = {"spot": spot.get("id"), "flop": name, "pct": (spot.get("sizes") or {}).get(name),
                   "iters": int(got.iters), "expl": round(float(got.exploitability()), 4)}
            self.read.append(rec)
            got.ss_read = rec   # (a later street that walks this solve from the hand's _mw_lines names it: _cached_read)
        return got


# The 3-way set's later streets: the 3-way library's turn and river bet (advisor.MW_FLOP_BETS), one size
MW_LATER = 0.5
MW_WORDS = "3-way single-size tree"


def mw_spot(idx: dict, positions, stack: float, state: dict, preflop) -> Optional[dict]:
    """The index's 3-way row this request's hand plays: 6-max, every seat at 100bb, no ante, straddle or rake, no ranges
    of its own (stacks, ranges, bunching, the pool's opponents, locks), and its preflop line the row's or one of its
    aliases'; else None."""
    if len(positions) != 6 or abs(float(stack) - 100.0) > GAME_TOL or float(getattr(positions, "ante", 0.0) or 0.0) \
            or getattr(positions, "straddle", False) or getattr(positions, "rake", None):
        return None
    if state.get("stacks") or state.get("ranges") or state.get("bunching") not in (None, False, "", "off", 0) or \
            state.get("opponents") == "pool" or state.get("locks"):
        return None
    line = ",".join(_token(a) for a in preflop)
    for s in idx.get("spots", []):
        if int(s.get("players") or 2) != 3:
            continue
        if s.get("line") == line or any(isinstance(x, dict) and x.get("line") == line for x in s.get("aliases") or []):
            return s
    return None


def _cached_read(lines: dict, board, hole, streets: dict, sid: str) -> Optional[dict]:
    """The 3-way set's entry this hand's flop was read from earlier in the hand, kept in the hand's 3-way lines of the
    one-size tree (Advisor._mw_lines, which upstream's _mw_walk reads a later street's flop from instead of asking the
    library again): its read record (SingleSizeMWLibrary.solution's), or None."""
    if not board or len(board) < 3:
        return None
    at = A._mw_line(list(board[:3]), None, list(hole or ()), {}, streets, "flop", 0)
    for key, v in reversed(list(lines.items())):
        rec = getattr(v[0], "ss_read", None) if isinstance(v, tuple) and v else None
        if rec and rec.get("spot") == sid and key[0] == at[0] and key[2] == at[2] and key[4] == at[4] and not key[5]:
            return rec
    return None


def _drop_gone(dicts, before: dict, cache: dict) -> None:
    """Upstream's cache trim (Advisor._keep) drops an evicted solve from the _mw_lines in place at the time only: the
    hand's lines of the tree a request didn't play (upstream's, or the 3-way set's) drop the solves evicted during it
    (`before`: the solve cache's solves by id as it began, held so their ids stay theirs)."""
    kept = {id(v) for v in cache.values()}
    gone = {i for i in before if i not in kept}
    if not gone:
        return
    for d in dicts:
        for k in [k for k, v in d.items() if isinstance(v, tuple) and v and id(v[0]) in gone]:
            del d[k]


def _one_size_mw(config: dict, frac: float) -> dict:
    """The advisor's 3-way solves' street configs (mw_street_config) with one bet size: the flop's `frac`, the turn and
    river MW_LATER (the flop root's tree is then the stored entries')."""
    bets = {"flop": [float(frac)], "turn": MW_LATER, "river": MW_LATER}
    out = {k: dict(v, bet=dict(bets)) for k, v in config.items()}
    out.setdefault("flop", {"bet": dict(bets)})
    out.setdefault("turn", {"bet": dict(bets)})
    out["turn"]["bet"]["flop"] = float(frac)
    return out


def _later_sizes(self, sizes: dict) -> None:
    """The request's turn and river sizes on the heads-up config, as upstream's _advise_at puts a request's sizes there
    (a street of the 3-way hand that goes heads-up bets them): upstream won't, as the request's sizes are taken off."""
    later = {k: list(v) for k, v in sizes.items() if k in ("turn", "river")}
    if not later:
        return
    self.root_sizes = {st: dict(d) for st, d in self.root_sizes.items() if st not in later}
    self.spr_sizes = {st: (m, {k: v for k, v in d.items() if k not in later})
                      for st, (m, d) in self.spr_sizes.items() if st not in later}
    self.cfg = self.cfg.copy()
    for k, v in later.items():
        self.cfg.bet_sizes[k] = v


LIB_NOTE = "three-player CFR from the flop's start, bets of 33 and 75% pot"
# How the fixed flop size was chosen, as ACCURACY 38.1 measured it (web/src/solver/singleSize.ts MW_CHOICE says the same):
# not the best of the sample, a tie within noise with 25 and 50%, 25% a little ahead
MW_CHOICE = ("one fixed size for every flop, as the automatic sizing is heads-up only; on a 24-pair sample 25, 33 and 50% "
             "gave up the same within noise (25% least)")


def mw_words(pct, conv: Optional[dict] = None) -> str:
    """The 3-way set's tree in words, as the note says it (web/src/solver/singleSize.ts says the same for provenance);
    `conv`: the stored entry's iterations and mean best-response gain, where the answer stands on one."""
    c = conv or {}
    tail = ""
    if c.get("iters") is not None and c.get("expl") is not None:
        tail = (f"; solved by three-player CFR to a mean best-response gain of {float(c['expl']):.2f}% of the pot after "
                f"{int(c['iters'])} iterations")
    return (f"{MW_WORDS}: one bet size a node, the flop's {float(pct):g}% ({MW_CHOICE}), turn and river bets "
            f"{MW_LATER * 100:g}%, one raise size, "
            f"all-in at 1.5 pots or less{tail}; three-player CFR has no Nash guarantee, so that gain is not a distance "
            f"from equilibrium")


def _mw_notes(notes: list, pct) -> list:
    """The precomputed 3-way solve's note with the one-size tree in place of the 3-way library's two flop sizes."""
    return [n.replace(LIB_NOTE, f"three-player CFR from the flop's start on the {MW_WORDS}, one bet of {float(pct):g}% pot")
            .replace("the turn and river bet on too, by", f"the turn and river bet {MW_LATER * 100:g}% too, by")
            if isinstance(n, str) and LIB_NOTE in n else n for n in notes]


# ----------------------------------------------------------------------------- the ante and straddle games
# The index's game spots (build_single_size.py --set games) are lines of 6-max 100bb with a 1bb big-blind ante or a 2bb
# straddle, their ranges entering the flop Lizard's stored preflop solve of that game (each row's `pf` and `pf_ranges`),
# not the charts the advisor plays them by. A single-size request in that game on that line plays the row's ranges for
# its two players (the stored entry is then found by them, as any library flop; a flop it doesn't hold is solved live on
# them), and the answer says so (`single_size.game`, `single_size.ranges`, a note).
GAME_TOL = 1e-9


def _token(a: dict) -> str:
    """A preflop action as the index's lines write it (web/src/library/flops.ts lineToken)."""
    act = a.get("action")
    if act in ("fold", "call", "check", "all-in"):
        return f"{a['pos']}:{ {'fold': 'f', 'call': 'c', 'check': 'x', 'all-in': 'a'}[act]}"
    return f"{a['pos']}:r{round(float(a.get('to') or 0.0), 2):g}"


def game_spot(idx: dict, positions, stack: float, state: dict, preflop) -> Optional[dict]:
    """The index's game spot this request's hand plays: the table's size, stack, ante and straddle the spot's game's,
    every seat at that stack, and its preflop line the spot's; else None. Never for a request whose ranges entering the
    flop are its own (stacks, ranges, bunching, the pool's opponents, locks): engine/bunching.py's wrap, for one, sits
    inside this module's and puts the charts' ranges back, so the answer would play them while naming the solve's."""
    ante = float(getattr(positions, "ante", 0.0) or 0.0)
    straddle = bool(getattr(positions, "straddle", False))
    if not ante and not straddle:
        return None
    if state.get("stacks") or state.get("ranges") or state.get("bunching") not in (None, False, "", "off", 0) or \
            state.get("opponents") == "pool" or state.get("locks"):   # (bunching: engine/bunching.py parse's "off")
        return None
    line = ",".join(_token(a) for a in preflop)
    for s in idx.get("spots", []):
        g = s.get("game")
        if not isinstance(g, dict) or s.get("line") != line or not s.get("pf_ranges"):
            continue
        if int(g.get("players", 0)) == len(positions) and abs(float(g.get("stack", 0)) - stack) < GAME_TOL and \
                abs(float(g.get("ante", 0.0)) - ante) < GAME_TOL and bool(g.get("straddle")) == straddle:
            return s
    return None


def class_range(w) -> np.ndarray:
    """169 class weights x 10000 (gto.pf_classes.CLASSES order) -> the 1326-combo range, as the build made it
    (scripts/library/build_single_size.py class_range), so the fingerprints agree."""
    from gto.pf_classes import CLASS_OF
    return (np.asarray(w, dtype=np.float64) / 10000.0)[CLASS_OF]


def ranges_words(spot: dict) -> str:
    pf = spot.get("pf") or {}
    return (f"ranges entering the flop from Lizard's stored preflop solve of this game ({pf.get('words', 'its forced bets')}; "
            f"{pf.get('model', 'class-level model')}, the charts' raise sizes; preflop is approximate), not the charts")


def _with_game_ranges(upstream, line: list, ranges: dict):
    """preflop_ranges with `ranges` ({seat: range}) for those seats after exactly `line`."""
    def played(actions, positions, stack, pool_except=None, locks=None):
        out = upstream(actions, positions, stack, pool_except, locks)
        if len(actions) != len(line) or any(x != y for x, y in zip(actions, line)):
            return out
        new = A.PreflopRanges({**out, **{p: r.copy() for p, r in ranges.items() if p in out}})
        new.rebuilt = list(getattr(out, "rebuilt", []))
        return new
    played.upstream = upstream
    return played


_LIBS: dict = {}


def library_for(lib) -> Optional[SingleSizeLibrary]:
    """The single-size library beside a FlopLibrary (the same files, through its fetch), kept per library."""
    if lib is None or not hasattr(lib, "_fetch"):
        return None
    got = _LIBS.get(id(lib))
    if got is None or got[0] is not lib:
        got = (lib, SingleSizeLibrary(lib._fetch), SingleSizeMWLibrary(lib._fetch))
        _LIBS[id(lib)] = got
    return got[1]


def mw_library_for(lib) -> Optional[SingleSizeMWLibrary]:
    """The 3-way set beside a FlopLibrary (the same ss_index.json), kept per library."""
    return _LIBS[id(lib)][2] if library_for(lib) is not None else None


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
        # the hand's 3-way lines are kept per tree: upstream's (the 3-way library's and its live solves') in
        # _mw_lines, the 3-way set's per flop size in _ss_mw_lines, swapped in for its requests below, so a later street
        # walks the flop solve of the tree it plays (switching Library and Single size mid-hand never crosses them)
        sets = self.__dict__.get("_ss_mw_lines") or {}
        before = {id(v): v for v in self._mw_cache.values()} if sets else None
        if not asked:
            try:
                return upstream(self, state, *args, **kwargs)
            finally:
                if before is not None:
                    _drop_gone(list(sets.values()), before, self._mw_cache)
        ss = library_for(self.library)
        mws = mw_library_for(self.library)
        saved = self.library, self.mw_library, A.preflop_ranges, self.mw_street_config, self.cfg, self.root_sizes, \
            self.spr_sizes
        # a game spot (an ante or a straddle): its two players' ranges are the preflop solve's the spot was built on
        gspot = mspot = None
        mpct = None
        if ss is not None and len(args) >= 8 and isinstance(args[7], dict):
            positions, stack, streets = args[5], args[6], args[7]
            gspot = game_spot(ss.index(), positions, float(stack), state, streets.get("preflop") or [])
            if gspot is not None:
                A.preflop_ranges = _with_game_ranges(A.preflop_ranges, list(streets["preflop"]),
                                                     {p: class_range(w) for p, w in zip(gspot["seats"], gspot["pf_ranges"])})
            elif len(args) >= 9 and isinstance(args[8], dict):
                # a 3-way line of the 3-way set: its one-size tree for the 3-way solves, the set in place of the 3-way
                # library (read only without custom sizes, so the request's go to the 3-way and heads-up configs)
                mspot = mw_spot(ss.index(), positions, float(stack), state, streets.get("preflop") or [])
        if mspot is not None:
            sizes = dict(args[8])
            held = sorted(set((mspot.get("sizes") or {}).values()))
            flop = sizes.get("flop") or ([held[0] / 100.0] if held else None)
            if flop:
                mpct = round(float(flop[0]) * 100, 1)
                args = (*args[:8], {}, *args[9:])
                self.mw_street_config = _one_size_mw(self.mw_street_config, float(flop[0]))
                _later_sizes(self, {"turn": sizes.get("turn") or [MW_LATER], "river": sizes.get("river") or [MW_LATER]})
            else:
                mspot = None
        # (a single-size request at 3 players off the 3-way set: the 3-way library holds several-size solves, so it's
        # solved live)
        self.library, self.mw_library = ss, (mws if mspot is not None else None)
        if ss is not None:
            ss.read = []
        if mws is not None:
            mws.read = []
        main = self._mw_lines
        lines = self.__dict__.setdefault("_ss_mw_lines", {}).setdefault(("mw3", mpct), {}) if mspot is not None \
            else None
        if lines is not None:
            before = before if before is not None else {id(v): v for v in self._mw_cache.values()}
            self._mw_lines = lines
        try:
            res = upstream(self, state, *args, **kwargs)
        finally:
            self.library, self.mw_library, A.preflop_ranges, self.mw_street_config, self.cfg, self.root_sizes, \
                self.spr_sizes = saved
            self._mw_lines = main
            if before is not None:
                _drop_gone([d for d in [main, *self._ss_mw_lines.values()] if d is not lines] if lines is not None
                           else list(self._ss_mw_lines.values()), before, self._mw_cache)
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
            if mspot is not None:
                mread = mws.read[-1] if mws is not None and mws.read else None
                if mread is None and lines is not None:
                    # (a later street: upstream's walk read the flop's stored solve from the hand's lines, not the set)
                    mread = _cached_read(lines, args[4], args[3], args[7], mspot["id"])
                blk = res["single_size"]
                blk["stored"] = bool(spot and str(spot) == mspot["id"])
                blk["players"] = 3
                blk["sizes"] = {"flop": [mpct], "turn": [MW_LATER * 100], "river": [MW_LATER * 100]}
                blk["tree"] = {"words": MW_WORDS, "flop_pct": mpct, "later_pct": MW_LATER * 100, "choice": "fixed",
                               "raise": "one size", "allin_spr": 1.5}
                if mread:
                    blk["flop"] = {k: mread[k] for k in ("spot", "flop", "pct")}
                    blk["conv"] = {"iters": mread["iters"], "expl": mread["expl"]}
                elif not blk["stored"]:
                    blk.pop("flop", None)
                if isinstance(mspot.get("conv"), dict):
                    blk["spot_conv"] = dict(mspot["conv"])
                blk["nash"] = False
                blk["spot"] = mspot["id"] if blk["stored"] else blk.get("spot")
                if not blk.get("spot"):
                    blk.pop("spot", None)
                if isinstance(res.get("notes"), list):
                    res["notes"] = _mw_notes(res["notes"], mpct)
                res.setdefault("notes", []).insert(0, "single size: " + mw_words(mpct, blk.get("conv")) + (
                    "" if blk["stored"] or mread else "; this flop isn't in the 3-way single-size set, solved live on "
                                                      "the same tree"))
            if gspot is not None:
                pf = gspot.get("pf") or {}
                res["single_size"]["game"] = dict(gspot["game"], spot=gspot["id"])
                res["single_size"]["ranges"] = {"source": "preflop solve", "key": pf.get("key"), "sha1": pf.get("sha1"),
                                                "words": pf.get("words"), "model": pf.get("model")}
                res.setdefault("notes", []).insert(0, f"single size: {ranges_words(gspot)}")
        return res

    _advise_at.single_size_upstream = upstream
    return _advise_at


_advise_at = _wrapping(_upstream)


def install() -> None:
    """Wraps Advisor._advise_at (idempotent)."""
    A.Advisor._advise_at = _advise_at


install()
