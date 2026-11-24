#!/usr/bin/env python3
"""The single-size library (GTO Wizard's "Single Size Solutions"): every heads-up 6-max 100bb preflop line on a set of
representative flops, each flop solved with ONE bet size at every flop node, the size chosen for that flop by the
solver's automatic sizing. Written into library-build/sources/single-size, which scripts/library/assemble.py publishes
beside the library as `ss_index.json` (docs/single-size-library.md).

One entry, two solves:

  1. Automatic sizing, as the advisor's optimize_sizes does it (gto/advisor.py Advisor._optimize_sizes, OPT_SIZES,
     OPT_KEEP, MAX_SIZES): the flop solved once over the wide menu (OPT_SIZES: 25-200% of the pot, plus all-in where
     the tree offers it), one street deep and one raise; the size either player's first bet uses with the largest
     share of their range is kept, alone (MAX_SIZES = 1 here).
  2. The stored solve: the library's own flop model (flop_library.library_config, its accuracy target and iterations)
     with that one flop bet size. Raises are already one size in the library's tree (50% on the flop, 75% on the turn
     and river), and the turn and river inside the flop solve bet 75% (its later_sizes). So every node of the tree
     offers one bet or raise size; only the flop's is chosen per flop (the turn's and river's are the model's fixed
     75%, see the doc).

Trees and memory: the river dealt with a turn file (as the library's newer spots), and a worker that passes --max-mb is
stopped and its flop solved on the old tree (the river blind on the turn's boards, no turn file), as
build_breadth.py does. Each entry's header carries `ss` ({size, pct, usage, wide_iters, wide_expl}), so the index
can say which size each flop's tree has: a spot's flops have different trees, which the advisor's FlopLibrary can't
list in one index, hence the separate ss_index.json and engine/single_size.py's reader.

Restarts: a subprocess per entry. A worker that dies (the memory guard, a crash) or stops using CPU for --stall-min
minutes while not paused is put back on the queue, up to --retries times; `run` goes over what is left on disk again
until nothing it can solve is left, and `supervise` runs `run` again if it exits abnormally. Entries on disk for the
spot's ranges are kept, so any run picks up where the last left off.

    build_single_size.py plan                        # spots, flops, entries left
    build_single_size.py one SPOT FLOP [--tree old]  # one entry, timed, with its peak memory (a measurement)
    build_single_size.py run --jobs 2                # the build, in this process
    build_single_size.py supervise --jobs 2          # the build, re-run after an abnormal exit, until DEADLINE_H
    build_single_size.py start --jobs 2              # freeze this script and solver/ into RUN, then supervise
    build_single_size.py index                       # rewrite ss-index.json, reports and ranges from disk
    build_single_size.py status                      # entries on disk, s/entry, MB, ETA from the log

The ante and straddle games (`--set games`, 2026-11-24, docs/single-size-library.md "Ante and straddle games"): the
same build for a few heads-up lines of 6-max 100bb with a 1bb big-blind ante or a 2bb straddle (GAME_SPOTS), into
library-build/sources/ss-games with its run state in runs/ss-games. Their ranges entering the flop are Lizard's stored
preflop solve of that game (engine/pf_solve.py, the class-level model at the charts' raise sizes), not the charts:
`pf-ranges` reads them off the stored game's file once, into ss-games/pf-ranges.json, which every entry and the index
then use (each spot's index row carries them, so the worker plays the same ranges: engine/single_size.py).

    build_single_size.py pf-ranges --set games [--pf-dir DIR]   # the stored preflop games' ranges -> pf-ranges.json
    build_single_size.py plan --set games                       # (and start, status, index... with --set games)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main_checkout() -> Path:
    """The main checkout (this file may run from a worktree or a copy): the parent of git's common directory."""
    try:
        d = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--path-format=absolute", "--git-common-dir"],
                           capture_output=True, text=True, check=True).stdout.strip()
        return Path(d).parent
    except (OSError, subprocess.CalledProcessError):
        return Path("/Users/mhan/Desktop/projects/lizard")


MAIN = Path(os.environ.get("SINGLE_SIZE_MAIN") or main_checkout())
OUT = MAIN / "library-build" / "sources" / "single-size"
RUN = MAIN / "library-build" / "runs" / "single-size"
LOG = RUN.parent / "single-size.log"   # (where start's nohup writes it: status reads it)
PF_RANGES = "pf-ranges.json"   # the games' preflop-solve ranges, in the set's output folder
_PF_OUT: Path | None = None    # (the output folder whose pf-ranges.json setup() reads: main sets it)


def use_set(name: str) -> None:
    """OUT, RUN and LOG for a set (SETS)."""
    global OUT, RUN, LOG
    folder = SETS[name][1]
    OUT = MAIN / "library-build" / "sources" / folder
    RUN = MAIN / "library-build" / "runs" / folder
    LOG = RUN.parent / "single-size.log" if name == "classic" else RUN / "build.log"
MAX_MB = 1000      # CLAUDE.md: keep processes under about 1 GB
INDEX = "ss-index.json"   # the source's index (assemble.py publishes it as ss_index.json)
SS_FORMAT = 1
# The flops: representative_flops(n), a systematic sample of the flop space by weight (every texture its share), in
# phases: every spot on the 184 first (the set every library spot started on), then on to 552 (3 x 184, so it holds the
# 184). Within a phase the build goes flop by flop over every spot, so a stop leaves every line with about as many
# flops (docs/single-size-library.md: the CPU and size budget, measured).
FLOP_PHASES = [184, 552]
DEADLINE_H = 48.0  # the owner's CPU budget for this build: about 2 days (supervise stops then; `start` resumes)


@dataclass(frozen=True)
class Spot:
    id: str       # ss_<the multi-size library's id>
    base: str     # the library spot with the same line (several sizes)
    label: str
    line: str
    tree: str     # "dealt" (the river dealt, a turn file; the old tree past --max-mb) or "old"
    game: str = ""   # a GAMES key: a game with an ante or a straddle, its ranges from the preflop solve ("": 100bb, the charts)


@dataclass(frozen=True)
class Game:
    """A game with forced bets beyond the blinds. Its spots' ranges entering the flop come from Lizard's stored preflop
    solve of it (`pf_key`, engine/pf_solve.py Spec.key: the class-level model at the charts' raise sizes, so an open
    is 2.5bb with the ante and 5bb over the straddle, as the advice's charts size them); the pot and stack from the
    advisor's own replay of the line in this game (flop_library.spot_setup), so a Study request reaches the entry."""
    id: str
    words: str      # in the spot's label and the provenance line
    players: int
    stack: float
    ante: float     # each seat's, bb
    straddle: bool  # a 2bb straddle from the first seat (UTG at 6-max), acting last before the flop
    pf_key: str

    def as_dict(self) -> dict:
        return {"players": self.players, "stack": self.stack, "ante": self.ante, "straddle": self.straddle}


# The games (W13 of docs/GAP_PLAN.md): the ante is a 1bb big-blind ante as each seat's share to the cent (W11's stored
# ante games, engine/pf_solve.py stored_ante: 0.17bb at 6 players), the straddle UTG's 2bb.
GAMES = {
    "ante": Game("ante", "1bb big-blind ante (0.17bb a seat)", 6, 100.0, 0.17, False, "lz4_6max_100bb_a0.17_ch"),
    "straddle": Game("straddle", "2bb straddle from UTG", 6, 100.0, 0.0, True, "lz4_6max_100bb_s_ch"),
}


def _s(base: str, label: str, line: str) -> Spot:
    """A spot. Single-raised pots go on the old tree: with the river dealt their one-size trees still need 1.2-1.4 GB
    (measured 2026-11-17: BTN vs BB Kc7d2h 1,231 MB, JcTd8d and SB vs BB 7c6c5c past 1.3 GB), over this machine's
    1 GB a process, where the old tree takes 0.54 GB and 12 s. 3bet and 4bet pots fit dealt (0.47-0.55 GB)."""
    return Spot("ss_" + base, base, label, line, "old" if base.startswith("srp_") else "dealt")


# Every heads-up line of 6-max 100bb (no ante or rake): the 15 single-raised pots, 15 3bet pots and 15 4bet pots (38
# games: 7 lines are another's, ALIASES), at the library's sizes (2.5bb opens, 3bb from the small blind, 3bets to 3x in position and 4x from the blinds, 4bets to
# 2.3x the 3bet). Most played first (flop_library.SPOTS's order, then the breadth build's value order).
SPOTS = [
    _s("srp_btn_bb", "BTN vs BB single-raised pot", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"),
    _s("srp_co_bb", "CO vs BB single-raised pot", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c"),
    _s("3bp_bb_btn", "BB 3bet vs BTN", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:c"),
    _s("srp_sb_bb", "SB vs BB single-raised pot", "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c"),
    _s("3bp_btn_co", "BTN 3bet vs CO", "UTG:f,HJ:f,CO:r2.5,BTN:r7.5,SB:f,BB:f,CO:c"),
    _s("srp_hj_bb", "HJ vs BB single-raised pot", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:c"),
    _s("srp_utg_bb", "UTG vs BB single-raised pot", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:c"),
    _s("3bp_sb_btn", "SB 3bet vs BTN", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:r10,BB:f,BTN:c"),
    _s("srp_hj_co", "HJ vs CO single-raised pot", "UTG:f,HJ:r2.5,CO:c,BTN:f,SB:f,BB:f"),
    _s("srp_btn_sb", "BTN vs SB single-raised pot", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:c,BB:f"),
    _s("srp_utg_hj", "UTG vs HJ single-raised pot", "UTG:r2.5,HJ:c,CO:f,BTN:f,SB:f,BB:f"),
    _s("srp_co_sb", "CO vs SB single-raised pot", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:c,BB:f"),
    _s("srp_utg_btn", "UTG vs BTN single-raised pot", "UTG:r2.5,HJ:f,CO:f,BTN:c,SB:f,BB:f"),
    _s("3bp_sb_co", "SB 3bet vs CO", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:r10,BB:f,CO:c"),
    _s("3bp_hj_utg", "HJ 3bet vs UTG", "UTG:r2.5,HJ:r7.5,CO:f,BTN:f,SB:f,BB:f,UTG:c"),
    _s("3bp_bb_co", "BB 3bet vs CO", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:r10,CO:c"),
    _s("3bp_co_hj", "CO 3bet vs HJ", "UTG:f,HJ:r2.5,CO:r7.5,BTN:f,SB:f,BB:f,HJ:c"),
    _s("3bp_bb_sb", "BB 3bet vs SB", "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:r10,SB:c"),
    _s("srp_hj_sb", "HJ vs SB single-raised pot", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:c,BB:f"),
    _s("srp_co_btn", "CO vs BTN single-raised pot", "UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:f"),
    _s("srp_utg_sb", "UTG vs SB single-raised pot", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:c,BB:f"),
    _s("3bp_btn_utg", "BTN 3bet vs UTG", "UTG:r2.5,HJ:f,CO:f,BTN:r7.5,SB:f,BB:f,UTG:c"),
    _s("3bp_sb_utg", "SB 3bet vs UTG", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:r10,BB:f,UTG:c"),
    _s("3bp_bb_hj", "BB 3bet vs HJ", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:r10,HJ:c"),
    _s("3bp_sb_hj", "SB 3bet vs HJ", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:r10,BB:f,HJ:c"),
    _s("3bp_bb_utg", "BB 3bet vs UTG", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:r10,UTG:c"),
    # 4bet pots: the opener's 4bet to 2.3x the 3bet, called
    _s("4bp_utg_hj", "UTG 4bet vs HJ", "UTG:r2.5,HJ:r7.5,CO:f,BTN:f,SB:f,BB:f,UTG:r17.25,HJ:c"),
    _s("4bp_hj_co", "HJ 4bet vs CO", "UTG:f,HJ:r2.5,CO:r7.5,BTN:f,SB:f,BB:f,HJ:r17.25,CO:c"),
    _s("4bp_co_btn", "CO 4bet vs BTN", "UTG:f,HJ:f,CO:r2.5,BTN:r7.5,SB:f,BB:f,CO:r17.25,BTN:c"),
    _s("4bp_utg_btn", "UTG 4bet vs BTN", "UTG:r2.5,HJ:f,CO:f,BTN:r7.5,SB:f,BB:f,UTG:r17.25,BTN:c"),
    _s("4bp_utg_sb", "UTG 4bet vs SB", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:r10,BB:f,UTG:r23,SB:c"),
    _s("4bp_btn_sb", "BTN 4bet vs SB", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:r10,BB:f,BTN:r23,SB:c"),
    _s("4bp_btn_bb", "BTN 4bet vs BB", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:r23,BB:c"),
    _s("4bp_sb_bb", "SB 4bet vs BB", "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:r10,SB:r23,BB:c"),
    _s("4bp_co_sb", "CO 4bet vs SB", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:r10,BB:f,CO:r23,SB:c"),
    _s("4bp_co_bb", "CO 4bet vs BB", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:r10,CO:r23,BB:c"),
    _s("4bp_hj_bb", "HJ 4bet vs BB", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:f,BB:r10,HJ:r23,BB:c"),
    _s("4bp_utg_bb", "UTG 4bet vs BB", "UTG:r2.5,HJ:f,CO:f,BTN:f,SB:f,BB:r10,UTG:r23,BB:c"),
]


def _g(base: str, game: str, label: str, line: str) -> Spot:
    """A spot of an ante or straddle game: ss_<line>_<game>, on the same trees as the 100bb spots (single-raised pots
    on the old tree, 3bet pots dealt)."""
    return Spot(f"ss_{base}_{game}", "", f"{label}, {GAMES[game].words}", line,
                "old" if base.startswith("srp_") else "dealt", game)


# The ante and straddle spots (`--set games`): the most played heads-up pots of each game (the preflop solve's own
# frequencies, 2026-11-24: BTN opens 52% and CO 35% with the ante, the big blind defending 935 and 865 combos; over the
# straddle BTN opens 34% and CO 25%, the straddler defending 607 and 512 combos), most played first.
GAME_SPOTS = [
    _g("srp_btn_bb", "ante", "BTN vs BB single-raised pot", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c"),
    _g("srp_btn_utg", "straddle", "BTN vs the straddle single-raised pot", "HJ:f,CO:f,BTN:r5,SB:f,BB:f,UTG:c"),
    _g("srp_co_bb", "ante", "CO vs BB single-raised pot", "UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c"),
    _g("3bp_bb_btn", "ante", "BB 3bet vs BTN", "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:c"),
    _g("srp_co_utg", "straddle", "CO vs the straddle single-raised pot", "HJ:f,CO:r5,BTN:f,SB:f,BB:f,UTG:c"),
    _g("srp_sb_bb", "ante", "SB vs BB single-raised pot", "UTG:f,HJ:f,CO:f,BTN:f,SB:r3,BB:c"),
]
# The two sets the script builds: their spots, output and run folders (under library-build/), flop phases (the games:
# the 184, the 552, then on toward every flop, in a spread order (flops()), until the run's deadline)
SETS = {"classic": (SPOTS, "single-size", FLOP_PHASES), "games": (GAME_SPOTS, "ss-games", [184, 552, 1755])}
BY_ID = {s.id: s for s in SPOTS + GAME_SPOTS}
# The other seven lines of the 45 play the same game as a spot above: the same two ranges, pot and stack (the charts
# flat or 3bet the same hands from those seats), so the solve is that spot's with the seats renamed. They aren't solved
# again: the index lists each under its spot's `aliases`, and Study reads the spot for them (as the advisor's library
# does, keyed by ranges, pot and stack). `plan` checks they still match.
ALIASES = {
    "ss_srp_hj_co": [("HJ vs BTN single-raised pot", "UTG:f,HJ:r2.5,CO:f,BTN:c,SB:f,BB:f")],
    "ss_srp_utg_hj": [("UTG vs CO single-raised pot", "UTG:r2.5,HJ:f,CO:c,BTN:f,SB:f,BB:f")],
    "ss_3bp_co_hj": [("BTN 3bet vs HJ", "UTG:f,HJ:r2.5,CO:f,BTN:r7.5,SB:f,BB:f,HJ:c")],
    "ss_3bp_hj_utg": [("CO 3bet vs UTG", "UTG:r2.5,HJ:f,CO:r7.5,BTN:f,SB:f,BB:f,UTG:c")],
    "ss_4bp_utg_hj": [("UTG 4bet vs CO", "UTG:r2.5,HJ:f,CO:r7.5,BTN:f,SB:f,BB:f,UTG:r17.25,CO:c")],
    "ss_4bp_hj_co": [("HJ 4bet vs BTN", "UTG:f,HJ:r2.5,CO:f,BTN:r7.5,SB:f,BB:f,HJ:r17.25,BTN:c")],
    "ss_4bp_utg_sb": [("HJ 4bet vs SB", "UTG:f,HJ:r2.5,CO:f,BTN:f,SB:r10,BB:f,HJ:r23,SB:c")],
}

# The automatic sizing's first solve (Advisor._optimize_sizes solves it on a share of the request's time budget; here
# by iterations, to the same kind of precision a page's Accurate gets): at least SIZE_MIN_ITERS, then until within
# SIZE_TARGET % of the pot, at most SIZE_MAX_ITERS.
SIZE_MIN_ITERS, SIZE_MAX_ITERS, SIZE_CHECK, SIZE_TARGET = 100, 400, 100, 0.3

fl = adv = None  # gto.flop_library and gto.advisor, imported from --solver


def load(solver: Path) -> None:
    global fl, adv
    sys.path.insert(0, str(solver))
    import gto.native  # noqa: F401  (BLAS on one thread before numpy loads)
    from gto import advisor as a, flop_library as f
    fl, adv = f, a


_SETUPS: dict = {}


def setup(s: Spot) -> dict:
    if s.id not in _SETUPS:
        _SETUPS[s.id] = game_setup(s) if s.game else fl.spot_setup(s.line)
    return _SETUPS[s.id]


# ----------------------------------------------------------------------------- the ante and straddle games' ranges
_PF: dict = {}


def pf_ranges() -> dict:
    """pf-ranges.json of the output folder (`pf-ranges` writes it): {games: {id: {key, sha1, ...}}, spots: {id: {game,
    line, seats, w: [oop, ip] as 169 class weights x 10000 in gto.pf_classes.CLASSES order}}}."""
    if not _PF:
        p = (_PF_OUT or OUT) / PF_RANGES
        try:
            _PF.update(json.loads(p.read_text()))
        except (OSError, ValueError):
            raise SystemExit(f"{p}: no preflop-solve ranges yet; run `build_single_size.py pf-ranges --set games` first")
    return _PF


def class_range(w: list):
    """169 class weights x 10000 -> the 1326-combo range (every combo of a class the same weight). The index carries the
    same integers, and engine/single_size.py rebuilds the range from them the same way, so the fingerprints agree."""
    import numpy as np
    from gto.pf_classes import CLASS_OF
    return (np.asarray(w, dtype=np.float64) / 10000.0)[CLASS_OF]


def game_setup(s: Spot) -> dict:
    """A game spot's setup: the pot, stack and seats of the advisor's replay of its line in its game, the ranges from
    pf-ranges.json (Lizard's preflop solve of the game). `chart` keeps the charts' ranges, for `plan`'s comparison."""
    g = GAMES[s.game]
    st = fl.spot_setup(s.line, g.players, g.stack, g.ante, g.straddle)
    pr = pf_ranges()
    got = pr.get("spots", {}).get(s.id)
    if not got or got.get("line") != s.line or got.get("game") != s.game or \
            pr.get("games", {}).get(s.game, {}).get("key") != g.pf_key:
        raise SystemExit(f"{s.id}: pf-ranges.json doesn't hold this spot's line in {g.pf_key}; run `pf-ranges` again")
    if got["seats"] != [st["oop"], st["ip"]]:
        raise SystemExit(f"{s.id}: pf-ranges.json's seats {got['seats']} aren't the replay's {[st['oop'], st['ip']]}")
    return dict(st, full0=class_range(got["w"][0]), full1=class_range(got["w"][1]), chart=(st["full0"], st["full1"]))


def make_pf_ranges(out: Path, pf_dir: Path, spots) -> int:
    """pf-ranges.json: each game spot's two ranges entering the flop off the stored preflop game (engine/pf_solve.py
    Solve over engine/pf/<key>.bin, or --pf-dir's copy): each player's reach at its last decision of the line times
    its share of the move it made there, by hand class (engine/bunching.py solve_folds reads the folds the same way).
    The line's raise sizes must be the game's own, and the game's file is named by its sha1."""
    import numpy as np
    sys.path.insert(0, str(ROOT))
    from engine import pf_solve as S
    from gto.advisor import _norm_actions
    from gto.cli import parse_actions
    from gto.pf_classes import CLASSES
    index = {c: i for i, c in enumerate(CLASSES)}
    res: dict = {"format": 1, "classes": list(CLASSES), "games": {}, "spots": {}}
    solves = {}
    for s in spots:
        if not s.game:
            continue
        g = GAMES[s.game]
        if s.game not in solves:
            spec = S.chart_sized(S.Spec(g.players, (g.stack,), ante=g.ante, straddle=g.straddle))
            if spec.key != g.pf_key:
                raise SystemExit(f"{s.game}: engine/pf_solve.py names this game {spec.key}, not {g.pf_key}")
            path = pf_dir / f"{g.pf_key}.bin"
            try:
                blob = path.read_bytes()
            except OSError:
                raise SystemExit(f"{path}: the stored preflop game {g.pf_key} isn't there (W11's stored ante and straddle "
                                 "games: engine/pf/ once merged, or --pf-dir with a copy of its file)")
            solves[s.game] = S.Solve(spec, blob)
            res["games"][s.game] = {"key": g.pf_key, "sha1": hashlib.sha1(blob).hexdigest()[:12], "bytes": len(blob),
                                    "label": spec.label(), "model": S.MODEL, "words": g.words, **g.as_dict()}
        solve = solves[s.game]
        acts = _norm_actions(parse_actions(s.line), 1.0)
        st = fl.spot_setup(s.line, g.players, g.stack, g.ante, g.straddle)
        ws = []
        for seat in (st["oop"], st["ip"]):
            i = max(j for j, a in enumerate(acts) if a["pos"] == seat)
            node = solve.node(acts[:i])
            if node.get("study") != "node" or node.get("actor") != seat:
                raise SystemExit(f"{s.id}: {seat}'s last move isn't on the preflop solve's tree ({node.get('error')})")
            moves = node["actions"]
            names = [m["action"] for m in moves]
            want = acts[i]["action"]
            if want not in names:
                raise SystemExit(f"{s.id}: the preflop solve has no {want} for {seat} there ({names})")
            j = names.index(want)
            if want == "raise" and abs(float(moves[j]["amount_bb"]) - float(acts[i]["to"])) > 1e-6:
                raise SystemExit(f"{s.id}: {seat} raises to {acts[i]['to']:g} in the line, {moves[j]['amount_bb']:g} in "
                                 "the preflop solve")
            w = np.zeros(len(CLASSES))
            for cls, cell in node["grid"]["cells"].items():
                w[index[cls]] = cell["w"] * cell["f"][j]
            ws.append([int(x) for x in np.round(w * 10000)])
        res["spots"][s.id] = {"game": s.game, "line": s.line, "seats": [st["oop"], st["ip"]], "w": ws}
        cr = [class_range(x).sum() for x in ws]
        print(f"  {s.id:<26} {st['oop']}/{st['ip']} pot {st['pot']:<6g} stack {st['stack']:<6g} combos "
              f"{cr[0]:.0f}/{cr[1]:.0f} (the charts': {st['full0'].sum():.0f}/{st['full1'].sum():.0f})")
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / (PF_RANGES + ".tmp")
    tmp.write_text(json.dumps(res, separators=(",", ":")))
    os.replace(tmp, out / PF_RANGES)
    for gid, g in res["games"].items():
        print(f"  {gid}: {g['key']} sha1 {g['sha1']} ({g['label']})")
    print(f"wrote {out / PF_RANGES}")
    return 0


def fps(st: dict) -> list:
    return [fl.range_fp(st["full0"]), fl.range_fp(st["full1"])]


NESTED = 552   # representative_flops(184) and (552) are nested; larger sets aren't (1104 doesn't hold the 552)
GOLDEN = 0.6180339887498949


def flops(n: int) -> list:
    """representative_flops(n) by name. Past NESTED (the games' last phase, every flop): the 552 first, then the rest
    in a low-discrepancy order over their texture order (index i by frac(i x golden ratio)), so a build stopped at its
    deadline partway through holds a spread of textures, not the lowest rainbow boards."""
    from gto.cards import cards_str
    if n <= NESTED:
        return [cards_str(f) for f in fl.representative_flops(n)]
    base = flops(NESTED)
    have = set(base)
    rest = [nm for nm in (cards_str(f) for f in fl.representative_flops(n)) if nm not in have]
    order = sorted(range(len(rest)), key=lambda i: (i * GOLDEN) % 1.0)
    return base + [rest[i] for i in order]


def tree_cfg(st: dict, frac: float, dealt: bool):
    """The stored solve's tree: the library's flop model (the river dealt, or the old tree's river blind) with one
    flop bet size."""
    c = fl.library_config(st["pot"], st["stack"]) if dealt else fl.library_config()
    c.bet_sizes["flop"] = [frac]
    return c


def pct_of(frac: float) -> float:
    """The size as Study asks for it (advisor._custom_sizes rounds a % of the pot to 0.1%): frac is kept at 3 decimals."""
    return round(frac * 100, 1)


# ----------------------------------------------------------------------------- automatic sizing
def choose_size(st: dict, board) -> dict:
    """Advisor._optimize_sizes with one size kept: the flop solved over the wide menu (OPT_SIZES, all-in where the tree
    offers it), one street deep and one raise; each first decision's (the root's, and in position after a check) range
    mix; the size either uses most. {frac, label, usage {label: share}, iters, expl}."""
    from gto.solver import Decision, solve
    wide = fl.library_config()
    wide.bet_sizes["flop"] = sorted(set(adv.OPT_SIZES))
    wide.depth, wide.max_raises = 1, 1
    sol = solve(board, st["full0"], st["full1"], st["pot"], st["stack"], cfg=wide, time_budget=1e9,
                max_iters=SIZE_MIN_ITERS)
    expl = sol.exploitability()
    while expl > SIZE_TARGET and sol.iters < SIZE_MAX_ITERS:
        sol.extend(1e9, max_iters=min(sol.iters + SIZE_CHECK, SIZE_MAX_ITERS))
        expl = sol.exploitability()
    root = sol.root
    chk = root.children[root.names.index("check")]
    firsts = [(root, sol.r0)] + ([(chk, sol.r1)] if isinstance(chk, Decision) else [])
    menu = {f"bet {int(round(f * 100))}%": f for f in sorted(set(adv.OPT_SIZES))}
    frac = dict(menu)
    frac["all-in"] = round(st["stack"] / max(st["pot"], 1e-9) + 0.01, 3)   # (a bet that reaches the stack)
    use: dict = {}
    for n, r in firsts:
        mix = n.avg_strategy0() @ (r / max(r.sum(), 1e-12))
        for nm, f in zip(n.names, mix):
            if nm != "check":
                use[nm] = max(use.get(nm, 0.0), float(f))
    best = max(use, key=lambda k: (use[k], -frac.get(k, 0.0)))   # (a tie: the smaller size)
    f = round(float(frac[best]), 3)
    label = lambda nm: nm[4:] if nm.startswith("bet ") else nm
    return {"frac": f, "label": label(best), "usage": {label(k): round(v, 3) for k, v in sorted(use.items(), key=lambda x: frac.get(x[0], 0))},
            "iters": int(sol.iters), "expl": round(float(expl), 3)}


# ----------------------------------------------------------------------------- one entry (a worker process)
def entry_path(out: Path, sid: str, name: str) -> Path:
    return out / sid / f"{name}.bin"


def read_head(p: Path):
    try:
        return fl.decode(p.read_bytes())["head"]
    except (OSError, ValueError):
        return None


def on_disk(out: Path, s: Spot, name: str):
    """'dealt' or 'old' for an entry on disk for the spot's ranges and its own tree (its header's ss size), else None."""
    h = read_head(entry_path(out, s.id, name))
    if not h or h.get("format") != fl.FORMAT or h.get("fp") != fps(setup(s)) or not isinstance(h.get("ss"), dict):
        return None
    st = setup(s)
    frac, dealt = float(h["ss"]["size"]), bool(h["ss"].get("dealt"))
    return ("dealt" if dealt else "old") if h.get("tree") == fl.tree_hash(fl.tree_key(tree_cfg(st, frac, dealt))) else None


def solve_one(out: Path, sid: str, name: str, tree: str, opts: dict) -> str:
    """Size, solve and write one entry (its turn file with the river dealt). A sizing already made for this flop (an
    entry stopped over memory and solved again on the old tree) is read back from sizing.json, so it isn't redone."""
    import resource
    from gto.cards import cards as parse_cards
    from gto.solver import solve
    s = BY_ID[sid]
    st = setup(s)
    board = parse_cards(name)
    t0 = time.time()
    memo = out / sid / f"{name}.sizing.json"
    try:
        size = json.loads(memo.read_text())
    except (OSError, ValueError):
        size = None
    if not size or size.get("fp") != fps(st):
        size = dict(choose_size(st, board), fp=fps(st))
        memo.parent.mkdir(parents=True, exist_ok=True)
        tmp = memo.with_suffix(".tmp")
        tmp.write_text(json.dumps(size))
        os.replace(tmp, memo)
    t_size = time.time() - t0
    dealt = tree == "dealt"
    cfg = tree_cfg(st, size["frac"], dealt)
    t1 = time.time()
    sol = solve(board, st["full0"], st["full1"], st["pot"], st["stack"], cfg=cfg, time_budget=1e9,
                max_iters=opts["min_iters"])
    expl = sol.exploitability()
    while expl > opts["target"] and sol.iters < opts["max_iters"]:
        sol.extend(1e9, max_iters=min(sol.iters + opts["check"], opts["max_iters"]))
        expl = sol.exploitability()
    meta = {"spot": sid, "fp": fps(st), "pot": st["pot"], "stack": st["stack"], "tree": fl.tree_key(cfg),
            "seats": [st["oop"], st["ip"]], "board": name,
            "ss": {"size": size["frac"], "pct": pct_of(size["frac"]), "label": size["label"], "usage": size["usage"],
                   "dealt": dealt, "wide_iters": size["iters"], "wide_expl": size["expl"]}}
    data = fl.encode(sol, meta)
    turns = fl.encode_turns(sol, data, evs=True) if dealt else None
    p = entry_path(out, sid, name)
    tp = p.with_name(name + ".turn.bin")
    p.parent.mkdir(parents=True, exist_ok=True)
    tp.unlink(missing_ok=True)
    for path, b in ((p, data), (tp, turns)):
        if b is not None:
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_bytes(b)
            os.replace(tmp, path)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20  # bytes on macOS
    return (f"{sid} {name} size={size['label']} iters={sol.iters} expl={expl:.3f}% secs={time.time() - t0:.0f} "
            f"size_secs={t_size:.0f} solve_secs={time.time() - t1:.0f} bytes={len(data)} turns={len(turns or b'')} "
            f"tree={tree} peak_mb={rss:.0f}")


# ----------------------------------------------------------------------------- index, reports, ranges
def _norm(nm: str) -> str:
    """An action's name in a single-size report: its one size dropped ("bet 33%" -> "bet", "raise to 12" -> "raise")."""
    return "bet" if nm.startswith("bet ") else "raise" if nm.startswith("raise") else nm


def write_index(out: Path, spots=None) -> dict:
    """ss-index.json from the entries on disk for each spot's ranges and their own tree: per spot its flops (sha1[:10]),
    each flop's tree (`flop_tree` -> `trees`), its size (`sizes`: % of the pot), the flops on the old tree (`old`) and
    those with a turn file (`turns`); with each spot's report.json (the stored decisions' mixes per flop, the bet named
    "bet" whatever its size, and each flop's size) and ranges.json. Stale entries are left out."""
    idx = {"format": fl.FORMAT, "ss_format": SS_FORMAT, "spots": []}
    total = n = 0
    for s in spots or SPOTS:
        d = out / s.id
        if not d.is_dir():
            continue
        st = setup(s)
        flops_, trees, flop_tree, sizes, olds, turns, usage = {}, {}, {}, {}, [], [], {}
        report_flops, nodes = [], {}
        for p in sorted(d.glob("*.bin")):
            if p.name.endswith(".turn.bin"):
                continue
            name = p.name[:-4]
            data = p.read_bytes()
            try:
                e = fl.decode(data)
            except ValueError:
                continue
            h = e["head"]
            ss = h.get("ss")
            if h.get("fp") != fps(st) or not isinstance(ss, dict):
                continue
            tk = fl.tree_key(tree_cfg(st, float(ss["size"]), bool(ss.get("dealt"))))
            th = fl.tree_hash(tk)
            if h.get("tree") != th:
                continue
            key = f"b{pct_of(float(ss['size'])):g}" + ("" if ss.get("dealt") else "-old")
            trees[key], flop_tree[name] = tk, key
            sizes[name] = pct_of(float(ss["size"]))
            usage[name] = ss.get("usage")
            if not ss.get("dealt"):
                olds.append(name)
            flops_[name] = hashlib.sha1(data).hexdigest()[:10]
            total += len(data)
            tp = p.with_name(name + ".turn.bin")
            if tp.exists():
                try:
                    if fl.turns_head(tp.read_bytes()).get("entry") == fl.entry_hash(data):
                        turns.append(name)
                        total += tp.stat().st_size
                except (OSError, ValueError):
                    pass
            fr = fl.flop_report(e, st["full0"], st["full1"], st["pot"])
            fr = {"f": fr["f"], "s": sizes[name],
                  "n": {"|".join(map(_norm, k.split("|"))) if k else k: v for k, v in fr["n"].items()},
                  "h": {"|".join(map(_norm, k.split("|"))) if k else k: v for k, v in fr["h"].items()},
                  "ev": fr["ev"], "eq": fr["eq"]}
            for nd in e["nodes"]:
                if not fl.raised(nd["path"]):
                    nodes.setdefault("|".join(map(_norm, nd["path"])), [_norm(x) for x in nd["names"]])
            report_flops.append(fr)
        if not flops_:
            continue
        wts = fl.report_weights(sorted(flops_))
        for fr in report_flops:
            fr["w"] = round(wts[fr["f"]], 3)
        report = {"format": fl.REPORT_FORMAT, "id": s.id, "label": f"{s.label}, single size", "line": s.line,
                  "seats": [st["oop"], st["ip"]], "pot": st["pot"], "stack": st["stack"], "nodes": nodes,
                  "flops": report_flops, "single_size": True, **({"game": GAMES[s.game].as_dict()} if s.game else {})}
        rb = json.dumps(report, separators=(",", ":")).encode()
        tmp = d / "report.json.tmp"
        tmp.write_bytes(rb)
        os.replace(tmp, d / "report.json")
        tmp = d / "ranges.json.tmp"
        tmp.write_text(json.dumps(fl.spot_ranges(s.id, st["full0"], st["full1"]), separators=(",", ":")))
        os.replace(tmp, d / "ranges.json")
        sp = {"id": s.id, **({"base": s.base} if s.base else {}), "label": f"{s.label}, single size", "line": s.line,
              "seats": [st["oop"], st["ip"]], "fp": fps(st), "pot": st["pot"], "stack": st["stack"],
              "flops": flops_, "sizes": sizes, "trees": trees, "flop_tree": flop_tree,
              "report": hashlib.sha1(rb).hexdigest()[:10], "single_size": True}
        if s.game:
            # the game, the preflop solve its ranges come from, and those ranges (169 class weights x 10000 each, out of
            # position first: engine/single_size.py plays them for a request in this game on this line)
            pr = pf_ranges()
            pg = pr["games"][s.game]
            sp["game"] = GAMES[s.game].as_dict()
            sp["pf"] = {k: pg[k] for k in ("key", "sha1", "model", "words")}
            sp["pf_ranges"] = pr["spots"][s.id]["w"]
        if ALIASES.get(s.id):
            sp["aliases"] = [{"label": f"{lab}, single size", "line": ln} for lab, ln in ALIASES[s.id]]
        if olds:
            sp["old"] = olds
        if turns:
            sp["turns"] = True if len(turns) == len(flops_) else turns
        idx["spots"].append(sp)
        n += len(flops_)
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / (INDEX + ".tmp")
    tmp.write_text(json.dumps(idx, separators=(",", ":")))
    os.replace(tmp, out / INDEX)
    print(f"index: {len(idx['spots'])} spots, {n} flops, {total / 1e6:.2f} MB of entries and turn files", flush=True)
    return idx


def write_plan(out: Path, phases: list, spots) -> None:
    """plan.json: the flop count each spot is being built to (assemble.py's targets, the Library page's bars)."""
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "plan.json.tmp"
    tmp.write_text(json.dumps({"spots": {s.id: max(phases) for s in spots}, "phases": phases,
                               "flops": flops(max(phases))}, indent=1))
    os.replace(tmp, out / "plan.json")


# ----------------------------------------------------------------------------- the build
def proc_stats(pid: int):
    """(resident MB, CPU seconds, stopped) of a process; (0, 0, False) once gone."""
    try:
        out = subprocess.run(["/bin/ps", "-o", "rss=,time=,stat=", "-p", str(pid)], capture_output=True,
                             text=True).stdout.split()
        if len(out) < 3:
            return 0.0, 0.0, False
        days, _, t = out[1].rpartition("-")
        secs = 0.0
        for part in t.split(":"):
            secs = secs * 60 + float(part)
        return int(out[0]) / 1024, secs + (int(days) * 86400 if days else 0), out[2].startswith("T")
    except (OSError, ValueError):
        return 0.0, 0.0, False


def todo_list(out: Path, phases: list, spots, skip: set) -> list:
    """[(spot, flop, tree)] still to solve, phase by phase, flop by flop over the spots (a stop leaves every spot with
    about as many flops)."""
    jobs, seen = [], set()
    for n in phases:
        for nm in flops(n):
            for s in spots:
                if (s.id, nm) in seen or f"{s.id}/{nm}" in skip:
                    continue
                seen.add((s.id, nm))
                if on_disk(out, s, nm) is None:
                    jobs.append((s.id, nm, s.tree))
    return jobs


def run(a) -> int:
    out = a.out.resolve()
    write_plan(out, a.phases, a.spots)
    over_p, fail_p = out / "over-memory.json", out / "failed.json"
    over = json.loads(over_p.read_text()) if over_p.exists() else {}
    fails = json.loads(fail_p.read_text()) if fail_p.exists() else {}

    def save(p, d):
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, indent=0, sort_keys=True))
        os.replace(tmp, p)
    stop = {"now": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__("now", True))
    signal.signal(signal.SIGINT, lambda *_: stop.__setitem__("now", True))
    opts = json.dumps({"min_iters": a.min_iters, "max_iters": a.max_iters, "check": a.check, "target": a.target})
    done = failed = since_index = 0
    t0 = time.time()
    rounds = 0
    until = float(a.until or 0)

    def past_deadline() -> bool:
        if until and time.time() >= until and not stop["now"]:
            print(f"=== {time.strftime('%F %T')} the build's time is up ({time.strftime('%F %T', time.localtime(until))},"
                  f" DEADLINE_H): stopping; `start` again resumes", flush=True)
            stop["now"] = "deadline"
        return bool(stop["now"])
    while not past_deadline():
        given_up = {k for k, v in fails.items() if v >= a.retries}
        jobs = todo_list(out, a.phases, a.spots, given_up)
        # a flop over --max-mb with the river dealt before goes straight to the old tree (unless --max-mb grew)
        jobs = [(sid, nm, "old" if over.get(f"{sid}/{nm}", 0) > a.max_mb else tr) for sid, nm, tr in jobs]
        if a.limit:
            jobs = jobs[: max(0, a.limit - done)]
        if not jobs:
            break
        rounds += 1
        print(f"=== {time.strftime('%F %T')} round {rounds}: {len(jobs)} entries to solve, {a.jobs} processes, max "
              f"{a.max_mb} MB a process, out {out}", flush=True)
        queue = list(jobs)
        running: dict = {}  # pid -> [Popen, job, started, peak MB, cpu at last progress, time of last progress]
        while (queue or running) and not past_deadline():
            while queue and len(running) < a.jobs and not stop["now"]:
                job = queue.pop(0)
                p = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_one", *job, "--solver",
                                      str(a.solver), "--out", str(out), "--set", a.set, "--opts", opts],
                                     stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True, start_new_session=True)
                running[p.pid] = [p, job, time.time(), 0.0, 0.0, time.time()]
            time.sleep(1)
            for pid, rec in list(running.items()):
                p, job, started, peak, cpu0, t_prog = rec
                sid, nm, tree = job
                mb, cpu, paused = proc_stats(pid)
                rec[3] = peak = max(peak, mb)
                if p.poll() is None:
                    if paused or cpu - cpu0 >= 5.0:
                        rec[4], rec[5] = cpu, time.time()
                    if mb > a.max_mb:
                        p.kill()
                        p.wait()
                        del running[pid]
                        for leftover in (out / sid).glob(f"{nm}*.tmp"):
                            leftover.unlink(missing_ok=True)
                        if tree == "dealt":
                            over[f"{sid}/{nm}"] = round(mb)
                            save(over_p, over)
                            queue.insert(0, (sid, nm, "old"))
                            print(f"  {sid} {nm}: {mb:.0f} MB with the river dealt, over {a.max_mb}: stopped after "
                                  f"{time.time() - started:.0f} s, solving it on the old tree", flush=True)
                        else:
                            fails[f"{sid}/{nm}"] = a.retries
                            save(fail_p, fails)
                            failed += 1
                            print(f"  {sid} {nm}: {mb:.0f} MB on the old tree, over {a.max_mb}: left out", flush=True)
                    elif time.time() - rec[5] > a.stall_min * 60:
                        p.kill()
                        p.wait()
                        del running[pid]
                        fails[f"{sid}/{nm}"] = fails.get(f"{sid}/{nm}", 0) + 1
                        save(fail_p, fails)
                        print(f"  {sid} {nm}: no CPU used for {a.stall_min} min (a lost worker): stopped, tried "
                              f"{fails[f'{sid}/{nm}']} of {a.retries} times", flush=True)
                    continue
                del running[pid]
                text = (p.stdout.read() if p.stdout else "").strip().splitlines()
                line = next((x for x in reversed(text) if x.startswith(sid + " ")), None)
                if p.returncode != 0 or line is None:
                    # (a worker killed from outside, the memory guard's or a crash: tried again next round)
                    fails[f"{sid}/{nm}"] = fails.get(f"{sid}/{nm}", 0) + 1
                    save(fail_p, fails)
                    failed += 1
                    print(f"  {sid} {nm} ({tree}): failed, exit {p.returncode}, try {fails[f'{sid}/{nm}']} of "
                          f"{a.retries}: {' | '.join(text[-3:])}", flush=True)
                    continue
                done += 1
                since_index += 1
                el = time.time() - t0
                left = len(queue) + len(running)
                print(f"[{done}/{done + left} {el / 60:.0f} min, ~{el / done * left / 3600:.1f} h left] {line} "
                      f"watched_mb={peak:.0f}", flush=True)
                if since_index >= a.index_every:
                    write_index(out, a.spots)
                    since_index = 0
        for p, *_r in running.values():
            p.terminate()
        for p, *_r in running.values():
            try:
                p.wait(timeout=20)
            except subprocess.TimeoutExpired:
                p.kill()
        if a.limit and done >= a.limit:
            break
    if out.is_dir():
        write_index(out, a.spots)
    left = len(todo_list(out, a.phases, a.spots, set()))
    print(f"=== {time.strftime('%F %T')} {'stopped' if stop['now'] else 'finished'}: {done} solved, {failed} "
          f"failures, {left} entries left", flush=True)
    if stop["now"] == "deadline":
        (RUN / "deadline-reached").write_text(time.strftime("%F %T"))
    return 0 if stop["now"] or not left or a.limit else 3


def supervise(a) -> int:
    """run() in a child, again after an abnormal exit (killed, crashed), up to --restarts times."""
    me = Path(__file__).resolve()
    stop = {"now": False}
    child = {"p": None}

    def on_term(*_):
        stop["now"] = True
        if child["p"] is not None:
            child["p"].terminate()
    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    pidf = RUN / "supervisor.pid"
    RUN.mkdir(parents=True, exist_ok=True)
    pidf.write_text(str(os.getpid()))
    until = deadline(a)
    print(f"=== {time.strftime('%F %T')} supervise: pid {os.getpid()}, solver {a.solver}, out {a.out}, phases "
          f"{a.phases}, {len(a.spots)} spots, {a.jobs} processes; stops by "
          f"{time.strftime('%F %T', time.localtime(until))}", flush=True)
    tries = 0
    args = ["run", "--solver", str(a.solver), "--out", str(a.out), "--phases", ",".join(map(str, a.phases)),
            "--jobs", str(a.jobs), "--max-mb", str(a.max_mb), "--retries", str(a.retries),
            "--stall-min", str(a.stall_min), "--spots", ",".join(s.id for s in a.spots), "--until", str(until),
            "--set", a.set]
    while not stop["now"] and time.time() < until:
        print(f"=== {time.strftime('%F %T')} supervise: run (attempt {tries + 1})", flush=True)
        child["p"] = subprocess.Popen([sys.executable, str(me), *args])
        rc = child["p"].wait()
        child["p"] = None
        if stop["now"] or rc == 0:
            print(f"=== {time.strftime('%F %T')} supervise: run exited {rc}; done", flush=True)
            return 0
        tries += 1
        if tries > a.restarts:
            print(f"=== {time.strftime('%F %T')} supervise: run exited {rc} {tries} times; giving up", flush=True)
            return 1
        print(f"=== {time.strftime('%F %T')} supervise: run exited {rc}; again in 60 s", flush=True)
        time.sleep(60)
    return 0


def deadline(a) -> float:
    """When the build stops: DEADLINE_H (or --hours) of wall time from its first start, kept in RUN/deadline.json so a
    restart (supervise's, or `start` again) keeps the budget; --hours sets a new one from now."""
    f = RUN / "deadline.json"
    if a.hours is None and f.exists():
        try:
            return float(json.loads(f.read_text())["until"])
        except (ValueError, KeyError):
            pass
    hours = DEADLINE_H if a.hours is None else a.hours
    until = time.time() + hours * 3600
    f.write_text(json.dumps({"started": time.strftime("%F %T"), "hours": hours, "until": until,
                             "until_local": time.strftime("%F %T", time.localtime(until))}))
    return until


def code_hash() -> str:
    h = hashlib.sha1(Path(__file__).read_bytes())
    for p in sorted((ROOT / "solver").rglob("*.py")):
        if {"flop_library", "__pycache__", "build", ".venv"} & set(p.parts):
            continue
        h.update(p.relative_to(ROOT).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def freeze() -> Path:
    """A frozen copy of this script and solver/ in RUN/code-<hash> (as depths_build.py's): the build keeps running
    the code it started with whatever happens to this checkout (a worktree removed, a branch switched)."""
    snap = RUN / f"code-{code_hash()}"
    if not snap.exists():
        tmp = RUN / f".{snap.name}.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        (tmp / "scripts" / "library").mkdir(parents=True)
        shutil.copy2(Path(__file__), tmp / "scripts" / "library" / Path(__file__).name)
        shutil.copytree(ROOT / "solver", tmp / "solver",
                        ignore=shutil.ignore_patterns("flop_library", "build", "__pycache__", ".venv", "node_modules"))
        os.replace(tmp, snap)
    return snap


def start(argv: list) -> int:
    """Freezes the code, then becomes the frozen copy's `supervise` (the same process: slot.sh's slot stays held)."""
    RUN.mkdir(parents=True, exist_ok=True)
    snap = freeze()
    script = snap / "scripts" / "library" / Path(__file__).name
    rest = [x for x in argv if x != "start"]
    if "--solver" not in rest:
        rest += ["--solver", str(snap / "solver")]
    os.environ["SINGLE_SIZE_MAIN"] = str(MAIN)
    print(f"=== {time.strftime('%F %T')} start: running the frozen copy {snap}", flush=True)
    os.execv(sys.executable, [sys.executable, str(script), "supervise", *rest])
    return 0


PROGRESS = re.compile(r"^\[(\d+)/(\d+) .*?\] (\S+) (\S+) size=(\S+) iters=(\d+) expl=([\d.]+)% secs=(\d+) "
                      r"size_secs=(\d+) solve_secs=(\d+) bytes=(\d+) turns=(\d+) tree=(\w+) peak_mb=(\d+)")


def status(a) -> int:
    out = a.out.resolve()
    log = LOG   # (where start's nohup writes it)
    lines = log.read_text(errors="replace").splitlines() if log.exists() else []
    rows = [m for m in map(PROGRESS.match, lines) if m]
    pidf = RUN / "supervisor.pid"
    pid = pidf.read_text().strip() if pidf.exists() else ""
    try:
        os.kill(int(pid), 0)
        alive = True
    except (OSError, ValueError):
        alive = False
    total = len(a.spots) * max(a.phases)
    have = sum(1 for s in a.spots for p in (out / s.id).glob("*.bin") if not p.name.endswith(".turn.bin")) \
        if out.is_dir() else 0
    print(f"supervisor: {'running, pid ' + pid if alive else 'not running'}; {have} of {total} entries on disk")
    if rows:
        secs = [int(m.group(8)) for m in rows]
        byt = [int(m.group(11)) + int(m.group(12)) for m in rows]
        peak = max(int(m.group(14)) for m in rows)
        avg = sum(secs) / len(secs)
        print(f"  {len(rows)} solved in the log: {avg:.0f} s an entry, {sum(byt) / len(byt) / 1e3:.1f} KB an entry with "
              f"its turn file, peak {peak} MB; old tree {sum(m.group(13) == 'old' for m in rows)}")
        print(f"  left: {total - have} entries, ~{(total - have) * avg / 3600:.1f} core-h, "
              f"~{(total - have) * avg / 3600 / a.jobs:.1f} h with {a.jobs} workers; "
              f"~{(total - have) * sum(byt) / len(byt) / 1e6:.0f} MB more")
        print(f"  last: {lines[lines.index(rows[-1].string)][:200]}")
    for ln in [x for x in lines if not PROGRESS.match(x)][-3:]:
        print(f"  log: {ln[:200]}")
    return 0


def plan(a) -> int:
    out = a.out.resolve()
    total = 0
    for s in a.spots:
        try:
            st = setup(s)
        except Exception as e:  # noqa: BLE001  (a line the charts don't reach)
            print(f"  {s.id:<16} NOT REACHED: {e}")
            continue
        names = flops(max(a.phases))
        have = [on_disk(out, s, nm) for nm in names]
        left = have.count(None)
        total += left
        chart = (f" (the charts': {st['chart'][0].sum():.0f}/{st['chart'][1].sum():.0f}, ranges here from "
                 f"{GAMES[s.game].pf_key})") if s.game else ""
        print(f"  {s.id:<16} {have.count('dealt'):>4} dealt {have.count('old'):>4} old {left:>4} left   pot {st['pot']:<6} "
              f"stack {st['stack']:<6} combos {st['full0'].sum():.0f}/{st['full1'].sum():.0f}{chart}")
    bad = 0
    mine = {s.id for s in a.spots}
    for sid, alias in ALIASES.items():
        if sid not in mine:
            continue
        st = setup(BY_ID[sid])
        for lab, ln in alias:
            o = fl.spot_setup(ln)
            if fps(o) != fps(st) or (o["pot"], o["stack"]) != (st["pot"], st["stack"]):
                bad += 1
                print(f"  ALIAS NO LONGER MATCHES: {lab} ({ln}) is not {sid}'s game")
    print(f"{total} entries left ({len(a.spots)} spots x {max(a.phases)} flops; {sum(len(v) for k, v in ALIASES.items() if k in mine)} "
          f"lines read another spot{', ' + str(bad) + ' of them no longer match' if bad else ''})")
    return 1 if bad else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["plan", "start", "run", "supervise", "one", "index", "status", "_one", "pf-ranges"])
    ap.add_argument("rest", nargs="*")
    ap.add_argument("--set", choices=list(SETS), default="classic",
                    help="the 100bb spots (classic) or the ante and straddle games' (games): spots, folders, phases")
    ap.add_argument("--solver", type=Path, default=ROOT / "solver", help="the solver snapshot to run")
    ap.add_argument("--out", type=Path, default=None, help="default: the set's library-build/sources/ folder")
    ap.add_argument("--pf-dir", type=Path, default=ROOT / "engine" / "pf",
                    help="pf-ranges: the folder with the stored preflop games' files (engine/pf)")
    ap.add_argument("--phases", default=None)
    ap.add_argument("--spots", default="", help="comma separated spot ids (default: every spot, in order)")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--max-mb", type=int, default=MAX_MB)
    ap.add_argument("--retries", type=int, default=3, help="tries of an entry whose worker dies or stalls")
    ap.add_argument("--restarts", type=int, default=5, help="supervise: runs again after an abnormal exit")
    ap.add_argument("--stall-min", type=float, default=30.0, help="a worker using no CPU this long, not paused, is lost")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--index-every", type=int, default=20)
    ap.add_argument("--min-iters", type=int, default=200)
    ap.add_argument("--max-iters", type=int, default=1000)
    ap.add_argument("--check", type=int, default=100)
    ap.add_argument("--target", type=float, default=0.15)
    ap.add_argument("--tree", choices=["dealt", "old"], default=None, help="one: the tree (default: the spot's)")
    ap.add_argument("--hours", type=float, default=None, help=f"start/supervise: a new deadline, this many hours from "
                    f"now (default: the recorded one, else {DEADLINE_H:g})")
    ap.add_argument("--until", type=float, default=0, help=argparse.SUPPRESS)
    ap.add_argument("--opts", default=None)
    raw = list(sys.argv[1:] if argv is None else argv)
    a = ap.parse_args(argv)
    a.solver = a.solver.resolve()
    use_set(a.set)
    set_spots, _folder, set_phases = SETS[a.set]
    a.phases = sorted(int(x) for x in str(a.phases or ",".join(map(str, set_phases))).split(",") if x)
    want = [x for x in a.spots.split(",") if x]
    if [x for x in want if x not in BY_ID]:
        ap.error(f"unknown spot in {want}; spots: {list(BY_ID)}")
    a.spots = [BY_ID[x] for x in want] if want else set_spots
    a.out = (a.out or OUT).resolve()
    global _PF_OUT
    _PF_OUT = a.out
    if "gtosolver" in a.out.parts or (a.solver / "gto" / "static" / "flop_library").resolve() in [a.out, *a.out.parents]:
        sys.exit(f"refusing: --out {a.out}")
    if a.cmd == "status":
        return status(a)
    if a.cmd == "start":
        return start(raw)
    load(a.solver)
    if a.cmd == "pf-ranges":
        return make_pf_ranges(a.out, a.pf_dir.resolve(), a.spots)
    if a.cmd == "_one":
        sid, name, tree = a.rest
        print(solve_one(a.out, sid, name, tree, json.loads(a.opts)), flush=True)
        return 0
    if a.cmd == "one":
        if len(a.rest) != 2 or a.rest[0] not in BY_ID:
            ap.error(f"one SPOT FLOP; spots: {list(BY_ID)}")
        from gto.cards import cards as parse_cards
        name = fl.flop_name(parse_cards(a.rest[1]))
        opts = {"min_iters": a.min_iters, "max_iters": a.max_iters, "check": a.check, "target": a.target}
        t0 = time.time()
        print(solve_one(a.out, a.rest[0], name, a.tree or BY_ID[a.rest[0]].tree, opts), f"wall={time.time() - t0:.0f}",
              flush=True)
        return 0
    if a.cmd == "index":
        write_index(a.out, a.spots)
        return 0
    if a.cmd == "supervise":
        return supervise(a)
    return plan(a) if a.cmd == "plan" else run(a)


if __name__ == "__main__":
    sys.exit(main())
