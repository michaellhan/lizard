"""Stored tournament preflop solves: the stage and format presets the page offers (web/src/features/tournaments/
tournament.ts STAGE_PRESETS and FORMAT_PRESETS) and a small final-table set (FINAL_TABLE_SET, the page's
finalTableSet), solved once in prize equity by engine/pf_icm.py, so the worker answers them from a file at once and
Practice and Analyze can grade a tournament's preflop by them.

Each is the request Practice sends for a session set to that spot (`request`: the table's stack is the biggest, the
other seats' own stacks, the preset's ante, the prizes left and the other tables as `tournamentRequest` sends them), its
game as engine/pf_icm_study.spec_of reads it, PS.STORED_ITERS iterations of the same DCFR, packed by pf_study.pack. They
are stored as the cash grid is (engine/pf_stored.py, scripts/pf/build_stored.py): one file a game, engine/pf_icm/<key>.bin,
built one game a process by scripts/pf_icm/build_stored.py, which logs each to engine/pf_icm/built.jsonl and, with
--missing, builds only those with no file yet (so a stopped build resumes where it was). The manifest,
engine/pf_icm/stages.json (each one's name, set, key, request and distance from equilibrium), is what
web/src/features/practice/pfIcmStored.test.ts holds the page's lists to. The worker reads them from the site's pf/ folder
(scripts/build-solver-assets.mjs copies them there), natively from engine/pf_icm/. The key is the ICM game's own
(pf_icm_study.Spec.key: icm<players>_<hash of the stacks, antes, prizes, sizes, tree and flop model>), as the cash
grid's carries its model's tag, so a file of another game, tree or model never loads. Since 2026-11-18 they are solved on
the cash grid's calibrated flop model (engine/pf_model.py, pf_icm.FLOP_MODEL_TAG "cal1"), not upstream's, whose join at a
library range's edge had the Early preset's hijack open QTo and fold QJo (scripts/engine/test_pf_icm_order.py).

In Practice a session set to one of them, graded by the solve, is played on its tree (practice.ts `pfOptions`): your
options at a spot it reads are its own, and the opponents' preflop moves are drawn from it (pf_icm_study.play, asked by
the request's `pf_play`), as the charts' 2.5bb-and-fold buttons and moves left the tree at most spots
(scripts/pf_icm/coverage.py; docs/ACCURACY.md 20.5).

The 8- and 9-player presets (Early, Bubble, Final table, the 9-player sit & go's start) are stored since 2026-11-13 on
the 7-9 handed tree (pf_icm_study.Spec.cold4: nobody cold 4bets or cold-calls a 3bet, at most two see a flop), 1,300 to
3,300 nodes, where the full tree took 12,000 to 109,000 nodes and 2 to 5 GB. The spin is one prize (chip EV): Practice
sends it as a cash game, which the stored grid answers (engine/pf_stored.py).

The final-table set: the last 3 to 9 players of a 9-paid final table (FINAL_TABLE's last places paid), at an average stack
of FT_DEPTHS bb, in three shapes (FT_SHAPES: equal stacks, the chip leader on the button with twice the average, a short
big blind with 0.4 of it), a 1bb big-blind ante as each seat's share, no other tables. Lizard's own shapes, not any
site's.
"""
from __future__ import annotations

import os
import sys
from typing import Dict, List, Optional, Tuple

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
    ("Early", 8, (60,) * 8, None, (992, 60), None),
    ("Bubble", 8, (22, 48, 10, 35, 6, 28, 14, 18), None, (108, 25), None),
    ("Final table", 9, (27, 9, 62, 16, 34, 6, 45, 12, 21), FINAL_TABLE, None, None),
    ("Sit & go, 9 players", 9, (75,) * 9, [50, 30, 20], None, 0.0),
)

# the final-table set: players left of a 9-paid final table, average stack (bb), and stack shapes
FT_PLAYERS = (3, 4, 5, 6, 7, 8, 9)
FT_DEPTHS = (10, 15, 20, 30, 40)
FT_SHAPES = ("equal", "leader", "short")
FT_SHAPE_WORDS = {"equal": "equal stacks", "leader": "chip leader on the button", "short": "short stack in the big blind"}


def _tenth(x: float) -> float:
    """Down to 0.1bb, as the page's finalTableStacks does (floor, so the two agree to the bit)."""
    import math
    return math.floor(x * 10 + 1e-9) / 10


def ft_stacks(players: int, avg: float, shape: str) -> Tuple[float, ...]:
    """Each seat's chips in seat order (SEATS[players]: the button third from the end, the big blind last)."""
    if shape == "equal":
        return (float(avg),) * players
    special = 2.0 * avg if shape == "leader" else _tenth(0.4 * avg)
    rest = _tenth((players * avg - special) / (players - 1))
    at = players - 3 if shape == "leader" else players - 1
    return tuple(special if i == at else rest for i in range(players))


def ft_name(players: int, avg: float, shape: str) -> str:
    return f"Final table, {players} left, {avg:g}bb average, {FT_SHAPE_WORDS[shape]}"


FINAL_TABLE_SET = tuple((ft_name(n, d, sh), n, ft_stacks(n, d, sh), FINAL_TABLE[:n], None, None)
                        for n in FT_PLAYERS for d in FT_DEPTHS for sh in FT_SHAPES)
ALL = STAGES + FINAL_TABLE_SET


def curve_of(places: int) -> List[float]:
    """tournament.ts curveOf: place k in proportion to k^-0.8, in % rounded to 0.1 (JavaScript's Math.round: half up)."""
    import math
    w = [(k + 1) ** -0.8 for k in range(places)]
    tot = sum(w)
    return [math.floor(x / tot * 1000 + 0.5) / 10 for x in w]


def set_of(name: str) -> str:
    """'stage' (a stage or format preset) or 'final table' (the final-table set)."""
    return "stage" if any(s[0] == name for s in STAGES) else "final table"


def stage_ante(players: int) -> float:
    """tournament.ts stageAnte: a 1bb big-blind ante as each seat's share, rounded to 0.01bb."""
    import math
    return math.floor(100 / players + 0.5) / 100        # (Math.round, half up: 8 players 0.13, as the page)


def request(stage) -> dict:
    """The preflop-solve request Practice sends at a hand of a session set to this preset (practice.ts stateFor and
    pfState: the hand's stack the biggest, ownStacks the seats with other chips, the ante, tournamentRequest's prizes)."""
    name, n, stacks, pay, field, ante = stage
    if pay is None:     # (Early and Bubble: tournament.ts's curveOf over the places paid)
        pay = curve_of(150 if name == "Early" else 115)
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
    'icm5_2af0c8630a3e0dcb': 'Final-table bubble',
    'icm3_7f1f4a95c45b0e5a': 'Three left',
    'icm2_4fbe74424c05b3c7': 'Heads-up',
    'icm4_7977fc0c5f2aab6e': 'Sit & go bubble',
    'icm6_77fc5445965a1fe2': 'Sit & go, 6 players',
    'icm6_c04bba4775d14baa': 'Double or nothing',
    'icm8_28d33d6554521604': 'Early',
    'icm8_e00ec782d7ec1a65': 'Bubble',
    'icm9_c261337ded1f6129': 'Final table',
    'icm9_471377294e83be34': 'Sit & go, 9 players',
    'icm3_32d63554fc52aee2': 'Final table, 3 left, 10bb average, equal stacks',
    'icm3_a8e4ba29f50cafbe': 'Final table, 3 left, 10bb average, chip leader on the button',
    'icm3_c2e484e532d0d4d6': 'Final table, 3 left, 10bb average, short stack in the big blind',
    'icm3_25b2b526e616a114': 'Final table, 3 left, 15bb average, equal stacks',
    'icm3_d80a7fb1c420bb5e': 'Final table, 3 left, 15bb average, chip leader on the button',
    'icm3_f47288e26ee219b7': 'Final table, 3 left, 15bb average, short stack in the big blind',
    'icm3_c3d1da662937db68': 'Final table, 3 left, 20bb average, equal stacks',
    'icm3_156c08b3f34e394e': 'Final table, 3 left, 20bb average, chip leader on the button',
    'icm3_beb2dd43d8fccc73': 'Final table, 3 left, 20bb average, short stack in the big blind',
    'icm3_db8df0ea807c9034': 'Final table, 3 left, 30bb average, equal stacks',
    'icm3_a6b56663b3c00834': 'Final table, 3 left, 30bb average, chip leader on the button',
    'icm3_49f2ed8236169a14': 'Final table, 3 left, 30bb average, short stack in the big blind',
    'icm3_02f94c1f0da33daf': 'Final table, 3 left, 40bb average, equal stacks',
    'icm3_7665779f5e1ef73c': 'Final table, 3 left, 40bb average, chip leader on the button',
    'icm3_2c9034a42dd64036': 'Final table, 3 left, 40bb average, short stack in the big blind',
    'icm4_8c8fc668d690d2f8': 'Final table, 4 left, 10bb average, equal stacks',
    'icm4_e82c064522a62f69': 'Final table, 4 left, 10bb average, chip leader on the button',
    'icm4_fa655dc178b74a7e': 'Final table, 4 left, 10bb average, short stack in the big blind',
    'icm4_7ab597d427290cc1': 'Final table, 4 left, 15bb average, equal stacks',
    'icm4_0471012bf7afd5e1': 'Final table, 4 left, 15bb average, chip leader on the button',
    'icm4_ce9f706cd665a522': 'Final table, 4 left, 15bb average, short stack in the big blind',
    'icm4_89620a19ac169202': 'Final table, 4 left, 20bb average, equal stacks',
    'icm4_5783064c6773a4db': 'Final table, 4 left, 20bb average, chip leader on the button',
    'icm4_add777b5fbd6973d': 'Final table, 4 left, 20bb average, short stack in the big blind',
    'icm4_656948b66dead82b': 'Final table, 4 left, 30bb average, equal stacks',
    'icm4_013578ed96e6c7a8': 'Final table, 4 left, 30bb average, chip leader on the button',
    'icm4_2446f868917b72d3': 'Final table, 4 left, 30bb average, short stack in the big blind',
    'icm4_0e1a8fe617d3cad4': 'Final table, 4 left, 40bb average, equal stacks',
    'icm4_6741d29833266ca9': 'Final table, 4 left, 40bb average, chip leader on the button',
    'icm4_035ba1bc7c22754d': 'Final table, 4 left, 40bb average, short stack in the big blind',
    'icm5_fd7ac367b230b00c': 'Final table, 5 left, 10bb average, equal stacks',
    'icm5_1a89eb32957bdf64': 'Final table, 5 left, 10bb average, chip leader on the button',
    'icm5_b20cc7c0e5ddc499': 'Final table, 5 left, 10bb average, short stack in the big blind',
    'icm5_a80530a77ec5d3f1': 'Final table, 5 left, 15bb average, equal stacks',
    'icm5_804776a8136d768c': 'Final table, 5 left, 15bb average, chip leader on the button',
    'icm5_3c4af1adf9f559de': 'Final table, 5 left, 15bb average, short stack in the big blind',
    'icm5_3ff211bf2e6e5ea2': 'Final table, 5 left, 20bb average, equal stacks',
    'icm5_037fe211febc73a5': 'Final table, 5 left, 20bb average, chip leader on the button',
    'icm5_de93ac500314c2f1': 'Final table, 5 left, 20bb average, short stack in the big blind',
    'icm5_fbd11567448f423a': 'Final table, 5 left, 30bb average, equal stacks',
    'icm5_e0b2af2755dc36e8': 'Final table, 5 left, 30bb average, chip leader on the button',
    'icm5_53e81af1e4deed1d': 'Final table, 5 left, 30bb average, short stack in the big blind',
    'icm5_d84a0dd6e869e9da': 'Final table, 5 left, 40bb average, equal stacks',
    'icm5_d5f6aa0ebaab05f5': 'Final table, 5 left, 40bb average, chip leader on the button',
    'icm5_6bed0ec3f3f3107f': 'Final table, 5 left, 40bb average, short stack in the big blind',
    'icm6_3de610650f5a4797': 'Final table, 6 left, 10bb average, equal stacks',
    'icm6_96f83144dada84d4': 'Final table, 6 left, 10bb average, chip leader on the button',
    'icm6_567246f425d78b1f': 'Final table, 6 left, 10bb average, short stack in the big blind',
    'icm6_9a2381f3ee41a285': 'Final table, 6 left, 15bb average, equal stacks',
    'icm6_451a1ca135ec5b6b': 'Final table, 6 left, 15bb average, chip leader on the button',
    'icm6_5475fa7f5075def3': 'Final table, 6 left, 15bb average, short stack in the big blind',
    'icm6_c1cdc491ca9c01bc': 'Final table, 6 left, 20bb average, equal stacks',
    'icm6_3fb9ba831e3ea6e3': 'Final table, 6 left, 20bb average, chip leader on the button',
    'icm6_125d089fa8db27f2': 'Final table, 6 left, 20bb average, short stack in the big blind',
    'icm6_d52b1ed6cd9f8000': 'Final table, 6 left, 30bb average, equal stacks',
    'icm6_65e70562810b8d52': 'Final table, 6 left, 30bb average, chip leader on the button',
    'icm6_f5d1ba5c47e7e8ef': 'Final table, 6 left, 30bb average, short stack in the big blind',
    'icm6_a81bdff8babf867b': 'Final table, 6 left, 40bb average, equal stacks',
    'icm6_f1141148c1e111ff': 'Final table, 6 left, 40bb average, chip leader on the button',
    'icm6_6200d713bc2a0dcc': 'Final table, 6 left, 40bb average, short stack in the big blind',
    'icm7_aaffb597351454ad': 'Final table, 7 left, 10bb average, equal stacks',
    'icm7_5f134c5d785965d4': 'Final table, 7 left, 10bb average, chip leader on the button',
    'icm7_cc6421071f04a969': 'Final table, 7 left, 10bb average, short stack in the big blind',
    'icm7_6708d77960e8f9b1': 'Final table, 7 left, 15bb average, equal stacks',
    'icm7_0cf96b8eb384e0ab': 'Final table, 7 left, 15bb average, chip leader on the button',
    'icm7_742a393ef9f93338': 'Final table, 7 left, 15bb average, short stack in the big blind',
    'icm7_b9d5fbe30735d841': 'Final table, 7 left, 20bb average, equal stacks',
    'icm7_c06556c98f9a1d3c': 'Final table, 7 left, 20bb average, chip leader on the button',
    'icm7_9f2fd8a1ae8e2011': 'Final table, 7 left, 20bb average, short stack in the big blind',
    'icm7_c7fef20e3822c8ad': 'Final table, 7 left, 30bb average, equal stacks',
    'icm7_4150bf1a63220e3f': 'Final table, 7 left, 30bb average, chip leader on the button',
    'icm7_dbb328a6777264ad': 'Final table, 7 left, 30bb average, short stack in the big blind',
    'icm7_aef35f6d0d8bac8f': 'Final table, 7 left, 40bb average, equal stacks',
    'icm7_829d2e92e11ddb3e': 'Final table, 7 left, 40bb average, chip leader on the button',
    'icm7_e6e382456fbcb868': 'Final table, 7 left, 40bb average, short stack in the big blind',
    'icm8_4831b5b4c1fd727b': 'Final table, 8 left, 10bb average, equal stacks',
    'icm8_dc94cd6ce8b7bc68': 'Final table, 8 left, 10bb average, chip leader on the button',
    'icm8_6ecbd4b7039b69bf': 'Final table, 8 left, 10bb average, short stack in the big blind',
    'icm8_c4d957e54fa0dbc1': 'Final table, 8 left, 15bb average, equal stacks',
    'icm8_24adbb6cc90ca759': 'Final table, 8 left, 15bb average, chip leader on the button',
    'icm8_d9b37e9b3920514f': 'Final table, 8 left, 15bb average, short stack in the big blind',
    'icm8_2f2160b7545b14fe': 'Final table, 8 left, 20bb average, equal stacks',
    'icm8_e1683b727242cba8': 'Final table, 8 left, 20bb average, chip leader on the button',
    'icm8_b364db5da334b54f': 'Final table, 8 left, 20bb average, short stack in the big blind',
    'icm8_dde3161a711870e0': 'Final table, 8 left, 30bb average, equal stacks',
    'icm8_874d8e93e65390e4': 'Final table, 8 left, 30bb average, chip leader on the button',
    'icm8_afc6541df00e6635': 'Final table, 8 left, 30bb average, short stack in the big blind',
    'icm8_bd9712a2ae731fe4': 'Final table, 8 left, 40bb average, equal stacks',
    'icm8_ec574975513efac3': 'Final table, 8 left, 40bb average, chip leader on the button',
    'icm8_b8479d593038275b': 'Final table, 8 left, 40bb average, short stack in the big blind',
    'icm9_f6b9341aed80a704': 'Final table, 9 left, 10bb average, equal stacks',
    'icm9_578284837221ec02': 'Final table, 9 left, 10bb average, chip leader on the button',
    'icm9_83f63a51cc4ebf2c': 'Final table, 9 left, 10bb average, short stack in the big blind',
    'icm9_57b4395501d4f0f9': 'Final table, 9 left, 15bb average, equal stacks',
    'icm9_20ac129e4e6102d2': 'Final table, 9 left, 15bb average, chip leader on the button',
    'icm9_4a248ff6f122bf16': 'Final table, 9 left, 15bb average, short stack in the big blind',
    'icm9_3f174f3b1be0b183': 'Final table, 9 left, 20bb average, equal stacks',
    'icm9_1d5c79a48fb5a765': 'Final table, 9 left, 20bb average, chip leader on the button',
    'icm9_425b4da6a8bf1fe5': 'Final table, 9 left, 20bb average, short stack in the big blind',
    'icm9_e0f0b16d71b31311': 'Final table, 9 left, 30bb average, equal stacks',
    'icm9_24c5c173a5c94a52': 'Final table, 9 left, 30bb average, chip leader on the button',
    'icm9_04f04ac83fb72125': 'Final table, 9 left, 30bb average, short stack in the big blind',
    'icm9_130d332fb24a25a4': 'Final table, 9 left, 40bb average, equal stacks',
    'icm9_f734b8bfb07ce586': 'Final table, 9 left, 40bb average, chip leader on the button',
    'icm9_e6181bd95b26eda1': 'Final table, 9 left, 40bb average, short stack in the big blind',
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
