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
(pf_icm_study.Spec.key: icm<players>_<hash of the stacks, antes, prizes, sizes and tree>), as the cash grid's carries
its model's tag, so a file of another game or tree never loads.

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
    'icm5_537c59c9ee3a5a68': 'Final-table bubble',
    'icm3_9b41af870049f4af': 'Three left',
    'icm2_60cc277c8dee7c1d': 'Heads-up',
    'icm4_e0d82a5ac3a11175': 'Sit & go bubble',
    'icm6_c90e6c239eb2fcda': 'Sit & go, 6 players',
    'icm6_30cdcd37a890364b': 'Double or nothing',
    'icm8_7dd4458f6c268b48': 'Early',
    'icm8_7cf42a99af59e8ec': 'Bubble',
    'icm9_68a50f93a72f8fa4': 'Final table',
    'icm9_fae88fa117be9df7': 'Sit & go, 9 players',
    'icm3_ed828c082920a114': 'Final table, 3 left, 10bb average, equal stacks',
    'icm3_ebf450bfd7e6377a': 'Final table, 3 left, 10bb average, chip leader on the button',
    'icm3_7b2ed2fbacb97126': 'Final table, 3 left, 10bb average, short stack in the big blind',
    'icm3_3d879865920ecec4': 'Final table, 3 left, 15bb average, equal stacks',
    'icm3_f5f87f8a801c125a': 'Final table, 3 left, 15bb average, chip leader on the button',
    'icm3_cd3b236887739c4f': 'Final table, 3 left, 15bb average, short stack in the big blind',
    'icm3_1e51ad4b34b444ad': 'Final table, 3 left, 20bb average, equal stacks',
    'icm3_93ea4574b8951743': 'Final table, 3 left, 20bb average, chip leader on the button',
    'icm3_34d34840c2de2484': 'Final table, 3 left, 20bb average, short stack in the big blind',
    'icm3_4299863b52666b40': 'Final table, 3 left, 30bb average, equal stacks',
    'icm3_eeda27f398736b47': 'Final table, 3 left, 30bb average, chip leader on the button',
    'icm3_bf4321bb601c0d4a': 'Final table, 3 left, 30bb average, short stack in the big blind',
    'icm3_a33ad932c9e0a770': 'Final table, 3 left, 40bb average, equal stacks',
    'icm3_8a5deb363fe62104': 'Final table, 3 left, 40bb average, chip leader on the button',
    'icm3_83751a69359736a2': 'Final table, 3 left, 40bb average, short stack in the big blind',
    'icm4_56096d1e28ce8f5e': 'Final table, 4 left, 10bb average, equal stacks',
    'icm4_5b4f33ae578a131a': 'Final table, 4 left, 10bb average, chip leader on the button',
    'icm4_4a3328386bf9349a': 'Final table, 4 left, 10bb average, short stack in the big blind',
    'icm4_9131424b018f6e60': 'Final table, 4 left, 15bb average, equal stacks',
    'icm4_87060b531a486676': 'Final table, 4 left, 15bb average, chip leader on the button',
    'icm4_e3602bdece58b43f': 'Final table, 4 left, 15bb average, short stack in the big blind',
    'icm4_4ae525ebd7051444': 'Final table, 4 left, 20bb average, equal stacks',
    'icm4_08c60288861cb0df': 'Final table, 4 left, 20bb average, chip leader on the button',
    'icm4_06dd265ab67818e4': 'Final table, 4 left, 20bb average, short stack in the big blind',
    'icm4_557c2d5780ac0110': 'Final table, 4 left, 30bb average, equal stacks',
    'icm4_4c29dbf5cdb14cf0': 'Final table, 4 left, 30bb average, chip leader on the button',
    'icm4_fedf6993857e4d7e': 'Final table, 4 left, 30bb average, short stack in the big blind',
    'icm4_7dbba5bf9a75eea4': 'Final table, 4 left, 40bb average, equal stacks',
    'icm4_e303567ccb8cb0a7': 'Final table, 4 left, 40bb average, chip leader on the button',
    'icm4_ba5036cdc826d6f5': 'Final table, 4 left, 40bb average, short stack in the big blind',
    'icm5_57688b42e35f7351': 'Final table, 5 left, 10bb average, equal stacks',
    'icm5_1d070e01e72c02cb': 'Final table, 5 left, 10bb average, chip leader on the button',
    'icm5_28982b2ffef2071d': 'Final table, 5 left, 10bb average, short stack in the big blind',
    'icm5_1e763f0bbf6735ef': 'Final table, 5 left, 15bb average, equal stacks',
    'icm5_526b961bddb845d5': 'Final table, 5 left, 15bb average, chip leader on the button',
    'icm5_b01fa86219bde8b5': 'Final table, 5 left, 15bb average, short stack in the big blind',
    'icm5_7a8dc647dec3922b': 'Final table, 5 left, 20bb average, equal stacks',
    'icm5_8d909dc2eadb6cd1': 'Final table, 5 left, 20bb average, chip leader on the button',
    'icm5_ef010cf57af63fe0': 'Final table, 5 left, 20bb average, short stack in the big blind',
    'icm5_80fa23171a212fa9': 'Final table, 5 left, 30bb average, equal stacks',
    'icm5_69b0996559b57318': 'Final table, 5 left, 30bb average, chip leader on the button',
    'icm5_ffa9a8fbd2025873': 'Final table, 5 left, 30bb average, short stack in the big blind',
    'icm5_3950bd3f167f385a': 'Final table, 5 left, 40bb average, equal stacks',
    'icm5_1084c383274904e8': 'Final table, 5 left, 40bb average, chip leader on the button',
    'icm5_1bce662533098d19': 'Final table, 5 left, 40bb average, short stack in the big blind',
    'icm6_4c0dffff7f39ce86': 'Final table, 6 left, 10bb average, equal stacks',
    'icm6_14739071f88b4f7c': 'Final table, 6 left, 10bb average, chip leader on the button',
    'icm6_e30d741890314df4': 'Final table, 6 left, 10bb average, short stack in the big blind',
    'icm6_3117325f478c5bad': 'Final table, 6 left, 15bb average, equal stacks',
    'icm6_0f7b5de13efa551f': 'Final table, 6 left, 15bb average, chip leader on the button',
    'icm6_884829a4f5fd9f64': 'Final table, 6 left, 15bb average, short stack in the big blind',
    'icm6_2148b9128528cc92': 'Final table, 6 left, 20bb average, equal stacks',
    'icm6_ecb5d9623e561206': 'Final table, 6 left, 20bb average, chip leader on the button',
    'icm6_64f0a405e2fb43e1': 'Final table, 6 left, 20bb average, short stack in the big blind',
    'icm6_77bdaa9f770042bd': 'Final table, 6 left, 30bb average, equal stacks',
    'icm6_efd067b968b2c0aa': 'Final table, 6 left, 30bb average, chip leader on the button',
    'icm6_6493c39bcbd92d45': 'Final table, 6 left, 30bb average, short stack in the big blind',
    'icm6_f290456fb76c9783': 'Final table, 6 left, 40bb average, equal stacks',
    'icm6_7231c93ddad26ce6': 'Final table, 6 left, 40bb average, chip leader on the button',
    'icm6_9870cd855398cc94': 'Final table, 6 left, 40bb average, short stack in the big blind',
    'icm7_4b82307779e8614e': 'Final table, 7 left, 10bb average, equal stacks',
    'icm7_29a6ce7170036afa': 'Final table, 7 left, 10bb average, chip leader on the button',
    'icm7_c1cd15e6ac3dab9e': 'Final table, 7 left, 10bb average, short stack in the big blind',
    'icm7_8161188b8f067559': 'Final table, 7 left, 15bb average, equal stacks',
    'icm7_8a7342fab41dad7a': 'Final table, 7 left, 15bb average, chip leader on the button',
    'icm7_4217104d29f2e245': 'Final table, 7 left, 15bb average, short stack in the big blind',
    'icm7_b9c7c969bc3cee6e': 'Final table, 7 left, 20bb average, equal stacks',
    'icm7_9755837e4b2ae48f': 'Final table, 7 left, 20bb average, chip leader on the button',
    'icm7_9854ef7f11d26010': 'Final table, 7 left, 20bb average, short stack in the big blind',
    'icm7_8e4a3fea0dac724a': 'Final table, 7 left, 30bb average, equal stacks',
    'icm7_d1aed8f03e5343e0': 'Final table, 7 left, 30bb average, chip leader on the button',
    'icm7_1839483e93936c11': 'Final table, 7 left, 30bb average, short stack in the big blind',
    'icm7_b16ec6f008f71fec': 'Final table, 7 left, 40bb average, equal stacks',
    'icm7_7c9c1b8d0752ab51': 'Final table, 7 left, 40bb average, chip leader on the button',
    'icm7_10c2a8f98e688289': 'Final table, 7 left, 40bb average, short stack in the big blind',
    'icm8_04bdd2ec8cff9e84': 'Final table, 8 left, 10bb average, equal stacks',
    'icm8_fe4e99fd3f02cdf2': 'Final table, 8 left, 10bb average, chip leader on the button',
    'icm8_68e338d08a5d8728': 'Final table, 8 left, 10bb average, short stack in the big blind',
    'icm8_f18b9570f8e2820d': 'Final table, 8 left, 15bb average, equal stacks',
    'icm8_4fee7b1d77fca33c': 'Final table, 8 left, 15bb average, chip leader on the button',
    'icm8_29b06754b4ba5612': 'Final table, 8 left, 15bb average, short stack in the big blind',
    'icm8_d9ef91c77bb9883d': 'Final table, 8 left, 20bb average, equal stacks',
    'icm8_4fe5c4dde1294f09': 'Final table, 8 left, 20bb average, chip leader on the button',
    'icm8_92badbbbdce0af3c': 'Final table, 8 left, 20bb average, short stack in the big blind',
    'icm8_54635e33e6ac554c': 'Final table, 8 left, 30bb average, equal stacks',
    'icm8_d21870e9392164e7': 'Final table, 8 left, 30bb average, chip leader on the button',
    'icm8_e05f5b7d16c47cbd': 'Final table, 8 left, 30bb average, short stack in the big blind',
    'icm8_1c3fc425b5c50e4e': 'Final table, 8 left, 40bb average, equal stacks',
    'icm8_466b484767d44488': 'Final table, 8 left, 40bb average, chip leader on the button',
    'icm8_6753c35e0efc47cf': 'Final table, 8 left, 40bb average, short stack in the big blind',
    'icm9_1a2e5c6770f24c22': 'Final table, 9 left, 10bb average, equal stacks',
    'icm9_4fd297ff8f369b6a': 'Final table, 9 left, 10bb average, chip leader on the button',
    'icm9_f8fba9db22de0cc6': 'Final table, 9 left, 10bb average, short stack in the big blind',
    'icm9_cc2a27df1ac50311': 'Final table, 9 left, 15bb average, equal stacks',
    'icm9_61f62c92a690299c': 'Final table, 9 left, 15bb average, chip leader on the button',
    'icm9_8a8f3ebd1d6fb6a5': 'Final table, 9 left, 15bb average, short stack in the big blind',
    'icm9_67d9c8af1b74c631': 'Final table, 9 left, 20bb average, equal stacks',
    'icm9_d39029f7f9217226': 'Final table, 9 left, 20bb average, chip leader on the button',
    'icm9_eb234c17335fedd0': 'Final table, 9 left, 20bb average, short stack in the big blind',
    'icm9_4db2769ee7a7ea03': 'Final table, 9 left, 30bb average, equal stacks',
    'icm9_583a18472a4e020e': 'Final table, 9 left, 30bb average, chip leader on the button',
    'icm9_823f8724065bc38d': 'Final table, 9 left, 30bb average, short stack in the big blind',
    'icm9_ea5b050c3174b31c': 'Final table, 9 left, 40bb average, equal stacks',
    'icm9_a373cb33e9ca3b81': 'Final table, 9 left, 40bb average, chip leader on the button',
    'icm9_50e302994f71d2af': 'Final table, 9 left, 40bb average, short stack in the big blind',
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
