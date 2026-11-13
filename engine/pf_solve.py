"""Study's preflop Solver source on Lizard's preflop solver: engine/pf_engine.py's game (each seat's own stack, 2 to 9
players) with engine/pf_model.py's calibrated flop values, browsed node by node as gto/pf_study.py browses upstream's.

The worker sends a Study request with "preflop_solve" here instead of to Advisor._study_pf (a build-time edit of the
worker, declared in solver/UPSTREAM.json); the answers keep pf_study's protocol ("pf_unsolved", "pf_progress",
"pf_export", a node), so the page's chunked solve, Stop and IndexedDB cache work unchanged, and each answer carries
"pf_model" (MODEL) so its provenance names the model.

The game: Spec (players, a stack per seat, ante, straddle, rake, the raise sizes). Up to 6 players the tree is
upstream's (pf_game.build: at most three see a single-raised flop, two a raised one); from 7 at most two see a flop and
nobody cold 4bets or cold-calls a 3bet (pf_engine's cold4=False), so 9-handed solves in the browser. Solving, stopping
and the node's answer are pf_study.Solve's (DCFR averaged at t^8, to 1.5 mbb/hand a seat or MAX_ITERS, the stall rule).

The stored games (engine/pf/<key>.bin, built by scripts/pf/build_stored.py): 2 to 6 players at the depths of
STORED_DEPTHS, equal stacks, no ante or straddle, no rake or 5% capped at 3bb, answered at once (the page lists them in
web/src/solver/pfStored.ts). Keys start with MODEL_TAG so neither the files, the page's cache nor a stamp can mix this
model's solves with upstream's class-level model's.
"""
from __future__ import annotations

import base64
import os
import sys
import time
import zlib
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from gto import pf_game as G
from gto import pf_study as PS

from . import pf_engine as E
from . import pf_model as M

MODEL = "calibrated class-level model"       # in every answer (pf_model) and the provenance label
MODEL_TAG = "lz1"                           # key prefix: a change to the model or its calibration bumps it
MAX_PLAYERS = 9
STACK_RANGE = (5.0, 250.0)                  # a seat's stack, bb (the deepest at least 10)
STORED_PLAYERS = (2, 3, 4, 5, 6)
STORED_DEPTHS = (20.0, 25.0, 30.0, 40.0, 50.0, 60.0, 80.0, 100.0, 125.0, 150.0, 200.0)
STORED_RAKES = (None, (0.05, 3.0))
# stored games solved past pf_study.STORED_ITERS (1,500) as they were over its 1.5 mbb target there; some level off just
# above it (a live solve stops those by its stall rule too); each header holds the mbb shown (engine/pf/lz1_built.jsonl)
STORED_ITERS_OF = {"lz1_4max_40bb": 3000, "lz1_5max_40bb": 3000, "lz1_5max_50bb": 3000, "lz1_6max_40bb": 3000,
                   "lz1_6max_150bb": 3000, "lz1_6max_200bb": 3000}
LIMITS_7UP = "7 or more players: at most two see a flop, nobody cold 4bets or cold-calls a 3bet"
# memory a solve needs (MB): measured natively, peak resident over building the game, iterating and the exploitability
# check: 6-max 11,010 nodes x 6 seats 749 MB, 9-handed 4,795 x 9 588 MB, 4-max 764 x 4 138 MB (a 78 MB interpreter in
# each); ~11.8 KB a node a seat (169 classes' float64 arrays) on top of the interpreter
MB_BASE, MB_PER_WORK = 90.0, 0.0118
# the most the worker builds in the browser, whatever the device (Pyodide's 32-bit heap is 4 GB at most, and a tab
# near 2 GB is at risk on most devices); the page sets a lower cap a device (web/src/features/study/pfCap.ts)
MAX_MB_BROWSER = 2048.0
OPTION_KEYS = ("open_limps", "opens", "flop3", "cold")
HERE = os.path.dirname(os.path.abspath(__file__))
STORE_DIR = os.path.join(HERE, "pf")


def params() -> M.Params:
    return M.load_params() or M.Params()


# ----------------------------------------------------------------------------- the game
@dataclass(frozen=True)
class Spec:
    players: int = 6
    stacks: Tuple[float, ...] = (100.0,)    # one value: every seat's; else one a seat, in positions() order
    ante: float = 0.0
    straddle: bool = False
    rake: Optional[Tuple[float, Optional[float]]] = None
    sizes: Tuple[Tuple[str, float], ...] = ()
    # the small blind may complete when it's folded to (heads-up it always may, as upstream's game; 3 or more players
    # only when asked, and never with a straddle, which pf_engine.build rules out)
    sb_limp: bool = False
    # the tree builder (2026-11-13): any seat may limp first in or over-limp (3 or more players, no straddle);
    # a position's own open size (bb); 3-way flops and cold calls of a 3bet / cold 4bets (None: the table size's
    # default, on up to 6 players and off from 7)
    open_limps: bool = False
    opens: Tuple[Tuple[str, float], ...] = ()
    flop3: Optional[bool] = None
    cold: Optional[bool] = None

    @property
    def three_way(self) -> bool:
        """Up to three see a single-raised (or limped) flop; else two."""
        return self.players <= 6 if self.flop3 is None else bool(self.flop3)

    @property
    def cold_calls(self) -> bool:
        """Cold calls of a 3bet and cold 4bets are in the tree."""
        return self.players <= 6 if self.cold is None else bool(self.cold)

    def tree_notes(self) -> List[str]:
        """What this game adds to the stored grid's, for the provenance line (each its own words): none for a game of
        the grid's kind."""
        out = []
        if not self.equal:
            out.append("each seat's own stack (side pots; not measured against a fuller solve)")
        if self.open_limps:
            out.append("limps from any seat (not measured against a fuller solve)")
        if self.opens:
            out.append("opens by position: " + ", ".join(f"{p} {v:g}bb" for p, v in self.opens))
        if self.sizes == CHART_SIZES:
            out.append("at the charts' raise sizes (a blind's 3bet to 4x the open, where the published solves' is "
                       "4.8x: measured against them only where the sizes are alike)")
        if self.players > 6 and (self.three_way or self.cold_calls):
            out.append("a 7-9 handed tree with " + " and ".join(
                x for x, on in (("3-way flops", self.three_way), ("cold calls", self.cold_calls)) if on))
        return out

    def limits(self) -> Optional[str]:
        """What the tree leaves out that the full one has, in words (None: nothing)."""
        out = []
        if not self.three_way:
            out.append("at most two see a flop")
        if not self.cold_calls:
            out.append("nobody cold 4bets or cold-calls a 3bet")
        if not out:
            return None
        if self.players > 6 and self.flop3 is None and self.cold is None:
            return LIMITS_7UP
        return ", ".join(out)

    @property
    def limps(self) -> bool:
        """The small blind's complete is in the tree: heads-up always, else when asked (no straddle)."""
        return self.players == 2 or (self.sb_limp and not self.straddle)

    @property
    def equal(self) -> bool:
        return len(set(self.stacks)) == 1

    @property
    def stack(self) -> float:
        """The deepest stack (pf_study.Solve reads spec.stack for the player's own stack only; node() fixes that)."""
        return max(self.stacks)

    def seat_stacks(self) -> List[float]:
        return list(self.stacks) * self.players if len(self.stacks) == 1 else list(self.stacks)

    @property
    def key(self) -> str:
        """File-name-safe: 'lz1_6max_100bb', 'lz1_6max_100bb_r5c3', 'lz1_6max_s100-35-220-60-15-100_a0.1'..."""
        k = f"{MODEL_TAG}_{self.players}max_"
        k += f"{self.stacks[0]:g}bb" if self.equal else "s" + "-".join(f"{s:g}" for s in self.seat_stacks())
        if self.ante:
            k += f"_a{self.ante:g}"
        if self.straddle:
            k += "_s"
        if self.rake:
            k += f"_r{self.rake[0] * 100:g}" + (f"c{self.rake[1]:g}" if self.rake[1] else "")
        for n, v in self.sizes:
            k += f"_{n}{v:g}"
        if self.limps and self.players > 2 and not self.open_limps:
            k += "_l"
        if self.open_limps:
            k += "_L"
        for p, v in self.opens:
            k += f"_o{p}{v:g}"
        if self.flop3 is not None and self.three_way != (self.players <= 6):
            k += "_f3" if self.three_way else "_f2"
        if self.cold is not None and self.cold_calls != (self.players <= 6):
            k += "_c1" if self.cold_calls else "_c0"
        return k

    def label(self) -> str:
        bits = [f"{self.players} players" if self.players > 2 else "heads-up"]
        if self.equal:
            bits.append(f"{self.stacks[0]:g}bb")
        else:
            bits.append("stacks " + ", ".join(f"{p} {s:g}" for p, s in zip(self.positions(), self.seat_stacks())) + "bb")
        if self.ante:
            bits.append(f"{self.ante:g}bb ante")
        if self.straddle:
            bits.append("straddle")
        bits.append(f"rake {self.rake[0] * 100:g}%" + (f" cap {self.rake[1]:g}bb" if self.rake[1] else " no cap")
                    if self.rake else "no rake")
        sz = self.sizes_obj()
        bits.append(f"opens {sz.open:g}bb (SB {sz.sb_open:g}), 3bets {sz.ip_3bet:g}x / {sz.blind_3bet:g}x from the blinds, "
                    f"4bets {sz.four_x:g}x")
        if self.opens:
            bits.append("opens " + ", ".join(f"{p} {v:g}bb" for p, v in self.opens))
        if self.open_limps:
            bits.append(f"any seat may limp or over-limp (a raise over limpers: the open plus 1bb a limper)")
        elif self.limps and self.players > 2:
            bits.append(f"the small blind may complete when folded to (the big blind raises it to {sz.iso:g}bb)")
        lim = self.limits()
        if lim:
            bits.append(lim.replace("7 or more players: ", ""))
        return ", ".join(bits)

    def sizes_obj(self) -> G.Sizes:
        s = G.Sizes()
        for n, v in self.sizes:
            setattr(s, n, v)
        return s

    def positions(self) -> List[str]:
        from gto.preflop import SEATS
        return list(SEATS[self.players])

    def build(self) -> Tuple[G.Node, List[str]]:
        pos = self.positions()
        root = E.build(pos, self.seat_stacks(), sizes=self.sizes_obj(), max_players=3 if self.three_way else 2,
                       ante=self.ante, straddle=self.straddle, sb_limp=self.limps and not self.open_limps,
                       cold4=self.cold_calls, limps=self.open_limps, opens=dict(self.opens))
        return root, pos

    def nodes(self) -> int:
        """The tree's nodes (built and counted once a game)."""
        n = _NODES.get(self.key)
        if n is None:
            n = _NODES[self.key] = sum(1 for _ in G.walk(self.build()[0]))
        return n

    def estimate_mb(self) -> float:
        """About how much memory a solve of this game needs (MB_BASE, MB_PER_WORK)."""
        return MB_BASE + MB_PER_WORK * self.nodes() * self.players

    def game(self, payoff=None, model_params: Optional[M.Params] = None) -> E.Game:
        root, pos = self.build()
        p = model_params if model_params is not None else params()
        g = E.Game(root, pos, lambda d: M.flop_model(d, p), self.seat_stacks(), rake=self.rake, payoff=payoff,
                   ante=self.ante)
        g.avg_power = PS.AVG_POWER
        return g


_NODES: Dict[str, int] = {}


def spec_of(state: dict) -> Tuple[Optional[Spec], Optional[str]]:
    """The game of a Study request (amounts in big blinds, as the page sends them), or (None, why it can't be solved)."""
    bb = float(state.get("bb", 1.0))
    try:
        n = int(state.get("players", 6))
    except (TypeError, ValueError):
        return None, "players must be 2 to 9"
    if not 2 <= n <= MAX_PLAYERS:
        return None, "players must be 2 to 9"
    if state.get("payouts") or state.get("bounties"):
        return None, "a tournament's preflop isn't solved here (the solve plays chips)"
    from gto.preflop import SEATS
    pos = list(SEATS[n])
    stack = float(state.get("stack") or 100.0) / bb
    raw = state.get("stacks") or {}
    seat = {p: stack for p in pos}
    if isinstance(raw, dict):
        for p, v in raw.items():
            p = str(p).upper()
            if p not in seat:
                return None, f"stacks: {p} is not a seat at this table ({', '.join(pos)})"
            try:
                seat[p] = float(v) / bb
            except (TypeError, ValueError):
                return None, f"stacks: {p}'s stack must be a number"
    elif isinstance(raw, (list, tuple)) and raw:
        if len(raw) != n:
            return None, f"stacks: one a seat ({n})"
        seat = {p: float(v) / bb for p, v in zip(pos, raw)}
    vals = [round(seat[p], 2) for p in pos]
    lo, hi = STACK_RANGE
    if any(not lo <= v <= hi for v in vals):
        return None, f"the solve takes stacks of {lo:g} to {hi:g}bb a seat"
    if max(vals) < 10.0:
        return None, "the solve takes a deepest stack of 10bb or more (push/fold covers shorter)"
    ante = float(state.get("ante") or 0.0) / bb
    if ante >= min(vals) * 0.5:
        return None, "the ante must be under half the shortest stack"
    straddle = bool(state.get("straddle")) and n >= 3
    if straddle and vals[0] < 4.0:
        return None, "the straddler needs more than 4bb"
    rate = max(0.0, min(0.25, float(state.get("rake") or 0.0)))
    cap = state.get("rake_cap")
    cap = float(cap) / bb if cap not in (None, "") and float(cap) > 0 else None
    sizes = []
    for k, v in sorted((state.get("pf_sizes") or {}).items()):
        if k not in PS.SIZE_LIMITS:
            return None, f"unknown preflop size {k!r} (sizes: {', '.join(PS.SIZE_KEYS)})"
        lo_s, hi_s = PS.SIZE_LIMITS[k]
        v = round(float(v), 2)
        if not lo_s <= v <= hi_s:
            return None, f"preflop size {k} must be {lo_s:g} to {hi_s:g}"
        if abs(v - getattr(G.Sizes(), k)) > 1e-9:
            sizes.append((k, v))
    stacks = (vals[0],) if len(set(vals)) == 1 else tuple(vals)
    # (asked for with a straddle, the complete is left out of the tree and of the key: pf_engine.build has none there)
    sb_limp = bool(state.get("pf_sb_limp")) and n > 2 and not straddle
    tree = state.get("pf_tree") or {}
    if not isinstance(tree, dict):
        return None, "pf_tree must be an object"
    unknown = [k for k in tree if k not in OPTION_KEYS]
    if unknown:
        return None, f"unknown tree option {unknown[0]!r} (options: {', '.join(OPTION_KEYS)})"
    open_limps = bool(tree.get("open_limps")) and n > 2 and not straddle
    opens = []
    raw_opens = tree.get("opens") or {}
    if not isinstance(raw_opens, dict):
        return None, "opens: a size by position"
    lo_o, hi_o = PS.SIZE_LIMITS["open"]
    for p, v in sorted(raw_opens.items(), key=lambda kv: pos.index(str(kv[0]).upper()) if str(kv[0]).upper() in pos else -1):
        p = str(p).upper()
        if p not in pos or p == pos[-1]:
            return None, f"opens: {p} doesn't open at this table (opens: {', '.join(pos[:-1])})"
        try:
            v = round(float(v), 2)
        except (TypeError, ValueError):
            return None, f"opens: {p}'s open must be a number"
        if not lo_o <= v <= hi_o:
            return None, f"opens: {p}'s open must be {lo_o:g} to {hi_o:g}bb"
        default = (dict(sizes).get("sb_open", G.Sizes().sb_open) if p == pos[-2]
                   else dict(sizes).get("open", G.Sizes().open))
        if abs(v - default) > 1e-9:
            opens.append((p, v))
    flop3 = tree.get("flop3")
    cold = tree.get("cold")
    flop3 = None if flop3 is None or bool(flop3) == (n <= 6) else bool(flop3)
    cold = None if cold is None or bool(cold) == (n <= 6) else bool(cold)
    return Spec(n, stacks, round(ante, 4), straddle, (rate, cap) if rate > 0 else None, tuple(sizes),
                sb_limp and not open_limps, open_limps, tuple(opens), flop3, cold), None


# ----------------------------------------------------------------------------- the stored solves
# The charts' raise sizes (2026-11-13): the charts' blinds 3bet to 4x the open (gto/advisor.py _default_size: 10bb over
# 2.5bb), the tree's default to 4.8x (12bb, the published solves' size). Practice's opponents play the charts, so at
# the tree's size a blind's 3bet leaves the tree and the decisions after it, and your own 3bet from a blind, have no EV
# (about 30% of 6-max decisions; docs/ACCURACY.md section 18.5). The same game at the charts' 3bet size is stored
# beside it, for Practice's and Analyze's grade (web/src/features/practice/pfGrade.ts); Study's Solver source keeps the
# tree's own sizes. Every other size of the tree already is the charts' (opens 2.5bb, SB 3bb, 3bets 3x in position,
# BvB 10bb, 4bets 2.3x, a caller adding its bet).
CHART_SIZES: Tuple[Tuple[str, float], ...] = (("blind_3bet", 4.0),)
STORED_CHART_PLAYERS = (6,)


def chart_sized(spec: Spec) -> Spec:
    """The game at the charts' raise sizes."""
    return Spec(spec.players, spec.stacks, spec.ante, spec.straddle, spec.rake, CHART_SIZES)


def stored_games() -> List[Spec]:
    grid = [Spec(n, (d,), rake=r) for n in STORED_PLAYERS for d in STORED_DEPTHS for r in STORED_RAKES]
    return grid + [chart_sized(s) for s in grid if s.players in STORED_CHART_PLAYERS]


STORED_KEYS = frozenset(s.key for s in stored_games())


def read_stored(key: str) -> Optional[bytes]:
    """A stored solve's file: in the browser from the site's pf/ (the worker's siteFetch), natively from engine/pf/."""
    if key not in STORED_KEYS:
        return None
    if sys.platform == "emscripten":
        try:
            import js   # noqa: F401
            r = js.siteFetch(f"pf/{key}.bin")
            return None if r is None else r.to_bytes()
        except Exception:   # noqa: BLE001
            return None
    try:
        with open(os.path.join(STORE_DIR, key + ".bin"), "rb") as f:
            return f.read()
    except OSError:
        return None


# ----------------------------------------------------------------------------- a solve
class Solve(PS.Solve):
    """pf_study.Solve on this game; its answers name the model and give the player's own stack."""

    def __init__(self, spec: "Spec", stored: Optional[bytes] = None):
        super().__init__(spec, stored)
        if self.stored:
            self.iters = STORED_ITERS_OF.get(spec.key, self.iters)

    def status(self) -> dict:
        out = super().status()
        out["model"] = MODEL
        return out

    def node(self, preflop: List[dict]) -> dict:
        res = super().node(preflop)
        if res.get("study") == "node":
            node, _, bets = self.walk(preflop)
            p = self.game.positions[node.player]
            st = self.spec.seat_stacks()[self.game.positions.index(p)]
            res["stack_bb"] = round(st - self.spec.ante - bets[p], 2)
            res["pf_model"] = MODEL
            lim = self.spec.limits()
            if lim:
                res["pf_limits"] = lim
            notes = self.spec.tree_notes()
            if notes:
                res["pf_tree"] = notes
            res["solver"]["by"] = "Lizard's preflop solve"
        return res


_HELD: Dict[str, Solve] = {}
MAX_HELD = PS.MAX_HELD


def held(spec: Spec, load: bool = True) -> Optional[Solve]:
    s = _HELD.get(spec.key)
    if s is None and load:
        blob = read_stored(spec.key)
        if blob is not None:
            s = _keep(Solve(spec, blob))
    return s


def _keep(s: Solve) -> Solve:
    _HELD.pop(s.spec.key, None)
    _HELD[s.spec.key] = s
    while len(_HELD) > MAX_HELD:
        _HELD.pop(next(iter(_HELD)))
    return s


def solve(spec: Spec, seconds: float, should_stop: Optional[Callable[[], bool]] = None) -> Solve:
    s = held(spec) or _keep(Solve(spec))
    _keep(s)
    return s.run(seconds, should_stop)


def export(spec: Spec) -> Optional[dict]:
    s = held(spec, load=False)
    if s is None or s.stored or not s.done:
        return None
    mbb = s.mbb
    blob = PS.pack(s.game, float("nan") if mbb is None else mbb)
    return {"key": spec.key, "iterations": s.iters, "mbb": None if mbb is None else round(mbb, 3),
            "blob": base64.b64encode(blob).decode("ascii")}


def load(spec: Spec, blob: str, iterations: int) -> Solve:
    try:
        s = Solve(spec, base64.b64decode(blob))
    except zlib.error as e:
        raise ValueError(f"not a packed solve: {e}") from e
    s.iters, s.cached = int(iterations), True
    return _keep(s)


# ----------------------------------------------------------------------------- the worker's entry
def answer(adv, state: dict) -> dict:
    """A Study request with "preflop_solve" (Advisor._study_pf's protocol, on this solver)."""
    from gto.advisor import _norm_actions
    t0 = time.time()
    st = dict(state)
    pfs = st.pop("preflop_solve", None)
    spec, why = spec_of(st)
    if spec is None:
        return {"study": "pf_none", "street": "preflop", "reason": why, "pf_model": MODEL}
    stop = getattr(adv, "should_stop", None)
    if isinstance(pfs, dict) and pfs.get("run"):
        if held(spec) is None and sys.platform == "emscripten" and spec.estimate_mb() > MAX_MB_BROWSER:
            return {"study": "pf_none", "street": "preflop", "pf_model": MODEL,
                    "reason": f"this tree needs about {spec.estimate_mb():,.0f} MB, more than a browser tab can hold "
                              f"({MAX_MB_BROWSER:,.0f} MB): take 3-way flops, cold calls or limps off"}
        sec = max(0.5, min(30.0, float(pfs["run"])))
        s = solve(spec, sec, stop)
        return {"study": "pf_progress", "street": "preflop", "pf_solve": s.status(), "pf_model": MODEL,
                "seconds": round(time.time() - t0, 2)}
    if isinstance(pfs, dict) and pfs.get("export"):
        out = export(spec) or {"key": spec.key, "blob": None}
        return {"study": "pf_export", "street": "preflop", "pf_model": MODEL, **out}
    if isinstance(pfs, dict) and pfs.get("load") and held(spec) is None:
        try:
            load(spec, str(pfs["load"]), int(pfs.get("iterations") or 0))
        except (ValueError, TypeError):
            pass
    s = held(spec)
    if s is None:
        mb = spec.estimate_mb()
        return {"study": "pf_unsolved", "street": "preflop", "game": spec.label(), "key": spec.key, "pf_model": MODEL,
                "estimate_s": round(PS.estimate_seconds(spec)), "estimate_mb": round(mb), "nodes": spec.nodes(),
                "max_mb": MAX_MB_BROWSER, "seconds": round(time.time() - t0, 2)}
    res = s.node(_norm_actions(st.get("preflop"), float(st.get("bb", 1.0))))
    res["seconds"] = round(time.time() - t0, 3)
    return res
