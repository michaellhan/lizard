"""Stored tournament preflop solves: the stage and format presets the page offers (web/src/features/tournaments/
tournament.ts STAGE_PRESETS and FORMAT_PRESETS) that fit the browser, solved once in prize equity by engine/pf_icm.py, so
the worker answers them from a file at once and Practice can grade a tournament's preflop by them.

Each is the request Practice sends for a session set to that preset (`request`: the table's stack is the biggest, the
other seats' own stacks, the preset's ante, the prizes left and the other tables as `tournamentRequest` sends them), its
game as engine/pf_icm_study.spec_of reads it, PS.STORED_ITERS iterations of the same DCFR, packed by pf_study.pack. They
are built by scripts/pf_icm/build_stored.py into engine/pf_icm/<key>.bin with a manifest, engine/pf_icm/stages.json
(each one's name, key, request and distance from equilibrium), which web/src/features/practice/pfIcmStored.test.ts holds
the page's presets to. The worker reads them from the site's pf/ folder (scripts/build-solver-assets.mjs copies them
there), natively from engine/pf_icm/.

In Practice a session set to one of them, graded by the solve, is played on its tree (practice.ts `pfOptions`): your
options at a spot it reads are its own, and the opponents' preflop moves are drawn from it (pf_icm_study.play, asked by
the request's `pf_play`), as the charts' 2.5bb-and-fold buttons and moves left the tree at most spots
(scripts/pf_icm/coverage.py; docs/ACCURACY.md 20.5).

Left out, as too big: the 8- and 9-player presets (Early, Bubble, Final table, the 9-player sit & go's start). Their trees
take 13,000 to 109,000 nodes and 2 to 5 GB to build natively, over the browser's size cap (pf_icm_study.BROWSER_WORK). The
spin is one prize (chip EV): Practice sends it as a cash game, which the stored grid answers (engine/pf_stored.py).
"""
from __future__ import annotations

import os
import sys
from typing import Dict, List, Optional

from gto.preflop import SEATS

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "pf_icm")
MANIFEST = os.path.join(DIR, "stages.json")

FINAL_TABLE = [30, 20, 14, 10.5, 8, 6.5, 5, 3.5, 2.5]

# (name, players, each seat's chips in seat order, payouts, field (players, average stack) or None, ante a seat or None
# for a 1bb big-blind ante as each seat's share): tournament.ts's presets, as they are there
STAGES = (
    ("Final-table bubble", 5, (20, 40, 8, 28, 14), FINAL_TABLE, (5, 22), None),
    ("Three left", 3, (30, 55, 15), FINAL_TABLE[:3], None, None),
    ("Heads-up", 2, (40, 60), FINAL_TABLE[:2], None, None),
    ("Sit & go bubble", 4, (24, 16, 9, 18), [50, 30, 20], None, None),
    ("Sit & go, 6 players", 6, (75,) * 6, [65, 35], None, 0.0),
    ("Double or nothing", 6, (50,) * 6, [1, 1, 1], None, 0.0),
)


def stage_ante(players: int) -> float:
    """tournament.ts stageAnte: a 1bb big-blind ante as each seat's share, rounded to 0.01bb."""
    return round(100 / players) / 100


def request(stage) -> dict:
    """The preflop-solve request Practice sends at a hand of a session set to this preset (practice.ts stateFor and
    pfState: the hand's stack the biggest, ownStacks the seats with other chips, the ante, tournamentRequest's prizes)."""
    name, n, stacks, pay, field, ante = stage
    top = max(stacks)
    a = stage_ante(n) if ante is None else ante
    st = {"players": n, "stack": top, "payouts": list(pay)}
    own = {p: s for p, s in zip(SEATS[n], stacks) if s != top}
    if own:
        st["stacks"] = own
    if a:
        st["ante"] = a
    if field:
        st["field"] = {"players": field[0], "chips": round(field[0] * field[1] * 100) / 100}
    return st


# key -> preset name, written by scripts/pf_icm/build_stored.py with the manifest (scripts/engine/test_pf_icm_stored.py
# holds the two equal and to the files)
KEYS: Dict[str, str] = {
    'icm5_537c59c9ee3a5a68': 'Final-table bubble',
    'icm3_9b41af870049f4af': 'Three left',
    'icm2_60cc277c8dee7c1d': 'Heads-up',
    'icm4_e0d82a5ac3a11175': 'Sit & go bubble',
    'icm6_c90e6c239eb2fcda': 'Sit & go, 6 players',
    'icm6_30cdcd37a890364b': 'Double or nothing',
}


def read(key: str) -> Optional[bytes]:
    """A stored solve's file, or None where the key isn't one of them."""
    if key not in KEYS:
        return None
    if sys.platform == "emscripten":
        try:
            import js   # noqa: F401
            r = js.siteFetch(f"pf/{key}.bin")
            return None if r is None else r.to_bytes()
        except Exception:   # noqa: BLE001
            return None
    try:
        with open(os.path.join(DIR, key + ".bin"), "rb") as f:
            return f.read()
    except OSError:
        return None


def name_of(key: str) -> Optional[str]:
    return KEYS.get(key)
