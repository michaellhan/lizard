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
the cash grid's calibrated flop model (engine/pf_model.py, pf_icm.FLOP_MODEL_TAG "cal2"), not upstream's, whose join at a
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
    'icm5_b3cc807bcc23fc2d': 'Final-table bubble',
    'icm3_4d1d3a5fbfce119f': 'Three left',
    'icm2_2210c85c39bba280': 'Heads-up',
    'icm4_667d2184e820a26e': 'Sit & go bubble',
    'icm6_0f0853e2ce205e42': 'Sit & go, 6 players',
    'icm6_a662da82bdda3270': 'Double or nothing',
    'icm8_650d48a9bf85abdf': 'Early',
    'icm8_8270e6b328004da1': 'Bubble',
    'icm9_0c5d76f5937f87ab': 'Final table',
    'icm9_779d63215f2457d6': 'Sit & go, 9 players',
    'icm3_3e3566f00f6a6ed0': 'Final table, 3 left, 10bb average, equal stacks',
    'icm3_757a5a2d62b0013b': 'Final table, 3 left, 10bb average, chip leader on the button',
    'icm3_f392e2df36d31662': 'Final table, 3 left, 10bb average, short stack in the big blind',
    'icm3_9cbc099f31f1b2ba': 'Final table, 3 left, 15bb average, equal stacks',
    'icm3_80f8a026966a7bb8': 'Final table, 3 left, 15bb average, chip leader on the button',
    'icm3_7276768678e5a867': 'Final table, 3 left, 15bb average, short stack in the big blind',
    'icm3_c234661cc97983f1': 'Final table, 3 left, 20bb average, equal stacks',
    'icm3_944e6e8cbb7c8c5a': 'Final table, 3 left, 20bb average, chip leader on the button',
    'icm3_879a4c187be5a48b': 'Final table, 3 left, 20bb average, short stack in the big blind',
    'icm3_a4a97570e3bef3d8': 'Final table, 3 left, 30bb average, equal stacks',
    'icm3_56d4a2a388186cb0': 'Final table, 3 left, 30bb average, chip leader on the button',
    'icm3_b2b5cca2ad373c1f': 'Final table, 3 left, 30bb average, short stack in the big blind',
    'icm3_b0e028acc396dbee': 'Final table, 3 left, 40bb average, equal stacks',
    'icm3_e01b5f75cde2c869': 'Final table, 3 left, 40bb average, chip leader on the button',
    'icm3_fd8cea9133633a8c': 'Final table, 3 left, 40bb average, short stack in the big blind',
    'icm4_a0c0750ef2fc49da': 'Final table, 4 left, 10bb average, equal stacks',
    'icm4_0830a3b29ca014b4': 'Final table, 4 left, 10bb average, chip leader on the button',
    'icm4_62c8dbf6c9e0ae61': 'Final table, 4 left, 10bb average, short stack in the big blind',
    'icm4_3ebf09d1d1f2038a': 'Final table, 4 left, 15bb average, equal stacks',
    'icm4_9339b4be51316634': 'Final table, 4 left, 15bb average, chip leader on the button',
    'icm4_8a1b7548243ba49c': 'Final table, 4 left, 15bb average, short stack in the big blind',
    'icm4_ec6c4f01fe389544': 'Final table, 4 left, 20bb average, equal stacks',
    'icm4_c02ec01502c3f7e9': 'Final table, 4 left, 20bb average, chip leader on the button',
    'icm4_cb18cb7b81e08102': 'Final table, 4 left, 20bb average, short stack in the big blind',
    'icm4_dbea94e5c0954033': 'Final table, 4 left, 30bb average, equal stacks',
    'icm4_48490ff66b72af2d': 'Final table, 4 left, 30bb average, chip leader on the button',
    'icm4_9aa6f541b3234047': 'Final table, 4 left, 30bb average, short stack in the big blind',
    'icm4_8a53efc67027efd8': 'Final table, 4 left, 40bb average, equal stacks',
    'icm4_006894a7afc8e0c5': 'Final table, 4 left, 40bb average, chip leader on the button',
    'icm4_8c0aaefbe2353e74': 'Final table, 4 left, 40bb average, short stack in the big blind',
    'icm5_1eded46c9ccac1eb': 'Final table, 5 left, 10bb average, equal stacks',
    'icm5_7069dc6e322e70e1': 'Final table, 5 left, 10bb average, chip leader on the button',
    'icm5_62ce55d9690e3086': 'Final table, 5 left, 10bb average, short stack in the big blind',
    'icm5_1b6e98cc5c0b98c4': 'Final table, 5 left, 15bb average, equal stacks',
    'icm5_3c0ea206e96cfb2a': 'Final table, 5 left, 15bb average, chip leader on the button',
    'icm5_e2e0cec07c29201b': 'Final table, 5 left, 15bb average, short stack in the big blind',
    'icm5_3ca4d391f631b92e': 'Final table, 5 left, 20bb average, equal stacks',
    'icm5_5e596435e15b036a': 'Final table, 5 left, 20bb average, chip leader on the button',
    'icm5_5a00c1008465f009': 'Final table, 5 left, 20bb average, short stack in the big blind',
    'icm5_afacf4ae66832f61': 'Final table, 5 left, 30bb average, equal stacks',
    'icm5_c861898201787e7a': 'Final table, 5 left, 30bb average, chip leader on the button',
    'icm5_e904f41f2a6a7b77': 'Final table, 5 left, 30bb average, short stack in the big blind',
    'icm5_406307112822fa09': 'Final table, 5 left, 40bb average, equal stacks',
    'icm5_fbb199e31575fd55': 'Final table, 5 left, 40bb average, chip leader on the button',
    'icm5_fb311b1c8c2d18f0': 'Final table, 5 left, 40bb average, short stack in the big blind',
    'icm6_36eabbe46190166c': 'Final table, 6 left, 10bb average, equal stacks',
    'icm6_6e363efd418b43bd': 'Final table, 6 left, 10bb average, chip leader on the button',
    'icm6_b9295e8bda912c3e': 'Final table, 6 left, 10bb average, short stack in the big blind',
    'icm6_5a05d9bd2540a1f4': 'Final table, 6 left, 15bb average, equal stacks',
    'icm6_a81ba23b4ab65cf7': 'Final table, 6 left, 15bb average, chip leader on the button',
    'icm6_df3e7aff92355c86': 'Final table, 6 left, 15bb average, short stack in the big blind',
    'icm6_b9c6aab48df9344c': 'Final table, 6 left, 20bb average, equal stacks',
    'icm6_cbeb6eaff4d93e94': 'Final table, 6 left, 20bb average, chip leader on the button',
    'icm6_037b792774bb069e': 'Final table, 6 left, 20bb average, short stack in the big blind',
    'icm6_7753e1fc9aa21723': 'Final table, 6 left, 30bb average, equal stacks',
    'icm6_7e253e842a0eece5': 'Final table, 6 left, 30bb average, chip leader on the button',
    'icm6_c78f86215e9a1b55': 'Final table, 6 left, 30bb average, short stack in the big blind',
    'icm6_0e93443a9e4d5156': 'Final table, 6 left, 40bb average, equal stacks',
    'icm6_d68cbf1408e379dc': 'Final table, 6 left, 40bb average, chip leader on the button',
    'icm6_b66a03e9a38e7619': 'Final table, 6 left, 40bb average, short stack in the big blind',
    'icm7_99c9e6411b24b167': 'Final table, 7 left, 10bb average, equal stacks',
    'icm7_61fa890477718104': 'Final table, 7 left, 10bb average, chip leader on the button',
    'icm7_94e53502e7c4cb62': 'Final table, 7 left, 10bb average, short stack in the big blind',
    'icm7_71ee974c6a885a95': 'Final table, 7 left, 15bb average, equal stacks',
    'icm7_91eaf31ace53a9ba': 'Final table, 7 left, 15bb average, chip leader on the button',
    'icm7_1cd511da26302a89': 'Final table, 7 left, 15bb average, short stack in the big blind',
    'icm7_b93d5810fe3a5e40': 'Final table, 7 left, 20bb average, equal stacks',
    'icm7_a97e303764967a28': 'Final table, 7 left, 20bb average, chip leader on the button',
    'icm7_a7596e12c5f87feb': 'Final table, 7 left, 20bb average, short stack in the big blind',
    'icm7_d5de59a2a638b26c': 'Final table, 7 left, 30bb average, equal stacks',
    'icm7_747c1d292bc301ba': 'Final table, 7 left, 30bb average, chip leader on the button',
    'icm7_f7c0bd6783174294': 'Final table, 7 left, 30bb average, short stack in the big blind',
    'icm7_c0fa6a8d1ed6f2f5': 'Final table, 7 left, 40bb average, equal stacks',
    'icm7_35cb751e0ac0dea2': 'Final table, 7 left, 40bb average, chip leader on the button',
    'icm7_cf90b4a3359344fd': 'Final table, 7 left, 40bb average, short stack in the big blind',
    'icm8_a38efc60d601c214': 'Final table, 8 left, 10bb average, equal stacks',
    'icm8_d5188dc7c0a139c6': 'Final table, 8 left, 10bb average, chip leader on the button',
    'icm8_faf29ea3a3faa615': 'Final table, 8 left, 10bb average, short stack in the big blind',
    'icm8_31424264ea407ae5': 'Final table, 8 left, 15bb average, equal stacks',
    'icm8_5cdbe2d6a932fb80': 'Final table, 8 left, 15bb average, chip leader on the button',
    'icm8_cfff3fc95bf2bebe': 'Final table, 8 left, 15bb average, short stack in the big blind',
    'icm8_db27422adf1f75f6': 'Final table, 8 left, 20bb average, equal stacks',
    'icm8_8ab5051247426c69': 'Final table, 8 left, 20bb average, chip leader on the button',
    'icm8_9e454277ef028730': 'Final table, 8 left, 20bb average, short stack in the big blind',
    'icm8_ddfc4b352efe362c': 'Final table, 8 left, 30bb average, equal stacks',
    'icm8_e6fab2f517ecf8f6': 'Final table, 8 left, 30bb average, chip leader on the button',
    'icm8_d9189caf8a7d7b2c': 'Final table, 8 left, 30bb average, short stack in the big blind',
    'icm8_0c35b42e362d31b4': 'Final table, 8 left, 40bb average, equal stacks',
    'icm8_c716e89161762c2a': 'Final table, 8 left, 40bb average, chip leader on the button',
    'icm8_d2ced6f9e48bdd05': 'Final table, 8 left, 40bb average, short stack in the big blind',
    'icm9_8cffa38233f37651': 'Final table, 9 left, 10bb average, equal stacks',
    'icm9_78cb220a56893804': 'Final table, 9 left, 10bb average, chip leader on the button',
    'icm9_864ae2bb2cee2a3d': 'Final table, 9 left, 10bb average, short stack in the big blind',
    'icm9_6b71c578cfd638a8': 'Final table, 9 left, 15bb average, equal stacks',
    'icm9_b6849d29bf0b0a3f': 'Final table, 9 left, 15bb average, chip leader on the button',
    'icm9_2b8f4174b274c396': 'Final table, 9 left, 15bb average, short stack in the big blind',
    'icm9_b4a01ac69a5dd5f1': 'Final table, 9 left, 20bb average, equal stacks',
    'icm9_f503d390064bbe56': 'Final table, 9 left, 20bb average, chip leader on the button',
    'icm9_109c2eff3a0de346': 'Final table, 9 left, 20bb average, short stack in the big blind',
    'icm9_4da98521620cf7e4': 'Final table, 9 left, 30bb average, equal stacks',
    'icm9_1375c0ec1d9c9f31': 'Final table, 9 left, 30bb average, chip leader on the button',
    'icm9_75603ff4ee489702': 'Final table, 9 left, 30bb average, short stack in the big blind',
    'icm9_99e866ac50a14658': 'Final table, 9 left, 40bb average, equal stacks',
    'icm9_992c24b03a446e1c': 'Final table, 9 left, 40bb average, chip leader on the button',
    'icm9_fef707f5acc16bf3': 'Final table, 9 left, 40bb average, short stack in the big blind',
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
