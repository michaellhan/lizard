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

# the final-table set: players left of a 9-paid final table, average stack (bb), stack shapes and payout structures
FT_PLAYERS = (3, 4, 5, 6, 7, 8, 9)
FT_DEPTHS = (10, 15, 20, 30, 40)
FT_SHAPES = ("equal", "leader", "short")              # with every payout structure
FT_MORE_SHAPES = ("leader_bb", "short_btn")           # with Lizard's own structure only (2026-11-17)
FT_SHAPE_WORDS = {"equal": "equal stacks", "leader": "chip leader on the button", "short": "short stack in the big blind",
                  "leader_bb": "chip leader in the big blind", "short_btn": "short stack on the button"}
# the payout structures (2026-11-17): Lizard's own 9-paid final table, and the first nine places of three of WSOP Online's
# posted MTT tables (https://wsoponline.com/nj/how-to-play-poker/mtt-tournament-payouts/, read 2026-11-17; the page's
# tables are copied in web/src/features/tournaments/roomPayouts.ts), first place over ninth 8.4, 15.9 and 17.7 times
FT_PAYS: Dict[str, Tuple[List[float], str]] = {
    "": (FINAL_TABLE, "Lizard's 9-paid final table"),
    "flat": ([31, 19, 9.8, 8.8, 7.8, 6.8, 5.5, 4.4, 3.7],
             "flat: WSOP Online's top 20% paid at 41-50 entrants, its first nine places, as posted on 2026-11-17"),
    "standard": ([27, 15.75, 9, 7, 6, 5, 3.8, 2.4, 1.7],
                 "standard: WSOP Online's top 15% paid at 151-200 entrants, its first nine places, as posted on 2026-11-17"),
    "top-heavy": ([23, 13.5, 8.5, 6.5, 5.5, 3.9, 2.9, 1.9, 1.3],
                  "top-heavy: WSOP Online's top 10% paid at 801-1,000 entrants, its first nine places, as posted on 2026-11-17"),
}
FT_PAY_KEYS = tuple(FT_PAYS)


def _tenth(x: float) -> float:
    """Down to 0.1bb, as the page's finalTableStacks does (floor, so the two agree to the bit)."""
    import math
    return math.floor(x * 10 + 1e-9) / 10


def ft_stacks(players: int, avg: float, shape: str) -> Tuple[float, ...]:
    """Each seat's chips in seat order (SEATS[players]: the button third from the end, the big blind last): equal, or one
    seat with twice the average (leader: the button; leader_bb: the big blind) or 0.4 of it (short: the big blind;
    short_btn: the button), the rest sharing what's left."""
    if shape == "equal":
        return (float(avg),) * players
    special = 2.0 * avg if shape.startswith("leader") else _tenth(0.4 * avg)
    rest = _tenth((players * avg - special) / (players - 1))
    at = players - 3 if shape in ("leader", "short_btn") else players - 1
    return tuple(special if i == at else rest for i in range(players))


def ft_name(players: int, avg: float, shape: str, pay: str = "") -> str:
    return f"Final table, {players} left, {avg:g}bb average, {FT_SHAPE_WORDS[shape]}" + (f", {pay} payouts" if pay else "")


# an entry: (name, players, each seat's chips, payouts (None: tournament.ts's curve; CHIPS: chip EV), field, ante, bounty)
CHIPS = "chips"
FINAL_TABLE_SET = tuple(
    [(ft_name(n, d, sh), n, ft_stacks(n, d, sh), FINAL_TABLE[:n], None, None) for n in FT_PLAYERS for d in FT_DEPTHS
     for sh in FT_SHAPES]
    + [(ft_name(n, d, sh, pk), n, ft_stacks(n, d, sh), FT_PAYS[pk][0][:n], None, None) for pk in FT_PAY_KEYS[1:]
       for n in FT_PLAYERS for d in FT_DEPTHS for sh in FT_SHAPES]
    + [(ft_name(n, d, sh), n, ft_stacks(n, d, sh), FINAL_TABLE[:n], None, None) for n in FT_PLAYERS for d in FT_DEPTHS
       for sh in FT_MORE_SHAPES])

# the bounty set (2026-11-17): KO and PKO bounties on stage presets and on final-table spots, every head the same bounty
# (as Practice's session sets it: each seat's, the other tables' average the same), in the prizes' units, which are % of
# the prize pool. Early: 0.05 or 0.1 a head over 1,000 players is half the prizes or as much as them in bounties; Bubble:
# 0.4 or 0.8 over 116, about half or nine tenths; the final tables: 2.5 or 5 a head
BOUNTY_FORMAT_WORDS = {"ko": "KO", "pko": "PKO"}
BOUNTY_STAGES = (("Early", (("pko", 0.05), ("pko", 0.1), ("ko", 0.05))),
                 ("Bubble", (("pko", 0.4), ("pko", 0.8), ("ko", 0.4))),
                 ("Final-table bubble", (("pko", 2.5), ("pko", 5.0), ("ko", 2.5))),
                 ("Final table", (("pko", 2.5), ("pko", 5.0), ("ko", 2.5))))
BOUNTY_FT = {"players": (6, 9), "depths": (15, 30), "levels": (("pko", 2.5), ("pko", 5.0))}


def bounty_name(base: str, fmt: str, each: float) -> str:
    return f"{base}, {BOUNTY_FORMAT_WORDS[fmt]} {each:g} a head"


BOUNTY_SET = tuple(
    [(bounty_name(nm, f, e),) + next(s for s in STAGES if s[0] == nm)[1:] + ({"format": f, "each": e},)
     for nm, levels in BOUNTY_STAGES for f, e in levels]
    + [(bounty_name(ft_name(n, d, sh), f, e), n, ft_stacks(n, d, sh), FINAL_TABLE[:n], None, None, {"format": f, "each": e})
       for n in BOUNTY_FT["players"] for d in BOUNTY_FT["depths"] for sh in FT_SHAPES for f, e in BOUNTY_FT["levels"]])

# the satellite set (2026-11-17): the last players of a satellite at one table, N seats (equal prizes) for N+1 or N+2
# players left, at an average of SAT_DEPTHS bb, in the final-table set's three shapes, a 1bb big-blind ante
SAT_PLAYERS = (3, 4, 5, 6, 7, 8, 9)
SAT_DEPTHS = (10, 15, 25)


def sat_name(players: int, seats: int, avg: float, shape: str) -> str:
    return f"Satellite, {seats} seats for {players} left, {avg:g}bb average, {FT_SHAPE_WORDS[shape]}"


SATELLITE_SET = tuple((sat_name(n, k, d, sh), n, ft_stacks(n, d, sh), [1] * k, None, None)
                      for n in SAT_PLAYERS for k in (n - 1, n - 2) if k >= 2 for d in SAT_DEPTHS for sh in FT_SHAPES)

# the chip EV set (2026-11-17): the stage and format presets, and the final-table set's stacks with its three shapes,
# played for chips (no prizes): what Practice's chip EV session grades its preflop by. Not the double or nothing (equal
# 50bb stacks, 6 players, no ante): the cash grid holds that game (web/src/solver/pfStored.ts), and Practice asks it there
CHIP_NAME = "{}, chip EV"
CHIP_SET = tuple((CHIP_NAME.format(s[0]), s[1], s[2], CHIPS, None, s[5]) for s in STAGES if s[0] != "Double or nothing") + tuple(
    (CHIP_NAME.format(ft_name(n, d, sh)), n, ft_stacks(n, d, sh), CHIPS, None, None)
    for n in FT_PLAYERS for d in FT_DEPTHS for sh in FT_SHAPES)

ALL = STAGES + FINAL_TABLE_SET + BOUNTY_SET + SATELLITE_SET + CHIP_SET
_SET_OF = {**{s[0]: "stage" for s in STAGES}, **{s[0]: "final table" for s in FINAL_TABLE_SET},
           **{s[0]: "bounty" for s in BOUNTY_SET}, **{s[0]: "satellite" for s in SATELLITE_SET},
           **{s[0]: "chips" for s in CHIP_SET}}


def curve_of(places: int) -> List[float]:
    """tournament.ts curveOf: place k in proportion to k^-0.8, in % rounded to 0.1 (JavaScript's Math.round: half up)."""
    import math
    w = [(k + 1) ** -0.8 for k in range(places)]
    tot = sum(w)
    return [math.floor(x / tot * 1000 + 0.5) / 10 for x in w]


def set_of(name: str) -> str:
    """'stage' (a stage or format preset), 'final table' (the final-table set), 'bounty', 'satellite' or 'chips'."""
    return _SET_OF.get(name, "final table")


def stage_ante(players: int) -> float:
    """tournament.ts stageAnte: a 1bb big-blind ante as each seat's share, rounded to 0.01bb."""
    import math
    return math.floor(100 / players + 0.5) / 100        # (Math.round, half up: 8 players 0.13, as the page)


def request(stage) -> dict:
    """The preflop-solve request Practice sends at a hand of a session set to this preset (practice.ts stateFor and
    pfState: the hand's stack the biggest, ownStacks the seats with other chips, the ante, tournamentRequest's prizes and
    bounties; a chip EV session's preflop solve one prize, winner takes all, which is chips)."""
    name, n, stacks, pay, field, ante = stage[:6]
    bounty = stage[6] if len(stage) > 6 else None
    base = name.split(",")[0] if bounty else name
    if pay is None:     # (Early and Bubble: tournament.ts's curveOf over the places paid)
        pay = curve_of(150 if base == "Early" else 115)
    top = max(stacks)
    a = stage_ante(n) if ante is None else ante
    st = {"players": n, "stack": top, "payouts": [1] if pay == CHIPS else list(pay)}
    own = {p: s for p, s in zip(SEATS[n], stacks) if s != top}
    if own:
        st["stacks"] = own
    if a:
        st["ante"] = a
    if field and pay != CHIPS:
        st["field"] = {"players": field[0], "chips": round(field[0] * field[1] * 100) / 100}
    if bounty:
        st["bounties"] = {"format": bounty["format"], "seats": {p: bounty["each"] for p in SEATS[n]},
                          "field": bounty["each"]}
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
    'icm3_7846b9d8f67ada22': 'Final table, 3 left, 10bb average, equal stacks, flat payouts',
    'icm3_bdd15b09e9783302': 'Final table, 3 left, 10bb average, chip leader on the button, flat payouts',
    'icm3_9e8b836aba1b38a6': 'Final table, 3 left, 10bb average, short stack in the big blind, flat payouts',
    'icm3_2b864f9262f4de83': 'Final table, 3 left, 15bb average, equal stacks, flat payouts',
    'icm3_93156b77676477b7': 'Final table, 3 left, 15bb average, chip leader on the button, flat payouts',
    'icm3_853bd6c73803f4c6': 'Final table, 3 left, 15bb average, short stack in the big blind, flat payouts',
    'icm3_cf7c318a7381f8cb': 'Final table, 3 left, 20bb average, equal stacks, flat payouts',
    'icm3_2a49d148c05c4082': 'Final table, 3 left, 20bb average, chip leader on the button, flat payouts',
    'icm3_1ff09aaff85786d8': 'Final table, 3 left, 20bb average, short stack in the big blind, flat payouts',
    'icm3_acd648e5ece1ebcd': 'Final table, 3 left, 30bb average, equal stacks, flat payouts',
    'icm3_9260ef3d21b7d739': 'Final table, 3 left, 30bb average, chip leader on the button, flat payouts',
    'icm3_b2a1902fbf07065a': 'Final table, 3 left, 30bb average, short stack in the big blind, flat payouts',
    'icm3_1c1740c42a5165c7': 'Final table, 3 left, 40bb average, equal stacks, flat payouts',
    'icm3_64794cd78c13eadc': 'Final table, 3 left, 40bb average, chip leader on the button, flat payouts',
    'icm3_ba8b8314a6f7f208': 'Final table, 3 left, 40bb average, short stack in the big blind, flat payouts',
    'icm4_5207eed3d8fb2451': 'Final table, 4 left, 10bb average, equal stacks, flat payouts',
    'icm4_c84a86444fb367be': 'Final table, 4 left, 10bb average, chip leader on the button, flat payouts',
    'icm4_bf4e054f18db0209': 'Final table, 4 left, 10bb average, short stack in the big blind, flat payouts',
    'icm4_fcfad2ba6590e87c': 'Final table, 4 left, 15bb average, equal stacks, flat payouts',
    'icm4_1c1f636403d9dd4d': 'Final table, 4 left, 15bb average, chip leader on the button, flat payouts',
    'icm4_cc2a1ed424c2d1d1': 'Final table, 4 left, 15bb average, short stack in the big blind, flat payouts',
    'icm4_5af137b3b3d1ec6d': 'Final table, 4 left, 20bb average, equal stacks, flat payouts',
    'icm4_6fa077529be3be93': 'Final table, 4 left, 20bb average, chip leader on the button, flat payouts',
    'icm4_2cbb91431c716463': 'Final table, 4 left, 20bb average, short stack in the big blind, flat payouts',
    'icm4_8b44a7feb3d86e48': 'Final table, 4 left, 30bb average, equal stacks, flat payouts',
    'icm4_c20f2f4f6d997753': 'Final table, 4 left, 30bb average, chip leader on the button, flat payouts',
    'icm4_ceef83dfb484ab33': 'Final table, 4 left, 30bb average, short stack in the big blind, flat payouts',
    'icm4_b138adc91f26e8d1': 'Final table, 4 left, 40bb average, equal stacks, flat payouts',
    'icm4_65ca63da1eda6bcd': 'Final table, 4 left, 40bb average, chip leader on the button, flat payouts',
    'icm4_1a571d8e4cfc6ca2': 'Final table, 4 left, 40bb average, short stack in the big blind, flat payouts',
    'icm5_61a558e74525dfd0': 'Final table, 5 left, 10bb average, equal stacks, flat payouts',
    'icm5_24c20dbd7b98292b': 'Final table, 5 left, 10bb average, chip leader on the button, flat payouts',
    'icm5_42f922e2454c9829': 'Final table, 5 left, 10bb average, short stack in the big blind, flat payouts',
    'icm5_85895b2c0e237889': 'Final table, 5 left, 15bb average, equal stacks, flat payouts',
    'icm5_9193fb0dc2990b38': 'Final table, 5 left, 15bb average, chip leader on the button, flat payouts',
    'icm5_4ddfbffeb3337048': 'Final table, 5 left, 15bb average, short stack in the big blind, flat payouts',
    'icm5_c5cf2635a214f280': 'Final table, 5 left, 20bb average, equal stacks, flat payouts',
    'icm5_ba5a395d4f6535ca': 'Final table, 5 left, 20bb average, chip leader on the button, flat payouts',
    'icm5_ef644798573016a6': 'Final table, 5 left, 20bb average, short stack in the big blind, flat payouts',
    'icm5_65cabeb61a59a806': 'Final table, 5 left, 30bb average, equal stacks, flat payouts',
    'icm5_1a80b00912e1fee8': 'Final table, 5 left, 30bb average, chip leader on the button, flat payouts',
    'icm5_dd7c5f3e7e2fe2e2': 'Final table, 5 left, 30bb average, short stack in the big blind, flat payouts',
    'icm5_88be7697cb0f5cdb': 'Final table, 5 left, 40bb average, equal stacks, flat payouts',
    'icm5_9135c2c33fb79de7': 'Final table, 5 left, 40bb average, chip leader on the button, flat payouts',
    'icm5_b12bac6b5cfd24aa': 'Final table, 5 left, 40bb average, short stack in the big blind, flat payouts',
    'icm6_cfcf660e31f0c807': 'Final table, 6 left, 10bb average, equal stacks, flat payouts',
    'icm6_6fe437f5bf9e0a55': 'Final table, 6 left, 10bb average, chip leader on the button, flat payouts',
    'icm6_2c89a26585a6d1ad': 'Final table, 6 left, 10bb average, short stack in the big blind, flat payouts',
    'icm6_fef19ca717d93078': 'Final table, 6 left, 15bb average, equal stacks, flat payouts',
    'icm6_07b436fa3e3cf60e': 'Final table, 6 left, 15bb average, chip leader on the button, flat payouts',
    'icm6_7f16fdebce8ba359': 'Final table, 6 left, 15bb average, short stack in the big blind, flat payouts',
    'icm6_889e31e18c484078': 'Final table, 6 left, 20bb average, equal stacks, flat payouts',
    'icm6_6528b97e49a19ea9': 'Final table, 6 left, 20bb average, chip leader on the button, flat payouts',
    'icm6_8bb61d9087d03720': 'Final table, 6 left, 20bb average, short stack in the big blind, flat payouts',
    'icm6_8b0770dfded118f2': 'Final table, 6 left, 30bb average, equal stacks, flat payouts',
    'icm6_4241b7aa84bb7eae': 'Final table, 6 left, 30bb average, chip leader on the button, flat payouts',
    'icm6_c4a12c165f65c78b': 'Final table, 6 left, 30bb average, short stack in the big blind, flat payouts',
    'icm6_e245862ceeba4da5': 'Final table, 6 left, 40bb average, equal stacks, flat payouts',
    'icm6_bfa0e2debef4a7b7': 'Final table, 6 left, 40bb average, chip leader on the button, flat payouts',
    'icm6_fde2760f350bf75f': 'Final table, 6 left, 40bb average, short stack in the big blind, flat payouts',
    'icm7_743590b5f0bceaa1': 'Final table, 7 left, 10bb average, equal stacks, flat payouts',
    'icm7_7686489750c3570f': 'Final table, 7 left, 10bb average, chip leader on the button, flat payouts',
    'icm7_6c21c1bf2df7f076': 'Final table, 7 left, 10bb average, short stack in the big blind, flat payouts',
    'icm7_b30869726f393892': 'Final table, 7 left, 15bb average, equal stacks, flat payouts',
    'icm7_c1fc518e2b6376df': 'Final table, 7 left, 15bb average, chip leader on the button, flat payouts',
    'icm7_99ab719f0435050a': 'Final table, 7 left, 15bb average, short stack in the big blind, flat payouts',
    'icm7_d4c98b5275e27edd': 'Final table, 7 left, 20bb average, equal stacks, flat payouts',
    'icm7_60809cfa963c68cb': 'Final table, 7 left, 20bb average, chip leader on the button, flat payouts',
    'icm7_422bd48903f123e6': 'Final table, 7 left, 20bb average, short stack in the big blind, flat payouts',
    'icm7_80e58048d821053f': 'Final table, 7 left, 30bb average, equal stacks, flat payouts',
    'icm7_a2b0f7c388a3b11d': 'Final table, 7 left, 30bb average, chip leader on the button, flat payouts',
    'icm7_b2978b24ac011175': 'Final table, 7 left, 30bb average, short stack in the big blind, flat payouts',
    'icm7_b3f84d824e4b6c88': 'Final table, 7 left, 40bb average, equal stacks, flat payouts',
    'icm7_a47820f3b49452d5': 'Final table, 7 left, 40bb average, chip leader on the button, flat payouts',
    'icm7_45eae55607bfab70': 'Final table, 7 left, 40bb average, short stack in the big blind, flat payouts',
    'icm8_fbc3487a4174171d': 'Final table, 8 left, 10bb average, equal stacks, flat payouts',
    'icm8_757e3104ddfe7bf8': 'Final table, 8 left, 10bb average, chip leader on the button, flat payouts',
    'icm8_e4a08e7f3e6093b8': 'Final table, 8 left, 10bb average, short stack in the big blind, flat payouts',
    'icm8_498fe31d30c1690a': 'Final table, 8 left, 15bb average, equal stacks, flat payouts',
    'icm8_28e09720231e3e76': 'Final table, 8 left, 15bb average, chip leader on the button, flat payouts',
    'icm8_01f65f128288126d': 'Final table, 8 left, 15bb average, short stack in the big blind, flat payouts',
    'icm8_f67d4523a14ffc38': 'Final table, 8 left, 20bb average, equal stacks, flat payouts',
    'icm8_96a2f6549b6edc6b': 'Final table, 8 left, 20bb average, chip leader on the button, flat payouts',
    'icm8_22e4e84f2bd5d93e': 'Final table, 8 left, 20bb average, short stack in the big blind, flat payouts',
    'icm8_d3d5906843d2c04d': 'Final table, 8 left, 30bb average, equal stacks, flat payouts',
    'icm8_82b3b312d65d0307': 'Final table, 8 left, 30bb average, chip leader on the button, flat payouts',
    'icm8_7a5c3723729813a5': 'Final table, 8 left, 30bb average, short stack in the big blind, flat payouts',
    'icm8_50cc3799f7169161': 'Final table, 8 left, 40bb average, equal stacks, flat payouts',
    'icm8_af04699adebf9b04': 'Final table, 8 left, 40bb average, chip leader on the button, flat payouts',
    'icm8_81f4110435dba66b': 'Final table, 8 left, 40bb average, short stack in the big blind, flat payouts',
    'icm9_80ac77806fa9b8b5': 'Final table, 9 left, 10bb average, equal stacks, flat payouts',
    'icm9_eaae4c82a816c71c': 'Final table, 9 left, 10bb average, chip leader on the button, flat payouts',
    'icm9_eca0fceb47f3097f': 'Final table, 9 left, 10bb average, short stack in the big blind, flat payouts',
    'icm9_045cae9891ee51f7': 'Final table, 9 left, 15bb average, equal stacks, flat payouts',
    'icm9_b8aebe96fde71596': 'Final table, 9 left, 15bb average, chip leader on the button, flat payouts',
    'icm9_7c32cc833c101682': 'Final table, 9 left, 15bb average, short stack in the big blind, flat payouts',
    'icm9_d6195284a6250f5f': 'Final table, 9 left, 20bb average, equal stacks, flat payouts',
    'icm9_c9a23538a1b5709b': 'Final table, 9 left, 20bb average, chip leader on the button, flat payouts',
    'icm9_1714f8cd8573a740': 'Final table, 9 left, 20bb average, short stack in the big blind, flat payouts',
    'icm9_0d1be58e2bae90dc': 'Final table, 9 left, 30bb average, equal stacks, flat payouts',
    'icm9_ee347a2983dc94ea': 'Final table, 9 left, 30bb average, chip leader on the button, flat payouts',
    'icm9_061af67d4357e66e': 'Final table, 9 left, 30bb average, short stack in the big blind, flat payouts',
    'icm9_aec2280a695eafff': 'Final table, 9 left, 40bb average, equal stacks, flat payouts',
    'icm9_4f2ea43d65128a7a': 'Final table, 9 left, 40bb average, chip leader on the button, flat payouts',
    'icm9_357a11e74c030b56': 'Final table, 9 left, 40bb average, short stack in the big blind, flat payouts',
    'icm3_17602aef464d520b': 'Final table, 3 left, 10bb average, equal stacks, standard payouts',
    'icm3_bee4061d85cddfdb': 'Final table, 3 left, 10bb average, chip leader on the button, standard payouts',
    'icm3_984de56bdf39981f': 'Final table, 3 left, 10bb average, short stack in the big blind, standard payouts',
    'icm3_296d4c1f8a8a9bc1': 'Final table, 3 left, 15bb average, equal stacks, standard payouts',
    'icm3_29787bb32bbe0afe': 'Final table, 3 left, 15bb average, chip leader on the button, standard payouts',
    'icm3_57f7a9f60ef735a3': 'Final table, 3 left, 15bb average, short stack in the big blind, standard payouts',
    'icm3_362f1c0e912b0896': 'Final table, 3 left, 20bb average, equal stacks, standard payouts',
    'icm3_76b15d3e923a5cd3': 'Final table, 3 left, 20bb average, chip leader on the button, standard payouts',
    'icm3_f41a384f024f488f': 'Final table, 3 left, 20bb average, short stack in the big blind, standard payouts',
    'icm3_69ed49c5ae439b84': 'Final table, 3 left, 30bb average, equal stacks, standard payouts',
    'icm3_47e6ac0577a4fb3b': 'Final table, 3 left, 30bb average, chip leader on the button, standard payouts',
    'icm3_3f017bad480e0cbf': 'Final table, 3 left, 30bb average, short stack in the big blind, standard payouts',
    'icm3_1162c421558daaba': 'Final table, 3 left, 40bb average, equal stacks, standard payouts',
    'icm3_6d6426ab7d945641': 'Final table, 3 left, 40bb average, chip leader on the button, standard payouts',
    'icm3_f77dc7c0bc3b2ce1': 'Final table, 3 left, 40bb average, short stack in the big blind, standard payouts',
    'icm4_a274f26cdb1295c7': 'Final table, 4 left, 10bb average, equal stacks, standard payouts',
    'icm4_9f443e61e642c4b9': 'Final table, 4 left, 10bb average, chip leader on the button, standard payouts',
    'icm4_34b29139b79d44ac': 'Final table, 4 left, 10bb average, short stack in the big blind, standard payouts',
    'icm4_d52d7adc173175f8': 'Final table, 4 left, 15bb average, equal stacks, standard payouts',
    'icm4_3bc3cb15d6b5ac21': 'Final table, 4 left, 15bb average, chip leader on the button, standard payouts',
    'icm4_a5a8892b5740de1b': 'Final table, 4 left, 15bb average, short stack in the big blind, standard payouts',
    'icm4_2f6ae9d98dea11ba': 'Final table, 4 left, 20bb average, equal stacks, standard payouts',
    'icm4_fcad2fab6717cd8c': 'Final table, 4 left, 20bb average, chip leader on the button, standard payouts',
    'icm4_d5b756fd078abfd1': 'Final table, 4 left, 20bb average, short stack in the big blind, standard payouts',
    'icm4_00d07fee03917ffe': 'Final table, 4 left, 30bb average, equal stacks, standard payouts',
    'icm4_946406e602ff192d': 'Final table, 4 left, 30bb average, chip leader on the button, standard payouts',
    'icm4_e3c8c1d4f8e0c7ff': 'Final table, 4 left, 30bb average, short stack in the big blind, standard payouts',
    'icm4_5b7f18db1ab256bb': 'Final table, 4 left, 40bb average, equal stacks, standard payouts',
    'icm4_5239f3f31ef8fa79': 'Final table, 4 left, 40bb average, chip leader on the button, standard payouts',
    'icm4_5039aeb791dfb832': 'Final table, 4 left, 40bb average, short stack in the big blind, standard payouts',
    'icm5_9d4e41edc6dce262': 'Final table, 5 left, 10bb average, equal stacks, standard payouts',
    'icm5_fbe1da6e22e0380e': 'Final table, 5 left, 10bb average, chip leader on the button, standard payouts',
    'icm5_0758c006002b64bd': 'Final table, 5 left, 10bb average, short stack in the big blind, standard payouts',
    'icm5_65a3604f9d3fb575': 'Final table, 5 left, 15bb average, equal stacks, standard payouts',
    'icm5_cfb4dd7b003a221b': 'Final table, 5 left, 15bb average, chip leader on the button, standard payouts',
    'icm5_6c31ee3aa607d5fb': 'Final table, 5 left, 15bb average, short stack in the big blind, standard payouts',
    'icm5_bfe443a6bd321e1f': 'Final table, 5 left, 20bb average, equal stacks, standard payouts',
    'icm5_f3403c785c75073b': 'Final table, 5 left, 20bb average, chip leader on the button, standard payouts',
    'icm5_72b796075ccdcf32': 'Final table, 5 left, 20bb average, short stack in the big blind, standard payouts',
    'icm5_23e9823881a65d44': 'Final table, 5 left, 30bb average, equal stacks, standard payouts',
    'icm5_79de7654c94a413c': 'Final table, 5 left, 30bb average, chip leader on the button, standard payouts',
    'icm5_07d1c3b5760f4599': 'Final table, 5 left, 30bb average, short stack in the big blind, standard payouts',
    'icm5_5c2ad6d2726c12d9': 'Final table, 5 left, 40bb average, equal stacks, standard payouts',
    'icm5_b022e3d7e1c26661': 'Final table, 5 left, 40bb average, chip leader on the button, standard payouts',
    'icm5_417d6ec3f0729e99': 'Final table, 5 left, 40bb average, short stack in the big blind, standard payouts',
    'icm6_ddcb6b8baea48bcb': 'Final table, 6 left, 10bb average, equal stacks, standard payouts',
    'icm6_c621ec51bfe50829': 'Final table, 6 left, 10bb average, chip leader on the button, standard payouts',
    'icm6_75c90cd12581fa95': 'Final table, 6 left, 10bb average, short stack in the big blind, standard payouts',
    'icm6_5664092c8d5bc83d': 'Final table, 6 left, 15bb average, equal stacks, standard payouts',
    'icm6_1eb9aadcf1fb8468': 'Final table, 6 left, 15bb average, chip leader on the button, standard payouts',
    'icm6_e6982dbaf2a95879': 'Final table, 6 left, 15bb average, short stack in the big blind, standard payouts',
    'icm6_1e6ede694d5dd433': 'Final table, 6 left, 20bb average, equal stacks, standard payouts',
    'icm6_72ff25aaefb3a66f': 'Final table, 6 left, 20bb average, chip leader on the button, standard payouts',
    'icm6_ff9681fd673f319e': 'Final table, 6 left, 20bb average, short stack in the big blind, standard payouts',
    'icm6_f0ffff4c82b18bff': 'Final table, 6 left, 30bb average, equal stacks, standard payouts',
    'icm6_5605f230ce4db41d': 'Final table, 6 left, 30bb average, chip leader on the button, standard payouts',
    'icm6_9c9ad2c131d34340': 'Final table, 6 left, 30bb average, short stack in the big blind, standard payouts',
    'icm6_cfd3cc5ae9466246': 'Final table, 6 left, 40bb average, equal stacks, standard payouts',
    'icm6_ead7a4f298af7f46': 'Final table, 6 left, 40bb average, chip leader on the button, standard payouts',
    'icm6_61023ee4d7695acf': 'Final table, 6 left, 40bb average, short stack in the big blind, standard payouts',
    'icm7_9a127157b4a90b11': 'Final table, 7 left, 10bb average, equal stacks, standard payouts',
    'icm7_981887127470f462': 'Final table, 7 left, 10bb average, chip leader on the button, standard payouts',
    'icm7_7d88bdae009bca80': 'Final table, 7 left, 10bb average, short stack in the big blind, standard payouts',
    'icm7_10a0238c566ed9ce': 'Final table, 7 left, 15bb average, equal stacks, standard payouts',
    'icm7_d92f70705f785956': 'Final table, 7 left, 15bb average, chip leader on the button, standard payouts',
    'icm7_7021a4ad84c6462b': 'Final table, 7 left, 15bb average, short stack in the big blind, standard payouts',
    'icm7_32ad2e2b1f05d813': 'Final table, 7 left, 20bb average, equal stacks, standard payouts',
    'icm7_278fbe4681657718': 'Final table, 7 left, 20bb average, chip leader on the button, standard payouts',
    'icm7_5a729151ccc0d060': 'Final table, 7 left, 20bb average, short stack in the big blind, standard payouts',
    'icm7_a6b3c8de7641981c': 'Final table, 7 left, 30bb average, equal stacks, standard payouts',
    'icm7_f9340dba7e0d8c31': 'Final table, 7 left, 30bb average, chip leader on the button, standard payouts',
    'icm7_e2060e3498c66636': 'Final table, 7 left, 30bb average, short stack in the big blind, standard payouts',
    'icm7_9f6db716c81871f4': 'Final table, 7 left, 40bb average, equal stacks, standard payouts',
    'icm7_715308e46a297d92': 'Final table, 7 left, 40bb average, chip leader on the button, standard payouts',
    'icm7_ae93accd33a550a3': 'Final table, 7 left, 40bb average, short stack in the big blind, standard payouts',
    'icm8_3a797e9fcc183b01': 'Final table, 8 left, 10bb average, equal stacks, standard payouts',
    'icm8_ef1fba58be77bcc6': 'Final table, 8 left, 10bb average, chip leader on the button, standard payouts',
    'icm8_639efaf856f6b15b': 'Final table, 8 left, 10bb average, short stack in the big blind, standard payouts',
    'icm8_7b1aba2e0073d46d': 'Final table, 8 left, 15bb average, equal stacks, standard payouts',
    'icm8_ae6736143ee1eba8': 'Final table, 8 left, 15bb average, chip leader on the button, standard payouts',
    'icm8_e7deac48ff6f1795': 'Final table, 8 left, 15bb average, short stack in the big blind, standard payouts',
    'icm8_37a0beaa790f4cf6': 'Final table, 8 left, 20bb average, equal stacks, standard payouts',
    'icm8_7d50783cf3e3023e': 'Final table, 8 left, 20bb average, chip leader on the button, standard payouts',
    'icm8_d2af0e36dda4cda3': 'Final table, 8 left, 20bb average, short stack in the big blind, standard payouts',
    'icm8_b00f9e9479ea5e0a': 'Final table, 8 left, 30bb average, equal stacks, standard payouts',
    'icm8_43d3d3fcbbaf5e51': 'Final table, 8 left, 30bb average, chip leader on the button, standard payouts',
    'icm8_de62e131f896779e': 'Final table, 8 left, 30bb average, short stack in the big blind, standard payouts',
    'icm8_16c2e9188a7dff18': 'Final table, 8 left, 40bb average, equal stacks, standard payouts',
    'icm8_e7b5c300e8bb35ca': 'Final table, 8 left, 40bb average, chip leader on the button, standard payouts',
    'icm8_c2d1ccb5ebae81fa': 'Final table, 8 left, 40bb average, short stack in the big blind, standard payouts',
    'icm9_140b61aca7901e50': 'Final table, 9 left, 10bb average, equal stacks, standard payouts',
    'icm9_54a115e44be03e1e': 'Final table, 9 left, 10bb average, chip leader on the button, standard payouts',
    'icm9_f41cfd4b2eb42aab': 'Final table, 9 left, 10bb average, short stack in the big blind, standard payouts',
    'icm9_74141a3fbcee6889': 'Final table, 9 left, 15bb average, equal stacks, standard payouts',
    'icm9_092fa4688415f586': 'Final table, 9 left, 15bb average, chip leader on the button, standard payouts',
    'icm9_33215f925d348b3c': 'Final table, 9 left, 15bb average, short stack in the big blind, standard payouts',
    'icm9_0a7db7e4cac954e8': 'Final table, 9 left, 20bb average, equal stacks, standard payouts',
    'icm9_40bbecb0299f88cb': 'Final table, 9 left, 20bb average, chip leader on the button, standard payouts',
    'icm9_fe9e87bd64ea2e82': 'Final table, 9 left, 20bb average, short stack in the big blind, standard payouts',
    'icm9_fa3312373b8aed38': 'Final table, 9 left, 30bb average, equal stacks, standard payouts',
    'icm9_6919b78cce83eb2a': 'Final table, 9 left, 30bb average, chip leader on the button, standard payouts',
    'icm9_4a955c1a6e38fe6f': 'Final table, 9 left, 30bb average, short stack in the big blind, standard payouts',
    'icm9_64fa9d8e976196b5': 'Final table, 9 left, 40bb average, equal stacks, standard payouts',
    'icm9_2c0e414415e46185': 'Final table, 9 left, 40bb average, chip leader on the button, standard payouts',
    'icm9_531d16afa9bb1ef2': 'Final table, 9 left, 40bb average, short stack in the big blind, standard payouts',
    'icm3_6813cdfcfda99f6a': 'Final table, 3 left, 10bb average, equal stacks, top-heavy payouts',
    'icm3_b02d5b3522554e75': 'Final table, 3 left, 10bb average, chip leader on the button, top-heavy payouts',
    'icm3_041a2aa2329c1ad4': 'Final table, 3 left, 10bb average, short stack in the big blind, top-heavy payouts',
    'icm3_c475e871e56a7e5c': 'Final table, 3 left, 15bb average, equal stacks, top-heavy payouts',
    'icm3_95111567e902063a': 'Final table, 3 left, 15bb average, chip leader on the button, top-heavy payouts',
    'icm3_64330b92edfdf36e': 'Final table, 3 left, 15bb average, short stack in the big blind, top-heavy payouts',
    'icm3_fc048ac5f5db0c3e': 'Final table, 3 left, 20bb average, equal stacks, top-heavy payouts',
    'icm3_98cd11ae0c3ed864': 'Final table, 3 left, 20bb average, chip leader on the button, top-heavy payouts',
    'icm3_0cca55dcc09608cd': 'Final table, 3 left, 20bb average, short stack in the big blind, top-heavy payouts',
    'icm3_a41d741a97508e06': 'Final table, 3 left, 30bb average, equal stacks, top-heavy payouts',
    'icm3_6ab89a96be2c1069': 'Final table, 3 left, 30bb average, chip leader on the button, top-heavy payouts',
    'icm3_1399a88cbcf710b9': 'Final table, 3 left, 30bb average, short stack in the big blind, top-heavy payouts',
    'icm3_e0a8251f5c7fea21': 'Final table, 3 left, 40bb average, equal stacks, top-heavy payouts',
    'icm3_6ec39e1631e18f59': 'Final table, 3 left, 40bb average, chip leader on the button, top-heavy payouts',
    'icm3_65b732f05b9bc824': 'Final table, 3 left, 40bb average, short stack in the big blind, top-heavy payouts',
    'icm4_29ddd9129d055991': 'Final table, 4 left, 10bb average, equal stacks, top-heavy payouts',
    'icm4_c97e773a37a7ee3a': 'Final table, 4 left, 10bb average, chip leader on the button, top-heavy payouts',
    'icm4_3bb691a92a859d78': 'Final table, 4 left, 10bb average, short stack in the big blind, top-heavy payouts',
    'icm4_102f2b27df3d0088': 'Final table, 4 left, 15bb average, equal stacks, top-heavy payouts',
    'icm4_8e3f9effb2b152f1': 'Final table, 4 left, 15bb average, chip leader on the button, top-heavy payouts',
    'icm4_c6cb4b3eda0561ac': 'Final table, 4 left, 15bb average, short stack in the big blind, top-heavy payouts',
    'icm4_58dcfde3a3bfcd0f': 'Final table, 4 left, 20bb average, equal stacks, top-heavy payouts',
    'icm4_b25d770f50c334cd': 'Final table, 4 left, 20bb average, chip leader on the button, top-heavy payouts',
    'icm4_627caea41c31efe0': 'Final table, 4 left, 20bb average, short stack in the big blind, top-heavy payouts',
    'icm4_1adf575f8bec36be': 'Final table, 4 left, 30bb average, equal stacks, top-heavy payouts',
    'icm4_9ef4c20b81d110f6': 'Final table, 4 left, 30bb average, chip leader on the button, top-heavy payouts',
    'icm4_9e3d15262ceb18ab': 'Final table, 4 left, 30bb average, short stack in the big blind, top-heavy payouts',
    'icm4_6361ad48c648dc42': 'Final table, 4 left, 40bb average, equal stacks, top-heavy payouts',
    'icm4_ac7d09b977cd1ec2': 'Final table, 4 left, 40bb average, chip leader on the button, top-heavy payouts',
    'icm4_98e81f28539f5814': 'Final table, 4 left, 40bb average, short stack in the big blind, top-heavy payouts',
    'icm5_d8e79dd838253c51': 'Final table, 5 left, 10bb average, equal stacks, top-heavy payouts',
    'icm5_c69cb8d54e728068': 'Final table, 5 left, 10bb average, chip leader on the button, top-heavy payouts',
    'icm5_1cef4161cda3695d': 'Final table, 5 left, 10bb average, short stack in the big blind, top-heavy payouts',
    'icm5_05a8dae9d99ff649': 'Final table, 5 left, 15bb average, equal stacks, top-heavy payouts',
    'icm5_c38d83a01fc16203': 'Final table, 5 left, 15bb average, chip leader on the button, top-heavy payouts',
    'icm5_5804a4650421e740': 'Final table, 5 left, 15bb average, short stack in the big blind, top-heavy payouts',
    'icm5_eb70ef424a67c4b4': 'Final table, 5 left, 20bb average, equal stacks, top-heavy payouts',
    'icm5_05fb63f31cd8a66c': 'Final table, 5 left, 20bb average, chip leader on the button, top-heavy payouts',
    'icm5_e97f810be6210a5c': 'Final table, 5 left, 20bb average, short stack in the big blind, top-heavy payouts',
    'icm5_cbe6f0cbe4221904': 'Final table, 5 left, 30bb average, equal stacks, top-heavy payouts',
    'icm5_8acf1668d241bcc6': 'Final table, 5 left, 30bb average, chip leader on the button, top-heavy payouts',
    'icm5_a28b460cf6d80921': 'Final table, 5 left, 30bb average, short stack in the big blind, top-heavy payouts',
    'icm5_e0afb8c1ad7188b8': 'Final table, 5 left, 40bb average, equal stacks, top-heavy payouts',
    'icm5_7fa8e7ed606b135e': 'Final table, 5 left, 40bb average, chip leader on the button, top-heavy payouts',
    'icm5_9525e0b40f222abb': 'Final table, 5 left, 40bb average, short stack in the big blind, top-heavy payouts',
    'icm6_98188a970cd1638c': 'Final table, 6 left, 10bb average, equal stacks, top-heavy payouts',
    'icm6_d5e71dc8d316091c': 'Final table, 6 left, 10bb average, chip leader on the button, top-heavy payouts',
    'icm6_5ac9aa86a777c0ad': 'Final table, 6 left, 10bb average, short stack in the big blind, top-heavy payouts',
    'icm6_f2cf05de54c9ab4b': 'Final table, 6 left, 15bb average, equal stacks, top-heavy payouts',
    'icm6_01b3157796142ff1': 'Final table, 6 left, 15bb average, chip leader on the button, top-heavy payouts',
    'icm6_abae81ce68578713': 'Final table, 6 left, 15bb average, short stack in the big blind, top-heavy payouts',
    'icm6_4fc0034563654550': 'Final table, 6 left, 20bb average, equal stacks, top-heavy payouts',
    'icm6_49ce73394404855f': 'Final table, 6 left, 20bb average, chip leader on the button, top-heavy payouts',
    'icm6_ef7dcdfb7d3e9e80': 'Final table, 6 left, 20bb average, short stack in the big blind, top-heavy payouts',
    'icm6_4e8e5870e81f77b4': 'Final table, 6 left, 30bb average, equal stacks, top-heavy payouts',
    'icm6_56612851763b8578': 'Final table, 6 left, 30bb average, chip leader on the button, top-heavy payouts',
    'icm6_ec8f1362991bceb5': 'Final table, 6 left, 30bb average, short stack in the big blind, top-heavy payouts',
    'icm6_bed7748ae8085262': 'Final table, 6 left, 40bb average, equal stacks, top-heavy payouts',
    'icm6_6cfbbff04889a307': 'Final table, 6 left, 40bb average, chip leader on the button, top-heavy payouts',
    'icm6_90e436142dd42bad': 'Final table, 6 left, 40bb average, short stack in the big blind, top-heavy payouts',
    'icm7_e91e80fc77340353': 'Final table, 7 left, 10bb average, equal stacks, top-heavy payouts',
    'icm7_4793a91e7ebc0046': 'Final table, 7 left, 10bb average, chip leader on the button, top-heavy payouts',
    'icm7_ff9825a08eb3fe19': 'Final table, 7 left, 10bb average, short stack in the big blind, top-heavy payouts',
    'icm7_6aebc31db4e1192d': 'Final table, 7 left, 15bb average, equal stacks, top-heavy payouts',
    'icm7_644300d34dc656b9': 'Final table, 7 left, 15bb average, chip leader on the button, top-heavy payouts',
    'icm7_dbf064d7050bf1f6': 'Final table, 7 left, 15bb average, short stack in the big blind, top-heavy payouts',
    'icm7_d7c16fc05aa13c96': 'Final table, 7 left, 20bb average, equal stacks, top-heavy payouts',
    'icm7_e9340017db6e0a5f': 'Final table, 7 left, 20bb average, chip leader on the button, top-heavy payouts',
    'icm7_b7a4dac47938c874': 'Final table, 7 left, 20bb average, short stack in the big blind, top-heavy payouts',
    'icm7_94051163c69861ce': 'Final table, 7 left, 30bb average, equal stacks, top-heavy payouts',
    'icm7_6af7101412975e9b': 'Final table, 7 left, 30bb average, chip leader on the button, top-heavy payouts',
    'icm7_be7d5a8a5dfdb7c5': 'Final table, 7 left, 30bb average, short stack in the big blind, top-heavy payouts',
    'icm7_a35b35bfdb534c80': 'Final table, 7 left, 40bb average, equal stacks, top-heavy payouts',
    'icm7_316050e0b61c9814': 'Final table, 7 left, 40bb average, chip leader on the button, top-heavy payouts',
    'icm7_67fb450074988218': 'Final table, 7 left, 40bb average, short stack in the big blind, top-heavy payouts',
    'icm8_69189173981bc962': 'Final table, 8 left, 10bb average, equal stacks, top-heavy payouts',
    'icm8_0284acf695eed4e5': 'Final table, 8 left, 10bb average, chip leader on the button, top-heavy payouts',
    'icm8_1e47ba8c10a508f4': 'Final table, 8 left, 10bb average, short stack in the big blind, top-heavy payouts',
    'icm8_40318a83fa51a966': 'Final table, 8 left, 15bb average, equal stacks, top-heavy payouts',
    'icm8_bc21aeb2d5a6de87': 'Final table, 8 left, 15bb average, chip leader on the button, top-heavy payouts',
    'icm8_e36b06adeb67cab3': 'Final table, 8 left, 15bb average, short stack in the big blind, top-heavy payouts',
    'icm8_c6c91038dede4658': 'Final table, 8 left, 20bb average, equal stacks, top-heavy payouts',
    'icm8_0a573df126ffe69e': 'Final table, 8 left, 20bb average, chip leader on the button, top-heavy payouts',
    'icm8_a1d924a8265d3ed5': 'Final table, 8 left, 20bb average, short stack in the big blind, top-heavy payouts',
    'icm8_5644a1326196d679': 'Final table, 8 left, 30bb average, equal stacks, top-heavy payouts',
    'icm8_605addd557a8d8ad': 'Final table, 8 left, 30bb average, chip leader on the button, top-heavy payouts',
    'icm8_073ca69a55e9b452': 'Final table, 8 left, 30bb average, short stack in the big blind, top-heavy payouts',
    'icm8_369be6f325075538': 'Final table, 8 left, 40bb average, equal stacks, top-heavy payouts',
    'icm8_427f0ba2735298b6': 'Final table, 8 left, 40bb average, chip leader on the button, top-heavy payouts',
    'icm8_be6833344ef43015': 'Final table, 8 left, 40bb average, short stack in the big blind, top-heavy payouts',
    'icm9_de7cf02b9ad885db': 'Final table, 9 left, 10bb average, equal stacks, top-heavy payouts',
    'icm9_cff54ca56ca62143': 'Final table, 9 left, 10bb average, chip leader on the button, top-heavy payouts',
    'icm9_23c28fca0ea6afc9': 'Final table, 9 left, 10bb average, short stack in the big blind, top-heavy payouts',
    'icm9_8490b621d47b0d53': 'Final table, 9 left, 15bb average, equal stacks, top-heavy payouts',
    'icm9_e30161b1984eb3f2': 'Final table, 9 left, 15bb average, chip leader on the button, top-heavy payouts',
    'icm9_96ed532db98a7614': 'Final table, 9 left, 15bb average, short stack in the big blind, top-heavy payouts',
    'icm9_375f51b037e2f3bb': 'Final table, 9 left, 20bb average, equal stacks, top-heavy payouts',
    'icm9_566eaf590f1edf0b': 'Final table, 9 left, 20bb average, chip leader on the button, top-heavy payouts',
    'icm9_3e9965f1c455a496': 'Final table, 9 left, 20bb average, short stack in the big blind, top-heavy payouts',
    'icm9_cb4fde7e2ab2421d': 'Final table, 9 left, 30bb average, equal stacks, top-heavy payouts',
    'icm9_a6c507fe48f82f30': 'Final table, 9 left, 30bb average, chip leader on the button, top-heavy payouts',
    'icm9_77909763594a25b9': 'Final table, 9 left, 30bb average, short stack in the big blind, top-heavy payouts',
    'icm9_67395f52ed88e389': 'Final table, 9 left, 40bb average, equal stacks, top-heavy payouts',
    'icm9_7d2c1a308e1ac89f': 'Final table, 9 left, 40bb average, chip leader on the button, top-heavy payouts',
    'icm9_4122d8b4bf208e69': 'Final table, 9 left, 40bb average, short stack in the big blind, top-heavy payouts',
    'icm3_f52f92a8653c3a63': 'Final table, 3 left, 10bb average, chip leader in the big blind',
    'icm3_b6e7ed326f78b99a': 'Final table, 3 left, 10bb average, short stack on the button',
    'icm3_d548703601c7f007': 'Final table, 3 left, 15bb average, chip leader in the big blind',
    'icm3_074b012d94cc77bd': 'Final table, 3 left, 15bb average, short stack on the button',
    'icm3_5be47597bae033ad': 'Final table, 3 left, 20bb average, chip leader in the big blind',
    'icm3_3ccdfd442d2088b6': 'Final table, 3 left, 20bb average, short stack on the button',
    'icm3_0cfa53285f707935': 'Final table, 3 left, 30bb average, chip leader in the big blind',
    'icm3_960e3cafd78ed83d': 'Final table, 3 left, 30bb average, short stack on the button',
    'icm3_02fcf64c153de123': 'Final table, 3 left, 40bb average, chip leader in the big blind',
    'icm3_6f7a87971e2a511e': 'Final table, 3 left, 40bb average, short stack on the button',
    'icm4_4a9b8ba5531881c8': 'Final table, 4 left, 10bb average, chip leader in the big blind',
    'icm4_01440977a05a2370': 'Final table, 4 left, 10bb average, short stack on the button',
    'icm4_a1866864451e64ac': 'Final table, 4 left, 15bb average, chip leader in the big blind',
    'icm4_0e8e3584b30a20fe': 'Final table, 4 left, 15bb average, short stack on the button',
    'icm4_8d8a70db977226da': 'Final table, 4 left, 20bb average, chip leader in the big blind',
    'icm4_398677a9e422c7bd': 'Final table, 4 left, 20bb average, short stack on the button',
    'icm4_665f9a50c60d31ec': 'Final table, 4 left, 30bb average, chip leader in the big blind',
    'icm4_0be13167ec19a502': 'Final table, 4 left, 30bb average, short stack on the button',
    'icm4_f8ed4c658a5c1581': 'Final table, 4 left, 40bb average, chip leader in the big blind',
    'icm4_820acb102209f44c': 'Final table, 4 left, 40bb average, short stack on the button',
    'icm5_5549ced7617d16d7': 'Final table, 5 left, 10bb average, chip leader in the big blind',
    'icm5_512c8246e2c5bc6c': 'Final table, 5 left, 10bb average, short stack on the button',
    'icm5_587948ecb18e9708': 'Final table, 5 left, 15bb average, chip leader in the big blind',
    'icm5_9557f1698e0fb5ce': 'Final table, 5 left, 15bb average, short stack on the button',
    'icm5_db777f9b44a62d08': 'Final table, 5 left, 20bb average, chip leader in the big blind',
    'icm5_0191d0ab4e851195': 'Final table, 5 left, 20bb average, short stack on the button',
    'icm5_e485981a69ab0562': 'Final table, 5 left, 30bb average, chip leader in the big blind',
    'icm5_158945efa5eca2f6': 'Final table, 5 left, 30bb average, short stack on the button',
    'icm5_c32245ae4e40d397': 'Final table, 5 left, 40bb average, chip leader in the big blind',
    'icm5_cca2461700482bf2': 'Final table, 5 left, 40bb average, short stack on the button',
    'icm6_4ce9283bf649a081': 'Final table, 6 left, 10bb average, chip leader in the big blind',
    'icm6_236a1eb11f96effb': 'Final table, 6 left, 10bb average, short stack on the button',
    'icm6_035d1747a5537141': 'Final table, 6 left, 15bb average, chip leader in the big blind',
    'icm6_44f0462ec69c4223': 'Final table, 6 left, 15bb average, short stack on the button',
    'icm6_69cdf9c92725ee22': 'Final table, 6 left, 20bb average, chip leader in the big blind',
    'icm6_14cacd68819cc77b': 'Final table, 6 left, 20bb average, short stack on the button',
    'icm6_685fce334fb42572': 'Final table, 6 left, 30bb average, chip leader in the big blind',
    'icm6_26496ee38a7ceb48': 'Final table, 6 left, 30bb average, short stack on the button',
    'icm6_a70f7d957490b4e8': 'Final table, 6 left, 40bb average, chip leader in the big blind',
    'icm6_a30078a02f813dd7': 'Final table, 6 left, 40bb average, short stack on the button',
    'icm7_df2cc024886f976f': 'Final table, 7 left, 10bb average, chip leader in the big blind',
    'icm7_7246031b27085e44': 'Final table, 7 left, 10bb average, short stack on the button',
    'icm7_461284109bb7c351': 'Final table, 7 left, 15bb average, chip leader in the big blind',
    'icm7_60567fd1be3850ca': 'Final table, 7 left, 15bb average, short stack on the button',
    'icm7_c25048d8b2d83d67': 'Final table, 7 left, 20bb average, chip leader in the big blind',
    'icm7_d7d35542121f29ae': 'Final table, 7 left, 20bb average, short stack on the button',
    'icm7_a671ca8baf2c52b0': 'Final table, 7 left, 30bb average, chip leader in the big blind',
    'icm7_6455cf0970d0cc83': 'Final table, 7 left, 30bb average, short stack on the button',
    'icm7_4f4bdd22076213f5': 'Final table, 7 left, 40bb average, chip leader in the big blind',
    'icm7_c21f970dc26e6616': 'Final table, 7 left, 40bb average, short stack on the button',
    'icm8_413e4b0358f3db71': 'Final table, 8 left, 10bb average, chip leader in the big blind',
    'icm8_f6faf37a2b584d1b': 'Final table, 8 left, 10bb average, short stack on the button',
    'icm8_3df118a896bd29d2': 'Final table, 8 left, 15bb average, chip leader in the big blind',
    'icm8_424c8e0fc782b5f9': 'Final table, 8 left, 15bb average, short stack on the button',
    'icm8_e7d83149eca488c1': 'Final table, 8 left, 20bb average, chip leader in the big blind',
    'icm8_5f97baf226877e1d': 'Final table, 8 left, 20bb average, short stack on the button',
    'icm8_dae7c58690596844': 'Final table, 8 left, 30bb average, chip leader in the big blind',
    'icm8_00af7f4bbfe7ce99': 'Final table, 8 left, 30bb average, short stack on the button',
    'icm8_8d2e0d30a0cb9a12': 'Final table, 8 left, 40bb average, chip leader in the big blind',
    'icm8_ec32fb997e2aa61d': 'Final table, 8 left, 40bb average, short stack on the button',
    'icm9_61ab0dc5e8929884': 'Final table, 9 left, 10bb average, chip leader in the big blind',
    'icm9_0828ea26b2c5bbb4': 'Final table, 9 left, 10bb average, short stack on the button',
    'icm9_1204d567575f6e14': 'Final table, 9 left, 15bb average, chip leader in the big blind',
    'icm9_cc39e50e7acb7c41': 'Final table, 9 left, 15bb average, short stack on the button',
    'icm9_61868301ded5ee42': 'Final table, 9 left, 20bb average, chip leader in the big blind',
    'icm9_2edbe7dffd026746': 'Final table, 9 left, 20bb average, short stack on the button',
    'icm9_f93023d08089c13b': 'Final table, 9 left, 30bb average, chip leader in the big blind',
    'icm9_29e438cdecc715f6': 'Final table, 9 left, 30bb average, short stack on the button',
    'icm9_663eb37e871ee5f5': 'Final table, 9 left, 40bb average, chip leader in the big blind',
    'icm9_b3e8e2506bb5603c': 'Final table, 9 left, 40bb average, short stack on the button',
    'icm8_4c02b3cdec24e380': 'Early, PKO 0.05 a head',
    'icm8_5e076fc93c6bcde8': 'Early, PKO 0.1 a head',
    'icm8_5c7369ea01575a84': 'Early, KO 0.05 a head',
    'icm8_35f624e1f418093e': 'Bubble, PKO 0.4 a head',
    'icm8_6f4322309721d1ec': 'Bubble, PKO 0.8 a head',
    'icm8_d2f78f45e44c8d51': 'Bubble, KO 0.4 a head',
    'icm5_8f7872f25cfe9be1': 'Final-table bubble, PKO 2.5 a head',
    'icm5_f823ceb54ea9b1d7': 'Final-table bubble, PKO 5 a head',
    'icm5_e27e5c13df9421da': 'Final-table bubble, KO 2.5 a head',
    'icm9_5fc223a6b2e912a5': 'Final table, PKO 2.5 a head',
    'icm9_a33bb4de6a09f840': 'Final table, PKO 5 a head',
    'icm9_ab92cd6b94479a7e': 'Final table, KO 2.5 a head',
    'icm6_d6be7f5541f34a0a': 'Final table, 6 left, 15bb average, equal stacks, PKO 2.5 a head',
    'icm6_f499122b5d12df76': 'Final table, 6 left, 15bb average, equal stacks, PKO 5 a head',
    'icm6_f02784d63d33c128': 'Final table, 6 left, 15bb average, chip leader on the button, PKO 2.5 a head',
    'icm6_ff7b3de9ca53c8f9': 'Final table, 6 left, 15bb average, chip leader on the button, PKO 5 a head',
    'icm6_17bc37b97ece43a4': 'Final table, 6 left, 15bb average, short stack in the big blind, PKO 2.5 a head',
    'icm6_d9fc9797ac186362': 'Final table, 6 left, 15bb average, short stack in the big blind, PKO 5 a head',
    'icm6_34dbf0c23c7b2499': 'Final table, 6 left, 30bb average, equal stacks, PKO 2.5 a head',
    'icm6_cd15ed5ca941ad5e': 'Final table, 6 left, 30bb average, equal stacks, PKO 5 a head',
    'icm6_9367ac8ef4e8f768': 'Final table, 6 left, 30bb average, chip leader on the button, PKO 2.5 a head',
    'icm6_3cea9a9523317752': 'Final table, 6 left, 30bb average, chip leader on the button, PKO 5 a head',
    'icm6_98525796507fc577': 'Final table, 6 left, 30bb average, short stack in the big blind, PKO 2.5 a head',
    'icm6_34ebd000d1a13516': 'Final table, 6 left, 30bb average, short stack in the big blind, PKO 5 a head',
    'icm9_dcb90274b06a6624': 'Final table, 9 left, 15bb average, equal stacks, PKO 2.5 a head',
    'icm9_dcf9aca79aa38b8f': 'Final table, 9 left, 15bb average, equal stacks, PKO 5 a head',
    'icm9_d3b85224a77e8462': 'Final table, 9 left, 15bb average, chip leader on the button, PKO 2.5 a head',
    'icm9_49da90fc3534e745': 'Final table, 9 left, 15bb average, chip leader on the button, PKO 5 a head',
    'icm9_6c3976844a80c5cd': 'Final table, 9 left, 15bb average, short stack in the big blind, PKO 2.5 a head',
    'icm9_34afb9359f3f13a4': 'Final table, 9 left, 15bb average, short stack in the big blind, PKO 5 a head',
    'icm9_ce30f7aa58e11c3c': 'Final table, 9 left, 30bb average, equal stacks, PKO 2.5 a head',
    'icm9_3e04182dc664c242': 'Final table, 9 left, 30bb average, equal stacks, PKO 5 a head',
    'icm9_790a2901ef20a92d': 'Final table, 9 left, 30bb average, chip leader on the button, PKO 2.5 a head',
    'icm9_fcfed48c84146ea9': 'Final table, 9 left, 30bb average, chip leader on the button, PKO 5 a head',
    'icm9_547101c427d67f71': 'Final table, 9 left, 30bb average, short stack in the big blind, PKO 2.5 a head',
    'icm9_e3b4bbec9592f661': 'Final table, 9 left, 30bb average, short stack in the big blind, PKO 5 a head',
    'icm3_a3563ca976ae23bd': 'Satellite, 2 seats for 3 left, 10bb average, equal stacks',
    'icm3_b3c7d43970841f30': 'Satellite, 2 seats for 3 left, 10bb average, chip leader on the button',
    'icm3_8e5a6e1501beaa04': 'Satellite, 2 seats for 3 left, 10bb average, short stack in the big blind',
    'icm3_39e5db9b39cf02b1': 'Satellite, 2 seats for 3 left, 15bb average, equal stacks',
    'icm3_8838105d93d2b37b': 'Satellite, 2 seats for 3 left, 15bb average, chip leader on the button',
    'icm3_6eb9e1f5b6d2707f': 'Satellite, 2 seats for 3 left, 15bb average, short stack in the big blind',
    'icm3_14c4d2ac16d13a07': 'Satellite, 2 seats for 3 left, 25bb average, equal stacks',
    'icm3_ee41f00ecf3950a5': 'Satellite, 2 seats for 3 left, 25bb average, chip leader on the button',
    'icm3_ec19dbab2dfffc6c': 'Satellite, 2 seats for 3 left, 25bb average, short stack in the big blind',
    'icm4_fb05f23d9d8d1e90': 'Satellite, 3 seats for 4 left, 10bb average, equal stacks',
    'icm4_b74e91a88bf89c84': 'Satellite, 3 seats for 4 left, 10bb average, chip leader on the button',
    'icm4_7cba85699afc311f': 'Satellite, 3 seats for 4 left, 10bb average, short stack in the big blind',
    'icm4_a5eb2718a5ab37de': 'Satellite, 3 seats for 4 left, 15bb average, equal stacks',
    'icm4_7df997ee0d314983': 'Satellite, 3 seats for 4 left, 15bb average, chip leader on the button',
    'icm4_8490d4788f710350': 'Satellite, 3 seats for 4 left, 15bb average, short stack in the big blind',
    'icm4_abd7b96fc1927363': 'Satellite, 3 seats for 4 left, 25bb average, equal stacks',
    'icm4_67ee89319f92e272': 'Satellite, 3 seats for 4 left, 25bb average, chip leader on the button',
    'icm4_d64ae949bf029950': 'Satellite, 3 seats for 4 left, 25bb average, short stack in the big blind',
    'icm4_409b14887bd58801': 'Satellite, 2 seats for 4 left, 10bb average, equal stacks',
    'icm4_065047c641593950': 'Satellite, 2 seats for 4 left, 10bb average, chip leader on the button',
    'icm4_3215607392ec902d': 'Satellite, 2 seats for 4 left, 10bb average, short stack in the big blind',
    'icm4_46c990ba54dc53ee': 'Satellite, 2 seats for 4 left, 15bb average, equal stacks',
    'icm4_7345e3e872602f9a': 'Satellite, 2 seats for 4 left, 15bb average, chip leader on the button',
    'icm4_931e0b9765f1d4b6': 'Satellite, 2 seats for 4 left, 15bb average, short stack in the big blind',
    'icm4_21f51a9db7275fc3': 'Satellite, 2 seats for 4 left, 25bb average, equal stacks',
    'icm4_b769f8cdb404e52d': 'Satellite, 2 seats for 4 left, 25bb average, chip leader on the button',
    'icm4_74a48af9c672d486': 'Satellite, 2 seats for 4 left, 25bb average, short stack in the big blind',
    'icm5_5774696831f394a2': 'Satellite, 4 seats for 5 left, 10bb average, equal stacks',
    'icm5_10ba6a003b611089': 'Satellite, 4 seats for 5 left, 10bb average, chip leader on the button',
    'icm5_9bfe3c5f76197507': 'Satellite, 4 seats for 5 left, 10bb average, short stack in the big blind',
    'icm5_4eb50a1b50f55349': 'Satellite, 4 seats for 5 left, 15bb average, equal stacks',
    'icm5_32561f7cacc6f62e': 'Satellite, 4 seats for 5 left, 15bb average, chip leader on the button',
    'icm5_04badedcf65d71a2': 'Satellite, 4 seats for 5 left, 15bb average, short stack in the big blind',
    'icm5_0027900928cc14c4': 'Satellite, 4 seats for 5 left, 25bb average, equal stacks',
    'icm5_671eb1add91b76ea': 'Satellite, 4 seats for 5 left, 25bb average, chip leader on the button',
    'icm5_0ff3cc9af5015319': 'Satellite, 4 seats for 5 left, 25bb average, short stack in the big blind',
    'icm5_29476e4e2984db45': 'Satellite, 3 seats for 5 left, 10bb average, equal stacks',
    'icm5_f016c2ba7d2a2418': 'Satellite, 3 seats for 5 left, 10bb average, chip leader on the button',
    'icm5_955683c8c50a67df': 'Satellite, 3 seats for 5 left, 10bb average, short stack in the big blind',
    'icm5_ba981c4fc3e96254': 'Satellite, 3 seats for 5 left, 15bb average, equal stacks',
    'icm5_46a42bbc8040b6e7': 'Satellite, 3 seats for 5 left, 15bb average, chip leader on the button',
    'icm5_d54de2d835e8f1ff': 'Satellite, 3 seats for 5 left, 15bb average, short stack in the big blind',
    'icm5_a8b71bbf53622eeb': 'Satellite, 3 seats for 5 left, 25bb average, equal stacks',
    'icm5_89a2d02822dd1524': 'Satellite, 3 seats for 5 left, 25bb average, chip leader on the button',
    'icm5_5b1b69626beedf19': 'Satellite, 3 seats for 5 left, 25bb average, short stack in the big blind',
    'icm6_52b860352b8509e1': 'Satellite, 5 seats for 6 left, 10bb average, equal stacks',
    'icm6_13ba435659855d5d': 'Satellite, 5 seats for 6 left, 10bb average, chip leader on the button',
    'icm6_91e96a12794f77a3': 'Satellite, 5 seats for 6 left, 10bb average, short stack in the big blind',
    'icm6_3c2ec7458668dadf': 'Satellite, 5 seats for 6 left, 15bb average, equal stacks',
    'icm6_aba9679c9cf75af2': 'Satellite, 5 seats for 6 left, 15bb average, chip leader on the button',
    'icm6_93dc169af0ee0dc7': 'Satellite, 5 seats for 6 left, 15bb average, short stack in the big blind',
    'icm6_972bb4461bb64bfd': 'Satellite, 5 seats for 6 left, 25bb average, equal stacks',
    'icm6_c8ff5c31cd6d853b': 'Satellite, 5 seats for 6 left, 25bb average, chip leader on the button',
    'icm6_2c4098605eb81185': 'Satellite, 5 seats for 6 left, 25bb average, short stack in the big blind',
    'icm6_8b702a895e21508e': 'Satellite, 4 seats for 6 left, 10bb average, equal stacks',
    'icm6_2fe1c98a2c857873': 'Satellite, 4 seats for 6 left, 10bb average, chip leader on the button',
    'icm6_d77ef28467af69fb': 'Satellite, 4 seats for 6 left, 10bb average, short stack in the big blind',
    'icm6_46e8b04ae8d240b9': 'Satellite, 4 seats for 6 left, 15bb average, equal stacks',
    'icm6_f07ee638df1a37e8': 'Satellite, 4 seats for 6 left, 15bb average, chip leader on the button',
    'icm6_4be973dc549ab1c3': 'Satellite, 4 seats for 6 left, 15bb average, short stack in the big blind',
    'icm6_0d50f58a362a290e': 'Satellite, 4 seats for 6 left, 25bb average, equal stacks',
    'icm6_0364cb710bd1a1e1': 'Satellite, 4 seats for 6 left, 25bb average, chip leader on the button',
    'icm6_ee5b31fa7a5b4b94': 'Satellite, 4 seats for 6 left, 25bb average, short stack in the big blind',
    'icm7_a98d4a6dc1bcb46b': 'Satellite, 6 seats for 7 left, 10bb average, equal stacks',
    'icm7_f7024d6b1abd8c83': 'Satellite, 6 seats for 7 left, 10bb average, chip leader on the button',
    'icm7_5ee5b767601e5876': 'Satellite, 6 seats for 7 left, 10bb average, short stack in the big blind',
    'icm7_8541c1d65d8ad0f2': 'Satellite, 6 seats for 7 left, 15bb average, equal stacks',
    'icm7_f29aaa390337a8bd': 'Satellite, 6 seats for 7 left, 15bb average, chip leader on the button',
    'icm7_2afb1a1733826bcc': 'Satellite, 6 seats for 7 left, 15bb average, short stack in the big blind',
    'icm7_d737595cf91767f2': 'Satellite, 6 seats for 7 left, 25bb average, equal stacks',
    'icm7_2ed0ec8b6dcf7a02': 'Satellite, 6 seats for 7 left, 25bb average, chip leader on the button',
    'icm7_5d05a8ca5ee0a8d5': 'Satellite, 6 seats for 7 left, 25bb average, short stack in the big blind',
    'icm7_bd706cc31487b5e9': 'Satellite, 5 seats for 7 left, 10bb average, equal stacks',
    'icm7_b54d179030eb65e3': 'Satellite, 5 seats for 7 left, 10bb average, chip leader on the button',
    'icm7_35b4a7a98455d375': 'Satellite, 5 seats for 7 left, 10bb average, short stack in the big blind',
    'icm7_c6845e2394cd754d': 'Satellite, 5 seats for 7 left, 15bb average, equal stacks',
    'icm7_c57b66fe327c9000': 'Satellite, 5 seats for 7 left, 15bb average, chip leader on the button',
    'icm7_5960319463ed0aee': 'Satellite, 5 seats for 7 left, 15bb average, short stack in the big blind',
    'icm7_f18b03f59a957b67': 'Satellite, 5 seats for 7 left, 25bb average, equal stacks',
    'icm7_86ec157c651f2be1': 'Satellite, 5 seats for 7 left, 25bb average, chip leader on the button',
    'icm7_ac07580d409a3f62': 'Satellite, 5 seats for 7 left, 25bb average, short stack in the big blind',
    'icm8_59b3149298116df8': 'Satellite, 7 seats for 8 left, 10bb average, equal stacks',
    'icm8_79d69a61445af13d': 'Satellite, 7 seats for 8 left, 10bb average, chip leader on the button',
    'icm8_46546d72780a0fc0': 'Satellite, 7 seats for 8 left, 10bb average, short stack in the big blind',
    'icm8_c9b86c7eeaecadcc': 'Satellite, 7 seats for 8 left, 15bb average, equal stacks',
    'icm8_098ae1b4f7ab4aae': 'Satellite, 7 seats for 8 left, 15bb average, chip leader on the button',
    'icm8_afe6c35f3f74a755': 'Satellite, 7 seats for 8 left, 15bb average, short stack in the big blind',
    'icm8_228c4cce72f22b0b': 'Satellite, 7 seats for 8 left, 25bb average, equal stacks',
    'icm8_cc12d5e643617d32': 'Satellite, 7 seats for 8 left, 25bb average, chip leader on the button',
    'icm8_783d5195361d56c5': 'Satellite, 7 seats for 8 left, 25bb average, short stack in the big blind',
    'icm8_747bb4da91cf10bf': 'Satellite, 6 seats for 8 left, 10bb average, equal stacks',
    'icm8_6b6ffdaddf17f24a': 'Satellite, 6 seats for 8 left, 10bb average, chip leader on the button',
    'icm8_097ac6579dcf88b0': 'Satellite, 6 seats for 8 left, 10bb average, short stack in the big blind',
    'icm8_893222664270238e': 'Satellite, 6 seats for 8 left, 15bb average, equal stacks',
    'icm8_ae246cd33464570f': 'Satellite, 6 seats for 8 left, 15bb average, chip leader on the button',
    'icm8_a58a0fc78d37f5e1': 'Satellite, 6 seats for 8 left, 15bb average, short stack in the big blind',
    'icm8_f32c8926d8e4f8a6': 'Satellite, 6 seats for 8 left, 25bb average, equal stacks',
    'icm8_9c68e9cb42cdcdb9': 'Satellite, 6 seats for 8 left, 25bb average, chip leader on the button',
    'icm8_7df799d341124d35': 'Satellite, 6 seats for 8 left, 25bb average, short stack in the big blind',
    'icm9_a228c462fdabcaea': 'Satellite, 8 seats for 9 left, 10bb average, equal stacks',
    'icm9_a0fc8b248b67ca11': 'Satellite, 8 seats for 9 left, 10bb average, chip leader on the button',
    'icm9_ca0f9693de7df9e0': 'Satellite, 8 seats for 9 left, 10bb average, short stack in the big blind',
    'icm9_9953b08adf32fe1a': 'Satellite, 8 seats for 9 left, 15bb average, equal stacks',
    'icm9_667b3894128c12df': 'Satellite, 8 seats for 9 left, 15bb average, chip leader on the button',
    'icm9_30648a4c3b28943b': 'Satellite, 8 seats for 9 left, 15bb average, short stack in the big blind',
    'icm9_d1fdd473a504373a': 'Satellite, 8 seats for 9 left, 25bb average, equal stacks',
    'icm9_6db127c1a7a94e0f': 'Satellite, 8 seats for 9 left, 25bb average, chip leader on the button',
    'icm9_63a41dd3491cb845': 'Satellite, 8 seats for 9 left, 25bb average, short stack in the big blind',
    'icm9_1560009b151b66e7': 'Satellite, 7 seats for 9 left, 10bb average, equal stacks',
    'icm9_f30ec2415b0a4fef': 'Satellite, 7 seats for 9 left, 10bb average, chip leader on the button',
    'icm9_942be2574b67b042': 'Satellite, 7 seats for 9 left, 10bb average, short stack in the big blind',
    'icm9_533c6190492cfaeb': 'Satellite, 7 seats for 9 left, 15bb average, equal stacks',
    'icm9_3caa90c14f97c127': 'Satellite, 7 seats for 9 left, 15bb average, chip leader on the button',
    'icm9_4469a8c39a3d50c9': 'Satellite, 7 seats for 9 left, 15bb average, short stack in the big blind',
    'icm9_a2a7856f5ab1f239': 'Satellite, 7 seats for 9 left, 25bb average, equal stacks',
    'icm9_641e4c862079b32b': 'Satellite, 7 seats for 9 left, 25bb average, chip leader on the button',
    'icm9_a5a43c2d396cfe90': 'Satellite, 7 seats for 9 left, 25bb average, short stack in the big blind',
    'icm5_185e299a29f3523d': 'Final-table bubble, chip EV',
    'icm3_4614482baeb9cc19': 'Three left, chip EV',
    'icm2_0ead085bf950cb84': 'Heads-up, chip EV',
    'icm4_389eb843030df103': 'Sit & go bubble, chip EV',
    'icm6_3f55a6c8b842b97a': 'Sit & go, 6 players, chip EV',
    'icm8_d1303b46838cbd2c': 'Early, chip EV',
    'icm8_fe2f08b4393d5045': 'Bubble, chip EV',
    'icm9_13b8f189de58c0d3': 'Final table, chip EV',
    'icm9_49dbd94707ad1dd7': 'Sit & go, 9 players, chip EV',
    'icm3_213c4b67413c57c0': 'Final table, 3 left, 10bb average, equal stacks, chip EV',
    'icm3_3b77d0c57610a11e': 'Final table, 3 left, 10bb average, chip leader on the button, chip EV',
    'icm3_930d3ba464a19cdb': 'Final table, 3 left, 10bb average, short stack in the big blind, chip EV',
    'icm3_9f150a11f3ae206d': 'Final table, 3 left, 15bb average, equal stacks, chip EV',
    'icm3_6acfe86a1e4949c7': 'Final table, 3 left, 15bb average, chip leader on the button, chip EV',
    'icm3_e4ac261bdf239548': 'Final table, 3 left, 15bb average, short stack in the big blind, chip EV',
    'icm3_adf5d94e6d884947': 'Final table, 3 left, 20bb average, equal stacks, chip EV',
    'icm3_cd5fae90956c10c2': 'Final table, 3 left, 20bb average, chip leader on the button, chip EV',
    'icm3_bde7473e583a68de': 'Final table, 3 left, 20bb average, short stack in the big blind, chip EV',
    'icm3_a5458326e8ce0ce3': 'Final table, 3 left, 30bb average, equal stacks, chip EV',
    'icm3_a5b9bd043a29bd98': 'Final table, 3 left, 30bb average, chip leader on the button, chip EV',
    'icm3_a045db9a9387ced6': 'Final table, 3 left, 30bb average, short stack in the big blind, chip EV',
    'icm3_f77b37ec5abe25e5': 'Final table, 3 left, 40bb average, equal stacks, chip EV',
    'icm3_9060efa0b9d91486': 'Final table, 3 left, 40bb average, chip leader on the button, chip EV',
    'icm3_6eff9d7e61a1495b': 'Final table, 3 left, 40bb average, short stack in the big blind, chip EV',
    'icm4_8b9c03a05a665c9f': 'Final table, 4 left, 10bb average, equal stacks, chip EV',
    'icm4_a4040f69880a8da4': 'Final table, 4 left, 10bb average, chip leader on the button, chip EV',
    'icm4_b671a9ab5cd741f7': 'Final table, 4 left, 10bb average, short stack in the big blind, chip EV',
    'icm4_d3f453c2445d2793': 'Final table, 4 left, 15bb average, equal stacks, chip EV',
    'icm4_1f78c0a53f5581fb': 'Final table, 4 left, 15bb average, chip leader on the button, chip EV',
    'icm4_1ffeef78abae37f1': 'Final table, 4 left, 15bb average, short stack in the big blind, chip EV',
    'icm4_cbfb96a1d604c1d1': 'Final table, 4 left, 20bb average, equal stacks, chip EV',
    'icm4_e695addaf908c394': 'Final table, 4 left, 20bb average, chip leader on the button, chip EV',
    'icm4_1f38a54fd52655d2': 'Final table, 4 left, 20bb average, short stack in the big blind, chip EV',
    'icm4_65bd41b6a0022fc1': 'Final table, 4 left, 30bb average, equal stacks, chip EV',
    'icm4_624800efcd3d3939': 'Final table, 4 left, 30bb average, chip leader on the button, chip EV',
    'icm4_3c87bd050c16cad2': 'Final table, 4 left, 30bb average, short stack in the big blind, chip EV',
    'icm4_bcc750cb9e851d03': 'Final table, 4 left, 40bb average, equal stacks, chip EV',
    'icm4_a1a1cda57153d32a': 'Final table, 4 left, 40bb average, chip leader on the button, chip EV',
    'icm4_18cf8f1b26739626': 'Final table, 4 left, 40bb average, short stack in the big blind, chip EV',
    'icm5_929099aa049d2f75': 'Final table, 5 left, 10bb average, equal stacks, chip EV',
    'icm5_ff912d76b5a369e7': 'Final table, 5 left, 10bb average, chip leader on the button, chip EV',
    'icm5_e902423ef80ebdf4': 'Final table, 5 left, 10bb average, short stack in the big blind, chip EV',
    'icm5_5f61d8b1f3bb6082': 'Final table, 5 left, 15bb average, equal stacks, chip EV',
    'icm5_d8b05396fab2829a': 'Final table, 5 left, 15bb average, chip leader on the button, chip EV',
    'icm5_99cd3de2e3451926': 'Final table, 5 left, 15bb average, short stack in the big blind, chip EV',
    'icm5_5b16342263acd50f': 'Final table, 5 left, 20bb average, equal stacks, chip EV',
    'icm5_5ad30cd2dc7f4dba': 'Final table, 5 left, 20bb average, chip leader on the button, chip EV',
    'icm5_ebe37ba354da91dd': 'Final table, 5 left, 20bb average, short stack in the big blind, chip EV',
    'icm5_3345a12009c7711d': 'Final table, 5 left, 30bb average, equal stacks, chip EV',
    'icm5_340e954f8bcdfdf7': 'Final table, 5 left, 30bb average, chip leader on the button, chip EV',
    'icm5_e39b822cb7641ac3': 'Final table, 5 left, 30bb average, short stack in the big blind, chip EV',
    'icm5_1aa1b7a73399799d': 'Final table, 5 left, 40bb average, equal stacks, chip EV',
    'icm5_d47f7d1f6d910b5a': 'Final table, 5 left, 40bb average, chip leader on the button, chip EV',
    'icm5_b93a733910c67fb1': 'Final table, 5 left, 40bb average, short stack in the big blind, chip EV',
    'icm6_10e2838d88d87640': 'Final table, 6 left, 10bb average, equal stacks, chip EV',
    'icm6_06b5dbca7ed521d6': 'Final table, 6 left, 10bb average, chip leader on the button, chip EV',
    'icm6_88b0607f39a2839a': 'Final table, 6 left, 10bb average, short stack in the big blind, chip EV',
    'icm6_121f4519a4501c0c': 'Final table, 6 left, 15bb average, equal stacks, chip EV',
    'icm6_ba89110a39fd8b08': 'Final table, 6 left, 15bb average, chip leader on the button, chip EV',
    'icm6_e96700c9606cf246': 'Final table, 6 left, 15bb average, short stack in the big blind, chip EV',
    'icm6_4a01b66d2b8c2c64': 'Final table, 6 left, 20bb average, equal stacks, chip EV',
    'icm6_277cc828bdfc3f77': 'Final table, 6 left, 20bb average, chip leader on the button, chip EV',
    'icm6_d668f839acfb80e9': 'Final table, 6 left, 20bb average, short stack in the big blind, chip EV',
    'icm6_eef9b2d4e9a532f7': 'Final table, 6 left, 30bb average, equal stacks, chip EV',
    'icm6_1a51cede099852de': 'Final table, 6 left, 30bb average, chip leader on the button, chip EV',
    'icm6_0310d118d5e46191': 'Final table, 6 left, 30bb average, short stack in the big blind, chip EV',
    'icm6_f4b19304e58642e0': 'Final table, 6 left, 40bb average, equal stacks, chip EV',
    'icm6_9bf12ed12dad408f': 'Final table, 6 left, 40bb average, chip leader on the button, chip EV',
    'icm6_ae8e825d3a354311': 'Final table, 6 left, 40bb average, short stack in the big blind, chip EV',
    'icm7_56d7eee02a400262': 'Final table, 7 left, 10bb average, equal stacks, chip EV',
    'icm7_9e7f9caf4cd1ac8f': 'Final table, 7 left, 10bb average, chip leader on the button, chip EV',
    'icm7_f006a7f9bf9426a0': 'Final table, 7 left, 10bb average, short stack in the big blind, chip EV',
    'icm7_448e0932c3f6a51e': 'Final table, 7 left, 15bb average, equal stacks, chip EV',
    'icm7_f6f442adb59f81fa': 'Final table, 7 left, 15bb average, chip leader on the button, chip EV',
    'icm7_81effd20dcdf5788': 'Final table, 7 left, 15bb average, short stack in the big blind, chip EV',
    'icm7_d16d2976bd369595': 'Final table, 7 left, 20bb average, equal stacks, chip EV',
    'icm7_9cd1820b20f78c43': 'Final table, 7 left, 20bb average, chip leader on the button, chip EV',
    'icm7_e7d55afd0d34a421': 'Final table, 7 left, 20bb average, short stack in the big blind, chip EV',
    'icm7_8213a923fd751cdf': 'Final table, 7 left, 30bb average, equal stacks, chip EV',
    'icm7_3f41cc3ebd132401': 'Final table, 7 left, 30bb average, chip leader on the button, chip EV',
    'icm7_d64d109c5f7f7a3d': 'Final table, 7 left, 30bb average, short stack in the big blind, chip EV',
    'icm7_497faaa206ffb662': 'Final table, 7 left, 40bb average, equal stacks, chip EV',
    'icm7_1ef749a41836d591': 'Final table, 7 left, 40bb average, chip leader on the button, chip EV',
    'icm7_390ff8cb87c8f48b': 'Final table, 7 left, 40bb average, short stack in the big blind, chip EV',
    'icm8_e9f713a32b93a864': 'Final table, 8 left, 10bb average, equal stacks, chip EV',
    'icm8_3d8d23f1864cf66a': 'Final table, 8 left, 10bb average, chip leader on the button, chip EV',
    'icm8_b9a4d75e46ea28c6': 'Final table, 8 left, 10bb average, short stack in the big blind, chip EV',
    'icm8_34a210e574623d6a': 'Final table, 8 left, 15bb average, equal stacks, chip EV',
    'icm8_84bbe93af92f875a': 'Final table, 8 left, 15bb average, chip leader on the button, chip EV',
    'icm8_4d088253082c9ccc': 'Final table, 8 left, 15bb average, short stack in the big blind, chip EV',
    'icm8_18c1871e9a7c4422': 'Final table, 8 left, 20bb average, equal stacks, chip EV',
    'icm8_3be970228c5ed94c': 'Final table, 8 left, 20bb average, chip leader on the button, chip EV',
    'icm8_e5b6b6fff5bb2cd5': 'Final table, 8 left, 20bb average, short stack in the big blind, chip EV',
    'icm8_397cc2f2ca07c2ad': 'Final table, 8 left, 30bb average, equal stacks, chip EV',
    'icm8_0b5c9b47f4e04838': 'Final table, 8 left, 30bb average, chip leader on the button, chip EV',
    'icm8_73c504ae8fe534e5': 'Final table, 8 left, 30bb average, short stack in the big blind, chip EV',
    'icm8_89ecb7b243801ef1': 'Final table, 8 left, 40bb average, equal stacks, chip EV',
    'icm8_4eaefac2336efedd': 'Final table, 8 left, 40bb average, chip leader on the button, chip EV',
    'icm8_ae65ea4a8a0a6a97': 'Final table, 8 left, 40bb average, short stack in the big blind, chip EV',
    'icm9_60e131755a4b13f3': 'Final table, 9 left, 10bb average, equal stacks, chip EV',
    'icm9_c6d63c0ca08590a1': 'Final table, 9 left, 10bb average, chip leader on the button, chip EV',
    'icm9_f17a57c21ef9bfba': 'Final table, 9 left, 10bb average, short stack in the big blind, chip EV',
    'icm9_4c5a0420c5875076': 'Final table, 9 left, 15bb average, equal stacks, chip EV',
    'icm9_517588d2af9bcd55': 'Final table, 9 left, 15bb average, chip leader on the button, chip EV',
    'icm9_e272706dba55b884': 'Final table, 9 left, 15bb average, short stack in the big blind, chip EV',
    'icm9_40c32472ac680b80': 'Final table, 9 left, 20bb average, equal stacks, chip EV',
    'icm9_7f2ab8036d33945e': 'Final table, 9 left, 20bb average, chip leader on the button, chip EV',
    'icm9_634b267b978573de': 'Final table, 9 left, 20bb average, short stack in the big blind, chip EV',
    'icm9_8aa6a2c8dcd3d3c1': 'Final table, 9 left, 30bb average, equal stacks, chip EV',
    'icm9_ba9c889de1352ff3': 'Final table, 9 left, 30bb average, chip leader on the button, chip EV',
    'icm9_e5798a18d26cf9a7': 'Final table, 9 left, 30bb average, short stack in the big blind, chip EV',
    'icm9_4710dedd89d634f5': 'Final table, 9 left, 40bb average, equal stacks, chip EV',
    'icm9_4bd1015867e8e4a0': 'Final table, 9 left, 40bb average, chip leader on the button, chip EV',
    'icm9_7fab183664659770': 'Final table, 9 left, 40bb average, short stack in the big blind, chip EV',
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
